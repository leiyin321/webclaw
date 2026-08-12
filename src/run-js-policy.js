export const RUN_JS_RUNTIMES = Object.freeze([
  "compute",
  "page-isolated",
  "page-main",
  "extension"
]);

export const RUN_JS_VFS_METHODS = Object.freeze([
  "vfs.list", "vfs.stat", "vfs.read", "vfs.glob", "vfs.hash", "vfs.diff",
  "vfs.search", "vfs.usage", "vfs.write", "vfs.edit", "vfs.mkdir",
  "vfs.move", "vfs.copy", "vfs.touch", "vfs.delete", "vfs.restore",
  "vfs.purge", "vfs.emptyTrash"
]);

export const RUN_JS_CHROME_METHODS = Object.freeze([
  "chrome.tabs.query", "chrome.tabs.get", "chrome.tabs.create", "chrome.tabs.update",
  "chrome.tabs.move", "chrome.tabs.reload", "chrome.tabs.duplicate", "chrome.tabs.remove",
  "chrome.tabs.group", "chrome.tabs.ungroup", "chrome.tabs.highlight", "chrome.tabs.discard",
  "chrome.tabs.goBack", "chrome.tabs.goForward", "chrome.tabs.getZoom", "chrome.tabs.setZoom",
  "chrome.tabs.captureVisibleTab", "chrome.tabs.detectLanguage",
  "chrome.windows.get", "chrome.windows.getCurrent", "chrome.windows.getLastFocused",
  "chrome.windows.getAll", "chrome.windows.create", "chrome.windows.update", "chrome.windows.remove",
  "chrome.bookmarks.get", "chrome.bookmarks.getChildren", "chrome.bookmarks.getRecent",
  "chrome.bookmarks.getSubTree", "chrome.bookmarks.getTree", "chrome.bookmarks.search",
  "chrome.bookmarks.create", "chrome.bookmarks.move", "chrome.bookmarks.update",
  "chrome.bookmarks.remove", "chrome.bookmarks.removeTree",
  "chrome.history.search", "chrome.history.getVisits", "chrome.history.addUrl",
  "chrome.history.deleteUrl", "chrome.history.deleteRange", "chrome.history.deleteAll",
  "chrome.downloads.download", "chrome.downloads.search", "chrome.downloads.pause",
  "chrome.downloads.resume", "chrome.downloads.cancel", "chrome.downloads.getFileIcon",
  "chrome.downloads.open", "chrome.downloads.show", "chrome.downloads.showDefaultFolder",
  "chrome.downloads.erase", "chrome.downloads.removeFile",
  "chrome.sessions.getRecentlyClosed", "chrome.sessions.getDevices", "chrome.sessions.restore",
  "chrome.tabGroups.get", "chrome.tabGroups.query", "chrome.tabGroups.update", "chrome.tabGroups.move",
  "chrome.notifications.create", "chrome.notifications.update", "chrome.notifications.clear",
  "chrome.notifications.getAll", "chrome.notifications.getPermissionLevel"
]);

export const RUN_JS_RPC_METHODS = Object.freeze([
  ...RUN_JS_VFS_METHODS,
  "http.request",
  ...RUN_JS_CHROME_METHODS
]);

export const RUN_JS_OPTIONAL_PERMISSION_BY_NAMESPACE = Object.freeze({
  bookmarks: "bookmarks",
  history: "history",
  downloads: "downloads",
  sessions: "sessions",
  tabGroups: "tabGroups",
  notifications: "notifications"
});

const RPC_METHOD_SET = new Set(RUN_JS_RPC_METHODS);
const VFS_READ_METHODS = new Set([
  "vfs.list", "vfs.stat", "vfs.read", "vfs.glob", "vfs.hash", "vfs.diff",
  "vfs.search", "vfs.usage", "vfs.copy"
]);
const VFS_WRITE_METHODS = new Set([
  "vfs.write", "vfs.edit", "vfs.mkdir", "vfs.move", "vfs.copy", "vfs.touch",
  "vfs.delete", "vfs.restore", "vfs.purge", "vfs.emptyTrash"
]);

