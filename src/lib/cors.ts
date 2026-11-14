/**
 * CORS para que el front publicado (Vercel) consuma esta API corriendo en
 * otra origen (la PC del dueño detrás del túnel).
 *
 * `ALLOWED_ORIGIN` admite una lista separada por comas o `*`. Sin la variable,
 * la API queda same-origin (como hasta ahora): el modo local no cambia. Ojo:
 * los POST del navegador mandan `Origin` incluso same-origin, así que la
 * propia origen de la request siempre se considera permitida.
 */

function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** true si la `Origin` de la request puede consumir la API. */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // curl, scripts, server-to-server: no hay qué verificar
  const allowed = allowedOrigins();
  if (allowed.includes("*")) return true;
  try {
    const sameOrigin = origin === new URL(request.url).origin;
    return sameOrigin || allowed.includes(origin);
  } catch {
    return false;
  }
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !originAllowed(request)) return {};
  const allowed = allowedOrigins();
  if (allowed.includes("*")) return { "access-control-allow-origin": "*" };
  return { "access-control-allow-origin": origin, vary: "Origin" };
}

export function preflightResponse(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
}

/** Envuelve un payload JSON con los headers CORS que correspondan. */
export function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(request) });
}
