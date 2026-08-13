import { builtinToolExecutionMetadata } from "./tool-registry.js";

const DEFAULT_TIMEOUT_MS = 120000;

export function createAgentToolScheduler(options = {}) {
  const execute = requiredFunction(options.execute, "execute");
  const resolveMetadata = typeof options.resolveMetadata === "function"
    ? options.resolveMetadata
    : (call) => inferToolExecutionMetadata(call.name, call.args);
  const operationStore = options.operationStore || createMemoryOperationStore();
  const validate = typeof options.validate === "function" ? options.validate : () => {};

  return {
    async executeBatch(toolCalls, context = {}) {
      const calls = normalizeToolCalls(toolCalls);
      const scheduled = await Promise.all(calls.map(async (call, index) => {
        const metadata = normalizeExecutionMetadata(await resolveMetadata(call, context));
        return {
          call,
          index,
          metadata,
          operationKey: operationKeyFor(call, context),
          uncertainEffectKey: metadata.idempotency === "unknown"
            ? await uncertainEffectKeyFor(call, context)
            : ""
        };
      }));
      const waves = scheduleExecutionWaves(scheduled);
      const results = new Array(scheduled.length);

      for (const wave of waves) {
        await Promise.all(wave.map(async (entry) => {
          results[entry.index] = await executeScheduledCall(entry, context, execute, operationStore, validate);
        }));
      }
      return {
        results,
        waves: waves.map((wave) => wave.map((entry) => entry.call.callId))
      };
    }
  };
}

export function inferToolExecutionMetadata(name, args = {}) {
  const tool = String(name || "");
  const registered = builtinToolExecutionMetadata(tool, args);
  if (registered) return registered;
  return writeMetadata([`tool:${tool || "unknown"}`], "unknown");
}

export function scheduleExecutionWaves(entries) {
  const waves = [];
  for (const entry of entries) {
    const wave = waves.at(-1);
    const canJoin = Boolean(
      wave &&
      entry.metadata.parallelSafe &&
      wave.every((candidate) => candidate.metadata.parallelSafe && !resourcesConflict(entry, candidate))
    );
    if (canJoin) wave.push(entry);
    else waves.push([entry]);
  }
  return waves;
}

export function normalizeToolObservation(call, result, metadata = {}) {
  const failed = result?.ok === false;
  return {
    callId: String(call.callId || ""),
    tool: String(call.name || ""),
    ok: !failed,
    result,
    data: failed ? null : result,
    error: failed ? {
      code: String(result.errorType || "tool_execution_error"),
      message: String(result.error || "Tool execution failed."),
      retryable: ["safe", "retry_safe"].includes(metadata.idempotency)
    } : null,
    meta: {
      effects: metadata.effects,
      resources: metadata.resources,
      idempotency: metadata.idempotency
    },
    errorType: failed ? String(result.errorType || "tool_execution_error") : "",
    effects: metadata.effects,
    resources: metadata.resources,
    idempotency: metadata.idempotency
  };
}

async function executeScheduledCall(entry, context, execute, operationStore, validate) {
  throwIfStopped(context.signal);
  try {
    await validate(entry.call, entry.metadata, context);
  } catch (error) {
    const result = {
      ok: false,
      error: error?.message || String(error),
      errorType: "tool_argument_validation_error"
    };
    return {
      call: entry.call,
      result,
      observation: normalizeToolObservation(entry.call, result, entry.metadata),
      metadata: entry.metadata,
      operationKey: entry.operationKey,
      durationMs: 0
    };
  }
  if (entry.uncertainEffectKey) {
    const uncertainEffect = await operationStore.get(entry.uncertainEffectKey);
    if (uncertainEffect) {
      const result = {
        ok: false,
        error: "An equivalent Tool execution previously timed out after it started. Its external effect is unknown, so WebClaw will not replay it automatically. Verify the target state before trying a different operation.",
        errorType: "operation_state_unknown",
        effectState: "unknown",
        operationKey: uncertainEffect.value?.operationKey || entry.operationKey
      };
      return {
        call: entry.call,
        result,
        observation: normalizeToolObservation(entry.call, result, entry.metadata),
        metadata: entry.metadata,
        operationKey: entry.operationKey,
        durationMs: 0,
        recoveryRequired: true
      };
    }
  }
  const existing = await operationStore.get(entry.operationKey);
  throwIfStopped(context.signal);
  if (existing?.status === "completed") {
    return { ...existing.value, deduplicated: true };
  }
  if (
    existing?.status === "started" &&
    !["safe", "retry_safe"].includes(existing.value?.metadata?.idempotency || entry.metadata.idempotency)
  ) {
    const result = {
      ok: false,
      error: "A previous execution started but did not record a result. This Tool may have external side effects, so WebClaw will not replay it automatically.",
      errorType: "operation_state_unknown",
      operationKey: entry.operationKey
    };
    const value = {
      call: entry.call,
      result,
      observation: normalizeToolObservation(entry.call, result, entry.metadata),
      metadata: entry.metadata,
      operationKey: entry.operationKey,
      durationMs: 0,
      recoveryRequired: true
    };
    await operationStore.complete(entry.operationKey, value);
    return value;
  }
  const startedAt = Date.now();
  throwIfStopped(context.signal);
  await operationStore.start(entry.operationKey, {
    call: entry.call,
    metadata: entry.metadata,
    startedAt
  });
  try {
    const result = await executeWithTimeout(
      (signal) => execute(entry.call, {
        ...context,
        signal,
        metadata: entry.metadata,
        operationKey: entry.operationKey
      }),
      entry.metadata.timeoutMs,
      context.signal
    );
    const value = {
      call: entry.call,
      result,
      observation: normalizeToolObservation(entry.call, result, entry.metadata),
      metadata: entry.metadata,
      operationKey: entry.operationKey,
      durationMs: Date.now() - startedAt
    };
    await operationStore.complete(entry.operationKey, value);
    return value;
  } catch (error) {
    if (context.signal?.aborted || error?.name === "AbortError" || error?.message === "Stopped") {
      throw error;
    }
    const timedOut = error?.name === "TimeoutError";
    const effectUnknown = timedOut && !["safe", "retry_safe"].includes(entry.metadata.idempotency);
    const result = {
      ok: false,
      error: effectUnknown
        ? "The Tool timed out after execution started. Its external effect is unknown, so WebClaw will not retry the same operation automatically. Verify the target state before trying a different operation."
        : error?.message || String(error),
      errorType: effectUnknown ? "operation_state_unknown" : timedOut ? "tool_timeout" : "tool_execution_error",
      ...(timedOut ? { effectState: "unknown" } : {})
    };
    const value = {
      call: entry.call,
      result,
      observation: normalizeToolObservation(entry.call, result, entry.metadata),
      metadata: entry.metadata,
      operationKey: entry.operationKey,
      durationMs: Date.now() - startedAt
    };
    if (timedOut) {
      if (effectUnknown) {
        value.recoveryRequired = true;
        await operationStore.start(entry.uncertainEffectKey, {
          call: entry.call,
          metadata: entry.metadata,
          operationKey: entry.operationKey,
          effectState: "unknown",
          startedAt
        });
      }
      return value;
    }
    await operationStore.complete(entry.operationKey, value);
    return value;
  }
}

