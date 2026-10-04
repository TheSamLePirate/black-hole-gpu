// The Earth's real ground near the camera: elevation tiles streamed in around it — Mapzen's "Terrarium"
// tiles on AWS's open data (SRTM's 30 m and finer national surveys on land, GMTED, ETOPO1; Web Mercator,
// 256² PNGs, height = R·256 + G + B/256 − 32 768 m) — in nested levels, z 6 to 13 (2.4 km down to 19 m a
// texel at the equator), each a window of 4 × 4 tiles kept round the camera.
//
// A level's window lives in one layer of a 1024² r32float array, its tiles at their coordinates modulo 4
// (a toroidal clipmap): the window follows the camera tile by tile, the tiles it leaves overwritten by the
// ones it enters. A level is drawn only where all its tiles are in (its "valid" rectangle): while it
// moves, the part it keeps; once the new tiles are loaded, all of it. Beyond the windows, and while they
// load, the tracer falls back on the global map (earth-maps.ts: ETOPO 2022, 4.9 km). The same heights on
// the CPU (heightAt): the ground the ship stands on.

import type { Vec3 } from "../physics";
import { cartToGeodetic, WGS84_A, WGS84_F } from "./ellipsoid";

export const TILE = 256;
/** tiles along a level's window */
export const SPAN = 4;
export const CLIP = TILE * SPAN;
export const Z0 = 6;
export const Z1 = 13;
export const LEVELS = Z1 - Z0 + 1;
/** the floats the tracer's params take: 1 + 2 per level vec4s */
export const TILE_PARAM_VEC4S = 1 + 2 * LEVELS;
/** The data's own resolution [m] (SRTM's 1″): no finer, whatever the level's texel. */
export const TILE_RES_MIN = 25;

const R = WGS84_A;
const TAU = 2 * Math.PI;
const MAX_INFLIGHT = 8;
const TIMEOUT_MS = 15000;

export const tileUrl = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

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
  want: Rect | null;
  valid: Rect | null;
  /** the tile in each slot (x mod 4, y mod 4) and its heights */
  key: (string | null)[];
  data: (Float32Array | null)[];
}

const slotOf = (x: number, y: number) => (((y % SPAN) + SPAN) % SPAN) * SPAN + (((x % SPAN) + SPAN) % SPAN);

