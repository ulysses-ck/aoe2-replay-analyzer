import { parse_rec, parse_rec_summary } from "aoe2rec-js";

import type {
  BuildingEvent,
  ChatMessage,
  MoveEvent,
  Player,
  ReplayModel,
} from "./types";

/**
 * Parseo de un `.aoe2record` (DE) a un modelo compacto para la UI.
 *
 * `aoe2rec-js` expone el stream de operaciones sin tipar, así que las formas de
 * abajo se decodifican a mano. Los offsets de `Build` están documentados en
 * `docs/FORMAT.md` y se validaron contra un replay real (build 188329).
 */

type RawOp = Record<string, any>;

function bytesOf(data: unknown): Uint8Array | null {
  if (!Array.isArray(data)) return null;
  return Uint8Array.from(data as number[]);
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `Build` guarda sus campos en binario plano. */
function decodeBuild(data: unknown) {
  const d = bytesOf(data);
  if (!d || d.length < 32) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const x = dv.getFloat32(4, true);
  const y = dv.getFloat32(8, true);
  const typeId = dv.getUint32(12, true);
  const objectId = dv.getUint32(d.byteLength - 4, true);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || y < 0) return null;
  return { x, y, typeId, objectId };
}

export function parseReplay(buffer: ArrayBuffer, fileName: string): ReplayModel {
  // 1) Cabecera y jugadores (el resumen es mucho más barato que el stream).
  const summary = parse_rec_summary(buffer);
  const header = summary.header;
  const settings = header.game_settings;

  const players: Player[] = [];
  const teams = Array.from(summary.teams as unknown as any[]);
  teams.forEach((team, teamIndex) => {
    for (const p of Array.from(team.players as any[])) {
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

  // 2) Stream de operaciones.
  const rec = parse_rec(buffer);
  const ops: RawOp[] = rec?.chapters?.[0]?.operations ?? [];

  const buildings: BuildingEvent[] = [];
  const moves: MoveEvent[] = [];
  const chat: ChatMessage[] = [];

  let clock = 0;
  for (const op of ops) {
    if (!op) continue;

    // Sync sólo transporta tiempo: se acumula para los op que no lo traen.
    if (op.Sync) {
      clock += Number(op.Sync.time_increment) || 0;
      continue;
    }

    if (op.Chat) {
      const parsed = safeJson(String(op.Chat.text ?? ""));
      const raw = parsed?.message;
      if (typeof raw === "string" && raw.length > 0) {
        // Los mensajes del juego vienen como `<player_id,3,1> ha avanzado a la Edad X.`
        const system = raw.startsWith("<player_id");
        const tag = system ? /^<player_id,(\d+),\d+>\s*/.exec(raw) : null;
        const text = tag ? raw.slice(tag[0].length) : raw;
        chat.push({
          t: clock,
          playerId: Number(tag?.[1] ?? parsed.player ?? 0),
          text,
          system,
        });
      }
      continue;
    }

    const action = op.Action;
    if (!action?.action_data) continue;

    const t = Number(action.world_time) || clock;
    const data = action.action_data;

    if (data.Build) {
      const b = decodeBuild(data.Build.data);
      if (b) {
        buildings.push({ t, playerId: Number(data.Build.player_id), ...b });
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
    },
    players,
    buildings,
    moves,
    chat,
  };
}
