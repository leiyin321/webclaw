import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const messages = [];
const listeners = {};
const writes = [];
const host = {
  postMessage(message, targetOrigin) {
    messages.push({ message, targetOrigin });
  }
};
const windowObject = {
  opener: null,
  parent: host,
  addEventListener(type, listener) {
    listeners[type] = listener;
  }
};
const documentObject = {
  open() { writes.push("open"); },
  write(value) { writes.push(String(value)); },
  close() { writes.push("close"); },
  querySelector() { return { textContent: "" }; }
};

vm.runInNewContext(readFileSync(new URL("../src/preview-sandbox.js", import.meta.url), "utf8"), {
  window: windowObject,
  document: documentObject,
  String
});

assert.equal(messages.length, 1);
assert.equal(messages[0].message.type, "WEBCLAW_PREVIEW_READY");
assert.equal(messages[0].targetOrigin, "*");
listeners.message({ source: {}, data: { type: "WEBCLAW_RENDER_PREVIEW", html: "untrusted" } });
assert.deepEqual(writes, []);
listeners.message({ source: host, data: { type: "WEBCLAW_RENDER_PREVIEW", html: "<main>ready</main>" } });
assert.deepEqual(writes, ["open", "<main>ready</main>", "close"]);

console.log("Preview sandbox tests passed.");
