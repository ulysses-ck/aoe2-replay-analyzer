"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { playerColor, type ReplayModel } from "@/lib/types";
import { getBuildingInfo, drawBuildingIcon, inferStartingTownCenters } from "@/lib/buildings";

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
  const appliedInitial = useRef(false);
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [zoomPct, setZoomPct] = useState(100);
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [follow, setFollow] = useState(false);
  const [heatmap, setHeatmap] = useState(false);

  const mapSize = model.meta.mapSize || 200;
  const terrainCanvas = useMemo(() => (model.terrain ? buildTerrainCanvas(model.terrain) : null), [model.terrain]);
  const allBuildings = useMemo(() => {
    const inferred = inferStartingTownCenters(model);
    if (inferred.length === 0) return model.buildings;
    return [...inferred, ...model.buildings];
  }, [model]);

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
  useEffect(() => {
    if (!focus || size.w === 0) return;
    const view = viewRef.current;
    if (!view) return;
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

    // Rombo del mapa: con terreno real se dibuja el canvas offscreen completo
    // bajo una transform isométrica (screen = unit·(u+v) + offset en X,
    // 0.5·unit·(v-u) + offset en Y); sin terreno, el relleno plano de siempre.
    if (terrainCanvas) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.setTransform(
        dpr * unit,
        dpr * -0.5 * unit,
        dpr * unit,
        dpr * 0.5 * unit,
        dpr * (cx - N * unit),
        dpr * cy,
      );
      ctx.drawImage(terrainCanvas, 0, 0);
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
      .sort((a, b) => a.x + a.y - (b.x + b.y));

    for (const b of visibleBuildings) {
      const color = colorOf(b.playerId);
      const info = getBuildingInfo(b.typeId);
      const x = px(b.x, b.y);
      const y = py(b.x, b.y);
      const fresh = time - b.t < 2500;

      // Huella y altura específicas del tipo de edificio
      const fp = Math.max(2.5, unit * info.footprint);
      const lift = Math.max(1, unit * info.liftFactor);
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
      ctx.fillStyle = info.category === "farm" ? shade(color, 0.75) : shade(color, 1.05);
      ctx.fill();

      if (unit > 5) {
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Glifo o icono vectorial representativo según el tipo de edificio
      if (unit >= 4.5) {
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
    }

    // Escombros: edificios demolidos por su dueño. El prisma desaparece y
    // queda una marca gris con una cruz, tamaño según la huella original.
    for (const [objectId, deleteT] of deleteAt) {
      const damage = (model.buildingDamage ?? []).find((d) => d.objectId === objectId && d.kind === "deleted");
      if (!damage || deleteT > time) continue;
      const info = getBuildingInfo(damage.typeId);
      const fp = Math.max(2.5, unit * info.footprint * 0.7);
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
      const fp = Math.max(3, unit * Math.max(info.footprint, 0.9) * 0.6);
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
  }, [model, time, size, mapSize, zoomPct, tick, heatmap, terrainCanvas, allBuildings]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(event) => {
          dragging.current = { x: event.clientX, y: event.clientY };
          // Si el usuario agarra el mapa, deja de seguir la cámara del dueño.
          setFollow(false);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const canvas = event.currentTarget;
          const rect = canvas.getBoundingClientRect();
          const view = viewRef.current;
          if (!view) return;

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
        onPointerUp={() => {
          dragging.current = null;
          const view = viewRef.current;
          if (view && size.w > 0) syncUrl(view, size);
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
            // Edificio más cercano al tile sobre el que se pasa el cursor
            const hitBuilding = allBuildings.find(
              (b) =>
                b.t <= time &&
                Math.hypot(b.x - hover.x, b.y - hover.y) <= Math.max(1.2, getBuildingInfo(b.typeId).footprint),
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
