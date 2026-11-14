import { parseReplay, ReplayParseError } from "@/lib/parse-replay";
import { replayId } from "@/lib/replay-store";
import { getStorage } from "@/lib/storage";
import { upsertReplay } from "@/lib/db";
import { corsHeaders, originAllowed, preflightResponse, jsonResponse } from "@/lib/cors";

// El parser corre en un worker con WASM sobre Node: nada de edge.
export const runtime = "nodejs";
export const maxDuration = 60;

const MESSAGES: Record<string, string> = {
  unsupported:
    "El replay no se pudo decodificar: el formato no está soportado por los parsers disponibles.",
  timeout: "El parseo tardó demasiado. Probá con un archivo más chico.",
  crashed: "El parser se cayó procesando el archivo.",
};

export async function OPTIONS(request: Request): Promise<Response> {
  return preflightResponse(request);
}

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request)) {
    return jsonResponse(request, { error: "Origen no permitida" }, 403);
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    return jsonResponse(request, { error: "Se esperaba multipart/form-data" }, 400);
  }

  if (!file) {
    return jsonResponse(request, { error: "Falta el campo 'file'" }, 400);
  }

  const buffer = await file.arrayBuffer();
  // Copia para persistir el original: parseReplay transfiere el ArrayBuffer al
  // worker y lo deja detached, así que después del parse ya no se puede leer.
  const raw = new Uint8Array(buffer).slice();
  const started = Date.now();
  // El hash se calcula antes: parseReplay transfiere el buffer al worker.
  const id = replayId(buffer);

  try {
    const model = await parseReplay(buffer, file.name);
    const payload = {
      ...model,
      meta: { ...model.meta, id, parseMs: Date.now() - started },
    };

    // Persistencia: archivo original + modelo parseado + fila de la DB. El
    // índice es un extra: si falla, igual devolvemos el modelo.
    try {
      const storage = getStorage();
      await storage.put(`${id}.record`, raw);
      await storage.put(`${id}.json`, new TextEncoder().encode(JSON.stringify(payload)));
      upsertReplay({
        id,
        fileName: file.name,
        fileSize: buffer.byteLength,
        durationMs: Number(payload.meta.durationMs) || 0,
        playerCount: Number(payload.meta.playerCount) || 0,
        engine: String(payload.meta.engine),
        parseMs: Number(payload.meta.parseMs) || 0,
        createdAt: new Date().toISOString(),
      });
    } catch (cause) {
      // sin persistencia el análisis de esta sesión anda igual, pero el error
      // tiene que verse en el log: es una señal de que algo está mal config
      console.warn("persistencia falló:", cause instanceof Error ? cause.stack : cause);
    }

    return jsonResponse(request, payload);
  } catch (error) {
    if (error instanceof ReplayParseError) {
      return jsonResponse(
        request,
        { error: MESSAGES[error.code] ?? "No se pudo parsear el replay", code: error.code, detail: error.message },
        422,
      );
    }
    return jsonResponse(
      request,
      {
        error: "No se pudo parsear el replay",
        detail: error instanceof Error ? error.message : String(error),
      },
      422,
    );
  }
}
