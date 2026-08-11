import assert from "node:assert/strict";
import { createFakeIndexedDB } from "./test-support/fake-indexeddb.mjs";

globalThis.indexedDB = createFakeIndexedDB();

const { vfsWriteFile } = await import("../src/virtual-file-system.js");
const {
  knowledgeIngestVfsFile,
  knowledgeSearch,
  knowledgeStatus
} = await import("../src/knowledge-base.js");

await vfsWriteFile("/workspace/a/one.md", "alpha project decision", { createParents: true });
await vfsWriteFile("/workspace/abc/two.md", "alpha unrelated material", { createParents: true });

await knowledgeIngestVfsFile("/workspace/a/one.md", { collection: "project", tags: ["decision"] });
await knowledgeIngestVfsFile("/workspace/abc/two.md", { collection: "other", tags: ["reference"] });

const projectStatus = await knowledgeStatus({ collection: "project" });
assert.equal(projectStatus.documents, 1);
assert.equal(projectStatus.chunks, 1);
assert.equal(projectStatus.items[0].path, "/workspace/a/one.md");
assert.equal(projectStatus.sourceChars, "alpha project decision".length);

const pathStatus = await knowledgeStatus({ path: "/workspace/a" });
assert.equal(pathStatus.documents, 1, "path filters must not include similarly prefixed directories");
assert.equal(pathStatus.items[0].path, "/workspace/a/one.md");

const search = await knowledgeSearch("alpha", { collection: "other" });
assert.deepEqual(search.results.map((item) => item.path), ["/workspace/abc/two.md"]);

const metadataUpdate = await knowledgeIngestVfsFile("/workspace/a/one.md", {
  title: "Updated title",
  collection: "archive",
  tags: ["archived"]
});
assert.equal(metadataUpdate.metadataUpdated, true);
assert.equal((await knowledgeStatus({ collection: "project" })).documents, 0);
assert.equal((await knowledgeStatus({ collection: "archive" })).documents, 1);

await vfsWriteFile("/workspace/reference.pdf", new Blob(["%PDF-1.4\n/Type /Page\nBT (knowledge pdf) ET"], { type: "application/pdf" }), { mimeType: "application/pdf", createParents: true });
const projected = await knowledgeIngestVfsFile("/workspace/reference.pdf", { collection: "documents" });
assert.equal(projected.document.projectionFormat, "pdf");
const pdfSearch = await knowledgeSearch("knowledge pdf", { collection: "documents" });
assert.match(pdfSearch.results[0].content, /knowledge pdf/);
assert.equal(pdfSearch.results[0].sourceLocator, null);

console.log("Knowledge base tests passed.");
