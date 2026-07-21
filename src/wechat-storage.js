const STORAGE_KEY = "wechatBridgeState";
const MEDIA_DB_NAME = "webclaw-wechat-media";
const MEDIA_STORE = "media";

function storageGet(key) {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    return storageRpc("WEBCLAW_WECHAT_STORAGE_GET", { key });
  }
  return new Promise((resolve) => storage.get(key, resolve));
}

function storageSet(value) {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    return storageRpc("WEBCLAW_WECHAT_STORAGE_SET", { value }).then(() => undefined);
  }
  return new Promise((resolve, reject) => {
    storage.set(value, () => {
      const error = globalThis.chrome?.runtime?.lastError;
      if (error) {
        reject(new Error(error.message || String(error)));
        return;
      }
      resolve();
    });
  });
}

function storageRpc(type, payload) {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) {
    return Promise.reject(new Error("chrome.storage.local is unavailable and runtime storage RPC is not available."));
  }
  return new Promise((resolve, reject) => {
    runtime.sendMessage({ type, ...payload }, (response) => {
      const error = runtime.lastError;
      if (error) {
        reject(new Error(error.message || String(error)));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || `${type} failed.`));
        return;
      }
      resolve(response.result || {});
    });
  });
}

function normalizeState(state) {
  const raw = state && typeof state === "object" ? state : {};
  return {
    activeAccountId: String(raw.activeAccountId || ""),
    accounts: raw.accounts && typeof raw.accounts === "object" ? raw.accounts : {},
    syncBufs: raw.syncBufs && typeof raw.syncBufs === "object" ? raw.syncBufs : {},
    peers: raw.peers && typeof raw.peers === "object" ? raw.peers : {},
    pendingMessages: Array.isArray(raw.pendingMessages) ? raw.pendingMessages : [],
    runtime: raw.runtime && typeof raw.runtime === "object" ? raw.runtime : {},
    login: raw.login && typeof raw.login === "object" ? raw.login : {},
    updatedAt: String(raw.updatedAt || "")
  };
}

async function loadState() {
  const stored = await storageGet(STORAGE_KEY);
  return normalizeState(stored[STORAGE_KEY]);
}

async function saveState(patch) {
  const current = await loadState();
  const next = normalizeState({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  });
  await storageSet({ [STORAGE_KEY]: next });
  return next;
}

export async function loadWechatState() {
  return loadState();
}

export async function saveWechatState(patch) {
  return saveState(patch);
}

export function normalizeAccountId(accountId) {
  return String(accountId || "default")
    .replace(/@/g, "-")
    .replace(/[^a-zA-Z0-9_.-]/g, "-");
}

export async function listWechatAccountIds() {
  const state = await loadState();
  return Object.keys(state.accounts || {});
}

export async function loadWechatAccount(accountId) {
  const state = await loadState();
  const id = accountId ? normalizeAccountId(accountId) : state.activeAccountId || Object.keys(state.accounts || {}).at(-1);
  if (!id) return null;
  return state.accounts[id] || null;
}

export async function saveWechatAccount(accountId, data) {
  const normalized = normalizeAccountId(accountId);
  const state = await loadState();
  const nextAccounts = {
    ...(state.accounts || {}),
    [normalized]: {
      ...(state.accounts?.[normalized] || {}),
      ...data,
      accountId: normalized,
      rawAccountId: accountId,
      savedAt: new Date().toISOString()
    }
  };
  await saveState({
    accounts: nextAccounts,
    activeAccountId: normalized
  });
  return nextAccounts[normalized];
}

export async function loadLatestWechatAccount() {
  const state = await loadState();
  const id = state.activeAccountId || Object.keys(state.accounts || {}).at(-1);
  if (!id) return null;
  return state.accounts[id] || null;
}

export async function getLocalTokenList() {
  const state = await loadState();
  return Object.values(state.accounts || {})
    .slice(-10)
    .reverse()
    .map((account) => account?.token)
    .filter(Boolean);
}

export async function loadWechatSyncBuf(accountId) {
  const state = await loadState();
  return String(state.syncBufs?.[normalizeAccountId(accountId)] || "");
}

export async function saveWechatSyncBuf(accountId, getUpdatesBuf) {
  const state = await loadState();
  const normalized = normalizeAccountId(accountId);
  await saveState({
    syncBufs: {
      ...(state.syncBufs || {}),
      [normalized]: String(getUpdatesBuf || "")
    }
  });
}

export async function loadWechatPeers(accountId) {
  const state = await loadState();
  return state.peers?.[normalizeAccountId(accountId)] || {};
}

export async function saveWechatPeer(accountId, peerId, patch) {
  if (!peerId) return {};
  const normalizedAccountId = normalizeAccountId(accountId);
  const state = await loadState();
  const peersForAccount = {
    ...(state.peers?.[normalizedAccountId] || {})
  };
  peersForAccount[peerId] = {
    ...(peersForAccount[peerId] || {}),
    ...patch,
    peerId,
    lastSeenAt: new Date().toISOString()
  };
  await saveState({
    peers: {
      ...(state.peers || {}),
      [normalizedAccountId]: peersForAccount
    }
  });
  return peersForAccount[peerId];
}

function openMediaDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(MEDIA_STORE, { keyPath: "mediaId" });
    };
    request.onerror = () => reject(new Error(request.error?.message || "Failed to open media database."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function withMediaStore(mode, handler) {
  const db = await openMediaDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, mode);
      const store = tx.objectStore(MEDIA_STORE);
      Promise.resolve(handler(store, tx)).then(resolve, reject);
      tx.onerror = () => reject(new Error(tx.error?.message || "Media transaction failed."));
    });
  } finally {
    db.close();
  }
}

export async function saveWechatMediaBlob(buffer, metadata) {
  const mediaId = globalThis.crypto.randomUUID();
  const blob = buffer instanceof Blob ? buffer : new Blob([buffer], { type: metadata.mime || "application/octet-stream" });
  const item = {
    mediaId,
    accountId: String(metadata.accountId || ""),
    kind: String(metadata.kind || "file"),
    fileName: String(metadata.fileName || `${mediaId}.bin`),
    mime: String(metadata.mime || blob.type || "application/octet-stream"),
    size: Number(metadata.size || blob.size || 0),
    blob,
    savedAt: new Date().toISOString()
  };
  await withMediaStore("readwrite", (store) => store.put(item));
  return item;
}

export async function getWechatMedia(mediaId) {
  return withMediaStore("readonly", (store) => new Promise((resolve, reject) => {
    const request = store.get(mediaId);
    request.onerror = () => reject(new Error(request.error?.message || "Media lookup failed."));
    request.onsuccess = () => resolve(request.result || null);
  }));
}

export async function getWechatMediaDataUrl(mediaId) {
  const media = await getWechatMedia(mediaId);
  if (!media) return null;
  const blob = media.blob instanceof Blob ? media.blob : new Blob([media.blob], { type: media.mime || "application/octet-stream" });
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  const base64 = btoa(binary);
  return {
    mediaId: media.mediaId,
    kind: media.kind,
    fileName: media.fileName,
    mime: media.mime,
    size: media.size,
    dataUrl: `data:${media.mime || "application/octet-stream"};base64,${base64}`
  };
}
