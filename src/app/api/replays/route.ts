import { listReplays } from "@/lib/db";
import { preflightResponse, jsonResponse } from "@/lib/cors";
import { backendEnabled, backendDisabledResponse } from "@/lib/api-role";

export const runtime = "nodejs";

/**
 * Índice de replays para el dashboard: los últimos `limit`, más nuevos
 * primero. Sólo metadata; el modelo se pide por id cuando se abre una partida.
 */
export async function OPTIONS(request: Request): Promise<Response> {
  return preflightResponse(request);
}

export async function GET(request: Request): Promise<Response> {
  if (!backendEnabled()) return backendDisabledResponse();
  try {
    const url = new URL(request.url);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
    return jsonResponse(request, { replays: listReplays(limit) });
  } catch (error) {
    return jsonResponse(
      request,
      { error: "El índice no está disponible", detail: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}
