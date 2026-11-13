/** Tipos compartidos entre el parser (servidor) y la UI (cliente). */

export type Player = {
  id: number;
  name: string;
  civId: number;
  colorId: number;
  team: number;
  winner: boolean;
};

export type BuildingEvent = {
  /** Milisegundos de tiempo de juego. */
  t: number;
  playerId: number;
  x: number;
  y: number;
  typeId: number;
  objectId: number;
};

export type MoveEvent = {
  t: number;
  playerId: number;
  x: number;
  y: number;
  count: number;
};

export type ChatMessage = {
  t: number;
  playerId: number;
  text: string;
  /** Mensaje del juego (edad avanzada, etc.) en vez de chat de jugador. */
  system: boolean;
};

export type ReplayModel = {
  meta: {
    fileName: string;
    build: number;
    mapSize: number;
    durationMs: number;
    playerCount: number;
    /** Parser que resolvió el archivo. */
    engine?: "aoe2rec" | "agelens";
    /** Sólo los agrega la API al responder. */
    parseMs?: number;
    bytes?: number;
  };
  players: Player[];
  buildings: BuildingEvent[];
  moves: MoveEvent[];
  chat: ChatMessage[];
};

/** Paleta de colores de jugador de AoE2 DE, indexada por `color_id`. */
export const PLAYER_COLORS = [
  "#2f6fe4", // 0 azul
  "#d93a2b", // 1 rojo
  "#2f9e44", // 2 verde
  "#e8c218", // 3 amarillo
  "#25c2c2", // 4 cian
  "#9b59b6", // 5 violeta
  "#9aa4b2", // 6 gris
  "#e8762c", // 7 naranja
] as const;

export function playerColor(colorId: number): string {
  return PLAYER_COLORS[((colorId % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length];
}

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
