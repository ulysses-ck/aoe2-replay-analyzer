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
import { parseRecording } from "agelens";

/** Ids de acción de AoE2 DE que usamos. */
const ACTION_BUILD = 102;
const ACTION_MOVE = 3;
const ACTION_INTERACT = 0;

/** Cabecera del registro de acción: player u8, largo u16, y después el payload. */
const ACTION_PREFIX = 3;

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
      if (b) buildings.push({ t, playerId: Number(data.Build.player_id), ...b });
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
    }
  }

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
      buildings.push({ t: clock, playerId, x, y, typeId: dv.getUint32(12, true), objectId: 0 });
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
    } else if (op.actionId === ACTION_MOVE) {
      const x = dv.getFloat32(4, true);
      const y = dv.getFloat32(8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      moves.push({ t: clock, playerId, x, y, count: 0 });
    }
  }

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
    highlights: detectHighlights({
      players,
      buildings,
      moves,
      interactions,
      durationMs: clock,
    }),
  };
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
    try {
      return { ok: true, model: parseWithAoe2rec(buffer, fileName) };
    } catch (error) {
      // El trap de WASM no dice mucho; queda como intento fallido.
      const primary = error instanceof Error ? error.message : String(error);
      try {
        const recording = await parseRecording(new Uint8Array(buffer));
        return { ok: true, model: parseWithAgelens(recording, fileName), fallbackReason: primary };
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
