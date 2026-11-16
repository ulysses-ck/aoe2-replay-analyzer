import Link from "next/link";

import { formatTime, type ReplayModel } from "@/lib/types";
import { buttonClass } from "./ui/button-styles";
import { MenuIcon } from "../icons";
import { UploadGlyph } from "./ui/Glyphs";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex gap-1.5">
      <dt>{label}</dt>
      <dd className="font-mono text-zinc-300">{value}</dd>
    </div>
  );
}

type Props = { meta: ReplayModel["meta"]; onPickFile: () => void; onToggleSidebar: () => void };

export function MatchHeader({ meta, onPickFile, onToggleSidebar }: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-white/10 px-3 py-2.5 md:px-4">
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          aria-label="Mostrar paneles"
          onClick={onToggleSidebar}
          className="mt-0.5 shrink-0 rounded-md border border-white/15 p-1 text-zinc-300 transition hover:bg-white/10 md:hidden"
        >
          <MenuIcon size={16} />
        </button>
        <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-sm font-semibold tracking-tight text-zinc-100" title={meta.fileName}>
            {meta.fileName}
          </h1>
          {meta.engine === "agelens" ? (
            <span
              title="Este replay se procesó con el parser alternativo."
              className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300"
            >
              Parser alternativo
            </span>
          ) : null}
        </div>
        <dl className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-zinc-500">
          <Stat label="Duración" value={formatTime(meta.durationMs)} />
          <Stat label="Mapa" value={`${meta.mapSize}×${meta.mapSize}`} />
          <Stat label="Jugadores" value={meta.playerCount} />
          {meta.build > 0 ? <Stat label="Build" value={meta.build} /> : null}
        </dl>
        </div>
      </div>

      <nav aria-label="Acciones" className="flex items-center gap-2">
        <button type="button" onClick={onPickFile} className={buttonClass("secondary", "sm")}>
          <UploadGlyph size={14} />
          Abrir otro replay
        </button>
        <Link href="/replays" className={buttonClass("ghost", "sm")}>
          Mis replays
        </Link>
      </nav>
    </header>
  );
}