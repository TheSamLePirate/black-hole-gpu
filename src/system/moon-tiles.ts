// The Moon's real ground near the camera (PLAN-PLANETES-AAA P6): LRO LOLA's 118 m model in tiles (src/system/lola-codec.ts,
// made once on the room server — server/moon-tiles.ts — and served by it, CORS open) streamed in around the camera, in four
// nested levels (z 0: 1° a tile, 118 m a texel … z 3: 8°, 948 m), each a window of 4 × 4 tiles — the Earth's tiles'
// scheme (earth-tiles.ts), equirectangular here. A level's window lives in one layer of a 1024² rg32uint array — its
// heights' float bits; its imagery channel unused (0) —, its tiles at their coordinates modulo 4 (a toroidal clipmap). The
// tracer reads it through the Earth's tiles' binding and parameters (binding 28, P.tiles, P.tileL — the Earth's are off
// whenever the Moon is the near body), P.tiles.w −1 its mark (trace.wgsl moonH); beyond the windows, and while they load,
// the global map (hd-maps.ts: LDEM_64, 2.7 km a texel). The same heights on the CPU (heightAt): the ground stood on.
// A tile the server has not yet (its build under way: 404) is filled from the global map, and asked again later.
//
// Each level's tiles carry the albedo's finer detail too, in the imagery channel: Clementine's UVVIS 750 nm mosaic (NASA
// Moon Trek's WMTS, public domain, CORS open — taken with the Sun high: no shadows in it, unlike LROC's WAC mosaic), 91
// pixels a degree (333 m) at its finest, resampled onto the level's texels; the tracer takes the finest level's over the
// coarsest's as a factor on the calibrated global map's colour (trace.wgsl moonDetail).

import type { Vec3 } from "../physics";
import { edge, pixels } from "./earth-tiles";
import { LOLA_LEVELS, LOLA_SCALE, LOLA_TILE, lolaCols, lolaDecode, lolaRows } from "./lola-codec";

const TILE = LOLA_TILE;
export const MOON_SPAN = 4;
const CLIP = TILE * MOON_SPAN;
/** the floats the tracer's params take (vec4s): the reference, then 2 per level — inside the Earth's (TILE_PARAM_VEC4S) */
export const MOON_PARAM_VEC4S = 1 + 2 * LOLA_LEVELS;
const TAU = 2 * Math.PI;
const MAX_INFLIGHT = 8;
const TIMEOUT_MS = 20000;
/** a tile the server had not: asked again after this long [ms] (its build under way) */
const RETRY_MS = 120000;
/** the tiles kept past the windows (each 256 KiB as floats) */
const CACHE_TILES = 96;

