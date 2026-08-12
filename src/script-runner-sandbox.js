(() => {
  const runs = new Map();

  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data || {};
    if (message.type === "WEBCLAW_SCRIPT_SANDBOX_EXECUTE") execute(message);
    if (message.type === "WEBCLAW_SCRIPT_SANDBOX_RPC_RESULT") settleRpc(message);
    if (message.type === "WEBCLAW_SCRIPT_SANDBOX_CANCEL") cancel(message.requestId, message.error || "Script execution was cancelled.");
  });

  function execute(message) {
    const requestId = String(message.requestId || "");
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(requestId) || runs.has(requestId)) return;
    const source = workerSource(requestId, String(message.code || ""));
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    let worker;
    try {
      worker = new Worker(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      postResult(requestId, false, null, error);
      return;
    }
    URL.revokeObjectURL(url);
    const run = { requestId, worker };
    runs.set(requestId, run);
    worker.onmessage = (event) => handleWorkerMessage(run, event.data || {});
    worker.onerror = (event) => {
      event.preventDefault();
      finish(requestId, false, null, event.error || new Error(event.message || "Script syntax error."));
    };
    worker.postMessage({
      type: "START",
      runtime: String(message.runtime || ""),
      input: cloneValue(message.input)
    });
  }

  function handleWorkerMessage(run, message) {
    if (!runs.has(run.requestId)) return;
    if (message.type === "RPC") {
      parent.postMessage({
        type: "WEBCLAW_SCRIPT_SANDBOX_RPC",
        requestId: run.requestId,
        callId: String(message.callId || ""),
        path: String(message.path || ""),
        args: cloneValue(message.args)
      }, "*");
      return;
    }
    if (message.type === "RESULT") {
      finish(run.requestId, message.ok === true, message.result, message.error);
    }
  }

  function settleRpc(message) {
    const run = runs.get(String(message.requestId || ""));
    if (!run) return;
    run.worker.postMessage({
      type: "RPC_RESULT",
      callId: String(message.callId || ""),
      ok: message.ok === true,
      result: cloneValue(message.result),
      error: String(message.error || "Script RPC failed.")
    });
  }

  function cancel(requestId, error) {
    const id = String(requestId || "");
    if (!runs.has(id)) return;
    finish(id, false, null, new Error(String(error)));
  }

  function finish(requestId, ok, result, error) {
    const run = runs.get(requestId);
    if (!run) return;
    runs.delete(requestId);
    run.worker.terminate();
    postResult(requestId, ok, result, error);
  }

  function postResult(requestId, ok, result, error) {
    const payload = { type: "WEBCLAW_SCRIPT_SANDBOX_RESULT", requestId, ok };
    if (ok) payload.result = cloneValue(result);
    else payload.error = error instanceof Error ? error.message : String(error || "Script execution failed.");
    try {
      parent.postMessage(payload, "*");
    } catch {
      parent.postMessage({ ...payload, ok: false, result: undefined, error: "Script result is not serializable." }, "*");
    }
  }

  function cloneValue(value) {
    if (value === undefined) return null;
    try {
      return structuredClone(value);
    } catch {
      return String(value);
    }
  }

  function workerSource(requestId, code) {
    return `
const rpcRequests = new Map();
let rpcSequence = 0;

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "START") start(message);
  if (message.type === "RPC_RESULT") settleRpc(message);
};

async function start(message) {
  const input = message.input;
  const rpc = createRpc();
  const runtime = String(message.runtime || "");
  const webclaw = runtime === "extension" ? Object.freeze({
    vfs: createNamespaceProxy(rpc, "vfs"),
    http: Object.freeze({ request: (...args) => rpc("http.request", args) }),
    chrome: createNamespaceProxy(rpc, "chrome")
  }) : undefined;
  try {
    const result = await (async (webclaw, input) => {
${code}
    })(webclaw, input);
    if (estimateValueSize(result) > 2000000) {
      throw new Error("Script result exceeds the 2,000,000 byte limit. Save large data to VFS and return a path instead.");
    }
    self.postMessage({ type: "RESULT", ok: true, result: cloneValue(result) });
  } catch (error) {
    self.postMessage({ type: "RESULT", ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function createNamespaceProxy(rpc, prefix) {
  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === "then") return undefined;
      const path = prefix + "." + String(property);
      return new Proxy((...args) => rpc(path, args), {
        get(_fn, nested) {
          if (nested === "then") return undefined;
          return (...args) => rpc(path + "." + String(nested), args);
        }
      });
    }
  });
}

function createRpc() {
  return (path, args) => new Promise((resolve, reject) => {
    const callId = "rpc-" + (++rpcSequence);
    rpcRequests.set(callId, { resolve, reject });
    self.postMessage({ type: "RPC", callId, path, args: cloneValue(args) });
  });
}

function settleRpc(message) {
  const pending = rpcRequests.get(String(message.callId || ""));
  if (!pending) return;
  rpcRequests.delete(String(message.callId));
  if (message.ok) pending.resolve(message.result);
  else pending.reject(new Error(String(message.error || "Script RPC failed.")));
}

function cloneValue(value) {
  if (value === undefined) return null;
  try { return structuredClone(value); } catch { return String(value); }
}

function estimateValueSize(value, seen = new Set()) {
  if (value === null || value === undefined) return 4;
  if (typeof value === "string") return new TextEncoder().encode(value).byteLength;
  if (["number", "boolean", "bigint"].includes(typeof value)) return 16;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof Blob) return value.size;
  if (typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);
  let total = 0;
  const entries = value instanceof Map
    ? [...value.entries()]
    : value instanceof Set
      ? [...value].map((item, index) => [String(index), item])
      : Object.entries(value);
  for (const [key, item] of entries) {
    total += String(key).length + estimateValueSize(item, seen);
    if (total > 2000000) return total;
  }
  return total;
}

//# sourceURL=webclaw-run-${requestId}.js
`;
  }

  parent.postMessage({ type: "WEBCLAW_SCRIPT_SANDBOX_READY" }, "*");
})();
