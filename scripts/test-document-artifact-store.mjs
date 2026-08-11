import assert from "node:assert/strict";
import { createFakeIndexedDB } from "./test-support/fake-indexeddb.mjs";

globalThis.indexedDB = createFakeIndexedDB();
const { cleanupDocumentArtifacts, putDocumentArtifact, takeDocumentArtifact } = await import("../src/document-artifact-store.js");

const id = "artifact_test_12345678";
const stored = await putDocumentArtifact(id, new Blob(["document"], { type: "application/octet-stream" }), { format: "docx" });
assert.equal(stored.id, id);
assert.equal(stored.size, 8);
const artifact = await takeDocumentArtifact(id);
assert.equal(await artifact.blob.text(), "document");
assert.equal(artifact.metadata.format, "docx");
await assert.rejects(() => takeDocumentArtifact(id), /was not found/i);

const originalNow = Date.now;
Date.now = () => 1_000;
await putDocumentArtifact("expired-artifact", new Blob(["old"]));
Date.now = () => 2_000;
assert.deepEqual(await cleanupDocumentArtifacts({ maxAgeMs: 500 }), { deleted: 1 });
await assert.rejects(() => takeDocumentArtifact("expired-artifact"), /was not found/i);
Date.now = originalNow;
console.log("Document artifact store tests passed.");