function normalizeToolCalls(value) {
  return (Array.isArray(value) ? value : []).map((call, index) => {
    const name = String(call?.name || "").trim();
    const callId = String(call?.callId || `call-${index}`).trim();
    if (!name || !callId) throw new Error("ToolScheduler requires Tool Call name and callId.");
    return {
      callId,
      name,
      args: call?.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args : {}
    };
  });
}

function normalizeExecutionMetadata(value = {}) {
  const resources = (Array.isArray(value.resources) ? value.resources : [])
    .map((resource) => typeof resource === "string"
      ? { key: resource, mode: "write" }
      : { key: String(resource?.key || ""), mode: resource?.mode === "read" ? "read" : "write" })
    .filter((resource) => resource.key);
  return {
    effects: Array.isArray(value.effects) ? value.effects.map(String) : ["unknown"],
    resources,
    risk: String(value.risk || "normal"),
    idempotency: ["safe", "retry_safe", "unknown"].includes(value.idempotency) ? value.idempotency : "unknown",
    parallelSafe: value.parallelSafe === true,
    timeoutMs: positiveInteger(value.timeoutMs, DEFAULT_TIMEOUT_MS)
  };
}

function resourcesConflict(left, right) {
  for (const a of left.metadata.resources) {
    for (const b of right.metadata.resources) {
      if (!resourceKeysOverlap(a.key, b.key)) continue;
      if (a.mode === "write" || b.mode === "write") return true;
    }
  }
  return false;
}

function resourceKeysOverlap(left, right) {
  if (left === right) return true;
  if (!left.startsWith("vfs:") || !right.startsWith("vfs:")) return false;
  const a = left.slice(4).replace(/\/$/, "");
  const b = right.slice(4).replace(/\/$/, "");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function operationKeyFor(call, context) {
  return [String(context.runId || "run"), call.callId, call.name].join(":");
}

async function uncertainEffectKeyFor(call, context) {
  const runId = String(context.runId || "run");
  const fingerprint = await sha256Hex(stableSerialize({ name: call.name, args: call.args }));
  return [runId, "uncertain", call.name, fingerprint].join(":");
}

function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function writeMetadata(resources, idempotency, risk = "normal") {
  return {
    effects: ["write"],
    resources: resources.map((key) => ({ key, mode: "write" })),
    risk,
    idempotency,
    parallelSafe: false
  };
}

function createMemoryOperationStore() {
  const operations = new Map();
  return {
    async get(key) { return operations.get(key) || null; },
    async start(key, value) { operations.set(key, { status: "started", value }); },
    async complete(key, value) { operations.set(key, { status: "completed", value }); }
  };
}

function executeWithTimeout(start, timeoutMs, parentSignal) {
  return new Promise((resolve, reject) => {
    if (parentSignal?.aborted) {
      reject(stoppedError(parentSignal.reason));
      return;
    }
    const controller = new AbortController();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => {
      controller.abort(parentSignal?.reason || new Error("Stopped"));
      finish(reject, stoppedError(parentSignal?.reason));
    };
    const timer = setTimeout(() => {
      const error = new Error(`Tool execution timed out after ${timeoutMs} ms.`);
      error.name = "TimeoutError";
      controller.abort(error);
      finish(reject, error);
    }, timeoutMs);
    parentSignal?.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => start(controller.signal)).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

function stoppedError(reason) {
  const error = reason instanceof Error ? reason : new Error("Stopped");
  if (error.message !== "Stopped") {
    const stopped = new Error("Stopped");
    stopped.cause = error;
    return stopped;
  }
  return error;
}

function throwIfStopped(signal) {
  if (signal?.aborted) throw stoppedError(signal.reason);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}

function requiredFunction(value, name) {
  if (typeof value !== "function") throw new Error(`ToolScheduler ${name} must be a function.`);
  return value;
}
