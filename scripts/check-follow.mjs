/**
 * Verificación de "seguir al dueño": el encuadre tiene que moverse con el reloj
 * y el mapa no se puede salir de la zona jugable.
 *
 * Uso: node scripts/check-follow.mjs <replay.aoe2record>
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

const url = () => decodeURIComponent(page.url().replace(base, ""));
const seek = async (ms) => {
  await page.locator('input[type="range"]').evaluate((el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, ms);
  await page.waitForTimeout(350);
};

// Botón de seguimiento presente y apagado al principio.
const followButton = page.getByRole("button", { name: /dueño/ });
console.log(`botón presente: ${await followButton.count()} | texto: "${await followButton.textContent()}"`);

await seek(60 * 1000);
const before = await url();
await followButton.click();
await page.waitForTimeout(900);
const at1min = await url();
console.log(`tras activar @1min: ${at1min}`);
await page.screenshot({ path: "/tmp/opencode/follow-1min.png" });

// Avanzamos 30 min: el encuadre debe cambiar si el jugador movió la cámara.
await seek(30 * 60 * 1000);
await page.waitForTimeout(500);
const at30min = await url();
const badge = await page.locator("text=/^\\d+%$/").first().textContent();
console.log(`@30min: ${at30min} | zoom=${badge}`);
await page.screenshot({ path: "/tmp/opencode/follow-30min.png" });

const parse = (u) => Object.fromEntries(new URLSearchParams(u.split("?")[1]));
const a = parse(at1min);
const b = parse(at30min);
const moved = Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y));
console.log(`desplazamiento 1min → 30min: ${moved.toFixed(1)} tiles`);

// Arrastrar debe cortar el seguimiento.
const box = await page.locator("canvas").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 80, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(900);
const afterDrag = await url();
console.log(`botón tras arrastrar: "${await followButton.textContent()}"`);
console.log(`encuadre tras arrastrar: ${afterDrag}`);

console.log(`errores de consola: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log("  -", e);
await browser.close();