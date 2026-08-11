import { renderMarkdown } from "./markdown.js";

const params = new URLSearchParams(location.search);
const path = params.get("path") || "";
const content = document.querySelector("#content");
const header = document.querySelector("#header");
const pathLabel = document.querySelector("#path");
const status = document.querySelector("#status");

pathLabel.textContent = path;
header.hidden = false;

try {
  if (!path.startsWith("/") || !/\.(?:md|markdown|mdown|mkdn|docx|xlsx|pptx|pdf)$/i.test(path)) {
    throw new Error("This document format cannot be opened in the document viewer.");
  }
  const response = await chrome.runtime.sendMessage({ type: "WEBCLAW_DOCUMENT_READ_VIEW", path });
  if (!response?.ok) throw new Error(response?.error || "Unable to read the document.");
  const result = response.result;
  content.replaceChildren();
  const parsed = new DOMParser().parseFromString(renderMarkdown(result.content, { title: path.split("/").at(-1) }), "text/html");
  for (const node of [...parsed.body.childNodes]) content.append(node.cloneNode(true));
  const style = parsed.querySelector("style");
  if (style) document.head.append(style.cloneNode(true));
  status.textContent = result.truncated ? `${result.format.toUpperCase()} projection truncated` : `${result.format.toUpperCase()} projection ready`;
  document.title = path.split("/").at(-1) || "Document";
} catch (error) {
  content.className = "error";
  content.textContent = `Unable to preview ${path || "document"}:\n${error.message || error}`;
  status.textContent = "Error";
}
