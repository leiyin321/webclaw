import { generateDocx } from "../document-engines/docx-engine.js";
import { generatePdf } from "../document-engines/pdf-engine.js";
import { generatePptx } from "../document-engines/pptx-engine.js";
import { generateXlsx } from "../document-engines/xlsx-engine.js";

const engines = { docx: generateDocx, pdf: generatePdf, pptx: generatePptx, xlsx: generateXlsx };
const sandboxHost = window.parent;
const cancelled = new Set();

window.addEventListener("message", async (event) => {
  if (event.source !== sandboxHost) return;
  if (event.data?.type === "WEBCLAW_DOCUMENT_SANDBOX_CANCEL") {
    cancelled.add(String(event.data.requestId || ""));
    return;
  }
  if (event.data?.type !== "WEBCLAW_DOCUMENT_SANDBOX_GENERATE") return;
  const requestId = String(event.data.requestId || "");
  try {
    throwIfCancelled(requestId);
    const format = String(event.data.format || "").toLowerCase();
    const engine = engines[format];
    if (!engine) throw new Error(`Unsupported document engine: ${format || "unknown"}`);
    const assets = new Map((event.data.assets || []).map((asset) => [String(asset.path), asset.blob]));
    const generated = await engine(event.data.spec || {}, {
      resolveAsset: async (path) => {
        throwIfCancelled(requestId);
        const blob = assets.get(String(path));
        if (!(blob instanceof Blob)) throw new Error(`Document asset was not supplied: ${path}`);
        return { data: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type || "application/octet-stream" };
      }
    });
    throwIfCancelled(requestId);
    sandboxHost.postMessage({ type: "WEBCLAW_DOCUMENT_SANDBOX_RESULT", requestId, ok: true, blob: generated.blob, warnings: generated.warnings || [], fidelity: generated.fidelity || "rich" }, "*");
  } catch (error) {
    sandboxHost.postMessage({ type: "WEBCLAW_DOCUMENT_SANDBOX_RESULT", requestId, ok: false, error: error instanceof Error ? error.message : String(error) }, "*");
  } finally {
    cancelled.delete(requestId);
  }
});

function throwIfCancelled(requestId) {
  if (cancelled.has(requestId)) {
    const error = new Error("Document generation was stopped.");
    error.name = "AbortError";
    throw error;
  }
}

sandboxHost.postMessage({ type: "WEBCLAW_DOCUMENT_SANDBOX_READY" }, "*");
