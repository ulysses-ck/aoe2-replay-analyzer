/**
 * Sonda 3: orientación de la grilla de terreno.
 *
 * Los edificios nunca caen sobre agua ni sobre bosque. Para cada replay acuoso
 * del corpus se comparan los edificios que devuelve el worker (decodificación
 * autoritativa) contra la grilla de tiles bajo 6 hipótesis de índice:
 *   A tiles[y*dim+x]      (row-major, sin flip)
 *   B tiles[x*dim+y]      (transpose)
 *   C tiles[y*dim+dim-1-x]
 *   D tiles[(dim-1-y)*dim+x]
 *   E tiles[x*dim+dim-1-y]
 *   F tiles[(dim-1-x)*dim+y]
 * La hipótesis buena es la que dé ~0% de edificios sobre agua+forest en todos
 * los mapas, y la única si el mapa no es simétrico.
 *
 * Uso: node scripts/probe-tile-order3.mjs <carpeta-savegame> [cantidad]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { parseHeader } from "agelens";

const folder = process.argv[2];
const limit = Number(process.argv[3]) || 40;
const WATER_SET = new Set([1, 2, 4, 22, 23, 26, 28, 57, 58, 59, 95, 96, 97, 98, 99, 111, 114, 115, 116, 130]);
const FOREST_SET = new Set([10, 13, 17, 18, 19, 20, 21, 48, 49, 50, 55, 56, 71, 72, 77, 88, 89, 90, 91, 92, 104, 105, 106, 110, 112, 113, 128, 131, 132, 133]);
const files = readdirSync(folder)
  .filter((n) => n.startsWith("MP") && n.endsWith(".aoe2record"))
  .sort()
  .slice(0, limit)
  .map((n) => join(folder, n));

function parseInWorker(buffer, fileName) {
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(new URL("../workers/parse-replay.mjs", import.meta.url), {
      workerData: { buffer, fileName },
      transferList: [buffer],
    });
    worker.once("message", (r) => (r?.ok ? resolvePromise(r.model) : rejectPromise(new Error("parse falló"))));
    worker.once("error", rejectPromise);
  });
}

const agg = new Map();
for (const file of files) {
  try {
    const b = readFileSync(file);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const u8 = new Uint8Array(ab);
    const header = await parseHeader(u8);
    const map = header.map;
    if (!map?.tiles?.length) continue;
    const dim = map.dimension;
    const tileAt = (x, y) => map.tiles[Math.round(y) * dim + Math.round(x)];

    // ¿Este mapa tiene agua o bosque para discriminar?
    const counts = new Map();
    for (const t of map.tiles) counts.set(t.terrain, (counts.get(t.terrain) ?? 0) + 1);
    const waterCount = [1, 2, 4, 22, 23, 26, 28, 57, 58, 59, 95, 96, 97, 98, 99, 111, 114, 115, 116, 130]
      .reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);
    const forestCount = [10, 13, 17, 18, 19, 20, 21, 48, 49, 50, 55, 56, 71, 72, 77, 88, 89, 90, 91, 92, 104, 105, 106, 110, 112, 113, 128, 131, 132, 133]
      .reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);
    if (waterCount + forestCount < 200) continue;

    const model = await parseInWorker(ab, file.split("/").pop());
    if (model.meta.engine !== "agelens") continue;
    const buildings = (model.buildings ?? []).map((b2) => [b2.x, b2.y]);
    if (buildings.length < 60) continue;

    const variants = {
      A_y_x: (x, y) => Math.round(y) * dim + Math.round(x),
      B_x_y: (x, y) => Math.round(x) * dim + Math.round(y),
      C_y_fx: (x, y) => Math.round(y) * dim + (dim - 1 - Math.round(x)),
      D_fy_x: (x, y) => (dim - 1 - Math.round(y)) * dim + Math.round(x),
      E_x_fy: (x, y) => Math.round(x) * dim + (dim - 1 - Math.round(y)),
      F_fx_y: (x, y) => (dim - 1 - Math.round(x)) * dim + Math.round(y),
    };
    const score = {};
    for (const [name, at] of Object.entries(variants)) {
      let bad = 0;
      for (const [x, y] of buildings) {
        const tile = map.tiles[at(x, y)];
        if (tile && (WATER_SET.has(tile.terrain) || FOREST_SET.has(tile.terrain))) bad += 1;
      }
      score[name] = ((bad / buildings.length) * 100).toFixed(1);
      const key = `${name}`;
      const prev = agg.get(key) ?? { sum: 0, n: 0 };
      prev.sum += Number(score[name]);
      prev.n += 1;
      agg.set(key, prev);
    }
    console.log(
      `${file.split("/").pop().slice(0, 36)} | dim ${dim} | agua ${(waterCount / (dim * dim) * 100).toFixed(0)}% forest ${(forestCount / (dim * dim) * 100).toFixed(0)}% | ed ${buildings.length} |`,
      Object.entries(score).map(([k, v]) => `${k}:${v}%`).join(" "),
    );
  } catch (error) {
    console.log(`fallo: ${error.message.slice(0, 70)}`);
  }
}

console.log("\nPromedio (bajo = mejor):");
for (const [key, { sum, n }] of [...agg.entries()].sort()) {
  console.log(`  ${key}: ${(sum / n).toFixed(2)}% (${n} mapas)`);
}
