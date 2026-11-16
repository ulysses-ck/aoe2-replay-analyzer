import type { ComponentType } from "react";

import { ApmIcon, BattleIcon, RaidIcon } from "../icons";
import type { Highlight, NameOf, Point } from "./types";

export type HighlightKind = Highlight["kind"];

type Meta = {
  label: string;
  /** Color del texto/icono. */
  text: string;
  /** Color de la marca en la línea de tiempo. */
  bar: string;
  Icon: ComponentType<{ size: number }>;
};

/** Única fuente de verdad para etiqueta, color e icono de cada tipo de highlight. */
export const HIGHLIGHT_META: Record<HighlightKind, Meta> = {
  raid: { label: "Raid", text: "text-orange-400", bar: "bg-orange-400", Icon: RaidIcon },
  battle: { label: "Batalla", text: "text-zinc-300", bar: "bg-zinc-300", Icon: BattleIcon },
  apm: { label: "Pico de APM", text: "text-violet-400", bar: "bg-violet-400", Icon: ApmIcon },
};

export function highlightDetail(highlight: Highlight, nameOf: NameOf): string {
  return highlight.kind === "apm"
    ? `${highlight.apm}/min`
    : highlight.players.map((id) => nameOf(id)).join(" vs ");
}

export function highlightPoint(highlight: Highlight): Point | undefined {
  return highlight.x !== undefined && highlight.y !== undefined
    ? { x: highlight.x, y: highlight.y }
    : undefined;
}