import assert from "node:assert/strict";
import { createFakeIndexedDB } from "./test-support/fake-indexeddb.mjs";

globalThis.indexedDB = createFakeIndexedDB();

const { vfsGetFileBlob, vfsReadFile, vfsWriteFile } = await import("../src/virtual-file-system.js");
const {
  documentCreate,
  documentEdit,
  documentExport,
  documentInspect,
  documentRead,
  documentRevision,
  documentRender,
  documentSchema
} = await import("../src/document-service.js");

function zipStored(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = value instanceof Uint8Array ? value : encoder.encode(value);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localParts.push(local);
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, centralParts.length, true);
  endView.setUint16(10, centralParts.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

async function assertValidGeneratedZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { eocd = index; break; }
  }
  assert.ok(eocd >= 0, "generated Office package must contain an end-of-central-directory record");
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  assert.ok(count > 0);
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50);
    assert.ok(view.getUint16(cursor + 4, true) >= 20);
    assert.ok(view.getUint16(cursor + 6, true) >= 20);
    const checksum = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    assert.equal(view.getUint32(localOffset, true), 0x04034b50);
    assert.ok(view.getUint16(localOffset + 4, true) >= 20);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    assert.equal(testCrc32(bytes.slice(dataStart, dataStart + size)), checksum);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
}

function testCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const path = "/workspace/docs/guide.md";
const schema = documentSchema("markdown", "create");
assert.equal(schema.supported, true);
assert.equal(schema.schemaVersion, "markdown-1");

const created = await documentCreate({
  path,
  format: "markdown",
  schemaVersion: schema.schemaVersion,
  spec: {
    content: "---\ntitle: Draft\n---\n# Guide\n\nDraft text.\n\n## Tasks\n\n- [ ] Verify\n"
  }
});
assert.equal(created.format, "markdown");
assert.equal(created.fidelity, "full");

const inspected = await documentInspect(path);
assert.equal(inspected.format, "markdown");
assert.equal(inspected.structure.headings.length, 2);
assert.equal(inspected.structure.frontMatter, true);

const heading = await documentRead(path, { locator: { kind: "heading", heading: "Tasks" } });
assert.match(heading.content, /Verify/);
assert.equal(heading.sourceLocator.kind, "heading");

const snapshot = await documentRevision({ path, action: "snapshot" });
assert.equal(snapshot.revision.path, path);
assert.equal((await documentRevision({ path, action: "list" })).revisions.length, 1);
const edited = await documentEdit({
  path,
  format: "markdown",
  schemaVersion: "markdown-1",
  expectedVersion: inspected.version,
  operations: [
    { op: "replace_text", oldText: "Draft text.", newText: "Final text." },
    { op: "set_front_matter", key: "title", value: "Final" }
  ]
});
assert.equal(edited.changes.length, 2);
assert.notEqual(edited.version, inspected.version);

await assert.rejects(
  () => documentEdit({ path, format: "markdown", schemaVersion: "markdown-1", expectedVersion: inspected.version, operations: [{ op: "replace_text", oldText: "Final", newText: "Broken" }] }),
  /version conflict/i
);
await assert.rejects(
  () => documentCreate({ path, format: "markdown", schemaVersion: "markdown-1", overwrite: true, spec: { content: "# Unsafe" } }),
  /requires expectedVersion or expectedHash/i
);
const rendered = await documentRender({ path });
const renderedSource = (await vfsReadFile(rendered.outputPath)).content;
assert.match(renderedSource, /Final text/);
assert.doesNotMatch(renderedSource, /<script/i);
assert.doesNotMatch(renderedSource, /javascript:/i);

const exported = await documentExport({ path, targetFormat: "html", outputPath: "/exports/guide.html" });
assert.equal(exported.targetFormat, "html");
assert.equal((await vfsReadFile(exported.outputPath)).isText, true);
const restored = await documentRevision({ path, action: "restore", revisionId: snapshot.revision.id, expectedVersion: edited.version });
assert.equal(restored.action, "restore");
assert.match((await documentRead(path)).content, /Draft text/);

const unsupported = documentSchema("docx", "read");
assert.equal(unsupported.supported, true);
assert.equal(unsupported.schemaVersion, "docx-read-1");
assert.deepEqual(documentSchema("docx", "create").schema.required, ["blocks"]);
assert.deepEqual(documentSchema("pptx", "create").schema.required, ["slides"]);
assert.deepEqual(documentSchema("xlsx", "create").schema.required, ["sheets"]);

