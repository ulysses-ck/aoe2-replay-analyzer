import { useCallback, useRef, type ChangeEvent } from "react";

/** Un único <input type="file"> compartido por todas las vistas: `open()` lo abre. */
export function useFilePicker(onFile: (file: File) => void) {
  const ref = useRef<HTMLInputElement>(null);

  const open = useCallback(() => ref.current?.click(), []);

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = ""; // permite volver a elegir el mismo archivo
      if (file) onFile(file);
    },
    [onFile],
  );

  return {
    open,
    inputProps: {
      ref,
      type: "file" as const,
      accept: ".aoe2record,.mgz",
      className: "hidden",
      tabIndex: -1,
      "aria-hidden": true as const,
      onChange,
    },
  };
}