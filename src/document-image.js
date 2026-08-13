const IMAGE_TYPES = new Set(["png", "jpeg", "gif", "bmp", "webp", "svg"]);

export async function normalizeDocumentImageAsset(format, path, blob) {
  if (!(blob instanceof Blob)) throw new Error(`Document image asset is not a Blob: ${path}`);
  const detectedType = await detectDocumentImageType(blob);
  if (!IMAGE_TYPES.has(detectedType)) {
    throw new Error(`Unsupported or invalid ${String(format || "document").toUpperCase()} image asset: ${path}`);
  }
  await assertSafeImageDimensions(blob, path);
  let normalizedBlob = blob;
  let normalizedType = detectedType;
  if (detectedType === "webp") {
    normalizedBlob = await transcodeWebpToPng(blob, path);
    normalizedType = "png";
  }
  const supported = format === "pdf" ? ["png", "jpeg"]
    : format === "docx" ? ["png", "jpeg", "gif", "bmp"]
      : format === "pptx" ? ["png", "jpeg", "gif", "svg"]
        : [];
  if (!supported.includes(normalizedType)) {
    throw new Error(`Unsupported ${String(format || "document").toUpperCase()} image asset: ${path} (${detectedType})`);
  }
  return { blob: normalizedBlob, type: normalizedType };
}

async function assertSafeImageDimensions(blob, path) {
  if (typeof createImageBitmap !== "function") return;
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return;
  }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) {
      throw new Error(`Document image dimensions are invalid or too large: ${path}`);
    }
  } finally {
    bitmap.close?.();
  }
}

export async function detectDocumentImageType(blob) {
  if (!(blob instanceof Blob) || blob.size < 4) return "";
  const bytes = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "gif";
  if (ascii(bytes, 0, 2) === "BM") return "bmp";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "").trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(text)) return "svg";
  return "";
}

function startsWith(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

async function transcodeWebpToPng(blob, path) {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    throw new Error(`WEBP conversion is unavailable for document asset: ${path}`);
  }
  const bitmap = await createImageBitmap(blob);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) {
      throw new Error(`WEBP image dimensions are invalid or too large: ${path}`);
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`WEBP conversion canvas is unavailable: ${path}`);
    context.drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}
