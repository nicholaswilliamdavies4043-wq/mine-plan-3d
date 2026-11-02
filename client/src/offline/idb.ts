/**
 * Minimal IndexedDB key-value wrapper. Falls back to memory when IndexedDB is unavailable
 * (private windows, blocked storage), so the app still works, only without offline persistence.
 */
const DB_NAME = 'mineplan-offline';
const STORES = ['kv', 'files'] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory: Record<StoreName, Map<string, unknown>> = { kv: new Map(), files: new Map() };

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then((db) => new Promise<T | undefined>((resolve) => {
    if (!db) return resolve(undefined);
    try {
      const tx = db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  }));
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory[store].get(key) as T | undefined;
  return run<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>);
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) { memory[store].set(key, value); return; }
  await run(store, 'readwrite', (s) => s.put(value, key));
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  const db = await open();
  if (!db) { memory[store].delete(key); return; }
  await run(store, 'readwrite', (s) => s.delete(key));
}

/** All entries whose key starts with a prefix. */
export async function idbEntries<T>(store: StoreName, prefix = ''): Promise<[string, T][]> {
  const db = await open();
  if (!db) return [...memory[store].entries()].filter(([k]) => k.startsWith(prefix)) as [string, T][];
  const range = prefix ? IDBKeyRange.bound(prefix, prefix + '￿') : undefined;
  const [keys, values] = await Promise.all([
    run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys(range)),
    run<T[]>(store, 'readonly', (s) => s.getAll(range)),
  ]);
  return (keys ?? []).map((k, i) => [String(k), (values ?? [])[i]]);
}
