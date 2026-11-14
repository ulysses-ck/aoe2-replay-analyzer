/**
 * Histograma de typeId de edificios construidos (acción BUILD del body).
 *
 * Objetivo: validar la tabla typeId → tipo de edificio contra los IDs
 * clásicos de AoE2 (casa 70, granja 50, TC 109, castillo 82, ...). Uso:
 *   node scripts/probe-building-types.mjs <replay1> [replay2 ...]
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Los mismos del worker (verificados en scripts/probe-actions.mjs).
const ACTION_BUILD = 102;
const ACTION_PREFIX = 3;

// IDs clásicos de AoE2 (dataset conq/genie — los que usa aoe2.gg).
const KNOWN = {
  70: "house",
  50: "farm",
  68: "mill",
  584: "lumber-camp",
  585: "mining-camp",
  109: "town-center",
  12: "barracks",
  87: "archery-range",
  101: "stable",
  103: "blacksmith",
  86: "siege-workshop",
  104: "university",
  82: "castle",
  84: "watch-tower",
  23416: "bombard-tower",
  276: "gate",
  487: "palisade-gate",
  155: "outpost",
  476: "krepost",
  1254: "donjon",
  1517: "feitoria",
};

async function buildingTypeIds(file) {
  const buf = readFileSync(file);
  const agelens = await import("agelens");
  // parseRecording espera una vista Uint8Array (un Buffer suelto devuelve un
  // recording vacío, silenciosamente).
  const recording = await agelens.parseRecording(new Uint8Array(buf));
  const counts = new Map();
  for (const op of recording.operations ?? []) {
    const payload = op.payload ?? {};
    if (typeof payload.increment === "number") continue;
    if (op.actionId === undefined || typeof payload.raw?.data !== "string") continue;
    const bytes = Buffer.from(payload.raw.data, "hex");
    if (bytes.length <= ACTION_PREFIX) continue;
    const dv = new DataView(bytes.buffer, bytes.byteOffset + ACTION_PREFIX, bytes.length - ACTION_PREFIX);
    if (op.actionId === ACTION_BUILD) {
      const typeId = dv.getUint32(12, true);
      counts.set(typeId, (counts.get(typeId) ?? 0) + 1);
    }
  }
  return { file, counts };
}

const args = process.argv.slice(2);
let files = args;
if (files.length === 0) {
  files = ["/mnt/d/wks/replay.aoe2record"];
}
if (files.length === 1 && files[0].endsWith("/")) {
  const dir = files[0];
  files = readdirSync(dir)
    .filter((f) => f.endsWith(".aoe2record"))
    .slice(0, 5)
    .map((f) => path.join(dir, f));
}

const total = new Map();
for (const file of files) {
  const { counts } = await buildingTypeIds(file);
  console.log(`\n── ${path.basename(file)} (${counts.size} tipos distintos)`);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [id, n] of sorted.slice(0, 15)) {
    console.log(`  ${String(id).padStart(6)} × ${String(n).padStart(4)}  ${KNOWN[id] ?? "?"}`);
    total.set(id, (total.get(id) ?? 0) + n);
  }
}

console.log("\n── TOTAL (todos los archivos):");
for (const [id, n] of [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(id).padStart(6)} × ${String(n).padStart(5)}  ${KNOWN[id] ?? "?"}`);
}
