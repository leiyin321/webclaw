const DATABASE_NAME = "webclaw-agent-runs";
const DATABASE_VERSION = 3;
const RUNS_STORE = "runs";
const EVENTS_STORE = "events";
const OPERATIONS_STORE = "toolOperations";
const ARTIFACTS_STORE = "artifacts";
const TERMINAL_STATUSES = new Set(["completed", "failed", "interrupted", "cancelled"]);
const SENSITIVE_KEY = /(access[_-]?token|refresh[_-]?token|id[_-]?token|bot[_-]?token|api[_-]?key|client[_-]?secret|cookie|password|secret|webhook|token)/i;
const DEFAULT_LEASE_TTL_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 10000;

export function createAgentRunStore(options = {}) {
  const indexedDb = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  return indexedDb
    ? createIndexedDbRunStore(indexedDb, options.databaseName || DATABASE_NAME)
    : createMemoryRunStore();
}

export function classifyAgentRunRecovery(run) {
  const phase = String(run?.checkpoint?.phase || "");
  if (run?.nested === true) {
    return { action: "manual_review", phase, safe: false, reason: "nested_run_parent_unavailable" };
  }
  if (run?.checkpoint?.pendingApproval || phase === "waiting_approval") {
    return { action: "wait_approval", phase, safe: true };
  }
  if (phase === "before_tool") {
    return { action: "inspect_operation", phase, safe: false };
  }
  if (phase === "approval_decided") {
    return { action: "inspect_operation", phase, safe: false, reason: "approved_operation_state_unknown" };
  }
  if ([
    "before_model",
    "after_tool",
    "after_recovery",
    "after_assistant_correction"
  ].includes(phase)) {
    return { action: "resume_model", phase, safe: true };
  }
  return { action: "manual_review", phase, safe: false };
}

export async function resolveAgentRunRecovery(run, getOperation) {
  const recovery = classifyAgentRunRecovery(run);
  if (recovery.action !== "inspect_operation") return recovery;
  const toolCall = run?.checkpoint?.toolCall;
  if (!toolCall?.callId || !toolCall?.name) {
    return { ...recovery, reason: recovery.reason || "tool_checkpoint_missing" };
  }
  const operationKey = String(run?.checkpoint?.operationKey || "") ||
    [run.runId, toolCall.callId, toolCall.name].join(":");
  const operation = typeof getOperation === "function" ? await getOperation(operationKey) : null;
  if (!operation) return { ...recovery, operationKey, reason: "tool_operation_missing" };
  if (operation.status === "completed") {
    return {
      action: "resume_tool",
      phase: recovery.phase,
      safe: true,
      reason: "tool_operation_completed",
      operationKey,
      operation
    };
  }
  const idempotency = String(operation.value?.metadata?.idempotency || "unknown");
  if (operation.status === "started" && ["safe", "retry_safe"].includes(idempotency)) {
    return {
      action: "resume_tool",
      phase: recovery.phase,
      safe: true,
      reason: `tool_operation_${idempotency}`,
      operationKey,
      operation
    };
  }
  return {
    ...recovery,
    operationKey,
    operationState: String(operation.status || "unknown"),
    idempotency,
    reason: "tool_operation_effect_unknown"
  };
}

