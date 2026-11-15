/**
 * Cache local de replays vistos, en IndexedDB.
 *
 * El backend (y su DB) viven en la PC del usuario: si la apaga, los deep links
 * mueren. Esta cache guarda el modelo JSON de los últimos replays vistos para
 * poder seguir mirándolos offline. Es una copia de conveniencia, con fecha:
 * no reemplaza al backend y podés quedar vieja.
 *
 * IndexedDB y no localStorage porque un modelo con viewlocks + terreno pesa
 * varios MB y localStorage se corrompe con cuotas de ~5 MB.
 */

const DB_NAME = "aoe2-replay-analyzer";
const DB_VERSION = 1;
const STORE = "models";
const MAX_ENTRIES = 5;

type CacheEntry = {
  id: string;
  fileName: string;
  savedAt: number;
  model: import("./types").ReplayModel;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Guarda el modelo (con id del backend). Si no hay id, no hay nada que cachear. */
export async function saveToCache(model: import("./types").ReplayModel): Promise<void> {
  const id = model.meta.id;
  if (!id) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const entry: CacheEntry = {
        id,
        fileName: model.meta.fileName,
        savedAt: Date.now(),
        model,
      };
      store.put(entry);
      // LRU: dejamos los últimos MAX_ENTRIES y borramos el resto.
      const index = store.getAllKeys();
      index.onsuccess = () => {
        const all = (index.result as string[]) ?? [];
        const older = all.slice(0, Math.max(0, all.length - MAX_ENTRIES));
        for (const key of older) store.delete(key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Sin cache (navegador en privado, cuota llena, etc.) no es fatal: el
    // backend es la fuente de verdad.
  }
}

export async function getFromCache(id: string): Promise<import("./types").ReplayModel | null> {
  try {
    const db = await openDb();
    const entry = await new Promise<CacheEntry | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return entry?.model ?? null;
  } catch {
    return null;
  }
}

/** Lista de replays cacheados, del más reciente al más viejo. */
export async function listCache(): Promise<Array<{ id: string; fileName: string; savedAt: number }>> {
  try {
    const db = await openDb();
    const entries = await new Promise<CacheEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return entries
      .sort((a, b) => b.savedAt - a.savedAt)
      .map(({ id, fileName, savedAt }) => ({ id, fileName, savedAt }));
  } catch {
    return [];
  }
}
