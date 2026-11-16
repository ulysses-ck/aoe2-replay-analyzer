"use client";

import { useId, useState, type ReactNode } from "react";

import { ChevronGlyph } from "../ui/Glyphs";
import { focusRing } from "../ui/button-styles";

type Props = {
  title: string;
  /** Cantidad de elementos; se muestra como insignia. */
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
};

/** Sección colapsable de la barra lateral. */
export function Panel({ title, count, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="border-b border-white/10">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5 ${focusRing}`}
        >
          <ChevronGlyph size={14} className={`text-zinc-500 transition-transform ${open ? "" : "-rotate-90"}`} />
          {title}
          {count !== undefined ? (
            <span className="ml-auto rounded-full bg-white/10 px-1.5 font-mono text-[10px] tabular-nums text-zinc-400">
              {count}
            </span>
          ) : null}
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="px-3 pb-3">
        {children}
      </div>
    </section>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-1 text-xs text-zinc-500">{children}</p>;
}