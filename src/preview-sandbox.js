window.addEventListener("message", (event) => {
  if (event.source !== window.opener) return;
  if (event.data?.type === "WEBCLAW_PREVIEW_ERROR") {
    document.querySelector("#status").textContent = `Preview failed: ${String(event.data.error || "Unknown error")}`;
    return;
  }
  if (event.data?.type !== "WEBCLAW_RENDER_PREVIEW" || typeof event.data.html !== "string") return;
  document.open();
  document.write(event.data.html);
  document.close();
});

if (window.opener) {
  window.opener.postMessage({ type: "WEBCLAW_PREVIEW_READY" }, "*");
}
