import { DocumentSpecError } from "./document-errors.js";
import { resolveDocumentTemplate } from "./template-registry.js";

export const RICH_DOCUMENT_SCHEMA_VERSIONS = Object.freeze({ docx: "docx-2", xlsx: "xlsx-2", pptx: "pptx-2", pdf: "pdf-2" });
export const MAX_RICH_SPEC_CHARS = 5 * 1024 * 1024;
const FORMATS = new Set(Object.keys(RICH_DOCUMENT_SCHEMA_VERSIONS));
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const ASSET_PATTERN = /^\/(?:workspace|templates|inbox|exports|cache)(?:\/|$)/;

export function richDocumentSchema(format, actions = []) {
  const normalized = normalizeFormat(format);
  const selected = new Set(Array.isArray(actions) && actions.length ? actions : ["root"]);
  const schema = {
    type: "object",
    properties: {
      document: { type: "object", additionalProperties: true },
      theme: { type: "object", additionalProperties: true },
      dataSources: { type: "array", items: { type: "object", additionalProperties: true }, maxItems: 100 },
      content: { type: "array", items: { type: "object", additionalProperties: true }, maxItems: 500 }
    },
    required: [],
    additionalProperties: false
  };
  if (normalized === "xlsx") {
    schema.properties.workbook = { type: "object", additionalProperties: true };
    schema.properties.worksheets = { type: "array", items: { type: "object", additionalProperties: true }, maxItems: 50 };
    schema.required = ["worksheets"];
  } else if (normalized === "pptx") {
    schema.properties.presentation = { type: "object", additionalProperties: true };
    schema.properties.slides = { type: "array", items: { type: "object", additionalProperties: true }, minItems: 1, maxItems: 100 };
    schema.required = ["slides"];
  } else {
    schema.required = ["content"];
  }
  if (selected.has("theme")) schema.properties.theme = richThemeSchema();
  if (selected.has("charts")) schema.properties.charts = chartSchema();
  if (selected.has("tables")) schema.properties.tables = tableSchema();
  return schema;
}

export function normalizeRichDocumentSpec(format, spec, options = {}) {
  const normalizedFormat = normalizeFormat(format);
  const source = cloneObject(spec);
  const serializedSize = JSON.stringify(source).length;
  if (serializedSize > MAX_RICH_SPEC_CHARS) {
    throw new DocumentSpecError("document_resource_limit", `Rich document Spec exceeds ${MAX_RICH_SPEC_CHARS} characters.`, { size: serializedSize, maxChars: MAX_RICH_SPEC_CHARS }, { stage: "validation", suggestedActions: ["split_document", "remove_unused_assets"] });
  }
  const template = options.templateId ? resolveDocumentTemplate(options.templateId, normalizedFormat) : null;
  const result = {
    ...source,
    document: normalizeMetadata(source.document),
    theme: normalizeTheme({ ...(template?.theme || {}), ...(source.theme || {}) }),
    dataSources: normalizeArray(source.dataSources),
    templateId: options.templateId || source.templateId || null,
    templateVersion: template?.templateVersion || source.templateVersion || null,
    format: normalizedFormat,
    schemaVersion: RICH_DOCUMENT_SCHEMA_VERSIONS[normalizedFormat]
  };
  if (normalizedFormat === "xlsx") result.worksheets = normalizeWorksheets(source.worksheets);
  else if (normalizedFormat === "pptx") result.slides = normalizeSlides(source.slides);
  else result.content = normalizeBlocks(source.content);
  collectAndValidateAssets(result);
  return result;
}

export function collectAssetPaths(value) {
  const paths = new Set();
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    if (typeof item.path === "string" && (item.alt !== undefined || item.fit !== undefined || item.crop !== undefined || /\.(?:png|jpe?g|webp|svg|gif|bmp)$/i.test(item.path))) paths.add(item.path);
    for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  return [...paths];
}

