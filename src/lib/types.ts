/**
 * Tipos compartidos entre el parser (servidor) y la UI (cliente).
 */

export type Player = {
  id: number;
  name: string;
  civId: number;
  colorId: number;
  team: number;
  winner: boolean;
  /** True si es el jugador que grabó la partida (su cámara está en los viewlocks). */
  owner?: boolean;
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
  /**
   * Ids de las unidades seleccionadas (aoe2rec-js los trae; el fallback
   * agelens no). Con ellos se encadenan rutas por unidad: cada vez que una id
   * reaparece en otra orden, su posición anterior era el destino de la orden
   * previa (ver src/lib/units.ts).
   */
  ids?: number[];
};

export type ChatMessage = {
  t: number;
  playerId: number;
  text: string;
  /** Mensaje del juego (edad avanzada, etc.) en vez de chat de jugador. */
  system: boolean;
};

export type InteractionEvent = {
  t: number;
  playerId: number;
  x: number;
  y: number;
  /** Id del objetivo del ataque (unidad o edificio). */
  targetId: number;
  count: number;
  /** Ids de las unidades seleccionadas (mismo criterio que en `moves`). */
  ids?: number[];
};

export type Highlight = {
  kind: "battle" | "raid" | "apm";
  t: number;
  /** Batallas y raids: centro aproximado del choque. */
  x?: number;
  y?: number;
  players: number[];
  /** Sólo APM: acciones por minuto del pico. */
  apm?: number;
};

/**
 * Avance de edad: la investigación de las tecnologías 101/102/103 (Feudal,
 * Castillo, Imperial). Ojo: el build v101.103.57257 (nov 2026) dejó de
 * registrarlas — en esos replays la lista viene vacía.
 */
export type AgeUp = {
  playerId: number;
  /** 101 = Feudal, 102 = Castillo, 103 = Imperial. */
  age: 101 | 102 | 103;
  t: number;
};

/** Unidad que terminó de entrenarse (DeQueue): materia prima del build order. */
export type ProductionEvent = {
  t: number;
  playerId: number;
  /** Id de unidad de DE (83=villager, 74=militia, 4=archer, …). */
  unitId: number;
  amount: number;
};

/** Tecnología investigada (todas, no sólo las de edad). */
export type ResearchEvent = {
  t: number;
  playerId: number;
  techId: number;
};

/**
 * Daño a un edificio. El stream de acciones no registra la destrucción por
 * combate (es un cambio de estado del juego, no un comando), así que lo que
 * hay son dos señales indirectas reales:
 *
 * - `attacked`: una orden de ataque cuya víctima es el objectId de un edificio
 *   enemigo (fuego: el edificio está recibiendo golpes).
 * - `deleted`: el dueño borró el edificio (auto-demolición / replace de casas).
 *   La posición y el tipo salen del BUILD original con el mismo objectId.
 */
export type DamageEvent = {
  t: number;
  /** Quien lo golpea; en `deleted` es el dueño que demuele. */
  playerId: number;
  /** Dueño del edificio. */
  ownerId: number;
  x: number;
  y: number;
  typeId: number;
  objectId: number;
  kind: "attacked" | "deleted";
};

/**
 * Grilla de terreno del mapa, una entrada por tile en orden row-major
 * (`índice = y * dimension + x`, verificado contra los edificios).
 */
export type TerrainModel = {
  dimension: number;
  /** Id de terreno de DE por tile (0=grass, 10=bosque, 22=agua profunda, …). */
  terrain: number[];
  /** Nivel de elevación (0-7) por tile; se usa para el shading. */
  elevation: number[];
};

/** Objeto gaia inicial del mapa (oro, piedra, reliquias, bayas, árboles, etc.). */
export type GaiaObject = {
  x: number;
  y: number;
  /** Id de tipo de objeto/unidad de DE (66=oro, 102=piedra, 285=reliquia, …). */
  typeId: number;
  /** Clase de objeto según el header (10=recurso, 20=árbol, 70=entidad, 80=edificio, …). */
  classId: number;
  /** Dueño (0 = gaia en general). */
  player: number;
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
    /** Hash del archivo: identifica el replay en el cache y en el deep link. */
    id?: string;
    /** Sólo los agrega la API al responder. */
    parseMs?: number;
    bytes?: number;
  };
  players: Player[];
  buildings: BuildingEvent[];
  moves: MoveEvent[];
  chat: ChatMessage[];
  /**
   * Cámara del jugador que grabó, una muestra cada ~100 ms. Son miles de pares,
   * por eso viven en su propio campo y no en `moves`.
   */
  viewlocks?: Array<[number, number, number]>;
  /** Ataques ordenados (destino del objetivo). Materia prima de los highlights. */
  interactions?: InteractionEvent[];
  /** Batallas, raids y picos de APM detectados sobre las órdenes. */
  highlights?: Highlight[];
  /** Avances de edad (feudal/castillo/imperial). Vacío si el build no los registra. */
  ageUps?: AgeUp[];
  /** Unidades terminadas (DeQueue) por jugador. */
  production?: ProductionEvent[];
  /** Tecnologías investigadas, en orden de investigación. */
  researches?: ResearchEvent[];
  /** Edificios atacados por enemigos y demolidos por su dueño. */
  buildingDamage?: DamageEvent[];
  /** Terreno real del mapa; falta si la cabecera no se pudo leer. */
  terrain?: TerrainModel;
  /** Objetos gaia iniciales (recursos, reliquias, árboles); falta si no se pudieron leer. */
  gaiaObjects?: GaiaObject[];
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