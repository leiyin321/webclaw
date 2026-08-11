import { markdownOutline, markdownToText, parseMarkdown, renderMarkdown } from "./markdown.js";
import {
  vfsHash,
  vfsGetFileBlob,
  vfsReadFile,
  vfsStat,
  vfsWriteFile
} from "./virtual-file-system.js";
import { deleteDocumentRevision, deleteDocumentRevisions, getDocumentRevision, listDocumentRevisions, saveDocumentRevision } from "./document-revision-store.js";

const MARKDOWN_SCHEMA_VERSION = "markdown-1";
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkdn"]);
const OFFICE_EXTENSIONS = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf"]);
const OFFICE_FORMATS = new Set(["docx", "xlsx", "pptx", "pdf"]);
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_DOCUMENT_TEXT_CHARS = 200_000;
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export async function documentInspect(path, options = {}) {
  const target = requiredPath(path);
  const stat = await vfsStat(target);
  if (stat.entry.type !== "file") throw new Error(`Document path is not a file: ${target}`);
  const format = await detectDocumentFormatFromBlob(target, stat.entry.mimeType);
  const result = {
    path: target,
    format,
    mimeType: stat.entry.mimeType || "application/octet-stream",
    size: stat.entry.size,
    version: stat.entry.version,
    ...(await vfsHash(target)),
    capabilities: format === "markdown"
      ? { read: true, create: true, edit: "full", render: "html", export: ["markdown", "html"] }
      : OFFICE_FORMATS.has(format)
        ? { read: true, create: ["docx", "xlsx", "pptx", "pdf"].includes(format), edit: ["docx", "xlsx", "pptx"].includes(format) ? "rebuild" : false, render: false, export: ["markdown", "json"] }
      : { read: false, create: false, edit: false, render: false, export: [] },
    warnings: format === "unsupported"
      ? [{ code: OFFICE_EXTENSIONS.has(extensionOf(target)) ? "legacy_or_office_pending" : "unknown_format", message: "This document format is not implemented in the current browser phase." }]
      : []
  };
  if (format === "markdown" && options.includeOutline !== false) {
    const source = await readText(target);
    const parsed = parseMarkdown(source);
    result.structure = {
      headings: markdownOutline(parsed),
      paragraphs: parsed.blocks.filter((block) => block.type === "paragraph").length,
      lists: parsed.blocks.filter((block) => block.type === "list").length,
      tables: parsed.blocks.filter((block) => block.type === "table").length,
      codeBlocks: parsed.blocks.filter((block) => block.type === "code").length,
      frontMatter: Object.keys(parsed.frontMatter).length > 0
    };
  } else if (OFFICE_FORMATS.has(format)) {
    result.structure = await inspectOfficeDocument(target, format);
  }
  return result;
}

export async function documentRead(path, options = {}) {
  const target = requiredPath(path);
  const format = await detectDocumentFormatFromBlob(target);
  if (format !== "markdown") {
    if (!OFFICE_FORMATS.has(format)) throw new Error(`Document format is not readable in the current browser phase: ${target}`);
    return readOfficeDocument(target, format, options);
  }
  const source = await readText(target);
  const parsed = parseMarkdown(source);
  const locator = options.locator || {};
  let content = source;
  let sourceLocator = { kind: "document", path: target };
  if (locator.kind === "line_range") {
    const lines = source.split("\n");
    const startLine = clampInteger(locator.startLine, 1, Math.max(lines.length, 1), 1);
    const endLine = clampInteger(locator.endLine, startLine, Math.max(lines.length, startLine), Math.min(lines.length, startLine + 199));
    content = lines.slice(startLine - 1, endLine).join("\n");
    sourceLocator = { kind: "line_range", startLine, endLine };
  } else if (locator.kind === "heading") {
    const heading = String(locator.heading || "").trim();
    if (!heading) throw new Error("document_read heading locator requires heading.");
    const index = parsed.blocks.findIndex((block) => block.type === "heading" && block.text === heading);
    if (index < 0) throw new Error(`Markdown heading not found: ${heading}`);
    const level = parsed.blocks[index].level;
    const selected = [parsed.blocks[index]];
    for (let cursor = index + 1; cursor < parsed.blocks.length; cursor += 1) {
      const block = parsed.blocks[cursor];
      if (block.type === "heading" && block.level <= level) break;
      selected.push(block);
    }
    content = markdownToText({ frontMatter: {}, blocks: selected });
    sourceLocator = { kind: "heading", heading, level };
  }
  const maxChars = clampInteger(options.maxChars, 500, 200_000, 20_000);
  const output = options.output === "json" ? boundedJsonOutput(parsed, maxChars, Boolean(locator.kind)) : "markdown";
  return {
    path: target,
    format: "markdown",
    ...(await vfsHash(target)),
    output,
    content: content.slice(0, maxChars),
    sourceLocator,
    truncated: content.length > maxChars,
    totalChars: content.length
  };
}

