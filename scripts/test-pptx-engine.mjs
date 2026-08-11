import assert from "node:assert/strict";
import { generatePptx } from "../src/document-engines/pptx-engine.js";

const result = await generatePptx({
  presentation: { title: "Review" },
  theme: { colors: { primary: "#176B5B" } },
  slides: [{ title: "Overview", body: "Revenue increased." }, { title: "Data", table: { columns: [{ key: "metric" }, { key: "value" }], rows: [{ metric: "Revenue", value: 118 }] }, chart: { type: "scatter", categories: ["Q1"], series: [{ name: "Revenue", values: [118] }] } }, { title: "Image", image: { path: "/workspace/chart.png", width: 1, height: 1 } }]
}, {
  resolveAsset: async () => ({ data: Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")), mimeType: "image/png" })
});

assert.ok(result.blob.size > 1000);
assert.deepEqual(new Uint8Array(await result.blob.slice(0, 2).arrayBuffer()), new Uint8Array([0x50, 0x4b]));
assert.ok(result.warnings.some((warning) => /chart type is not supported/i.test(warning)));
assert.ok(!result.warnings.some((warning) => /image was skipped/i.test(warning)));
const nativeChart = await generatePptx({ slides: [{ title: "Native chart", chart: { type: "column", categories: ["Q1", "Q2"], series: [{ name: "Revenue", values: [10, 20] }] } }] });
assert.ok(nativeChart.blob.size > result.blob.size / 2);
assert.equal(nativeChart.warnings.length, 0);
console.log("PPTX engine tests passed.");
