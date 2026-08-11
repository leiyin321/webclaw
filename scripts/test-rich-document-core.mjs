import assert from "node:assert/strict";
import { richDocumentSchema, normalizeRichDocumentSpec, collectAssetPaths, RICH_DOCUMENT_SCHEMA_VERSIONS } from "../src/document-core/rich-document.js";
import { listDocumentTemplates, resolveDocumentTemplate, validateTemplateManifest } from "../src/document-core/template-registry.js";
import { richDocumentSchemaDefinition } from "../src/document-core/document-schema-registry.js";
import { documentCreate, documentSchema } from "../src/document-service.js";
import { createFakeIndexedDB } from "./test-support/fake-indexeddb.mjs";

globalThis.indexedDB = createFakeIndexedDB();

assert.equal(RICH_DOCUMENT_SCHEMA_VERSIONS.docx, "docx-2");
assert.equal(richDocumentSchema("pptx", ["root", "theme"]).type, "object");
assert.equal(richDocumentSchemaDefinition("pptx", "create").capabilities.nativeFormatGeneration, true);
assert.equal(documentSchema("pptx", "create", { mode: "rich", actions: ["root", "charts"] }).schemaVersion, "pptx-2");
assert.ok(listDocumentTemplates("pptx").some((template) => template.id === "builtin:pptx:corporate-deck"));
assert.equal(resolveDocumentTemplate("builtin:pptx:corporate-deck", "pptx").format, "pptx");
assert.equal(resolveDocumentTemplate("builtin:pdf:business-report", "pdf").format, "pdf");
assert.equal(resolveDocumentTemplate("builtin:docx:business-report", "docx").format, "docx");
assert.throws(() => resolveDocumentTemplate("missing", "pptx"), /template was not found/i);
assert.equal(validateTemplateManifest({ id: "custom", templateVersion: "1", format: "docx" }).format, "docx");

const spec = normalizeRichDocumentSpec("pptx", {
  document: { title: "Quarterly Review" },
  theme: { colors: { primary: "#176B5B" }, fonts: { heading: "Noto Sans SC" } },
  slides: [{ layout: "chart_insights", title: "Revenue", chart: { type: "column", categories: ["Jan", "Feb"], series: [{ name: "Revenue", values: [10, 20] }] } }]
}, { templateId: "builtin:pptx:corporate-deck" });
assert.equal(spec.schemaVersion, "pptx-2");
assert.equal(spec.templateVersion, "1");
assert.equal(spec.slides[0].id, "slide-1");

const report = normalizeRichDocumentSpec("docx", {
  content: [
    { type: "heading", level: 1, text: "Report" },
    { type: "image", path: "/workspace/assets/logo.png", alt: "Logo" },
    { type: "table", table: { columns: [{ key: "name" }], rows: [{ name: "A" }] } }
  ]
}, { templateId: "builtin:docx:business-report" });
assert.deepEqual(collectAssetPaths(report), ["/workspace/assets/logo.png"]);

assert.throws(() => normalizeRichDocumentSpec("docx", { content: [{ type: "image", path: "https://example.com/a.png" }] }), /safe absolute VFS asset path/i);
assert.throws(() => normalizeRichDocumentSpec("pptx", { slides: [{ layout: "content", chart: { type: "line", categories: ["A"], series: [{ name: "S", values: [1, 2] }] } }] }), /series length/i);
assert.throws(() => normalizeRichDocumentSpec("xlsx", { worksheets: [] }), /1 to 50 worksheets/i);
assert.throws(() => normalizeRichDocumentSpec("xlsx", { worksheets: [{ name: "Data", rows: [] }, { name: "data", rows: [] }] }), /names must be unique/i);
assert.throws(() => normalizeRichDocumentSpec("pdf", { content: [{ type: "unknown" }] }), /unsupported document block/i);
await assert.rejects(
  () => documentCreate({ path: "/workspace/schema-mismatch.docx", format: "docx", schemaVersion: "xlsx-2", spec: { content: [{ type: "paragraph", text: "Mismatch" }] } }),
  /schemaVersion must be docx-2/i
);
const stoppedDocument = new AbortController();
stoppedDocument.abort();
await assert.rejects(
  () => documentCreate({ path: "/workspace/stopped.md", format: "markdown", schemaVersion: "markdown-1", spec: { content: "stopped" } }, { signal: stoppedDocument.signal }),
  (error) => error.name === "AbortError"
);
await assert.rejects(
  () => documentCreate({
    path: "/workspace/rich-schema-test.docx",
    format: "docx",
    schemaVersion: "docx-2",
    spec: { content: [{ type: "heading", level: 1, text: "Engine pending" }] }
  }),
  (error) => error.code === "document_generation_engine_unavailable" && error.stage === "engine"
);

console.log("Rich document core tests passed.");
