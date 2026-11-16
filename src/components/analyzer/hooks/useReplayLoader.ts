import { useCallback, useEffect, useState } from "react";

import { API_BASE } from "@/lib/api-base";
import { getFromCache, saveToCache } from "@/lib/replay-cache";
import type { ReplayModel } from "@/lib/types";

const REPLAY_FILE = /\.(aoe2record|mgz)$/i;

function readStartMs(): number {
  const seconds = Number(new URLSearchParams(window.location.search).get("t"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function describeError(cause: unknown): string {
  if (cause instanceof TypeError) return "No se pudo conectar con el servidor (¿PC apagada?).";
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Carga de replays: subida de archivo, deep link (?r=<id>&t=<seg>) y copia local.
 * `loadKey` cambia en cada carga exitosa; usalo como `key` de la vista para que
 * reproductor y mapa arranquen limpios con cada replay.
 */
export function useReplayLoader() {
  const [model, setModel] = useState<ReplayModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  /** true cuando el modelo salió de la copia local porque el backend no respondió. */
  const [fromCache, setFromCache] = useState(false);
  const [startMs, setStartMs] = useState(0);
  const [loadKey, setLoadKey] = useState(0);

  const dismissError = useCallback(() => setError(null), []);

  const upload = useCallback(async (file: File) => {
    if (!REPLAY_FILE.test(file.name)) {
      setError("Ese archivo no parece un replay. Probá con un .aoe2record o .mgz.");
      return;
    }
    setBusy(true);
    setError(null);
    setFileName(file.name);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API_BASE}/api/parse`, { method: "POST", body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        // Si ya había un replay abierto, se conserva: un archivo malo no lo pierde.
        setError(payload?.detail || payload?.error || `El servidor respondió con error ${response.status}.`);
        return;
      }
      const next = payload as ReplayModel;
      setModel(next);
      setFromCache(false);
      setStartMs(0);
      setLoadKey((key) => key + 1);
      // El link ?r=&t= ya no corresponde al replay nuevo.
      window.history.replaceState(null, "", window.location.pathname);
      void saveToCache(next);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  // Deep link: carga desde el backend; si no responde, cae a la copia local (IndexedDB).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("r");
    if (!id) return;
    let cancelled = false;
    const start = readStartMs();

    const show = (next: ReplayModel, cached: boolean) => {
      setModel(next);
      setFileName(next.meta.fileName);
      setFromCache(cached);
      setStartMs(start);
      setLoadKey((key) => key + 1);
    };

    setBusy(true);
    fetch(`${API_BASE}/api/replay/${id}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("no encontrado"))))
      .then((payload: ReplayModel) => {
        if (cancelled) return;
        show(payload, false);
        void saveToCache(payload);
      })
      .catch(async () => {
        if (cancelled) return;
        const cached = await getFromCache(id);
        if (cancelled) return;
        if (cached) show(cached, true);
        else setError("El replay de este link no está disponible (¿PC apagada?) y no hay copia local en este navegador.");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { model, busy, error, fileName, fromCache, startMs, loadKey, upload, dismissError };
}