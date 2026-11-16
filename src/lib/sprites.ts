/**
 * Sprites reales del juego: atlas WebP + manifest.json generados UNA vez con
 * tools/sprites de sk8erlucas/aoe2-replays (MIT) contra la instalación local
 * de AoE2:DE, y servidos como estáticos por el backend (ver next.config.ts).
 * En dev (`API_BASE` vacío) salen del `public/sprites/` de esta repo.
 *
 * Las páginas se bajan al primer uso; hasta entonces (o si falta un sprite)
 * el mapa dibuja sus prismas de siempre. El color de jugador viene de una
 * máscara que se tiñe por color una vez y se cachea con su página.
 *
 * Adaptado de packages/viewer/src/sprites.js de sk8erlucas/aoe2-replays (MIT);
 * el arte es de Microsoft, usado bajo las Game Content Usage Rules.
 */
import { API_BASE } from "./api-base";

/** Los TC construidos usan otro id que el inicial (ver extract.py). */
const BUILDING_ALIASES: Record<number, number> = { 621: 109 };
const RETRIES = 4;
/** Frames sin dibujar a partir de los cuales una página puede liberarse. */
const IDLE_FRAMES = 30;

/** Parte de un edificio: [frameKey, dx?, dy?, ox?, oy?]. */
export type SpritePart = [number | number[], number | undefined, number | undefined, number | undefined, number | undefined];

type Manifest = {
  version: number;
  scale: number;
  tilePx: number;
  pages: [string, string | null][];
  pagesLow?: [string, string | null][];
  frames: [number, number, number, number, number, number, number, number][];
  civs: string[] | Record<string, CivData>;
};

type CivData = {
  name?: string;
  buildings?: Record<string, Record<string, SpritePart[]>>;
  rubble?: Record<string, Record<string, number | number[]>>;
  units?: Record<string, unknown>;
};

type Page = {
  base: HTMLImageElement | null;
  mask: HTMLImageElement | null;
  requested: Set<string>;
  loading: Set<HTMLImageElement>;
  tints: Map<string, HTMLCanvasElement>;
  used: number;
  tries: number;
};

export type SpriteFrame = {
  /** Rectángulo fuente en la página (en píxeles de página). */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Tamaño y ancla en píxeles de sprite, sea cual sea la resolución de la página. */
  w: number;
  h: number;
  ax: number;
  ay: number;
  image: HTMLImageElement;
  mask: HTMLImageElement | null;
  page: Page;
};

export class SpriteSet {
  readonly m: Manifest;
  readonly base: string;
  readonly lowRes: boolean;
  readonly tilePx: number;
  /** Presupuesto de bytes decodificados antes de liberar páginas sin uso. */
  readonly budget: number;
  private pages = new Map<number, Page>();
  private civs: Record<string, CivData> = {};
  private civLoads = new Map<string, Promise<void>>();
  private clock = 0;
  /** Callback para re-dibujar cuando llega una página o civilización. */
  onLoad: (() => void) | null = null;

  private constructor(manifest: Manifest, base: string, lowRes: boolean, budgetMB: number) {
    this.m = manifest;
    this.base = base;
    this.lowRes = lowRes;
    this.tilePx = manifest.tilePx;
    this.budget = budgetMB * 1024 * 1024;
  }

