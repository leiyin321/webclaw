const DB_NAME = "webclaw-document-revisions";
const DB_VERSION = 1;
const STORE = "revisions";
const MAX_REVISIONS_PER_PATH = 20;
const MAX_REVISION_BYTES_PER_PATH = 100 * 1024 * 1024;

export async function saveDocumentRevision(path, blob, metadata = {}) {
  const entry = {
    id: `${path}:${metadata.version || 0}:${crypto.randomUUID()}`,
    path: String(path),
    version: Number(metadata.version || 0),
    hash: String(metadata.hash || ""),
    mimeType: String(metadata.mimeType || blob.type || "application/octet-stream"),
    size: blob.size,
    createdAt: Date.now(),
    blob
  };
  const db = await openDatabase();
  const transaction = db.transaction(STORE, "readwrite");
  const store = transaction.objectStore(STORE);
  store.put(entry);
  const existing = await requestAsPromise(store.index("path").getAll(entry.path));
  const retained = [...new Map([...existing, entry].map((revision) => [revision.id, revision])).values()].sort((a, b) => b.createdAt - a.createdAt);
  let retainedBytes = 0;
  for (const [index, revision] of retained.entries()) {
    retainedBytes += Number(revision.size || 0);
    if (index >= MAX_REVISIONS_PER_PATH || (index > 0 && retainedBytes > MAX_REVISION_BYTES_PER_PATH)) store.delete(revision.id);
  }
  await transactionDone(transaction);
  db.close();
  return publicRevision(entry);
}

export async function listDocumentRevisions(path, options = {}) {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, "readonly");
  const entries = await requestAsPromise(transaction.objectStore(STORE).index("path").getAll(String(path)));
  await transactionDone(transaction);
  db.close();
  return entries.filter((entry) => entry.path === String(path)).sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, Math.min(Number(options.limit) || 50, 200))).map(publicRevision);
}

export async function getDocumentRevision(id) {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, "readonly");
  const entry = await requestAsPromise(transaction.objectStore(STORE).get(String(id)));
  await transactionDone(transaction);
  db.close();
  return entry || null;
}

export async function deleteDocumentRevisions(path) {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, "readwrite");
  const store = transaction.objectStore(STORE);
  const entries = await requestAsPromise(store.index("path").getAll(String(path)));
  entries.forEach((entry) => store.delete(entry.id));
  await transactionDone(transaction);
  db.close();
  return entries.length;
}

export async function deleteDocumentRevision(id) {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).delete(String(id));
  await transactionDone(transaction);
  db.close();
}

function publicRevision(entry) {
  return { id: entry.id, path: entry.path, version: entry.version, hash: entry.hash, mimeType: entry.mimeType, size: entry.size, createdAt: entry.createdAt };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("path", "path", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open document revision database."));
  });
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Document revision request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("Document revision transaction failed."));
  });
}
