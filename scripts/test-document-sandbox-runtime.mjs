import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const service = readFileSync(new URL("../src/document-service.js", import.meta.url), "utf8");
const offscreen = readFileSync(new URL("../src/document-offscreen.js", import.meta.url), "utf8");
const sandboxHtml = readFileSync(new URL("../src/document-engine-sandbox.html", import.meta.url), "utf8");
const bundle = readFileSync(new URL("../build/document/document-sandbox.js", import.meta.url), "utf8");
const bundles = readdirSync(new URL("../build/document", import.meta.url)).filter((name) => name.endsWith(".js"));

assert.ok(manifest.sandbox.pages.includes("src/document-engine-sandbox.html"));
assert.match(sandboxHtml, /document-sandbox\.js/);
assert.doesNotMatch(service, /\bimport\s*\(/);
assert.doesNotMatch(bundle, /\bimport\s*\(/);
assert.doesNotMatch(bundle, /image-size/i);
assert.match(service, /WEBCLAW_DOCUMENT_CANCEL/);
assert.match(offscreen, /WEBCLAW_DOCUMENT_CANCEL/);
assert.match(offscreen, /deleteDocumentArtifact/);
assert.deepEqual(bundles, ["document-sandbox.js"]);
console.log("Document sandbox runtime tests passed.");
