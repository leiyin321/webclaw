const DB_NAME = "webclaw-document-artifacts";
const DB_VERSION = 1;
const STORE_NAME = "artifacts";
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const DEFAULT_ARTIFACT_MAX_AGE_MS = 10 * 60 * 1000;

export async function putDocumentArtifact(id, blob, metadata = {}) {
  const artifactId = requiredId(id);
  if (!(blob instanceof Blob)) throw new Error("Document artifact must be a Blob.");
  if (blob.size > MAX_ARTIFACT_BYTES) throw new Error(`Document artifact exceeds ${MAX_ARTIFACT_BYTES} bytes.`);
  await cleanupDocumentArtifacts();
  const database = await openDatabase();
  await transactionPromise(database, "readwrite", (store) => store.put({ id: artifactId, blob, metadata, createdAt: Date.now() }));
  return { id: artifactId, size: blob.size, mimeType: blob.type || "application/octet-stream" };
}

export async function cleanupDocumentArtifacts({ maxAgeMs = DEFAULT_ARTIFACT_MAX_AGE_MS, now = Date.now() } = {}) {
  const database = await openDatabase();
  const artifacts = await transactionPromise(database, "readonly", (store) => store.getAll());
  const cutoff = Number(now) - Math.max(0, Number(maxAgeMs) || 0);
  const expired = artifacts.filter((artifact) => Number(artifact?.createdAt || 0) <= cutoff);
  for (const artifact of expired) {
    await transactionPromise(database, "readwrite", (store) => store.delete(artifact.id));
  }
  return { deleted: expired.length };
}

export async function takeDocumentArtifact(id) {
  const artifactId = requiredId(id);
  const database = await openDatabase();
  const artifact = await transactionPromise(database, "readonly", (store) => store.get(artifactId));
  if (!artifact?.blob) throw new Error(`Document artifact was not found: ${artifactId}`);
  await transactionPromise(database, "readwrite", (store) => store.delete(artifactId));
  return artifact;
}

export async function deleteDocumentArtifact(id) {
  const database = await openDatabase();
  await transactionPromise(database, "readwrite", (store) => store.delete(requiredId(id)));
}

function requiredId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id)) throw new Error("Invalid document artifact ID.");
  return id;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open document artifact store."));
  });
}

function transactionPromise(database, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error("Document artifact operation failed."));
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error || new Error("Document artifact transaction was aborted."));
  });
}
