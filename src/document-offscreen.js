import { deleteDocumentArtifact, putDocumentArtifact } from "./document-artifact-store.js";
import { collectAssetPaths } from "./document-core/rich-document.js";
import { normalizeDocumentImageAsset } from "./document-image.js";
import { vfsGetFileBlob, vfsStat } from "./virtual-file-system.js";

const frame = document.querySelector("#document-engine-sandbox");
const pending = new Map();
const cancelled = new Set();
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 25 * 1024 * 1024;
let sandboxReady = false;
let readyResolve;
const readyPromise = new Promise((resolve) => { readyResolve = resolve; });

window.addEventListener("message", (event) => {
  if (event.source !== frame?.contentWindow) return;
  if (event.data?.type === "WEBCLAW_DOCUMENT_SANDBOX_READY") {
    sandboxReady = true;
    readyResolve();
    return;
  }
  if (event.data?.type !== "WEBCLAW_DOCUMENT_SANDBOX_RESULT") return;
  const request = pending.get(String(event.data.requestId || ""));
  if (!request) return;
  pending.delete(String(event.data.requestId || ""));
  clearTimeout(request.timer);
  if (event.data.ok) request.resolve(event.data);
  else request.reject(new Error(String(event.data.error || "Document sandbox generation failed.")));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WEBCLAW_DOCUMENT_CANCEL") {
    cancelDocumentGeneration(message.requestId);
    return false;
  }
  if (message?.type !== "WEBCLAW_DOCUMENT_GENERATE") return false;
  generateDocument(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    .finally(() => cancelled.delete(String(message.requestId || "")));
  return true;
});

async function generateDocument(message) {
  await waitForSandbox();
  const requestId = String(message.requestId || "");
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw new Error("Invalid document generation request ID.");
  throwIfDocumentGenerationCancelled(requestId);
  const assetPaths = collectAssetPaths(message.spec || {});
  const stats = await Promise.all(assetPaths.map(async (path) => ({ path, stat: await vfsStat(path) })));
  const totalBytes = stats.reduce((sum, item) => sum + Number(item.stat.entry.size || 0), 0);
  const oversized = stats.find((item) => Number(item.stat.entry.size || 0) > MAX_ASSET_BYTES);
  if (oversized) throw new Error(`Document asset exceeds ${MAX_ASSET_BYTES} bytes: ${oversized.path}`);
  if (totalBytes > MAX_TOTAL_ASSET_BYTES) throw new Error(`Document assets exceed the combined ${MAX_TOTAL_ASSET_BYTES} byte limit.`);
  const assets = await Promise.all(assetPaths.map(async (path) => {
    const blob = await vfsGetFileBlob(path);
    const normalized = await normalizeDocumentImageAsset(message.format, path, blob);
    return { path, blob: normalized.blob };
  }));
  throwIfDocumentGenerationCancelled(requestId);
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("Document generation timed out."));
    }, 120_000);
    pending.set(requestId, { resolve, reject, timer });
    frame.contentWindow.postMessage({ type: "WEBCLAW_DOCUMENT_SANDBOX_GENERATE", requestId, format: message.format, spec: message.spec, assets }, "*");
  });
  throwIfDocumentGenerationCancelled(requestId);
  const artifact = await putDocumentArtifact(requestId, result.blob, { format: message.format, warnings: result.warnings || [], fidelity: result.fidelity || "rich" });
  if (cancelled.has(requestId)) {
    await deleteDocumentArtifact(requestId);
    throw cancelledError();
  }
  cancelled.delete(requestId);
  return { artifactId: artifact.id, size: artifact.size, mimeType: artifact.mimeType, warnings: result.warnings || [], fidelity: result.fidelity || "rich" };
}

function cancelDocumentGeneration(value) {
  const requestId = String(value || "");
  if (!requestId) return;
  cancelled.add(requestId);
  setTimeout(() => cancelled.delete(requestId), 5 * 60 * 1000);
  deleteDocumentArtifact(requestId).catch(() => {});
  const request = pending.get(requestId);
  frame?.contentWindow?.postMessage({
    type: "WEBCLAW_DOCUMENT_SANDBOX_CANCEL",
    requestId
  }, "*");
  if (!request) return;
  pending.delete(requestId);
  clearTimeout(request.timer);
  request.reject(cancelledError());
}

function throwIfDocumentGenerationCancelled(requestId) {
  if (cancelled.has(requestId)) throw cancelledError();
}

function cancelledError() {
  const error = new Error("Document generation was stopped.");
  error.name = "AbortError";
  return error;
}

async function waitForSandbox() {
  if (!frame?.contentWindow) throw new Error("Document engine sandbox iframe is unavailable.");
  if (sandboxReady) return;
  await Promise.race([readyPromise, new Promise((_, reject) => setTimeout(() => reject(new Error("Document engine sandbox did not become ready.")), 15_000))]);
}
