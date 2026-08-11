const frame = document.getElementById("script-runner-sandbox");
const pending = new Map();
let sandboxReady = false;
let readyResolve;
const readyPromise = new Promise((resolve) => { readyResolve = resolve; });

window.addEventListener("message", (event) => {
  if (event.source !== frame?.contentWindow) return;
  const message = event.data || {};
  if (message.type === "WEBCLAW_SCRIPT_SANDBOX_READY") {
    sandboxReady = true;
    readyResolve();
    return;
  }
  if (message.type === "WEBCLAW_SCRIPT_SANDBOX_RPC") {
    forwardRpc(message);
    return;
  }
  if (message.type !== "WEBCLAW_SCRIPT_SANDBOX_RESULT") return;
  const request = pending.get(String(message.requestId || ""));
  if (!request) return;
  pending.delete(String(message.requestId));
  clearTimeout(request.timer);
  request.resolve(message.ok
    ? { ok: true, result: message.result }
    : { ok: false, error: String(message.error || "Script execution failed.") });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "WEBCLAW_SCRIPT_EXECUTE") {
    execute(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === "WEBCLAW_SCRIPT_CANCEL") {
    frame?.contentWindow?.postMessage({ type: "WEBCLAW_SCRIPT_SANDBOX_CANCEL", requestId: message.requestId, error: message.error }, "*");
    return false;
  }
  return false;
});

async function execute(message) {
  await waitForSandbox();
  const requestId = String(message.requestId || "");
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw new Error("Invalid script execution request ID.");
  if (pending.has(requestId)) throw new Error("Duplicate script execution request ID.");
  return new Promise((resolve) => {
    const timeoutMs = Math.max(100, Math.min(120_000, Number(message.timeoutMs || 30_000)));
    const timer = setTimeout(() => {
      pending.delete(requestId);
      frame.contentWindow.postMessage({ type: "WEBCLAW_SCRIPT_SANDBOX_CANCEL", requestId, error: `Script timed out after ${timeoutMs} ms.` }, "*");
      resolve({ ok: false, error: `Script timed out after ${timeoutMs} ms.` });
    }, timeoutMs);
    pending.set(requestId, { resolve, timer });
    frame.contentWindow.postMessage({
      type: "WEBCLAW_SCRIPT_SANDBOX_EXECUTE",
      requestId,
      code: String(message.code || ""),
      input: message.input
    }, "*");
  });
}

async function forwardRpc(message) {
  const requestId = String(message.requestId || "");
  if (!pending.has(requestId)) return;
  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: "WEBCLAW_SCRIPT_RPC",
      requestId,
      callId: String(message.callId || ""),
      path: String(message.path || ""),
      args: message.args
    });
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  frame.contentWindow.postMessage({
    type: "WEBCLAW_SCRIPT_SANDBOX_RPC_RESULT",
    requestId,
    callId: String(message.callId || ""),
    ok: response?.ok === true,
    result: response?.result,
    error: response?.error || "Script RPC failed."
  }, "*");
}

async function waitForSandbox() {
  if (!frame?.contentWindow) throw new Error("Script runner sandbox iframe is unavailable.");
  if (sandboxReady) return;
  await Promise.race([
    readyPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Script runner sandbox did not become ready.")), 15_000))
  ]);
}
