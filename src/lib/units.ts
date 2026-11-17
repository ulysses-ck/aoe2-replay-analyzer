/**
 * Unidades moviéndose con rutas estimadas.
 *
 * Un replay sólo guarda comandos de jugador (no posiciones por tick), así que
 * esto es una aproximación al estilo del visor de referencia (engine.js de
 * sk8erlucas/aoe2-replays, MIT): cada unidad camina en línea recta hacia el
 * destino de su orden a velocidad estimada, y la próxima orden corta la caminata
 * desde donde estuviera.
 *
 * La clave es que las órdenes traen los ids de las unidades seleccionadas
 * (aoe2rec-js los expone como `unit_ids`; el fallback agelens no, esas órdenes
 * se ignoran): encadenando destinos por id se reconstruye una ruta plausible —
 * la posición previa de una unidad es el destino de su orden anterior. La
 * primera vez que aparece una id se la ubica junto al edificio propio más
 * cercano al destino (en la práctica: su TC o el campamento donde trabaja).
 *
 * Heurística de tipo: una unidad que ataca un edificio enemigo se considera
 * militar (sprite de milicia); el resto, aldeano. Sin esto las rutas de un raid
 * se verían con aldeanos.
 */
import type { InteractionEvent, MoveEvent, ReplayModel } from "./types";

/** Velocidades estimadas en tiles/segundo (aldeano 0.8, milicia 0.9). */
const SPEED_VILLAGER = 0.8;
const SPEED_MILITARY = 0.9;

/** Un segmento: entre t0 y la llegada camina de (x0,y0) a (x1,y1). */
export type UnitSegment = {
  t0: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  speed: number;
};

export type UnitPath = {
  id: number;
  playerId: number;
  /** Primer instante en que aparece en una orden: antes no se dibuja. */
  spawnT: number;
  military: boolean;
  path: UnitSegment[];
};

/** Posición interpolada de una unidad en un instante. */
export type UnitSnapshot = {
  unit: UnitPath;
  x: number;
  y: number;
  moving: boolean;
  /** Delta de la caminata actual (para elegir la dirección del sprite). */
  dx: number;
  dy: number;
};

export function unitSnapshotAt(u: UnitPath, t: number): UnitSnapshot | null {
  if (t < u.spawnT) return null;
  const seg = lastSegmentAt(u, t);
  const dist = Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0);
  const walked = dist === 0 ? 0 : (seg.speed * Math.max(0, t - seg.t0)) / 1000;
  const moving = dist > 0 && walked < dist;
  const k = moving ? walked / dist : 1;
  return {
    unit: u,
    x: seg.x0 + (seg.x1 - seg.x0) * k,
    y: seg.y0 + (seg.y1 - seg.y0) * k,
    moving,
    dx: seg.x1 - seg.x0,
    dy: seg.y1 - seg.y0,
  };
}

/** Posición en el momento en que se le da la orden (corta la caminata previa). */
export function unitPositionAt(u: UnitPath, t: number): { x: number; y: number } {
  const seg = lastSegmentAt(u, t);
  if (seg.x1 === seg.x0 && seg.y1 === seg.y0) return { x: seg.x0, y: seg.y0 };
  const dist = Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0);
  const walked = (seg.speed * Math.max(0, t - seg.t0)) / 1000;
  if (walked >= dist) return { x: seg.x1, y: seg.y1 };
  const k = walked / dist;
  return { x: seg.x0 + (seg.x1 - seg.x0) * k, y: seg.y0 + (seg.y1 - seg.y0) * k };
}

function lastSegmentAt(u: UnitPath, t: number): UnitSegment {
  let seg = u.path[0];
  for (const s of u.path) {
    if (s.t0 > t) break;
    seg = s;
  }
  return seg;
}

/** Instante en que la unidad llega al final del segmento activo en t. */
export function segmentArrival(seg: UnitSegment): number {
  const dist = Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0);
  return dist <= 0 ? seg.t0 : seg.t0 + (dist / seg.speed) * 1000;
}

/**
 * Offset de formación: reparte el grupo alrededor del destino para que no
 * apilen todas en el mismo punto ( golden angle ). Adaptado de engine.js.
 */
export function formationOffset(index: number): [number, number] {
  if (index === 0) return [0, 0];
  const ring = Math.ceil((Math.sqrt(index + 1) - 1) / 2);
  const angle = index * 2.399963;
  const r = 0.6 * ring + 0.3;
  return [Math.cos(angle) * r, Math.sin(angle) * r];
}

