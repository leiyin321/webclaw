import { buildVfsPreviewDocument } from "./vfs-preview.js";

const frame = document.querySelector("#preview");
const path = new URLSearchParams(location.search).get("path") || "";
const namespace = `preview:${parentPath(path)}`;
const storageKey = `webclawPreviewLocalStorage:${namespace}`;
let payload = null;
let ready = false;

window.addEventListener("message", async (event) => {
  if (event.source !== frame.contentWindow) return;
  if (event.data?.type === "WEBCLAW_PREVIEW_READY") {
    ready = true;
    deliver();
    return;
  }
  if (event.data?.type !== "WEBCLAW_PREVIEW_STORAGE_SET" || event.data.namespace !== namespace) return;
  const stored = await chrome.storage.local.get(storageKey);
  const values = stored[storageKey] && typeof stored[storageKey] === "object" ? stored[storageKey] : {};
  if (event.data.action === "clear") await chrome.storage.local.set({ [storageKey]: {} });
  else {
    if (event.data.action === "remove") delete values[String(event.data.key || "")];
    else values[String(event.data.key || "")] = String(event.data.value ?? "");
    await chrome.storage.local.set({ [storageKey]: values });
  }
});

try {
  const stored = await chrome.storage.local.get(storageKey);
  const html = await buildVfsPreviewDocument(path, {
    storageNamespace: namespace,
    localStorage: stored[storageKey] && typeof stored[storageKey] === "object" ? stored[storageKey] : {}
  });
  payload = { type: "WEBCLAW_RENDER_PREVIEW", entryPath: path, html };
  document.title = `${path.split("/").pop() || "Preview"} - WebClaw`;
} catch (error) {
  payload = { type: "WEBCLAW_PREVIEW_ERROR", entryPath: path, error: error?.message || String(error) };
}
deliver();

function deliver() {
  if (ready && payload) frame.contentWindow.postMessage(payload, "*");
}

function parentPath(value) {
  const parts = String(value || "/").split("/").filter(Boolean);
  parts.pop();
  return `/${parts.join("/")}` || "/";
}
