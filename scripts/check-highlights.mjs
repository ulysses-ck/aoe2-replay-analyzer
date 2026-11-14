/**
 * Verificación de highlights: lista en el sidebar, salto al instante, y
 * re-centrado del mapa al tile del combate.
 *
 * Uso: node scripts/check-highlights.mjs <replay.aoe2record>
 */
import { chromium } from "playwright";
import { resolve } from "node:path";

const replay = resolve(process.argv[2]);
const base = process.env.APP_URL ?? "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(base, { waitUntil: "networkidle" });
await page.setInputFiles('input[type="file"]', replay);
await page.waitForSelector("canvas", { timeout: 120_000 });
await page.waitForTimeout(1500);

const items = page.locator("section:has(h2:text('Highlights')) li button");
const total = await items.count();
console.log(`highlights en el sidebar: ${total}`);
if (total === 0) {
  console.log("sin highlights: nada que verificar");
  await browser.close();
  process.exit(0);
}

for (let i = 0; i < Math.min(3, total); i += 1) {
  console.log(`  ${i + 1}: ${(await items.nth(i).textContent())?.trim()}`);
}

// Click en el primer highlight de combate (raid o batalla).
const battleButton = page.locator("section:has(h2:text('Highlights')) li button", { hasText: /Raid|Batalla/ }).first();
const label = (await battleButton.textContent())?.trim();
const clockBefore = await page.locator('input[type="range"]').inputValue();
await battleButton.click();
await page.waitForTimeout(900);
const clockAfter = await page.locator('input[type="range"]').inputValue();
const url = decodeURIComponent(page.url()).split("?")[1] ?? "";
console.log(`click en "${label}"`);
console.log(`reloj: ${clockBefore} → ${clockAfter} ms`);
console.log(`url: ?${url}`);
await page.screenshot({ path: "/tmp/opencode/highlight-jump.png" });

console.log(`errores de consola: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log("  -", e);
await browser.close();