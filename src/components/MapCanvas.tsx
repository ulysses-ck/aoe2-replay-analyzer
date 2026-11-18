"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { playerColor, type ReplayModel, type BuildingEvent } from "@/lib/types";
import { getBuildingInfo, getBuildingTiles, drawBuildingIcon, inferStartingTownCenters } from "@/lib/buildings";
import { animFrame, buildUnitPaths, unitSnapshotAt, type UnitPath } from "@/lib/units";
import { bakeTerrainCanvas, loadTerrainTextures } from "@/lib/terrain";
import type { GaiaObject } from "@/lib/types";

type GaiaKind = "gold" | "stone" | "relic" | "berry" | "tree" | "other";
type GaiaDraw = { x: number; y: number; d: number; kind: GaiaKind };

const GOLD_IDS = new Set([66]);
const STONE_IDS = new Set([102]);
const RELIC_IDS = new Set([285, 688]);
const BERRY_IDS = new Set([59, 1059, 1021, 1022, 1023, 1024, 1025, 1026, 1027, 1028, 1029, 1030, 1031, 1032]);

function prepareGaia(objects?: GaiaObject[]): GaiaDraw[] {
  if (!objects?.length) return [];
  const out: GaiaDraw[] = [];
  for (const o of objects) {
    if (o.player !== 0) continue;
    const { typeId, classId, x, y } = o;
    let kind: GaiaKind | null = null;
    if (RELIC_IDS.has(typeId)) kind = "relic";
    else if (GOLD_IDS.has(typeId)) kind = "gold";
    else if (STONE_IDS.has(typeId)) kind = "stone";
    else if (BERRY_IDS.has(typeId)) kind = "berry";
    else if (classId === 20) kind = "tree";
    // Recursos/animales gaia menores (ciervos, jabalíes, ovejas, etc.) se
    // omiten por ahora para no saturar: el pedido explícito fue
    // reliquias/oro/árboles/piedra (y bayas).
    if (!kind) continue;
    out.push({ x, y, d: y - x, kind });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}
import { SpriteSet } from "@/lib/sprites";

type View = {
  /** Centro del viewport en píxeles del canvas. */
  cx: number;
  cy: number;
  /** Tamaño de una tile en píxeles (zoom). */
  unit: number;
};

type Size = { w: number; h: number };

/** Estado del viewport serializado para el deep link: centro en tiles + zoom. */
type ViewParams = { x: number; y: number; z: number };

/** Ajuste inicial: el rombo isométrico 2:1 entra completo en el canvas. */
function fitUnit(size: Size, mapSize: number): number {
  return Math.min((size.w * 0.9) / (2 * mapSize), (size.h * 0.9) / mapSize);
}

/**
 * Cámara del dueño en un instante dado.
 *
 * `viewlocks` son muestras comprimidas (sólo quedan los cambios), así que hay
 * que buscar el último cambio anterior al instante: eso es lo que el jugador
 * tenía en pantalla en ese momento. Devuelve null si el replay no trae cámara.
 */
export function viewAt(
  viewlocks: Array<[number, number, number]> | undefined,
  time: number,
): { x: number; y: number } | null {
  if (!viewlocks || viewlocks.length === 0) return null;
  let lo = 0;
  let hi = viewlocks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (viewlocks[mid][0] <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return { x: viewlocks[0][1], y: viewlocks[0][2] };
  return { x: viewlocks[found][1], y: viewlocks[found][2] };
}

/** Tile que queda en el centro del canvas para un view dado. */
function centerTile(view: View, size: Size, mapSize: number): { x: number; y: number } {
  const u = (size.w / 2 - view.cx) / view.unit;
  const v = (size.h / 2 - view.cy) / (view.unit * 0.5);
  // Inversa de px = (x+y-N)·unit, py = (y-x)·unit/2.
  return { x: (u - v + mapSize) / 2, y: (u + v + mapSize) / 2 };
}

/** View que deja el tile (x, y) en el centro del canvas. */
function viewForTile(
  tile: { x: number; y: number },
  unit: number,
  size: Size,
  mapSize: number,
): View {
  const u = tile.x + tile.y - mapSize;
  const v = tile.y - tile.x;
  return {
    cx: size.w / 2 - u * unit,
    cy: size.h / 2 - v * unit * 0.5,
    unit,
  };
}

/** Lee `?x=&y=&z=` de la URL. Devuelve null si no hay nada usable. */
function readViewParams(): ViewParams | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const rawX = params.get("x");
  const rawY = params.get("y");
  // Ojo: `Number(null)` es 0, así que hay que exigir que el param exista.
  if (!rawX || !rawY) return null;
  const x = Number(rawX);
  const y = Number(rawY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const z = Number(params.get("z"));
  return { x, y, z: Number.isFinite(z) && z > 0 ? z : 100 };
}

/** Aclara (factor > 1) u oscurece (factor < 1) un color hex. */
function shade(hex: string, factor: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const mix = (c: number) => Math.max(0, Math.min(255, Math.round(c * factor)));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// ─────────────────────────── paleta de terreno ───────────────────────────

/**
 * Color por id de terreno de DE (fuente: enum `TerrainId` de
 * AoE2ScenarioParser, que cubre hasta los DLCs más nuevos). No pretende
 * reproducir las texturas del juego: es una paleta por categorías — pasto,
 * agua, bosque, nieve, arena — para leer el mapa de un vistazo.
 */
const TERRAIN_PALETTE: Record<string, string> = {
  // Pasto y variantes (GRASS_1/2/3, OTHER, JUNGLE, DRY, MODDABLE, FLOWERS).
  "0": "#4a7a30", "9": "#3f6a2a", "12": "#456f2d", "16": "#47752f", "27": "#568232",
  "60": "#3d6d2e", "83": "#3a662b", "84": "#4a7a30", "85": "#456f2d", "86": "#3f6a2a",
  "87": "#47752f", "100": "#8a9a4a", "122": "#557f38", "123": "#5a8440",
  // Matorral.
  "5": "#566d3a", "71": "#5d6f45", "72": "#8e9a8e", "77": "#4f7030",
  // Tierra (DIRT_*, MUD, SAVANNAH).
  "3": "#7d6b4c", "6": "#877452", "11": "#826d4e", "41": "#9c854f", "42": "#7a6749",
  "44": "#6e5d42", "76": "#6f5f49",
  // Desierto y roca.
  "14": "#b09a62", "40": "#7a7a78", "45": "#9d8a55", "46": "#b5a068", "102": "#8d7a55",
  // Agua: profunda < media < shallow. 26 = ICE_NAVIGABLE, 111 = swamp.
  "1": "#3a6f92", "4": "#4d86a6", "22": "#274c68", "23": "#2f5c7c", "26": "#8fb0c0",
  "28": "#3a6f92", "57": "#223f55", "58": "#3d7aa0", "59": "#4d86a6", "93": "#4d86a6",
  "94": "#4d86a6", "95": "#3f7c6f", "96": "#5a6b52", "97": "#3a6f92", "98": "#3a6f92",
  "99": "#274c68", "111": "#4a5f63", "114": "#4d86a6", "115": "#4d86a6", "116": "#274c68",
  "130": "#466a70",
  // Playas.
  "2": "#b3a06b", "37": "#9fb3bd", "51": "#b3a06b", "52": "#a89e6e", "53": "#bfb287",
  "79": "#a99a66", "80": "#a99a66", "81": "#a99a66", "82": "#a99a66", "107": "#8f8668",
  "108": "#847c64", "109": "#7a7260",
  // Bosques: verdes oscuros; los de nieve/otoño van grisáceos y ocre.
  "10": "#2c4f20", "13": "#5c5a30", "17": "#2e5426", "18": "#33582a", "19": "#284620",
  "20": "#38612c", "21": "#5b6e57", "48": "#2c4f20", "49": "#565a2e", "50": "#3a5c28",
  "55": "#3f6b33", "56": "#27501f", "88": "#315423", "89": "#3f5a2b", "90": "#3f6b5c",
  "91": "#41705f", "92": "#3f6b5c", "104": "#6f5a34", "105": "#7c6d55", "106": "#665d49",
  "110": "#3a5c28", "112": "#4f6631", "113": "#33582a", "128": "#57583a", "131": "#28462a",
  "132": "#4d5c50", "133": "#2e5527",
  // Nieve.
  "32": "#c7cfd4", "33": "#9aa4aa", "34": "#b9c2c7", "36": "#c7cfd4", "38": "#a8adb3",
  "39": "#aab4ba", "43": "#9aa4aa", "61": "#a3aeb4", "73": "#cdd5da", "74": "#c7cfd4",
  "124": "#d3dade", "125": "#cdd5da", "126": "#c7cfd4",
  // Hielo.
  "35": "#a8c3d1", "127": "#a8c3d1",
  // Granjas y pasturas.
  "7": "#a08b3c", "8": "#8f7f46", "29": "#a08b3c", "30": "#9d883e", "31": "#9a8440",
  "63": "#9a8440", "64": "#8f7f46", "65": "#9a8440", "66": "#9d883e", "67": "#9a8440",
  "117": "#8f9448", "118": "#7d8244", "119": "#8f9448", "120": "#8f9448", "121": "#8f9448",
  // Caminos.
  "24": "#8b8069", "25": "#837a64", "75": "#9aa0a5", "78": "#96938a", "103": "#93918c",
  // Bloqueado / sin explorar.
  "47": "#15171a", "68": "#15171a", "129": "#1a1c1f",
};
const TERRAIN_DEFAULT = "#5e6b4a";

/** Etiqueta legible para el hover, sólo de los terrenos más comunes. */
const TERRAIN_NAMES: Record<number, string> = {
  0: "pasto", 1: "agua shallow", 2: "playa", 3: "tierra", 4: "shallow", 7: "granja",
  9: "pasto 3", 10: "bosque", 12: "pasto 2", 14: "desierto", 19: "pino", 21: "pino (nieve)",
  22: "agua profunda", 23: "agua media", 32: "nieve", 35: "hielo", 41: "sabana",
  76: "lodo", 100: "pasto seco", 117: "pastura",
};

/** Factor de brillo según elevación: 0-7 → 0.75-1.17. */
function elevationFactor(level: number): number {
  return Math.min(1.17, 0.75 + 0.06 * Math.max(0, level));
}

/**
 * Canvas offscreen con el terreno: un píxel por tile en espacio de mapa
 * (`índice = y * dimension + x`, verificado contra los edificios del body).
 * En el render se dibuja una sola vez por frame con una transform isométrica —
 * dibujar 48.400 diamantes por frame sería demasiado lento.
 */
function buildTerrainCanvas(terrain: { dimension: number; terrain: number[]; elevation: number[] }): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const dim = terrain.dimension;
  if (!dim || terrain.terrain.length !== dim * dim) return null;
  const offscreen = document.createElement("canvas");
  offscreen.width = dim;
  offscreen.height = dim;
  const context = offscreen.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(dim, dim);
  for (let i = 0; i < dim * dim; i += 1) {
    const color = TERRAIN_PALETTE[String(terrain.terrain[i])] ?? TERRAIN_DEFAULT;
    const factor = elevationFactor(terrain.elevation[i]);
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    image.data[i * 4] = Math.round(r * factor);
    image.data[i * 4 + 1] = Math.round(g * factor);
    image.data[i * 4 + 2] = Math.round(b * factor);
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return offscreen;
}

export default function MapCanvas({
  model,
  time,
  replayId,
  focus,
}: {
  model: ReplayModel;
  time: number;
  /** Id del replay en el cache: viaja en el deep link para poder reabrirlo. */
  replayId?: string;
  /** Salto a un tile (desde un highlight): re-centra el viewport una vez. */
  focus?: { x: number; y: number; nonce: number } | null;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View | null>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  /** Punteros activos (táctiles): key = pointerId. Con ≥2 entra el pinch. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** Estado del pinch: distancia y punto medio de los 2 dedos. */
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const appliedInitial = useRef(false);
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [zoomPct, setZoomPct] = useState(100);
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [follow, setFollow] = useState(false);
  const [heatmap, setHeatmap] = useState(false);
  /** Sprites reales del juego (atlas WebP del backend); null = todavía cargando. */
  const spritesRef = useRef<SpriteSet | null>(null);

  const mapSize = model.meta.mapSize || 200;
  const terrainCanvas = useMemo(() => (model.terrain ? buildTerrainCanvas(model.terrain) : null), [model.terrain]);
  // Terreno texturizado: canvas bakeado + cuántos px por tile tiene (para la
  // matriz isométrica del frame). Null hasta que cargan las texturas.
  const [terrainTex, setTerrainTex] = useState<{ canvas: HTMLCanvasElement; texels: number } | null>(null);
  const gaiaDraw = useMemo(() => prepareGaia(model.gaiaObjects), [model.gaiaObjects]);
  const allBuildings = useMemo(() => {
    const inferred = inferStartingTownCenters(model);
    if (inferred.length === 0) return model.buildings;
    return [...inferred, ...model.buildings];
  }, [model]);

  // Rutas estimadas de las unidades (encadenadas por id de las órdenes).
  // Un Map por id; el dibujo por frame las interpola y ordena por profundidad.
  const unitPaths = useMemo(() => buildUnitPaths(model), [model]);

  const clampUnit = useCallback(
    (unit: number, s: Size) => {
      const fit = fitUnit(s, mapSize);
      return Math.min(fit * 24, Math.max(fit * 0.7, unit));
    },
    [mapSize],
  );

  // Refleja viewport y tiempo en la URL, sin navegar: el link es compartible
  // y sobrevive a un refresh. Se debouncea porque el pan dispara por frame.
  const syncUrl = useCallback(
    (view: View, s: Size) => {
      if (urlTimer.current) clearTimeout(urlTimer.current);
      urlTimer.current = setTimeout(() => {
        const tile = centerTile(view, s, mapSize);
        const z = Math.round((view.unit / fitUnit(s, mapSize)) * 100);
        const params = new URLSearchParams(window.location.search);
        params.set("t", (time / 1000).toFixed(0));
        params.set("x", tile.x.toFixed(1));
        params.set("y", tile.y.toFixed(1));
        params.set("z", String(z));
        if (replayId) params.set("r", replayId);
        window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
      }, 450);
    },
    [mapSize, time, replayId],
  );

  // Tamaño del canvas siguiendo al contenedor.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const next = { w: Math.floor(width), h: Math.floor(height) };
      setSize(next);
      const current = viewRef.current;
      if (!current) {
        const params = appliedInitial.current ? null : readViewParams();
        appliedInitial.current = true;
        const fit = fitUnit(next, mapSize);
        if (params) {
          const unit = Math.min(fit * 24, Math.max(fit * 0.7, (fit * params.z) / 100));
          viewRef.current = viewForTile(params, unit, next, mapSize);
          setZoomPct(Math.round((unit / fit) * 100));
        } else {
          viewRef.current = { cx: next.w / 2, cy: next.h / 2, unit: fit };
        }
      } else {
        current.unit = clampUnit(current.unit, next);
        viewRef.current = { ...current };
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mapSize, clampUnit]);

  // Zoom anclado al cursor. Se registra nativo para poder cancelar el scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = viewRef.current;
      if (!view || size.w === 0) return;
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;

      const factor = Math.exp(-event.deltaY * 0.0015);
      const nextUnit = clampUnit(view.unit * factor, size);
      // Escalar alrededor del puntero: el punto bajo el cursor no se mueve.
      const ratio = nextUnit / view.unit;
      viewRef.current = {
        cx: mx - (mx - view.cx) * ratio,
        cy: my - (my - view.cy) * ratio,
        unit: nextUnit,
      };
      setZoomPct(Math.round((nextUnit / fitUnit(size, mapSize)) * 100));
      syncUrl(viewRef.current, size);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [size, mapSize, clampUnit, syncUrl]);

  const reset = useCallback(() => {
    if (size.w === 0) return;
    viewRef.current = { cx: size.w / 2, cy: size.h / 2, unit: fitUnit(size, mapSize) };
    setZoomPct(100);
    syncUrl(viewRef.current, size);
  }, [size, mapSize, syncUrl]);

  // El tiempo también forma parte del link.
  useEffect(() => {
    const view = viewRef.current;
    if (view && size.w > 0) syncUrl(view, size);
  }, [time, size, syncUrl]);

  // Seguir la cámara del dueño (Viewlock). Sólo mueve el centro: el zoom lo
  // decide el que mira. Si el usuario toca el mapa, se corta el seguimiento
  // hasta que lo vuelva a activar, para no pelear por el encuadre.
  useEffect(() => {
    if (!follow || size.w === 0) return;
    const target = viewAt(model.viewlocks, time);
    const view = viewRef.current;
    if (!target || !view) return;
    viewRef.current = viewForTile(target, view.unit, size, mapSize);
    setTick((value) => value + 1);
    // Sin esto, un salto con el reloj pausado deja el deep link desactualizado.
    syncUrl(viewRef.current, size);
  }, [follow, time, model.viewlocks, size, mapSize, syncUrl]);

  // Salto a un highlight: centra el tile y suelta el seguimiento (pelearían
  // por el encuadre). `nonce` hace que re-clickear el mismo salte de nuevo.
  // Se aplica UNA vez por nonce: el efecto depende de syncUrl (que cambia con
  // cada tick del reloj) y, sin ese filtro, machacaba el paneo del usuario.
  const appliedFocus = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || size.w === 0) return;
    if (appliedFocus.current === focus.nonce) return;
    const view = viewRef.current;
    if (!view) return;
    appliedFocus.current = focus.nonce;
    setFollow(false);
    viewRef.current = viewForTile({ x: focus.x, y: focus.y }, view.unit, size, mapSize);
    setTick((value) => value + 1);
    syncUrl(viewRef.current, size);
  }, [focus, size, mapSize, syncUrl]);

  const share = useCallback(async () => {
    const view = viewRef.current;
    if (!view || size.w === 0) return;
    // Escribimos el estado actual sin esperar el debounce.
    const tile = centerTile(view, size, mapSize);
    const z = Math.round((view.unit / fitUnit(size, mapSize)) * 100);
    const params = new URLSearchParams(window.location.search);
    params.set("t", (time / 1000).toFixed(0));
    params.set("x", tile.x.toFixed(1));
    params.set("y", tile.y.toFixed(1));
    params.set("z", String(z));
    if (replayId) params.set("r", replayId);
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Sin permiso de clipboard: al menos queda en la barra de direcciones.
    }
  }, [mapSize, size, time, replayId]);

  // Sprites del juego: manifiesto + las civilizaciones de la partida. Cada
  // página o civ que llega dispara un re-dibujo vía onLoad; hasta entonces
  // (o si el backend no los tiene) se dibujan los prismas de siempre.
  useEffect(() => {
    let cancelled = false;
    // Páginas a media resolución en pantallas chicas: la mitad de memoria
    // decodificada (una página completa son ~67 MB de RAM).
    const lowRes = window.matchMedia("(max-width: 767px)").matches;
    SpriteSet.load(lowRes)
      .then(async (sprites) => {
        if (cancelled) return;
        spritesRef.current = sprites;
        sprites.onLoad = () => setTick((value) => value + 1);
        setTick((value) => value + 1);
        await sprites.loadCivs(model.players.map((p) => p.civId));
        if (!cancelled) setTick((value) => value + 1);
      })
      .catch(() => {
        // Sin manifiesto (backend caído, red corta): prismas de siempre.
      });
    return () => {
      cancelled = true;
    };
  }, [model]);

  // Terreno con texturas reales: baja terrain.json + las imágenes de los ids
  // del mapa y bakea el canvas offscreen (texels px por tile; a media
  // resolución en pantallas chicas). Mientras baja (o si falla) queda la
  // paleta de siempre.
  useEffect(() => {
    const terrain = model.terrain;
    if (!terrain) return;
    let cancelled = false;
    const texels = window.matchMedia("(max-width: 767px)").matches ? 16 : 32;
    loadTerrainTextures(new Set(terrain.terrain))
      .then((set) => {
        if (cancelled || set.textures.size === 0) return;
        const baked = bakeTerrainCanvas(terrain, set, texels);
        if (baked) setTerrainTex({ canvas: baked, texels });
      })
      .catch(() => {
        // Sin texturas: paleta de siempre.
      });
    return () => {
      cancelled = true;
    };
  }, [model.terrain]);

  // Render.
  useEffect(() => {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (!canvas || !view || size.w === 0) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
      canvas.width = size.w * dpr;
      canvas.height = size.h * dpr;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = "#0a0d12";
    ctx.fillRect(0, 0, size.w, size.h);

    const { cx, cy, unit } = view;
    const N = mapSize;

    // Proyección isométrica 2:1 (la misma del juego).
    const px = (x: number, y: number) => cx + (x + y - N) * unit;
    const py = (x: number, y: number) => cy + (y - x) * unit * 0.5;

    // ── Sprites reales del juego ─────────────────────────────────────────
    // Sólo con suficiente zoom (a vista general los prismas rinden mejor y no
    // compiten con el terreno). k = px de pantalla por px de sprite: un tile
    // del arte mide 64.5 px de sprite (86 × 0.75) y 2·unit de pantalla.
    const sprites = spritesRef.current;
    const SPRITE_UNIT = 5;
    const spriteK = sprites ? (2 * unit) / sprites.tilePx : 0;
    // Terreno: canvas texturizado si ya bakeó; si no, la paleta de siempre.
    const ground = terrainTex ?? (terrainCanvas ? { canvas: terrainCanvas, texels: 1 } : null);
    const civByPlayer = new Map(model.players.map((p) => [p.id, p.civId]));
    const ageOf = (playerId: number) => {
      let age = 1;
      for (const up of model.ageUps ?? []) if (up.playerId === playerId && up.t <= time) age += 1;
      return age;
    };

    /**
     * Dibuja el edificio con el sprite real por civilización y edad (con los
     * anexos del TC y las máscaras de color teñidas). Devuelve false si no hay
     * sprite para este tipo (→ prisma), true si lo dibujó o su página de atlas
     * todavía está bajando (en ese caso no se dibuja NADA para no hacerlo
     * reventar: el re-dibujo llega con sprites.onLoad).
     */
    const drawBuildingSprite = (b: BuildingEvent): boolean => {
      if (!sprites || spriteK <= 0) return false;
      const civ = civByPlayer.get(b.playerId);
      if (civ == null) return false;
      const parts = sprites.building(civ, b.typeId, ageOf(b.playerId));
      if (!parts) return false;
      // Murallas: un key por forma según vecinos; v1 usa el tramo recto.
      const keyOf = (key: number | number[]) => (Array.isArray(key) ? key[0] : key);
      for (const part of parts) {
        if (part[0] != null && sprites.frame(keyOf(part[0])) == null) return true;
      }
      const color = colorOf(b.playerId);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 1;
      for (const [key, dx = 0, dy = 0, ox = 0, oy = 0] of parts) {
        if (key == null) continue;
        const frame = sprites.frame(keyOf(key));
        if (!frame) continue;
        // Los offsets de anexos (TC) están en tiles del juego y nuestras
        // coordenadas NO vienen rotadas (a diferencia del visor de referencia,
        // que gira todo el replay con (x,y)→(y,n−x) y por eso aplica
        // (dy,−dx)): acá entran directos.
        const sx = px(b.x + dx, b.y + dy);
        const sy = py(b.x + dx, b.y + dy);
        const x = sx + (ox - frame.ax) * spriteK;
        const y = sy + (oy - frame.ay) * spriteK;
        const w = frame.w * spriteK;
        const h = frame.h * spriteK;
        ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, x, y, w, h);
        if (frame.mask) {
          const tint = sprites.tint(frame, keyOf(key), color);
          if (tint) ctx.drawImage(tint, x, y, w, h);
        }
      }
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      return true;
    };


    // Rombo del mapa: con terreno real se dibuja el canvas offscreen completo
    // bajo una transform isométrica (screen = unit·(u+v) + offset en X,
    // 0.5·unit·(v-u) + offset en Y); sin terreno, el relleno plano de siempre.
    // Con texturas reales el offscreen lleva `texels` px por tile: la matriz
    // se divide por texels para que u,v vuelvan a quedar en tiles.
    if (ground) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const s = 1 / ground.texels;
      ctx.setTransform(
        dpr * unit * s,
        dpr * -0.5 * unit * s,
        dpr * unit * s,
        dpr * 0.5 * unit * s,
        dpr * (cx - N * unit),
        dpr * cy,
      );
      ctx.drawImage(ground.canvas, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
      ctx.beginPath();
      ctx.moveTo(px(0, 0), py(0, 0));
      ctx.lineTo(px(N, 0), py(N, 0));
      ctx.lineTo(px(N, N), py(N, N));
      ctx.lineTo(px(0, N), py(0, N));
      ctx.closePath();
      ctx.fillStyle = "#14261a";
      ctx.fill();
    }
    ctx.strokeStyle = "#2c5c37";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px(0, 0), py(0, 0));
    ctx.lineTo(px(N, 0), py(N, 0));
    ctx.lineTo(px(N, N), py(N, N));
    ctx.lineTo(px(0, N), py(0, N));
    ctx.closePath();
    ctx.stroke();

    // Grilla adaptativa: el paso se achica a medida que entra el zoom, para que
    // siempre haya una referencia de escala visible.
    const steps = [1, 3, 6, 12, 24, 48];
    const step = steps.find((candidate) => candidate * unit >= 28) ?? steps[steps.length - 1];
    ctx.strokeStyle = "rgba(120, 200, 140, 0.09)";
    ctx.lineWidth = 1;
    for (let i = step; i < N; i += step) {
      ctx.beginPath();
      ctx.moveTo(px(i, 0), py(i, 0));
      ctx.lineTo(px(i, N), py(i, N));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px(0, i), py(0, i));
      ctx.lineTo(px(N, i), py(N, i));
      ctx.stroke();
    }

    const colorOf = (playerId: number) =>
      playerColor(model.players.find((p) => p.id === playerId)?.colorId ?? 0);

    // Heatmap de "a dónde miró": densidad de la cámara del dueño acumulada
    // hasta el instante actual. Celdas de ~3 tiles, alpha por raíz del conteo
    // para que los picos no aplasten al resto.
    if (heatmap && model.viewlocks?.length) {
      const CELL = 3;
      const cols = Math.ceil(N / CELL);
      const counts = new Float32Array(cols * cols);
      let max = 0;
      for (const [t, x, y] of model.viewlocks) {
        if (t > time) break;
        const cx1 = Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)));
        const cy1 = Math.min(cols - 1, Math.max(0, Math.floor(y / CELL)));
        const index = cy1 * cols + cx1;
        counts[index] += 1;
        if (counts[index] > max) max = counts[index];
      }
      if (max > 0) {
        const half = CELL / 2;
        for (let cy1 = 0; cy1 < cols; cy1 += 1) {
          for (let cx1 = 0; cx1 < cols; cx1 += 1) {
            const count = counts[cy1 * cols + cx1];
            if (count === 0) continue;
            const tileX = cx1 * CELL + half;
            const tileY = cy1 * CELL + half;
            ctx.globalAlpha = 0.12 + 0.5 * Math.sqrt(count / max);
            ctx.fillStyle = "#7c3aed";
            ctx.beginPath();
            ctx.moveTo(px(tileX - half, tileY - half), py(tileX - half, tileY - half));
            ctx.lineTo(px(tileX + half, tileY - half), py(tileX + half, tileY - half));
            ctx.lineTo(px(tileX + half, tileY + half), py(tileX + half, tileY + half));
            ctx.lineTo(px(tileX - half, tileY + half), py(tileX - half, tileY + half));
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
    }

    // Movimientos: destino de cada orden. El rastro se apaga con el tiempo.
    const moveR = Math.max(1.5, unit * 0.3);
    for (const move of model.moves) {
      if (move.t > time) continue;
      const age = Math.min(1, (time - move.t) / 20000);
      ctx.globalAlpha = 0.1 + 0.5 * (1 - age);
      ctx.fillStyle = colorOf(move.playerId);
      ctx.beginPath();
      ctx.arc(px(move.x, move.y), py(move.x, move.y), moveR * (1.6 - 0.6 * age), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Marcadores de batallas/raids cercanos al instante: anillo que pulsa con
    // el segundo para que el salto desde el sidebar aterrice donde corresponde.
    for (const highlight of model.highlights ?? []) {
      if (highlight.x === undefined || highlight.y === undefined) continue;
      if (Math.abs(highlight.t - time) > 60_000) continue;
      const age = Math.abs(highlight.t - time) / 60_000;
      const ring = Math.max(6, unit * 1.2) * (0.7 + 0.3 * Math.sin(time / 700));
      ctx.globalAlpha = 0.85 - 0.5 * age;
      ctx.strokeStyle = highlight.kind === "raid" ? "#fb923c" : "#e4e4e7";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px(highlight.x, highlight.y), py(highlight.x, highlight.y), ring, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Edificios: ordenados por profundidad isométrica (de atrás hacia adelante).
    // Prisma según huella y altura del edificio + icono vectorial distintivo.
    // Los demolidos por su dueño desaparecen en el momento del borrado.
    const deleteAt = new Map<number, number>();
    const attackedAt = new Map<number, number>();
    const attackedPos = new Map<number, { x: number; y: number }>();
    for (const damage of model.buildingDamage ?? []) {
      if (damage.t > time) continue;
      if (damage.kind === "deleted" && !deleteAt.has(damage.objectId)) {
        deleteAt.set(damage.objectId, damage.t);
      }
      if (damage.kind === "attacked" && !attackedAt.has(damage.objectId)) {
        attackedAt.set(damage.objectId, damage.t);
        attackedPos.set(damage.objectId, { x: damage.x, y: damage.y });
      }
    }

    const visibleBuildings = allBuildings
      .filter((b) => b.t <= time && (b.objectId === 0 || time < (deleteAt.get(b.objectId) ?? Infinity)))
      .sort(
        (a, b) =>
          // Profundidad isométrica: la cámara mira desde el sur, así que la
          // distancia a la cámara es (y − x), NO (x + y) — eso era la
          // coordenada horizontal en pantalla y por eso las casas contiguas
          // se ocluían al revés. + tiles/2 centra el rango de la huella (igual
          // que el visor de referencia: bd.x + bd.y + bd.size/2 en coordenadas
          // rotadas ≡ (y − x) + size/2 en las del juego). A igual profundidad
          // gana el más alto (su techo ocluye al vecino bajo).
          b.x - a.x + (a.y - b.y) + getBuildingTiles(a.typeId) / 2 - getBuildingTiles(b.typeId) / 2 ||
          getBuildingInfo(a.typeId).liftFactor - getBuildingInfo(b.typeId).liftFactor,
      );

    // Prisma + icono vectorial (cae acá cuando no hay sprite real, o su página
    // de atlas todavía está bajando).
    const drawBuildingPrism = (b: BuildingEvent) => {
      if (drawBuildingSprite(b)) return;
      const color = colorOf(b.playerId);
      const info = getBuildingInfo(b.typeId);
      // El BUILD reporta el centro de la huella (verificado: las granjas 3×3
      // llegan con centro en .5, que alinea sus tiles en enteros). El rombo
      // ocupa side tiles de lado: ancho side*unit, alto side*unit/2.
      const side = getBuildingTiles(b.typeId);
      const x = px(b.x, b.y);
      const y = py(b.x, b.y);
      const fresh = time - b.t < 2500;

      // Huella y altura: radio horizontal = side * unit (un tile mide 2·unit
      // de ancho en la proyección isométrica: el diamante de side tiles es
      // side·2·unit de ancho y side·unit de alto).
      const fp = Math.max(2.5, side * unit);
      const isFarm = info.category === "farm";
      // Las granjas son terreno plano: sin levante vertical.
      const lift = isFarm ? 0 : Math.max(1, unit * info.liftFactor);
      const half = fp * 0.5;

      // Puntos del rombo de base.
      const top = { x, y: y - half };
      const right = { x: x + fp, y };
      const bottom = { x, y: y + half };
      const left = { x: x - fp, y };

      // Para granjas (terreno casi plano), no levantamos caras verticales altas
      if (info.category !== "farm") {
        // Cara izquierda.
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(bottom.x, bottom.y);
        ctx.lineTo(bottom.x, bottom.y - lift);
        ctx.lineTo(left.x, left.y - lift);
        ctx.closePath();
        ctx.fillStyle = shade(color, 0.45);
        ctx.fill();

        // Cara derecha.
        ctx.beginPath();
        ctx.moveTo(bottom.x, bottom.y);
        ctx.lineTo(right.x, right.y);
        ctx.lineTo(right.x, right.y - lift);
        ctx.lineTo(bottom.x, bottom.y - lift);
        ctx.closePath();
        ctx.fillStyle = shade(color, 0.28);
        ctx.fill();
      }

      // Techo / Superficie del edificio.
      ctx.beginPath();
      ctx.moveTo(top.x, top.y - lift);
      ctx.lineTo(right.x, right.y - lift);
      ctx.lineTo(bottom.x, bottom.y - lift);
      ctx.lineTo(left.x, left.y - lift);
      ctx.closePath();
      // Granja: con terreno texturizado el campo arado REAL ya está en el
      // mapa (el juego pinta terrain 7 bajo las granjas) — sólo borde del
      // color del jugador para leer el dueño. Con paleta, parcela marrón con
      // surcos, como siempre.
      if (isFarm) {
        if (ground) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = Math.max(1, unit / 16);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = time - b.t < 2500 ? "#8a6a3c" : "#9c7a3c";
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, unit / 16);
          ctx.stroke();
          ctx.strokeStyle = "rgba(60,40,20,0.35)";
          ctx.lineWidth = 1;
          for (let i = 1; i < 4; i++) {
            const k2 = i / 4;
            const a1 = { x: top.x + (left.x - top.x) * k2, y: top.y + (left.y - top.y) * k2 };
            const a2 = { x: right.x + (bottom.x - right.x) * k2, y: right.y + (bottom.y - right.y) * k2 };
            ctx.beginPath();
            ctx.moveTo(a1.x, a1.y);
            ctx.lineTo(a2.x, a2.y);
            ctx.stroke();
          }
        }
      } else {
        ctx.fillStyle = shade(color, 1.05);
        ctx.fill();
      }

      if (unit > 5 && !isFarm) {
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Glifo o icono vectorial representativo según el tipo de edificio
      // (no para granjas: la parcela ya se lee como granja).
      if (unit >= 4.5 && !isFarm) {
        const iconSize = Math.min(fp * 0.65, Math.max(4.5, unit * 0.7));
        drawBuildingIcon(ctx, info.category, x, y - lift, iconSize);
      }

      if (fresh) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = Math.max(1.5, unit * 0.1);
        ctx.beginPath();
        ctx.moveTo(top.x, top.y - lift);
        ctx.lineTo(right.x, right.y - lift);
        ctx.lineTo(bottom.x, bottom.y - lift);
        ctx.lineTo(left.x, left.y - lift);
        ctx.closePath();
        ctx.stroke();
      }
    };

    // Objetos gaia iniciales (oro, piedra, reliquias, bayas, árboles) sobre el
    // terreno. Se dibujan antes que edificios/unidades para que el painter's
    // algorithm los tape cuando corresponda. Marcadores vectoriales livianos
    // (sin sprites dedicados de recursos en el atlas actual).
    if (gaiaDraw.length) {
      const margin = 40;
      for (const g of gaiaDraw) {
        // A vista muy lejana los árboles individuales son ruido (el bosque ya
        // se ve por la textura de terreno); recursos/reliquias sí se mantienen.
        if (g.kind === "tree" && unit < 2.2) continue;
        const sx = px(g.x, g.y);
        const sy = py(g.x, g.y);
        if (sx < -margin || sx > size.w + margin || sy < -margin || sy > size.h + margin) continue;

        if (g.kind === "gold") {
          const r = Math.max(1.6, unit * 0.28);
          ctx.fillStyle = "#f2c230";
          ctx.strokeStyle = "rgba(80,50,10,0.55)";
          ctx.lineWidth = Math.max(0.75, unit * 0.05);
          ctx.beginPath();
          ctx.moveTo(sx, sy - r);
          ctx.lineTo(sx + r * 1.15, sy);
          ctx.lineTo(sx, sy + r * 0.7);
          ctx.lineTo(sx - r * 1.15, sy);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (g.kind === "stone") {
          const r = Math.max(1.5, unit * 0.26);
          ctx.fillStyle = "#9aa3ad";
          ctx.strokeStyle = "rgba(30,35,40,0.5)";
          ctx.lineWidth = Math.max(0.75, unit * 0.05);
          ctx.beginPath();
          ctx.moveTo(sx - r, sy + r * 0.3);
          ctx.lineTo(sx - r * 0.2, sy - r * 0.7);
          ctx.lineTo(sx + r * 0.9, sy - r * 0.1);
          ctx.lineTo(sx + r * 0.7, sy + r * 0.5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (g.kind === "relic") {
          const r = Math.max(2, unit * 0.32);
          ctx.strokeStyle = "#f7f3e8";
          ctx.fillStyle = "rgba(255,255,255,0.22)";
          ctx.lineWidth = Math.max(1, unit * 0.08);
          ctx.beginPath();
          ctx.arc(sx, sy - r * 0.1, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(sx, sy - r * 1.2);
          ctx.lineTo(sx, sy + r * 0.7);
          ctx.moveTo(sx - r * 0.55, sy - r * 0.45);
          ctx.lineTo(sx + r * 0.55, sy - r * 0.45);
          ctx.stroke();
        } else if (g.kind === "berry") {
          const r = Math.max(1.2, unit * 0.2);
          ctx.fillStyle = "#a3364a";
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255,180,190,0.5)";
          ctx.beginPath();
          ctx.arc(sx - r * 0.25, sy - r * 0.25, r * 0.35, 0, Math.PI * 2);
          ctx.fill();
        } else if (g.kind === "tree") {
          const r = Math.max(1.1, unit * 0.22);
          ctx.fillStyle = "rgba(34, 90, 38, 0.75)";
          ctx.beginPath();
          ctx.arc(sx, sy - r * 0.2, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Capas del pintor isométrico: edificios y unidades en una sola lista
    // ordenada por profundidad (y − x) — las unidades tienen que quedar
    // intercaladas entre los edificios, no encima de todo.
    type Layer = { d: number; draw: () => void };
    const layers: Layer[] = [];
    for (const b of visibleBuildings) {
      layers.push({
        d: b.y - b.x + getBuildingTiles(b.typeId) / 2 + getBuildingInfo(b.typeId).liftFactor * 1e-4,
        draw: () => drawBuildingPrism(b),
      });
    }

    // Unidades con ruta estimada. Sprites reales (aldeano o milicia según
    // hacia quién pega) con la misma mecánica que los edificios: si la página
    // del atlas todavía baja, punto del color y re-dibujo via onLoad. Con poco
    // zoom no se dibujan: a vista general son ruido.
    if (sprites && spriteK > 0 && unit >= SPRITE_UNIT) {
      const drawUnitAt = (u: UnitPath, snap: { x: number; y: number; moving: boolean; dx: number; dy: number }) => {
        const color = colorOf(u.playerId);
        const civ = civByPlayer.get(u.playerId);
        const anim = civ != null ? sprites.unit(civ, u.military ? 74 : 83) : null;
        if (anim) {
          // Dirección del sprite: pantalla dx ∝ Δx+Δy y dy ∝ (Δy−Δx)/2 (la
          // misma transformada que hace el visor de referencia sobre sus
          // coordenadas rotadas). 0 = mirando a la derecha, sentido horario.
          const count = anim.walk.length;
          const angle = Math.atan2((snap.dy - snap.dx) / 2, snap.dx + snap.dy);
          const idx = ((Math.round((angle / (2 * Math.PI)) * count) % count) + count) % count;
          const key = snap.moving ? anim.walk[idx]?.[animFrame(anim.walk[idx]?.length ?? 0, time, 340)] : anim.idle[idx];
          const frame = key != null ? sprites.frame(key) : null;
          if (frame) {
            const sx = px(snap.x, snap.y);
            const sy = py(snap.x, snap.y);
            const x = sx - frame.ax * spriteK;
            const y = sy - frame.ay * spriteK;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, x, y, frame.w * spriteK, frame.h * spriteK);
            if (frame.mask) {
              const tint = sprites.tint(frame, key, color);
              if (tint) ctx.drawImage(tint, x, y, frame.w * spriteK, frame.h * spriteK);
            }
            ctx.imageSmoothingEnabled = false;
            return;
          }
        }
        // Fallback: punto del color del jugador (civ sin arte o atlas en vuelo).
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px(snap.x, snap.y), py(snap.x, snap.y), Math.max(2, unit * 0.22), 0, Math.PI * 2);
        ctx.fill();
      };

      const margin = 80;
      for (const u of unitPaths.values()) {
        const snap = unitSnapshotAt(u, time);
        if (!snap) continue;
        const sx = px(snap.x, snap.y);
        const sy = py(snap.x, snap.y);
        if (sx < -margin || sx > size.w + margin || sy < -margin || sy > size.h + margin) continue;
        layers.push({ d: snap.y - snap.x, draw: () => drawUnitAt(u, snap) });
      }
    }

    layers.sort((a, b) => a.d - b.d);
    for (const layer of layers) layer.draw();

    // Escombros: edificios demolidos por su dueño. El prisma desaparece y
    // queda una marca gris con una cruz, tamaño según la huella original.
    for (const [objectId, deleteT] of deleteAt) {
      const damage = (model.buildingDamage ?? []).find((d) => d.objectId === objectId && d.kind === "deleted");
      if (!damage || deleteT > time) continue;
      const info = getBuildingInfo(damage.typeId);
      const side = getBuildingTiles(damage.typeId);
      const fp = Math.max(2.5, side * unit);
      const x = px(damage.x, damage.y);
      const y = py(damage.x, damage.y);
      const age = Math.min(1, (time - deleteT) / 20000);
      ctx.globalAlpha = 0.25 + 0.25 * (1 - age);
      ctx.fillStyle = "#3f3f46";
      ctx.beginPath();
      ctx.ellipse(x, y, fp * 0.7, fp * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.5 + 0.3 * (1 - age);
      ctx.strokeStyle = "#a1a1aa";
      ctx.lineWidth = Math.max(1.5, unit * 0.08);
      const arm = fp * 0.3;
      ctx.beginPath();
      ctx.moveTo(x - arm, y - arm);
      ctx.lineTo(x + arm, y + arm);
      ctx.moveTo(x + arm, y - arm);
      ctx.lineTo(x - arm, y + arm);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Fuego: edificios enemigos que están recibiendo ataques. Llama que
    // titila sobre el edificio y un halo naranja para verlo de lejos.
    for (const [objectId] of attackedAt) {
      const pos = attackedPos.get(objectId);
      if (!pos) continue;
      const info = getBuildingInfo((model.buildingDamage ?? []).find((d) => d.objectId === objectId)?.typeId ?? 0);
      const side = getBuildingTiles((model.buildingDamage ?? []).find((d) => d.objectId === objectId)?.typeId ?? 0);
      const fp = Math.max(3, side * unit);
      const x = px(pos.x, pos.y);
      const y = py(pos.x, pos.y);
      const flicker = 0.75 + 0.25 * Math.sin(time / 90 + objectId);
      ctx.globalAlpha = 0.25 * flicker;
      const halo = fp * (1.4 + 0.15 * Math.sin(time / 300));
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.arc(x, y, halo, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.95;
      // Llama: dos lenguas superpuestas, la interna más clara.
      for (const [scale, color] of [[1, "#f97316"], [0.55, "#fbbf24"]] as const) {
        const h = fp * 1.6 * scale * flicker;
        const w = fp * 0.7 * scale;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y - h);
        ctx.quadraticCurveTo(x + w, y - h * 0.45, x, y);
        ctx.quadraticCurveTo(x - w, y - h * 0.45, x, y - h);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Presupuesto de memoria de atlas: libera páginas que hace rato no se
    // dibujan (LRU) cuando el total decodificado pasa el tope.
    sprites?.endFrame();
  }, [model, time, size, mapSize, zoomPct, tick, heatmap, terrainCanvas, allBuildings, unitPaths, terrainTex, gaiaDraw]);

  // Pinch-zoom táctil: 2 dedos escalan alrededor de su punto medio (además
  // siguen pan-eando con el desplazamiento del medio). Mismo encuadre que el
  // zoom de rueda: el punto bajo los dedos no se mueve.
  const applyPinch = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const view = viewRef.current;
      const a = [...pointers.current.values()];
      if (!view || a.length < 2 || size.w === 0) return;
      const dist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      const mx = (a[0].x + a[1].x) / 2;
      const my = (a[0].y + a[1].y) / 2;
      const rect = canvas.getBoundingClientRect();
      const px = mx - rect.left;
      const py = my - rect.top;
      const prev = pinch.current;
      if (prev && prev.dist > 0 && dist > 0) {
        // Zoom alrededor del punto medio previo y pan con el movimiento del medio.
        const factor = dist / prev.dist;
        const nextUnit = clampUnit(view.unit * factor, size);
        const ratio = nextUnit / view.unit;
        viewRef.current = {
          cx: px - (px - view.cx) * ratio + (mx - prev.mx),
          cy: py - (py - view.cy) * ratio + (my - prev.my),
          unit: nextUnit,
        };
        setZoomPct(Math.round((nextUnit / fitUnit(size, mapSize)) * 100));
        setTick((t) => t + 1);
      }
      pinch.current = { dist, mx, my };
      event.preventDefault();
    },
    [size, mapSize, clampUnit],
  );

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(event) => {
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          dragging.current = { x: event.clientX, y: event.clientY };
          if (pointers.current.size >= 2) {
            dragging.current = null; // con 2 dedos el pan lo maneja el pinch
            applyPinch(event);
          }
          // Si el usuario agarra el mapa, deja de seguir la cámara del dueño.
          setFollow(false);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const canvas = event.currentTarget;
          const rect = canvas.getBoundingClientRect();
          const view = viewRef.current;
          if (!view) return;

          if (pointers.current.has(event.pointerId)) {
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          }
          if (pointers.current.size >= 2) {
            applyPinch(event);
            return;
          }

          // Coordenada de tile bajo el cursor (proyección inversa).
          const mx = event.clientX - rect.left;
          const my = event.clientY - rect.top;
          const u = (mx - view.cx) / view.unit;
          const v = (my - view.cy) / (view.unit * 0.5);
          // Inversa de px = (x+y-N)·unit, py = (y-x)·unit/2.
          const tx = (u - v + mapSize) / 2;
          const ty = (u + v + mapSize) / 2;
          const inside = tx >= 0 && ty >= 0 && tx <= mapSize && ty <= mapSize;
          setHover(inside ? { x: Math.floor(tx), y: Math.floor(ty) } : null);

          const start = dragging.current;
          if (!start) return;
          view.cx += event.clientX - start.x;
          view.cy += event.clientY - start.y;
          dragging.current = { x: event.clientX, y: event.clientY };
          setTick((t) => t + 1);
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          dragging.current = null;
          const view = viewRef.current;
          if (view && size.w > 0) syncUrl(view, size);
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          dragging.current = null;
        }}
        onDoubleClick={reset}
      />

      <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 font-mono text-xs text-zinc-300">
        {zoomPct}%
      </div>

      {hover ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-zinc-400">
          tile {hover.x}, {hover.y}
          {(() => {
            // Edificio bajo el cursor: por ocupación real de tiles (el BUILD
            // reporta la esquina; el edificio cubre side×side desde ahí).
            const hitBuilding = allBuildings.find(
              (b) =>
                b.t <= time &&
                // Centro de huella: ventana side×side centrada en b.x,b.y.
                Math.abs(hover.x - b.x) <= getBuildingTiles(b.typeId) / 2 &&
                Math.abs(hover.y - b.y) <= getBuildingTiles(b.typeId) / 2,
            );
            if (hitBuilding) {
              const bInfo = getBuildingInfo(hitBuilding.typeId);
              const player = model.players.find((p) => p.id === hitBuilding.playerId);
              return ` · ${bInfo.name} (${player?.name ?? `Jugador ${hitBuilding.playerId}`})`;
            }
            const t = model.terrain;
            if (!t) return null;
            const id = t.terrain[hover.y * t.dimension + hover.x];
            return id === undefined ? null : ` · ${TERRAIN_NAMES[id] ?? `terreno ${id}`}`;
          })()}
        </div>
      ) : null}

      <div className="absolute bottom-3 right-3 flex gap-2">
        {model.viewlocks && model.viewlocks.length > 0 ? (
          <button
            type="button"
            onClick={() => setHeatmap((value) => !value)}
            aria-pressed={heatmap}
            className={[
              "rounded-md border px-2.5 py-1 text-xs transition",
              heatmap
                ? "border-violet-400/50 bg-violet-500/20 text-violet-200 hover:bg-violet-500/30"
                : "border-white/10 bg-black/60 text-zinc-300 hover:bg-white/10",
            ].join(" ")}
          >
            {heatmap ? "Heatmap activo" : "Heatmap de mirada"}
          </button>
        ) : null}
        {model.viewlocks && model.viewlocks.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              const next = !follow;
              setFollow(next);
              if (next) {
                // Al activarlo, saltamos ya a la cámara de este instante.
                const target = viewAt(model.viewlocks, time);
                const view = viewRef.current;
                if (target && view && size.w > 0) {
                  viewRef.current = viewForTile(target, view.unit, size, mapSize);
                  setTick((value) => value + 1);
                  syncUrl(viewRef.current, size);
                }
              }
            }}
            aria-pressed={follow}
            className={[
              "rounded-md border px-2.5 py-1 text-xs transition",
              follow
                ? "border-violet-400/50 bg-violet-500/20 text-violet-200 hover:bg-violet-500/30"
                : "border-white/10 bg-black/60 text-zinc-300 hover:bg-white/10",
            ].join(" ")}
          >
            {follow ? "Siguiendo al dueño" : "Seguir al dueño"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={share}
          className="rounded-md border border-white/10 bg-black/60 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/10"
        >
          {copied ? "Link copiado" : "Copiar link"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-white/10 bg-black/60 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/10"
        >
          Reset (doble click)
        </button>
      </div>
    </div>
  );
}