  /**
   * Baja el manifiesto (siempre revalidado: los atlas llevan hash de contenido
   * en el nombre, el manifiesto no). `lowRes` usa las páginas a media
   * resolución (la mitad de memoria decodificada, clave en celulares).
   */
  static async load(lowRes: boolean, baseUrl = `${API_BASE}/sprites`): Promise<SpriteSet> {
    const res = await fetch(`${baseUrl}/manifest.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`sprites manifest: HTTP ${res.status}`);
    const manifest = (await res.json()) as Manifest;
    const budgetMB = lowRes ? 160 : 640;
    return new SpriteSet(manifest, baseUrl, lowRes && !!manifest.pagesLow, budgetMB);
  }

  /** Baja las listas de sprites de estas civilizaciones (civs/<id>.json), una vez cada una. */
  async loadCivs(civIds: number[]): Promise<void> {
    const ids = [...new Set(civIds.filter((id) => id != null))];
    await Promise.all(ids.map((id) => this.loadCiv(id)));
  }

  private loadCiv(id: number): Promise<void> {
    const key = String(id);
    if (!Array.isArray(this.m.civs) || !this.m.civs.some((c) => String(c) === key)) return Promise.resolve();
    const existing = this.civLoads.get(key);
    if (existing) return existing;
    const load = fetch(`${this.base}/civs/${key}.json`, { cache: "no-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<CivData>;
      })
      .then((civ) => {
        this.civs[key] = civ;
        this.onLoad?.();
      })
      .catch(() => {
        // Red inestable: permitir otro intento un poco más tarde.
        setTimeout(() => this.civLoads.delete(key), 2000);
      });
    this.civLoads.set(key, load);
    return load;
  }

  private civ(civId: number): CivData | undefined {
    return this.civs[String(civId)];
  }

  /**
   * Un frame dibujable (por índice del manifiesto), o null mientras su página
   * baja. `image`/`mask` son elementos <img>; crossOrigin anonymous porque el
   * backend sirve los atlas cross-origin (sin eso el canvas queda manchado).
   */
  frame(key: number): SpriteFrame | null {
    const f = this.m.frames[key];
    if (!f) return null;
    const [p, x, y, w, h, ax, ay, m] = f;
    const page = this.page(p, m === 1);
    if (!page.base || (m === 1 && !page.mask)) return null;
    const r = this.lowRes ? 0.5 : 1;
    return {
      sx: x * r,
      sy: y * r,
      sw: w * r,
      sh: h * r,
      w,
      h,
      ax,
      ay,
      image: page.base,
      mask: m === 1 ? page.mask : null,
      page,
    };
  }

  /** La capa de color de jugador del frame, teñida con `color` (cacheada con su página). */
  tint(frame: SpriteFrame, key: number, color: string): HTMLCanvasElement | null {
    const id = `${key}|${color}`;
    let canvas = frame.page.tints.get(id);
    if (!canvas) {
      const w = Math.max(1, Math.ceil(frame.sw));
      const h = Math.max(1, Math.ceil(frame.sh));
      canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null; // sin memoria de canvas: el sprite sale sin teñir
      if (frame.mask) {
        ctx.drawImage(frame.mask, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, w, h);
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(frame.mask, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, w, h);
        ctx.globalCompositeOperation = "source-over";
      }
      frame.page.tints.set(id, canvas);
    }
    return canvas;
  }

  /** [[frame, dx, dy, ox, oy], ...] para un edificio de una civilización a una edad (1-4). */
  building(civId: number, typeId: number, age: number): SpritePart[] | null {
    const id = BUILDING_ALIASES[typeId] ?? typeId;
    const ages = this.civ(civId)?.buildings?.[String(id)];
    if (!ages) return null;
    for (let a = age; a >= 1; a--) if (ages[String(a)]) return ages[String(a)];
    return null;
  }

  private page(index: number, withMask: boolean): Page {
    let page = this.pages.get(index);
    if (!page) {
      page = { base: null, mask: null, requested: new Set(), loading: new Set(), tints: new Map(), used: 0, tries: 0 };
      this.pages.set(index, page);
    }
    page.used = this.clock;
    const [baseFile, maskFile] = (this.lowRes ? this.m.pagesLow! : this.m.pages)[index];
    const load = (file: string | null, slot: "base" | "mask") => {
      if (!file || !page || page.requested.has(slot)) return;
      page.requested.add(slot);
      const img = new Image();
      img.crossOrigin = "anonymous";
      page.loading.add(img);
      img.onload = () => {
        page.loading.delete(img);
        page[slot] = img;
        this.onLoad?.();
      };
      // Un download fallido se reintenta en un frame posterior, cada vez más tarde.
      img.onerror = () => {
        page.loading.delete(img);
        page.tries += 1;
        if (page.tries <= RETRIES) setTimeout(() => page.requested.delete(slot), 1000 * page.tries);
      };
      img.src = `${this.base}/${file}`;
    };
    load(baseFile, "base");
    if (withMask) load(maskFile, "mask");
    return page;
  }

  /** Bytes decodificados aproximados de las páginas cargadas (y sus tintas). */
  private decodedBytes(): number {
    let total = 0;
    for (const page of this.pages.values()) {
      for (const img of [page.base, page.mask]) if (img) total += img.naturalWidth * img.naturalHeight * 4;
      for (const c of page.tints.values()) total += c.width * c.height * 4;
    }
    return total;
  }

  /**
   * Llamar después de dibujar un frame: si el total decodificado pasa el
   * presupuesto, libera las páginas que hace más tiempo no se dibujan.
   */
  endFrame(): void {
    this.clock += 1;
    if (this.clock % 10 !== 0) return;
    let total = this.decodedBytes();
    if (total <= this.budget) return;
    const idle = [...this.pages.entries()]
      .filter(([, page]) => page.used < this.clock - IDLE_FRAMES)
      .sort((a, b) => a[1].used - b[1].used);
    for (const [index, page] of idle) {
      if (total <= this.budget) break;
      for (const img of [page.base, page.mask, ...page.loading]) {
        if (!img) continue;
        img.onload = img.onerror = null;
        img.removeAttribute("src");
      }
      total -= this.decodedBytesOf(page);
      this.pages.delete(index);
    }
  }

  private decodedBytesOf(page: Page): number {
    let total = 0;
    for (const img of [page.base, page.mask]) if (img) total += img.naturalWidth * img.naturalHeight * 4;
    for (const c of page.tints.values()) total += c.width * c.height * 4;
    return total;
  }
}
