import { parseReplay } from "@/lib/parse-replay";

// El parser es WASM sobre Node: nada de edge.
export const runtime = "nodejs";
export const maxDuration = 60;

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

  try {
    const model = parseReplay(buffer, file.name);
    return Response.json({
      ...model,
      meta: { ...model.meta, parseMs: Date.now() - started, bytes: buffer.byteLength },
    });
  } catch (error) {
    return Response.json(
      {
        error: "No se pudo parsear el replay",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 422 },
    );
  }
}
