// The Atlas's map (PLAN-MODES-AAA M6): a world on a canvas, panned and zoomed as a map is — dragged, the wheel and
// a pinch zooming about the pointer, a double click closer, a click picking a place —, flown to a place eased. The
// Earth on Web Mercator from its imagery's tiles (NASA GIBS's Blue Marble to level 8, EOX's Sentinel-2 cloudless
// beyond, to 13 — the same live public sources as the scenery; the parent tile shown while a tile comes), the Moon
// and Mars on the plate carrée from their maps (the 2048 px one at once, the 8192 px one once loaded). Drawn on
// demand (an animation frame when something changed), its overlays by its owner (game/mapproj.ts for the math).

import { dayUrl, eoxUrl, nightUrl } from "../system/earth-tiles";
import { project, tilesFor, unproject, worldHeight, type ProjKind } from "../game/mapproj";
import moonLo from "../../assets/planets/moon.jpg";
import marsLo from "../../assets/planets/mars.jpg";
import moonHd from "../../assets/planets-hd/moon-color.jpg";
import marsHd from "../../assets/planets-hd/mars-color.jpg";

export type MapBody = "earth" | "moon" | "mars";

/** The tiles kept (the oldest dropped first). */
const MAX_TILES = 360;
/** The Earth's deepest level (EOX's, ~19 m a pixel), its last of the Blue Marble. */
const EARTH_MAX_Z = 13;
const GIBS_MAX_Z = 8;

/** Where a place falls on the screen: its point [CSS px] (the nearest copy of the wrapped world). */
export type ToScreen = (lat: number, lon: number) => [number, number];

export class MapView {
  readonly canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  body: MapBody = "earth";
  kind: ProjKind = "mercator";
  /** the view: its centre on the world's square, its zoom (log2 of the pixels per 256 of the world's width) */
  cx = 0.5;
  cy = 0.5;
  zoom = 2;
  private tiles = new Map<string, HTMLImageElement | "error">();
  private sheets = new Map<string, HTMLImageElement>();
  private raf = 0;
  private fly: { from: [number, number, number]; to: [number, number, number]; t0: number; T: number } | null = null;
  /** the night's outline (the owner's path, built on the context; false: none) — the ground darkened in it, the
   *  Earth's city lights (NASA's Black Marble, VIIRS) shown through */
  night: ((ctx: CanvasRenderingContext2D, toScreen: ToScreen, W: number, H: number) => boolean) | null = null;
  /** the owner's overlays, drawn over the ground */
  overlay: (ctx: CanvasRenderingContext2D, toScreen: ToScreen, W: number, H: number) => void = () => {};
  /** a click (not a drag): the place under it */
  onPick: (lat: number, lon: number) => void = () => {};
  /** the view moved (by the hand or a flight) */
  onMove: () => void = () => {};

  constructor() {
    this.canvas.className = "mv-canvas";
    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = this.canvas.getBoundingClientRect();
        this.zoomAbout(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    const ptrs = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch = 0;
    this.canvas.addEventListener("pointerdown", (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      this.fly = null;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      }
    });
    this.canvas.addEventListener("pointermove", (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x,
        dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const r = this.canvas.getBoundingClientRect();
        if (pinch > 0) this.zoomAbout(Math.log2(d / pinch), (a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top);
        pinch = d;
        moved += 10;
        return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      const s = this.scale();
      this.cx -= dx / s;
      this.cy -= dy / s;
      this.clamp();
      this.request();
      this.onMove();
    });
    const up = (e: PointerEvent) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = 0;
      if (moved < 5 && ptrs.size === 0) {
        const r = this.canvas.getBoundingClientRect();
        const [lat, lon] = this.placeAt(e.clientX - r.left, e.clientY - r.top);
        this.onPick(lat, lon);
      }
    };
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", (e) => ptrs.delete(e.pointerId));
    this.canvas.addEventListener("dblclick", (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.zoomAbout(1, e.clientX - r.left, e.clientY - r.top);
    });
    new ResizeObserver(() => this.request()).observe(this.canvas);
  }

  /** The pixels per unit of the world's width. */
  scale() {
    return 256 * 2 ** this.zoom;
  }
  /** The widest: the world filling the view (its width, and its height). */
  minZoom() {
    const W = this.canvas.clientWidth || 800,
      H = this.canvas.clientHeight || 600;
    return Math.max(0, Math.log2(W / 256), Math.log2(H / worldHeight(this.kind) / 256));
  }
  /** The deepest zoom the world's imagery holds (a little beyond, magnified). */
  maxZoom() {
    return this.body === "earth" ? EARTH_MAX_Z + 2 : 7;
  }