/** where the tiles are: the room server's; on a local server, its own when it has a box built (data/moon/lola) */
export const LOLA_REMOTE = "https://stream.samlepirate.org/svc/v1/moon/lola";
let base: Promise<string> | null = null;
export function lolaBase(): Promise<string> {
  const forced = (globalThis as { __lolaBase?: string }).__lolaBase;
  if (forced) return Promise.resolve(forced);
  if (base) return base;
  const host = typeof location === "undefined" ? "" : location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return (base = Promise.resolve(LOLA_REMOTE));
  const local = `${location.origin}/svc/v1/moon/lola`;
  base = fetch(`${local}/status`)
    .then((r) => (r.ok ? r.json() : null))
    .then((s: { rows?: number } | null) => ((s?.rows ?? 0) > 0 ? local : LOLA_REMOTE))
    .catch(() => LOLA_REMOTE);
  return base;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Level {
  l: number;
  cols: number;
  rows: number;
  /** pixels round the Moon */
  S: number;
  want: Rect | null;
  valid: Rect | null;
  key: (string | null)[];
  data: (Float32Array | null)[];
  /** each slot's albedo (clemAlbedo; null: none yet) */
  col: (Uint32Array | null)[];
}

/** Clementine's mosaic (Moon Trek's WMTS: equirectangular, z t a tile 180/2^t degrees, 256² grey PNGs) */
export const CLEM_URL = "https://trek.nasa.gov/tiles/Moon/EQ/Clem_UVVIS_Mosaic_Global_256ppd_v02/1.0.0/default/default028mm";
/** the Trek level a level's imagery is taken from: its finest (z 6, 91 a degree) but no more than ~6 tiles across a window */
export const clemLevel = (l: number) => Math.min(6, Math.floor(Math.log2(270 / 2 ** l)));
const clemTiles = new Map<string, Promise<Uint8Array | null>>();
function clemTile(t: number, row: number, col: number): Promise<Uint8Array | null> {
  const key = `${t}/${row}/${col}`;
  let p = clemTiles.get(key);
  if (!p) {
    p = fetch(`${CLEM_URL}/${t}/${row}/${col}.png`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then(async (r) => {
        if (!r.ok) return null;
        const px = await pixels(await r.blob());
        const g = new Uint8Array(TILE * TILE);
        for (let i = 0; i < g.length; i++) g[i] = px[4 * i]!;
        return g;
      })
      .catch(() => null);
    clemTiles.set(key, p);
    while (clemTiles.size > 160) clemTiles.delete(clemTiles.keys().next().value!);
  }
  return p;
}
/** A level's tile's albedo from Clementine (packed: the grey in r, 255 in a — never 0, the tracer's mark of none), bilinear on
 *  the mosaic's pixels; null if a tile of it will not come. */
export async function clemAlbedo(l: number, x: number, y: number): Promise<Uint32Array | null> {
  const t = clemLevel(l),
    cols = 2 * 2 ** t,
    rows = 2 ** t;
  const D = 2 ** l;
  const lon0 = -180 + x * D,
    lat0 = 90 - y * D;
  const X = (lon: number) => ((lon + 180) / 360) * cols * TILE - 0.5;
  const Y = (lat: number) => ((90 - lat) / 180) * rows * TILE - 0.5;
  const tx0 = Math.floor(X(lon0) / TILE) - 1,
    tx1 = Math.floor(X(lon0 + D) / TILE) + 1;
  const ty0 = Math.max(Math.floor(Y(lat0) / TILE) - 1, 0),
    ty1 = Math.min(Math.floor(Y(lat0 - D) / TILE) + 1, rows - 1);
  const got = new Map<string, Uint8Array>();
  const loads: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const c = ((tx % cols) + cols) % cols;
      loads.push(
        clemTile(t, ty, c).then((g) => {
          if (g) got.set(`${ty}/${c}`, g);
        }),
      );
    }
  await Promise.all(loads);
  const at = (px: number, py: number) => {
    const yy = Math.min(Math.max(py, 0), rows * TILE - 1);
    const xx = ((px % (cols * TILE)) + cols * TILE) % (cols * TILE);
    const g = got.get(`${Math.floor(yy / TILE)}/${Math.floor(xx / TILE)}`);
    return g ? g[(yy % TILE) * TILE + (xx % TILE)]! : -1;
  };
  const out = new Uint32Array(TILE * TILE);
  for (let j = 0; j < TILE; j++) {
    const py = Y(lat0 - ((j + 0.5) / TILE) * D);
    const y0 = Math.floor(py),
      fy = py - y0;
    for (let i = 0; i < TILE; i++) {
      const px = X(lon0 + ((i + 0.5) / TILE) * D);
      const x0 = Math.floor(px),
        fx = px - x0;
      const a = at(x0, y0),
        b = at(x0 + 1, y0),
        c = at(x0, y0 + 1),
        d = at(x0 + 1, y0 + 1);
      if (a < 0 || b < 0 || c < 0 || d < 0) return null;
      const v = Math.round((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy);
      out[j * TILE + i] = (Math.max(v, 1) | 0xff000000) >>> 0;
    }
  }
  return out;
}

const same = (a: Rect | null, b: Rect | null) =>
  (!a && !b) || (!!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1);
const inside = (r: Rect | null, x: number, y: number) => !!r && x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
function intersect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || !b) return null;
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x0 < r.x1 && r.y0 < r.y1 ? r : null;
}

