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
      });
    }
  });
  players.sort((a, b) => a.id - b.id);

  const rec = parse_rec(buffer);
  const ops = rec?.chapters?.[0]?.operations ?? [];

  const buildings = [];
  const moves = [];
  const chat = [];
  let clock = 0;

  for (const op of ops) {
    if (!op) continue;

    if (op.Sync) {
      clock += Number(op.Sync.time_increment) || 0;
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

  // `operations` viene en orden de archivo: los Sync traen el incremento de
  // tiempo y las acciones heredan el reloj acumulado.
  let clock = 0;
  for (const op of recording.operations ?? []) {
    const payload = op.payload ?? {};

    if (typeof payload.increment === "number") {
      clock += payload.increment;
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
  };
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