export function documentSchema(format, operation, options = {}) {
  const normalizedFormat = String(format || "").toLowerCase();
  const normalizedOperation = String(operation || "").toLowerCase();
  if (normalizedFormat !== "markdown") {
    if (["xlsx", "docx", "pptx"].includes(normalizedFormat) && ["create", "edit"].includes(normalizedOperation)) {
      return {
        format: normalizedFormat,
        operation: normalizedOperation,
        supported: true,
        schemaVersion: `${normalizedFormat}-1`,
        schema: normalizedOperation === "create"
          ? normalizedFormat === "xlsx"
            ? { type: "object", properties: { sheets: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } } }, required: ["sheets"], additionalProperties: false }
            : normalizedFormat === "docx"
              ? { type: "object", properties: { blocks: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } } }, required: ["blocks"], additionalProperties: false }
              : { type: "object", properties: { slides: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } } }, required: ["slides"], additionalProperties: false }
          : { type: "object", properties: { operations: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: true } }, editMode: { type: "string", enum: ["rebuild"] } }, required: ["operations", "editMode"], additionalProperties: false },
        examples: normalizedOperation === "create"
          ? normalizedFormat === "xlsx"
            ? { sheets: [{ name: "Data", rows: [["Name", "Value"], ["alpha", 1]] }] }
            : normalizedFormat === "docx"
              ? { blocks: [{ type: "heading", level: 1, text: "Report" }, { type: "paragraph", text: "Generated content" }] }
              : { slides: [{ title: "Overview", body: "Generated content" }] }
          : normalizedFormat === "xlsx"
            ? { editMode: "rebuild", operations: [{ op: "set_cell", sheet: "Data", cell: "B2", value: 2 }] }
            : normalizedFormat === "docx"
              ? { editMode: "rebuild", operations: [{ op: "replace_text", oldText: "Draft", newText: "Final" }] }
              : { editMode: "rebuild", operations: [{ op: "replace_text", oldText: "Draft", newText: "Final" }] }
      };
    }
    if (normalizedFormat === "pdf" && normalizedOperation === "create") {
      return {
        format: "pdf",
        operation: "create",
        supported: true,
        schemaVersion: "pdf-1",
        schema: { type: "object", properties: { pages: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } } }, required: ["pages"], additionalProperties: false },
        examples: { pages: [{ text: "Generated PDF page" }] }
      };
    }
    if (OFFICE_FORMATS.has(normalizedFormat) && normalizedOperation === "read") {
      return {
        format: normalizedFormat,
        operation: normalizedOperation,
        supported: true,
        schemaVersion: `${normalizedFormat}-read-1`,
        schema: {
          type: "object",
          properties: {
            path: { type: "string" },
            locator: { type: "object", additionalProperties: true },
            output: { type: "string", enum: ["markdown", "json"] },
            maxChars: { type: "integer", minimum: 500, maximum: MAX_DOCUMENT_TEXT_CHARS }
          },
          required: ["path"],
          additionalProperties: false
        },
        examples: { path: `/workspace/documents/example.${normalizedFormat}`, output: "markdown", maxChars: 12000 }
      };
    }
    if (OFFICE_FORMATS.has(normalizedFormat) && normalizedOperation === "export") {
      return {
        format: normalizedFormat,
        operation: "export",
        supported: true,
        schemaVersion: `${normalizedFormat}-export-1`,
        schema: { type: "object", properties: { targetFormat: { type: "string", enum: ["markdown", "json"] }, outputPath: { type: "string" } }, required: ["targetFormat", "outputPath"], additionalProperties: false },
        examples: { targetFormat: "markdown", outputPath: `/exports/document.${normalizedFormat}.md` }
      };
    }
    return {
      format: normalizedFormat || "unknown",
      operation: normalizedOperation || "unknown",
      supported: false,
      schemaVersion: "",
      error: `Operation ${normalizedOperation || "unknown"} is not supported for ${normalizedFormat || "unknown"}.`
    };
  }
  const schemas = {
    create: {
      type: "object",
      properties: {
        content: { type: "string" },
        blocks: { type: "array", items: { type: "object", additionalProperties: true } }
      },
      additionalProperties: false
    },
    edit: {
      type: "object",
      properties: {
        operations: { type: "array", items: { type: "object", additionalProperties: true }, minItems: 1, maxItems: 100 }
      },
      required: ["operations"],
      additionalProperties: false
    },
      read: {
        type: "object",
        properties: {
          locator: { type: "object", additionalProperties: true },
          output: { type: "string", enum: ["markdown", "json"] },
          maxChars: { type: "integer", minimum: 500, maximum: 200000 }
        },
        additionalProperties: false
      },
      export: {
      type: "object",
      properties: { targetFormat: { type: "string", enum: ["markdown", "html"] }, includeCss: { type: "boolean" } },
      required: ["targetFormat"],
      additionalProperties: false
    }
  };
  if (!schemas[normalizedOperation]) {
    throw new Error(`Unsupported Markdown document operation: ${normalizedOperation || "unknown"}`);
  }
  return {
    format: "markdown",
    operation: normalizedOperation,
    supported: true,
    schemaVersion: MARKDOWN_SCHEMA_VERSION,
    schema: schemas[normalizedOperation],
    examples: {
      create: { content: "# Project\n\n- First item" },
      edit: { operations: [{ op: "replace_text", oldText: "Draft", newText: "Final", replaceAll: false }] },
      export: { targetFormat: "html", includeCss: true },
      read: { output: "markdown", maxChars: 12000 }
    }[normalizedOperation]
  };
}

export async function documentCreate(args = {}) {
  const target = requiredPath(args.path);
  requireFormat(args.format, target);
  if (String(args.format).toLowerCase() === "xlsx") return documentCreateXlsx(target, args);
  if (String(args.format).toLowerCase() === "docx") return documentCreateDocx(target, args);
  if (String(args.format).toLowerCase() === "pptx") return documentCreatePptx(target, args);
  if (String(args.format).toLowerCase() === "pdf") return documentCreatePdf(target, args);
  ensureMarkdown(target);
  requireSchemaVersion(args.schemaVersion);
  const overwriteVersion = await prepareDocumentCreate(target, args);
  const content = markdownContentFromSpec(args.spec || {});
  const result = await vfsWriteFile(target, content, {
    mimeType: "text/markdown",
    createParents: args.createParents !== false,
    ...(overwriteVersion !== undefined ? { expectedVersion: overwriteVersion } : {})
  });
  return { path: target, format: "markdown", version: result.entry.version, contentChars: content.length, fidelity: "full", warnings: [] };
}

export async function documentEdit(args = {}) {
  const target = requiredPath(args.path);
  requireFormat(args.format, target);
  if (String(args.format).toLowerCase() === "xlsx") return documentEditXlsx(target, args);
  if (String(args.format).toLowerCase() === "docx") return documentEditDocx(target, args);
  if (String(args.format).toLowerCase() === "pptx") return documentEditPptx(target, args);
  ensureMarkdown(target);
  requireSchemaVersion(args.schemaVersion);
  const stat = await vfsStat(target);
  const currentHash = (await vfsHash(target)).hash;
  assertExpectedVersion(args, stat.entry.version, currentHash);
  const before = await readText(target);
  let after = before;
  const changes = [];
  for (const operation of requiredOperations(args.operations)) {
    const result = applyMarkdownOperation(after, operation);
    after = result.content;
    changes.push(result.change);
  }
  if (after === before) return { path: target, format: "markdown", version: stat.entry.version, hash: currentHash, changes: [], fidelity: "full", warnings: ["No content changed."] };
  await snapshotCurrentDocument(target, stat, currentHash);
  const written = await vfsWriteFile(target, after, { mimeType: stat.entry.mimeType || "text/markdown", expectedVersion: stat.entry.version });
  return { path: target, format: "markdown", version: written.entry.version, ...(await vfsHash(target)), changes, fidelity: "full", warnings: [] };
}

async function documentCreateXlsx(target, args) {
  requireSchemaVersionValue(args.schemaVersion, "xlsx-1");
  const overwriteVersion = await prepareDocumentCreate(target, args);
  const written = await vfsWriteFile(target, createXlsxBlob(args.spec || {}), {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    createParents: args.createParents !== false,
    ...(overwriteVersion !== undefined ? { expectedVersion: overwriteVersion } : {})
  });
  return { path: target, format: "xlsx", version: written.entry.version, fidelity: "rebuild", warnings: ["Generated XLSX contains values and formulas only; styles, charts, macros, and external links are not included."] };
}

async function documentEditXlsx(target, args) {
  requireSchemaVersionValue(args.schemaVersion, "xlsx-1");
  if (String(args.editMode || "") !== "rebuild") throw new Error("XLSX editing currently requires editMode=rebuild. Preserve-mode editing is not implemented.");
  const stat = await vfsStat(target);
  const currentHash = (await vfsHash(target)).hash;
  assertExpectedVersion(args, stat.entry.version, currentHash);
  const projection = await readXlsx(await vfsGetFileBlob(target));
  const changes = [];
  for (const operation of requiredOperations(args.operations)) {
    applyXlsxOperation(projection.json, operation);
    changes.push({ op: operation.op, sheet: operation.sheet || "", cell: operation.cell || "" });
  }
  await snapshotCurrentDocument(target, stat, currentHash);
  const written = await vfsWriteFile(target, createXlsxBlob(projection.json), { mimeType: stat.entry.mimeType, expectedVersion: stat.entry.version });
  return { path: target, format: "xlsx", version: written.entry.version, ...(await vfsHash(target)), changes, fidelity: "rebuild", warnings: ["XLSX was rebuilt from the supported cell/formula projection; styles, charts, macros, and external links were not preserved."] };
}

