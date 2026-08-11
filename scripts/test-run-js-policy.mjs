import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RUN_JS_LEVELS,
  normalizeRunJsCapabilities,
  normalizeRunJsLevel,
  normalizeVfsPath,
  pageMatchesRunJsApproval,
  pathMatchesRunJsScope,
  runJsChromeMethodAllowed,
  runJsOptionalPermissions,
  urlMatchesRunJsOrigin
} from "../src/run-js-policy.js";

assert.deepEqual(Object.keys(RUN_JS_LEVELS), ["L0", "L1", "L2", "L3", "L4", "L5"]);
assert.equal(normalizeRunJsLevel("l4"), "L4");
assert.throws(() => normalizeRunJsLevel("extension"), /Invalid run_js level/);

assert.deepEqual(normalizeRunJsCapabilities({}, "L0"), {
  vfs: { read: [], write: [] }, network: { origins: [] }, page: { tabIds: [], worlds: [] }, chrome: []
});
assert.deepEqual(normalizeRunJsCapabilities({}, "L1").vfs, {
  read: ["/workspace/**"], write: ["/workspace/**"]
});
assert.deepEqual(normalizeRunJsCapabilities({}, "L2").vfs, { read: [], write: [] });
assert.deepEqual(normalizeRunJsCapabilities({}, "L3").page.worlds, ["USER_SCRIPT"]);
assert.deepEqual(normalizeRunJsCapabilities({}, "L4").page.worlds, ["USER_SCRIPT", "MAIN"]);
assert.deepEqual(normalizeRunJsCapabilities({ chrome: ["bookmarks.search"] }, "L5").page, { tabIds: [], worlds: [] });
assert.deepEqual(normalizeRunJsCapabilities({ page: {}, chrome: ["tabs.query"] }, "L5").page.worlds, ["USER_SCRIPT", "MAIN"]);
assert.throws(
  () => normalizeRunJsCapabilities({ page: { worlds: ["MAIN"] } }, "L3"),
  /MAIN world requires/
);
assert.throws(
  () => normalizeRunJsCapabilities({ network: { origins: ["https://example.com"] } }, "L1"),
  /Network capabilities require/
);
assert.throws(
  () => normalizeRunJsCapabilities({ chrome: ["tabs.query"] }, "L4"),
  /Chrome API capabilities require/
);

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

assert.equal(runJsChromeMethodAllowed("tabs.query", ["tabs.query"]), true);
assert.equal(runJsChromeMethodAllowed("tabs.create", ["tabs.*"]), true);
assert.equal(runJsChromeMethodAllowed("storage.local.get", ["storage.*"]), false);
assert.throws(() => normalizeRunJsCapabilities({ chrome: ["identity.getAuthToken"] }, "L5"), /Unsupported run_js Chrome method/);
assert.deepEqual(runJsOptionalPermissions(["bookmarks.search", "history.search", "tabs.query"]), ["bookmarks", "history"]);

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
assert.equal(manifest.sandbox.pages.includes("src/script-runner-sandbox.html"), true);
const sandbox = readFileSync(new URL("../src/script-runner-sandbox.js", import.meta.url), "utf8");
assert.equal(sandbox.includes("new Worker(url)"), true);
assert.equal(sandbox.includes("worker.terminate()"), true);
assert.equal(/\beval\s*\(/.test(sandbox), false);
assert.equal(/\bnew\s+Function\s*\(/.test(sandbox), false);

console.log("run_js capability policy tests passed");
