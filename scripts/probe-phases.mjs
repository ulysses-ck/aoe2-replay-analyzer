/**
 * Sondeo del worker completo: age-ups, producción y researches del modelo.
 *
 * Uso: node scripts/probe-phases.mjs <replay.aoe2record>
 */
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";

const path = process.argv[2];
if (!path) {
  console.error("uso: node scripts/probe-phases.mjs <replay.aoe2record>");
  process.exit(1);
}

const buffer = readFileSync(path);
const worker = new Worker(new URL("../workers/parse-replay.mjs", import.meta.url), {
  workerData: { buffer, fileName: path.split("/").pop() },
});

const AGE_NAME = { 101: "feudal", 102: "castillo", 103: "imperial" };
const VILLAGERS = new Set([83, 293]);

const result = await new Promise((resolve, reject) => {
  worker.on("message", resolve);
  worker.on("error", reject);
});
await worker.terminate();

if (!result.ok) {
  console.error("fallo:", result);
  process.exit(1);
}
const model = result.model;
console.log("engine:", model.meta.engine, "| jugadores:", model.meta.playerCount);
for (const p of model.players) {
  const ages = model.ageUps
    .filter((a) => a.playerId === p.id)
    .sort((a, b) => a.t - b.t);
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  const ageStr =
    ages.map((a) => `${AGE_NAME[a.age]} ${fmt(a.t)}`).join(" | ") || "(sin age-ups)";
  const units = {};
  for (const ev of model.production) {
    if (ev.playerId !== p.id) continue;
    const key = VILLAGERS.has(ev.unitId) ? "villager" : `u${ev.unitId}`;
    units[key] = (units[key] ?? 0) + ev.amount;
  }
  const vills = units.villager ?? 0;
  delete units.villager;
  console.log(`  ${p.id}. ${p.name}: ${ageStr}`);
  console.log(`     villager: ${vills} | producción: ${JSON.stringify(units)}`);
  const techs = model.researches.filter((r) => r.playerId === p.id).length;
  console.log(`     researches: ${techs}`);
}
