"use client";

import { useCallback, useState } from "react";

import type { ReplayModel } from "@/lib/types";
import MapCanvas from "../MapCanvas";
import { usePlayback, usePlaybackShortcuts } from "./hooks/usePlayback";
import { usePlayerLookup } from "./hooks/usePlayerLookup";
import { MatchHeader } from "./MatchHeader";
import { PlaybackControls } from "./PlaybackControls";
import { Sidebar } from "./Sidebar";
import { Timeline } from "./Timeline";
import type { Focus, Highlight, Seek } from "./types";
import { Notice } from "./ui/Notice";

const NO_HIGHLIGHTS: Highlight[] = [];

type Props = {
  model: ReplayModel;
  fromCache: boolean;
  initialTimeMs: number;
  onPickFile: () => void;
};

/** Vista con un replay cargado. Dueña del estado de reproducción y del foco del mapa. */
export function ReplayView({ model, fromCache, initialTimeMs, onPickFile }: Props) {
  const { meta } = model;
  const lookup = usePlayerLookup(model.players);
  const { time, playing, speed, setSpeed, togglePlay, seek, skip } = usePlayback(meta.durationMs, initialTimeMs);
  const [focus, setFocus] = useState<Focus | null>(null);
  /** Drawer de la sidebar en mobile; en ≥md siempre visible. */
  const [sidebarOpen, setSidebarOpen] = useState(false);

  usePlaybackShortcuts({ togglePlay, skip, seek });

  /** Todo salto desde la UI (lista, marca, chat, barra) pausa; con `point` también centra el mapa. */
  const seekTo = useCallback<Seek>(
    (timeMs, point) => {
      seek(timeMs, { pause: true });
      if (point) setFocus({ ...point, nonce: Date.now() });
      // Un salto desde la sidebar en mobile deja la vista limpia.
      setSidebarOpen(false);
    },
    [seek],
  );
  const restart = useCallback(() => seekTo(0), [seekTo]);

  const footnote = [
    meta.parseMs ? `procesado en ${meta.parseMs} ms` : null,
    meta.bytes ? `${(meta.bytes / 1048576).toFixed(1)} MB` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MatchHeader meta={meta} onPickFile={onPickFile} onToggleSidebar={() => setSidebarOpen((v) => !v)} />

      {fromCache ? (
        <Notice tone="warning" layout="bar" title="Estás viendo una copia local">
          El servidor no responde (¿PC apagada?). Es lo último que guardó este navegador de este replay.
        </Notice>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        <Sidebar model={model} time={time} lookup={lookup} onSeek={seekTo} open={sidebarOpen} />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <MapCanvas model={model} time={time} replayId={meta.id} focus={focus} />
          </div>

          <footer className="border-t border-white/10 bg-white/[0.02] px-4 pb-3 pt-2">
            <Timeline
              durationMs={meta.durationMs}
              time={time}
              highlights={model.highlights ?? NO_HIGHLIGHTS}
              nameOf={lookup.nameOf}
              onSeek={seekTo}
            />
            <PlaybackControls
              playing={playing}
              speed={speed}
              time={time}
              durationMs={meta.durationMs}
              footnote={footnote}
              onTogglePlay={togglePlay}
              onRestart={restart}
              onSkip={skip}
              onSpeedChange={setSpeed}
            />
          </footer>
        </main>
      </div>
    </div>
  );
}