/**
 * Sonda: ¿en qué orden vienen los tiles del mapa y hacia dónde crece cada eje?
 *
 * Dos pruebas:
 * 1. Coherencia de elevación: los vecinos horizontales comparten elevación, así
 *    que el stride "suave" nos dice si es row-major o column-major.
 * 2. Agua vs edificios: ningún edificio se construye sobre agua. Si con una
 *    orientación hay edificios sobre agua y con otra no, la orientación buena es
 *    la que no tiene. Se prueba sobre replays con agua.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHeader } from "agelens";

const folder = process.argv[2];
const files = readdirSync(folder)
  .filter((n) => n.startsWith("MP") && n.endsWith(".aoe2record"))
  .slice(0, 14)
  .map((n) => join(folder, n));

async function smoothness(tiles, dim) {
  let rows = 0;
  let cols = 0;
  const e = (i) => tiles[i].elevation;
  for (let i = 0; i < tiles.length - 1; i += 1) {
    if ((i + 1) % dim !== 0) rows += Math.abs(e(i + 1) - e(i));
    if (i + dim < tiles.length) cols += Math.abs(e(i + dim) - e(i));
  }
  return { rows: rows / (tiles.length - dim), cols: cols / (tiles.length - dim) };
}

function waterCount(tiles) {
  const counts = new Map();
  for (const t of tiles) counts.set(t.terrain, (counts.get(t.terrain) ?? 0) + 1);
  return counts;
}

let checked = 0;
for (const file of files) {
  try {
    const b = readFileSync(file);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const header = await parseHeader(new Uint8Array(ab));
    const map = header.map;
    if (!map?.tiles?.length) continue;
    const dim = map.dimension;
    const counts = waterCount(map.tiles);
    const water = [1, 2, 22, 23, 4, 59].reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);
    const s = await smoothness(map.tiles, dim);
    console.log(
      `${dim}² | agua ${water} | filas ${s.rows.toFixed(3)} col ${s.cols.toFixed(3)} | ` +
        `top terrains: ${[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => `${id}:${n}`).join(" ")}`,
    );
    checked += 1;
    if (checked >= 8) break;
  } catch (error) {
    console.log(`fallo ${file.split("/").pop()}: ${error.message.slice(0, 60)}`);
  }
}