const docxPath = "/workspace/docs/report.docx";
await vfsWriteFile(docxPath, zipStored({
  "word/document.xml": "<?xml version=\"1.0\"?><w:document xmlns:w=\"urn:schemas-microsoft-com:office:word\"><w:body><w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Report</w:t></w:r></w:p><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"
}), { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", createParents: true });
const docxInfo = await documentInspect(docxPath);
assert.equal(docxInfo.format, "docx");
assert.equal(docxInfo.capabilities.read, true);
const docxRead = await documentRead(docxPath, { output: "markdown" });
assert.match(docxRead.content, /Hello DOCX/);
assert.equal(docxRead.structure.tables, 1);
const docxParagraph = await documentRead(docxPath, { locator: { kind: "docx_paragraph", paragraph: 2 } });
assert.equal(docxParagraph.sourceLocator.kind, "docx_paragraph");
assert.match(docxParagraph.content, /Hello DOCX/);
const generatedDocxPath = "/workspace/docs/generated.docx";
assert.equal(documentSchema("docx", "create").schemaVersion, "docx-1");
const generatedDocx = await documentCreate({
  path: generatedDocxPath,
  format: "docx",
  schemaVersion: "docx-1",
  spec: { blocks: [{ type: "heading", level: 1, text: "Report" }, { type: "paragraph", text: "Draft text" }, { type: "table", rows: [["A", "B"], ["1", "2"]] }] }
});
assert.equal(generatedDocx.fidelity, "rebuild");
await assertValidGeneratedZip(await vfsGetFileBlob(generatedDocxPath));
const generatedDocxInfo = await documentInspect(generatedDocxPath);
const editedDocx = await documentEdit({
  path: generatedDocxPath,
  format: "docx",
  schemaVersion: "docx-1",
  editMode: "rebuild",
  expectedVersion: generatedDocxInfo.version,
  operations: [{ op: "replace_text", oldText: "Draft text", newText: "Final text" }]
});
assert.equal(editedDocx.fidelity, "rebuild");
assert.match((await documentRead(generatedDocxPath)).content, /Final text/);
assert.equal((await documentRevision({ path: generatedDocxPath, action: "list" })).revisions.length, 1);
const docxMarkdownExport = await documentExport({ path: generatedDocxPath, targetFormat: "markdown", outputPath: "/exports/generated-docx.md" });
assert.equal(docxMarkdownExport.fidelity, "projection");
assert.match((await vfsReadFile(docxMarkdownExport.outputPath)).content, /Final text/);
await documentExport({ path: generatedDocxPath, targetFormat: "json", outputPath: "/exports/generated-docx.json" });
assert.equal(JSON.parse((await vfsReadFile("/exports/generated-docx.json")).content).paragraphs[1].text, "Final text");

const xlsxPath = "/workspace/docs/data.xlsx";
await vfsWriteFile(xlsxPath, zipStored({
  "xl/workbook.xml": "<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Data\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
  "xl/_rels/workbook.xml.rels": "<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/></Relationships>",
  "xl/worksheets/sheet1.xml": "<worksheet><sheetData><row r=\"1\"><c r=\"A1\"><v>One</v></c><c r=\"B1\"><v>Two</v></c></row></sheetData></worksheet>"
}), { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", createParents: true });
const xlsxRead = await documentRead(xlsxPath, { output: "json" });
assert.equal(xlsxRead.format, "xlsx");
assert.equal(xlsxRead.output.sheets[0].name, "Data");
assert.equal(xlsxRead.output.sheets[0].rows[0][1].value, "Two");
const xlsxCell = await documentRead(xlsxPath, { locator: { kind: "xlsx_cell", sheet: "Data", cell: "B1" } });
assert.equal(xlsxCell.sourceLocator.kind, "xlsx_cell");
assert.match(xlsxCell.content, /Two/);

const generatedXlsxPath = "/workspace/docs/generated.xlsx";
const xlsxCreateSchema = documentSchema("xlsx", "create");
assert.equal(xlsxCreateSchema.schemaVersion, "xlsx-1");
const generated = await documentCreate({
  path: generatedXlsxPath,
  format: "xlsx",
  schemaVersion: "xlsx-1",
  spec: { sheets: [{ name: "Data", rows: [["Name", "Value"], ["alpha", 1]] }] }
});
assert.equal(generated.fidelity, "rebuild");
await assertValidGeneratedZip(await vfsGetFileBlob(generatedXlsxPath));
const generatedInfo = await documentInspect(generatedXlsxPath);
const changed = await documentEdit({
  path: generatedXlsxPath,
  format: "xlsx",
  schemaVersion: "xlsx-1",
  editMode: "rebuild",
  expectedVersion: generatedInfo.version,
  operations: [{ op: "set_cell", sheet: "Data", cell: "B2", value: "2" }]
});
assert.equal(changed.fidelity, "rebuild");
assert.equal((await documentRead(generatedXlsxPath, { output: "json" })).output.sheets[0].rows[1][1].value, "2");
const largeRows = Array.from({ length: 100 }, (_, index) => [`row-${index}`, "x".repeat(20)]);
const largeXlsxPath = "/workspace/docs/large.xlsx";
await documentCreate({ path: largeXlsxPath, format: "xlsx", schemaVersion: "xlsx-1", spec: { sheets: [{ name: "Data", rows: largeRows }] } });
await assert.rejects(() => documentRead(largeXlsxPath, { output: "json", maxChars: 500 }), /above maxChars=500/);

const pptxPath = "/workspace/docs/slides.pptx";
await vfsWriteFile(pptxPath, zipStored({
  "ppt/presentation.xml": "<p:presentation xmlns:p=\"urn\"><p:sldIdLst/></p:presentation>",
  "ppt/slides/slide1.xml": "<p:sld xmlns:a=\"urn:a\"><a:t>Slide text</a:t></p:sld>"
}), { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", createParents: true });
assert.match((await documentRead(pptxPath)).content, /Slide text/);
assert.equal((await documentRead(pptxPath, { locator: { kind: "pptx_slide", slide: 1 } })).sourceLocator.kind, "pptx_slide");
const generatedPptxPath = "/workspace/docs/generated.pptx";
assert.equal(documentSchema("pptx", "create").schemaVersion, "pptx-1");
await documentCreate({
  path: generatedPptxPath,
  format: "pptx",
  schemaVersion: "pptx-1",
  spec: { slides: [{ title: "Overview", body: "Draft slide" }] }
});
await assertValidGeneratedZip(await vfsGetFileBlob(generatedPptxPath));
const generatedPptxInfo = await documentInspect(generatedPptxPath);
await documentEdit({
  path: generatedPptxPath,
  format: "pptx",
  schemaVersion: "pptx-1",
  editMode: "rebuild",
  expectedVersion: generatedPptxInfo.version,
  operations: [{ op: "replace_text", oldText: "Draft slide", newText: "Final slide" }]
});
assert.match((await documentRead(generatedPptxPath)).content, /Final slide/);

const pdfPath = "/workspace/docs/sample.pdf";
await vfsWriteFile(pdfPath, new Blob(["%PDF-1.4\n1 0 obj /Type /Page endobj\nBT (Hello PDF) ET\n%%EOF"], { type: "application/pdf" }), { createParents: true });
const pdfRead = await documentRead(pdfPath);
assert.equal(pdfRead.format, "pdf");
assert.match(pdfRead.content, /Hello PDF/);
const generatedPdfPath = "/workspace/docs/generated.pdf";
assert.equal(documentSchema("pdf", "create").schemaVersion, "pdf-1");
await documentCreate({ path: generatedPdfPath, format: "pdf", schemaVersion: "pdf-1", spec: { pages: [{ text: "Page one" }, { text: "Page two" }] } });
const generatedPdf = await documentRead(generatedPdfPath);
assert.equal(generatedPdf.structure.pages, 2);
assert.match(generatedPdf.content, /Page one/);
assert.match(generatedPdf.content, /Page two/);
await assert.rejects(() => documentRead(generatedPdfPath, { locator: { kind: "pdf_page", page: 1 } }), /page-level reading is unavailable/i);
await assert.rejects(
  () => documentCreate({ path: "/workspace/docs/non-ascii.pdf", format: "pdf", schemaVersion: "pdf-1", spec: { pages: [{ text: "中文" }] } }),
  /supports ASCII text only/
);

const revisionsBeforePurge = await documentRevision({ path, action: "list" });
assert.ok(revisionsBeforePurge.revisions.length >= 3);
const purgedOne = await documentRevision({ path, action: "purge", revisionId: revisionsBeforePurge.revisions[0].id, confirm: true });
assert.equal(purgedOne.purged, 1);
await assert.rejects(() => documentRevision({ path, action: "purge" }), /confirm=true/);

console.log("Document service tests passed.");
