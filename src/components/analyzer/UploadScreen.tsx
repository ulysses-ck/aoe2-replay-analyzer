import Link from "next/link";

import { buttonClass, focusRing } from "./ui/button-styles";
import { SpinnerGlyph, UploadGlyph } from "./ui/Glyphs";
import { Notice } from "./ui/Notice";

type Props = {
  busy: boolean;
  error: string | null;
  fileName: string | null;
  isDragging: boolean;
  onPickFile: () => void;
  onDismissError: () => void;
};

export function UploadScreen({ busy, error, fileName, isDragging, onPickFile, onDismissError }: Props) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">AoE2 Replay Analyzer</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Mirá tu partida sobre un mapa isométrico, con highlights, build order y chat sincronizados con la línea de
          tiempo.
        </p>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onPickFile}
        className={`flex w-full max-w-xl flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-8 py-14 text-center transition-colors disabled:cursor-wait ${focusRing} ${
          isDragging
            ? "border-violet-400 bg-violet-500/10"
            : "border-white/15 bg-white/[0.03] hover:border-violet-400/60 hover:bg-violet-500/5"
        }`}
      >
        {busy ? (
          <span role="status" aria-live="polite" className="flex flex-col items-center gap-3">
            <SpinnerGlyph size={28} className="text-violet-400" />
            <span className="text-base font-medium text-zinc-100">Procesando {fileName ?? "replay"}…</span>
            <span className="text-sm text-zinc-500">Las partidas largas pueden tardar unos segundos.</span>
          </span>
        ) : (
          <>
            <span className="grid size-12 place-items-center rounded-full bg-violet-500/15 text-violet-300">
              <UploadGlyph size={22} />
            </span>
            <span className="text-base font-medium text-zinc-100">Soltá un replay acá</span>
            <span className="text-sm text-zinc-400">
              o hacé clic para elegir un archivo <code className="rounded bg-white/10 px-1">.aoe2record</code> o{" "}
              <code className="rounded bg-white/10 px-1">.mgz</code>
            </span>
          </>
        )}
      </button>

      {error ? (
        <Notice tone="error" title="No se pudo abrir el replay" onDismiss={onDismissError} className="w-full max-w-xl">
          {error}
        </Notice>
      ) : null}

      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-xs text-zinc-500">El archivo se procesa en el servidor y no se almacena.</p>
        <Link href="/replays" className={buttonClass("ghost", "sm")}>
          Ver mis replays
        </Link>
      </div>
    </main>
  );
}