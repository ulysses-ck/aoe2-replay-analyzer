/**
 * Parser de replays, ejecutado en un worker thread.
 *
 * Dos motivos para aislarlo:
 *
 * 1. `aoe2rec-js` es WASM y en algunos replays del mismo build del juego muere
 *    con un trap (`RuntimeError: unreachable`). En el hilo principal eso tira
 *    abajo el server; acá se atrapa y se cae al plan B.
 * 2. Parsear 500k operaciones bloquea el event loop ~1.4 s. En un worker no
 *    frena el resto de los requests.
 *
 * Estrategia: `aoe2rec-js` primero (más rápido y trae `unit_ids`), y si revienta
 * `agelens` (JS puro, sin WASM) como fallback.
 */
import { parentPort, workerData } from "node:worker_threads";

import { parse_rec, parse_rec_summary } from "aoe2rec-js";
import { parseHeader, parseRecording } from "agelens";

/** Ids de acción de AoE2 DE que usamos. */
const ACTION_BUILD = 102;
const ACTION_MOVE = 3;
const ACTION_INTERACT = 0;

/** Cabecera del registro de acción: player u8, largo u16, y después el payload. */
const ACTION_PREFIX = 3;

/** Ids de acción de AoE2 DE para el análisis de fases y build order. */
const ACTION_RESEARCH = 101;
const ACTION_DE_QUEUE = 129;

/** Tecnologías de avance de edad (dataset clásico, confirmado con mgz-fast). */
const AGE_TECH = { 101: 101, 102: 102, 103: 103 };

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Los mensajes del juego llegan como `<player_id,3,1> ha avanzado a la Edad X.` */
function normalizeChat(text, fallbackPlayer) {
  const system = text.startsWith("<player_id");
  const tag = system ? /^<player_id,(\d+),-?\d+>\s*/.exec(text) : null;
  return {
    playerId: Number(tag?.[1] ?? fallbackPlayer ?? 0),
    text: tag ? text.slice(tag[0].length) : text,
    system,
  };
}

function bytesOf(data) {
  if (!Array.isArray(data)) return null;
  return Uint8Array.from(data);
}

/** Tolerancia de tiles para decidir que la cámara no se movió. */
const VIEW_EPSILON = 0.01;

/**
 * Comprime la serie de cámara: cada Sync trae una muestra, pero entre dos
 * órdenes el valor se repite y no aporta nada. Igual buscamos el valor en el
 * instante exacto, así que sólo conservamos cuando cambia de verdad.
 */