export function normalizeRunJsRuntime(value) {
  const runtime = String(value || "").trim().toLowerCase();
  if (!RUN_JS_RUNTIMES.includes(runtime)) {
    throw new Error(`Invalid run_js runtime: ${value || "(empty)"}. Expected ${RUN_JS_RUNTIMES.join(", ")}.`);
  }
  return runtime;
}

export function normalizeRunJsTarget(value, runtime) {
  const normalizedRuntime = normalizeRunJsRuntime(runtime);
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  assertOnlyKeys(input, ["tab", "tabId"], "run_js target");
  const hasTarget = Object.keys(input).length > 0;
  if (!["page-isolated", "page-main"].includes(normalizedRuntime)) {
    if (hasTarget) throw new Error(`run_js runtime ${normalizedRuntime} does not accept a page target.`);
    return { tab: "", tabId: null };
  }
  const tab = String(input.tab || "").trim().toLowerCase();
  const hasTabId = Object.hasOwn(input, "tabId");
  const tabId = hasTabId ? input.tabId : null;
  if (tab && tab !== "active") throw new Error("run_js target.tab must be active when provided.");
  if (hasTabId && (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0)) {
    throw new Error("run_js target.tabId must be a non-negative integer.");
  }
  if (tab === "active" && hasTabId) throw new Error("run_js target must provide either tab=active or tabId, not both.");
  if (!tab && !hasTabId) throw new Error("run_js page runtime requires target.tab=active or target.tabId.");
  return { tab, tabId };
}

export function normalizeRunJsCapabilities(value, runtime) {
  const normalizedRuntime = normalizeRunJsRuntime(runtime);
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (normalizedRuntime !== "extension") {
    if (Object.keys(input).length > 0) {
      throw new Error(`run_js runtime ${normalizedRuntime} does not accept RPC capabilities.`);
    }
    return emptyCapabilities();
  }

  assertOnlyKeys(input, ["methods", "vfs", "network"], "run_js capabilities");
  const vfsInput = input.vfs && typeof input.vfs === "object" && !Array.isArray(input.vfs) ? input.vfs : {};
  const networkInput = input.network && typeof input.network === "object" && !Array.isArray(input.network) ? input.network : {};
  assertOnlyKeys(vfsInput, ["read", "write"], "run_js capabilities.vfs");
  assertOnlyKeys(networkInput, ["origins"], "run_js capabilities.network");
  const capabilities = {
    methods: normalizedRpcMethods(input.methods),
    vfs: {
      read: normalizedPathScopes(vfsInput.read),
      write: normalizedPathScopes(vfsInput.write)
    },
    network: {
      origins: normalizedOrigins(networkInput.origins)
    }
  };
  if (!capabilities.methods.length) throw new Error("run_js extension runtime requires at least one capabilities.methods entry.");
  assertCapabilitiesMatchMethods(capabilities);
  return capabilities;
}

export function runJsRpcMethodAllowed(path, declaredMethods) {
  const method = String(path || "");
  return RPC_METHOD_SET.has(method) && (Array.isArray(declaredMethods) ? declaredMethods : []).includes(method);
}

export function normalizeVfsPath(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/")) throw new Error(`VFS RPC path must be absolute: ${raw || "(empty)"}`);
  const parts = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error(`VFS RPC path escapes the filesystem root: ${raw}`);
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return `/${parts.join("/")}`;
}

export function pathMatchesRunJsScope(path, scopes) {
  const target = normalizeVfsPath(path);
  return (Array.isArray(scopes) ? scopes : []).some((scopeValue) => {
    const scope = String(scopeValue || "");
    if (scope === "/**") return true;
    if (scope.endsWith("/**")) {
      const root = normalizeVfsPath(scope.slice(0, -3) || "/");
      return target === root || target.startsWith(`${root === "/" ? "" : root}/`);
    }
    if (scope.endsWith("/*")) {
      const root = normalizeVfsPath(scope.slice(0, -2) || "/");
      const parent = target.slice(0, target.lastIndexOf("/")) || "/";
      return parent === root;
    }
    return target === normalizeVfsPath(scope);
  });
}

