const previewHost = window.opener || (window.parent !== window ? window.parent : null);

window.addEventListener("message", (event) => {
  if (!previewHost || event.source !== previewHost) return;
  if (event.data?.type === "WEBCLAW_PREVIEW_ERROR") {
    document.querySelector("#status").textContent = `Preview failed: ${String(event.data.error || "Unknown error")}`;
    return;
  }
  if (event.data?.type !== "WEBCLAW_RENDER_PREVIEW" || typeof event.data.html !== "string") return;
  document.open();
  document.write(event.data.html);
  document.close();
});

previewHost?.postMessage({ type: "WEBCLAW_PREVIEW_READY" }, "*");
