/**
 * ¿Este deploy es backend? El front de Vercel incluye las rutas /api (es el
 * mismo código), pero no puede correrlas: no tiene la DB ni el storage. Vercel
 * setea VERCEL=1 solo, así el guard es automático; BACKEND_ON_VERCEL=1 lo
 * desactiva si alguien quisiera correr el backend ahí (no recomendado).
 */
export function backendEnabled(): boolean {
  if (process.env.BACKEND_ON_VERCEL === "1") return true;
  return process.env.VERCEL !== "1";
}

export function backendDisabledResponse(): Response {
  return Response.json(
    {
      error: "Esta API corre en el backend propio (la PC detrás del túnel), no en el front.",
      hint: "Si estás viendo esto, el front probablemente no tiene NEXT_PUBLIC_API_BASE configurada.",
    },
    { status: 501 },
  );
}