export function pageMatchesRunJsApproval(approvedTab, currentTab) {
  if (!approvedTab || !currentTab || Number(approvedTab.id) !== Number(currentTab.id)) return false;
  const approvedUrl = normalizedPageTargetUrl(approvedTab.url);
  const currentUrl = normalizedPageTargetUrl(currentTab.url);
  if (!approvedUrl || currentUrl !== approvedUrl) return false;
  const pendingUrl = normalizedPageTargetUrl(currentTab.pendingUrl);
  return !pendingUrl || pendingUrl === approvedUrl;
}

export function urlMatchesRunJsOrigin(value, patterns) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  return (Array.isArray(patterns) ? patterns : []).some((pattern) => {
    const match = /^(https?):\/\/(\*\.)?([^/]+)\/\*$/.exec(String(pattern || ""));
    if (!match || `${match[1]}:` !== url.protocol) return false;
    const patternHost = match[3].toLowerCase();
    const separator = patternHost.lastIndexOf(":");
    const hasPort = separator > -1 && !patternHost.includes("]");
    const hostname = hasPort ? patternHost.slice(0, separator) : patternHost;
    const port = hasPort ? patternHost.slice(separator + 1) : "";
    const actual = url.hostname.toLowerCase();
    const hostMatches = match[2] ? actual === hostname || actual.endsWith(`.${hostname}`) : actual === hostname;
    return hostMatches && (!port || url.port === port);
  });
}

export function runJsOptionalPermissions(methods) {
  return [...new Set((Array.isArray(methods) ? methods : []).map((method) => {
    const match = /^chrome\.([^.]+)\./.exec(String(method || ""));
    return match ? RUN_JS_OPTIONAL_PERMISSION_BY_NAMESPACE[match[1]] || "" : "";
  }).filter(Boolean))];
}

function emptyCapabilities() {
  return { methods: [], vfs: { read: [], write: [] }, network: { origins: [] } };
}

function assertCapabilitiesMatchMethods(capabilities) {
  const methods = new Set(capabilities.methods);
  const usesVfsRead = [...methods].some((method) => VFS_READ_METHODS.has(method));
  const usesVfsWrite = [...methods].some((method) => VFS_WRITE_METHODS.has(method));
  const usesHttp = methods.has("http.request");
  if (usesVfsRead && !capabilities.vfs.read.length) throw new Error("Declared VFS read RPC methods require capabilities.vfs.read scopes.");
  if (usesVfsWrite && !capabilities.vfs.write.length) throw new Error("Declared VFS write RPC methods require capabilities.vfs.write scopes.");
  if (usesHttp && !capabilities.network.origins.length) throw new Error("http.request requires capabilities.network.origins.");
  if (!usesVfsRead && !usesHttp && capabilities.vfs.read.length) throw new Error("capabilities.vfs.read requires a declared VFS read RPC method or http.request multipart source.");
  if (!usesVfsWrite && !usesHttp && capabilities.vfs.write.length) throw new Error("capabilities.vfs.write requires a declared VFS write RPC method or http.request VFS destination.");
  if (!usesHttp && capabilities.network.origins.length) throw new Error("capabilities.network.origins requires the http.request method.");
}

function normalizedRpcMethods(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))].map((method) => {
    if (method.includes("*")) throw new Error(`run_js RPC methods must be explicit; wildcards are not allowed: ${method}`);
    if (!RPC_METHOD_SET.has(method)) throw new Error(`Unsupported run_js RPC method: ${method}`);
    return method;
  });
}

function normalizedPathScopes(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => {
    const text = String(item || "").trim();
    const suffix = text.endsWith("/**") ? "/**" : text.endsWith("/*") ? "/*" : "";
    const root = normalizeVfsPath(suffix ? text.slice(0, -suffix.length) || "/" : text);
    return suffix && root === "/" ? suffix : `${root}${suffix}`;
  }))];
}

function normalizedOrigins(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => {
    const text = String(item || "").trim();
    const wildcard = /^(https?):\/\/\*\.([^/]+)(?:\/\*)?$/i.exec(text);
    if (wildcard) return `${wildcard[1].toLowerCase()}://*.${wildcard[2].toLowerCase()}/*`;
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error(`Unsupported run_js network origin: ${text}`);
    return `${url.origin}/*`;
  }))];
}

function normalizedPageTargetUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function assertOnlyKeys(value, allowed, label) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}`);
}
