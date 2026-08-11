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
      const scheduled = await Promise.all(calls.map(async (call, index) => ({
        call,
        index,
        metadata: normalizeExecutionMetadata(await resolveMetadata(call, context)),
        operationKey: operationKeyFor(call, context)
      })));
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
  if (["get_weather", "knowledge_status", "agent_artifact_read", "task_stack", "list_webclaw_config", "fs_usage"].includes(tool)) {
    return readOnlyMetadata([`tool:${tool}`]);
  }
  if (tool === "get_page_context") return readOnlyMetadata(["chrome:active-tab"]);
  if (tool === "fs_list" || tool === "fs_read") {
    return readOnlyMetadata([`vfs:${String(args.path || "/workspace")}`]);
  }
  if (tool === "fs_search") return readOnlyMetadata(["vfs:/"]);
  if (["knowledge_search", "knowledge_read"].includes(tool)) {
    return readOnlyMetadata(["knowledge:index"]);
  }
  if (["fs_write", "fs_mkdir"].includes(tool)) {
    return writeMetadata([`vfs:${String(args.path || args.destination || args.trashPath || "/")}`], "retry_safe");
  }
  if (["fs_edit", "fs_delete", "fs_restore", "fs_purge"].includes(tool)) {
    return writeMetadata([`vfs:${String(args.path || args.destination || args.trashPath || "/")}`], "unknown");
  }
  if (tool === "fs_move") {
    return writeMetadata([
      `vfs:${String(args.from || "/")}`,
      `vfs:${String(args.to || "/")}`
    ], "unknown");
  }
  if (["fs_apply_patch", "fs_empty_trash", "fs_shell"].includes(tool)) {
    return writeMetadata(["vfs:/"], "unknown");
  }
  if (["click", "type_text", "navigate", "translate_page", "run_js", "chrome_api"].includes(tool)) {
    return writeMetadata(["chrome:active-tab"], tool === "get_page_context" ? "safe" : "unknown", "interactive");
  }
  if (tool === "http_request") {
    const method = String(args.method || "GET").toUpperCase();
    return method === "GET"
      ? readOnlyMetadata([`network:${safeOrigin(args.url)}`])
      : writeMetadata([`network:${safeOrigin(args.url)}`], "unknown", "external");
  }
  if (tool === "search_web") return writeMetadata(["chrome:active-tab"], "unknown", "interactive");
  if (tool === "qiyewechat_notification") {
    return writeMetadata(["external:qiyewechat"], "unknown", "external");
  }
  if (tool === "update_plan") return writeMetadata(["agent:task-state"], "retry_safe");
  if (tool === "task_push") return writeMetadata(["agent:task-state"], "unknown");
  if (["propose_webclaw_config_patch", "apply_webclaw_config_patch", "rollback_webclaw_config_patch"].includes(tool)) {
    return writeMetadata(["webclaw:configuration"], "unknown", "configuration");
  }
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
    const result = {
      ok: false,
      error: error?.message || String(error),
      errorType: error?.name === "TimeoutError" ? "tool_timeout" : "tool_execution_error"
    };
    const value = {
      call: entry.call,
      result,
      observation: normalizeToolObservation(entry.call, result, entry.metadata),
      metadata: entry.metadata,
      operationKey: entry.operationKey,
      durationMs: Date.now() - startedAt
    };
    if (error?.name === "TimeoutError") {
      value.result.effectState = "unknown";
      value.observation.result = value.result;
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

function readOnlyMetadata(resources) {
  return {
    effects: ["read"],
    resources: resources.map((key) => ({ key, mode: "read" })),
    risk: "low",
    idempotency: "safe",
    parallelSafe: true
  };
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

function safeOrigin(value) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return "unknown";
  }
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
