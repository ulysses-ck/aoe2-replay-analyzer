import type { ReactNode } from "react";

import { formatTime } from "@/lib/types";
import { focusRing } from "../ui/button-styles";

type Props = {
  timeMs: number;
  icon: ReactNode;
  iconClassName: string;
  title: string;
  detail: string;
  onSelect: () => void;
};

/** Fila clickeable "hora · icono · título · detalle". La usan highlights y edificios en riesgo. */
export function EventRow({ timeMs, icon, iconClassName, title, detail, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${formatTime(timeMs)} · ${title} · ${detail}`}
      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/5 ${focusRing}`}
    >
      <span className="w-12 shrink-0 font-mono text-[10px] tabular-nums text-zinc-500 group-hover:text-zinc-300">
        {formatTime(timeMs)}
      </span>
      <span aria-hidden className={`shrink-0 ${iconClassName}`}>
        {icon}
      </span>
      <span className="min-w-0 truncate text-zinc-200">
        {title}
        <span className="text-zinc-500"> · {detail}</span>
      </span>
    </button>
  );
}