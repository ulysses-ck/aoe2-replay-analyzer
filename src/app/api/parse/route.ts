import { parseReplay, ReplayParseError } from "@/lib/parse-replay";
import { replayId, saveReplayModel } from "@/lib/replay-store";

// El parser corre en un worker con WASM sobre Node: nada de edge.
export const runtime = "nodejs";
export const maxDuration = 60;

const MESSAGES: Record<string, string> = {
  unsupported:
    "El replay no se pudo decodificar: el formato no está soportado por los parsers disponibles.",
  timeout: "El parseo tardó demasiado. Probá con un archivo más chico.",
  crashed: "El parser se cayó procesando el archivo.",
};

export async function POST(request: Request) {
  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    return Response.json({ error: "Se esperaba multipart/form-data" }, { status: 400 });
  }

  if (!file) {
    return Response.json({ error: "Falta el campo 'file'" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const started = Date.now();
  // El hash se calcula antes: parseReplay transfiere el buffer al worker.
  const id = replayId(buffer);

  try {
    const model = await parseReplay(buffer, file.name);
    const payload = {
      ...model,
      meta: { ...model.meta, id, parseMs: Date.now() - started },
    };

    // El cache es un extra: si falla, igual devolvemos el modelo.
    try {
      await saveReplayModel(id, payload);
    } catch {
      // sin cache el link compartible no funciona, pero el análisis sí
    }

    return Response.json(payload);
  } catch (error) {
    if (error instanceof ReplayParseError) {
      return Response.json(
        { error: MESSAGES[error.code] ?? "No se pudo parsear el replay", code: error.code, detail: error.message },
        { status: 422 },
      );
    }
    return Response.json(
      {
        error: "No se pudo parsear el replay",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 422 },
    );
  }
}
