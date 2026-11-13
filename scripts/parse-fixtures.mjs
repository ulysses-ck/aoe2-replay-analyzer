/**
 * Corre el parser sobre un lote de replays y reporta qué motor resolvió cada uno.
 * Sirve para medir cobertura real cuando aparece un archivo que rompe.
 *
 * Uso:
 *   node scripts/parse-fixtures.mjs <carpeta-o-archivo> [...]
 *
 * Corre el mismo worker que usa la API, así que si esto anda, la app anda.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { Worker } from "node:worker_threads";

const WORKER = join(process.cwd(), "workers", "parse-replay.mjs");

function collect(target) {
  const info = statSync(target);
  if (info.isFile()) return [target];
  return readdirSync(target)
    .filter((name) => name.endsWith(".aoe2record") || name.endsWith(".mgz"))
    .map((name) => join(target, name));
}

function runWorker(file) {
  return new Promise((resolve) => {
    const buffer = readFileSync(file);
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const worker = new Worker(WORKER, {
      workerData: { buffer: ab, fileName: basename(file) },
      transferList: [ab],
    });
    const started = Date.now();
    worker.once("message", (result) => {
      worker.terminate();
      resolve({ file, ms: Date.now() - started, result });
    });
    worker.once("error", (error) => {
      resolve({ file, ms: Date.now() - started, result: { ok: false, message: error.message } });
    });
  });
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("Uso: node scripts/parse-fixtures.mjs <carpeta-o-archivo> [...]");
  process.exit(1);
}

const files = targets.flatMap(collect).sort();
const stats = { ok: 0, fallback: 0, fail: 0 };

console.log(`${files.length} archivo(s)\n`);
for (const file of files) {
  const { ms, result } = await runWorker(file);
  const size = (statSync(file).size / 1048576).toFixed(1);
  if (result.ok) {
    const { meta, buildings, moves, chat, players } = result.model;
    const engine = meta.engine ?? "?";
    if (engine === "aoe2rec") stats.ok += 1;
    else stats.fallback += 1;
    console.log(
      `${engine === "aoe2rec" ? "✓" : "↺"} ${basename(file).slice(0, 46).padEnd(46)} ` +
        `${size.padStart(5)} MB  ${String(ms).padStart(5)} ms  ${engine.padEnd(7)}  ` +
        `${(meta.durationMs / 60000).toFixed(0).padStart(3)} min  mapa ${String(meta.mapSize).padStart(3)}  ` +
        `${players.length}p  ${buildings.length} edif  ${moves.length} mov  ${chat.length} chat`,
    );
  } else {
    stats.fail += 1;
    console.log(`✗ ${basename(file).slice(0, 46).padEnd(46)} ${size.padStart(5)} MB  ${String(ms).padStart(5)} ms  FALLA`);
    console.log(`    ${String(result.message).slice(0, 110)}`);
  }
}

console.log(
  `\ntotal: ${files.length} | aoe2rec ${stats.ok} | agelens ${stats.fallback} | falla ${stats.fail}`,
);