function normalizeFormat(format) {
  const normalized = String(format || "").toLowerCase();
  if (!FORMATS.has(normalized)) throw new DocumentSpecError("document_schema_version_unsupported", `Rich document generation is not supported for ${normalized || "unknown"}.`, { format: normalized });
  return normalized;
}

function cloneObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DocumentSpecError("document_operation_invalid", "Rich document spec must be a JSON object.");
  try { return JSON.parse(JSON.stringify(value)); } catch { throw new DocumentSpecError("document_operation_invalid", "Rich document spec must be JSON serializable."); }
}

function normalizeMetadata(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DocumentSpecError("document_operation_invalid", "document metadata must be an object.");
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? "").slice(0, 1000)]));
}

function normalizeTheme(theme) {
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) throw new DocumentSpecError("document_operation_invalid", "theme must be an object.");
  const colors = theme.colors && typeof theme.colors === "object" ? theme.colors : {};
  for (const [key, value] of Object.entries(colors)) if (typeof value !== "string" || (!COLOR_PATTERN.test(value) && !/^\$[A-Za-z][\w.-]*$/.test(value))) throw new DocumentSpecError("document_operation_invalid", `Invalid theme color: ${key}.`, { value });
  const fonts = theme.fonts && typeof theme.fonts === "object" ? Object.fromEntries(Object.entries(theme.fonts).map(([key, value]) => [key, String(value).slice(0, 120)])) : {};
  return { ...theme, preset: String(theme.preset || "minimal"), colors, fonts };
}

function normalizeBlocks(value) {
  if (!Array.isArray(value) || value.length > 500) throw new DocumentSpecError("document_operation_invalid", "Document content must be an array with at most 500 blocks.");
  return value.map((block, index) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) throw new DocumentSpecError("document_operation_invalid", `Content block ${index + 1} must be an object.`);
    const type = String(block.type || "");
    if (!/^(cover|toc|heading|paragraph|list|quote|callout|table|image|chart|page_break|section_break|references|appendix|summary|actions)$/.test(type)) throw new DocumentSpecError("document_operation_invalid", `Unsupported document block type: ${type || "unknown"}.`, { index, type });
    if (type === "image") validateAssetPath(block.path, `content[${index}].path`);
    if (type === "chart") validateChart(block.chart || block, `content[${index}]`);
    if (type === "table") validateTable(block.table || block, `content[${index}]`);
    return { ...block, id: String(block.id || `block-${index + 1}`), type };
  });
}

function normalizeWorksheets(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new DocumentSpecError("document_operation_invalid", "XLSX requires 1 to 50 worksheets.");
  const normalized = value.map((sheet, index) => {
    if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) throw new DocumentSpecError("document_operation_invalid", `Worksheet ${index + 1} must be an object.`);
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    if (rows.length > 500_000) throw new DocumentSpecError("document_resource_limit", `Worksheet ${index + 1} exceeds 500,000 rows.`);
    rows.forEach((row, rowIndex) => {
      if (!Array.isArray(row) && (!row || typeof row !== "object")) throw new DocumentSpecError("document_operation_invalid", `Worksheet row ${rowIndex + 1} is invalid.`);
    });
    const maxColumns = rows.reduce((maximum, row) => Math.max(maximum, Array.isArray(row) ? row.length : Object.keys(row || {}).length), Array.isArray(sheet.columns) ? sheet.columns.length : 0);
    if (rows.length * Math.max(1, maxColumns) > 500_000) throw new DocumentSpecError("document_resource_limit", `Worksheet ${index + 1} exceeds 500,000 cells.`);
    return { ...sheet, name: String(sheet.name || `Sheet${index + 1}`).slice(0, 31), rows };
  });
  const names = normalized.map((sheet) => sheet.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new DocumentSpecError("document_operation_invalid", "XLSX worksheet names must be unique.");
  return normalized;
}

