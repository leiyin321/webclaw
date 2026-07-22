import { vfsReadFile } from "./virtual-file-system.js";

const DB_NAME = "webclaw-knowledge";
const DB_VERSION = 1;
const DOCUMENTS = "documents";
const CHUNKS = "chunks";
const MAX_SOURCE_CHARS = 200_000;
const MAX_CHUNKS_PER_DOCUMENT = 400;

export async function knowledgeIngestVfsFile(path, options = {}) {
  const source = await vfsReadFile(path, { maxChars: MAX_SOURCE_CHARS });
  if (!source.isText) throw new Error("knowledge_ingest currently supports text files only.");
  if (source.truncated) throw new Error(`Knowledge source is larger than ${MAX_SOURCE_CHARS} characters. Split it before ingesting.`);
  const text = normalizeText(source.content);
  if (!text) throw new Error("Knowledge source is empty.");
  const documentId = `vfs:${source.path}`;
  const chunks = splitText(text, clamp(options.chunkChars, 500, 4000, 1600));
  if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) throw new Error(`Knowledge source has too many chunks (${chunks.length}). Split it before ingesting.`);
  const document = {
    id: documentId,
    path: source.path,
    title: String(options.title || source.path.split("/").pop() || source.path).slice(0, 240),
    tags: normalizeTags(options.tags),
    sourceVersion: source.entry.version,
    sourceSize: source.entry.size,
    updatedAt: Date.now(),
    chunkCount: chunks.length,
    charCount: text.length
  };
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENTS, CHUNKS], "readwrite");
  const documents = transaction.objectStore(DOCUMENTS);
  const chunkStore = transaction.objectStore(CHUNKS);
  const existing = await requestAsPromise(documents.get(documentId));
  if (existing && existing.sourceVersion === document.sourceVersion && existing.sourceSize === document.sourceSize) {
    await transactionDone(transaction);
    db.close();
    return { ok: true, document: existing, chunks: existing.chunkCount, unchanged: true };
  }
  await deleteDocumentChunks(chunkStore, documentId);
  documents.put(document);
  chunks.forEach((content, index) => chunkStore.put({ id: `${documentId}:${index}`, documentId, index, content }));
  await transactionDone(transaction);
  db.close();
  return { ok: true, document, chunks: chunks.length };
}

export async function knowledgeSearch(query, options = {}) {
  const terms = tokenize(query);
  if (!terms.length) throw new Error("query is required.");
  const limit = clamp(options.limit, 1, 10, 5);
  const maxChars = clamp(options.maxChars, 300, 3000, 1200);
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENTS, CHUNKS], "readonly");
  const documents = await requestAsPromise(transaction.objectStore(DOCUMENTS).getAll());
  const chunks = await requestAsPromise(transaction.objectStore(CHUNKS).getAll());
  await transactionDone(transaction);
  db.close();
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const normalizedQuery = normalizeText(query).toLowerCase();
  const results = chunks
    .map((chunk) => ({ chunk, document: documentById.get(chunk.documentId), score: scoreChunk(chunk.content, terms, normalizedQuery) }))
    .filter((item) => item.document && item.score > 0)
    .sort((a, b) => b.score - a.score || b.document.updatedAt - a.document.updatedAt)
    .slice(0, limit)
    .map(({ chunk, document, score }) => ({
      documentId: document.id,
      path: document.path,
      title: document.title,
      tags: document.tags,
      chunkIndex: chunk.index,
      score: Number(score.toFixed(3)),
      content: excerpt(chunk.content, terms, maxChars)
    }));
  return { query: String(query), results };
}

