// Remembers the last upload in this browser (IndexedDB), so a refresh
// doesn't lose it. If storage is blocked, everything still works for the
// current visit.

const DB = 'daylight';
const STORE = 'custom';
const KEY = 'current';

export interface SavedCustom {
  file: Blob;
  name: string;
  options: { motion: string; anchor: string; threshold: number; invert: boolean };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export const loadSaved = () => run<SavedCustom>('readonly', (s) => s.get(KEY));
export const save = (value: SavedCustom) => run('readwrite', (s) => s.put(value, KEY));
export const forget = () => run('readwrite', (s) => s.delete(KEY));
