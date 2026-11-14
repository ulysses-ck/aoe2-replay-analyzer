/**
 * Sonda 2: terreno — dos preguntas.
 *
 * 1. ¿El byte leído como terrain es el terreno de verdad, incluso en replays
 *    donde aparecen IDs >41? Se volca el hex de los primeros records de tile
 *    (10 bytes en DE) para ver la estructura cruda.
 *
 * 2. ¿Qué orientación de la grilla es la buena? Los edificios de la zona de
 *    building no se construyen sobre agua. Con la orientación correcta, la
 *    fracción de edificios sobre agua debe ser ~0. Se prueban 4 combinaciones:
 *    índice = row*dim+col o col*dim+row, y flip de x o no.
 *
 * Uso: node scripts/probe-tile-order2.mjs <carpeta-savegame>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHeader, parseRecording } from "agelens";

const folder = process.argv[2];
const files = readdirSync(folder)
  .filter((n) => n.startsWith("MP") && n.endsWith(".aoe2record"))
  .sort()
  .slice(0, 20)
  .map((n) => join(folder, n));

const WATER = new Set([1, 2, 4, 22, 23, 10 === 10 ? -1 : -1]); // IDs clásicos de agua
WATER.delete(-1);

let tested = 0;
for (const file of files) {
  try {
    const b = readFileSync(file);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const u8 = new Uint8Array(ab);
    const header = await parseHeader(u8);
    const map = header.map;
    if (!map?.tiles?.length) continue;
    const dim = map.dimension;

    // ¿Hay agua en esta grilla?
    const counts = new Map();
    for (const t of map.tiles) counts.set(t.terrain, (counts.get(t.terrain) ?? 0) + 1);
    const waterTiles = [...WATER].reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);
    const topIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => `${id}:${n}`).join(" ");

    // Edificios desde el body de agelens (acción Build = 102).
    let buildings = [];
    try {
      const rec = await parseRecording(u8);
      const dvTiles = [];
      for (const op of rec.actions ?? rec.operations ?? []) {
        if (op.actionId !== 102) continue;
        const hex = op.payload?.raw?.data;
        if (typeof hex !== "string") continue;
        const bytes = Buffer.from(hex, "hex");
        if (bytes.length < 16) continue;
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const x = dv.getFloat32(4, true);
        const y = dv.getFloat32(8, true);
        if (Number.isFinite(x) && Number.isFinite(y)) dvTiles.push([x, y]);
      }
      buildings = dvTiles;
    } catch {
      buildings = [];
    }

    // Hex de los primeros 3 records de tile (10 bytes por tile en DE).
    // La zona de tiles empieza después de los 2048 bytes de datos previos; no
    // tenemos el offset exacto desde afuera, así que lo dejo para el volcado
    // manual y me concentro en el test de orientación.
    console.log(
      `${file.split("/").pop().slice(0, 40)} | dim ${dim} | agua ${waterTiles} | top ${topIds} | edificios ${buildings.length}`,
    );
    if (waterTiles > 300 && buildings.length > 60) {
      // tileAt(orientation, x, y): idx según las 4 hipótesis.
      const variants = [
        ["rowCol+", (x, y) => Math.round(y) * dim + Math.round(x)],
        ["rowCol-x", (x, y) => Math.round(y) * dim + (dim - 1 - Math.round(x))],
        ["rowCol+y", (x, y) => (dim - 1 - Math.round(y)) * dim + Math.round(x)],
        ["colRow", (x, y) => Math.round(x) * dim + Math.round(y)],
        ["colRow-y", (x, y) => Math.round(x) * dim + (dim - 1 - Math.round(y))],
      ];
      const out = [];
      for (const [name, at] of variants) {
        let onWater = 0;
        for (const [x, y] of buildings) {
          const idx = at(x, y);
          const tile = map.tiles[idx];
          if (tile && WATER.has(tile.terrain)) onWater += 1;
        }
        out.push(`${name} ${((onWater / buildings.length) * 100).toFixed(1)}%`);
      }
      console.log("  edificios sobre agua →", out.join(" | "));
      tested += 1;
      if (tested >= 4) break;
    }
  } catch (error) {
    console.log(`fallo: ${error.message.slice(0, 80)}`);
  }
}
