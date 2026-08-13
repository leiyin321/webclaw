import { MESSAGE_ITEM_TYPE } from "./wechat-api.js";
import { saveWechatMediaBlob } from "./wechat-storage.js";

const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp"
};

const INV_SBOX = [
  0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb,
  0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb,
  0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2, 0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e,
  0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76, 0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25,
  0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92,
  0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84,
  0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06,
  0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b,
  0x3a, 0x91, 0x11, 0x41, 0x4f, 0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73,
  0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, 0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e,
  0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b,
  0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4,
  0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f,
  0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef,
  0xa0, 0xe0, 0x3b, 0x4d, 0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61,
  0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d
];

const SBOX = [
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
];

const RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

export async function downloadMessageMedia(message, accountId) {
  const media = [];
  const items = Array.isArray(message.item_list) ? message.item_list : [];
  for (const item of items) {
    try {
      if (item?.type === MESSAGE_ITEM_TYPE.IMAGE) {
        const image = item.image_item;
        const ref = image?.media;
        if (!ref?.encrypt_query_param && !ref?.full_url) continue;
        const aesKey = image.aeskey ? hexToBase64(image.aeskey) : ref.aes_key;
        const buffer = await downloadBuffer(ref, aesKey, "image");
        media.push(await saveMedia(buffer, {
          accountId,
          kind: "image",
          fileName: "image.jpg",
          mime: "image/jpeg"
        }));
      } else if (item?.type === MESSAGE_ITEM_TYPE.FILE) {
        const file = item.file_item;
        const ref = file?.media;
        if ((!ref?.encrypt_query_param && !ref?.full_url) || !ref?.aes_key) continue;
        const fileName = file.file_name || "file.bin";
        const buffer = await downloadBuffer(ref, ref.aes_key, "file");
        media.push(await saveMedia(buffer, {
          accountId,
          kind: "file",
          fileName,
          mime: mimeFromFilename(fileName)
        }));
      }
    } catch (error) {
      console.error(`[wechat media] download failed type=${item?.type}: ${error?.message || String(error)}`);
      media.push({
        kind: item?.type === MESSAGE_ITEM_TYPE.IMAGE ? "image" : item?.type === MESSAGE_ITEM_TYPE.FILE ? "file" : "media",
        fileName: item?.file_item?.file_name || "",
        mime: item?.type === MESSAGE_ITEM_TYPE.IMAGE ? "image/jpeg" : mimeFromFilename(item?.file_item?.file_name || ""),
        size: 0,
        error: error?.message || String(error)
      });
    }
  }
  return media;
}

function buildCdnDownloadUrl(encryptedQueryParam) {
  return `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam || "")}`;
}

async function downloadBuffer(media, aesKeyBase64, label) {
  const url = media.full_url || buildCdnDownloadUrl(media.encrypt_query_param || "");
  const encrypted = new Uint8Array(await fetchBytes(url, label));
  if (!aesKeyBase64) return encrypted;
  return decryptAesEcbPkcs7(encrypted, parseAesKey(aesKeyBase64, label));
}

async function fetchBytes(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${label}: CDN HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES) {
    throw new Error(`${label}: media exceeds ${MAX_MEDIA_BYTES} bytes`);
  }
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_MEDIA_BYTES) throw new Error(`${label}: media exceeds ${MAX_MEDIA_BYTES} bytes`);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > MAX_MEDIA_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`${label}: media exceeds ${MAX_MEDIA_BYTES} bytes`);
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function saveMedia(buffer, metadata) {
  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    throw new Error(`media exceeds ${MAX_MEDIA_BYTES} bytes`);
  }
  const saved = await saveWechatMediaBlob(buffer, {
    ...metadata,
    size: buffer.byteLength
  });
  return {
    mediaId: saved.mediaId,
    kind: saved.kind,
    fileName: saved.fileName,
    mime: saved.mime,
    size: saved.size
  };
}

