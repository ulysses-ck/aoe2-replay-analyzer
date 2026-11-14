/**
 * Sonda: layout binario de la acción Interact (ataques).
 *
 * aoe2rec ya la expone como campos; acá miramos los bytes crudos de agelens
 * (actionId 0) para decodificarla igual que Build/Move.
 */
import { readFileSync } from "node:fs";
import { parse_rec, parse_rec_summary } from "aoe2rec-js";
import { parseRecording } from "agelens";

const file = process.argv[2];
const buffer = readFileSync(file);
const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

// aoe2rec: qué trae Interact
try {
  const ops = parse_rec(ab)?.chapters?.[0]?.operations ?? [];
  const samples = [];
  for (const op of ops) {
    const data = op?.Action?.action_data;
    if (data?.Interact && samples.length < 4) samples.push(data.Interact);
  }
  console.log(`aoe2rec Interact (${samples.length} muestras):`);
  for (const s of samples) console.log(`  ${JSON.stringify(s).slice(0, 200)}`);
} catch (error) {
  console.log(`aoe2rec falló: ${error.message}`);
}

// agelens: bytes crudos de actionId 0
const rec = await parseRecording(new Uint8Array(ab));
let shown = 0;
for (const op of rec.operations ?? []) {
  if (op.actionId !== 0 || shown >= 4) continue;
  const hex = op.payload?.raw?.data;
  if (typeof hex !== "string") continue;
  const bytes = Buffer.from(hex, "hex");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  shown += 1;
  console.log(`\naction 0 (${bytes.length} bytes, prefijo ${bytes[0]},${bytes[1]},${bytes[2]}):`);
  console.log(`  hex: ${hex.slice(0, 80)}`);
  for (let off = 3; off + 4 <= Math.min(bytes.length, 35); off += 4) {
    console.log(
      `  @${off}: u32=${dv.getUint32(off, true)} f32=${dv.getFloat32(off, true).toFixed(2)}`,
    );
  }
}
