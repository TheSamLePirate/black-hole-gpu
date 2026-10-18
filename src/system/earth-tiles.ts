// The Earth's real ground near the camera: elevation tiles streamed in around it — Mapzen's "Terrarium"
// tiles on AWS's open data (SRTM's 30 m and finer national surveys on land, GMTED, ETOPO1; Web Mercator,
// 256² PNGs, height = R·256 + G + B/256 − 32 768 m) — in nested levels, z 6 to 13 (2.4 km down to 19 m a
// texel at the equator), each a window of 4 × 4 tiles kept round the camera.
//
// Every level brings its imagery too: up to z 8 (611 m) from NASA's GIBS (Global Imagery Browse Services;
// public domain, CORS open) — the Blue Marble Next Generation by day, VIIRS's city lights by night —, finer
// (z 9 … 13, down to 19 m) from EOX's Sentinel-2 cloudless 2021 (10 m, CC BY-NC-SA 4.0, CORS open), its
// colours brought into the Blue Marble's (eoxColour: a power law per channel fitted on nine places), its
// nights the z 8 lights' parent tile, enlarged — the same Web Mercator tiles throughout.
//
// A level's window lives in one layer of a 1024² rg32uint array — its heights' float bits, its imagery
// (rgba8: the day's colour in sRGB, the night's lights; 0: none) —, its tiles at their coordinates modulo
// 4 (a toroidal clipmap): the window follows the camera tile by tile, the tiles it leaves overwritten by
// the ones it enters. A level is drawn only where all its tiles are in (its "valid" rectangle): while it
// moves, the part it keeps; once the new tiles are loaded, all of it. Beyond the windows, and while they
// load, the tracer falls back on the global maps (earth-maps.ts: ETOPO 2022, 4.9 km; the day 2.4 km). The
// same heights on the CPU (heightAt): the ground the ship stands on.

import type { Vec3 } from "../physics";
import { cartToGeodetic, WGS84_A, WGS84_F } from "./ellipsoid";

export const TILE = 256;
/** tiles along a level's window (the normal detail's reach; a farther one, EarthTiles.setReach: 8 on the fine levels) */
export const SPAN = 4;
/** the finest levels a farther reach widens (z 11–13: 8 tiles of z 11 span what 4 of z 10 do — the coarser levels' 4
 *  tiles already reach past them; 8 there was four times the tiles loaded for nothing) */
export const FINE_Z = 11;
export const CLIP = TILE * SPAN;
/** By the detail's reach (settings.detailReach): the windows' tiles a side, the tiles kept in memory past them (a
 *  tile 512 KiB: its heights and its imagery), the finest levels whose next ring round the window is loaded ahead. */
export const TILE_REACH = {
  normal: { span: 4, cache: 0, ring: 0 },
  far: { span: 8, cache: 128, ring: 2 },
  veryFar: { span: 8, cache: 256, ring: 3 },
} as const;
export const Z0 = 6;
export const Z1 = 13;
export const LEVELS = Z1 - Z0 + 1;
/** the floats the tracer's params take: 1 + 2 per level vec4s */
export const TILE_PARAM_VEC4S = 1 + 2 * LEVELS;
/** The data's own resolution [m] (SRTM's 1″): no finer, whatever the level's texel. */
export const TILE_RES_MIN = 25;
/** the finest level with imagery (EOX's Sentinel-2 cloudless, 10 m: every level) */
export const IMG_Z1 = Z1;
/** the finest level from GIBS (the Blue Marble's 500 m, VIIRS's lights): EOX's beyond */
export const GIBS_Z1 = 8;

const R = WGS84_A;
const TAU = 2 * Math.PI;
const MAX_INFLIGHT = 8;
const TIMEOUT_MS = 15000;

export const tileUrl = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
export const dayUrl = (z: number, x: number, y: number) =>
  `${GIBS}/BlueMarble_NextGeneration/default/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`;
