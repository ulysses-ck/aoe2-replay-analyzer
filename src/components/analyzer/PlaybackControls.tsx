"use client";

import { formatTime } from "@/lib/types";
import { SKIP_MS, SPEEDS } from "./hooks/usePlayback";
import { buttonClass, focusRing } from "./ui/button-styles";
import { PauseGlyph, PlayGlyph, RestartGlyph, SkipBackGlyph, SkipForwardGlyph } from "./ui/Glyphs";

type Props = {
  playing: boolean;
  speed: number;
  time: number;
  durationMs: number;
  /** Dato secundario (tiempo de parseo, tamaño), se oculta en pantallas angostas. */
  footnote?: string;
  onTogglePlay: () => void;
  onRestart: () => void;
  onSkip: (deltaMs: number) => void;
  onSpeedChange: (speed: number) => void;
};

export function PlaybackControls({
  playing,
  speed,
  time,
  durationMs,
  footnote,
  onTogglePlay,
  onRestart,
  onSkip,
  onSpeedChange,
}: Props) {
  const seconds = SKIP_MS / 1000;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onRestart}
          aria-label="Volver al inicio"
          title="Volver al inicio (Inicio)"
          className={buttonClass("ghost", "icon")}
        >
          <RestartGlyph />
        </button>
        <button
          type="button"
          onClick={() => onSkip(-SKIP_MS)}
          aria-label={`Retroceder ${seconds} segundos`}
          title={`Retroceder ${seconds} s (←)`}
          className={buttonClass("ghost", "icon")}
        >
          <SkipBackGlyph />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? "Pausar" : "Reproducir"}
          title={playing ? "Pausar (Espacio)" : "Reproducir (Espacio)"}
          className={buttonClass("primary", "iconLg")}
        >
          {playing ? <PauseGlyph size={18} /> : <PlayGlyph size={18} />}
        </button>
        <button
          type="button"
          onClick={() => onSkip(SKIP_MS)}
          aria-label={`Adelantar ${seconds} segundos`}
          title={`Adelantar ${seconds} s (→)`}
          className={buttonClass("ghost", "icon")}
        >
          <SkipForwardGlyph />
        </button>
      </div>

      <p className="font-mono text-sm tabular-nums text-zinc-100">
        {formatTime(time)} <span className="text-zinc-500">/ {formatTime(durationMs)}</span>
      </p>

      <div className="ml-auto flex items-center gap-4">
        {footnote ? <span className="hidden text-[11px] text-zinc-600 lg:inline">{footnote}</span> : null}
        <div role="group" aria-label="Velocidad de reproducción" className="flex rounded-md border border-white/10 p-0.5">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === speed}
              onClick={() => onSpeedChange(value)}
              className={`h-7 min-w-9 rounded px-2 font-mono text-[11px] tabular-nums transition-colors ${focusRing} ${
                value === speed ? "bg-white/15 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              }`}
            >
              {value}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}