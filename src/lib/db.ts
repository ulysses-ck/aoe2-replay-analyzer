/**
 * Índice de replays en SQLite (`node:sqlite`, incluido en Node 22+).
 *
 * La DB guarda sólo metadata para el listado (`/api/replays`); el modelo
 * parseado y el `.aoe2record` original viven en el storage adapter. Si la DB
 * se borra, se puede reconstruir re-parseando: los ids son hashes del archivo.
 *
 * Lazy a propósito: sólo abre al usar una ruta del backend. El front de
 * Vercel nunca la toca (las rutas del propio front quedan sin DB).
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export type ReplayRow = {
  id: string;
  fileName: string;
  fileSize: number;
  durationMs: number;
  playerCount: number;
  engine: string;
  parseMs: number;
  createdAt: string;
};

let instance: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (instance) return instance;
  const file =
    process.env.REPLAY_DB_PATH || path.join(process.cwd(), ".cache", "replays.db");
  instance = new DatabaseSync(file);
  instance.exec(`
    CREATE TABLE IF NOT EXISTS replays (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      player_count INTEGER NOT NULL,
      engine TEXT NOT NULL,
      parse_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
  return instance;
}

/** Inserta o reemplaza (el id es el hash del contenido: subir dos veces el
 *  mismo replay refresca la fila en vez de duplicarla). */
export function upsertReplay(row: ReplayRow): void {
  db().prepare(
    `INSERT INTO replays (id, file_name, file_size, duration_ms, player_count, engine, parse_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       file_name = excluded.file_name,
       file_size = excluded.file_size,
       duration_ms = excluded.duration_ms,
       player_count = excluded.player_count,
       engine = excluded.engine,
       parse_ms = excluded.parse_ms,
       created_at = excluded.created_at`,
  ).run(row.id, row.fileName, row.fileSize, row.durationMs, row.playerCount, row.engine, row.parseMs, row.createdAt);
}

export function getReplayRow(id: string): ReplayRow | null {
  const row = db().prepare(
    "SELECT id, file_name, file_size, duration_ms, player_count, engine, parse_ms, created_at FROM replays WHERE id = ?",
  ).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    fileName: String(row.file_name),
    fileSize: Number(row.file_size),
    durationMs: Number(row.duration_ms),
    playerCount: Number(row.player_count),
    engine: String(row.engine),
    parseMs: Number(row.parse_ms),
    createdAt: String(row.created_at),
  };
}

export function listReplays(limit = 200): ReplayRow[] {
  const rows = db().prepare(
    "SELECT id, file_name, file_size, duration_ms, player_count, engine, parse_ms, created_at FROM replays ORDER BY created_at DESC LIMIT ?",
  ).all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    fileName: String(row.file_name),
    fileSize: Number(row.file_size),
    durationMs: Number(row.duration_ms),
    playerCount: Number(row.player_count),
    engine: String(row.engine),
    parseMs: Number(row.parse_ms),
    createdAt: String(row.created_at),
  }));
}
