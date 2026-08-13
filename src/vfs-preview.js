import { vfsGetFileBlob, vfsList } from "./virtual-file-system.js";

const MAX_PREVIEW_FILES = 2000;
const MAX_PREVIEW_TOTAL_BYTES = 50 * 1024 * 1024;

export async function buildVfsPreviewDocument(entryPath, options = {}) {
  const path = String(entryPath || "").trim();
  if (!/^\/[^\0]*\.(?:html?|xhtml|svg)$/i.test(path)) {
    throw new Error("Only HTML, HTM, XHTML, and SVG files can be previewed.");
  }
  const files = await collectFiles(parentPath(path));
  const resources = new Map(files.map((file) => [file.path, file]));
  const cache = new Map();
  for (const file of files.filter((item) => !isHtmlFile(item.path))) {
    await resourceUrl(file.path, resources, cache, new Set());
  }
  const result = await resourceUrl(path, resources, cache, new Set(), options);
  if (!result) throw new Error(`Entry file was not found: ${path}`);
  return result.content;
}

async function collectFiles(root) {
  const files = [];
  let fileCount = 0;
  let totalBytes = 0;
  async function visit(path) {
    const listing = await vfsList(path);
    for (const entry of listing.entries) {
      if (entry.path === "/.trash" || entry.path.startsWith("/.trash/")) continue;
      if (entry.type === "directory") await visit(entry.path);
      else {
        fileCount += 1;
        totalBytes += Number(entry.size || 0);
        if (fileCount > MAX_PREVIEW_FILES || totalBytes > MAX_PREVIEW_TOTAL_BYTES) {
          throw new Error(`Preview exceeds the safety limit of ${MAX_PREVIEW_FILES} files or ${MAX_PREVIEW_TOTAL_BYTES} bytes.`);
        }
        files.push({ path: entry.path, entry, blob: await vfsGetFileBlob(entry.path) });
      }
    }
  }
  await visit(root);
  return files;
}

async function resourceUrl(path, resources, cache, stack, options = {}) {
  if (cache.has(path)) return cache.get(path);
  const resource = resources.get(path);
  if (!resource) return "";
  if (stack.has(path)) throw new Error(`Circular preview resource dependency: ${path}`);
  const nextStack = new Set(stack).add(path);
  const mime = resource.entry.mimeType || mimeTypeFor(path);
  if (!isHtmlFile(path) && !isCssFile(path) && !isJavaScriptFile(path)) {
    const url = await blobUrl(resource.blob, mime);
    const result = { url, content: "" };
    cache.set(path, result);
    return result;
  }
  let text = await resource.blob.text();
  if (isCssFile(path)) text = await rewriteCss(text, path, resources, cache, nextStack, options);
  if (isJavaScriptFile(path)) text = await rewriteJavaScript(text, path, resources, cache, nextStack, options);
  if (isHtmlFile(path)) text = await rewriteHtml(text, path, resources, cache, nextStack, options);
  const result = { url: `data:${mime};charset=utf-8,${encodeURIComponent(text)}`, content: text };
  cache.set(path, result);
  return result;
}

async function rewriteHtml(source, path, resources, cache, stack, options) {
  const documentNode = new DOMParser().parseFromString(source, "text/html");
  for (const element of documentNode.querySelectorAll("[src], [href], [poster]")) {
    for (const attribute of ["src", "href", "poster"]) {
      if (!element.hasAttribute(attribute)) continue;
      const resolved = resolvePath(element.getAttribute(attribute), path);
      if (!resolved) continue;
      const resource = await resourceUrl(resolved, resources, cache, stack, options);
      if (resource) element.setAttribute(attribute, resource.url);
    }
  }
  for (const element of documentNode.querySelectorAll("[style]")) {
    element.setAttribute("style", await rewriteCss(element.getAttribute("style"), path, resources, cache, stack, options));
  }
  for (const element of documentNode.querySelectorAll("style")) {
    element.textContent = await rewriteCss(element.textContent || "", path, resources, cache, stack, options);
  }
  const head = documentNode.head || documentNode.documentElement.insertBefore(documentNode.createElement("head"), documentNode.body);
  head.insertAdjacentHTML("afterbegin", `<base href="https://webclaw-vfs.invalid${parentPath(path)}/">${createRuntimeBootstrap(resources, cache, path, options)}`);
  return `<!doctype html>${documentNode.documentElement.outerHTML}`;
}

async function rewriteCss(source, path, resources, cache, stack, options) {
  const pattern = /url\((\s*["']?)([^)"']+)(["']?\s*)\)/gi;
  let result = "";
  let lastIndex = 0;
  for (const match of String(source || "").matchAll(pattern)) {
    result += source.slice(lastIndex, match.index);
    const resolved = resolvePath(match[2], path);
    const resource = resolved ? await resourceUrl(resolved, resources, cache, stack, options) : null;
    result += resource ? `url(${match[1]}${resource.url}${match[3]})` : match[0];
    lastIndex = match.index + match[0].length;
  }
  return result + String(source || "").slice(lastIndex);
}