export function createAgentRunJournal(store, metadata) {
  const runId = String(metadata?.runId || "").trim();
  if (!runId) throw new Error("Agent run journal requires runId.");
  let queue = Promise.resolve();
  let lastError = null;
  const ownerId = String(metadata?.ownerId || `worker-${crypto.randomUUID()}`);
  let lastHeartbeatAt = 0;
  let terminalCommitted = false;
  let closePromise = null;

  const enqueue = (operation) => {
    queue = queue
      .then(async () => {
        lastError = null;
        await operation();
      })
      .catch((error) => {
        lastError = error;
        console.warn("WebClaw Agent RunStore write failed", error);
      });
    return queue;
  };

  return {
    runId,
    ownerId,
    get terminalCommitted() {
      return terminalCommitted;
    },

    async start() {
      const acquired = await store.claimRun({
        ...sanitizeAgentRunValue(metadata),
        runId,
        status: "running"
      }, ownerId);
      if (!acquired) throw new Error(`Agent run lease is already held: ${runId}`);
      lastHeartbeatAt = Date.now();
    },

    append(type, payload = {}) {
      return enqueue(() => store.appendEvent(runId, {
        type: String(type || "unknown"),
        timestamp: Number(payload.timestamp || Date.now()),
        payload: sanitizeAgentRunValue(payload)
      }, ownerId));
    },

    async checkpoint(checkpoint) {
      await enqueue(() => store.saveCheckpoint(
        runId,
        sanitizeAgentRunValue(checkpoint),
        ownerId
      ));
      if (lastError) throw lastError;
    },

    heartbeat() {
      const now = Date.now();
      if (now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return queue;
      lastHeartbeatAt = now;
      return enqueue(() => store.renewLease(runId, ownerId));
    },

    close(status, summary = {}) {
      if (terminalCommitted) return queue;
      if (closePromise) return closePromise;
      closePromise = enqueue(async () => {
        await store.completeRun(
          runId,
          normalizeRunStatus(status),
          sanitizeAgentRunValue(summary),
          ownerId
        );
        terminalCommitted = true;
      }).finally(() => {
        if (!terminalCommitted) closePromise = null;
      });
      return closePromise;
    },

    async flush() {
      await queue;
      if (lastError) throw lastError;
      return { ok: true };
    }
  };
}

export function sanitizeAgentRunValue(value, depth = 0, maxStringLength = 20000) {
  if (depth > 12) return "[depth limit]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const redacted = redactSensitiveText(value);
    return redacted.length > maxStringLength
      ? `${redacted.slice(0, maxStringLength)}\n... truncated ${redacted.length - maxStringLength} chars`
      : redacted;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((entry) => sanitizeAgentRunValue(entry, depth + 1, maxStringLength));
  }
  if (typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key)
        ? "[redacted]"
        : sanitizeAgentRunValue(entry, depth + 1, maxStringLength);
    }
    return result;
  }
  return String(value);
}