export class MoonTiles {
  texture: GPUTexture;
  private levels: Level[] = [];
  private cache = new Map<string, { h: Float32Array; col: Uint32Array | null }>();
  private inflight = new Map<string, AbortController>();
  private missing = new Map<string, number>();
  /** the reference (the camera's place) [rad] */
  private lon = 0;
  private lat = 0;
  /** drawn: the tracer reads the tiles (the Moon near, its global map in) */
  active = false;
  /** wanted (off: the global map alone — an A/B, __bh.renderer.moonTiles.enabled) */
  enabled = true;
  /** bumped when what the tracer draws changes (a level's valid rectangle) */
  stamp = 0;
  /** heights of the global map [m] at a unit direction on the Moon's axes: a tile the server has not yet */
  fallback: ((q: Vec3) => number) | null = null;
  onChange: (() => void) | null = null;
  /** the tracer's binding changed (active switched): the bind groups rebuilt */
  onSwitch: (() => void) | null = null;
  loaded = 0;
  failed = 0;
  /** bumped when a tile's albedo comes in */
  imagery = 0;
  /** where the tiles come from (lolaBase: the local server's box, or the room server's) */
  source = "";
  /** the highest height in the windows [m] (the marches' bound over the global map's: trace.wgsl demTop) */
  top = -Infinity;
  private tops = new WeakMap<Float32Array, number>();

  constructor(private device: GPUDevice) {
    this.texture = device.createTexture({
      size: [CLIP, CLIP, LOLA_LEVELS],
      format: "rg32uint",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: "moon tiles",
    });
    for (let l = 0; l < LOLA_LEVELS; l++)
      this.levels.push({
        l,
        cols: lolaCols(l),
        rows: lolaRows(l),
        S: lolaCols(l) * TILE,
        want: null,
        valid: null,
        key: new Array(MOON_SPAN ** 2).fill(null),
        data: new Array(MOON_SPAN ** 2).fill(null),
        col: new Array(MOON_SPAN ** 2).fill(null),
      });
  }

  /** whether any level is drawn */
  get drawn() {
    return this.active && this.levels.some((L) => L.valid);
  }
  /** tiles still loading */
  get pending() {
    return this.inflight.size;
  }

