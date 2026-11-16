"use client";

import { memo, useMemo } from "react";

import { playerColor, type ReplayModel } from "@/lib/types";
import type { Player } from "../types";
import { Panel } from "./Panel";

type Timed = ReadonlyArray<{ playerId: number; t: number }>;

function groupTimes(items: Timed): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const item of items) {
    const list = map.get(item.playerId);
    if (list) list.push(item.t);
    else map.set(item.playerId, [item.t]);
  }
  for (const list of map.values()) list.sort((a, b) => a - b);
  return map;
}

/** Cantidad de elementos con t <= time (búsqueda binaria sobre tiempos ordenados). */
function countUpTo(sorted: number[] | undefined, time: number): number {
  if (!sorted) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

type Props = {
  players: Player[];
  buildings: ReplayModel["buildings"];
  moves: ReplayModel["moves"];
  time: number;
};

export const PlayersPanel = memo(function PlayersPanel({ players, buildings, moves, time }: Props) {
  // Se agrupa y ordena una sola vez; en cada frame solo hay búsquedas binarias.
  const buildingTimes = useMemo(() => groupTimes(buildings), [buildings]);
  const moveTimes = useMemo(() => groupTimes(moves), [moves]);

  return (
    <Panel title="Jugadores" count={players.length}>
      <ul className="space-y-0.5">
        {players.map((player) => (
          <li key={player.id} className="rounded-md px-2 py-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: playerColor(player.colorId) }}
              />
              <span className="min-w-0 truncate font-medium text-zinc-100">{player.name}</span>
              {player.winner ? (
                <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-300">
                  Ganó
                </span>
              ) : null}
              <span className="ml-auto shrink-0 text-[11px] text-zinc-500">Equipo {player.team}</span>
            </div>
            <p className="mt-1 flex gap-4 pl-[18px] text-[11px] text-zinc-500">
              <span>
                <span className="font-mono tabular-nums text-zinc-300">
                  {countUpTo(buildingTimes.get(player.id), time)}
                </span>{" "}
                edificios
              </span>
              <span>
                <span className="font-mono tabular-nums text-zinc-300">
                  {countUpTo(moveTimes.get(player.id), time)}
                </span>{" "}
                órdenes
              </span>
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
});