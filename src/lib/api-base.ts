/**
 * Base de la API que consume el front.
 *
 * Vacía = same-origin (corriendo en la propia PC, modo local). Publicado en
 * Vercel, `NEXT_PUBLIC_API_BASE` apunta a la API de la PC detrás del túnel
 * (p. ej. `https://aoe2-api.tu-dominio.com`). Ojo: es una variable de build —
 * cambiarla exige re-deploy.
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
