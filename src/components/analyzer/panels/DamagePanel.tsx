"use client";

import { memo, useMemo } from "react";

import { FireIcon, RubbleIcon } from "../../icons";
import type { BuildingDamage, NameOf, Seek } from "../types";
import { EventRow } from "./EventRow";
import { EmptyNote, Panel } from "./Panel";

type Props = { damage: BuildingDamage[]; nameOf: NameOf; onSeek: Seek };

export const DamagePanel = memo(function DamagePanel({ damage, nameOf, onSeek }: Props) {
  // Cronológico, igual que Highlights y Chat.
  const sorted = useMemo(() => [...damage].sort((a, b) => a.t - b.t), [damage]);

  return (
    <Panel title="Edificios en riesgo" count={damage.length}>
      {sorted.length === 0 ? (
        <EmptyNote>Nadie atacó ni demolió edificios.</EmptyNote>
      ) : (
        <ul className="-mx-1 max-h-48 overflow-y-auto pr-1">
          {sorted.map((item, index) => {
            const attacked = item.kind === "attacked";
            return (
              <li key={`${item.kind}-${item.objectId}-${index}`}>
                <EventRow
                  timeMs={item.t}
                  icon={attacked ? <FireIcon size={12} /> : <RubbleIcon size={12} />}
                  iconClassName={attacked ? "text-orange-400" : "text-zinc-500"}
                  title={attacked ? "Bajo ataque" : "Demolido"}
                  detail={attacked ? `${nameOf(item.playerId)} → ${nameOf(item.ownerId)}` : nameOf(item.ownerId)}
                  onSelect={() => onSeek(item.t, { x: item.x, y: item.y })}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
});