export const nightUrl = (z: number, x: number, y: number) =>
  `${GIBS}/VIIRS_Night_Lights/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;
// (licence: s2cloudless 2021 is CC BY-NC-SA 4.0 — non-commercial use only, derivatives under the same licence;
// credited in the panel, the Atlas and the setting's help. The plan allows NC sources; a commercial release needs
// another layer — EOX's 2016 mosaic is CC BY 4.0, not checked here, and EOX_FIT would have to be fitted again:
// docs/systemes/03-univers-ephemerides.md)
export const eoxUrl = (z: number, x: number, y: number) =>
  `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/${z}/${y}/${x}.jpg`;

/**
 * EOX's colours (a mosaic graded for the eye: hazier, bluer) into the Blue Marble's, whose colours the
 * tracer's ground and the coarser levels have — per channel in linear light, b = g · e^k, fitted on nine
 * places' z 8 tiles (forests, farmland, desert, tundra, cities: R² 0.96, 0.94, 0.86), where it was measured:
 * the darker ground. Bright ground (snow, sand, rock, towns) is left as it is — the fit's extrapolation would
 * tint it cyan —, the two blended by the pixel's luminance (no hue moved by a channel's own weight).
 * sRGB 8-bit in, out.
 */
export const EOX_FIT = { gain: [0.894, 1.548, 3.877], power: [0.959, 1.205, 1.487] } as const;
const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const LIN = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
const FIT = [0, 1, 2].map((c) => Float32Array.from(LIN, (v) => Math.min(1, EOX_FIT.gain[c]! * v ** EOX_FIT.power[c]!)));
const TO_SRGB = Uint8Array.from({ length: 4096 }, (_, i) => Math.round(255 * linearToSrgb(i / 4095)));
export function eoxColour(r: number, g: number, b: number): [number, number, number] {
  const e = [LIN[r]!, LIN[g]!, LIN[b]!];
  const lum = 0.2126 * e[0]! + 0.7152 * e[1]! + 0.0722 * e[2]!;
  const x = Math.min(1, Math.max(0, (lum - 0.06) / 0.29)),
    t = x * x * (3 - 2 * x);
  const out = (c: number, v: number) => TO_SRGB[Math.round(4095 * Math.min(1, FIT[c]![v]! * (1 - t) + e[c]! * t))]!;
  return [out(0, r), out(1, g), out(2, b)];
}

/** Mercator's y [tiles, 0 at the north edge] of a latitude's sine, at a level of n tiles. */
const mercY = (sinLat: number, n: number) => (0.5 - Math.atanh(Math.min(Math.max(sinLat, -0.999999), 0.999999)) / TAU) * n;

/** tiles [x0, x1) × [y0, y1), x unwrapped (the date line: x0 < 0 or x1 > n) */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const same = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1);
const inside = (r: Rect | null, x: number, y: number) => !!r && x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
function intersect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || !b) return null;
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x0 < r.x1 && r.y0 < r.y1 ? r : null;
}

interface Level {
  z: number;
  n: number;
  /** its window's tiles a side (SPAN, or the reach's on the fine levels) */
  span: number;
  want: Rect | null;
  valid: Rect | null;
  /** the tile in each slot (x mod span, y mod span) and its heights */
  key: (string | null)[];
  data: (Float32Array | null)[];
  /** its imagery, held on the finest levels only (the ring's: kept past the window when it leaves it) */
  col: (Uint32Array | null)[];
}

/** A tile's pixels (rgba, row by row), as they are in its file — or a square of it (x, y, side [px]) enlarged. */
async function pixels(blob: Blob, crop?: [number, number, number]): Promise<Uint8ClampedArray> {
  const o = { colorSpaceConversion: "none", premultiplyAlpha: "none" } as const;
  const img = crop
    ? await createImageBitmap(blob, crop[0], crop[1], crop[2], crop[2], {
        ...o,
        resizeWidth: TILE,
        resizeHeight: TILE,
        resizeQuality: "medium",
      })
    : await createImageBitmap(blob, o);
  const cv = new OffscreenCanvas(TILE, TILE);
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  img.close();
  return ctx.getImageData(0, 0, TILE, TILE).data;
}

/** The heights of a tile from its PNG (Terrarium's encoding). */
async function decode(blob: Blob): Promise<Float32Array> {
  const px = await pixels(blob);
  const h = new Float32Array(TILE * TILE);
  for (let i = 0; i < h.length; i++) h[i] = px[4 * i]! * 256 + px[4 * i + 1]! + px[4 * i + 2]! / 256 - 32768;
  return h;
}

export interface TileSample {
  /** the levels' height, weighted [m] */
  h: number;
  /** their resolution, weighted [m] */
  res: number;
  /** the weight left to the global map (0: the tiles alone) */
  rem: number;
}

export class EarthTiles {
  texture: GPUTexture;
  /** the fine levels' windows' tiles a side (TILE_REACH: 4, 8 — FINE_Z), the texture's side in texels its CLIP */
  private span = SPAN;
  /** the most the device holds (a farther reach's 256 MiB texture refused: back to SPAN, not asked again) */
  private spanMax = 8;
  private get clip() {
    return TILE * this.span;
  }
  private levelSpan(z: number) {
    return z >= FINE_Z ? this.span : SPAN;
  }
  /** the tiles kept past the windows — most recently used last — and how many (0: none) */
  private cache = new Map<string, { h: Float32Array; col: Uint32Array | null }>();
  private cacheTiles = 0;
  /** the finest levels whose next ring round the window is loaded ahead into the cache (0: none) */
  private ring = 0;
  /** the texture made again for another window (the bind groups holding it rebuilt: the renderer) */
  onResize: (() => void) | null = null;
  private levels: Level[] = [];
  private inflight = new Map<string, AbortController>();
  private failures = new Map<string, { n: number; at: number }>();
  /** the reference (the camera's place) [rad]: the levels' coordinates measured from it */
  private lon = 0;
  private sinLat = 0;
  /** bumped when what the tracer draws changes (a level's valid rectangle) */
  stamp = 0;
  /** heights of the global map (for a tile that will not load: terrain.ts, tileFallbackSampler) */
  fallback: ((q: Vec3) => number) | null = null;
  onChange: (() => void) | null = null;
  /** bumped when a tile already drawn gets its imagery (its heights unchanged: not the stamp — the ground built
   *  from them stays; the renderer redraws a still view for it, at most once in a while) */
  imagery = 0;
  /** tiles loaded, failed (for the readouts) */
  loaded = 0;
  failed = 0;

  constructor(private device: GPUDevice) {
    this.texture = this.makeTexture();
    for (let l = 0; l < LEVELS; l++) {
      const z = Z0 + l;
      const n = this.levelSpan(z);
      this.levels.push({
        z,
        n: 2 ** z,
        span: n,
        want: null,
        valid: null,
        key: new Array(n * n).fill(null),
        data: new Array(n * n).fill(null),
        col: new Array(n * n).fill(null),
      });
    }
  }

  private makeTexture() {
    return this.device.createTexture({
      size: [this.clip, this.clip, LEVELS],
      format: "rg32uint",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: "earth tiles",
    });
  }

  /**
   * The detail's reach (TILE_REACH): the fine levels' windows' tiles a side — another one, the texture made again (the
   * old one destroyed once the work submitted with it is done) and every level drawn anew, its tiles from the cache or
   * loaded again —, the tiles kept past them, the ring loaded ahead. A texture the device cannot hold (out of memory:
   * an iPad's 256 MiB) falls back to 4 tiles, and stays there.
   */
  setReach(r: { span: number; cache: number; ring: number }) {
    this.cacheTiles = r.cache;
    this.ring = r.ring;
    while (this.cache.size > this.cacheTiles) this.cache.delete(this.cache.keys().next().value!);
    const span = Math.min(r.span, this.spanMax);
    if (span === this.span) return;
    this.clear();
    this.span = span;
    const old = this.texture;
    this.device.pushErrorScope?.("out-of-memory");
    this.texture = this.makeTexture();
    void this.device.popErrorScope?.().then((e) => {
      if (!e || this.span === SPAN) return;
      console.warn(`Terrain tiles: the ${this.clip}² texture refused (${e.message}) — the detail's reach kept at ${SPAN} tiles`);
      this.spanMax = SPAN;
      this.setReach({ span: SPAN, cache: this.cacheTiles, ring: this.ring });
    });
    void this.device.queue.onSubmittedWorkDone().then(() => old.destroy());
    for (const L of this.levels) {
      L.span = this.levelSpan(L.z);
      L.key = new Array(L.span * L.span).fill(null);
      L.data = new Array(L.span * L.span).fill(null);
      L.col = new Array(L.span * L.span).fill(null);
    }
    this.stamp++;
    this.onResize?.();
  }

  /** a tile's slot in its level's window (x mod span, y mod span) */
  private slotOf(L: Level, x: number, y: number) {
    const n = L.span;
    return (((y % n) + n) % n) * n + (((x % n) + n) % n);
  }

  /** one of the finest levels wanted, whose ring is loaded ahead and kept */
  private ringLevel(L: Level) {
    if (!this.ring || !L.want) return false;
    let finest = Z0;
    for (const M of this.levels) if (M.want) finest = M.z;
    return L.z > finest - this.ring;
  }

  /** a tile kept past the windows (the least recently used dropped past cacheTiles) */
  private keep(key: string, h: Float32Array, col: Uint32Array | null) {
    if (!this.cacheTiles) return;
    const was = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, { h, col: col ?? was?.col ?? null });
    while (this.cache.size > this.cacheTiles) this.cache.delete(this.cache.keys().next().value!);
  }

  /** the tiles kept in memory past the windows (the detail's reach: the left ones, the ring loaded ahead) */
  get kept() {
    return this.cache.size;
  }

  /** the tiles wanted and not yet in */
  get pending() {
    let k = 0;
    for (const L of this.levels) {
      if (!L.want) continue;
      for (let y = L.want.y0; y < L.want.y1; y++)
        for (let x = L.want.x0; x < L.want.x1; x++) if (L.key[this.slotOf(L, x, y)] !== this.keyOf(L, x, y)) k++;
    }
    return k;
  }
  /** the finest level drawn */
  get finest() {
    let z = 0;
    for (const L of this.levels) if (L.valid) z = L.z;
    return z;
  }

  private keyOf(L: Level, x: number, y: number) {
    return `${L.z}/${((x % L.n) + L.n) % L.n}/${y}`;
  }

  private setValid(L: Level, r: Rect | null) {
    if (same(L.valid, r)) return;
    L.valid = r;
    this.stamp++;
    this.onChange?.();
  }

  /** Drops every level (the Earth far, or the tiles switched off). */
  clear() {
    for (const c of this.inflight.values()) c.abort();
    this.inflight.clear();
    for (const L of this.levels) {
      L.want = null;
      this.setValid(L, null);
    }
  }

  /**
   * Follows the camera: c, on the Earth's axes [its equatorial radii] (float64); pixAngle, a pixel's angle [rad] —
   * the levels wanted, those finer than the ground's footprint under the camera left as they are.
   */
  private priorityLon = 0;
  private prioritySinLat = 0;
  update(c: Vec3 | null, pixAngle: number, lead: Vec3 = [0, 0, 0], gaze: Vec3 = [0, 0, 0]) {
    if (!c) return this.clear();
    // (the camera's geodetic place: the tracer reads the tiles at the geodetic latitude)
    const g = cartToGeodetic(1, WGS84_F, c);
    this.lon = g.lon;
    this.sinLat = Math.sin(g.lat);
    const cosLat = Math.sqrt(Math.max(1 - this.sinLat * this.sinLat, 1e-6));
    const alt = Math.max(g.h * R, 1);
    // (the finest level the nearest ground needs: its texel within the pixel's footprint there)
    const zNeed = Math.min(Math.ceil(Math.log2((TAU * R * cosLat) / (TILE * Math.max(alt * pixAngle, 0.5)))), Z1);
    if (zNeed < Z0) return this.clear();
    // (each window centred ahead where the view looks — gaze: its offset, Earth-fixed —, by up to a tile and a quarter
    // of its own level: what is seen ahead gets the finest heights and imagery, the ground behind the view less)
    const gc = cartToGeodetic(1, WGS84_F, c.map((v, i) => v + gaze[i]!) as Vec3);
    const gLonT = gc.lon / TAU + 0.5,
      gSinLat = Math.sin(gc.lat);
    for (const L of this.levels) {
      if (L.z > zNeed) continue;
      const cx0 = (this.lon / TAU + 0.5) * L.n,
        cy0 = mercY(this.sinLat, L.n);
      const gx = gLonT * L.n - cx0,
        gy = mercY(gSinLat, L.n) - cy0;
      const gl = Math.hypot(gx, gy);
      // (by up to a tile and a quarter of a 4-tile window — half the window less three quarters of a tile)
      const most = L.span / 2 - 0.75;
      const k = gl > most ? most / gl : 1;
      const cx = cx0 + gx * k,
        cy = cy0 + gy * k;
      // (the window recentred once the camera is more than 0.8 of a tile off its middle — or across the
      // date line; at the poles' edges it stays clamped)
      const mid = L.span / 2;
      const x0 = Math.round(cx) - mid;
      const y0 = Math.min(Math.max(Math.round(cy) - mid, 0), L.n - L.span);
      let want = L.want;
      if (!want || Math.abs(cx - (want.x0 + mid)) > 0.8 || (y0 !== want.y0 && Math.abs(cy - (want.y0 + mid)) > 0.8)) {
        want = { x0, y0, x1: x0 + L.span, y1: y0 + L.span };
      }
      if (!same(want, L.want)) {
        L.want = want;
        // (the part kept drawn; the slots the window leaves are about to be overwritten)
        this.setValid(L, intersect(L.valid, want));
        this.complete(L);
      }
    }
    const ahead = cartToGeodetic(1, WGS84_F, c.map((v, i) => v + lead[i]!) as Vec3);
    this.priorityLon = ahead.lon;
    this.prioritySinLat = Math.sin(ahead.lat);
    this.request(cx0(this.priorityLon), this.prioritySinLat);
  }

  /** Starts the loads: the coarse levels first, each from the camera outwards. */
  private request(lonT: number, sinLat: number) {
    const now = performance.now();
    let pending = 0;
    for (const L of this.levels) {
      // (a window drawn whole: nothing to look for — not its tiles' keys made again each frame)
      if (!L.want || same(L.valid, L.want)) continue;
      const cx = lonT * L.n,
        cy = mercY(sinLat, L.n);
      const todo: [number, number, number][] = [];
      for (let y = L.want.y0; y < L.want.y1; y++) {
        for (let x = L.want.x0; x < L.want.x1; x++) {
          const key = this.keyOf(L, x, y);
          if (L.key[this.slotOf(L, x, y)] === key || this.inflight.has(key)) continue;
          // (kept past the window — walked back to, or loaded ahead —: drawn at once)
          const kept = this.cache.get(key);
          if (kept) {
            this.cache.delete(key);
            this.put(L.z, x, y, kept.h, kept.col);
            continue;
          }
          const f = this.failures.get(key);
          if (f && now < f.at) continue;
          todo.push([x, y, (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2]);
        }
      }
      pending += todo.length;
      todo.sort((a, b) => a[2] - b[2]);
      // (the loads limited, not what memory holds: every level's kept tiles drawn at once)
      for (const [x, y] of todo) {
        if (this.inflight.size >= MAX_INFLIGHT) break;
        void this.load(L, x, y);
      }
    }
    // (the windows whole: the next ring round the finest levels' loaded ahead into memory — nearest the lead (the
    // motion's, the gaze's) first, in metres —, half the loads at most: the tiles the windows enter as the craft goes
    // on, drawn at once)
    if (pending || !this.ring || this.inflight.size >= MAX_INFLIGHT / 2) return;
    const ahead: [Level, number, number, number][] = [];
    for (const L of this.levels) {
      const w = L.want;
      if (!w || !this.ringLevel(L)) continue;
      const cx = lonT * L.n,
        cy = mercY(sinLat, L.n);
      for (let y = Math.max(w.y0 - 1, 0); y <= Math.min(w.y1, L.n - 1); y++)
        for (let x = w.x0 - 1; x <= w.x1; x++) {
          if (inside(w, x, y)) continue;
          const key = this.keyOf(L, x, y);
          if (this.cache.has(key) || this.inflight.has(key)) continue;
          const f = this.failures.get(key);
          if (f && now < f.at) continue;
          ahead.push([L, x, y, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / L.n]);
        }
    }
    ahead.sort((a, b) => a[3] - b[3]);
    for (const [L, x, y] of ahead) {
      if (this.inflight.size >= MAX_INFLIGHT / 2) return;
      void this.load(L, x, y, true);
    }
  }

  /** A tile loaded — into its window, or (ahead) into memory past it, drawn if its window has come to it meanwhile. */
  private async load(L: Level, x: number, y: number, ahead = false) {
    const key = this.keyOf(L, x, y);
    const ctl = new AbortController();
    this.inflight.set(key, ctl);
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let h: Float32Array | null = null;
    // (its imagery alongside, on the levels that have some: none if it will not come — the coarser level's
    // there. Never waited for: the heights drawn as they come, the tile written again with its imagery — under
    // its own time limit, given up with the tile)
    const xw = ((x % L.n) + L.n) % L.n;
    const imgCtl = new AbortController();
    const imgTimer = setTimeout(() => imgCtl.abort(), TIMEOUT_MS);
    const relay = () => imgCtl.abort();
    ctl.signal.addEventListener("abort", relay, { once: true });
    // (the relay removed once the imagery is in or given up: none left on the tile's signal)
    const img = (L.z <= IMG_Z1 ? imagery(L.z, xw, y, imgCtl.signal) : Promise.resolve(null)).finally(() => {
      clearTimeout(imgTimer);
      ctl.signal.removeEventListener("abort", relay);
    });
    try {
      const res = await fetch(tileUrl(L.z, xw, y), { signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const heights = await res.blob().then(decode);
      h = heights;
      this.loaded++;
      if (ahead) {
        // (into memory at once — its heights: drawn from there if its window comes to it —, its imagery when it comes:
        // onto the tile if drawn meanwhile)
        this.keep(key, heights, null);
        void img.then((col) => {
          if (!col) return;
          if (L.key[this.slotOf(L, x, y)] === key) this.put(L.z, x, y, heights, col);
          else if (this.cache.has(key)) this.keep(key, heights, col);
        });
        h = null;
      } else
        void img.then((col) => {
          if (col && L.key[this.slotOf(L, x, y)] === key) this.put(L.z, x, y, heights, col);
        });
    } catch (e) {
      if (!this.inflight.has(key)) return; // (cleared)
      const f = this.failures.get(key) ?? { n: 0, at: 0 };
      f.n++;
      f.at = performance.now() + 3000 * f.n;
      this.failures.set(key, f);
      // (asked again once it may be: the image converged, no frame asks — the tile would wait for a move)
      if (f.n < 2) setTimeout(() => this.request(cx0(this.priorityLon), this.prioritySinLat), 3000 * f.n + 10);
      // (twice failed: the global map's heights there, the level not held back)
      if (f.n >= 2) {
        h = this.fromFallback(L, x, y);
        this.failed++;
        if (f.n === 2) console.warn(`Terrain tile ${key} unavailable (${(e as Error).message}): the global map there`);
      }
    } finally {
      clearTimeout(timer);
      if (this.inflight.get(key) === ctl) this.inflight.delete(key);
    }
    if (h) this.put(L.z, x, y, h);
    this.request(cx0(this.priorityLon), this.prioritySinLat);
  }

  /** each tile's highest height (worked out once) */
  private tops = new WeakMap<Float32Array, number>();
  /** The highest height of the tiles held, every level's [m] (−∞: none) — the relief's ceiling (relief-ceiling.ts). */
  top(): number {
    let m = -Infinity;
    for (const L of this.levels)
      for (const d of L.data) {
        if (!d) continue;
        let t = this.tops.get(d);
        if (t === undefined) {
          t = -Infinity;
          for (let i = 0; i < d.length; i++) if (d[i]! > t) t = d[i]!;
          this.tops.set(d, t);
        }
        if (t > m) m = t;
      }
    return m;
  }

  /** A tile's heights in (z, x — unwrapped as its level's window has it —, y; 256² row by row [m]), with
   *  its imagery (rgba8 packed; none: 0): kept and sent to the GPU while its window wants it. */
  put(z: number, x: number, y: number, h: Float32Array, col: Uint32Array | null = null) {
    const L = this.levels[z - Z0];
    if (!L || !inside(L.want, x, y)) return;
    const s = this.slotOf(L, x, y);
    // (the ring's levels: the tile the window leaves kept past it — walked back to, drawn from memory —, this one's
    // imagery held for when it leaves in turn)
    const ringLevel = this.ringLevel(L);
    const old = L.key[s];
    if (ringLevel && old && old !== this.keyOf(L, x, y) && L.data[s]) this.keep(old, L.data[s]!, L.col[s] ?? null);
    L.col[s] = ringLevel ? (col ?? (old === this.keyOf(L, x, y) ? (L.col[s] ?? null) : null)) : null;
    if (col && inside(L.valid, x, y) && L.key[s] === this.keyOf(L, x, y)) this.imagery++;
    L.key[s] = this.keyOf(L, x, y);
    L.data[s] = h;
    const hb = new Uint32Array(h.buffer, h.byteOffset, h.length);
    const texels = new Uint32Array(2 * TILE * TILE);
    for (let i = 0; i < hb.length; i++) {
      texels[2 * i] = hb[i]!;
      texels[2 * i + 1] = col ? col[i]! : 0;
    }
    this.device.queue.writeTexture(
      { texture: this.texture, origin: [(s % L.span) * TILE, Math.floor(s / L.span) * TILE, L.z - Z0] },
      texels,
      { bytesPerRow: TILE * 8 },
      [TILE, TILE, 1],
    );
    this.complete(L);
  }

  /** The tiles each level's window wants (z, x, y): what the loads fetch. */
  wanted(): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (const L of this.levels) {
      if (!L.want) continue;
      for (let y = L.want.y0; y < L.want.y1; y++) for (let x = L.want.x0; x < L.want.x1; x++) out.push([L.z, x, y]);
    }
    return out;
  }

  /** The level drawn whole once all its window's tiles are in. */
  private complete(L: Level) {
    const w = L.want;
    if (!w) return;
    for (let y = w.y0; y < w.y1; y++) for (let x = w.x0; x < w.x1; x++) if (L.key[this.slotOf(L, x, y)] !== this.keyOf(L, x, y)) return;
    this.setValid(L, w);
  }

  private fromFallback(L: Level, x: number, y: number) {
    const h = new Float32Array(TILE * TILE);
    if (!this.fallback) return h;
    for (let j = 0; j < TILE; j++) {
      const m = (0.5 - (y + (j + 0.5) / TILE) / L.n) * TAU;
      const lat = Math.atan(Math.sinh(m));
      for (let i = 0; i < TILE; i++) {
        const lon = ((x + (i + 0.5) / TILE) / L.n - 0.5) * TAU;
        h[j * TILE + i] = this.fallback([Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]);
      }
    }
    return h;
  }

  /**
   * The tracer's params (trace.wgsl: P.tiles, P.tileL): the reference (cos, sin of its longitude, the sine
   * of its latitude, on), then per level the reference's place in its valid rectangle [px], the
   * rectangle's corner in its layer [px], its size [px], its pixels per radian, its window's side in its layer [px]
   * (a power of two, the tracer's wrap: 0 off).
   */
  params(): Float32Array {
    const f = new Float32Array(TILE_PARAM_VEC4S * 4);
    let on = 0;
    for (let l = 0; l < LEVELS; l++) {
      const L = this.levels[l]!;
      const v = L.valid;
      if (!v) continue;
      on = 1;
      const S = L.n * TILE;
      let ax = (this.lon / TAU + 0.5) * S - v.x0 * TILE;
      if (ax > S / 2) ax -= S;
      else if (ax < -S / 2) ax += S;
      const ay = mercY(this.sinLat, L.n) * TILE - v.y0 * TILE;
      const o = 4 + 8 * l;
      const C = TILE * L.span;
      f.set([ax, ay, (((v.x0 * TILE) % C) + C) % C, (v.y0 * TILE) % C], o);
      f.set([(v.x1 - v.x0) * TILE, (v.y1 - v.y0) * TILE, S / TAU, C], o + 4);
    }
    f.set([Math.cos(this.lon), Math.sin(this.lon), this.sinLat, on], 0);
    return f;
  }

  /**
   * The levels' heights at q (unit, the Earth's axes) for a footprint foot [m], as the tracer weighs them
   * (trace.wgsl: earthTiles): the finest level within the footprint and the next coarser, blended by the
   * footprint and towards the windows' edges; what is left to the global map in rem.
   */
  heightAt(q: Vec3, foot: number): TileSample {
    let h = 0,
      res = 0,
      rem = 1;
    const cosLat = Math.sqrt(Math.max(1 - q[2] * q[2], 1e-12));
    // (from the reference, as the tracer measures it)
    const c = Math.cos(this.lon),
      s = Math.sin(this.lon);
    const dlon = Math.atan2(-q[0] * s + q[1] * c, q[0] * c + q[1] * s);
    const sz = Math.min(Math.max(q[2], -0.999999), 0.999999);
    const dM = Math.atanh((sz - this.sinLat) / (1 - sz * this.sinLat));
    const zf = Math.log2((TAU * R * cosLat) / (TILE * Math.max(foot, 0.5)));
    for (let l = LEVELS - 1; l >= 0 && rem > 1e-4; l--) {
      const L = this.levels[l]!;
      const v = L.valid;
      if (!v) continue;
      const wz = Math.min(Math.max(zf - L.z + 1, 0), 1);
      if (wz <= 0) continue;
      const S = L.n * TILE;
      let ax = (this.lon / TAU + 0.5) * S - v.x0 * TILE;
      if (ax > S / 2) ax -= S;
      else if (ax < -S / 2) ax += S;
      const ay = mercY(this.sinLat, L.n) * TILE - v.y0 * TILE;
      const px = ax + (dlon * S) / TAU,
        py = ay - (dM * S) / TAU;
      const w = wz * edge(px, py, (v.x1 - v.x0) * TILE, (v.y1 - v.y0) * TILE);
      if (w <= 0) continue;
      const texel = (TAU * R * cosLat) / S;
      const at = (i: number, j: number) => {
        const gx = v.x0 * TILE + i,
          gy = v.y0 * TILE + j;
        const tx = Math.floor(gx / TILE),
          ty = Math.floor(gy / TILE);
        return L.data[this.slotOf(L, tx, ty)]![(gy - ty * TILE) * TILE + (gx - tx * TILE)]!;
      };
      const hz = sampleLevel(at, px, py, zf - L.z);
      h += rem * w * hz;
      res += rem * w * Math.max(texel, TILE_RES_MIN);
      rem *= 1 - w;
    }
    return { h, res, rem };
  }
}

/**
 * A tile's imagery (GIBS: the day's colour, the night's lights), packed rgba8 — the day's sRGB, the
 * lights' level —, never 0 (the tracer's mark of none); null if either will not come. The lights on the
 * global night map's scale (its Black Marble: a ground of 0.07 under them, cities bloomed to 1): VIIRS's
 * sharper, darker levels v as 0.07 + 0.93 · min(1.06 √v, 1) — its 99.5th percentile over the cities of
 * Japan, Europe and the United States at 1, as the map's.
 */
// (the z 8 lights' tiles the finer levels share — a z 13 window's sixteen tiles under one or four of them:
// fetched once, kept for the last few, never cancelled by one tile's abort)
const parents = new Map<string, Promise<Blob>>();
function parentBlob(url: string): Promise<Blob> {
  let p = parents.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.blob();
    });
    p.catch(() => parents.delete(url));
    parents.set(url, p);
    if (parents.size > 24) parents.delete(parents.keys().next().value!);
  }
  return p;
}
async function imagery(z: number, x: number, y: number, signal: AbortSignal): Promise<Uint32Array | null> {
  try {
    const get = async (url: string, crop?: [number, number, number]) => {
      // (the shared parent raced against this tile's own abort: a stalled request never holds the tile — nor its
      // slot, nor the heights waiting on it)
      if (crop) {
        if (signal.aborted) throw new Error("aborted");
        let stop = () => {};
        const aborted = new Promise<never>((_, no) => {
          stop = () => no(new Error("aborted"));
          signal.addEventListener("abort", stop, { once: true });
        });
        // (its listener removed when the race is over, the parent's blob in or the tile given up)
        try {
          return pixels(await Promise.race([parentBlob(url), aborted]), crop);
        } finally {
          signal.removeEventListener("abort", stop);
        }
      }
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return pixels(await res.blob());
    };
    // (finer than GIBS: EOX's day; the lights' z 8 parent, the tile's square of it enlarged)
    const fine = z > GIBS_Z1;
    const night = nightOf(z, x, y);
    const [d, n] = await Promise.all([
      get(fine ? eoxUrl(z, x, y) : dayUrl(z, x, y)),
      get(nightUrl(night.z, night.x, night.y), night.crop ?? undefined),
    ]);
    const out = new Uint32Array(TILE * TILE);
    for (let i = 0; i < out.length; i++) {
      const v = (n[4 * i]! * n[4 * i + 3]!) / (255 * 255);
      const lights = v > 0 ? Math.round(255 * (0.07 + 0.93 * Math.min(1.06 * Math.sqrt(v), 1))) : 0;
      const [r, g, b] = fine ? eoxColour(d[4 * i]!, d[4 * i + 1]!, d[4 * i + 2]!) : [d[4 * i]!, d[4 * i + 1]!, d[4 * i + 2]!];
      out[i] = (Math.max(r, 1) | (g << 8) | (b << 16) | (lights << 24)) >>> 0;
    }
    return out;
  } catch {
    return null;
  }
}

