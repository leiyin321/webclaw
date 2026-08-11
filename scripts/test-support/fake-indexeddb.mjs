export function createFakeIndexedDB() {
  const databases = new Map();
  return {
    open(name, version) {
      const request = requestObject();
      queueMicrotask(() => {
        let database = databases.get(name);
        const upgrading = !database || Number(version || 1) > database.version;
        if (!database) {
          database = createDatabase(Number(version || 1));
          databases.set(name, database);
        } else if (upgrading) {
          database.version = Number(version || database.version);
        }
        request.result = database;
        if (upgrading) request.onupgradeneeded?.({ target: request });
        request.onsuccess?.({ target: request });
      });
      return request;
    }
  };
}

function createDatabase(version) {
  const definitions = new Map();
  return {
    version,
    objectStoreNames: { contains: (name) => definitions.has(name) },
    createObjectStore(name, options = {}) {
      const definition = { keyPath: options.keyPath || "id", records: new Map(), indexes: new Map() };
      definitions.set(name, definition);
      return upgradeStore(definition);
    },
    transaction(storeNames) {
      const transaction = createTransaction();
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      for (const name of names) {
        if (!definitions.has(name)) throw new Error(`Object store not found: ${name}`);
      }
      transaction.objectStore = (name) => transactionalStore(definitions.get(name), transaction);
      transaction.scheduleCompletion();
      return transaction;
    }
  };
}

function upgradeStore(definition) {
  return {
    createIndex(name, keyPath) {
      definition.indexes.set(name, keyPath);
      return {};
    }
  };
}

function createTransaction() {
  let pending = 0;
  let completionTimer = null;
  let finished = false;
  const transaction = {
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    begin() {
      if (finished) throw new Error("Transaction already finished");
      pending += 1;
      if (completionTimer) clearTimeout(completionTimer);
      completionTimer = null;
    },
    end() {
      pending -= 1;
      transaction.scheduleCompletion();
    },
    scheduleCompletion() {
      if (finished || pending > 0 || completionTimer) return;
      completionTimer = setTimeout(() => {
        if (finished || pending > 0) return;
        finished = true;
        transaction.oncomplete?.();
      }, 0);
    },
    abort() {
      if (finished) return;
      finished = true;
      if (completionTimer) clearTimeout(completionTimer);
      transaction.onabort?.();
    }
  };
  return transaction;
}

function transactionalStore(definition, transaction) {
  const request = (operation) => asyncRequest(transaction, operation);
  return {
    get(key) { return request(() => clone(definition.records.get(key))); },
    getAll() { return request(() => [...definition.records.values()].map(clone)); },
    put(value) {
      return request(() => {
        const copy = clone(value);
        definition.records.set(copy[definition.keyPath], copy);
        return copy[definition.keyPath];
      });
    },
    delete(key) { return request(() => definition.records.delete(key)); },
    index(name) {
      const keyPath = definition.indexes.get(name);
      if (!keyPath) throw new Error(`Index not found: ${name}`);
      return {
        getAll(key) {
          return request(() => [...definition.records.values()]
            .filter((value) => value[keyPath] === key)
            .map(clone));
        },
        openCursor(key) {
          const entries = [...definition.records.entries()].filter(([, value]) => value[keyPath] === key);
          const cursorRequest = requestObject();
          let index = 0;
          transaction.begin();
          const advance = () => queueMicrotask(() => {
            const entry = entries[index];
            if (!entry) {
              cursorRequest.result = null;
              cursorRequest.onsuccess?.({ target: cursorRequest });
              transaction.end();
              return;
            }
            const [recordKey, value] = entry;
            cursorRequest.result = {
              value: clone(value),
              delete: () => definition.records.delete(recordKey),
              continue: () => {
                index += 1;
                advance();
              }
            };
            cursorRequest.onsuccess?.({ target: cursorRequest });
          });
          advance();
          return cursorRequest;
        }
      };
    }
  };
}

function asyncRequest(transaction, operation) {
  const request = requestObject();
  transaction.begin();
  queueMicrotask(() => {
    try {
      request.result = operation();
      request.onsuccess?.({ target: request });
    } catch (error) {
      request.error = error;
      request.onerror?.({ target: request });
    } finally {
      transaction.end();
    }
  });
  return request;
}

function requestObject() {
  return { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}