/**
 * Jitter determinista por id: varias órdenes al mismo destino (rally point de
 * producción, tama de aldeanos) repiten el mismo patrón de formación y las
 * unidades se apilan en puntos idénticos. Un desplazamiento estable por unidad
 * (hasta ~0.7 tiles) las desparrama sin que tiemblen entre frames.
 */
function unitJitter(id: number): [number, number] {
  let h = (id * 2654435761) >>> 0;
  h = (h ^ (h >> 13)) * 1274126177;
  const a = ((h >>> 8) % 628) / 100; // 0..2π·
  const r = (((h >>> 16) % 100) / 100) * 0.7;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/**
 * Construye las rutas de todas las unidades que aparecen al menos una vez en
 * una orden con ids. Devuelve un Map por id (la iteración da igual: el dibujo
 * ordena por profundidad por frame).
 */
export function buildUnitPaths(model: ReplayModel): Map<number, UnitPath> {
  // Orden con ids = Move o Interact del parser principal.
  type Cmd = { t: number; playerId: number; x: number; y: number; ids: number[]; targetId?: number; militaryTarget: boolean };
  const commands: Cmd[] = [];
  const push = (e: MoveEvent | InteractionEvent, militaryTarget: boolean, targetId?: number) => {
    if (!e.ids?.length) return;
    commands.push({ t: e.t, playerId: e.playerId, x: e.x, y: e.y, ids: e.ids, targetId, militaryTarget });
  };
  for (const m of model.moves) push(m, false);
  // Militar si golpea algo de otro jugador (edificio enemigo). Golpes a
  // recursos o edificios propios son aldeanos (talar, cazar, construir).
  const enemyTargets = new Set<string>();
  for (const d of model.buildingDamage ?? []) {
    if (d.kind === "attacked") enemyTargets.add(`${d.playerId}:${d.objectId}`);
  }
  for (const i of model.interactions ?? []) {
    push(i, enemyTargets.has(`${i.playerId}:${i.targetId}`), i.targetId);
  }
  commands.sort((a, b) => a.t - b.t);

  // Edificios propios por jugador, en orden temporal: origen estimado de las
  // unidades que aparecen por primera vez.
  const buildingsByPlayer = new Map<number, { t: number; x: number; y: number }[]>();
  for (const b of model.buildings) {
    let list = buildingsByPlayer.get(b.playerId);
    if (!list) buildingsByPlayer.set(b.playerId, (list = []));
    list.push({ t: b.t, x: b.x, y: b.y });
  }
  for (const list of buildingsByPlayer.values()) list.sort((a, b) => a.t - b.t);

  const nearestOwnBuilding = (playerId: number, t: number, x: number, y: number): { x: number; y: number } => {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const b of buildingsByPlayer.get(playerId) ?? []) {
      if (b.t > t) break;
      const d = (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best ?? { x, y };
  };

  const units = new Map<number, UnitPath>();
  for (const cmd of commands) {
    for (let i = 0; i < cmd.ids.length; i++) {
      const id = cmd.ids[i];
      if (!(id > 0)) continue;
      let u = units.get(id);
      if (!u) {
        const origin = nearestOwnBuilding(cmd.playerId, cmd.t, cmd.x, cmd.y);
        u = {
          id,
          playerId: cmd.playerId,
          spawnT: cmd.t,
          military: cmd.militaryTarget,
          path: [{ t0: cmd.t, x0: origin.x, y0: origin.y, x1: origin.x, y1: origin.y, speed: SPEED_VILLAGER }],
        };
        units.set(id, u);
      }
      if (cmd.militaryTarget && !u.military) u.military = true;
      // Órdenes en el mismo instante se reemplazan entre sí (click doble).
      while (u.path.length > 1 && u.path[u.path.length - 1].t0 >= cmd.t) u.path.pop();
      const from = unitPositionAt(u, cmd.t);
      const [ox, oy] = formationOffset(i);
      const [jx, jy] = unitJitter(id);
      u.path.push({
        t0: cmd.t,
        x0: from.x,
        y0: from.y,
        x1: cmd.x + ox + jx,
        y1: cmd.y + oy + jy,
        speed: u.military ? SPEED_MILITARY : SPEED_VILLAGER,
      });
    }
  }
  return units;
}

/**
 * Frame de animación para una lista cíclica: `period` ms por frame. Igual que
 * el #cycle del visor de referencia.
 */
export function animFrame(frames: number, t: number, period: number): number {
  return Math.floor(t / period) % frames;
}
