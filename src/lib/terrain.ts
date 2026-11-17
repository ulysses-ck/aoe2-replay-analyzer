/**
 * Terreno con las texturas reales del juego: `terrain.json` + WebP generados
 * una vez con tools/sprites de sk8erlucas/aoe2-replays (MIT) contra la
 * instalación local de AoE2:DE, servidos por el backend junto al resto de los
 * sprites (el arte es de Microsoft, bajo las Game Content Usage Rules).
 *
 * El terreno de siempre es un canvas offscreen con UN píxel por tile que el
 * frame transforma con la matriz isométrica. Acá se bakea el mismo canvas pero
 * con `texels` píxeles por tile: cada textura es una vista cenital que repite
 * cada `tiles` tiles de mapa, así que un `createPattern` con transform
 * identidad en espacio de mapa alinea las repeticiones con los tiles y la
 * costura entre diamantes no existe (el transform del frame convierte cada
 * cuadrado de texels en el diamante del tile). Sobre el patrón va una capa de
 * luz por elevación y pendiente, bakeada.
 *
 * Si el bake falla (imagen cortada, backend caído) el caller se queda con el
 * canvas de paleta de siempre: nunca se pierde el mapa.
 */
import { API_BASE } from "./api-base";
import type { TerrainModel } from "./types";

type TextureEntry = [file: string, tiles: number, color: string];

type TerrainManifest = {
  tilePx: number;
  textures: Record<string, TextureEntry>;
  terrains: Record<string, string>;
};

export type PreparedTexture = {
  image: HTMLImageElement;
  /** Cuántos tiles de mapa abarca una repetición de la textura. */
  tiles: number;
  /** Color promedio (fallback de paleta si la imagen no se puede usar). */
  color: string;
};

export type TerrainSet = {
  /** Map<terrain id, textura lista> sólo para los ids con arte cargado. */
  textures: Map<number, PreparedTexture>;
};

const RETRIES = 2;

export async function loadTerrainTextures(
  terrainIds: Set<number>,
  baseUrl = `${API_BASE}/sprites`,
): Promise<TerrainSet> {
  const res = await fetch(`${baseUrl}/terrain.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`terrain manifest: HTTP ${res.status}`);
  const manifest = (await res.json()) as TerrainManifest;

  const wanted = new Map<number, TextureEntry>();
  for (const id of terrainIds) {
    const name = manifest.terrains[String(id)];
    const entry = name && manifest.textures[name];
    if (entry) wanted.set(id, entry);
  }

  const textures = new Map<number, PreparedTexture>();
  await Promise.all(
    [...wanted].map(
      ([id, entry]) =>
        new Promise<void>((resolve) => {
          let tries = 0;
          const attempt = () => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              textures.set(id, { image: img, tiles: entry[1], color: entry[2] });
              resolve();
            };
            img.onerror = () => {
              if (tries++ < RETRIES) setTimeout(attempt, 800 * tries);
              // Sin imagen para este id: el caller cae a su paleta.
              resolve();
            };
            img.src = `${baseUrl}/${entry[0]}`;
          };
          attempt();
        }),
    ),
  );
  return { textures };
}

/**
 * Bakea el canvas offscreen del terreno con texturas y luz por elevación.
 * Devuelve null si no hay nada que dibujar (sin modelo o sin texturas).
 */
export function bakeTerrainCanvas(terrain: TerrainModel, set: TerrainSet, texels: number): HTMLCanvasElement | null {
  const dim = terrain.dimension;
  if (!dim || terrain.terrain.length !== dim * dim) return null;
  if (set.textures.size === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = dim * texels;
  canvas.height = dim * texels;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const elev = terrain.elevation;
  const e = (x: number, y: number) =>
    elev[Math.min(dim - 1, Math.max(0, y)) * dim + Math.min(dim - 1, Math.max(0, x))] ?? 0;

  // Fill por id de terreno: patrón de textura (alineado al espacio de mapa) o
  // color de paleta para los ids sin arte.
  const fills = new Map<number, { pattern: CanvasPattern | null; color: string }>();
  for (const id of new Set(terrain.terrain)) {
    const tex = set.textures.get(id);
    if (tex) {
      // La textura se dibuja a texels·tiles px de lado; el patrón repite
      // alineado con la grilla de tiles (transform identidad en el offscreen).
      const scaled = document.createElement("canvas");
      const side = texels * tex.tiles;
      scaled.width = side;
      scaled.height = side;
      const sctx = scaled.getContext("2d");
      if (!sctx) {
        fills.set(id, { pattern: null, color: tex.color });
        continue;
      }
      sctx.drawImage(tex.image, 0, 0, side, side);
      fills.set(id, { pattern: ctx.createPattern(scaled, "repeat"), color: tex.color });
    } else {
      // Sin arte: null en pattern → el caller lo resuelve con su paleta.
      fills.set(id, { pattern: null, color: "" });
    }
  }

  // Un pass por tile: cuadrado del patrón + luz por elevación/pendiente
  // (la luz viene de arriba de la pantalla, igual que en el juego).
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const id = terrain.terrain[y * dim + x];
      const fill = fills.get(id);
      if (!fill) continue;
      const sx = x * texels;
      const sy = y * texels;
      if (fill.pattern) {
        ctx.fillStyle = fill.pattern;
      } else {
        ctx.fillStyle = paletteColor(id, fill.color);
      }
      ctx.fillRect(sx, sy, texels, texels);
      const ez = e(x, y);
      const slope = (e(x - 1, y) + e(x, y - 1) - e(x + 1, y) - e(x, y + 1)) / 2;
      const light = ez * 0.03 + slope * 0.09;
      if (Math.abs(light) >= 0.01) {
        ctx.fillStyle = light > 0 ? `rgba(255,255,255,${light.toFixed(3)})` : `rgba(0,0,0,${(-light).toFixed(3)})`;
        ctx.fillRect(sx, sy, texels, texels);
      }
    }
  }
  return canvas;
}

/**
 * Color de paleta para los ids sin textura. Recibe el color promedio del
 * manifest (si este id tenía textura pero su imagen no cargó) y si no, cae a
 * la paleta de MapCanvas que se pasa por parámetro al construir el set.
 */
export function paletteColor(id: number, manifestColor: string): string {
  if (manifestColor) return manifestColor;
  return TERRAIN_FALLBACK[id] ?? "#5e6b4a";
}

/**
 * Paleta mínima de respaldo para los ids sin textura (los más comunes).
 * El color de paleta completo vive en MapCanvas; acá sólo los básicos.
 */
const TERRAIN_FALLBACK: Record<number, string> = {
  0: "#4a7a30", // pasto
  1: "#3a6f92", // agua shallow
  2: "#b3a06b", // playa
  3: "#7d6b4c", // tierra
  4: "#4d86a6", // agua
  7: "#a08b3c", // granja
  8: "#8f7f46", // granja 2
  9: "#3f6a2a", // pasto 3
  10: "#2c4f20", // bosque
  12: "#456f2d", // pasto 2
  14: "#b09a62", // desierto
  22: "#274c68", // agua profunda
  23: "#2f5c7c", // agua media
  32: "#c7cfd4", // nieve
  47: "#15171a", // sin explorar
  68: "#15171a", // sin explorar 2
};
