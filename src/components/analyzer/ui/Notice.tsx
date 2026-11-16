import type { ReactNode } from "react";

import { CloseGlyph } from "./Glyphs";
import { focusRing } from "./button-styles";

type Props = {
  tone: "warning" | "error";
  /** "card": recuadro redondeado · "bar": franja a todo el ancho. */
  layout?: "card" | "bar";
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
};

const TONES = {
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  error: "border-red-500/30 bg-red-500/10 text-red-200",
};
const LAYOUTS = { card: "rounded-lg border", bar: "border-b" };

export function Notice({ tone, layout = "card", title, children, onDismiss, className = "" }: Props) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 px-4 py-2.5 text-xs leading-relaxed ${LAYOUTS[layout]} ${TONES[tone]} ${className}`}
    >
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={title ? "mt-0.5 opacity-90" : undefined}>{children}</div>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar aviso"
          className={`-mr-1 grid size-6 shrink-0 place-items-center rounded opacity-70 transition hover:bg-white/10 hover:opacity-100 ${focusRing}`}
        >
          <CloseGlyph size={14} />
        </button>
      ) : null}
    </div>
  );
}