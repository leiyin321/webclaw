import { RICH_DOCUMENT_SCHEMA_VERSIONS, richDocumentSchema } from "./rich-document.js";
import { listDocumentTemplates } from "./template-registry.js";

export function richDocumentSchemaDefinition(format, operation, actions = []) {
  const normalizedFormat = String(format || "").toLowerCase();
  const normalizedOperation = String(operation || "").toLowerCase();
  if (normalizedOperation !== "create" || !RICH_DOCUMENT_SCHEMA_VERSIONS[normalizedFormat]) return null;
  return {
    format: normalizedFormat,
    operation: normalizedOperation,
    supported: true,
    schemaVersion: RICH_DOCUMENT_SCHEMA_VERSIONS[normalizedFormat],
    schema: richDocumentSchema(normalizedFormat, actions),
    templates: listDocumentTemplates(normalizedFormat),
    capabilities: {
      richThemes: true,
      charts: normalizedFormat === "pptx",
      tables: true,
      images: ["docx", "pdf", "pptx"].includes(normalizedFormat),
      templateKind: "theme_preset",
      nativeFormatGeneration: ["docx", "pdf", "xlsx", "pptx"].includes(normalizedFormat),
      status: ["docx", "pdf", "xlsx", "pptx"].includes(normalizedFormat) ? "engine_ready" : "schema_ready_engine_pending"
    },
    examples: richExample(normalizedFormat)
  };
}

function richExample(format) {
  if (format === "xlsx") return { worksheets: [{ name: "Analysis", rows: [["Metric", "Value"], ["Revenue", 120]] }] };
  if (format === "pptx") return { presentation: { title: "Review" }, slides: [{ layout: "title", title: "Quarterly review", subtitle: "Draft" }] };
  return { document: { title: "Report" }, content: [{ type: "heading", level: 1, text: "Summary" }, { type: "paragraph", text: "Generated content" }] };
}
