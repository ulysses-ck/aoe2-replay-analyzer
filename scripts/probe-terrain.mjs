/**
 * Sonda: estructura del mapa (terreno) según agelens.
 *
 * La idea es dibujar los tiles de verdad (pasto, agua, bosque) en vez del
 * rombo verde uniforme. Acá vemos qué expone y con qué forma.
 */
import { readFileSync } from "node:fs";
import { parseRecording } from "agelens";

const file = process.argv[2];
const buffer = readFileSync(file);
const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const rec = await parseRecording(new Uint8Array(ab));
const map = rec.map ?? {};
console.log(`map keys: ${Object.keys(map).join(", ")}`);
for (const [key, value] of Object.entries(map)) {
  const type = Array.isArray(value) ? `array(${value.length})` : typeof value;
  console.log(`  ${key}: ${type}`);
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    console.log(`    first: ${JSON.stringify(first).slice(0, 300)}`);
    if (Array.isArray(first)) {
      console.log(`    first.len: ${first.length} | first[0]: ${JSON.stringify(first[0]).slice(0, 120)}`);
    }
  } else if (typeof value === "object" && value !== null) {
    console.log(`    keys: ${Object.keys(value).join(", ").slice(0, 300)}`);
  }
}

// dimension y terrain por separado: puede venir como Uint8Array plano o matriz
const dim = Number(map.dimension) || 0;
console.log(`\ndimension: ${dim} (${dim * dim} tiles)`);
for (const [key, value] of Object.entries(map)) {
  if (Array.isArray(value) && value.length === dim * dim) {
    const counts = new Map();
    for (const v of value.slice(0, dim * dim)) {
      const k = typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    console.log(`${key}: ${counts.size} valores distintos →`, [...counts.entries()].slice(0, 12));
  }
  if (Array.isArray(value) && value.length === dim && Array.isArray(value[0])) {
    console.log(`${key}: matriz ${dim}x${value[0].length}`);
    const counts = new Map();
    for (const row of value) {
      for (const v of row) {
        const k = typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    console.log(`  ${counts.size} valores distintos →`, [...counts.entries()].slice(0, 12));
  }
}