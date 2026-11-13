"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { playerColor, type ReplayModel } from "@/lib/types";

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

/** Tile que queda en el centro del canvas para un view dado. */
function centerTile(view: View, size: Size, mapSize: number): { x: number; y: number } {
  const u = (size.w / 2 - view.cx) / view.unit;
  const v = (size.h / 2 - view.cy) / (view.unit * 0.5);
  return { x: (u + v + mapSize) / 2, y: (u - v + mapSize) / 2 };
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
  const x = Number(params.get("x"));
  const y = Number(params.get("y"));
  const z = Number(params.get("z"));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
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

export default function MapCanvas({
  model,
  time,
  replayId,
}: {
  model: ReplayModel;
  time: number;
  /** Id del replay en el cache: viaja en el deep link para poder reabrirlo. */
  replayId?: string;
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

  const mapSize = model.meta.mapSize || 200;

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

    // Rombo del mapa.
    ctx.beginPath();
    ctx.moveTo(px(0, 0), py(0, 0));
    ctx.lineTo(px(N, 0), py(N, 0));
    ctx.lineTo(px(N, N), py(N, N));
    ctx.lineTo(px(0, N), py(0, N));
    ctx.closePath();
    ctx.fillStyle = "#14261a";
    ctx.fill();
    ctx.strokeStyle = "#2c5c37";
    ctx.lineWidth = 1.5;
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

    // Edificios: prisma isométrico con techo y dos caras sombreadas.
    const fp = Math.max(2.5, unit * 0.95); // semiancho del rombo de base
    const lift = Math.max(3, unit * 1.25); // altura del volumen
    for (const b of model.buildings) {
      if (b.t > time) continue;
      const color = colorOf(b.playerId);
      const x = px(b.x, b.y);
      const y = py(b.x, b.y);
      const fresh = time - b.t < 2500;
      const half = fp * 0.5;

      // Puntos del rombo de base.
      const top = { x, y: y - half };
      const right = { x: x + fp, y };
      const bottom = { x, y: y + half };
      const left = { x: x - fp, y };

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

      // Techo.
      ctx.beginPath();
      ctx.moveTo(top.x, top.y - lift);
      ctx.lineTo(right.x, right.y - lift);
      ctx.lineTo(bottom.x, bottom.y - lift);
      ctx.lineTo(left.x, left.y - lift);
      ctx.closePath();
      ctx.fillStyle = shade(color, 1.05);
      ctx.fill();

      if (unit > 6) {
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
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
  }, [model, time, size, mapSize, zoomPct, tick]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(event) => {
          dragging.current = { x: event.clientX, y: event.clientY };
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
          const tx = (u + v + mapSize) / 2;
          const ty = (u - v + mapSize) / 2;
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
        </div>
      ) : null}

      <div className="absolute bottom-3 right-3 flex gap-2">
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
