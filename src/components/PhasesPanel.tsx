"use client";

/**
 * Análisis de fases y build order.
 *
 * - Fases: los tiempos de feudal/castillo/imperial por jugador, con ⭐ al más
 *   rápido. Viene vacío en los builds de nov 2026 en adelante (el juego dejó
 *   de registrar la acción Research); la UI degrada con un aviso claro.
 * - Build order: columnas comparables por jugador con unidades terminadas
 *   (DeQueue), edificios colocados (Build) y marcas de subida de edad.
 */

import { useState } from "react";

import { getBuildingInfo } from "@/lib/buildings";import { formatTime, playerColor, type ReplayModel } from "@/lib/types";

/** Nombres de unidades del dataset clásico (los que aparecen en DeQueue). */
const UNIT_NAMES: Record<number, string> = {
  83: "Aldeano",
  293: "Aldeano",
  74: "Miliciano",
  75: "Hombre de armas",
  4: "Arquero",
  24: "Ballestero",
  5: "Fusilero",
  7: "Skirmisher",
  93: "Lancero",
  358: "Piquero",
  448: "Explorador",
  37: "Caballería ligera",
  38: "Caballero",
  39: "Arquero de caballo",
  6: "Camellero",
  125: "Monje",
  25: "Caballero teutón",
  751: "Explorador águila",
  725: "Guerrero jaguar",
  755: "Tarkan",
  1231: "Kipchak",
  1370: "Lancero estepario",
  1755: "Camello explorador",
  2700: "Ballesta montada",
  331: "Trabuquete",
  280: "Mangonel",
  279: "Escorpión",
  36: "Cañón",
  35: "Ariete",
  422: "Ariete reforzado",
  548: "Ariete de asedio",
  542: "Escorpión pesado",
  128: "Carreta",
  1658: "Serjeant",
  1132: "Elefante de guerra",
};

const AGE_NAMES: Record<number, string> = {
  101: "Feudal",
  102: "Castillo",
  103: "Imperial",
};

const AGES = [101, 102, 103];

type BoEvent = {
  t: number;
  label: string;
  amount: number;
  /** true = marca de subida de edad. */
  isAge?: boolean;
};

function unitName(unitId: number): string {
  return UNIT_NAMES[unitId] ?? `Unidad ${unitId}`;
}

function buildingName(typeId: number): string {
  return getBuildingInfo(typeId)?.name ?? `Edificio ${typeId}`;
}

// ─────────────────────────── fases ───────────────────────────

export function PhaseBreakdown({ model }: { model: ReplayModel }) {
  const ageUps = model.ageUps ?? [];
  if (ageUps.length === 0) {
    return (
      <section className="border-b border-white/10 p-3">
        <h2 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">Fases</h2>
        <p className="text-xs leading-relaxed text-zinc-600">
          Este replay no registra los avances de edad (los builds de noviembre 2026
          dejaron de escribir la acción Research). La producción y el build order
          de abajo sí están completos.
        </p>
      </section>
    );
  }

  return (
    <section className="border-b border-white/10 p-3">
      <h2 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">Fases</h2>
      <div className="space-y-2">
        {AGES.map((age) => {
          const entries = ageUps
            .filter((a) => a.age === age)
            .sort((a, b) => a.t - b.t);
          if (entries.length === 0) return null;
          const best = entries[0].t;
          return (
            <div key={age} className="flex items-baseline gap-2 text-xs">
              <span className="w-16 shrink-0 text-zinc-400">{AGE_NAMES[age]}</span>
              <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                {entries.map((entry) => {
                  const isBest = entry.t === best && entries.length > 1;
                  return (
                    <span key={entry.playerId} className="whitespace-nowrap">
                      <span
                        className="font-medium"
                        style={{ color: playerColor(model.players.find((p) => p.id === entry.playerId)?.colorId ?? 0) }}
                      >
                        {model.players.find((p) => p.id === entry.playerId)?.name ?? `P${entry.playerId}`}
                      </span>{" "}
                      <span className={isBest ? "font-mono text-zinc-200" : "font-mono text-zinc-500"}>
                        {isBest ? "⭐ " : ""}
                        {formatTime(entry.t)}
                      </span>
                    </span>
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────── build order ───────────────────────────

const WINDOW_MS = 30 * 60_000;

export function BuildOrder({ model }: { model: ReplayModel }) {
  const [full, setFull] = useState(false);
  const limit = full ? Number.POSITIVE_INFINITY : WINDOW_MS;

  const eventsByPlayer = new Map<number, BoEvent[]>();
  for (const player of model.players) {
    const events: BoEvent[] = [];
    for (const production of model.production ?? []) {
      if (production.playerId !== player.id || production.t > limit) continue;
      events.push({
        t: production.t,
        label: unitName(production.unitId),
        amount: production.amount,
      });
    }
    for (const building of model.buildings) {
      // Los TCs iniciales inferidos (t=0) son ruido en el build order.
      if (building.t === 0) continue;
      if (building.playerId !== player.id || building.t > limit) continue;
      events.push({
        t: building.t,
        label: buildingName(building.typeId),
        amount: 1,
      });
    }
    for (const ageUp of (model.ageUps ?? []).filter((a) => a.playerId === player.id && a.t <= limit)) {
      events.push({
        t: ageUp.t,
        label: `⬆ ${AGE_NAMES[ageUp.age] ?? ageUp.age}`,
        amount: 1,
        isAge: true,
      });
    }
    events.sort((a, b) => a.t - b.t);
    eventsByPlayer.set(player.id, events);
  }

  const total = [...eventsByPlayer.values()].reduce((acc, list) => acc + list.length, 0);
  if (total === 0) return null;

  return (
    <section className="border-b border-white/10 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-wider text-zinc-500">Build order</h2>
        <div className="flex gap-1">
          {(
            [
              ["30 min", false],
              ["Completa", true],
            ] as const
          ).map(([label, value]) => (
            <button
              key={label}
              type="button"
              onClick={() => setFull(value)}
              className={[
                "rounded px-1.5 py-0.5 text-[10px] transition",
                full === value
                  ? "bg-violet-500/20 text-violet-300"
                  : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {model.players.map((player) => {
          const events = eventsByPlayer.get(player.id) ?? [];
          return (
            <div
              key={player.id}
              className="min-w-[140px] flex-1 basis-0 overflow-y-auto rounded-md border border-white/10 bg-black/20"
              style={{ maxHeight: 260 }}
            >
              <div
                className="sticky top-0 flex items-center gap-1.5 border-b border-white/10 bg-[#0d1117] px-2 py-1"
                title={player.name}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: playerColor(player.colorId) }}
                />
                <span className="truncate text-[10px] text-zinc-300">{player.name}</span>
              </div>
              <ul className="px-2 py-1">
                {events.length === 0 ? (
                  <li className="py-0.5 text-[10px] text-zinc-600">—</li>
                ) : null}
                {events.map((event, index) => (
                  <li
                    key={index}
                    className={[
                      "flex items-baseline gap-1.5 text-[10px] leading-snug",
                      event.isAge ? "font-medium text-violet-300" : "text-zinc-400",
                    ].join(" ")}
                  >
                    <span className="w-9 shrink-0 font-mono text-zinc-600">
                      {formatTime(event.t)}
                    </span>
                    <span className="truncate" title={event.label}>
                      {event.label}
                      {event.amount > 1 ? <span className="text-zinc-600"> ×{event.amount}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
