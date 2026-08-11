import ExcelJS from "exceljs";

export async function generateXlsx(spec) {
  const warnings = [];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WebClaw";
  workbook.properties.title = String(spec.workbook?.title || "WebClaw workbook");
  const primary = String(spec.theme?.colors?.primary || "#176B5B").replace(/^#/, "").toUpperCase();
  for (const sheetSpec of Array.isArray(spec.worksheets) ? spec.worksheets : []) {
    const worksheet = workbook.addWorksheet(String(sheetSpec.name || `Sheet${workbook.worksheets.length + 1}`).slice(0, 31));
    const rows = Array.isArray(sheetSpec.rows) ? sheetSpec.rows : [];
    const objectKeys = [...new Set(rows.flatMap((row) => row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row) : []))];
    const columns = Array.isArray(sheetSpec.columns) && sheetSpec.columns.length
      ? sheetSpec.columns
      : objectKeys.map((key) => ({ key, header: key }));
    if (columns.length) worksheet.columns = columns.map((column) => ({ key: String(column.key), header: String(column.header || column.label || column.key), width: Number(column.width) || 16, style: column.numFmt ? { numFmt: String(column.numFmt) } : undefined }));
    for (const row of rows) worksheet.addRow(Array.isArray(row) ? row : row && typeof row === "object" && columns.length ? row : Object.values(row || {}));
    if (worksheet.rowCount > 0) {
      const header = worksheet.getRow(1);
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${primary}` } };
      header.alignment = { vertical: "middle", horizontal: "center" };
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
      worksheet.autoFilter = { from: "A1", to: `${columnLetter(Math.max(1, worksheet.columnCount))}${Math.max(1, worksheet.rowCount)}` };
    }
    if (sheetSpec.freezeRows) worksheet.views = [{ state: "frozen", ySplit: Math.max(0, Number(sheetSpec.freezeRows) || 1) }];
    if (Array.isArray(sheetSpec.conditionalFormats)) warnings.push(`Conditional formatting declarations are reserved for the next XLSX engine iteration on sheet ${worksheet.name}.`);
  }
  if (!workbook.worksheets.length) warnings.push("No worksheets were supplied; an empty workbook was created.");
  if (spec.charts?.length) warnings.push("Charts are not emitted in this XLSX engine iteration; chart declarations were preserved only in the generation warning.");
  return { blob: new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), warnings, fidelity: warnings.length ? "partial" : "rich" };
}

function columnLetter(number) { let value = Math.max(1, Number(number) || 1); let result = ""; while (value > 0) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26); } return result; }