function redactSensitiveText(value) {
  return String(value || "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{12,}|gh[opusr]_[A-Za-z0-9]{12,})\b/g, "[redacted credential]")
    .replace(/(https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=)[^\s"'&]+/gi, "$1[redacted]")
    .replace(/("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)"?\s*[:=]\s*["'])[^"'\s]+/gi, "$1[redacted]");
}

function createIndexedDbRunStore(indexedDb, databaseName) {
  let databasePromise;
  const database = () => {
    if (!databasePromise) databasePromise = openDatabase(indexedDb, databaseName);
    return databasePromise;
  };

  return {
    async claimRun(metadata, ownerId, ttlMs = DEFAULT_LEASE_TTL_MS) {
      const db = await database();
      const transaction = db.transaction(RUNS_STORE, "readwrite");
      const store = transaction.objectStore(RUNS_STORE);
      const existing = await requestResult(store.get(metadata.runId));
      const now = Date.now();
      if (
        TERMINAL_STATUSES.has(existing?.status) ||
        (existing?.lease?.ownerId && Number(existing.lease.expiresAt || 0) > now && existing.lease.ownerId !== ownerId)
      ) {
        await transactionDone(transaction);
        return false;
      }
      store.put({
        ...(existing || {}),
        ...metadata,
        id: metadata.runId,
        runId: metadata.runId,
        status: "running",
        lease: leaseValue(ownerId, now, ttlMs),
        createdAt: Number(existing?.createdAt || metadata.createdAt || now),
        updatedAt: now,
        lastSequence: Number(existing?.lastSequence || 0)
      });
      await transactionDone(transaction);
      return true;
    },

    async startRun(metadata) {
      const db = await database();
      const transaction = db.transaction(RUNS_STORE, "readwrite");
      const store = transaction.objectStore(RUNS_STORE);
      const existing = await requestResult(store.get(metadata.runId));
      const now = Date.now();
      if (hasActiveLease(existing)) {
        transaction.abort();
        throw new Error(`Agent run lease is already held: ${metadata.runId}`);
      }
      store.put({
        ...(existing || {}),
        ...metadata,
        id: metadata.runId,
        runId: metadata.runId,
        status: "running",
        createdAt: Number(existing?.createdAt || metadata.createdAt || now),
        updatedAt: now,
        lastSequence: Number(existing?.lastSequence || 0)
      });
      await transactionDone(transaction);
    },

    async acquireLease(runId, ownerId, ttlMs = DEFAULT_LEASE_TTL_MS) {
      const db = await database();
      const transaction = db.transaction(RUNS_STORE, "readwrite");
      const store = transaction.objectStore(RUNS_STORE);
      const run = await requestResult(store.get(runId));
      if (!run) throw new Error(`Agent run not found: ${runId}`);
      const now = Date.now();
      if (run.lease?.ownerId && Number(run.lease.expiresAt || 0) > now && run.lease.ownerId !== ownerId) {
        await transactionDone(transaction);
        return false;
      }
      store.put({
        ...run,
        lease: { ownerId, heartbeatAt: now, expiresAt: now + positiveInteger(ttlMs, DEFAULT_LEASE_TTL_MS) },
        updatedAt: now
      });
      await transactionDone(transaction);
      return true;
    },

    async renewLease(runId, ownerId, ttlMs = DEFAULT_LEASE_TTL_MS) {
      const db = await database();
      const transaction = db.transaction(RUNS_STORE, "readwrite");
      const store = transaction.objectStore(RUNS_STORE);
      const run = await requestResult(store.get(runId));
      if (!run || run.lease?.ownerId !== ownerId) {
        transaction.abort();
        throw new Error(`Agent run lease was lost: ${runId}`);
      }
      const now = Date.now();
      store.put({
        ...run,
        lease: { ownerId, heartbeatAt: now, expiresAt: now + positiveInteger(ttlMs, DEFAULT_LEASE_TTL_MS) },
        updatedAt: now
      });
      await transactionDone(transaction);
    },

    async appendEvent(runId, event, ownerId) {
      const db = await database();
      const transaction = db.transaction([RUNS_STORE, EVENTS_STORE], "readwrite");
      const runs = transaction.objectStore(RUNS_STORE);
      const events = transaction.objectStore(EVENTS_STORE);
      const run = await requestResult(runs.get(runId));
      if (!run) throw new Error(`Agent run not found: ${runId}`);
      assertRunLease(run, ownerId);
      const sequence = Number(run.lastSequence || 0) + 1;
      const timestamp = Number(event.timestamp || Date.now());
      events.put({
        id: eventKey(runId, sequence),
        runId,
        sequence,
        timestamp,
        type: event.type,
        payload: event.payload || {}
      });
      runs.put({ ...run, lastSequence: sequence, updatedAt: timestamp });
      await transactionDone(transaction);
      return sequence;
    },

    async saveCheckpoint(runId, checkpoint, ownerId, ttlMs = DEFAULT_LEASE_TTL_MS) {
      const db = await database();
      const transaction = db.transaction(RUNS_STORE, "readwrite");
      const store = transaction.objectStore(RUNS_STORE);
      const run = await requestResult(store.get(runId));
      if (!run) throw new Error(`Agent run not found: ${runId}`);
      assertRunLease(run, ownerId);
      const now = Date.now();
      store.put({
        ...run,
        status: "waiting",
        lease: leaseValue(ownerId, now, ttlMs),
        checkpoint: {
          ...(run.checkpoint || {}),
          ...checkpoint,
          savedAt: now,
          sequence: Number(run.lastSequence || 0)
        },
        updatedAt: now
      });
      await transactionDone(transaction);
    },

    async completeRun(runId, status, summary = {}, ownerId = "") {
      const db = await database();
      const transaction = db.transaction(RUNS_STORE, "readwrite");
      const store = transaction.objectStore(RUNS_STORE);
      const run = await requestResult(store.get(runId));
      if (!run) throw new Error(`Agent run not found: ${runId}`);
      if (!ownerId || run.lease?.ownerId !== ownerId) {
        transaction.abort();
        throw new Error(`Agent run lease was lost: ${runId}`);
      }
      const now = Date.now();
      store.put({
        ...run,
        status: normalizeRunStatus(status),
        summary,
        lease: null,
        updatedAt: now,
        completedAt: TERMINAL_STATUSES.has(status) ? now : null
      });
      await transactionDone(transaction);
    },

    async getRun(runId, options = {}) {
      const db = await database();
      const transaction = db.transaction([RUNS_STORE, EVENTS_STORE], "readonly");
      const run = await requestResult(transaction.objectStore(RUNS_STORE).get(runId));
      if (!run || options.includeEvents === false) {
        await transactionDone(transaction);
        return run || null;
      }
      const events = await requestResult(
        transaction.objectStore(EVENTS_STORE).index("runId").getAll(runId)
      );
      await transactionDone(transaction);
      return { ...run, events: events.sort((a, b) => a.sequence - b.sequence) };
    },

    async listRecoverableRuns() {
      const db = await database();
      const transaction = db.transaction(RUNS_STORE, "readonly");
      const runs = await requestResult(transaction.objectStore(RUNS_STORE).getAll());
      await transactionDone(transaction);
      return runs
        .filter((run) => !TERMINAL_STATUSES.has(run.status) && run.checkpoint && !hasActiveLease(run))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    },

    async getOperation(key) {
      const db = await database();
      const transaction = db.transaction(OPERATIONS_STORE, "readonly");
      const operation = await requestResult(transaction.objectStore(OPERATIONS_STORE).get(key));
      await transactionDone(transaction);
      return operation || null;
    },

    async startOperation(key, value, ownerId) {
      const db = await database();
      const transaction = db.transaction([RUNS_STORE, OPERATIONS_STORE], "readwrite");
      const run = await requestResult(transaction.objectStore(RUNS_STORE).get(operationRunId(key)));
      if (!run) throw new Error(`Agent run not found: ${operationRunId(key)}`);
      assertRunLease(run, ownerId);
      transaction.objectStore(OPERATIONS_STORE).put({
        key,
        runId: operationRunId(key),
        status: "started",
        value: sanitizeAgentRunValue(value),
        updatedAt: Date.now()
      });
      await transactionDone(transaction);
    },

    async completeOperation(key, value, ownerId) {
      const db = await database();
      const transaction = db.transaction([RUNS_STORE, OPERATIONS_STORE], "readwrite");
      const run = await requestResult(transaction.objectStore(RUNS_STORE).get(operationRunId(key)));
      if (!run) throw new Error(`Agent run not found: ${operationRunId(key)}`);
      assertRunLease(run, ownerId);
      transaction.objectStore(OPERATIONS_STORE).put({
        key,
        runId: operationRunId(key),
        status: "completed",
        value: sanitizeAgentRunValue(value),
        updatedAt: Date.now()
      });
      await transactionDone(transaction);
    },

    async putArtifact(artifact) {
      const db = await database();
      const transaction = db.transaction(ARTIFACTS_STORE, "readwrite");
      const id = String(artifact.id || `artifact-${crypto.randomUUID()}`);
      transaction.objectStore(ARTIFACTS_STORE).put({
        ...artifact,
        id,
        value: sanitizeAgentRunValue(artifact.value, 0, 2_000_000),
        createdAt: Number(artifact.createdAt || Date.now())
      });
      await transactionDone(transaction);
      return id;
    },

    async getArtifact(id) {
      const db = await database();
      const transaction = db.transaction(ARTIFACTS_STORE, "readonly");
      const artifact = await requestResult(transaction.objectStore(ARTIFACTS_STORE).get(id));
      await transactionDone(transaction);
      return artifact || null;
    },

    async deleteRunsForSession(sessionId) {
      const db = await database();
      const transaction = db.transaction(RUNS_STORE, "readonly");
      const runs = await requestResult(transaction.objectStore(RUNS_STORE).getAll());
      await transactionDone(transaction);
      const matching = runs.filter((run) => run.sessionId === String(sessionId || ""));
      if (matching.some(hasActiveLease)) throw new Error("Stop the active Agent run before clearing this session.");
      const ids = matching.map((run) => run.runId);
      for (const runId of ids) await deleteIndexedRun(db, runId);
      return ids.length;
    }
  };
}

function createMemoryRunStore() {
  const runs = new Map();
  const events = new Map();
  const operations = new Map();
  return {
    async claimRun(metadata, ownerId, ttlMs = DEFAULT_LEASE_TTL_MS) {
      const existing = runs.get(metadata.runId);
      const now = Date.now();
      if (
        TERMINAL_STATUSES.has(existing?.status) ||
        (existing?.lease?.ownerId && Number(existing.lease.expiresAt || 0) > now && existing.lease.ownerId !== ownerId)
      ) return false;
      runs.set(metadata.runId, {
        ...(existing || {}),
        ...cloneValue(metadata),
        id: metadata.runId,
        runId: metadata.runId,
        status: "running",
        lease: leaseValue(ownerId, now, ttlMs),
        createdAt: Number(existing?.createdAt || metadata.createdAt || now),
        updatedAt: now,
        lastSequence: Number(existing?.lastSequence || 0)
      });
      return true;
    },
    async startRun(metadata) {
      const existing = runs.get(metadata.runId);
      const now = Date.now();
      if (hasActiveLease(existing)) throw new Error(`Agent run lease is already held: ${metadata.runId}`);
      runs.set(metadata.runId, {
        ...(existing || {}),
        ...cloneValue(metadata),
        id: metadata.runId,
        runId: metadata.runId,
        status: "running",
        createdAt: Number(existing?.createdAt || metadata.createdAt || now),
        updatedAt: now,
        lastSequence: Number(existing?.lastSequence || 0)
      });
    },
    async acquireLease(runId, ownerId, ttlMs = DEFAULT_LEASE_TTL_MS) {
      const run = requiredMemoryRun(runs, runId);
      const now = Date.now();
      if (run.lease?.ownerId && Number(run.lease.expiresAt || 0) > now && run.lease.ownerId !== ownerId) return false;
      runs.set(runId, {
        ...run,
        lease: { ownerId, heartbeatAt: now, expiresAt: now + positiveInteger(ttlMs, DEFAULT_LEASE_TTL_MS) },
        updatedAt: now
      });
      return true;
    },
    async renewLease(runId, ownerId, ttlMs = DEFAULT_LEASE_TTL_MS) {
      const run = requiredMemoryRun(runs, runId);
      if (run.lease?.ownerId !== ownerId) throw new Error(`Agent run lease was lost: ${runId}`);
      const now = Date.now();
      runs.set(runId, {
        ...run,
        lease: { ownerId, heartbeatAt: now, expiresAt: now + positiveInteger(ttlMs, DEFAULT_LEASE_TTL_MS) },
        updatedAt: now
      });
    },
    async appendEvent(runId, event, ownerId) {
      const run = requiredMemoryRun(runs, runId);
      assertRunLease(run, ownerId);
      const sequence = Number(run.lastSequence || 0) + 1;
      const timestamp = Number(event.timestamp || Date.now());
      const list = events.get(runId) || [];
      list.push({ id: eventKey(runId, sequence), runId, sequence, timestamp, ...cloneValue(event) });
      events.set(runId, list);
      runs.set(runId, { ...run, lastSequence: sequence, updatedAt: timestamp });
      return sequence;
    },
    async saveCheckpoint(runId, checkpoint, ownerId, ttlMs = DEFAULT_LEASE_TTL_MS) {
      const run = requiredMemoryRun(runs, runId);
      assertRunLease(run, ownerId);
      const now = Date.now();
      runs.set(runId, {
        ...run,
        status: "waiting",
        lease: leaseValue(ownerId, now, ttlMs),
        checkpoint: {
          ...(run.checkpoint || {}),
          ...cloneValue(checkpoint),
          savedAt: now,
          sequence: run.lastSequence
        },
        updatedAt: now
      });
    },
    async completeRun(runId, status, summary = {}, ownerId = "") {
      const run = requiredMemoryRun(runs, runId);
      if (!ownerId || run.lease?.ownerId !== ownerId) {
        throw new Error(`Agent run lease was lost: ${runId}`);
      }
      const now = Date.now();
      runs.set(runId, {
        ...run,
        status: normalizeRunStatus(status),
        summary: cloneValue(summary),
        lease: null,
        updatedAt: now,
        completedAt: TERMINAL_STATUSES.has(status) ? now : null
      });
    },
    async getRun(runId, options = {}) {
      const run = runs.get(runId);
      if (!run) return null;
      return cloneValue(options.includeEvents === false
        ? run
        : { ...run, events: events.get(runId) || [] });
    },
    async listRecoverableRuns() {
      return [...runs.values()]
        .filter((run) => !TERMINAL_STATUSES.has(run.status) && run.checkpoint && !hasActiveLease(run))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .map(cloneValue);
    },
    async getOperation(key) {
      return cloneValue(operations.get(key) || null);
    },
    async startOperation(key, value, ownerId) {
      assertRunLease(requiredMemoryRun(runs, operationRunId(key)), ownerId);
      operations.set(key, {
        key,
        runId: operationRunId(key),
        status: "started",
        value: sanitizeAgentRunValue(value),
        updatedAt: Date.now()
      });
    },
    async completeOperation(key, value, ownerId) {
      assertRunLease(requiredMemoryRun(runs, operationRunId(key)), ownerId);
      operations.set(key, {
        key,
        runId: operationRunId(key),
        status: "completed",
        value: sanitizeAgentRunValue(value),
        updatedAt: Date.now()
      });
    },
    async putArtifact(artifact) {
      const id = String(artifact.id || `artifact-${crypto.randomUUID()}`);
      operations.set(`artifact:${id}`, {
        ...cloneValue(artifact),
        id,
        value: sanitizeAgentRunValue(artifact.value, 0, 2_000_000),
        createdAt: Number(artifact.createdAt || Date.now())
      });
      return id;
    },
    async getArtifact(id) {
      return cloneValue(operations.get(`artifact:${id}`) || null);
    },
    async deleteRunsForSession(sessionId) {
      const matching = [...runs.values()].filter((run) => run.sessionId === String(sessionId || ""));
      if (matching.some(hasActiveLease)) throw new Error("Stop the active Agent run before clearing this session.");
      const ids = matching.map((run) => run.runId);
      for (const runId of ids) {
        runs.delete(runId);
        events.delete(runId);
        for (const [key, value] of operations.entries()) {
          if (value?.runId === runId) operations.delete(key);
        }
      }
      return ids.length;
    }
  };
}

function openDatabase(indexedDb, databaseName) {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(databaseName, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RUNS_STORE)) {
        const runs = db.createObjectStore(RUNS_STORE, { keyPath: "id" });
        runs.createIndex("status", "status", { unique: false });
        runs.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const events = db.createObjectStore(EVENTS_STORE, { keyPath: "id" });
        events.createIndex("runId", "runId", { unique: false });
      }
      if (!db.objectStoreNames.contains(OPERATIONS_STORE)) {
        const operations = db.createObjectStore(OPERATIONS_STORE, { keyPath: "key" });
        operations.createIndex("runId", "runId", { unique: false });
        operations.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains(ARTIFACTS_STORE)) {
        const artifacts = db.createObjectStore(ARTIFACTS_STORE, { keyPath: "id" });
        artifacts.createIndex("runId", "runId", { unique: false });
        artifacts.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open Agent RunStore."));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Agent RunStore request failed."));
  });
}

async function deleteIndexedRun(db, runId) {
  const transaction = db.transaction(
    [RUNS_STORE, EVENTS_STORE, OPERATIONS_STORE, ARTIFACTS_STORE],
    "readwrite"
  );
  transaction.objectStore(RUNS_STORE).delete(runId);
  await Promise.all([
    deleteIndexMatches(transaction.objectStore(EVENTS_STORE).index("runId"), runId),
    deleteIndexMatches(transaction.objectStore(OPERATIONS_STORE).index("runId"), runId),
    deleteIndexMatches(transaction.objectStore(ARTIFACTS_STORE).index("runId"), runId)
  ]);
  await transactionDone(transaction);
}

function deleteIndexMatches(index, key) {
  return new Promise((resolve, reject) => {
    const request = index.openCursor(key);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error("Agent RunStore delete cursor failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Agent RunStore transaction aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("Agent RunStore transaction failed."));
  });
}

function eventKey(runId, sequence) {
  return `${runId}:${String(sequence).padStart(10, "0")}`;
}

function operationRunId(key) {
  return String(key || "").split(":")[0] || "";
}

function normalizeRunStatus(status) {
  const value = String(status || "waiting");
  return ["running", "waiting", "completed", "failed", "interrupted", "cancelled"].includes(value)
    ? value
    : "waiting";
}

function hasActiveLease(run) {
  return Boolean(run?.lease?.ownerId && Number(run.lease.expiresAt || 0) > Date.now());
}

function assertRunLease(run, ownerId) {
  if (!ownerId || run?.lease?.ownerId !== ownerId) {
    throw new Error(`Agent run lease was lost: ${run?.runId || run?.id || "unknown"}`);
  }
}

function leaseValue(ownerId, now, ttlMs) {
  if (!String(ownerId || "")) throw new Error("Agent run lease owner is required.");
  return {
    ownerId,
    heartbeatAt: now,
    expiresAt: now + positiveInteger(ttlMs, DEFAULT_LEASE_TTL_MS)
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}

function requiredMemoryRun(runs, runId) {
  const run = runs.get(runId);
  if (!run) throw new Error(`Agent run not found: ${runId}`);
  return run;
}

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
