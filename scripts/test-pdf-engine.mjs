import assert from "node:assert/strict";
import { generatePdf } from "../src/document-engines/pdf-engine.js";

const result = await generatePdf({
  document: { title: "Analysis" },
  content: [
    { type: "heading", level: 1, text: "Analysis" },
    { type: "paragraph", text: "Revenue increased." },
    { type: "list", items: ["Revenue", "Margin"] },
    { type: "table", table: { columns: [{ key: "metric" }, { key: "value" }], rows: [{ metric: "Revenue", value: 118 }] } },
    { type: "page_break" },
    { type: "image", path: "/workspace/chart.png", width: 80, height: 40 }
  ]
}, {
  resolveAsset: async () => ({ data: Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")), mimeType: "image/png" })
});

assert.ok(result.blob.size > 1000);
assert.equal(new TextDecoder().decode(await result.blob.slice(0, 5).arrayBuffer()), "%PDF-");
assert.ok(!result.warnings.some((warning) => /image block was skipped/i.test(warning)));
console.log("PDF engine tests passed.");
