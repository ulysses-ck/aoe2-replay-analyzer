"use client";

import { useState, type PointerEvent } from "react";

import { formatTime } from "@/lib/types";
import { HIGHLIGHT_META, highlightDetail, highlightPoint } from "./highlight-meta";
import type { Highlight, NameOf, Seek } from "./types";

type Props = {
  durationMs: number;
  time: number;
  highlights: Highlight[];
  nameOf: NameOf;
  onSeek: Seek;
};

/** Barra de progreso con marcas de highlights y vista previa de la hora al pasar el mouse. */
export function Timeline({ durationMs, time, highlights, nameOf, onSeek }: Props) {
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const progress = durationMs > 0 ? Math.min(1, time / durationMs) : 0;

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverMs(fraction * durationMs);
  };

  return (
    <div>
      {highlights.length > 0 && durationMs > 0 ? (
        <div className="relative h-4">
          {highlights.map((highlight, index) => {
            const meta = HIGHLIGHT_META[highlight.kind];
            const detail = highlightDetail(highlight, nameOf);
            return (
              <button
                key={`${highlight.kind}-${highlight.t}-${index}`}
                type="button"
                aria-label={`${meta.label} a las ${formatTime(highlight.t)}`}
                title={`${formatTime(highlight.t)} · ${meta.label} · ${detail}`}
                onClick={() => onSeek(highlight.t, highlightPoint(highlight))}
                className="group absolute top-0 h-4 w-3 -translate-x-1/2 cursor-pointer focus-visible:outline-none"
                style={{ left: `${(Math.min(highlight.t, durationMs) / durationMs) * 100}%` }}
              >
                <span
                  className={`mx-auto block h-full w-[3px] rounded-full opacity-70 transition group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-visible:ring-2 group-focus-visible:ring-violet-300 ${meta.bar}`}
                />
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="group relative h-5" onPointerMove={onPointerMove} onPointerLeave={() => setHoverMs(null)}>
        {/* El <input> real queda encima (invisible) para conservar teclado, foco y lectores de pantalla. */}
        <input
          type="range"
          min={0}
          max={durationMs}
          step={100}
          value={time}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="Posición de la partida"
          aria-valuetext={`${formatTime(time)} de ${formatTime(durationMs)}`}
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/10 transition-[height] group-hover:h-2">
          <div className="h-full rounded-full bg-violet-500" style={{ width: `${progress * 100}%` }} />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow shadow-black/50 peer-focus-visible:ring-2 peer-focus-visible:ring-violet-300 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#0a0d12]"
          style={{ left: `${progress * 100}%` }}
        />
        {hoverMs !== null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-full z-20 mb-1 -translate-x-1/2 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-100 shadow"
            style={{ left: `${(hoverMs / durationMs) * 100}%` }}
          >
            {formatTime(hoverMs)}
          </div>
        ) : null}
      </div>
    </div>
  );
}