export const RUN_JS_LEVELS = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 });

export const RUN_JS_CHROME_METHODS = Object.freeze([
  "tabs.query", "tabs.get", "tabs.create", "tabs.update", "tabs.move", "tabs.reload",
  "tabs.duplicate", "tabs.remove", "tabs.group", "tabs.ungroup", "tabs.highlight",
  "tabs.discard", "tabs.goBack", "tabs.goForward", "tabs.getZoom", "tabs.setZoom",
  "tabs.captureVisibleTab", "tabs.detectLanguage",
  "windows.get", "windows.getCurrent", "windows.getLastFocused", "windows.getAll",
  "windows.create", "windows.update", "windows.remove",
  "bookmarks.get", "bookmarks.getChildren", "bookmarks.getRecent", "bookmarks.getSubTree",
  "bookmarks.getTree", "bookmarks.search", "bookmarks.create", "bookmarks.move",
  "bookmarks.update", "bookmarks.remove", "bookmarks.removeTree",
  "history.search", "history.getVisits", "history.addUrl", "history.deleteUrl",
  "history.deleteRange", "history.deleteAll",
  "downloads.download", "downloads.search", "downloads.pause", "downloads.resume",
  "downloads.cancel", "downloads.getFileIcon", "downloads.open", "downloads.show",
  "downloads.showDefaultFolder", "downloads.erase", "downloads.removeFile",
  "sessions.getRecentlyClosed", "sessions.getDevices", "sessions.restore",
  "tabGroups.get", "tabGroups.query", "tabGroups.update", "tabGroups.move",
  "notifications.create", "notifications.update", "notifications.clear",
  "notifications.getAll", "notifications.getPermissionLevel"
]);

export const RUN_JS_OPTIONAL_PERMISSION_BY_NAMESPACE = Object.freeze({
  bookmarks: "bookmarks",
  history: "history",
  downloads: "downloads",
  sessions: "sessions",
  tabGroups: "tabGroups",
  notifications: "notifications"
});

const CHROME_METHOD_SET = new Set(RUN_JS_CHROME_METHODS);

export function normalizeRunJsLevel(value) {
  const level = String(value || "L0").toUpperCase();
  if (!(level in RUN_JS_LEVELS)) throw new Error(`Invalid run_js level: ${value}. Expected L0, L1, L2, L3, L4, or L5.`);
  return level;
}

export function normalizeRunJsCapabilities(value, level) {
  const rank = RUN_JS_LEVELS[normalizeRunJsLevel(level)];
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const vfsInput = input.vfs && typeof input.vfs === "object" ? input.vfs : {};
  const networkInput = input.network && typeof input.network === "object" ? input.network : {};
  const pageInput = input.page && typeof input.page === "object" ? input.page : {};
  const pageRequested = rank === RUN_JS_LEVELS.L3 || rank === RUN_JS_LEVELS.L4 || Object.hasOwn(input, "page");
  if (rank < 1 && (hasItems(vfsInput.read) || hasItems(vfsInput.write))) throw new Error("VFS capabilities require run_js level L1 or higher.");
  if (rank < 2 && hasItems(networkInput.origins)) throw new Error("Network capabilities require run_js level L2 or higher.");
  if (rank < 3 && (hasItems(pageInput.tabIds) || hasItems(pageInput.worlds))) throw new Error("Page capabilities require run_js level L3 or higher.");
  if (rank < 5 && hasItems(input.chrome)) throw new Error("Chrome API capabilities require run_js level L5.");
  const capabilities = {
    vfs: {
      read: rank >= RUN_JS_LEVELS.L1 ? normalizedPathScopes(vfsInput.read, rank === RUN_JS_LEVELS.L1 ? ["/workspace/**"] : []) : [],
      write: rank >= RUN_JS_LEVELS.L1 ? normalizedPathScopes(vfsInput.write, rank === RUN_JS_LEVELS.L1 ? ["/workspace/**"] : []) : []
    },
    network: {
      origins: rank >= RUN_JS_LEVELS.L2 ? normalizedOrigins(networkInput.origins) : []
    },
    page: {
      tabIds: rank >= RUN_JS_LEVELS.L3 && pageRequested ? uniqueIntegers(pageInput.tabIds) : [],
      worlds: rank >= RUN_JS_LEVELS.L3 && pageRequested
        ? normalizedWorlds(pageInput.worlds, rank >= RUN_JS_LEVELS.L4 ? ["USER_SCRIPT", "MAIN"] : ["USER_SCRIPT"])
        : []
    },
    chrome: rank >= RUN_JS_LEVELS.L5 ? normalizedChromeMethods(input.chrome) : []
  };
  assertCapabilitiesFitLevel(capabilities, rank);
  return capabilities;
}

export function assertCapabilitiesFitLevel(capabilities, levelOrRank) {
  const rank = typeof levelOrRank === "number" ? levelOrRank : RUN_JS_LEVELS[normalizeRunJsLevel(levelOrRank)];
  if (rank < 1 && (capabilities.vfs.read.length || capabilities.vfs.write.length)) throw new Error("L0 cannot use VFS capabilities.");
  if (rank < 2 && capabilities.network.origins.length) throw new Error("L0-L1 cannot use network capabilities.");
  if (rank < 3 && (capabilities.page.tabIds.length || capabilities.page.worlds.length)) throw new Error("L0-L2 cannot use page capabilities.");
  if (rank < 4 && capabilities.page.worlds.includes("MAIN")) throw new Error("Page MAIN world requires run_js level L4 or L5.");
  if (rank < 5 && capabilities.chrome.length) throw new Error("Chrome API capabilities require run_js level L5.");
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

export function runJsChromeMethodAllowed(path, declaredMethods) {
  const method = String(path || "");
  if (!CHROME_METHOD_SET.has(method)) return false;
  return (Array.isArray(declaredMethods) ? declaredMethods : []).some((declared) => {
    const value = String(declared || "");
    return value === method || (value.endsWith(".*") && method.startsWith(value.slice(0, -1)));
  });
}

export function runJsOptionalPermissions(methods) {
  return [...new Set((Array.isArray(methods) ? methods : []).map((method) => {
    const namespace = String(method || "").split(".")[0];
    return RUN_JS_OPTIONAL_PERMISSION_BY_NAMESPACE[namespace] || "";
  }).filter(Boolean))];
}

function normalizedPathScopes(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map((item) => {
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

function normalizedWorlds(value, fallback) {
  const worlds = Array.isArray(value) && value.length ? value : fallback;
  return [...new Set(worlds.map((item) => String(item || "").toUpperCase()))].map((world) => {
    if (!["USER_SCRIPT", "MAIN"].includes(world)) throw new Error(`Unsupported run_js page world: ${world}`);
    return world;
  });
}

function normalizedChromeMethods(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))].map((method) => {
    if (method.endsWith(".*")) {
      const namespace = method.slice(0, -2);
      if (!RUN_JS_CHROME_METHODS.some((item) => item.startsWith(`${namespace}.`))) throw new Error(`Unsupported run_js Chrome namespace: ${namespace}`);
      return method;
    }
    if (!CHROME_METHOD_SET.has(method)) throw new Error(`Unsupported run_js Chrome method: ${method}`);
    return method;
  });
}

function uniqueIntegers(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(Number).filter((item) => Number.isInteger(item) && item >= 0))];
}

function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
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