function mimeFromFilename(filename) {
  const ext = String(filename || "").toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

function parseAesKey(aesKeyBase64, label) {
  const decoded = base64ToBytes(aesKeyBase64);
  if (decoded.length === 16) return decoded;
  const ascii = bytesToAscii(decoded);
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(ascii)) return hexToBytes(ascii);
  throw new Error(`${label}: invalid aes key length ${decoded.length}`);
}

export function decryptAesEcbPkcs7(ciphertext, key) {
  if (ciphertext.length % 16 !== 0) throw new Error(`AES ciphertext length ${ciphertext.length} is not a multiple of 16.`);
  const roundKeys = expandKey(key);
  const output = new Uint8Array(ciphertext.length);
  for (let offset = 0; offset < ciphertext.length; offset += 16) {
    output.set(decryptBlock(ciphertext.subarray(offset, offset + 16), roundKeys), offset);
  }
  return removePkcs7Padding(output);
}

function expandKey(key) {
  if (key.length !== 16) throw new Error(`AES-128 key length must be 16 bytes, got ${key.length}.`);
  const expanded = new Uint8Array(176);
  expanded.set(key);
  let bytesGenerated = 16;
  let rconIndex = 1;
  const temp = new Uint8Array(4);
  while (bytesGenerated < 176) {
    temp.set(expanded.subarray(bytesGenerated - 4, bytesGenerated));
    if (bytesGenerated % 16 === 0) {
      const first = temp[0];
      temp[0] = SBOX[temp[1]] ^ RCON[rconIndex++];
      temp[1] = SBOX[temp[2]];
      temp[2] = SBOX[temp[3]];
      temp[3] = SBOX[first];
    }
    for (let i = 0; i < 4; i += 1) {
      expanded[bytesGenerated] = expanded[bytesGenerated - 16] ^ temp[i];
      bytesGenerated += 1;
    }
  }
  return expanded;
}

function decryptBlock(block, roundKeys) {
  const state = new Uint8Array(block);
  addRoundKey(state, roundKeys, 10);
  for (let round = 9; round >= 1; round -= 1) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, roundKeys, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, roundKeys, 0);
  return state;
}

function addRoundKey(state, roundKeys, round) {
  const offset = round * 16;
  for (let i = 0; i < 16; i += 1) state[i] ^= roundKeys[offset + i];
}

function invSubBytes(state) {
  for (let i = 0; i < 16; i += 1) state[i] = INV_SBOX[state[i]];
}

function invShiftRows(state) {
  const copy = new Uint8Array(state);
  state[1] = copy[13];
  state[5] = copy[1];
  state[9] = copy[5];
  state[13] = copy[9];
  state[2] = copy[10];
  state[6] = copy[14];
  state[10] = copy[2];
  state[14] = copy[6];
  state[3] = copy[7];
  state[7] = copy[11];
  state[11] = copy[15];
  state[15] = copy[3];
}

function invMixColumns(state) {
  for (let column = 0; column < 4; column += 1) {
    const offset = column * 4;
    const a0 = state[offset];
    const a1 = state[offset + 1];
    const a2 = state[offset + 2];
    const a3 = state[offset + 3];
    state[offset] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
    state[offset + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
    state[offset + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
    state[offset + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
  }
}

function gmul(a, b) {
  let result = 0;
  let aa = a;
  let bb = b;
  for (let i = 0; i < 8; i += 1) {
    if (bb & 1) result ^= aa;
    const high = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (high) aa ^= 0x1b;
    bb >>= 1;
  }
  return result;
}

function removePkcs7Padding(bytes) {
  const pad = bytes[bytes.length - 1];
  if (pad < 1 || pad > 16 || pad > bytes.length) return bytes;
  for (let i = bytes.length - pad; i < bytes.length; i += 1) {
    if (bytes[i] !== pad) return bytes;
  }
  return bytes.slice(0, bytes.length - pad);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hexToBytes(value) {
  const hex = String(value || "").trim();
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function hexToBase64(value) {
  const bytes = hexToBytes(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToAscii(bytes) {
  return String.fromCharCode(...bytes);
}
