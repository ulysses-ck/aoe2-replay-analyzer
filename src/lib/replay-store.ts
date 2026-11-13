import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Cache de modelos parseados en disco, direccionada por el hash del archivo.
 *
 * Sirve para que un deep link (`/?r=<id>&t=...`) abra la misma partida sin que
 * el que lo recibe tenga que volver a subir el `.aoe2record`. Como el id es el
 * hash del contenido, subir dos veces el mismo replay no duplica nada.
 *
 * La ruta sale de `REPLAY_CACHE_DIR` para no clavar rutas de máquina en el repo.
 */

const CACHE_DIR = process.env.REPLAY_CACHE_DIR || path.join(process.cwd(), ".cache", "replays");
const ID_LENGTH = 16;

export function replayId(buffer: ArrayBuffer): string {
  return createHash("sha256").update(new Uint8Array(buffer)).digest("hex").slice(0, ID_LENGTH);
}

/** Valida el id antes de tocarlo: sólo hex, para no escapar del directorio. */
function isSafeId(id: string): boolean {
  return /^[0-9a-f]{8,64}$/.test(id);
}

function fileFor(id: string): string {
  return path.join(CACHE_DIR, `${id}.json`);
}

export async function saveReplayModel(id: string, payload: unknown): Promise<void> {
  if (!isSafeId(id)) throw new Error(`id inválido: ${id}`);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(fileFor(id), JSON.stringify(payload), "utf8");
}

export async function loadReplayModel(id: string): Promise<string | null> {
  if (!isSafeId(id)) return null;
  try {
    return await readFile(fileFor(id), "utf8");
  } catch {
    return null;
  }
}