export async function knowledgeRead(documentId, options = {}) {
  const id = String(documentId || "").trim();
  if (!id) throw new Error("documentId is required.");
  const start = clamp(options.chunkStart, 0, MAX_CHUNKS_PER_DOCUMENT, 0);
  const end = clamp(options.chunkEnd, start, MAX_CHUNKS_PER_DOCUMENT, start);
  const maxChars = clamp(options.maxChars, 500, 12000, 6000);
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENTS, CHUNKS], "readonly");
  const document = await requestAsPromise(transaction.objectStore(DOCUMENTS).get(id));
  if (!document) throw new Error(`Knowledge document not found: ${id}`);
  const chunks = await requestAsPromise(transaction.objectStore(CHUNKS).index("documentId").getAll(id));
  await transactionDone(transaction);
  db.close();
  const selected = chunks.sort((a, b) => a.index - b.index).filter((chunk) => chunk.index >= start && chunk.index <= end);
  const content = selected.map((chunk) => chunk.content).join("\n\n");
  return {
    document: { ...document },
    chunkStart: start,
    chunkEnd: selected.at(-1)?.index ?? start,
    content: content.slice(0, maxChars),
    truncated: content.length > maxChars
  };
}

export async function knowledgeForget({ documentId, path } = {}) {
  const id = String(documentId || (path ? `vfs:${path}` : "")).trim();
  if (!id) throw new Error("documentId or path is required.");
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENTS, CHUNKS], "readwrite");
  const documents = transaction.objectStore(DOCUMENTS);
  const document = await requestAsPromise(documents.get(id));
  if (!document) throw new Error(`Knowledge document not found: ${id}`);
  await deleteDocumentChunks(transaction.objectStore(CHUNKS), id);
  documents.delete(id);
  await transactionDone(transaction);
  db.close();
  return { ok: true, documentId: id, path: document.path };
}

export async function knowledgeStatus() {
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENTS, CHUNKS], "readonly");
  const documents = await requestAsPromise(transaction.objectStore(DOCUMENTS).getAll());
  const chunks = await requestAsPromise(transaction.objectStore(CHUNKS).count());
  await transactionDone(transaction);
  db.close();
  return {
    documents: documents.length,
    chunks,
    sourceChars: documents.reduce((total, document) => total + Number(document.charCount || 0), 0),
    items: documents.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50)
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENTS)) db.createObjectStore(DOCUMENTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CHUNKS)) {
        const chunks = db.createObjectStore(CHUNKS, { keyPath: "id" });
        chunks.createIndex("documentId", "documentId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open knowledge database."));
  });
}

async function deleteDocumentChunks(store, documentId) {
  const index = store.index("documentId");
  const chunks = await requestAsPromise(index.getAllKeys(documentId));
  chunks.forEach((key) => store.delete(key));
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

function splitText(text, chunkChars) {
  const chunks = [];
  let remaining = text;
  while (remaining) {
    if (remaining.length <= chunkChars) {
      chunks.push(remaining);
      break;
    }
    const boundary = Math.max(remaining.lastIndexOf("\n", chunkChars), remaining.lastIndexOf(". ", chunkChars), remaining.lastIndexOf("。", chunkChars));
    const end = boundary > Math.floor(chunkChars * 0.55) ? boundary + 1 : chunkChars;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  return chunks.filter(Boolean);
}

function scoreChunk(content, terms, normalizedQuery) {
  const text = String(content || "").toLowerCase();
  let score = normalizedQuery.length > 2 && text.includes(normalizedQuery) ? 8 : 0;
  for (const term of terms) {
    const matches = text.split(term).length - 1;
    score += Math.min(matches, 5);
  }
  return score;
}

function excerpt(content, terms, maxChars) {
  const text = String(content || "");
  const lower = text.toLowerCase();
  const index = terms.map((term) => lower.indexOf(term)).find((value) => value >= 0) ?? 0;
  const start = Math.max(0, index - Math.floor(maxChars / 4));
  return `${start ? "..." : ""}${text.slice(start, start + maxChars)}${start + maxChars < text.length ? "..." : ""}`;
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function tokenize(value) {
  const text = normalizeText(value).toLowerCase();
  const terms = text.match(/[a-z0-9_-]{2,}|[\p{Script=Han}]{2,}/gu) || [];
  for (const run of text.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let index = 0; index < run.length - 1; index += 1) terms.push(run.slice(index, index + 2));
  }
  return Array.from(new Set(terms)).slice(0, 24);
}

function normalizeTags(value) {
  return Array.from(new Set((Array.isArray(value) ? value : String(value || "").split(",")).map((tag) => String(tag).trim()).filter(Boolean))).slice(0, 20);
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}
