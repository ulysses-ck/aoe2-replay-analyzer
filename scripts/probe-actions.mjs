/**
 * Sonda: qué acciones trae cada motor y con qué forma.
 * Sirve para no adivinar layouts cuando aparece un tipo nuevo (p. ej. Viewlock).
 *
 * Uso: node scripts/probe-actions.mjs <replay.aoe2record>
 */
import { readFileSync } from "node:fs";
import { parse_rec, parse_rec_summary } from "aoe2rec-js";
import { parseRecording } from "agelens";

const file = process.argv[2];
const buffer = readFileSync(file);
const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

// ── aoe2rec: qué claves de action_data aparecen ──
try {
  const rec = parse_rec(ab);
  const ops = rec?.chapters?.[0]?.operations ?? [];
  const keys = new Map();
  const samples = new Map();
  for (const op of ops) {
    const data = op?.Action?.action_data;
    if (!data) continue;
    const key = Object.keys(data)[0];
    keys.set(key, (keys.get(key) ?? 0) + 1);
    if (!samples.has(key)) samples.set(key, JSON.stringify(data[key]).slice(0, 160));
  }
  console.log(`aoe2rec: ${ops.length} ops, ${keys.size} tipos de acción`);
  for (const [key, count] of [...keys.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${key.padEnd(18)} ${samples.get(key)}`);
  }
} catch (error) {
  console.log(`aoe2rec falló: ${error.message}`);
}

// ── agelens: actionId → cuántos, con el ancho del payload ──
try {
  const rec = await parseRecording(new Uint8Array(ab));
  const ids = new Map();
  const widths = new Map();
  for (const op of rec.operations ?? []) {
    if (op.actionId === undefined) continue;
    ids.set(op.actionId, (ids.get(op.actionId) ?? 0) + 1);
    if (typeof op.payload?.raw?.data === "string" && !widths.has(op.actionId)) {
      widths.set(op.actionId, op.payload.raw.data.length / 2);
    }
  }
  console.log(`\nagelens: ${ids.size} tipos de acción`);
  for (const [id, count] of [...ids.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  action ${String(id).padStart(3)}  primer payload ${widths.get(id)} bytes`);
  }
} catch (error) {
  console.log(`agelens falló: ${error.message}`);
}

// ── ¿el resumen trae info útil de la cabecera? ──
try {
  const summary = parse_rec_summary(ab);
  console.log(`\nsummary.duration = ${summary.duration}`);
  console.log(`summary keys: ${Object.keys(summary).join(", ")}`);
} catch (error) {
  console.log(`summary falló: ${error.message}`);
}