function pushView(out, t, x, y) {
  const last = out[out.length - 1];
  if (last && Math.abs(last[1] - x) < VIEW_EPSILON && Math.abs(last[2] - y) < VIEW_EPSILON) {
    return;
  }
  out.push([Math.round(t), Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

/**
 * Dueño de la grabación.
 *
 * Hay dos pistas y conviene entender las dos:
 *
 * - `Pregame.rec_owner` es un **slot de 8** (1..8), no un `player_number`. Sirve
 *   para replays de un solo jugador o con huecos en la lista, pero en un 3v3
 *   multiplayer el slot no coincide con el `player_number`.
 * - `Viewlock.player_id` sí es el `player_number` real (1..8) de quien graba, y
 *   es el que cruza con la lista de jugadores del resumen. Lo usamos como fuente
 *   principal y dejamos `rec_owner` sólo para el caso de un jugador.
 */
function ownerIdFromOps(ops) {
  let recOwner = 0;
  let viewPlayer = 0;
  for (const op of ops) {
    const pregame = op?.Pregame;
    if (pregame) {
      const slot = Number(pregame.rec_owner);
      recOwner = Number.isFinite(slot) && slot > 0 && slot <= 8 ? slot : 0;
    }
    if (op?.Viewlock) {
      const id = Number(op.Viewlock.player_id);
      if (Number.isFinite(id) && id > 0) viewPlayer = id;
      if (recOwner && viewPlayer) break;
    }
    if (recOwner && viewPlayer) break;
  }
  return viewPlayer || recOwner;
}

// ─────────────────────────── vía aoe2rec-js ───────────────────────────

function decodeBuild(data) {
  const d = bytesOf(data);
  if (!d || d.length < 32) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const x = dv.getFloat32(4, true);
  const y = dv.getFloat32(8, true);
  const typeId = dv.getUint32(12, true);
  const objectId = dv.getUint32(d.byteLength - 4, true);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
  return { x, y, typeId, objectId };
}

function inferStartingTownCenters({ players, buildings, moves, interactions, viewlocks }) {
  const result = [];
  const existingTCs = buildings.filter((b) => b.typeId === 109 || b.typeId === 621 || b.typeId === 71);
  const initialView = viewlocks?.[0];

  for (const player of players) {
    const hasEarlyTC = existingTCs.some((b) => b.playerId === player.id && b.t < 300_000);
    if (hasEarlyTC) continue;

    const points = [];
    if (player.owner && initialView) {
      points.push({ x: initialView[1], y: initialView[2], weight: 6.0 });
    }
    const earlyInteractions = (interactions ?? []).filter((i) => i.playerId === player.id && i.t < 60_000);
    for (const inter of earlyInteractions) points.push({ x: inter.x, y: inter.y, weight: 2.5 });

    const earlyBuildings = buildings.filter((b) => b.playerId === player.id && b.t < 60_000);
    for (const b of earlyBuildings) points.push({ x: b.x, y: b.y, weight: 2.0 });

    const earlyMoves = moves.filter((m) => m.playerId === player.id && m.t < 40_000).slice(0, 8);
    for (const m of earlyMoves) points.push({ x: m.x, y: m.y, weight: 1.0 });

    if (points.length === 0) {
      const anyInteractions = (interactions ?? []).filter((i) => i.playerId === player.id).slice(0, 3);
      for (const inter of anyInteractions) points.push({ x: inter.x, y: inter.y, weight: 2.0 });
      const anyBuildings = buildings.filter((b) => b.playerId === player.id).slice(0, 2);
      for (const b of anyBuildings) points.push({ x: b.x, y: b.y, weight: 2.0 });
      const anyMoves = moves.filter((m) => m.playerId === player.id).slice(0, 5);
      for (const m of anyMoves) points.push({ x: m.x, y: m.y, weight: 1.0 });
    }

    if (points.length > 0) {
      const totalWeight = points.reduce((acc, p) => acc + p.weight, 0);
      const avgX = points.reduce((acc, p) => acc + p.x * p.weight, 0) / totalWeight;
      const avgY = points.reduce((acc, p) => acc + p.y * p.weight, 0) / totalWeight;
      result.push({
        t: 0,
        playerId: player.id,
        x: Math.round(avgX),
        y: Math.round(avgY),
        typeId: 109,
        objectId: 0,
      });
    }
  }
  return result;
}

function parseWithAoe2rec(buffer, fileName) {
  const summary = parse_rec_summary(buffer);
  const header = summary.header;
  const settings = header.game_settings;

  // El dueño de la grabación (slot 1..8 en `rec_owner`) es el que vamos a seguir.
  const rec = parse_rec(buffer);
  const ops = rec?.chapters?.[0]?.operations ?? [];
  const ownerId = ownerIdFromOps(ops);

  const players = [];
  const teams = Array.from(summary.teams ?? []);
  teams.forEach((team, teamIndex) => {
    for (const p of Array.from(team.players ?? [])) {
      players.push({
        id: Number(p.player_number),
        name: String(p.name),
        civId: Number(p.civ_id),
        colorId: Number(p.color_id),
        team: teamIndex + 1,
        winner: Boolean(team.winner),
        // El dueño de la grabación es el único cuya cámara está en los viewlocks.
        owner: Number(p.player_number) === ownerId,
      });
    }
  });
  players.sort((a, b) => a.id - b.id);
  // Un solo jugador: `rec_owner` alcanza cuando no hay viewlocks que consultar.
  if (!ownerId && players.length === 1) players[0].owner = true;

  const buildings = [];
  const moves = [];
  const chat = [];
  const viewlocks = [];
  const interactions = [];
  const ageUps = [];
  const production = [];
  const researches = [];
  const buildingDamage = [];
  // objectId → edificio (para cruzar ataques y demoliciones con su BUILD).
  const buildingByOid = new Map();
  let clock = 0;

  for (const op of ops) {
    if (!op) continue;

    if (op.Sync) {
      clock += Number(op.Sync.time_increment) || 0;
      continue;
    }

    if (op.Viewlock) {
      const v = op.Viewlock;
      const x = Number(v.x);
      const y = Number(v.y);
      if (Number.isFinite(x) && Number.isFinite(y)) pushView(viewlocks, clock, x, y);
      continue;
    }

    if (op.Chat) {
      const parsed = safeJson(String(op.Chat.text ?? ""));
      const message = parsed?.message;
      if (typeof message === "string" && message.length > 0) {
        chat.push({ t: clock, ...normalizeChat(message, parsed.player) });
      }
      continue;
    }

    const action = op.Action;
    if (!action?.action_data) continue;

    const t = Number(action.world_time) || clock;
    const data = action.action_data;

    if (data.Build) {
      const b = decodeBuild(data.Build.data);
      const buildPlayerId = Number(data.Build.player_id);
      if (b) {
        buildings.push({ t, playerId: buildPlayerId, ...b });
        if (b.objectId > 0) {
          buildingByOid.set(b.objectId, {
            x: b.x,
            y: b.y,
            typeId: b.typeId,
            playerId: buildPlayerId,
          });
        }
      }
    } else if (data.Interact) {
      const i = data.Interact;
      const x = Number(i.x);
      const y = Number(i.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        interactions.push({
          t,
          playerId: Number(i.player_id),
          x,
          y,
          targetId: Number(i.target_id),
          count: Array.isArray(i.unit_ids) ? i.unit_ids.length : 0,
        });
        const target = buildingByOid.get(Number(i.target_id));
        // Fuego: la orden apunta a un edificio que no es del atacante. Si el
        // objectId no está en el mapa (unidad o edificio previo al parseo) no
        // hay posición conocida y no lo reportamos.
        if (target && target.playerId !== Number(i.player_id)) {
          buildingDamage.push({
            t,
            playerId: Number(i.player_id),
            ownerId: target.playerId,
            x: target.x,
            y: target.y,
            typeId: target.typeId,
            objectId: Number(i.target_id),
            kind: "attacked",
          });
        }
      }
    } else if (data.Delete) {
      // Auto-demolición: data son u32s con el objectId borrado.
      const d = bytesOf(data.Delete.data);
      if (d && d.length % 4 === 0) {
        const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
        for (let i = 0; i + 4 <= d.length; i += 4) {
          const target = buildingByOid.get(dv.getUint32(i, true));
          if (target) {
            buildingDamage.push({
              t,
              playerId: target.playerId,
              ownerId: target.playerId,
              x: target.x,
              y: target.y,
              typeId: target.typeId,
              objectId: dv.getUint32(i, true),
              kind: "deleted",
            });
          }
        }
      }
    } else if (data.Move) {
      const m = data.Move;
      const x = Number(m.x);
      const y = Number(m.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        moves.push({
          t,
          playerId: Number(m.player_id),
          x,
          y,
          count: Array.isArray(m.unit_ids) ? m.unit_ids.length : 0,
        });
      }
    } else if (data.Research) {
      // Avance de edad / investigación: technology_type es el id del dataset
      // clásico (101 feudal, 102 castillo, 103 imperial). El build 57257
      // (nov 2026) dejó de mandar esta acción; esos replays quedan sin eras.
      const r = data.Research;
      const techId = Number(r.technology_type);
      const playerId = Number(r.player_id);
      if (Number.isFinite(techId) && techId > 0 && Number.isFinite(playerId)) {
        researches.push({ t, playerId, techId });
        if (AGE_TECH[techId]) ageUps.push({ playerId, age: techId, t });
      }
    } else if (data.DeQueue) {
      // Unidad que terminó de entrenarse (o lote). `unit_id` es del dataset
      // clásico: 83=villager, 74=militia, 4=archer, 38=explorador, …
      const q = data.DeQueue;
      const unitId = Number(q.unit_id);
      const amount = Number(q.amount);
      const playerId = Number(q.player_id);
      if (unitId > 0 && amount > 0 && Number.isFinite(playerId)) {
        production.push({ t, playerId, unitId, amount });
      }
    }
  }

  const startingTCs = inferStartingTownCenters({ players, buildings, moves, interactions, viewlocks });
  if (startingTCs.length > 0) buildings.unshift(...startingTCs);

  return {
    meta: {
      fileName,
      build: Number(header.build),
      mapSize: Number(settings.map_size),
      durationMs: Number(summary.duration),
      playerCount: players.length,
      engine: "aoe2rec",
    },
    players,
    buildings,
    moves,
    chat,
    viewlocks,
    interactions,
    ageUps,
    production,
    researches,
    buildingDamage,
    highlights: detectHighlights({
      players,
      buildings,
      moves,
      interactions,
      durationMs: Number(summary.duration),
    }),
  };
}

// ─────────────────────────── vía agelens ───────────────────────────

function parseWithAgelens(recording, fileName) {
  const players = (recording.players ?? [])
    .filter((p) => Number(p.number) > 0 && Number(p.type) !== 1)
    .map((p) => ({
      id: Number(p.number),
      name: String(p.name ?? `P${p.number}`),
      civId: Number(p.civilizationId),
      colorId: Number(p.colorId),
      team: Number(p.teamId),
      // agelens no expone ganador en la cabecera.
      winner: false,
    }))
    .sort((a, b) => a.id - b.id);

  const mapSize = Number(recording.map?.dimension) || 0;
  const buildings = [];
  const moves = [];
  const chat = [];
  const viewlocks = [];
  const interactions = [];
  const ageUps = [];
  const production = [];
  const researches = [];
  const buildingDamage = [];
  const buildingByOid = new Map();

  // `operations` viene en orden de archivo: los Sync traen el incremento de
  // tiempo y las acciones heredan el reloj acumulado.
  let clock = 0;
  for (const op of recording.operations ?? []) {
    const payload = op.payload ?? {};

    if (typeof payload.increment === "number") {
      clock += payload.increment;
      continue;
    }

    // id 3 = VIEWLOCK: el centro de cámara, dos float32.
    if (op.id === 3) {
      const x = Number(payload.x);
      const y = Number(payload.y);
      if (Number.isFinite(x) && Number.isFinite(y)) pushView(viewlocks, clock, x, y);
      continue;
    }

    if (typeof payload.message === "string") {
      const parsed = safeJson(payload.message);
      if (typeof parsed?.message === "string" && parsed.message.length > 0) {
        chat.push({ t: clock, ...normalizeChat(parsed.message, parsed.player) });
      }
      continue;
    }

    if (op.actionId === undefined || typeof payload.raw?.data !== "string") continue;

    const bytes = Buffer.from(payload.raw.data, "hex");
    if (bytes.length <= ACTION_PREFIX) continue;

    const dv = new DataView(bytes.buffer, bytes.byteOffset + ACTION_PREFIX, bytes.length - ACTION_PREFIX);
    const playerId = bytes[0];

    if (op.actionId === ACTION_BUILD) {
      const x = dv.getFloat32(4, true);
      const y = dv.getFloat32(8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) continue;
      const typeId = dv.getUint32(12, true);
      const objectId = dv.byteLength >= 4 ? dv.getUint32(dv.byteLength - 4, true) : 0;
      buildings.push({ t: clock, playerId, x, y, typeId, objectId });
      if (objectId > 0) {
        buildingByOid.set(objectId, { x, y, typeId, playerId });
      }
    } else if (op.actionId === ACTION_INTERACT) {
      // target_id u32, x f32, y f32 (relativos al prefijo); las unidades van a
      // partir del byte 20 del payload y el largo real viene en bytes[1..2].
      const x = dv.getFloat32(4, true);
      const y = dv.getFloat32(8, true);
      const actionLength = bytes[1] | (bytes[2] << 8);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      interactions.push({
        t: clock,
        playerId,
        x,
        y,
        targetId: dv.getUint32(0, true),
        count: Math.max(0, Math.floor((actionLength - 20) / 4)),
      });
      const target = buildingByOid.get(dv.getUint32(0, true));
      if (target && target.playerId !== playerId) {
        buildingDamage.push({
          t: clock,
          playerId,
          ownerId: target.playerId,
          x: target.x,
          y: target.y,
          typeId: target.typeId,
          objectId: dv.getUint32(0, true),
          kind: "attacked",
        });
      }
    } else if (op.actionId === 106) {
      // Auto-demolición: object_id u32 al inicio del payload.
      if (dv.byteLength >= 4) {
        const target = buildingByOid.get(dv.getUint32(0, true));
        if (target) {
          buildingDamage.push({
            t: clock,
            playerId: target.playerId,
            ownerId: target.playerId,
            x: target.x,
            y: target.y,
            typeId: target.typeId,
            objectId: dv.getUint32(0, true),
            kind: "deleted",
          });
        }
      }
    } else if (op.actionId === ACTION_MOVE) {
      const x = dv.getFloat32(4, true);
      const y = dv.getFloat32(8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      moves.push({ t: clock, playerId, x, y, count: 0 });
    } else if (op.actionId === ACTION_RESEARCH) {
      // Layout validado contra mgz-fast (replay 48987, 61 researches idénticos):
      // building_id u32, selected i16, technology_id i16 (relativos al prefijo).
      const techId = dv.getInt16(6, true);
      if (techId > 0) {
        researches.push({ t: clock, playerId, techId });
        if (AGE_TECH[techId]) ageUps.push({ playerId, age: techId, t: clock });
      }
    } else if (op.actionId === ACTION_DE_QUEUE) {
      // Layout validado por sondeo: selected i16, 4x, building_type i16,
      // unit_id i16, amount i16 (relativos al prefijo).
      const unitId = dv.getInt16(8, true);
      const amount = dv.getInt16(10, true);
      if (unitId > 0 && amount > 0) {
        production.push({ t: clock, playerId, unitId, amount });
      }
    }
  }

  const startingTCs = inferStartingTownCenters({ players, buildings, moves, interactions, viewlocks });
  if (startingTCs.length > 0) buildings.unshift(...startingTCs);

  return {
    meta: {
      fileName,
      build: 0,
      mapSize,
      durationMs: clock,
      playerCount: players.length,
      engine: "agelens",
    },
    players,
    buildings,
    moves,
    chat,
    viewlocks,
    interactions,
    ageUps,
    production,
    researches,
    buildingDamage,
    highlights: detectHighlights({
      players,
      buildings,
      moves,
      interactions,
      durationMs: clock,
    }),
  };
}

// ─────────────────────────── terreno ───────────────────────────

/**
 * Tiles del mapa desde la cabecera de agelens.
 *
 * Se corre concurrente con el parse principal (parseHeader sólo lee la
 * cabecera, ~1.5-5 s) así el terreno está disponible en ambos motores. La
 * orientación está verificada empíricamente contra los edificios del body
 * (`scripts/probe-tile-order3.mjs`): el índice es `y * dimension + x`, sin flip
 * — las hipótesis alternativas caen un 25-28% de edificios sobre agua/bosque
 * contra ~12% con ésta (el resto son docks y tala posterior al inicio).
 */
async function extractTerrain(buffer) {
  const header = await parseHeader(new Uint8Array(buffer));
  const tiles = header?.map?.tiles;
  if (!Array.isArray(tiles) || tiles.length === 0) return undefined;
  const dimension = Number(header.map.dimension) || 0;
  if (!dimension) return undefined;
  const terrain = new Array(tiles.length);
  const elevation = new Array(tiles.length);
  for (let i = 0; i < tiles.length; i += 1) {
    terrain[i] = tiles[i].terrain | 0;
    elevation[i] = tiles[i].elevation | 0;
  }
  return { dimension, terrain, elevation };
}

/** Terreno directo del recording de agelens (mismo formato que parseHeader). */
function terrainFromRecording(recording) {
  const tiles = recording?.map?.tiles;
  if (!Array.isArray(tiles) || tiles.length === 0) return undefined;
  const dimension = Number(recording.map.dimension) || 0;
  if (!dimension) return undefined;
  const terrain = new Array(tiles.length);
  const elevation = new Array(tiles.length);
  for (let i = 0; i < tiles.length; i += 1) {
    terrain[i] = tiles[i].terrain | 0;
    elevation[i] = tiles[i].elevation | 0;
  }
  return { dimension, terrain, elevation };
}

// ─────────────────────────── detección de highlights ───────────────────────────

/**
 * Batallas, raids y picos de APM, deducidos de las órdenes del replay.
 *
 * No hay estado de combate en el archivo: lo que hay son órdenes. La heurística
 * es conservadora a propósito — un highlight falso es peor que ninguno:
 *
 * - Batalla: dos jugadores de equipos distintos que ordenan ataques a menos de
 *   14 tiles entre sí dentro de una ventana de 30 s. Los choques vecinos se
 *   fusionan en un solo highlight (los grupos grandes son un solo evento).
 * - Raid: lo mismo, pero con edificios enemigos a menos de 12 tiles del choque.
 * - Pico de APM: el minuto con más acciones de cada jugador, sólo si duplica su
 *   mediana y pasa las 30 acciones — el "apretó todo" típico de los raids.
 */
function detectHighlights({ players, buildings, moves, interactions, durationMs }) {
  const highlights = [];
  const teamOf = new Map(players.map((p) => [p.id, p.team ?? 0]));
  if (teamOf.size > 0 && new Set(teamOf.values()).size > 1) {
    const WINDOW = 30_000;
    const RADIUS = 14;
    const sorted = [...interactions].sort((a, b) => a.t - b.t);

    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i];
      const teamA = teamOf.get(a.playerId) ?? 0;
      if (!teamA) continue;

      for (let j = i + 1; j < sorted.length; j += 1) {
        const b = sorted[j];
        if (b.t - a.t > WINDOW) break;
        const teamB = teamOf.get(b.playerId) ?? 0;
        if (!teamB || teamB === teamA) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) > RADIUS) continue;

        const t = Math.min(a.t, b.t);
        const x = (a.x + b.x) / 2;
        const y = (a.y + b.y) / 2;

        // Fusión: un choque cercano en el tiempo es el mismo combate.
        const near = highlights.find(
          (h) =>
            (h.kind === "battle" || h.kind === "raid") &&
            Math.abs(h.t - t) < WINDOW &&
            Math.hypot(h.x - x, h.y - y) < RADIUS,
        );
        if (near) {
          near.players = [...new Set([...near.players, a.playerId, b.playerId])];
          continue;
        }

        const isRaid = buildings.some((building) => {
          const buildingTeam = teamOf.get(building.playerId) ?? 0;
          return (
            buildingTeam !== 0 &&
            buildingTeam !== teamA &&
            Math.hypot(building.x - x, building.y - y) < 12
          );
        });
        highlights.push({
          kind: isRaid ? "raid" : "battle",
          t,
          x,
          y,
          players: [...new Set([a.playerId, b.playerId])].sort((m, n) => m - n),
        });
      }
    }
  }

  // ── picos de APM ──
  const perMinute = new Map();
  const bump = (t, playerId) => {
    if (!perMinute.has(playerId)) perMinute.set(playerId, []);
    const minute = Math.max(0, Math.floor(t / 60_000));
    const counts = perMinute.get(playerId);
    counts[minute] = (counts[minute] ?? 0) + 1;
  };
  for (const move of moves) bump(move.t, move.playerId);
  for (const building of buildings) bump(building.t, building.playerId);
  for (const interaction of interactions) bump(interaction.t, interaction.playerId);

  for (const [playerId, counts] of perMinute) {
    const active = counts.filter((value) => value > 0).sort((a, b) => a - b);
    if (active.length < 4) continue;
    const median = active[Math.floor(active.length / 2)];
    let bestMinute = -1;
    let best = 0;
    counts.forEach((value, minute) => {
      if (value >= median * 2 && value >= 30 && value > best) {
        best = value;
        bestMinute = minute;
      }
    });
    if (bestMinute >= 0) {
      highlights.push({ kind: "apm", t: bestMinute * 60_000 + 30_000, playerId, apm: best });
    }
  }

  // Sin hora de fin es raro, pero por si el resumen no la trae.
  const limit = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : Number.MAX_SAFE_INTEGER;
  return highlights
    .filter((h) => h.t <= limit)
    .sort((a, b) => a.t - b.t)
    .slice(0, 60);
}

