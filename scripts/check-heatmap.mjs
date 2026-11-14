/**
 * Verificación del heatmap: el botón togglea, el mapa se ve con celdas violetas
 * y el dibujo acumula con el reloj (más tiempo → más celdas encendidas).
 *
 * Uso: node scripts/check-heatmap.mjs <replay.aoe2record>
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
await page.waitForTimeout(1200);

const button = page.getByRole("button", { name: /heatmap/i });
console.log(`botón presente: ${await button.count()} | texto: "${await button.textContent()}"`);

const seek = async (ms) => {
  await page.locator('input[type="range"]').evaluate((el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, ms);
  await page.waitForTimeout(350);
};

// Conteo de píxeles violetas del canvas: sirve para afirmar que dibuja y que
// el dibujo acumula con el tiempo de juego.
const violet = async () =>
  page.locator("canvas").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      // violeta #7c3aed mezclado: b alto, r medio-alto, g bajo. El azul del
      // jugador (#2f6fe4) y el violeta del jugador (#9b59b6) no cumplen ambos.
      if (b > 90 && r < 130 && r > g + 10 && b > r + 40) count += 1;
    }
    return count;
  });

await button.click();
await seek(5 * 60 * 1000);
const early = await violet();
console.log(`píxeles violetas @5min: ${early}`);
await page.screenshot({ path: "/tmp/opencode/heatmap-5min.png" });

await seek(45 * 60 * 1000);
const late = await violet();
console.log(`píxeles violetas @45min: ${late}`);
await page.screenshot({ path: "/tmp/opencode/heatmap-45min.png" });
console.log(`acumula: ${late >= early ? "sí" : "NO"}`);

// Apagado: vuelve a ~0 violeta.
await button.click();
await page.waitForTimeout(400);
const off = await violet();
console.log(`píxeles violetas apagado: ${off}`);

console.log(`errores de consola: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log("  -", e);
await browser.close();