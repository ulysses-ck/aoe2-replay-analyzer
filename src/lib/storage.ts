/**
 * Adapter de almacenamiento para replays y modelos parseados.
 *
 * Todo lo que persiste el backend pasa por esta interfaz, así el paso a un
 * backend remoto (S3, R2, un NAS) es cambiar la implementación en la fábrica,
 * no tocar las rutas. La clave es el id del replay (hash del archivo).
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type StorageAdapter = {
  /** Escribe (o reemplaza) el contenido de una clave. */
  put(key: string, data: Uint8Array): Promise<void>;
  /** Lee el contenido de una clave, o null si no existe. */
  get(key: string): Promise<Uint8Array | null>;
  /** true si la clave existe. */
  has(key: string): Promise<boolean>;
  /** Nombre legible del backend (logs y respuestas de diagnóstico). */
  readonly backend: string;
};

const SAFE_KEY = /^[0-9a-f]{8,64}\.(record|json)$/;

/** Validación dura: las claves son siempre `<id>.record|json`, nada de paths. */
function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key)) {
    throw new Error(`clave de storage inválida: ${key}`);
  }
}

/**
 * Backend de disco local. La ruta sale de `REPLAY_STORAGE_DIR` para no clavar
 * rutas de máquina en el repo; por defecto `.cache/replays` (que ya usa el
 * cache de deep links, así la migración es transparente).
 */
function localDiskStorage(): StorageAdapter {
  const dir = process.env.REPLAY_STORAGE_DIR || path.join(process.cwd(), ".cache", "replays");
  const fileFor = (key: string): string => path.join(dir, key);
  return {
    backend: "local-disk",
    async put(key, data) {
      assertSafeKey(key);
      await mkdir(dir, { recursive: true });
      await writeFile(fileFor(key), data);
    },
    async get(key) {
      assertSafeKey(key);
      try {
        return new Uint8Array(await readFile(fileFor(key)));
      } catch {
        return null;
      }
    },
    async has(key) {
      assertSafeKey(key);
      try {
        await stat(fileFor(key));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Fábrica: elige el backend según `REPLAY_STORAGE_BACKEND`. Hoy sólo hay disco;
 * el valor reservado `s3` falla a propósito hasta implementar el adapter (así
 * un env mal puesto no guarda nada silenciosamente en otro lado).
 */
export function getStorage(): StorageAdapter {
  const backend = process.env.REPLAY_STORAGE_BACKEND || "local-disk";
  switch (backend) {
    case "local-disk":
      return localDiskStorage();
    case "s3":
      throw new Error("REPLAY_STORAGE_BACKEND=s3 todavía no está implementado");
    default:
      throw new Error(`REPLAY_STORAGE_BACKEND desconocido: ${backend}`);
  }
}
