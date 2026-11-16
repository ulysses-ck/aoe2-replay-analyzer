import { useMemo } from "react";

import { playerColor } from "@/lib/types";
import type { ColorOf, NameOf, Player } from "../types";

/** nameOf / colorOf en O(1), en vez de `players.find` repetido en cada render. */
export function usePlayerLookup(players: Player[]): { nameOf: NameOf; colorOf: ColorOf } {
  return useMemo(() => {
    const byId = new Map(players.map((player) => [player.id, player]));
    return {
      nameOf: (id) => byId.get(id)?.name ?? `P${id}`,
      colorOf: (id) => playerColor(byId.get(id)?.colorId ?? 0),
    };
  }, [players]);
}