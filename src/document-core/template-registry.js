import { DocumentSpecError } from "./document-errors.js";

const BUILTIN_TEMPLATES = Object.freeze([
  template("docx", "business-report", "Business report", ["cover", "toc", "heading", "content", "chart", "table", "closing"]),
  template("docx", "research-report", "Research report", ["cover", "toc", "heading", "content", "quote", "references", "appendix"]),
  template("docx", "meeting-minutes", "Meeting minutes", ["cover", "summary", "table", "action-items", "closing"]),
  template("xlsx", "data-analysis", "Data analysis workbook", ["raw-data", "analysis", "dashboard", "notes"]),
  template("xlsx", "financial-summary", "Financial summary", ["summary", "income", "cash-flow", "notes"]),
  template("xlsx", "project-tracker", "Project tracker", ["overview", "work-items", "risks", "notes"]),
  template("pptx", "corporate-deck", "Corporate deck", ["title", "agenda", "section", "content", "chart_insights", "comparison", "metrics", "closing"]),
  template("pptx", "research-deck", "Research presentation", ["title", "question", "method", "finding", "chart_insights", "conclusion"]),
  template("pptx", "product-review", "Product review", ["title", "problem", "solution", "metrics", "roadmap", "closing"]),
  template("pdf", "business-report", "Business report PDF", ["cover", "toc", "heading", "content", "chart", "table", "closing"]),
  template("pdf", "research-report", "Research report PDF", ["cover", "toc", "heading", "content", "quote", "references", "appendix"]),
  template("pdf", "one-page-brief", "One-page brief", ["summary", "metrics", "chart", "actions"])
]);

export function listDocumentTemplates(format = "") {
  const normalized = String(format || "").toLowerCase();
  return BUILTIN_TEMPLATES
    .filter((item) => !normalized || item.format === normalized)
    .map(publicTemplate);
}

export function resolveDocumentTemplate(id, format = "") {
  const requested = String(id || "").trim();
  if (!requested) return null;
  const normalizedFormat = String(format || "").toLowerCase();
  const template = BUILTIN_TEMPLATES.find((item) => (
    (!normalizedFormat || item.format === normalizedFormat) &&
    (item.id === requested || templatePublicId(item) === requested)
  ));
  if (!template) {
    throw new DocumentSpecError("document_template_not_found", `Document template was not found: ${requested}`, { templateId: requested, format });
  }
  return structuredClone(template);
}

export function validateTemplateManifest(manifest, format = "") {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new DocumentSpecError("document_template_invalid", "Template manifest must be an object.");
  }
  const templateFormat = String(manifest.format || format || "").toLowerCase();
  if (!["docx", "xlsx", "pptx", "pdf"].includes(templateFormat)) {
    throw new DocumentSpecError("document_template_invalid", `Unsupported template format: ${templateFormat || "unknown"}`);
  }
  if (!String(manifest.id || "").trim() || !String(manifest.templateVersion || "").trim()) {
    throw new DocumentSpecError("document_template_invalid", "Template manifest requires id and templateVersion.");
  }
  if (manifest.assets !== undefined && (!Array.isArray(manifest.assets) || manifest.assets.some((asset) => typeof asset !== "string"))) {
    throw new DocumentSpecError("document_template_invalid", "Template assets must be an array of VFS-relative asset paths.");
  }
  return {
    ...manifest,
    format: templateFormat,
    layouts: manifest.layouts && typeof manifest.layouts === "object" ? manifest.layouts : {},
    styles: manifest.styles && typeof manifest.styles === "object" ? manifest.styles : {},
    defaults: manifest.defaults && typeof manifest.defaults === "object" ? manifest.defaults : {},
    assets: Array.isArray(manifest.assets) ? manifest.assets.slice() : []
  };
}

function template(format, id, name, layouts) {
  return {
    id,
    format,
    templateVersion: "1",
    name,
    description: `${name} theme preset for WebClaw rich document generation.`,
    engine: `${format}-2`,
    theme: { preset: "corporate", colors: { primary: "#176B5B", background: "#FFFFFF" }, fonts: { heading: "Aptos Display", body: "Aptos" } },
    layouts: Object.fromEntries(layouts.map((layout) => [layout, { id: layout }])),
    styles: {},
    defaults: {},
    limits: { maxTitleChars: 80, maxBodyChars: 1200, maxBullets: 8, maxTableRows: 80 },
    assets: []
  };
}

function publicTemplate(template) {
  return {
    id: templatePublicId(template),
    format: template.format,
    templateVersion: template.templateVersion,
    name: template.name,
    description: template.description,
    engine: template.engine,
    limits: { ...template.limits }
  };
}

function templatePublicId(template) {
  return `builtin:${template.format}:${template.id}`;
}
