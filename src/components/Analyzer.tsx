"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import MapCanvas from "./MapCanvas";
import { formatTime, playerColor, type ReplayModel } from "@/lib/types";

const SPEEDS = [1, 2, 4, 8, 16, 32];

export default function Analyzer() {
  const [model, setModel] = useState<ReplayModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  const [focus, setFocus] = useState<{ x: number; y: number; nonce: number } | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const upload = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setFileName(file.name);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/parse", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.detail || payload?.error || `Error ${response.status}`);
        setModel(null);
        return;
      }
      setModel(payload as ReplayModel);
      setTime(0);
      setPlaying(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setModel(null);
    } finally {
      setBusy(false);
    }
  }, []);

  // Restaura la partida desde un deep link (?r=<id>), sin volver a subir nada.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("r");
    if (!id) return;
    let cancelled = false;
    setBusy(true);
    fetch(`/api/replay/${id}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("no encontrado"))))
      .then((payload: ReplayModel) => {
        if (cancelled) return;
        setModel(payload);
        setFileName(payload.meta.fileName);
      })
      .catch(() => {
        if (!cancelled) setError("El replay de este link ya no está disponible. Subilo de nuevo.");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Restaura el instante desde el deep link (?t=segundos).
  useEffect(() => {
    if (!model) return;
    const t = Number(new URLSearchParams(window.location.search).get("t"));
    if (Number.isFinite(t) && t > 0) {
      setTime(Math.min(model.meta.durationMs, t * 1000));
    }
  }, [model]);

  // Reloj de reproducción.
  useEffect(() => {
    if (!playing || !model) return;
    let raf = 0;
    let last = performance.now();
    const duration = model.meta.durationMs;
    const step = (now: number) => {
      const delta = now - last;
      last = now;
      setTime((prev) => Math.min(duration, prev + delta * speed));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, model]);

  useEffect(() => {
    if (model && time >= model.meta.durationMs && playing) setPlaying(false);
  }, [time, model, playing]);

  // Atajos: espacio = play/pausa, flechas = ±5 s.
  useEffect(() => {
    if (!model) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
        event.preventDefault();
        const delta = event.code === "ArrowRight" ? 5000 : -5000;
        setTime((value) => Math.max(0, Math.min(model.meta.durationMs, value + delta)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [model]);

  if (!model) {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center gap-6 bg-[#0a0d12] px-6 text-zinc-200"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
      >
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">AoE2 Replay Analyzer</h1>
          <p className="mt-2 max-w-md text-sm text-zinc-400">
            Subí un <code className="rounded bg-white/10 px-1">.aoe2record</code> y mirá la partida
            sobre un mapa isométrico interactivo. El archivo se procesa en el servidor y no se
            almacena.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl border border-white/15 bg-white/5 px-8 py-6 text-sm text-zinc-300 transition hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
        >
          {busy ? "Parseando…" : "Elegí un .aoe2record o arrastralo acá"}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept=".aoe2record,.mgz"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />

        {fileName && busy ? <p className="text-xs text-zinc-500">{fileName}</p> : null}
        {error ? (
          <p className="max-w-lg rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const { meta, players, chat } = model;

  return (
    <div
      className="relative flex h-screen flex-col bg-[#0a0d12] text-zinc-200"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (file) void upload(file);
      }}
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold tracking-tight">MATCH PLAYBACK</span>
          <span className="font-mono text-[11px] text-zinc-500">{meta.fileName}</span>
        </div>
        <div className="flex items-center gap-4 font-mono text-[11px] text-zinc-400">
          {meta.build > 0 ? <span>build {meta.build}</span> : null}
          <span>
            mapa {meta.mapSize}×{meta.mapSize}
          </span>
          <span>{meta.playerCount} jugadores</span>
          <span>{formatTime(meta.durationMs)}</span>
          {meta.engine === "agelens" ? (
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
              parser alternativo
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md border border-white/15 px-2 py-1 text-zinc-300 transition hover:bg-white/10"
          >
            Otro replay
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".aoe2record,.mgz"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-white/10">
          <section className="border-b border-white/10 p-3">
            <h2 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
              Jugadores
            </h2>
            <ul className="space-y-1.5">
              {players.map((player) => {
                const built = model.buildings.filter((b) => b.playerId === player.id && b.t <= time).length;
                const orders = model.moves.filter((m) => m.playerId === player.id && m.t <= time).length;
                return (
                  <li key={player.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: playerColor(player.colorId) }}
                      />
                      <span className="truncate">{player.name}</span>
                      <span className="ml-auto font-mono text-[10px] text-zinc-500">
                        T{player.team}
                        {player.winner ? " ✓" : ""}
                      </span>
                    </div>
                    <div className="ml-4.5 mt-0.5 font-mono text-[10px] text-zinc-600">
                      {built} edif · {orders} órdenes
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="border-b border-white/10 p-3">
            <h2 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
              Highlights
            </h2>
            {(() => {
              const list = model.highlights ?? [];
              if (list.length === 0) {
                return <p className="text-xs text-zinc-600">Sin combates detectados.</p>;
              }
              const nameOf = (id: number) => players.find((p) => p.id === id)?.name ?? `P${id}`;
              return (
                <ul className="space-y-1">
                  {list.map((highlight, index) => {
                    const label =
                      highlight.kind === "raid"
                        ? "Raid"
                        : highlight.kind === "battle"
                          ? "Batalla"
                          : "Pico de APM";
                    const detail =
                      highlight.kind === "apm"
                        ? `${highlight.apm}/min`
                        : highlight.players.map(nameOf).join(" vs ");
                    return (
                      <li key={`${highlight.kind}-${index}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setTime(highlight.t);
                            setPlaying(false);
                            if (highlight.x !== undefined && highlight.y !== undefined) {
                              setFocus({ x: highlight.x, y: highlight.y, nonce: Date.now() });
                            }
                          }}
                          className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-xs transition hover:bg-white/5"
                        >
                          <span className="font-mono text-[10px] text-zinc-500">
                            {formatTime(highlight.t)}
                          </span>
                          <span
                            aria-hidden
                            className={[
                              "h-2 w-2 shrink-0 rounded-full",
                              highlight.kind === "raid"
                                ? "bg-orange-400"
                                : highlight.kind === "battle"
                                  ? "bg-zinc-300"
                                  : "bg-violet-400",
                            ].join(" ")}
                          />
                          <span className="truncate text-zinc-300" title={`${label}: ${detail}`}>
                            {label} · <span className="text-zinc-500">{detail}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
          </section>

          <section className="flex min-h-0 flex-1 flex-col p-3">
            <h2 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">Chat</h2>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {chat.length === 0 ? (
                <li className="text-xs text-zinc-600">Sin mensajes.</li>
              ) : null}
              {chat.map((message, index) => (
                <li key={index} className="text-xs leading-snug">
                  <button
                    type="button"
                    onClick={() => {
                      setTime(message.t);
                      setPlaying(false);
                    }}
                    className="font-mono text-[10px] text-zinc-500 hover:text-zinc-300"
                  >
                    {formatTime(message.t)}
                  </button>{" "}
                  {message.system ? (
                    <>
                      <span
                        className="font-medium italic"
                        style={{ color: playerColor(players.find((p) => p.id === message.playerId)?.colorId ?? 0) }}
                      >
                        {players.find((p) => p.id === message.playerId)?.name ?? `P${message.playerId}`}
                      </span>{" "}
                      <span className="italic text-zinc-500">{message.text}</span>
                    </>
                  ) : (
                    <>
                      <span
                        className="font-medium"
                        style={{ color: playerColor(players.find((p) => p.id === message.playerId)?.colorId ?? 0) }}
                      >
                        {players.find((p) => p.id === message.playerId)?.name ?? `P${message.playerId}`}
                      </span>{" "}
                      <span className="text-zinc-300">{message.text}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <MapCanvas model={model} time={time} replayId={meta.id} focus={focus} />
          </div>

          <div className="border-t border-white/10 px-4 py-3">
            <input
              type="range"
              min={0}
              max={meta.durationMs}
              step={100}
              value={time}
              onChange={(event) => {
                setTime(Number(event.target.value));
                setPlaying(false);
              }}
              className="w-full accent-violet-500"
            />

            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPlaying((value) => !value)}
                className="w-16 rounded-md border border-white/15 bg-white/5 py-1 text-xs transition hover:bg-white/10"
              >
                {playing ? "Pausa" : "Play"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setTime(0);
                  setPlaying(false);
                }}
                className="rounded-md border border-white/15 px-2 py-1 text-xs transition hover:bg-white/10"
              >
                ⟲
              </button>

              <span className="font-mono text-xs text-zinc-400">
                {formatTime(time)} / {formatTime(meta.durationMs)}
              </span>

              <select
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                className="rounded-md border border-white/15 bg-[#12161d] px-2 py-1 text-xs"
              >
                {SPEEDS.map((value) => (
                  <option key={value} value={value}>
                    {value}x
                  </option>
                ))}
              </select>

              <span className="ml-auto font-mono text-[10px] text-zinc-600">
                {meta.parseMs ? `parse ${meta.parseMs} ms` : null}
                {meta.bytes ? ` · ${(meta.bytes / 1048576).toFixed(1)} MB` : null}
              </span>
            </div>
          </div>
        </main>
      </div>

      {busy ? (
        <div className="absolute inset-0 grid place-items-center bg-black/50 text-sm">
          Parseando…
        </div>
      ) : null}

      {error ? (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      ) : null}
    </div>
  );
}
