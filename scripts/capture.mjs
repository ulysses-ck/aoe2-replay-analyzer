/**
 * Captura end-to-end con un navegador real: sube un replay, espera el canvas,
 * avanza la línea de tiempo, prueba el play y saca capturas.
 *
 * Ojo: correr con el `node` de Linux. `pnpm exec` acá resuelve el shim de
 * Windows y Playwright busca binarios `win64`.
 *
 * Uso: node scripts/capture.mjs <ruta.aoe2record> [carpeta-salida]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const replay = resolve(process.argv[2] ?? "../replay.aoe2record");
const outDir = resolve(process.argv[3] ?? "./.screenshots");
const base = process.env.APP_URL ?? "http://localhost:3000";

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1400, height: 860 },
  deviceScaleFactor: 1,
});

const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(String(error)));

await page.goto(base, { waitUntil: "networkidle" });
await page.screenshot({ path: `${outDir}/01-upload.png` });

const started = Date.now();
await page.setInputFiles('input[type="file"]', replay);
await page.waitForSelector("canvas", { timeout: 120_000 });
await page.waitForTimeout(1200);
console.log(`modelo listo en ${Date.now() - started} ms`);
await page.screenshot({ path: `${outDir}/02-mapa.png` });

const clock = () => page.locator('input[type="range"]').inputValue();

// Avanzar la línea de tiempo.
async function seek(ms) {
  await page.locator('input[type="range"]').evaluate((el, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, ms);
  await page.waitForTimeout(400);
}

await seek(12 * 60 * 1000);
await page.screenshot({ path: `${outDir}/03-12min.png` });

await seek(30 * 60 * 1000);
await page.screenshot({ path: `${outDir}/04-30min.png` });

// Zoom anclado al cursor sobre el centro del canvas.
const box = await page.locator("canvas").boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
  for (let i = 0; i < 12; i += 1) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(300);
}
await page.screenshot({ path: `${outDir}/05-zoom.png` });

// Reproducción real: play + 1.5 s de reloj de pared a 32x.
const before = Number(await clock());
await page.keyboard.press("Space");
await page.waitForTimeout(1500);
await page.keyboard.press("Space");
const after = Number(await clock());
console.log(`play: ${before} ms → ${after} ms (Δ ${after - before} ms)`);

await page.screenshot({ path: `${outDir}/06-play.png` });

console.log(`errores de consola: ${errors.length}`);
for (const error of errors.slice(0, 10)) console.log("  -", error);

await browser.close();
