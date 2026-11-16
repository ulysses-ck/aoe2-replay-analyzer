"use client";

import { memo, useMemo, useState } from "react";

import { HIGHLIGHT_META, highlightDetail, highlightPoint, type HighlightKind } from "../highlight-meta";
import type { Highlight, NameOf, Seek } from "../types";
import { focusRing } from "../ui/button-styles";
import { EventRow } from "./EventRow";
import { EmptyNote, Panel } from "./Panel";

const KINDS = Object.keys(HIGHLIGHT_META) as HighlightKind[];

type Props = { highlights: Highlight[]; nameOf: NameOf; onSeek: Seek };

export const HighlightsPanel = memo(function HighlightsPanel({ highlights, nameOf, onSeek }: Props) {
  const [hidden, setHidden] = useState<ReadonlySet<HighlightKind>>(new Set());

  const counts = useMemo(() => {
    const result: Record<HighlightKind, number> = { raid: 0, battle: 0, apm: 0 };
    for (const highlight of highlights) result[highlight.kind] += 1;
    return result;
  }, [highlights]);

  const toggle = (kind: HighlightKind) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });

  const visible = highlights.filter((highlight) => !hidden.has(highlight.kind));

  return (
    <Panel title="Highlights" count={highlights.length}>
      {highlights.length === 0 ? (
        <EmptyNote>No se detectaron combates en esta partida.</EmptyNote>
      ) : (
        <>
          {/* La leyenda es también el filtro. */}
          <div role="group" aria-label="Filtrar por tipo" className="mb-2 flex flex-wrap gap-1.5">
            {KINDS.map((kind) => {
              const meta = HIGHLIGHT_META[kind];
              const on = !hidden.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(kind)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${focusRing} ${
                    on
                      ? `border-white/15 bg-white/5 ${meta.text}`
                      : "border-transparent text-zinc-600 line-through hover:text-zinc-400"
                  }`}
                >
                  <meta.Icon size={10} />
                  {meta.label}
                  <span className="font-mono tabular-nums opacity-70">{counts[kind]}</span>
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <EmptyNote>Activá algún tipo para ver eventos.</EmptyNote>
          ) : (
            <ul className="-mx-1 max-h-56 overflow-y-auto pr-1">
              {visible.map((highlight, index) => {
                const meta = HIGHLIGHT_META[highlight.kind];
                return (
                  <li key={`${highlight.kind}-${highlight.t}-${index}`}>
                    <EventRow
                      timeMs={highlight.t}
                      icon={<meta.Icon size={12} />}
                      iconClassName={meta.text}
                      title={meta.label}
                      detail={highlightDetail(highlight, nameOf)}
                      onSelect={() => onSeek(highlight.t, highlightPoint(highlight))}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
});