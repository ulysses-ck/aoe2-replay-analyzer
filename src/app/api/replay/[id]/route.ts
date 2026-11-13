import { loadReplayModel } from "@/lib/replay-store";

export const runtime = "nodejs";

/**
 * Devuelve un modelo ya parseado a partir de su id (hash del archivo).
 * Es lo que hace que un deep link abra la partida sin re-subir el replay.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await loadReplayModel(id);
  if (!payload) {
    return Response.json({ error: "No hay un replay con ese id" }, { status: 404 });
  }
  return new Response(payload, {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=31536000, immutable" },
  });
}