  private slotOf(L: Level, x: number, y: number) {
    return (((y % MOON_SPAN) + MOON_SPAN) % MOON_SPAN) * MOON_SPAN + (((x % MOON_SPAN) + MOON_SPAN) % MOON_SPAN);
  }
  private keyOf(L: Level, x: number, y: number) {
    return `${L.l}/${y}/${((x % L.cols) + L.cols) % L.cols}`;
  }
  private setValid(L: Level, r: Rect | null) {
    if (same(L.valid, r)) return;
    L.valid = r;
    this.stamp++;
    this.updateTop();
    this.onChange?.();
  }
  private setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.onSwitch?.();
  }

  /** Off: no level drawn, the loads stopped (the Moon left). */
  clear() {
    for (const c of this.inflight.values()) c.abort();
    this.inflight.clear();
    for (const L of this.levels) {
      L.want = null;
      this.setValid(L, null);
    }
    this.setActive(false);
  }

  /**
   * The camera on the Moon's axes (a unit direction, c) and its height over the ground [m]; the pixel's angle [rad]: the
   * windows round it, the levels its footprint needs (none past z 3's 948 m: the global map's).
   */
  update(c: Vec3 | null, alt: number, pixAngle: number) {
    if (!c || !this.enabled) return this.clear();
    const r = Math.hypot(...c) || 1;
    this.lon = Math.atan2(c[1], c[0]);
    this.lat = Math.asin(Math.max(-1, Math.min(1, c[2] / r)));
    const foot = Math.max(alt, 1) * pixAngle;
    // (the coarsest level whose texel is still within twice the nearest ground's footprint; past z 3, none)
    const R = 1737400;
    const lNeed = Math.floor(Math.log2((2 * foot) / ((TAU * R) / this.levels[0]!.S)));
    if (lNeed >= LOLA_LEVELS) return this.clear();
    this.setActive(true);
    for (const L of this.levels) {
      const cx = (this.lon / TAU + 0.5) * L.cols,
        cy = (0.5 - this.lat / Math.PI) * (L.S / 2 / TILE);
      const mid = MOON_SPAN / 2;
      const x0 = Math.round(cx) - mid;
      const y0 = Math.min(Math.max(Math.round(cy) - mid, 0), L.rows - MOON_SPAN);
      let want = L.want;
      if (!want || Math.abs(cx - (want.x0 + mid)) > 0.8 || (y0 !== want.y0 && Math.abs(cy - (want.y0 + mid)) > 0.8))
        want = { x0, y0, x1: x0 + MOON_SPAN, y1: y0 + MOON_SPAN };
      if (!same(want, L.want)) {
        L.want = want;
        this.setValid(L, intersect(L.valid, want));
        this.complete(L);
      }
    }
    this.request();
  }

  /** Starts the loads: the coarse levels first, each from the camera outwards; tiles kept, or missing, put at once. */
  private request() {
    const now = performance.now();
    for (let l = LOLA_LEVELS - 1; l >= 0; l--) {
      const L = this.levels[l]!;
      const w = L.want;
      if (!w) continue;
      const cx = (this.lon / TAU + 0.5) * L.cols - 0.5,
        cy = (0.5 - this.lat / Math.PI) * (L.S / 2 / TILE) - 0.5;
      const todo: [number, number, number][] = [];
      for (let y = w.y0; y < w.y1; y++)
        for (let x = w.x0; x < w.x1; x++) {
          const key = this.keyOf(L, x, y);
          if (L.key[this.slotOf(L, x, y)] === key) continue;
          const kept = this.cache.get(key);
          if (kept) {
            this.put(L, x, y, kept.h, kept.col);
            if (!kept.col) this.albedo(L, x, y);
            continue;
          }
          const miss = this.missing.get(key);
          if (miss !== undefined && now - miss < RETRY_MS) {
            this.put(L, x, y, this.fromFallback(L, x, y), null);
            this.albedo(L, x, y);
            continue;
          }
          if (!this.inflight.has(key)) todo.push([Math.hypot(x - cx, y - cy), x, y]);
        }
      todo.sort((a, b) => a[0] - b[0]);
      for (const [, x, y] of todo) {
        if (this.inflight.size >= MAX_INFLIGHT) return;
        this.load(L, x, y);
      }
    }
  }

  private load(L: Level, x: number, y: number) {
    const key = this.keyOf(L, x, y);
    const ac = new AbortController();
    this.inflight.set(key, ac);
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const xx = ((x % L.cols) + L.cols) % L.cols;
    void lolaBase()
      .then((b) => {
        this.source = b;
        return fetch(`${b}/${L.l}/${y}/${xx}.bin`, { signal: ac.signal });
      })
      .then(async (r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // (gzipped by the server: the browser has undone it)
        const q = lolaDecode(new Uint8Array(await r.arrayBuffer()));
        const h = new Float32Array(q.length);
        for (let i = 0; i < q.length; i++) h[i] = q[i]! * LOLA_SCALE;
        return h;
      })
      .then((h) => {
        if (h) {
          this.loaded++;
          this.keep(key, h, null);
        } else {
          this.missing.set(key, performance.now());
          h = this.fromFallback(L, x, y);
        }
        if (inside(L.want, x, y)) {
          this.put(L, x, y, h, null);
          this.albedo(L, x, y);
        }
      })
      .catch(() => {
        if (ac.signal.aborted && !this.inflight.has(key)) return;
        this.failed++;
        this.missing.set(key, performance.now());
        if (inside(L.want, x, y)) {
          this.put(L, x, y, this.fromFallback(L, x, y), null);
          this.albedo(L, x, y);
        }
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.inflight.get(key) === ac) this.inflight.delete(key);
        if (this.active) this.request();
      });
  }

  /** a tile's albedo (Clementine), once its heights are in: into its slot, and kept with them */
  private albedo(L: Level, x: number, y: number) {
    const key = this.keyOf(L, x, y);
    void clemAlbedo(L.l, ((x % L.cols) + L.cols) % L.cols, y).then((col) => {
      if (!col) return;
      const s = this.slotOf(L, x, y);
      if (L.key[s] !== key || !L.data[s]) return;
      const kept = this.cache.get(key);
      if (kept) kept.col = col;
      this.put(L, x, y, L.data[s]!, col);
      this.imagery++;
      this.onChange?.();
    });
  }

  private keep(key: string, h: Float32Array, col: Uint32Array | null) {
    this.cache.delete(key);
    this.cache.set(key, { h, col });
    while (this.cache.size > CACHE_TILES) this.cache.delete(this.cache.keys().next().value!);
  }

  /** A tile's heights [m] and albedo (none: 0) into its window's slot: sent to the GPU. */
  private put(L: Level, x: number, y: number, h: Float32Array, col: Uint32Array | null) {
    const s = this.slotOf(L, x, y);
    L.key[s] = this.keyOf(L, x, y);
    L.data[s] = h;
    L.col[s] = col;
    const hb = new Uint32Array(h.buffer, h.byteOffset, TILE * TILE);
    const texels = new Uint32Array(2 * TILE * TILE);
    for (let i = 0; i < hb.length; i++) {
      texels[2 * i] = hb[i]!;
      texels[2 * i + 1] = col ? col[i]! : 0;
    }
    this.device.queue.writeTexture(
      { texture: this.texture, origin: [(s % MOON_SPAN) * TILE, Math.floor(s / MOON_SPAN) * TILE, L.l] },
      texels,
      { bytesPerRow: TILE * 8 },
      [TILE, TILE, 1],
    );
    this.complete(L);
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
    const deg = 2 ** L.l;
    for (let j = 0; j < TILE; j++) {
      const lat = ((90 - (y + (j + 0.5) / TILE) * deg) * Math.PI) / 180;
      for (let i = 0; i < TILE; i++) {
        const lon = ((-180 + (x + (i + 0.5) / TILE) * deg) * Math.PI) / 180;
        h[j * TILE + i] = this.fallback([Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]);
      }
    }
    return h;
  }

  private updateTop() {
    let m = -Infinity;
    for (const L of this.levels) {
      if (!L.valid) continue;
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
    }
    this.top = m;
  }

  /** a level's reference place in its valid rectangle [px] */
  private anchor(L: Level, v: Rect): [number, number] {
    let ax = (this.lon / TAU + 0.5) * L.S - v.x0 * TILE;
    if (ax > L.S / 2) ax -= L.S;
    else if (ax < -L.S / 2) ax += L.S;
    return [ax, (0.5 - this.lat / Math.PI) * (L.S / 2) - v.y0 * TILE];
  }

  /**
   * The tracer's params (trace.wgsl: P.tiles, P.tileL — moonH): the reference (cos, sin of its longitude, the sine of its
   * latitude, −1: the Moon's), then per level the reference's place in its valid rectangle [px], the rectangle's corner
   * in its layer [px], its size [px], its pixels per radian, its window's side (0: off); P.tileL[8].x the windows' highest
   * height [m].
   */
  params(): Float32Array {
    const f = new Float32Array((MOON_PARAM_VEC4S + 1) * 4);
    for (const L of this.levels) {
      const v = L.valid;
      if (!v || !this.active) continue;
      const [ax, ay] = this.anchor(L, v);
      const o = 4 + 8 * L.l;
      f.set([ax, ay, (((v.x0 * TILE) % CLIP) + CLIP) % CLIP, (v.y0 * TILE) % CLIP], o);
      f.set([(v.x1 - v.x0) * TILE, (v.y1 - v.y0) * TILE, L.S / TAU, CLIP], o + 4);
    }
    f.set([Math.cos(this.lon), Math.sin(this.lon), Math.sin(this.lat), this.drawn ? -1 : 0], 0);
    f[4 + 8 * LOLA_LEVELS] = Number.isFinite(this.top) ? this.top : 0;
    return f;
  }

  /**
   * The levels' height at a unit direction on the Moon's axes, for a footprint [m] (trace.wgsl moonH, the same): the
   * finest within it and the next coarser, blended by the footprint and towards their windows' edges; rem the weight left
   * to the global map.
   */
  heightAt(q: Vec3, foot: number): { h: number; rem: number } {
    let h = 0,
      rem = 1;
    if (!this.drawn) return { h, rem };
    const c = Math.cos(this.lon),
      s = Math.sin(this.lon);
    const dlon = Math.atan2(-q[0] * s + q[1] * c, q[0] * c + q[1] * s);
    const dlat = latFrom(q, Math.sin(this.lat));
    const R = 1737400;
    for (let l = 0; l < LOLA_LEVELS && rem > 1e-4; l++) {
      const L = this.levels[l]!;
      const v = L.valid;
      if (!v) continue;
      // (the footprint's level: a level whose texel is under half the footprint left to the coarser one)
      const zf = Math.log2((TAU * R) / (L.S * Math.max(foot, 0.5)));
      const wz = Math.min(Math.max(zf + 1, 0), 1);
      if (wz <= 0) continue;
      const [ax, ay] = this.anchor(L, v);
      const px = ax + (dlon * L.S) / TAU,
        py = ay - (dlat * L.S) / TAU;
      const w = wz * edge(px, py, (v.x1 - v.x0) * TILE, (v.y1 - v.y0) * TILE);
      if (w <= 0) continue;
      const at = (i: number, j: number) => {
        const gx = v.x0 * TILE + i,
          gy = v.y0 * TILE + j;
        const tx = Math.floor(gx / TILE),
          ty = Math.floor(gy / TILE);
        return L.data[this.slotOf(L, tx, ty)]![(gy - ty * TILE) * TILE + (gx - tx * TILE)]!;
      };
      h += rem * w * moonSample(at, px, py);
      rem *= 1 - w;
    }
    return { h, rem };
  }
}

