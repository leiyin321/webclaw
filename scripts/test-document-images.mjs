import assert from "node:assert/strict";
import { detectDocumentImageType, normalizeDocumentImageAsset } from "../src/document-image.js";

const png = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" });
const webp = new Blob([new TextEncoder().encode("RIFFxxxxWEBP")], { type: "image/webp" });
const disguisedJxl = new Blob([Uint8Array.from([0xff, 0x0a, 0x00, 0x00])], { type: "image/png" });

assert.equal(await detectDocumentImageType(png), "png");
assert.equal(await detectDocumentImageType(webp), "webp");
assert.equal(await detectDocumentImageType(disguisedJxl), "");
await assert.rejects(
  () => normalizeDocumentImageAsset("pptx", "/workspace/fake.png", disguisedJxl),
  /invalid PPTX image asset/i
);

const originalCreateImageBitmap = globalThis.createImageBitmap;
const originalOffscreenCanvas = globalThis.OffscreenCanvas;
globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
globalThis.OffscreenCanvas = class {
  getContext() { return { drawImage() {} }; }
  async convertToBlob() { return png; }
};
const converted = await normalizeDocumentImageAsset("pptx", "/workspace/image.webp", webp);
assert.equal(converted.type, "png");
assert.equal(await detectDocumentImageType(converted.blob), "png");
globalThis.createImageBitmap = originalCreateImageBitmap;
globalThis.OffscreenCanvas = originalOffscreenCanvas;

console.log("Document image validation tests passed.");
