import assert from "node:assert/strict";
import { generateDocx } from "../src/document-engines/docx-engine.js";

const result = await generateDocx({
  document: { title: "Quarterly Review" },
  theme: { fonts: { body: "Aptos" } },
  content: [
    { type: "heading", level: 1, text: "Quarterly Review" },
    { type: "paragraph", text: "Revenue increased by 18%.", bold: true },
    { type: "list", items: ["North America", "Europe"] },
    { type: "table", table: { columns: [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }], rows: [{ metric: "Revenue", value: 118 }] } },
    { type: "page_break" },
    { type: "image", path: "/workspace/logo.png", alt: "Logo" }
  ]
});

assert.ok(result.blob.size > 1000);
assert.deepEqual(new Uint8Array(await result.blob.slice(0, 4).arrayBuffer()), new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
assert.ok(result.warnings.some((warning) => /image asset/i.test(warning)));
console.log("DOCX engine tests passed.");
