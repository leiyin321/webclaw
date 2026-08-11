import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "build/document");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(root, "src/document-runtime/document-sandbox-entry.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome135",
  outfile: resolve(output, "document-sandbox.js"),
  minify: true,
  sourcemap: false,
  legalComments: "none"
});
await writeFile(resolve(output, "README.txt"), "Document engine bundles are produced here by the 0.7.x build pipeline.\n", "utf8");
console.log("Sandboxed DOCX, PDF, XLSX, and PPTX engine bundle built.");