/** A monotone cubic through four samples, at f between the middle two (trace.wgsl monoCubic: Fritsch–Butland's slopes). */
const monoCubic = (p0: number, p1: number, p2: number, p3: number, f: number) => {
  const d0 = p1 - p0,
    d1 = p2 - p1,
    d2 = p3 - p2;
  const m1 = d0 * d1 > 0 ? (2 * d0 * d1) / (d0 + d1) : 0;
  const m2 = d1 * d2 > 0 ? (2 * d1 * d2) / (d1 + d2) : 0;
  const f2 = f * f,
    f3 = f2 * f;
  return (2 * f3 - 3 * f2 + 1) * p1 + (f3 - 2 * f2 + f) * m1 + (-2 * f3 + 3 * f2) * p2 + (f3 - f2) * m2;
};

/** A level's height at (px, py) [its pixels from its rectangle's corner]: a monotone cubic through its 4 × 4 texels
 *  (trace.wgsl moonSample, the same — its exact path). */
export function moonSample(at: (i: number, j: number) => number, px: number, py: number) {
  const x = px - 0.5,
    y = py - 0.5;
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const rows = [0, 1, 2, 3].map((j) =>
    monoCubic(at(x0 - 1, y0 + j - 1), at(x0, y0 + j - 1), at(x0 + 1, y0 + j - 1), at(x0 + 2, y0 + j - 1), x - x0),
  );
  return monoCubic(rows[0]!, rows[1]!, rows[2]!, rows[3]!, y - y0);
}

/** a direction's latitude less the reference's (its sine) [rad], without the float's cancellation near it (trace.wgsl moonH) */
export function latFrom(q: Vec3, sinRef: number) {
  const cosRef = Math.sqrt(Math.max(1 - sinRef * sinRef, 0));
  const rho = Math.hypot(q[0], q[1]);
  return Math.atan2(q[2] * cosRef - rho * sinRef, rho * cosRef + q[2] * sinRef);
}