function applyXlsxOperation(workbook, operation = {}) {
  const sheet = workbook.sheets?.find((item) => item.name === String(operation.sheet || ""));
  if (!sheet) throw new Error(`XLSX sheet not found: ${operation.sheet || ""}`);
  const cellRef = String(operation.cell || "").toUpperCase();
  if (!/^[A-Z]+\d+$/.test(cellRef)) throw new Error(`XLSX cell is invalid: ${operation.cell || ""}`);
  const rowNumber = Number(cellRef.match(/\d+$/)[0]);
  const row = sheet.rows[rowNumber - 1] || (sheet.rows[rowNumber - 1] = []);
  if (operation.op === "set_cell") {
    const next = { ref: cellRef, value: String(operation.value ?? ""), formula: String(operation.formula || "") };
    const existing = row.find((cell) => cell.ref === cellRef);
    if (existing) Object.assign(existing, next); else row.push(next);
    return;
  }
  if (operation.op === "clear_cell") {
    sheet.rows[rowNumber - 1] = row.filter((cell) => cell.ref !== cellRef);
    return;
  }
  throw new Error(`Unsupported XLSX edit operation: ${operation.op || "unknown"}`);
}

function createXlsxBlob(spec) {
  if (!Array.isArray(spec.sheets) || !spec.sheets.length) throw new Error("XLSX spec requires at least one sheet.");
  const sheets = spec.sheets.slice(0, 100).map((sheet, index) => ({
    name: String(sheet.name || `Sheet${index + 1}`).slice(0, 31),
    rows: Array.isArray(sheet.rows) ? sheet.rows.slice(0, 1000).map((row, rowIndex) => normalizeXlsxRow(row, rowIndex + 1)) : []
  }));
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell) => `<c r="${cell.ref}"${cell.formula ? "" : " t=\"inlineStr\""}>${cell.formula ? `<f>${xmlEscape(cell.formula)}</f><v>${xmlEscape(cell.value)}</v>` : `<is><t>${xmlEscape(cell.value)}</t></is>`}</c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  });
  return zipStoredBlob(files);
}

function normalizeXlsxRow(row, rowNumber) {
  return (Array.isArray(row) ? row : []).slice(0, 200).map((value, index) => {
    if (value && typeof value === "object" && !Array.isArray(value)) return { ref: value.ref || `${columnName(index + 1)}${rowNumber}`, value: String(value.value ?? ""), formula: String(value.formula || "") };
    return { ref: `${columnName(index + 1)}${rowNumber}`, value: String(value ?? ""), formula: "" };
  });
}

function columnName(number) {
  let value = "";
  for (let current = number; current > 0; current = Math.floor((current - 1) / 26)) value = String.fromCharCode(65 + ((current - 1) % 26)) + value;
  return value;
}

function xmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
}

function zipStoredBlob(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(value);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); localView.setUint16(4, 20, true); localView.setUint32(14, checksum, true); localView.setUint32(18, data.length, true); localView.setUint32(22, data.length, true); localView.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
    locals.push(local);
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true); centralView.setUint32(16, checksum, true); centralView.setUint32(20, data.length, true); centralView.setUint32(24, data.length, true); centralView.setUint16(28, nameBytes.length, true); centralView.setUint32(42, offset, true); central.set(nameBytes, 46);
    centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22); const endView = new DataView(end.buffer); endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, centrals.length, true); endView.setUint16(10, centrals.length, true); endView.setUint32(12, centralSize, true); endView.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

async function documentCreateDocx(target, args) {
  requireSchemaVersionValue(args.schemaVersion, "docx-1");
  const overwriteVersion = await prepareDocumentCreate(target, args);
  const written = await vfsWriteFile(target, createDocxBlob(args.spec || {}), {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    createParents: args.createParents !== false,
    ...(overwriteVersion !== undefined ? { expectedVersion: overwriteVersion } : {})
  });
  return { path: target, format: "docx", version: written.entry.version, fidelity: "rebuild", warnings: ["Generated DOCX contains basic paragraphs, headings, lists, and tables only; complex layout and embedded objects are not included."] };
}

async function documentEditDocx(target, args) {
  requireSchemaVersionValue(args.schemaVersion, "docx-1");
  if (String(args.editMode || "") !== "rebuild") throw new Error("DOCX editing currently requires editMode=rebuild. Preserve-mode editing is not implemented.");
  const stat = await vfsStat(target);
  const currentHash = (await vfsHash(target)).hash;
  assertExpectedVersion(args, stat.entry.version, currentHash);
  const projection = await readDocx(await vfsGetFileBlob(target));
  const changes = [];
  for (const operation of requiredOperations(args.operations)) {
    applyDocxOperation(projection.json, operation);
    changes.push({ op: operation.op, paragraph: operation.paragraph || null });
  }
  await snapshotCurrentDocument(target, stat, currentHash);
  const written = await vfsWriteFile(target, createDocxBlob(projection.json), { mimeType: stat.entry.mimeType, expectedVersion: stat.entry.version });
  return { path: target, format: "docx", version: written.entry.version, ...(await vfsHash(target)), changes, fidelity: "rebuild", warnings: ["DOCX was rebuilt from the supported paragraph/table projection; styles, images, headers, fields, revisions, and unknown OOXML parts were not preserved."] };
}

async function documentCreatePptx(target, args) {
  requireSchemaVersionValue(args.schemaVersion, "pptx-1");
  const overwriteVersion = await prepareDocumentCreate(target, args);
  const written = await vfsWriteFile(target, createPptxBlob(args.spec || {}), { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", createParents: args.createParents !== false, ...(overwriteVersion !== undefined ? { expectedVersion: overwriteVersion } : {}) });
  return { path: target, format: "pptx", version: written.entry.version, fidelity: "rebuild", warnings: ["Generated PPTX contains basic text boxes only; themes, charts, images, animations, notes, and complex layouts are not included."] };
}

async function documentEditPptx(target, args) {
  requireSchemaVersionValue(args.schemaVersion, "pptx-1");
  if (String(args.editMode || "") !== "rebuild") throw new Error("PPTX editing currently requires editMode=rebuild. Preserve-mode editing is not implemented.");
  const stat = await vfsStat(target);
  const currentHash = (await vfsHash(target)).hash;
  assertExpectedVersion(args, stat.entry.version, currentHash);
  const projection = await readPptx(await vfsGetFileBlob(target));
  const changes = [];
  for (const operation of requiredOperations(args.operations)) {
    applyPptxOperation(projection.json, operation);
    changes.push({ op: operation.op, slide: operation.slide || null });
  }
  await snapshotCurrentDocument(target, stat, currentHash);
  const written = await vfsWriteFile(target, createPptxBlob(projection.json), { mimeType: stat.entry.mimeType, expectedVersion: stat.entry.version });
  return { path: target, format: "pptx", version: written.entry.version, ...(await vfsHash(target)), changes, fidelity: "rebuild", warnings: ["PPTX was rebuilt from the supported slide text projection; layout, images, charts, animations, notes, and unknown parts were not preserved."] };
}

function applyPptxOperation(document, operation = {}) {
  if (!Array.isArray(document.slides)) document.slides = [];
  if (operation.op === "replace_text") {
    const oldText = String(operation.oldText || "");
    let changed = false;
    for (const slide of document.slides) {
      if (!slide.text.includes(oldText)) continue;
      slide.text = operation.replaceAll === false ? slide.text.replace(oldText, String(operation.newText ?? "")) : slide.text.split(oldText).join(String(operation.newText ?? ""));
      changed = true;
      if (operation.replaceAll === false) break;
    }
    if (!changed) throw new Error(`PPTX text not found: ${oldText}`);
    return;
  }
  if (operation.op === "set_slide_text") {
    const slide = document.slides[Number(operation.slide) - 1];
    if (!slide) throw new Error(`PPTX slide not found: ${operation.slide}`);
    slide.text = String(operation.text ?? "");
    return;
  }
  if (operation.op === "append_slide") {
    document.slides.push({ slide: document.slides.length + 1, text: String(operation.text ?? "") });
    return;
  }
  throw new Error(`Unsupported PPTX edit operation: ${operation.op || "unknown"}`);
}

function createPptxBlob(spec) {
  const slides = (Array.isArray(spec.slides) ? spec.slides : []).slice(0, 100).map((slide, index) => ({ slide: index + 1, title: String(slide.title || `Slide ${index + 1}`), text: String(slide.body ?? slide.text ?? "") }));
  if (!slides.length) throw new Error("PPTX spec requires at least one slide.");
  const slideIds = slides.map((slide, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 3}"/>`).join("");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    "ppt/presentation.xml": `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>${slides.map((_, index) => `<Relationship Id="rId${index + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("")}</Relationships>`,
    "ppt/slideMasters/slideMaster1.xml": `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:sldMaster>`,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
    "ppt/slideLayouts/slideLayout1.xml": `<p:sldLayout xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:sldLayoutIdLst/></p:sldLayout>`,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    "ppt/theme/theme1.xml": `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="WebClaw"><a:themeElements><a:clrScheme name="WebClaw"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1></a:clrScheme><a:fontScheme name="WebClaw"><a:majorFont/><a:minorFont/></a:fontScheme><a:fmtScheme name="WebClaw"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`
  };
  slides.forEach((slide, index) => {
    const title = pptTextShape(2, "Title", slide.title, 457200, 274638, 11125200, 1200000);
    const body = pptTextShape(3, "Body", slide.text, 457200, 1800000, 11125200, 4200000);
    files[`ppt/slides/slide${index + 1}.xml`] = `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${title}${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    files[`ppt/slides/_rels/slide${index + 1}.xml.rels`] = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
  });
  return zipStoredBlob(files);
}

function pptTextShape(id, name, text, x, y, width, height) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>${xmlEscape(text)}</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`;
}

async function documentCreatePdf(target, args) {
  requireSchemaVersionValue(args.schemaVersion, "pdf-1");
  const overwriteVersion = await prepareDocumentCreate(target, args);
  const written = await vfsWriteFile(target, createPdfBlob(args.spec || {}), { mimeType: "application/pdf", createParents: args.createParents !== false, ...(overwriteVersion !== undefined ? { expectedVersion: overwriteVersion } : {}) });
  return { path: target, format: "pdf", version: written.entry.version, fidelity: "rebuild", warnings: ["Generated PDF contains simple text pages only; forms, images, layout, annotations, and embedded fonts are not included."] };
}

function createPdfBlob(spec) {
  const pages = (Array.isArray(spec.pages) ? spec.pages : []).slice(0, 100).map((page) => String(page?.text ?? page ?? ""));
  if (!pages.length) throw new Error("PDF spec requires at least one page.");
  if (pages.some((text) => /[^\x09\x0a\x0d\x20-\x7e]/.test(text))) throw new Error("The built-in PDF writer currently supports ASCII text only. Use DOCX or Markdown for non-ASCII content.");
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const kids = [];
  pages.forEach((text, index) => {
    const pageObject = 4 + index * 2;
    const contentObject = pageObject + 1;
    kids.push(`${pageObject} 0 R`);
    const lines = String(text).split(/\r?\n/).slice(0, 80);
    const commands = ["BT", "/F1 16 Tf", "72 740 Td", ...lines.map((line, lineIndex) => `${pdfString(line)} Tj${lineIndex < lines.length - 1 ? " 0 -22 Td" : ""}`), "ET"].join("\n");
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${utf8ByteLength(commands)} >>\nstream\n${commands}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = utf8ByteLength(output);
    output += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = utf8ByteLength(output);
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([output], { type: "application/pdf" });
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

function pdfString(value) {
  return `(${String(value || "").replace(/[\\()]/g, "\\$&").replace(/\r?\n/g, " ")})`;
}

function applyDocxOperation(document, operation = {}) {
  if (!Array.isArray(document.paragraphs)) document.paragraphs = [];
  if (operation.op === "replace_text") {
    const oldText = String(operation.oldText || "");
    if (!oldText) throw new Error("replace_text requires oldText.");
    let changed = false;
    for (const paragraph of document.paragraphs) {
      if (!paragraph.text.includes(oldText)) continue;
      paragraph.text = operation.replaceAll === false ? paragraph.text.replace(oldText, String(operation.newText ?? "")) : paragraph.text.split(oldText).join(String(operation.newText ?? ""));
      changed = true;
      if (operation.replaceAll === false) break;
    }
    if (!changed) throw new Error(`DOCX text not found: ${oldText}`);
    return;
  }
  if (operation.op === "set_paragraph") {
    const index = Number(operation.paragraph) - 1;
    if (!document.paragraphs[index]) throw new Error(`DOCX paragraph not found: ${operation.paragraph}`);
    document.paragraphs[index].text = String(operation.text ?? "");
    if (operation.style) document.paragraphs[index].style = String(operation.style);
    return;
  }
  if (operation.op === "append_paragraph") {
    document.paragraphs.push({ text: String(operation.text ?? ""), style: String(operation.style || "") });
    return;
  }
  throw new Error(`Unsupported DOCX edit operation: ${operation.op || "unknown"}`);
}

function createDocxBlob(spec) {
  const blocks = Array.isArray(spec.blocks) ? spec.blocks : Array.isArray(spec.paragraphs) ? spec.paragraphs.map((item) => ({ type: "paragraph", ...item })) : [];
  const paragraphs = [];
  const tables = [];
  for (const block of blocks) {
    if (block.type === "table") tables.push({ rows: Array.isArray(block.rows) ? block.rows : [] });
    else paragraphs.push({ text: String(block.text ?? block.content ?? ""), style: block.type === "heading" ? `Heading${clampInteger(block.level, 1, 6, 1)}` : block.type === "list" ? "ListParagraph" : String(block.style || "") });
  }
  return createDocxPackage({ paragraphs, tables });
}

function createDocxPackage(document) {
  const body = [
    ...document.paragraphs.map((paragraph) => `<w:p><w:pPr>${paragraph.style ? `<w:pStyle w:val="${xmlEscape(paragraph.style)}"/>` : ""}</w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(paragraph.text)}</w:t></w:r></w:p>`),
    ...document.tables.map((table) => `<w:tbl>${table.rows.map((row) => `<w:tr>${(Array.isArray(row) ? row : []).map((cell) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${xmlEscape(typeof cell === "object" ? cell.value ?? "" : cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`),
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>`
  ].join("");
  return zipStoredBlob({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    "word/styles.xml": `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`
  });
}

export async function documentRender(args = {}) {
  const target = requiredPath(args.path);
  ensureMarkdown(target);
  const source = await readText(target);
  const hash = (await vfsHash(target)).hash.slice(0, 16);
  const outputPath = String(args.outputPath || `/cache/document-previews/${hash}.html`);
  const html = renderMarkdown(source, { title: args.title || target.split("/").at(-1) });
  const written = await vfsWriteFile(outputPath, html, { mimeType: "text/html", createParents: true });
  return { path: target, format: "markdown", outputPath, version: written.entry.version, fidelity: "full", warnings: [] };
}

export async function documentExport(args = {}) {
  const target = requiredPath(args.path);
  const targetFormat = String(args.targetFormat || "").toLowerCase();
  const outputPath = requiredPath(args.outputPath);
  if (outputPath === target) throw new Error("document_export outputPath must differ from the source path.");
  const format = await detectDocumentFormatFromBlob(target);
  if (format !== "markdown") {
    if (!OFFICE_FORMATS.has(format) || !["markdown", "json"].includes(targetFormat)) throw new Error(`Unsupported ${format} export format: ${targetFormat || "unknown"}`);
    const projection = await readOfficeDocument(target, format, { output: targetFormat, maxChars: MAX_DOCUMENT_TEXT_CHARS });
    const content = targetFormat === "json" ? JSON.stringify(projection.output, null, 2) : projection.content;
    const written = await vfsWriteFile(outputPath, content, { mimeType: targetFormat === "json" ? "application/json" : "text/markdown", createParents: true });
    return { path: target, format, outputPath, targetFormat, version: written.entry.version, contentChars: content.length, fidelity: "projection", warnings: projection.warnings };
  }
  if (!["markdown", "html"].includes(targetFormat)) throw new Error(`Unsupported Markdown export format: ${targetFormat || "unknown"}`);
  const source = await readText(target);
  const content = targetFormat === "html" ? renderMarkdown(source, { title: outputPath.split("/").at(-1) }) : source;
  const written = await vfsWriteFile(outputPath, content, { mimeType: targetFormat === "html" ? "text/html" : "text/markdown", createParents: true });
  return { path: target, outputPath, targetFormat, version: written.entry.version, contentChars: content.length, fidelity: "full", warnings: [] };
}

export async function documentRevision(args = {}) {
  const target = requiredPath(args.path);
  const action = String(args.action || "list").toLowerCase();
  if (action === "list") return { path: target, revisions: await listDocumentRevisions(target, args) };
  if (action === "snapshot") {
    const stat = await vfsStat(target);
    const blob = await vfsGetFileBlob(target);
    return { path: target, action, revision: await saveDocumentRevision(target, blob, { version: stat.entry.version, hash: (await vfsHash(target)).hash, mimeType: stat.entry.mimeType }) };
  }
  if (action === "restore") {
    const revision = await getDocumentRevision(requiredRevisionId(args.revisionId));
    if (!revision || revision.path !== target) throw new Error("Document revision was not found for this path.");
    const stat = await vfsStat(target);
    const currentHash = (await vfsHash(target)).hash;
    assertExpectedVersion(args, stat.entry.version, currentHash);
    await snapshotCurrentDocument(target, stat, currentHash);
    const written = await vfsWriteFile(target, revision.blob, { mimeType: revision.mimeType, expectedVersion: stat.entry.version });
    return { path: target, action, revisionId: revision.id, version: written.entry.version, ...(await vfsHash(target)), fidelity: "original_snapshot", warnings: [] };
  }
  if (action === "purge") {
    if (args.confirm !== true) throw new Error("Purging document revisions requires confirm=true.");
    if (args.revisionId) {
      const revision = await getDocumentRevision(requiredRevisionId(args.revisionId));
      if (!revision || revision.path !== target) throw new Error("Document revision was not found for this path.");
      await deleteDocumentRevision(revision.id);
      return { path: target, action, purged: 1, revisionId: revision.id };
    }
    return { path: target, action, purged: await deleteDocumentRevisions(target) };
  }
  throw new Error(`Unsupported document revision action: ${action}`);
}

export function detectDocumentFormat(path, mimeType = "") {
  const extension = extensionOf(path);
  if (MARKDOWN_EXTENSIONS.has(extension) || /(?:markdown|commonmark)/i.test(mimeType)) return "markdown";
  if (OFFICE_EXTENSIONS.has(extension)) return "unsupported";
  return "unsupported";
}

async function detectDocumentFormatFromBlob(path, mimeType = "") {
  const byPath = detectDocumentFormat(path, mimeType);
  if (byPath === "markdown") return byPath;
  const blob = await vfsGetFileBlob(path);
  if (blob.size > MAX_DOCUMENT_BYTES) throw new Error(`Document exceeds the browser limit of ${MAX_DOCUMENT_BYTES} bytes: ${path}`);
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const zip = await readZip(blob);
    if (zip.has("word/document.xml")) return "docx";
    if (zip.has("xl/workbook.xml")) return "xlsx";
    if (zip.has("ppt/presentation.xml")) return "pptx";
  }
  return byPath;
}

async function inspectOfficeDocument(path, format) {
  const result = await readOfficeDocument(path, format, { maxChars: 2000, inspectOnly: true });
  return result.structure || {};
}

async function readOfficeDocument(path, format, options = {}) {
  const blob = await vfsGetFileBlob(path);
  if (blob.size > MAX_DOCUMENT_BYTES) throw new Error(`Document exceeds the browser limit of ${MAX_DOCUMENT_BYTES} bytes: ${path}`);
  const projection = format === "docx"
    ? await readDocx(blob)
    : format === "xlsx"
      ? await readXlsx(blob)
      : format === "pptx"
        ? await readPptx(blob)
        : await readPdf(blob);
  const maxChars = clampInteger(options.maxChars, 500, MAX_DOCUMENT_TEXT_CHARS, 20_000);
  const selectedProjection = selectOfficeProjection(projection, options.locator);
  const content = selectedProjection.markdown || "";
  const bounded = applyDocumentLocator(content, selectedProjection.locator ? null : options.locator, maxChars);
  const output = options.output === "json"
    ? boundedJsonOutput(selectedProjection.json ?? projection.json, maxChars, Boolean(options.locator?.kind))
    : "markdown";
  return {
    path,
    format,
    ...(await vfsHash(path)),
    output,
    content: bounded.content,
    sourceLocator: selectedProjection.locator || bounded.sourceLocator,
    locators: projection.locators || [],
    truncated: bounded.truncated,
    totalChars: content.length,
    structure: projection.structure,
    fidelity: "projection",
    warnings: projection.warnings || ["This is a read-only structured projection; original Office/PDF bytes are preserved in VFS."]
  };
}

async function readDocx(blob) {
  const zip = await readZip(blob);
  const xml = parseXml(await zipText(zip, "word/document.xml"));
  const paragraphs = [...xml.getElementsByTagName("w:p")].map((paragraph) => {
    const text = [...paragraph.getElementsByTagName("w:t")].map((node) => node.textContent || "").join("");
    const style = paragraph.getElementsByTagName("w:pStyle")[0]?.getAttribute("w:val") || "";
    return { text, style };
  }).filter((item) => item.text);
  const tables = [...xml.getElementsByTagName("w:tbl")].map((table) => [...table.getElementsByTagName("w:tr")].map((row) =>
    [...row.getElementsByTagName("w:tc")].map((cell) => [...cell.getElementsByTagName("w:t")].map((node) => node.textContent || "").join(""))
  ));
  const markdown = [
    ...paragraphs.map((item) => /^heading[1-6]$/i.test(item.style) ? `${"#".repeat(Number(item.style.match(/[1-6]/)?.[0] || 1))} ${item.text}` : item.text),
    ...tables.flatMap((table) => table.length ? ["", "| " + table[0].join(" | ") + " |", "| " + table[0].map(() => "---").join(" | ") + " |", ...table.slice(1).map((row) => `| ${row.join(" | ")} |`)] : [])
  ].join("\n\n");
  return {
    markdown,
    json: { paragraphs, tables },
    locators: withLocatorOffsets(markdown, paragraphs.map((item, index) => ({ kind: "docx_paragraph", paragraph: index + 1, text: item.text }))),
    structure: { sections: countTags(xml, "w:sectPr"), paragraphs: paragraphs.length, tables: tables.length, images: countTags(xml, "a:blip") },
    warnings: ["DOCX reading currently returns paragraphs and table projections; formatting and embedded objects are not fully represented."]
  };
}

async function readXlsx(blob) {
  const zip = await readZip(blob);
  const shared = zip.has("xl/sharedStrings.xml") ? parseXml(await zipText(zip, "xl/sharedStrings.xml")) : null;
  const sharedStrings = shared ? [...shared.getElementsByTagName("si")].map((item) => [...item.getElementsByTagName("t")].map((node) => node.textContent || "").join("")) : [];
  const workbook = parseXml(await zipText(zip, "xl/workbook.xml"));
  const rels = zip.has("xl/_rels/workbook.xml.rels") ? parseXml(await zipText(zip, "xl/_rels/workbook.xml.rels")) : null;
  const sheets = [...workbook.getElementsByTagName("sheet")].map((sheet, index) => {
    const relation = sheet.getAttribute("r:id");
    const relationship = rels && [...rels.getElementsByTagName("Relationship")].find((item) => item.getAttribute("Id") === relation);
    const target = relationship?.getAttribute("Target") || `worksheets/sheet${index + 1}.xml`;
    return { name: sheet.getAttribute("name") || `Sheet${index + 1}`, path: target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}` };
  });
  const resultSheets = [];
  for (const sheet of sheets.slice(0, 100)) {
    if (!zip.has(sheet.path)) continue;
    const xml = parseXml(await zipText(zip, sheet.path));
    const rows = [...xml.getElementsByTagName("row")].slice(0, 1000).map((row) => [...row.getElementsByTagName("c")].slice(0, 200).map((cell) => {
      const type = cell.getAttribute("t") || "";
      const value = cell.getElementsByTagName("v")[0]?.textContent || [...cell.getElementsByTagName("t")].map((node) => node.textContent || "").join("");
      return { ref: cell.getAttribute("r") || "", value: type === "s" ? sharedStrings[Number(value)] || "" : value, formula: cell.getElementsByTagName("f")[0]?.textContent || "" };
    }));
    resultSheets.push({ name: sheet.name, rows });
  }
  const markdown = resultSheets.map((sheet) => `## ${sheet.name}\n\n${sheet.rows.map((row) => `| ${row.map((cell) => cell.value).join(" | ")} |`).join("\n")}`).join("\n\n");
  return {
    markdown,
    json: { sheets: resultSheets },
    locators: withLocatorOffsets(markdown, resultSheets.flatMap((sheet) => sheet.rows.flatMap((row, rowIndex) => row.map((cell) => ({ kind: "xlsx_cell", sheet: sheet.name, cell: cell.ref, row: rowIndex + 1, text: cell.value }))))),
    structure: { sheets: resultSheets.length, rows: resultSheets.reduce((sum, sheet) => sum + sheet.rows.length, 0), cells: resultSheets.reduce((sum, sheet) => sum + sheet.rows.reduce((count, row) => count + row.length, 0), 0) },
    warnings: ["XLSX reading currently returns bounded cell values and formulas; styles, charts, macros, external links, and formula recalculation are not executed."]
  };
}

async function readPptx(blob) {
  const zip = await readZip(blob);
  const slides = [...zip.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]));
  const resultSlides = [];
  for (const [index, name] of slides.entries()) {
    const xml = parseXml(await zipText(zip, name));
    resultSlides.push({ slide: index + 1, text: [...xml.getElementsByTagName("a:t")].map((node) => node.textContent || "").join("\n") });
  }
  const markdown = resultSlides.map((slide) => `## Slide ${slide.slide}\n\n${slide.text}`).join("\n\n");
  return {
    markdown,
    json: { slides: resultSlides },
    locators: withLocatorOffsets(markdown, resultSlides.map((slide) => ({ kind: "pptx_slide", slide: slide.slide, text: slide.text }))),
    structure: { slides: resultSlides.length, textRuns: resultSlides.reduce((sum, slide) => sum + slide.text.split("\n").filter(Boolean).length, 0) },
    warnings: ["PPTX reading currently returns slide text only; layout, notes, images, charts, animations, and master slides are not fully represented."]
  };
}

async function readPdf(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const raw = new TextDecoder("latin1").decode(bytes);
  const pageCount = Math.max(1, (raw.match(/\/Type\s*\/Page\b/g) || []).length);
  const strings = [...raw.matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g)].map((match) => decodePdfString(match[1])).filter(Boolean);
  const text = strings.join(" ").replace(/\s+/g, " ").trim();
  const markdown = `# PDF\n\nPages: ${pageCount}\n\n${text}`;
  return {
    markdown,
    json: { pages: pageCount, text },
    locators: [],
    structure: { pages: pageCount, extractedStrings: strings.length },
    warnings: ["PDF reading uses a conservative text projection. Compressed streams, layout coordinates, forms, images, and scanned-page OCR require a later PDF adapter."]
  };
}

function decodePdfString(value) {
  return String(value || "").replace(/\\([\\()nrtbf])/g, (_, code) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "\\": "\\", "(": "(", ")": ")" }[code] || code));
}

function applyDocumentLocator(content, locator = {}, maxChars) {
  let selected = content;
  let sourceLocator = { kind: "document" };
  if (locator?.kind === "line_range") {
    const lines = content.split("\n");
    const startLine = clampInteger(locator.startLine, 1, Math.max(lines.length, 1), 1);
    const endLine = clampInteger(locator.endLine, startLine, Math.max(lines.length, startLine), Math.min(lines.length, startLine + 199));
    selected = lines.slice(startLine - 1, endLine).join("\n");
    sourceLocator = { kind: "line_range", startLine, endLine };
  } else if (locator?.kind === "heading") {
    const heading = String(locator.heading || "").trim();
    const lines = content.split("\n");
    const index = lines.findIndex((line) => line.replace(/^#+\s+/, "").trim() === heading);
    if (index < 0) throw new Error(`Document heading not found: ${heading}`);
    const level = (lines[index].match(/^#+/) || ["#"])[0].length;
    let end = index + 1;
    while (end < lines.length && !(/^#+\s+/.test(lines[end]) && lines[end].match(/^#+/)[0].length <= level)) end += 1;
    selected = lines.slice(index, end).join("\n");
    sourceLocator = { kind: "heading", heading, level };
  }
  return { content: selected.slice(0, maxChars), sourceLocator, truncated: selected.length > maxChars };
}

function selectOfficeProjection(projection, locator) {
  if (locator?.kind === "pdf_page") {
    throw new Error("PDF page-level reading is unavailable until the PDF adapter can isolate page streams. Read the bounded document projection without pdf_page locator.");
  }
  if (!locator || !projection.locators?.length) return { markdown: projection.markdown, json: projection.json };
  if (locator.kind === "docx_paragraph") {
    const item = projection.locators.find((entry) => entry.kind === locator.kind && Number(entry.paragraph) === Number(locator.paragraph));
    if (!item) throw new Error(`DOCX paragraph not found: ${locator.paragraph}`);
    return { markdown: item.text, json: { paragraph: item.paragraph, text: item.text }, locator: item };
  }
  if (locator.kind === "xlsx_cell") {
    const item = projection.locators.find((entry) => entry.kind === locator.kind && entry.sheet === locator.sheet && entry.cell === locator.cell);
    if (!item) throw new Error(`XLSX cell not found: ${locator.sheet}!${locator.cell}`);
    return { markdown: `## ${item.sheet}!${item.cell}\n\n${item.text}`, json: { sheet: item.sheet, cell: item.cell, value: item.text }, locator: item };
  }
  if (locator.kind === "pptx_slide") {
    const item = projection.locators.find((entry) => entry.kind === locator.kind && Number(entry.slide) === Number(locator.slide));
    if (!item) throw new Error(`PPTX slide not found: ${locator.slide}`);
    return { markdown: `## Slide ${item.slide}\n\n${item.text}`, json: { slide: item.slide, text: item.text }, locator: item };
  }
  return { markdown: projection.markdown };
}

function boundedJsonOutput(value, maxChars, hasLocator) {
  const size = JSON.stringify(value).length;
  if (size > maxChars) throw new Error(`Structured document projection is ${size} characters, above maxChars=${maxChars}. ${hasLocator ? "Use a narrower locator." : "Use a format-specific locator or Markdown projection."}`);
  return value;
}

function withLocatorOffsets(markdown, locators) {
  let cursor = 0;
  return locators.map((locator) => {
    const text = String(locator.text || "");
    const offsetStart = text ? Math.max(cursor, markdown.indexOf(text, cursor)) : cursor;
    const safeStart = offsetStart < 0 ? cursor : offsetStart;
    const next = { ...locator, offsetStart: safeStart, offsetEnd: safeStart + text.length };
    cursor = safeStart + text.length;
    return next;
  });
}

function parseXml(source) {
  return parseXmlSync(source);
}

function parseXmlSync(source) {
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(String(source || ""), "application/xml");
    if (document.querySelector("parsererror")) throw new Error("Document XML is malformed or unsupported.");
    return document;
  }
  return parseSimpleXml(String(source || ""));
}

function parseSimpleXml(source) {
  const root = new SimpleXmlNode("#document");
  const stack = [root];
  for (const token of source.matchAll(/<[^>]+>|[^<]+/g)) {
    const value = token[0];
    if (!value.startsWith("<")) {
      stack.at(-1).text += decodeXmlEntities(value);
      continue;
    }
    if (/^<\/?(?:!|\?)/.test(value)) continue;
    if (value.startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = /\/\s*>$/.test(value);
    const body = value.slice(1, value.length - (selfClosing ? 2 : 1)).trim();
    const name = body.match(/^([^\s/>]+)/)?.[1];
    if (!name) continue;
    const node = new SimpleXmlNode(name);
    for (const attribute of body.matchAll(/([^\s=/>]+)\s*=\s*(["'])(.*?)\2/g)) node.attributes[attribute[1]] = decodeXmlEntities(attribute[3]);
    stack.at(-1).children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

class SimpleXmlNode {
  constructor(name) {
    this.name = name;
    this.children = [];
    this.attributes = Object.create(null);
    this.text = "";
  }

  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  getElementsByTagName(name) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.name === name) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

function decodeXmlEntities(value) {
  return String(value || "").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity.toLowerCase() === "amp") return "&";
    if (entity.toLowerCase() === "lt") return "<";
    if (entity.toLowerCase() === "gt") return ">";
    if (entity.toLowerCase() === "quot") return '"';
    if (entity.toLowerCase() === "apos") return "'";
    const code = entity.toLowerCase().startsWith("#x") ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}

function countTags(document, tagName) {
  return document.getElementsByTagName(tagName).length;
}

async function zipText(zip, path) {
  const bytes = await zip.get(path);
  if (!bytes) throw new Error(`Document part is missing: ${path}`);
  return new TextDecoder().decode(bytes);
}

async function readZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error("Office package is not a valid ZIP container.");
  const count = view.getUint16(eocd + 10, true);
  if (count > MAX_ZIP_ENTRIES) throw new Error(`Office package has too many ZIP entries (${count}).`);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  let totalUncompressed = 0;
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Office ZIP central directory is invalid.");
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error(`Office package contains an unsafe ZIP path: ${name}`);
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES || compressedSize > MAX_ZIP_ENTRY_BYTES) throw new Error(`Office ZIP entry exceeds the per-entry limit: ${name}`);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) throw new Error("Office package exceeds the total uncompressed size limit.");
    entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  const get = async (path) => {
    const entry = entries.get(path);
    if (!entry) return null;
    const local = entry.localOffset;
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error(`Office ZIP entry is invalid: ${path}`);
    const nameLength = view.getUint16(local + 26, true);
    const extraLength = view.getUint16(local + 28, true);
    const compressed = bytes.slice(local + 30 + nameLength + extraLength, local + 30 + nameLength + extraLength + entry.compressedSize);
    if (entry.method === 0) return compressed;
    if (entry.method !== 8 || typeof DecompressionStream === "undefined") throw new Error("Compressed Office packages require the browser DecompressionStream API.");
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const result = new Uint8Array(await new Response(stream).arrayBuffer());
    if (entry.uncompressedSize && result.byteLength !== entry.uncompressedSize) throw new Error(`Office ZIP entry size mismatch: ${path}`);
    return result;
  };
  const cache = new Map();
  const read = async (path) => { if (!cache.has(path)) cache.set(path, await get(path)); return cache.get(path); };
  return {
    has: (path) => entries.has(path),
    keys: () => entries.keys(),
    get: read
  };
}

function applyMarkdownOperation(content, operation = {}) {
  const op = String(operation.op || "");
  if (op === "replace_text") {
    const oldText = String(operation.oldText || "");
    if (!oldText) throw new Error("replace_text requires oldText.");
    const count = content.split(oldText).length - 1;
    if (!count) throw new Error(`replace_text did not find oldText: ${oldText}`);
    if (!operation.replaceAll && count !== 1) throw new Error(`replace_text matched ${count} locations; provide more context or set replaceAll=true.`);
    return { content: operation.replaceAll ? content.split(oldText).join(String(operation.newText ?? "")) : content.replace(oldText, String(operation.newText ?? "")), change: { op, occurrences: operation.replaceAll ? count : 1 } };
  }
  if (op === "insert_after_heading" || op === "replace_heading_section") {
    const heading = String(operation.heading || "").trim();
    if (!heading || typeof operation.content !== "string") throw new Error(`${op} requires heading and content.`);
    const lines = content.split("\n");
    const index = lines.findIndex((line) => stripHeading(line) === heading);
    if (index < 0) throw new Error(`Heading not found: ${heading}`);
    const level = (lines[index].match(/^\s*(#+)/) || ["", "#"])[1].length;
    let end = index + 1;
    while (end < lines.length) {
      const next = lines[end].match(/^\s*(#+)\s+/);
      if (next && next[1].length <= level) break;
      end += 1;
    }
    const inserted = String(operation.content).replace(/\r\n?/g, "\n").split("\n");
    const nextLines = op === "insert_after_heading"
      ? [...lines.slice(0, index + 1), "", ...inserted, "", ...lines.slice(index + 1)]
      : [...lines.slice(0, index + 1), "", ...inserted, "", ...lines.slice(end)];
    return { content: nextLines.join("\n"), change: { op, heading } };
  }
  if (op === "set_front_matter") {
    const key = String(operation.key || "").trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) throw new Error("set_front_matter key is invalid.");
    const lines = content.split("\n");
    if (lines[0] === "---") {
      const end = lines.indexOf("---", 1);
      if (end > 0) {
        const position = lines.slice(1, end).findIndex((line) => line.startsWith(`${key}:`));
        const serialized = `${key}: ${frontMatterString(operation.value)}`;
        if (position >= 0) lines[position + 1] = serialized;
        else lines.splice(end, 0, serialized);
        return { content: lines.join("\n"), change: { op, key } };
      }
    }
    return { content: ["---", `${key}: ${frontMatterString(operation.value)}`, "---", "", content].join("\n"), change: { op, key } };
  }
  throw new Error(`Unsupported Markdown operation: ${op || "unknown"}`);
}

function markdownContentFromSpec(spec) {
  if (typeof spec.content === "string") return spec.content;
  if (!Array.isArray(spec.blocks)) throw new Error("Markdown document spec requires content or blocks.");
  return spec.blocks.map((block) => {
    if (block.type === "heading") return `${"#".repeat(clampInteger(block.level, 1, 6, 1))} ${String(block.text || "")}`;
    if (block.type === "paragraph") return String(block.text || "");
    if (block.type === "code") return `\`\`\`${String(block.language || "")}\n${String(block.content || "")}\n\`\`\``;
    if (block.type === "list") return (block.items || []).map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${String(item.text || item)}`).join("\n");
    if (block.type === "raw") return String(block.content || "");
    throw new Error(`Unsupported Markdown block type: ${block.type || "unknown"}`);
  }).join("\n\n");
}

async function readText(path) {
  const file = await vfsReadFile(path, { maxChars: 1_000_000 });
  if (!file.isText) throw new Error(`Markdown file is not text: ${path}`);
  if (file.truncated) throw new Error(`Markdown file is too large for the current browser phase: ${path}`);
  return file.content;
}

function ensureMarkdown(path) {
  if (detectDocumentFormat(path) !== "markdown") throw new Error(`Only Markdown is implemented in the current phase: ${path}`);
}

function requireFormat(format, path) {
  const extension = extensionOf(path);
  const expected = OFFICE_FORMATS.has(extension) ? extension : detectDocumentFormat(path);
  if (String(format || "").toLowerCase() !== expected) throw new Error(`Document format does not match path: expected ${expected}, received ${format || "unknown"}.`);
}

function assertExpectedVersion(args, version, hash) {
  if (args.expectedVersion === undefined && !args.expectedHash) throw new Error("Document edits require expectedVersion or expectedHash. Inspect the document first.");
  if (args.expectedVersion !== undefined && Number(args.expectedVersion) !== Number(version)) throw new Error(`Document version conflict: expected ${args.expectedVersion}, current ${version}.`);
  if (args.expectedHash && String(args.expectedHash) !== hash) throw new Error("Document hash conflict. Read the document again before editing.");
}

async function prepareDocumentCreate(target, args) {
  if (!args.overwrite) {
    try {
      await vfsStat(target);
      throw new Error(`Document already exists: ${target}. Set overwrite=true only when replacement is intentional.`);
    } catch (error) {
      if (!/No such file/i.test(error.message || "")) throw error;
    }
    return undefined;
  }
  const stat = await vfsStat(target);
  const currentHash = (await vfsHash(target)).hash;
  if (args.expectedVersion === undefined && !args.expectedHash) throw new Error("Document overwrite requires expectedVersion or expectedHash. Inspect the document first.");
  assertExpectedVersion(args, stat.entry.version, currentHash);
  await snapshotCurrentDocument(target, stat, currentHash);
  return stat.entry.version;
}

async function snapshotCurrentDocument(target, stat, hash) {
  return saveDocumentRevision(target, await vfsGetFileBlob(target), {
    version: stat.entry.version,
    hash,
    mimeType: stat.entry.mimeType
  });
}

function requireSchemaVersion(value) {
  if (String(value || "") !== MARKDOWN_SCHEMA_VERSION) throw new Error(`Markdown document schemaVersion must be ${MARKDOWN_SCHEMA_VERSION}. Call document_schema first.`);
}

function requireSchemaVersionValue(value, expected) {
  if (String(value || "") !== expected) throw new Error(`Document schemaVersion must be ${expected}. Call document_schema first.`);
}

function requiredOperations(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new Error("operations must contain 1 to 100 items.");
  return value;
}

function stripHeading(line) {
  return String(line || "").replace(/^\s*#+\s+/, "").replace(/\s+#+\s*$/, "").trim();
}

function frontMatterString(value) {
  if (typeof value === "string") return /[\s:#]/.test(value) ? JSON.stringify(value) : value;
  return JSON.stringify(value);
}

function requiredPath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/")) throw new Error("Document path must be an absolute VFS path.");
  return path;
}

function requiredRevisionId(value) {
  const id = String(value || "").trim();
  if (!id) throw new Error("revisionId is required.");
  return id;
}

function extensionOf(path) {
  return String(path || "").split("/").at(-1).split(".").at(-1)?.toLowerCase() || "";
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}
