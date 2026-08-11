import pdfMake from "pdfmake/build/pdfmake.js";
import vfsFonts from "pdfmake/build/vfs_fonts.js";

pdfMake.vfs = vfsFonts;

export async function generatePdf(spec, { resolveAsset } = {}) {
  const warnings = [];
  const content = [];
  for (const block of Array.isArray(spec.content) ? spec.content : []) {
    const result = await blockToPdf(block, { resolveAsset, warnings });
    if (Array.isArray(result)) content.push(...result); else if (result) content.push(result);
  }
  if (!content.length) content.push({ text: "" });
  const documentDefinition = {
    info: { title: String(spec.document?.title || "WebClaw document"), author: "WebClaw" },
    pageSize: spec.page?.size || "A4",
    pageOrientation: spec.page?.orientation === "landscape" ? "landscape" : "portrait",
    defaultStyle: { font: "Roboto", fontSize: 10, color: String(spec.theme?.colors?.text || "#222222").replace(/^#/, "") },
    content,
    styles: { title: { fontSize: 22, bold: true, margin: [0, 0, 0, 14] }, heading: { fontSize: 15, bold: true, margin: [0, 10, 0, 5] }, quote: { italics: true, color: "666666", margin: [18, 4, 0, 8] } }
  };
  if (containsNonAscii(spec)) warnings.push("The bundled PDF font is Roboto and may not contain CJK glyphs. Configure a CJK font bundle before relying on Chinese PDF output.");
  return { blob: await pdfMake.createPdf(documentDefinition).getBlob(), warnings, fidelity: warnings.length ? "partial" : "rich" };
}

async function blockToPdf(block, context) {
  const { resolveAsset, warnings } = context;
  const type = String(block?.type || "paragraph").toLowerCase();
  if (type === "heading") return { text: String(block.text ?? ""), style: Number(block.level) === 1 ? "title" : "heading", alignment: block.align || undefined };
  if (type === "paragraph") return { text: String(block.text ?? block.content ?? ""), alignment: block.align || undefined, margin: [0, 0, 0, 7] };
  if (type === "quote") return { text: String(block.text ?? block.content ?? ""), style: "quote" };
  if (type === "list") return { ul: (Array.isArray(block.items) ? block.items : []).map((item) => typeof item === "object" ? String(item.text ?? item.content ?? "") : String(item)) };
  if (type === "page_break") return { text: "", pageBreak: "before" };
  if (type === "table") return tableBlock(block.table || block, warnings);
  if (type === "image") {
    if (typeof resolveAsset !== "function") { warnings.push(`PDF image block was skipped because no VFS asset resolver was provided: ${block.path || "unknown"}`); return { text: block.alt ? `[${block.alt}]` : "[image]", color: "666666" }; }
    const asset = await resolveAsset(block.path);
    if (!asset?.data) { warnings.push(`PDF image asset could not be read: ${block.path || "unknown"}`); return { text: block.alt ? `[${block.alt}]` : "[image]", color: "666666" }; }
    return { image: toDataUrl(asset), width: Number(block.width) || 460, height: Number(block.height) || undefined, alignment: block.align || undefined, margin: [0, 5, 0, 10] };
  }
  warnings.push(`Unsupported PDF rich block was skipped: ${type}`);
  return { text: String(block.text || "") };
}

function tableBlock(table, warnings) {
  const columns = Array.isArray(table.columns) ? table.columns : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const keys = columns.length ? columns.map((column) => String(column.key)) : inferKeys(rows);
  const header = columns.length ? keys.map((key, index) => columns[index]?.label || key) : keys;
  const body = header.length ? [header, ...rows.map((row) => keys.map((key) => String(row?.[key] ?? "")))] : rows.map((row) => Array.isArray(row) ? row.map(String) : [String(row ?? "")]);
  if (!body.length) { warnings.push("Empty PDF table was skipped."); return { text: "" }; }
  return { table: { headerRows: header.length ? 1 : 0, widths: Array(Math.max(1, body[0].length)).fill("*").map((value) => value), body }, layout: "lightHorizontalLines", margin: [0, 5, 0, 10] };
}

function inferKeys(rows) { return [...new Set(rows.flatMap((row) => row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row) : []))]; }
function containsNonAscii(value) { return /[^\x00-\x7f]/.test(JSON.stringify(value)); }
function toDataUrl(asset) { const bytes = asset.data instanceof Uint8Array ? asset.data : new Uint8Array(asset.data); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return `data:${asset.mimeType || "application/octet-stream"};base64,${btoa(binary)}`; }