async function rewriteJavaScript(source, path, resources, cache, stack, options) {
  const pattern = /(import\s*(?:[^'";]*?\sfrom\s*)?|export\s*[^'";]*?\sfrom\s*|import\s*\()(["'])([^"']+)\2/g;
  let result = "";
  let lastIndex = 0;
  for (const match of String(source || "").matchAll(pattern)) {
    result += source.slice(lastIndex, match.index);
    const resolved = resolvePath(match[3], path);
    const resource = resolved ? await resourceUrl(resolved, resources, cache, stack, options) : null;
    result += resource ? `${match[1]}${match[2]}${resource.url}${match[2]}` : match[0];
    lastIndex = match.index + match[0].length;
  }
  return result + String(source || "").slice(lastIndex);
}

function createRuntimeBootstrap(resources, cache, currentPath, options = {}) {
  const map = Object.fromEntries([...resources.keys()].map((path) => [path, cache.get(path)?.url || ""]));
  const namespace = String(options.storageNamespace || "preview");
  const storageSeed = options.localStorage && typeof options.localStorage === "object" ? options.localStorage : {};
  const safeStorageSeed = safeInlineJson(JSON.stringify(storageSeed));
  return `<script>\n(() => {\n  const root = ${JSON.stringify(parentPath(currentPath))};\n  const resolve = (value) => { try { return new URL(value, document.baseURI).pathname; } catch { return value; } };\n  const map = ${JSON.stringify(map)};\n  const originalFetch = window.fetch.bind(window);\n  window.fetch = (input, init) => { const value = typeof input === "string" ? input : input?.url; const path = resolve(value || ""); const target = map[path] || map[root + path]; return target ? originalFetch(target, init) : originalFetch(input, init); };\n  const namespace = ${JSON.stringify(namespace)};\n  const values = Object.create(null);\n  for (const [key, value] of Object.entries(${safeStorageSeed})) values[key] = String(value);\n  const persist = (action, key, value) => (window.opener || window.parent)?.postMessage({ type: "WEBCLAW_PREVIEW_STORAGE_SET", namespace, action, key, value }, "*");\n  const storage = { get length() { return Object.keys(values).length; }, key: (index) => Object.keys(values)[Number(index)] ?? null, getItem: (key) => Object.prototype.hasOwnProperty.call(values, String(key)) ? values[String(key)] : null, setItem: (key, value) => { const name = String(key); const next = String(value); values[name] = next; persist("set", name, next); }, removeItem: (key) => { const name = String(key); delete values[name]; persist("remove", name, ""); }, clear: () => { for (const key of Object.keys(values)) delete values[key]; persist("clear", "", ""); } };\n  try { Object.defineProperty(window, "localStorage", { configurable: true, value: storage }); } catch { /* opaque origins may reject the native property; the shim remains available to page code that receives it. */ }\n  const report = (level, args) => (window.opener || window.parent)?.postMessage({ type: "WEBCLAW_PREVIEW_LOG", level, message: args.map(String).join(" ") }, "*");\n  for (const level of ["log", "info", "warn", "error"]) { const original = console[level]; console[level] = (...args) => { original(...args); report(level, args); }; }\n  window.addEventListener("error", (event) => report("error", [event.message, event.filename, event.lineno]));\n  window.addEventListener("unhandledrejection", (event) => report("error", [event.reason]));\n})();\n</script>`;
}

function safeInlineJson(value) {
  return String(value || "{}")
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function resolvePath(value, basePath) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("#") || /^(?:data|blob|https?|mailto|tel|javascript):/i.test(raw)) return "";
  const clean = raw.split(/[?#]/)[0];
  const base = clean.startsWith("/") ? clean : `${parentPath(basePath)}/${clean}`;
  const parts = [];
  for (const part of base.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function parentPath(path) {
  const value = String(path || "/").replace(/\/+$/, "") || "/";
  const index = value.lastIndexOf("/");
  return index <= 0 ? "/" : value.slice(0, index);
}
function isHtmlFile(path) { return /\.(?:html?|xhtml)$/i.test(String(path)); }
function isCssFile(path) { return /\.css$/i.test(String(path)); }
function isJavaScriptFile(path) { return /\.(?:mjs?|cjs)$/i.test(String(path)); }
function mimeTypeFor(path) {
  const extension = String(path).split(".").pop().toLowerCase();
  return ({ html: "text/html", htm: "text/html", xhtml: "application/xhtml+xml", css: "text/css", js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript", json: "application/json", svg: "image/svg+xml" })[extension] || "application/octet-stream";
}
async function blobUrl(blob, mime) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}