/** The night's lights for a tile: its own (to z 8), else its z 8 parent and the square of it the tile covers
 *  (x, y, side [px]: enlarged to the tile). */
export function nightOf(z: number, x: number, y: number): { z: number; x: number; y: number; crop: [number, number, number] | null } {
  if (z <= GIBS_Z1) return { z, x, y, crop: null };
  const k = z - GIBS_Z1,
    side = TILE >> k;
  return { z: GIBS_Z1, x: x >> k, y: y >> k, crop: [(x - ((x >> k) << k)) * side, (y - ((y >> k) << k)) * side, side] };
}

/** the reference's longitude in turns from −½ (Mercator's x over the level's width) */
const cx0 = (lon: number) => lon / TAU + 0.5;

/** A level's weight towards its window's edges [px]: none within 2 px of it, full 48 px in. */
export function edge(px: number, py: number, w: number, h: number) {
  const d = Math.min(px, py, w - px, h - py);
  const t = Math.min(Math.max((d - 2) / 46, 0), 1);
  return t * t * (3 - 2 * t);
}

const bspline4 = (t: number) => {
  const t2 = t * t,
    t3 = t2 * t;
  return [(1 - 3 * t + 3 * t2 - t3) / 6, (4 - 6 * t2 + 3 * t3) / 6, (1 + 3 * t + 3 * t2 - 3 * t3) / 6, t3 / 6];
};

/**
 * A level's height at (px, py) [its pixels, from its rectangle's corner]: bilinear, or — its texel more
 * than twice the footprint (mag: by how many octaves larger) — a cubic B-spline over its texels, the two
 * blended over an octave (trace.wgsl: tileSample).
 */
export function sampleLevel(at: (i: number, j: number) => number, px: number, py: number, mag: number) {
  const x = px - 0.5,
    y = py - 0.5;
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = x - x0,
    fy = y - y0;
  const k = Math.min(Math.max(mag - 1, 0), 1);
  let lin = 0;
  if (k < 1) lin = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  if (k <= 0) return lin;
  const wx = bspline4(fx),
    wy = bspline4(fy);
  let b = 0;
  for (let j = 0; j < 4; j++) {
    let row = 0;
    for (let i = 0; i < 4; i++) row += wx[i]! * at(x0 + i - 1, y0 + j - 1);
    b += wy[j]! * row;
  }
  return lin + (b - lin) * k;
}