// ─────────────────────────── ejecución ───────────────────────────

async function run() {
  const { buffer, fileName } = workerData;

  // El panic hook de Rust escupe un backtrace enorme directo a stderr en cada
  // replay que no puede decodificar. Es esperable y ensucia los logs del server.
  // El worker está aislado, así que tapar stderr acá no afecta al proceso padre.
  const realConsoleError = console.error;
  const realStderrWrite = process.stderr.write.bind(process.stderr);
  console.error = () => {};
  process.stderr.write = () => true;

  try {
    // El terreno se parsea concurrente con el motor principal: sólo lee la
    // cabecera y no depende de si aoe2rec revienta o no.
    const terrainPromise = extractTerrain(buffer).catch(() => undefined);
    try {
      const model = parseWithAoe2rec(buffer, fileName);
      model.terrain = await terrainPromise;
      return { ok: true, model };
    } catch (error) {
      // El trap de WASM no dice mucho; queda como intento fallido.
      const primary = error instanceof Error ? error.message : String(error);
      try {
        const recording = await parseRecording(new Uint8Array(buffer));
        const model = parseWithAgelens(recording, fileName);
        model.terrain = terrainFromRecording(recording) ?? (await terrainPromise);
        return { ok: true, model, fallbackReason: primary };
      } catch (fallbackError) {
        return {
          ok: false,
          code: "unsupported",
          message: primary,
          fallback: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        };
      }
    }
  } finally {
    console.error = realConsoleError;
    process.stderr.write = realStderrWrite;
  }
}

const result = await run();
parentPort.postMessage(result);
