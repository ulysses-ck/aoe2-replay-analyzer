"use client";

import { memo } from "react";

import type { ReplayModel } from "@/lib/types";
import { BuildOrder, PhaseBreakdown } from "../PhasesPanel";
import { ChatPanel } from "./panels/ChatPanel";
import { DamagePanel } from "./panels/DamagePanel";
import { PlayersPanel } from "./panels/PlayersPanel";
import type { BuildingDamage, ColorOf, Highlight, NameOf, Seek } from "./types";
import { HighlightsPanel } from "./panels/HighlightsPanel";

// Referencias estables para que `memo` evite re-renderizar mientras corre el reloj.
const NO_HIGHLIGHTS: Highlight[] = [];
const NO_DAMAGE: BuildingDamage[] = [];

/** No dependen del tiempo: se aíslan para no repintarse 60 veces por segundo. */
const StaticPhasePanels = memo(function StaticPhasePanels({ model }: { model: ReplayModel }) {
  return (
    <>
      <PhaseBreakdown model={model} />
      <BuildOrder model={model} />
    </>
  );
});

type Props = {
  model: ReplayModel;
  time: number;
  lookup: { nameOf: NameOf; colorOf: ColorOf };
  onSeek: Seek;
  /** Drawer abierto en mobile; en ≥md siempre visible y este valor no afecta. */
  open: boolean;
};

export function Sidebar({ model, time, lookup, onSeek, open }: Props) {
  return (
    <aside
      aria-label="Detalle de la partida"
      className={[
        "absolute inset-y-0 left-0 z-30 w-72 shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-[#0a0d12]/95 backdrop-blur-sm",
        open ? "flex" : "hidden",
        "md:static md:z-auto md:flex md:bg-white/[0.015] md:backdrop-blur-none",
      ].join(" ")}
    >
      <PlayersPanel players={model.players} buildings={model.buildings} moves={model.moves} time={time} />
      <HighlightsPanel highlights={model.highlights ?? NO_HIGHLIGHTS} nameOf={lookup.nameOf} onSeek={onSeek} />
      <StaticPhasePanels model={model} />
      <DamagePanel damage={model.buildingDamage ?? NO_DAMAGE} nameOf={lookup.nameOf} onSeek={onSeek} />
      <ChatPanel chat={model.chat} nameOf={lookup.nameOf} colorOf={lookup.colorOf} onSeek={onSeek} />
    </aside>
  );
}