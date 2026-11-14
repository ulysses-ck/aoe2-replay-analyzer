import { getStorage } from "@/lib/storage";
import { corsHeaders, preflightResponse } from "@/lib/cors";

export const runtime = "nodejs";

/**
 * Devuelve un modelo ya parseado a partir de su id (hash del archivo).
 * Es lo que hace que un deep link abra la partida sin re-subir el replay.
 */
export async function OPTIONS(request: Request): Promise<Response> {
  return preflightResponse(request);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await getStorage().get(`${id}.json`);
  if (!payload) {
    return Response.json(
      { error: "No hay un replay con ese id" },
      { status: 404, headers: corsHeaders(request) },
    );
  }
  // BodyInit espera un ArrayBuffer acotado al contenido (la vista puede ser
  // más grande que el archivo leído).
  const bytes = new Uint8Array(payload.byteLength);
  bytes.set(payload);
  return new Response(bytes.buffer as ArrayBuffer, {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=31536000, immutable",
      ...corsHeaders(request),
    },
  });
}
