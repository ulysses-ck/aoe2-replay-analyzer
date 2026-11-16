import { SpinnerGlyph, UploadGlyph } from "./Glyphs";
import { Notice } from "./Notice";

/** Cubre la pantalla mientras se arrastra un archivo sobre la ventana. */
export function DropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 bg-[#0a0d12]/85 p-4 backdrop-blur-sm"
    >
      <div className="grid h-full w-full place-items-center rounded-2xl border-2 border-dashed border-violet-400/70">
        <div className="flex flex-col items-center gap-3 text-violet-200">
          <UploadGlyph size={32} />
          <p className="text-lg font-medium">Soltá el replay para abrirlo</p>
          <p className="text-sm text-zinc-400">.aoe2record o .mgz</p>
        </div>
      </div>
    </div>
  );
}

/** Mientras se procesa un replay nuevo con otro ya abierto. */
export function LoadingOverlay({ fileName }: { fileName: string | null }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-[2px]"
    >
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#12161d] px-4 py-3 text-sm">
        <SpinnerGlyph size={18} className="text-violet-400" />
        Procesando {fileName ?? "replay"}…
      </div>
    </div>
  );
}

/** Error flotante sobre la vista del replay; se cierra a mano. */
export function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-28 z-40 flex justify-center px-4">
      <Notice
        tone="error"
        title="No se pudo abrir el replay"
        onDismiss={onDismiss}
        className="pointer-events-auto max-w-lg shadow-lg shadow-black/40"
      >
        {message}
      </Notice>
    </div>
  );
}