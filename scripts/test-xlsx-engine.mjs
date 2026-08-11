import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { generateXlsx } from "../src/document-engines/xlsx-engine.js";

const result = await generateXlsx({
  workbook: { title: "Analysis" },
  worksheets: [{ name: "Data", columns: [{ key: "metric", header: "Metric" }, { key: "value", header: "Value", numFmt: "0.0%" }], rows: [{ metric: "Margin", value: 0.42 }], freezeRows: 1 }],
  charts: [{ type: "column" }]
});

assert.ok(result.blob.size > 1000);
assert.deepEqual(new Uint8Array(await result.blob.slice(0, 2).arrayBuffer()), new Uint8Array([0x50, 0x4b]));
assert.ok(result.warnings.some((warning) => /charts are not emitted/i.test(warning)));
const objectRows = await generateXlsx({ worksheets: [{ name: "Objects", rows: [{ alpha: 1, beta: 2 }, { beta: 3, alpha: 4 }] }] });
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(await objectRows.blob.arrayBuffer());
const sheet = workbook.getWorksheet("Objects");
assert.deepEqual(sheet.getRow(1).values.slice(1), ["alpha", "beta"]);
assert.deepEqual(sheet.getRow(2).values.slice(1), [1, 2]);
assert.deepEqual(sheet.getRow(3).values.slice(1), [4, 3]);
assert.equal(sheet.autoFilter, "A1:B3");
console.log("XLSX engine tests passed.");