function normalizeSlides(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new DocumentSpecError("document_operation_invalid", "PPTX requires 1 to 100 slides.");
  return value.map((slide, index) => {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) throw new DocumentSpecError("document_operation_invalid", `Slide ${index + 1} must be an object.`);
    const layout = String(slide.layout || "content");
    if (slide.chart) validateChart(slide.chart, `slides[${index}]`);
    if (slide.table) validateTable(slide.table, `slides[${index}]`);
    if (slide.image) validateAssetPath(typeof slide.image === "string" ? slide.image : slide.image.path, `slides[${index}].image`);
    return { ...slide, id: String(slide.id || `slide-${index + 1}`), layout };
  });
}

function normalizeArray(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new DocumentSpecError("document_operation_invalid", "dataSources must be an array.");
  return value.slice(0, 100);
}

function collectAndValidateAssets(spec) {
  for (const path of collectAssetPaths(spec)) validateAssetPath(path, "asset");
}

function validateAssetPath(path, field) {
  if (typeof path !== "string" || !ASSET_PATTERN.test(path) || path.includes("..")) throw new DocumentSpecError("document_asset_unsupported", `${field} must be a safe absolute VFS asset path.`, { path, field });
  if (/^(?:https?:|data:|blob:|chrome:)/i.test(path)) throw new DocumentSpecError("document_asset_unsupported", `Remote or executable asset is not allowed: ${path}`, { path });
}

function validateChart(chart, field) {
  if (!chart || typeof chart !== "object") throw new DocumentSpecError("document_operation_invalid", `${field}.chart must be an object.`);
  if (!["column", "bar", "line", "area", "pie", "doughnut", "scatter"].includes(String(chart.type || ""))) throw new DocumentSpecError("document_operation_invalid", `${field}.chart has an unsupported type.`);
  if (!Array.isArray(chart.categories) || chart.categories.length > 200) throw new DocumentSpecError("document_operation_invalid", `${field}.chart categories are invalid.`);
  if (!Array.isArray(chart.series) || chart.series.length < 1 || chart.series.length > 20) throw new DocumentSpecError("document_operation_invalid", `${field}.chart series are invalid.`);
  for (const series of chart.series) {
    if (!series || typeof series.name !== "string" || !Array.isArray(series.values) || series.values.length !== chart.categories.length) throw new DocumentSpecError("document_operation_invalid", `${field}.chart series length does not match categories.`);
    if (series.values.some((value) => value !== null && (!Number.isFinite(Number(value)) || Number(value) > 1e15 || Number(value) < -1e15))) throw new DocumentSpecError("document_operation_invalid", `${field}.chart contains a non-finite or out-of-range value.`);
  }
}

function validateTable(table, field) {
  if (!table || typeof table !== "object" || !Array.isArray(table.columns) || !Array.isArray(table.rows)) throw new DocumentSpecError("document_operation_invalid", `${field}.table must contain columns and rows.`);
  if (table.columns.length < 1 || table.columns.length > 100 || table.rows.length > 10_000) throw new DocumentSpecError("document_resource_limit", `${field}.table exceeds the supported dimensions.`);
  const keys = table.columns.map((column) => String(column.key || ""));
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) throw new DocumentSpecError("document_operation_invalid", `${field}.table column keys must be unique.`);
}

function richThemeSchema() {
  return { type: "object", properties: { preset: { type: "string" }, colors: { type: "object", additionalProperties: true }, fonts: { type: "object", additionalProperties: true } }, additionalProperties: true };
}

function chartSchema() {
  return { type: "object", properties: { type: { type: "string", enum: ["column", "bar", "line", "area", "pie", "doughnut", "scatter"] }, categories: { type: "array", maxItems: 200 }, series: { type: "array", minItems: 1, maxItems: 20 } }, required: ["type", "categories", "series"], additionalProperties: true };
}

function tableSchema() {
  return { type: "object", properties: { columns: { type: "array", minItems: 1, maxItems: 100 }, rows: { type: "array", maxItems: 10000 } }, required: ["columns", "rows"], additionalProperties: true };
}
