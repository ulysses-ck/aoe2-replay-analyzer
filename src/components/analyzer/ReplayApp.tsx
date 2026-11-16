"use client";

import { useFileDrop } from "./hooks/useFileDrop";
import { useFilePicker } from "./hooks/useFilePicker";
import { useReplayLoader } from "./hooks/useReplayLoader";
import { Notice } from "./ui/Notice";
import { ReplayView } from "./ReplayView";
import { UploadScreen } from "./UploadScreen";

/**
 * Entry point del reproductor: compone la carga (subida, drag & drop, deep
 * link y copia local) con las dos pantallas posibles. `loadKey` como `key`
 * reinicia el reproductor y el mapa con cada replay cargado.
 */
export default function ReplayApp() {
  const loader = useReplayLoader();
  const { open, inputProps } = useFilePicker(loader.upload);
  const isDragging = useFileDrop(loader.upload);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#0a0d12] text-zinc-200">
      <input {...inputProps} />
      {loader.model ? (
        <>
          {loader.error ? (
            <Notice tone="error" layout="bar" title="No se pudo abrir el archivo">
              {loader.error}
            </Notice>
          ) : null}
          <ReplayView
            key={loader.loadKey}
            model={loader.model}
            fromCache={loader.fromCache}
            initialTimeMs={loader.startMs}
            onPickFile={open}
          />
        </>
      ) : (
        <UploadScreen
          busy={loader.busy}
          error={loader.error}
          fileName={loader.fileName}
          isDragging={isDragging}
          onPickFile={open}
          onDismissError={loader.dismissError}
        />
      )}
    </div>
  );
}
