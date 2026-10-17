// The map's ground: OpenStreetMap's own tiles (tile.openstreetmap.org, its usage policy: no prefetch, the browser's
// referer, the credit shown), slippy-map tiles in Web Mercator at a fractional zoom, turned to night by the drawing
// (night()). Fetched only while a map is shown, kept in a small cache (the least recently drawn dropped); a tile still
// loading is stood in for by the nearest loaded parent, scaled — never a blank square.
import type { Rect } from "./kit";

export const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
export const TILE_CREDIT = "© OpenStreetMap contributors";
const TILE_PX = 256;
const MAX_Z = 19;
const R_EQ = 6_378_137;

export const mercX = (lon: number) => (lon + 180) / 360;
export const mercY = (lat: number) => {
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
export const unMercX = (x: number) => x * 360 - 180;
export const unMercY = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
/** metres a pixel at a latitude and zoom (256-px tiles) */
export const metresPerPx = (lat: number, z: number) => (2 * Math.PI * R_EQ * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);

interface Tile {
  img: HTMLImageElement;
  ok: boolean;
  failed: boolean;
  used: number;
}

export class Tiles {
  private cache = new Map<string, Tile>();
  private frame = 0;
  /** a tile arrived: the owner redraws */
  onLoad: () => void = () => {};
  /** false once tiles fail repeatedly (offline): the vector land stays alone */
  online = true;
  private fails = 0;

  private get(z: number, x: number, y: number, load: boolean): Tile | null {
    const k = `${z}/${x}/${y}`;
    let t = this.cache.get(k);
    if (!t && load && this.online) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      const tile: Tile = { img, ok: false, failed: false, used: this.frame };
      img.onload = () => {
        tile.ok = true;
        this.fails = 0;
        this.onLoad();
      };
      img.onerror = () => {
        tile.failed = true;
        if (++this.fails > 12) this.online = false;
      };
      img.src = TILE_URL(z, x, y);
      this.cache.set(k, tile);
      t = tile;
      this.trim();
    }
    if (t) t.used = this.frame;
    return t ?? null;
  }
  private trim() {
    if (this.cache.size < 400) return;
    const old = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, 100);
    for (const [k, t] of old) {
      t.img.src = "";
      this.cache.delete(k);
    }
  }

  /**
   * The tiles under r about a centre (Mercator 0…1) at zoom z; the backing store's pixel ratio picks their level.
   * True when every tile shown is the right one (nothing more to come).
   */
  draw(c: CanvasRenderingContext2D, r: Rect, mx: number, my: number, z: number, dpr: number): boolean {
    this.frame++;
    // (a level between the CSS pixels' and the device's: the labels kept readable, the lines sharp enough)
    const zi = Math.max(0, Math.min(MAX_Z, Math.round(z + Math.log2(dpr) * 0.5)));
    const n = 2 ** zi;
    const size = 256 * 2 ** (z - zi);
    const S = 256 * 2 ** z;
    const x0 = r.x + r.w / 2 - mx * S,
      y0 = r.y + r.h / 2 - my * S;
    const tx0 = Math.floor((r.x - x0) / size),
      tx1 = Math.floor((r.x + r.w - x0) / size);
    const ty0 = Math.max(0, Math.floor((r.y - y0) / size)),
      ty1 = Math.min(n - 1, Math.floor((r.y + r.h - y0) / size));
    let complete = true;
    c.imageSmoothingQuality = "high";
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const wx = ((tx % n) + n) % n;
        const px = x0 + tx * size,
          py = y0 + ty * size;
        const t = this.get(zi, wx, ty, true);
        if (t?.ok) {
          c.drawImage(t.img, px, py, size + 0.5, size + 0.5);
          continue;
        }
        complete = false;
        // the nearest loaded parent, its quarter scaled up
        for (let up = 1; up <= 6 && zi - up >= 0; up++) {
          const p = this.get(zi - up, wx >> up, ty >> up, false);
          if (!p?.ok) continue;
          const f = 2 ** up,
            sub = TILE_PX / f;
          c.drawImage(p.img, (wx % f) * sub, (ty % f) * sub, sub, sub, px, py, size + 0.5, size + 0.5);
          break;
        }
      }
    return complete;
  }
}

/**
 * OpenStreetMap's day turned to night over r, by compositing alone (no canvas filter: Safari lacked it): inverted (the
 * land dark, the water and the roads lighter), then coloured the console's blue at its own luminosity, then dimmed.
 */
export function night(c: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }) {
  c.save();
  c.globalCompositeOperation = "difference";
  c.fillStyle = "#ffffff";
  c.fillRect(r.x, r.y, r.w, r.h);
  c.globalCompositeOperation = "color";
  c.fillStyle = "#1b6e96";
  c.fillRect(r.x, r.y, r.w, r.h);
  c.globalCompositeOperation = "multiply";
  c.fillStyle = "#7f9fb4";
  c.fillRect(r.x, r.y, r.w, r.h);
  c.restore();
}
