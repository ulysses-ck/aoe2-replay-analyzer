import { useCallback, useEffect, useRef, useState } from "react";

export const SPEEDS = [1, 2, 4, 8, 16, 32] as const;
export const SKIP_MS = 5000;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type SeekOptions = { pause?: boolean };

/** Reloj de reproducción: tiempo, play/pausa, velocidad y saltos. */
export function usePlayback(durationMs: number, initialTimeMs = 0) {
  const [rawTime, setRawTime] = useState(initialTimeMs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(8);

  const time = Math.min(rawTime, durationMs);
  const atEnd = durationMs > 0 && time >= durationMs;

  useEffect(() => {
    if (!playing || durationMs <= 0) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const delta = now - last;
      last = now;
      setRawTime((prev) => Math.min(durationMs, prev + delta * speed));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, durationMs]);

  useEffect(() => {
    if (playing && atEnd) setPlaying(false);
  }, [playing, atEnd]);

  const seek = useCallback(
    (timeMs: number, { pause = false }: SeekOptions = {}) => {
      setRawTime(clamp(timeMs, 0, durationMs));
      if (pause) setPlaying(false);
    },
    [durationMs],
  );

  const skip = useCallback(
    (deltaMs: number) => setRawTime((value) => clamp(Math.min(value, durationMs) + deltaMs, 0, durationMs)),
    [durationMs],
  );

  /** Si está en el final, Play vuelve a empezar desde 0. */
  const togglePlay = useCallback(() => {
    if (!playing && atEnd) setRawTime(0);
    setPlaying((value) => !value);
  }, [playing, atEnd]);

  return { time, playing, speed, setSpeed, togglePlay, seek, skip };
}

type ShortcutActions = {
  togglePlay: () => void;
  skip: (deltaMs: number) => void;
  seek: (timeMs: number, options?: SeekOptions) => void;
};

/** Espacio = play/pausa · ←/→ = ∓5 s (Shift: ∓30 s) · Inicio = volver al principio. */
export function usePlaybackShortcuts(actions: ShortcutActions) {
  const ref = useRef(actions);
  useEffect(() => {
    ref.current = actions;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;

      const { togglePlay, skip, seek } = ref.current;
      switch (event.code) {
        case "Space":
          // Sobre un botón/link, Espacio ya "hace clic": no duplicar la acción.
          if (target?.closest("button, a")) return;
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          event.preventDefault();
          skip(event.shiftKey ? SKIP_MS * 6 : SKIP_MS);
          break;
        case "ArrowLeft":
          event.preventDefault();
          skip(event.shiftKey ? -SKIP_MS * 6 : -SKIP_MS);
          break;
        case "Home":
          event.preventDefault();
          seek(0);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}