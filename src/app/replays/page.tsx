"use client";

import { useEffect, useState } from "react";
import { formatTime, type ReplayModel } from "@/lib/types";
import { listCache } from "@/lib/replay-cache";
import { PackIcon } from "@/components/icons";
import { API_BASE } from "@/lib/api-base";

type ReplayRow = {
  id: string;
  fileName: string;
  fileSize: number;
  durationMs: number;
  playerCount: number;
  engine: string;
  parseMs: number;
  createdAt: string;
};

type CachedRow = {
  id: string;
  fileName: string;
  savedAt: number;
};

/**
 * Índice de replays parseados: los últimos 200, más nuevos primero. La data
 * viene de la DB del backend (la PC); abrir uno usa el mismo deep link que el
 * botón compartir del reproductor.
 */
export default function ReplaysIndex() {
  const [rows, setRows] = useState<ReplayRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Copias locales en el navegador: visibles siempre, útiles con la PC apagada. */
  const [cached, setCached] = useState<CachedRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listCache().then((entries) => {
      if (!cancelled) setCached(entries);
    });
    fetch(`${API_BASE}/api/replays`)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)),
      )
      .then((payload: { replays: ReplayRow[] }) => {
        if (!cancelled) setRows(payload.replays);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const formatDate = (iso: string) => {
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : iso;
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 text-zinc-200">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Mis replays</h1>
        <a href="/" className="text-sm text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline">
          ← Reproductor
        </a>
      </header>

      {cached.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
            Copias locales (visibles sin la PC)
          </h2>
          <ul className="divide-y divide-white/5 rounded-lg border border-amber-500/20 bg-amber-500/[0.04]">
            {cached.map((row) => (
              <li key={row.id}>
                <a
                  href={`/?r=${row.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/5"
                >
                  <span aria-hidden className="text-amber-400">
                    <PackIcon size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm" title={row.fileName}>
                      {row.fileName}
                    </p>
                    <p className="font-mono text-[11px] text-zinc-500">
                      guardada {new Date(row.savedAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="font-mono text-[11px] text-zinc-600">{row.id}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          No se pudo cargar el índice: {error}. ¿Está la API del backend arriba?
        </p>
      ) : rows === null ? (
        <p className="text-sm text-zinc-500">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Todavía no hay replays. <a href="/" className="underline">Subí el primero</a>.
        </p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10 bg-white/[0.02]">
          {rows.map((row) => (
            <li key={row.id}>
              <a
                href={`/?r=${row.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" title={row.fileName}>
                    {row.fileName}
                  </p>
                  <p className="font-mono text-[11px] text-zinc-500">
                    {formatDate(row.createdAt)} · {formatTime(row.durationMs)} · {row.playerCount} jugadores ·{" "}
                    {row.engine}
                    {row.parseMs > 0 ? ` · parse ${(row.parseMs / 1000).toFixed(1)} s` : ""}
                  </p>
                </div>
                <span className="font-mono text-[11px] text-zinc-600">{row.id}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
