import pptxgen from "pptxgenjs";

export async function generatePptx(spec, { resolveAsset } = {}) {
  const warnings = [];
  const pptx = new pptxgen();
  pptx.author = "WebClaw";
  pptx.subject = String(spec.presentation?.subject || "Generated presentation");
  pptx.title = String(spec.presentation?.title || "WebClaw presentation");
  pptx.layout = spec.page?.orientation === "portrait" ? "LAYOUT_4:3" : "LAYOUT_WIDE";
  const colors = spec.theme?.colors || {};
  const accent = String(colors.primary || "176B5B").replace(/^#/, "");
  for (const slideSpec of Array.isArray(spec.slides) ? spec.slides : []) {
    const slide = pptx.addSlide();
    slide.background = { color: String(colors.background || "FFFFFF").replace(/^#/, "") };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.18, fill: { color: accent }, line: { color: accent } });
    slide.addText(String(slideSpec.title || ""), { x: 0.55, y: 0.45, w: 12.2, h: 0.55, fontSize: 26, bold: true, color: accent, margin: 0 });
    if (slideSpec.subtitle) slide.addText(String(slideSpec.subtitle), { x: 0.58, y: 1.08, w: 12, h: 0.35, fontSize: 12, color: "666666", margin: 0 });
    const body = slideSpec.body ?? slideSpec.text;
    const split = Boolean(slideSpec.chart && (body || slideSpec.table || slideSpec.image));
    const leftWidth = split ? 5.55 : 11.9;
    const hasPrimaryVisual = Boolean(slideSpec.table || slideSpec.image);
    if (body) slide.addText(String(body), { x: 0.7, y: 1.55, w: leftWidth, h: hasPrimaryVisual ? 0.65 : 4.9, fontSize: hasPrimaryVisual ? 14 : 18, breakLine: false, valign: "top", margin: 0.06, fit: "shrink" });
    const visualY = body && hasPrimaryVisual ? 2.35 : 1.55;
    if (slideSpec.table) addTable(slide, slideSpec.table, warnings, { x: 0.7, y: visualY, w: leftWidth, h: 4.2 });
    if (slideSpec.image && slideSpec.table) warnings.push(`PPTX image was skipped because the slide already contains a table: ${slideSpec.id || "slide"}.`);
    else if (slideSpec.image) await addImage(slide, slideSpec.image, resolveAsset, warnings, { x: 0.7, y: visualY, w: leftWidth, h: 3.2 });
    if (slideSpec.chart) addChart(slide, slideSpec.chart, warnings, split ? { x: 6.65, y: 1.55, w: 5.9, h: 3.8 } : { x: 0.7, y: 1.55, w: 11.9, h: 4.8 });
  }
  if (!pptx._slides?.length) warnings.push("No slides were supplied; an empty presentation was created.");
  return { blob: new Blob([await pptx.write({ outputType: "arraybuffer" })], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), warnings, fidelity: warnings.length ? "partial" : "rich" };
}

async function addImage(slide, image, resolveAsset, warnings, box) {
  const path = typeof image === "string" ? image : image.path;
  if (typeof resolveAsset !== "function") { warnings.push(`PPTX image was skipped because no VFS asset resolver was provided: ${path || "unknown"}.`); return; }
  const asset = await resolveAsset(path);
  if (!asset?.data) { warnings.push(`PPTX image asset could not be read: ${path || "unknown"}.`); return; }
  slide.addImage({ data: toDataUrl(asset), x: box.x, y: box.y, w: Number(image.width) || box.w, h: Number(image.height) || box.h });
}

function addChart(slide, chart, warnings, box) {
  const typeMap = { column: "bar", bar: "bar", line: "line", area: "area", pie: "pie", doughnut: "doughnut" };
  const type = typeMap[String(chart.type || "column")];
  if (!type || String(chart.type) === "scatter") { warnings.push(`PPTX chart type is not supported by the native engine: ${chart.type || "unknown"}.`); return; }
  const data = chart.series.map((series) => ({ name: String(series.name), labels: chart.categories.map(String), values: series.values.map((value) => value === null ? 0 : Number(value)) }));
  slide.addChart(type, data, { ...box, barDir: chart.type === "bar" ? "bar" : "col", showLegend: data.length > 1, showTitle: Boolean(chart.title), title: String(chart.title || ""), catAxisLabelFontFace: "Aptos", valAxisLabelFontFace: "Aptos", chartColors: ["176B5B", "D97706", "2563EB", "7C3AED"] });
}

function addTable(slide, table, warnings, box) {
  const columns = Array.isArray(table.columns) ? table.columns : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const keys = columns.map((column) => String(column.key));
  const data = [keys.map((key, index) => String(columns[index]?.label || key)), ...rows.map((row) => keys.map((key) => String(row?.[key] ?? "")))];
  if (!data.length || !data[0].length) { warnings.push("Empty PPTX table was skipped."); return; }
  slide.addTable(data, { ...box, border: { type: "solid", color: "D0D7DE", pt: 1 }, fill: "FFFFFF", color: "222222", fontSize: 13, bold: false, margin: 0.06, autoFit: false, rowH: 0.35 });
}

function toDataUrl(asset) { const bytes = asset.data instanceof Uint8Array ? asset.data : new Uint8Array(asset.data); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return `data:${asset.mimeType || "application/octet-stream"};base64,${btoa(binary)}`; }
