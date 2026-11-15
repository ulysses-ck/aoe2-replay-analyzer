import { createHash } from "node:crypto";

/**
 * Id de un replay: hash del contenido mezclado con la versión del shape del
 * modelo. Si el modelo cambia (p. ej. cuando se agregó `terrain`), los ids
 * cambian y el cache/DB viejos quedan inaccesibles en vez de servir modelos
 * incompletos para siempre.
 *
 * El modelo y el archivo original se guardan con el storage adapter
 * (`src/lib/storage.ts`); la metadata en la DB (`src/lib/db.ts`).
 */
const ID_LENGTH = 16;
const MODEL_VERSION = "4-phases";

export function replayId(buffer: ArrayBuffer): string {
  return createHash("sha256")
    .update(MODEL_VERSION)
    .update(new Uint8Array(buffer))
    .digest("hex")
    .slice(0, ID_LENGTH);
}
