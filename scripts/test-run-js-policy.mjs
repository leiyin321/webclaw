import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RUN_JS_RUNTIMES,
  normalizeRunJsCapabilities,
  normalizeRunJsRuntime,
  normalizeRunJsTarget,
  normalizeVfsPath,
  pageMatchesRunJsApproval,
  pathMatchesRunJsScope,
  runJsOptionalPermissions,
  runJsRpcMethodAllowed,
  urlMatchesRunJsOrigin
} from "../src/run-js-policy.js";

assert.deepEqual(RUN_JS_RUNTIMES, ["compute", "page-isolated", "page-main", "extension"]);
assert.equal(normalizeRunJsRuntime("PAGE-MAIN"), "page-main");
assert.throws(() => normalizeRunJsRuntime("L3"), /Invalid run_js runtime/);

const emptyCapabilities = { methods: [], vfs: { read: [], write: [] }, network: { origins: [] } };
assert.deepEqual(normalizeRunJsCapabilities({}, "compute"), emptyCapabilities);
assert.deepEqual(normalizeRunJsCapabilities({}, "page-isolated"), emptyCapabilities);
assert.throws(() => normalizeRunJsCapabilities({ methods: ["vfs.read"] }, "compute"), /does not accept RPC/);
assert.throws(() => normalizeRunJsCapabilities({}, "extension"), /at least one/);

const extensionCapabilities = normalizeRunJsCapabilities({
  methods: ["vfs.read", "vfs.write", "http.request", "chrome.tabs.query"],
  vfs: { read: ["/workspace/data/**"], write: ["/workspace/output/**"] },
  network: { origins: ["https://api.example.com"] }
}, "extension");
assert.deepEqual(extensionCapabilities.methods, ["vfs.read", "vfs.write", "http.request", "chrome.tabs.query"]);
assert.deepEqual(extensionCapabilities.network.origins, ["https://api.example.com/*"]);
assert.throws(
  () => normalizeRunJsCapabilities({ methods: ["vfs.read"] }, "extension"),
  /require capabilities.vfs.read/
);
assert.throws(
  () => normalizeRunJsCapabilities({ methods: ["http.request"] }, "extension"),
  /requires capabilities.network.origins/
);
assert.deepEqual(normalizeRunJsCapabilities({
  methods: ["http.request"],
  vfs: { read: ["/workspace/upload.bin"], write: ["/workspace/download.bin"] },
  network: { origins: ["https://api.example.com"] }
}, "extension").vfs, {
  read: ["/workspace/upload.bin"],
  write: ["/workspace/download.bin"]
});
assert.throws(
  () => normalizeRunJsCapabilities({ methods: ["chrome.tabs.*"] }, "extension"),
  /wildcards are not allowed/
);
assert.throws(
  () => normalizeRunJsCapabilities({ methods: ["chrome.tabs.query"], chrome: ["tabs.query"] }, "extension"),
  /unsupported fields: chrome/
);
assert.throws(
  () => normalizeRunJsCapabilities({ methods: ["chrome.identity.getAuthToken"] }, "extension"),
  /Unsupported run_js RPC method/
);

assert.deepEqual(normalizeRunJsTarget({}, "compute"), { tab: "", tabId: null });
assert.deepEqual(normalizeRunJsTarget({ tab: "active" }, "page-isolated"), { tab: "active", tabId: null });
assert.deepEqual(normalizeRunJsTarget({ tabId: 12 }, "page-main"), { tab: "", tabId: 12 });
assert.throws(() => normalizeRunJsTarget({}, "page-main"), /requires target/);
assert.throws(() => normalizeRunJsTarget({ tab: "active", tabId: 12 }, "page-main"), /either/);
assert.throws(() => normalizeRunJsTarget({ tabId: null }, "page-main"), /non-negative integer/);
assert.throws(() => normalizeRunJsTarget({ tabId: "12" }, "page-main"), /non-negative integer/);
assert.throws(() => normalizeRunJsTarget({ tab: "active" }, "extension"), /does not accept a page target/);

assert.equal(normalizeVfsPath("/workspace/a/../b"), "/workspace/b");
assert.throws(() => normalizeVfsPath("/../secret"), /escapes/);
assert.equal(pathMatchesRunJsScope("/workspace/a/b.txt", ["/workspace/**"]), true);
assert.equal(pathMatchesRunJsScope("/workspace/a/b.txt", ["/workspace/*"]), false);
assert.equal(pathMatchesRunJsScope("/inbox/a.txt", ["/workspace/**"]), false);
assert.equal(pathMatchesRunJsScope("/any/path", ["/**"]), true);

assert.equal(pageMatchesRunJsApproval(
  { id: 7, url: "https://example.com/page#before" },
  { id: 7, url: "https://example.com/page#after" }
), true);
assert.equal(pageMatchesRunJsApproval(
  { id: 7, url: "https://example.com/page" },
  { id: 7, url: "https://example.com/other" }
), false);
assert.equal(pageMatchesRunJsApproval(
  { id: 7, url: "https://example.com/page" },
  { id: 7, url: "https://example.com/page", pendingUrl: "https://other.example/" }
), false);

assert.equal(urlMatchesRunJsOrigin("https://api.example.com/v1", ["https://*.example.com/*"]), true);
assert.equal(urlMatchesRunJsOrigin("https://example.com/v1", ["https://*.example.com/*"]), true);
assert.equal(urlMatchesRunJsOrigin("http://example.com/v1", ["https://example.com/*"]), false);
assert.equal(urlMatchesRunJsOrigin("https://example.net/v1", ["https://example.com/*"]), false);
assert.equal(urlMatchesRunJsOrigin("http://localhost:11434/api/tags", ["http://localhost:11434/*"]), true);
assert.equal(urlMatchesRunJsOrigin("http://localhost:11435/api/tags", ["http://localhost:11434/*"]), false);

assert.equal(runJsRpcMethodAllowed("chrome.tabs.query", ["chrome.tabs.query"]), true);
assert.equal(runJsRpcMethodAllowed("chrome.tabs.create", ["chrome.tabs.query"]), false);
assert.equal(runJsRpcMethodAllowed("chrome.storage.local.get", ["chrome.storage.local.get"]), false);
assert.deepEqual(
  runJsOptionalPermissions(["chrome.bookmarks.search", "chrome.history.search", "chrome.tabs.query"]),
  ["bookmarks", "history"]
);

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
assert.equal(manifest.sandbox.pages.includes("src/script-runner-sandbox.html"), true);
const sandbox = readFileSync(new URL("../src/script-runner-sandbox.js", import.meta.url), "utf8");
assert.equal(sandbox.includes("new Worker(url)"), true);
assert.equal(sandbox.includes("worker.terminate()"), true);
assert.equal(sandbox.includes('runtime === "extension"'), true);
assert.equal(sandbox.includes("page: Object.freeze"), false);
assert.equal(sandbox.includes("let rpcSequence = 0"), true);
assert.equal(sandbox.includes("crypto.randomUUID()"), false);
assert.equal(/\beval\s*\(/.test(sandbox), false);
assert.equal(/\bnew\s+Function\s*\(/.test(sandbox), false);

console.log("run_js runtime policy tests passed");