  /** Another world: its projection, its whole face in view. */
  setBody(b: MapBody) {
    this.body = b;
    this.kind = b === "earth" ? "mercator" : "equirect";
    this.cx = 0.5;
    this.cy = worldHeight(this.kind) / 2;
    this.zoom = this.minZoom();
    this.fly = null;
    this.request();
  }

  /** The place under a point of the canvas [CSS px]. */
  placeAt(px: number, py: number): [number, number] {
    const s = this.scale();
    return unproject(this.kind, this.cx + (px - this.canvas.clientWidth / 2) / s, this.cy + (py - this.canvas.clientHeight / 2) / s);
  }

  /** The point of a place on the canvas [CSS px] — the copy of the wrapped world nearest the centre. */
  toScreen: ToScreen = (lat, lon) => {
    const [x, y] = project(this.kind, lat, lon);
    const dx = x - this.cx - Math.round(x - this.cx);
    const s = this.scale();
    return [this.canvas.clientWidth / 2 + dx * s, this.canvas.clientHeight / 2 + (y - this.cy) * s];
  };

  /** Zoomed by `dz` about a point of the canvas (it stays under the pointer). */
  zoomAbout(dz: number, px: number, py: number) {
    const z = Math.max(this.minZoom(), Math.min(this.maxZoom(), this.zoom + dz));
    if (z === this.zoom) return;
    const s0 = this.scale();
    const ox = (px - this.canvas.clientWidth / 2) / s0,
      oy = (py - this.canvas.clientHeight / 2) / s0;
    this.zoom = z;
    const s1 = this.scale();
    this.cx += ox - (ox * s0) / s1;
    this.cy += oy - (oy * s0) / s1;
    this.clamp();
    this.request();
    this.onMove();
  }

  /** Flown to a place, at a zoom (eased: out, across and in as a map's flight). */
  flyTo(lat: number, lon: number, zoom = this.zoom, ms = 900) {
    const [x, y] = project(this.kind, lat, lon);
    // (the shorter way round)
    const tx = this.cx + (x - this.cx - Math.round(x - this.cx));
    this.fly = { from: [this.cx, this.cy, this.zoom], to: [tx, y, Math.min(this.maxZoom(), zoom)], t0: performance.now(), T: ms };
    this.request();
  }

  private clamp() {
    if (this.zoom < this.minZoom()) this.zoom = this.minZoom();
    const H = worldHeight(this.kind);
    this.cx = ((this.cx % 1) + 1) % 1;
    const half = this.canvas.clientHeight / 2 / this.scale();
    this.cy = half * 2 >= H ? H / 2 : Math.max(half, Math.min(H - half, this.cy));
  }