/** The heights of a tile from its PNG (Terrarium's encoding). */
async function decode(blob: Blob): Promise<Float32Array> {
  const img = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const cv = new OffscreenCanvas(TILE, TILE);
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  img.close();
  const px = ctx.getImageData(0, 0, TILE, TILE).data;
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
  readonly texture: GPUTexture;
  private levels: Level[] = [];
  private inflight = new Map<string, AbortController>();
  private failures = new Map<string, { n: number; at: number }>();
  /** the reference (the camera's place) [rad]: the levels' coordinates measured from it */
  private lon = 0;
  private sinLat = 0;
  /** bumped when what the tracer draws changes (a level's valid rectangle) */
  stamp = 0;
  /** heights of the global map (for a tile that will not load) */
  fallback: ((q: Vec3) => number) | null = null;
  onChange: (() => void) | null = null;
  /** tiles loaded, failed (for the readouts) */
  loaded = 0;
  failed = 0;

  constructor(private device: GPUDevice) {
    this.texture = device.createTexture({
      size: [CLIP, CLIP, LEVELS],
      format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: "earth tiles",
    });
    for (let l = 0; l < LEVELS; l++) {
      const z = Z0 + l;
      this.levels.push({
        z,
        n: 2 ** z,
        want: null,
        valid: null,
        key: new Array(SPAN * SPAN).fill(null),
        data: new Array(SPAN * SPAN).fill(null),
      });
    }
  }

  /** the tiles wanted and not yet in */
  get pending() {
    let k = 0;
    for (const L of this.levels) {
      if (!L.want) continue;
      for (let y = L.want.y0; y < L.want.y1; y++)
        for (let x = L.want.x0; x < L.want.x1; x++) if (L.key[slotOf(x, y)] !== this.keyOf(L, x, y)) k++;
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
  update(c: Vec3 | null, pixAngle: number) {
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
    for (const L of this.levels) {
      if (L.z > zNeed) continue;
      const cx = (this.lon / TAU + 0.5) * L.n;
      const cy = mercY(this.sinLat, L.n);
      // (the window recentred once the camera is more than 0.8 of a tile off its middle — or across the
      // date line; at the poles' edges it stays clamped)
      const mid = SPAN / 2;
      const x0 = Math.round(cx) - mid;
      const y0 = Math.min(Math.max(Math.round(cy) - mid, 0), L.n - SPAN);
      let want = L.want;
      if (!want || Math.abs(cx - (want.x0 + mid)) > 0.8 || (y0 !== want.y0 && Math.abs(cy - (want.y0 + mid)) > 0.8)) {
        want = { x0, y0, x1: x0 + SPAN, y1: y0 + SPAN };
      }
      if (!same(want, L.want)) {
        L.want = want;
        // (the part kept drawn; the slots the window leaves are about to be overwritten)
        this.setValid(L, intersect(L.valid, want));
        this.complete(L);
      }
    }
    this.request(cx0(this.lon), this.sinLat);
  }

  /** Starts the loads: the coarse levels first, each from the camera outwards. */
  private request(lonT: number, sinLat: number) {
    if (this.inflight.size >= MAX_INFLIGHT) return;
    const now = performance.now();
    for (const L of this.levels) {
      if (!L.want) continue;
      const cx = lonT * L.n,
        cy = mercY(sinLat, L.n);
      const todo: [number, number, number][] = [];
      for (let y = L.want.y0; y < L.want.y1; y++) {
        for (let x = L.want.x0; x < L.want.x1; x++) {
          const key = this.keyOf(L, x, y);
          if (L.key[slotOf(x, y)] === key || this.inflight.has(key)) continue;
          const f = this.failures.get(key);
          if (f && now < f.at) continue;
          todo.push([x, y, (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2]);
        }
      }
      todo.sort((a, b) => a[2] - b[2]);
      for (const [x, y] of todo) {
        if (this.inflight.size >= MAX_INFLIGHT) return;
        void this.load(L, x, y);
      }
    }
  }

  private async load(L: Level, x: number, y: number) {
    const key = this.keyOf(L, x, y);
    const ctl = new AbortController();
    this.inflight.set(key, ctl);
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let h: Float32Array | null = null;
    try {
      const res = await fetch(tileUrl(L.z, ((x % L.n) + L.n) % L.n, y), { signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      h = await decode(await res.blob());
      this.loaded++;
    } catch (e) {
      if (!this.inflight.has(key)) return; // (cleared)
      const f = this.failures.get(key) ?? { n: 0, at: 0 };
      f.n++;
      f.at = performance.now() + 3000 * f.n;
      this.failures.set(key, f);
      // (asked again once it may be: the image converged, no frame asks — the tile would wait for a move)
      if (f.n < 2) setTimeout(() => this.request(cx0(this.lon), this.sinLat), 3000 * f.n + 10);
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
    this.request(cx0(this.lon), this.sinLat);
  }

  /** A tile's heights in (z, x — unwrapped as its level's window has it —, y; 256² row by row [m]):
   *  kept and sent to the GPU while its window wants it. */
  put(z: number, x: number, y: number, h: Float32Array) {
    const L = this.levels[z - Z0];
    if (!L || !inside(L.want, x, y)) return;
    const s = slotOf(x, y);
    L.key[s] = this.keyOf(L, x, y);
    L.data[s] = h;
    this.device.queue.writeTexture(
      { texture: this.texture, origin: [(s % SPAN) * TILE, Math.floor(s / SPAN) * TILE, L.z - Z0] },
      h as Float32Array<ArrayBuffer>,
      { bytesPerRow: TILE * 4 },
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
    for (let y = w.y0; y < w.y1; y++) for (let x = w.x0; x < w.x1; x++) if (L.key[slotOf(x, y)] !== this.keyOf(L, x, y)) return;
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
   * rectangle's corner in its layer [px], its size [px], its pixels per radian, on.
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
      f.set([ax, ay, (((v.x0 * TILE) % CLIP) + CLIP) % CLIP, (v.y0 * TILE) % CLIP], o);
      f.set([(v.x1 - v.x0) * TILE, (v.y1 - v.y0) * TILE, S / TAU, 1], o + 4);
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
        return L.data[slotOf(tx, ty)]![(gy - ty * TILE) * TILE + (gx - tx * TILE)]!;
      };
      const hz = sampleLevel(at, px, py, zf - L.z);
      h += rem * w * hz;
      res += rem * w * Math.max(texel, TILE_RES_MIN);
      rem *= 1 - w;
    }
    return { h, res, rem };
  }
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
