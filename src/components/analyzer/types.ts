import type { ReplayModel } from "@/lib/types";

// Derivados de ReplayModel: si el modelo cambia, estos tipos lo siguen solos.
export type Player = ReplayModel["players"][number];
export type Highlight = NonNullable<ReplayModel["highlights"]>[number];
export type BuildingDamage = NonNullable<ReplayModel["buildingDamage"]>[number];
export type ChatMessage = ReplayModel["chat"][number];

export type Point = { x: number; y: number };
/** `nonce` fuerza a MapCanvas a re-centrar aunque el punto sea el mismo. */
export type Focus = Point & { nonce: number };

/** Salta a un instante (pausando). Si trae `point`, además centra el mapa ahí. */
export type Seek = (timeMs: number, point?: Point) => void;
export type NameOf = (playerId: number) => string;
export type ColorOf = (playerId: number) => string;