  /** A redraw asked (one per animation frame). */
  request() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = () => {
    this.raf = 0;
    if (this.fly) {
      const f = this.fly;
      const u = Math.min(1, (performance.now() - f.t0) / f.T);
      const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
      // (out and in: the zoom dips between two places far apart)
      const far = Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]) * 2 ** Math.min(f.from[2], f.to[2]);
      const dip = far > 2 ? Math.min(3, Math.log2(far)) * Math.sin(Math.PI * u) : 0;
      this.cx = f.from[0] + (f.to[0] - f.from[0]) * e;
      this.cy = f.from[1] + (f.to[1] - f.from[1]) * e;
      this.zoom = f.from[2] + (f.to[2] - f.from[2]) * e - dip;
      this.clamp();
      if (u >= 1) this.fly = null;
      this.onMove();
      this.request();
    }
    this.draw();
  };

  private image(key: string, url: string, onload: () => void): HTMLImageElement | "error" | null {
    const have = this.tiles.get(key);
    if (have) {
      // (used: to the back of the queue)
      this.tiles.delete(key);
      this.tiles.set(key, have);
      // (a failed load is complete too, but broken: drawImage throws on it, so it is an error here)
      if (have === "error" || (have.complete && !have.naturalWidth)) return "error";
      return have.complete ? have : null;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = onload;
    img.onerror = () => this.tiles.set(key, "error");
    img.src = url;
    this.tiles.set(key, img);
    while (this.tiles.size > MAX_TILES) this.tiles.delete(this.tiles.keys().next().value!);
    return null;
  }

  private draw() {
    const cv = this.canvas;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = cv.clientWidth,
      H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    this.clamp();
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#04070d";
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = "high";
    const s = this.scale();
    const url = (zz: number, x: number, y: number) => (zz <= GIBS_MAX_Z ? dayUrl(zz, x, y) : eoxUrl(zz, x, y));
    if (this.body === "earth") this.drawTiles(ctx, W, H, s, url, EARTH_MAX_Z, "d");
    else this.drawSheet(ctx, W, H, s);
    if (this.night) {
      ctx.save();
      ctx.beginPath();
      if (this.night(ctx, this.toScreen, W, H)) {
        ctx.clip();
        ctx.fillStyle = "rgba(1, 4, 16, 0.66)";
        ctx.fillRect(0, 0, W, H);
        if (this.body === "earth") {
          ctx.globalCompositeOperation = "lighter";
          this.drawTiles(ctx, W, H, s, nightUrl, GIBS_MAX_Z, "n");
        }
      }
      ctx.restore();
    }
    this.overlay(ctx, this.toScreen, W, H);
  }

  /** A layer of the Earth's tiles at the level of the zoom (at most `maxZ`, magnified beyond), the coarser ones
   *  under them while they come; `layer` names its cache's keys. */
  private drawTiles(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    s: number,
    url: (z: number, x: number, y: number) => string,
    maxZ: number,
    layer: string,
  ) {
    const { z, n, tiles } = tilesFor(this.cx, this.cy, s, W, H, maxZ);
    const size = s / n;
    for (const t of tiles) {
      const px = W / 2 + (t.tx / n - this.cx) * s,
        py = H / 2 + (t.y / n - this.cy) * s;
      const img = this.image(`${layer}${t.z}/${t.x}/${t.y}`, url(t.z, t.x, t.y), () => this.request());
      if (img && img !== "error") {
        ctx.drawImage(img, px, py, size + 0.5, size + 0.5);
        continue;
      }
      // (a coarser tile cut down while this one comes — up to six levels up)
      for (let up = 1; up <= Math.min(6, z); up++) {
        const k = 2 ** up;
        const pz = z - up,
          pxT = Math.floor(t.x / k),
          pyT = Math.floor(t.y / k);
        const p = this.tiles.get(`${layer}${pz}/${pxT}/${pyT}`);
        if (p && p !== "error" && p.complete && p.naturalWidth) {
          const sub = 256 / k;
          ctx.drawImage(p, (t.x % k) * sub, (t.y % k) * sub, sub, sub, px, py, size + 0.5, size + 0.5);
          break;
        }
      }
    }
  }

  /** The Moon's or Mars's map, repeated east and west; the coarse one until the fine one is in. */
  private drawSheet(ctx: CanvasRenderingContext2D, W: number, H: number, s: number) {
    const hd = this.body === "moon" ? moonHd : marsHd;
    const lo = this.body === "moon" ? moonLo : marsLo;
    const load = (u: string) => {
      let im = this.sheets.get(u);
      if (!im) {
        im = new Image();
        im.decoding = "async";
        im.onload = () => this.request();
        im.src = u;
        this.sheets.set(u, im);
      }
      return im.complete && im.naturalWidth ? im : null;
    };
    // (the fine map only once looked at closely: 9 MB)
    const fine = this.zoom > Math.log2(W / 256) + 0.6 ? load(hd) : this.sheets.get(hd)?.complete ? this.sheets.get(hd)! : null;
    const img = fine ?? load(lo);
    if (!img) return;
    const top = H / 2 - this.cy * s;
    for (let k = Math.floor(this.cx - W / 2 / s) - 1; k <= Math.ceil(this.cx + W / 2 / s); k++) {
      const left = W / 2 + (k - this.cx) * s;
      if (left > W || left + s < 0) continue;
      // (only the part on the screen: an 8192 px image drawn whole at zoom 7 is slow)
      const x0 = Math.max(0, -left),
        x1 = Math.min(s, W - left),
        y0 = Math.max(0, -top),
        y1 = Math.min(s / 2, H - top);
      if (x1 <= x0 || y1 <= y0) continue;
      const iw = img.naturalWidth,
        ih = img.naturalHeight;
      ctx.drawImage(
        img,
        (x0 / s) * iw,
        (y0 / (s / 2)) * ih,
        ((x1 - x0) / s) * iw,
        ((y1 - y0) / (s / 2)) * ih,
        left + x0,
        top + y0,
        x1 - x0,
        y1 - y0,
      );
    }
  }
}
