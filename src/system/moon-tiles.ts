// The real ground near the camera on the Moon and Mars (PLAN-PLANETES-AAA P6, P7): their global relief models in tiles
// (src/system/lola-codec.ts — the Moon's LRO LOLA 118 m, Mars's HRSC and MOLA blend at 200 m, resampled —, made once on the
// room server — server/moon-tiles.ts — and served by it, CORS open) streamed in around the camera, in four nested levels
// (z 0: 1° a tile, 256 texels a degree … z 3: 8°), each a window of 4 × 4 tiles — the Earth's tiles' scheme (earth-tiles.ts),
// equirectangular here. Mars has four finer levels before them (z −4 … −1: down to 1/16° a tile, ~14 m a texel) carrying
// imagery alone: their heights are not read. A level's window lives in one layer of a 1024² rg32uint array — its heights'
// float bits, its imagery (rgba8) —, its tiles at their coordinates modulo 4 (a toroidal clipmap). The tracer reads it
// through the Earth's tiles' binding and parameters (binding 28, P.tiles, P.tileL — the Earth's are off whenever another
// world is the near body), P.tiles.w −1 its mark (trace.wgsl moonH); beyond the windows, and while they load, the global
// map (hd-maps.ts: the Moon's LDEM_64, 2.7 km a texel; Mars's MEGDR, 5 km). The same heights on the CPU (heightAt): the
// ground stood on. A tile the server has not yet (its build under way: 404) is filled from the global map, and asked again.
//
// The imagery is the albedo's finer detail, taken by the tracer as the finest level's over the coarsest's — a factor on
// the calibrated global map's colour (trace.wgsl moonDetail):
//   the Moon: Clementine's UVVIS 750 nm mosaic (NASA Moon Trek's WMTS, public domain — taken with the Sun high: no shadows
//   in it, unlike LROC's WAC mosaic), 333 m at its finest, grey;
//   Mars: Viking's colour mosaic (MDIM 2.1, Mars Trek, 232 m) in rgb and the Murray Lab's global CTX mosaic (Esri's OnMars
//   service, ~5 m; "NASA/JPL/MSSS/Caltech Murray Lab/Esri") in alpha.

import type { Vec3 } from "../physics";
import { edge, pixels } from "./earth-tiles";
import { LOLA_TILE, lolaCols, lolaDecode, lolaRows, lolaUnit } from "./lola-codec";

const TILE = LOLA_TILE;
export const MOON_SPAN = 4;
const CLIP = TILE * MOON_SPAN;
/** the levels the tracer takes at most (the Moon's 4, Mars's 8) */
export const WORLD_LEVELS = 8;
/** the floats the tracer's params take (vec4s): the reference, 2 per level, then (top, first relief level, coarsest
 *  level, the imagery's finest [m]) — inside the Earth's (TILE_PARAM_VEC4S) */
export const MOON_PARAM_VEC4S = 1 + 2 * WORLD_LEVELS + 1;
const TAU = 2 * Math.PI;
const MAX_INFLIGHT = 8;
const TIMEOUT_MS = 20000;
/** a tile the server had not: asked again after this long [ms] (its build under way) */
const RETRY_MS = 120000;
/** the tiles kept past the windows (each 256 KiB as floats) */
const CACHE_TILES = 96;

/** A world's tiles: its radius [m], its service's path, its levels (z, finest first: those under 0 imagery alone), its
 *  imagery's finest resolution [m]. */
interface World {
  R: number;
  path: string;
  zs: number[];
  imageRes: number;
  /** relief tiles from the room server (false: its levels imagery alone — Titan's, no measured heights) */
  relief?: boolean;
}
export const WORLDS: Record<string, World> = {
  moon: { R: 1737400, path: "moon/lola", zs: [0, 1, 2, 3], imageRes: 333 },
  mars: { R: 3396190, path: "mars/dem", zs: [-4, -3, -2, -1, 0, 1, 2, 3], imageRes: 10 },
  // (Titan: Cassini's radar alone — 351 m to 2.8 km a texel — for the detail of its albedo; no relief: titanRelief's)
  titan: { R: 2574730, path: "", zs: [1, 2, 3, 4], imageRes: 351, relief: false },
};

/** where the tiles are: the room server's; on a local server, its own when it has a box built (data/…) */
export const LOLA_REMOTE = "https://stream.samlepirate.org/svc/v1/moon/lola";
const bases = new Map<string, Promise<string>>();
export function lolaBase(path = "moon/lola"): Promise<string> {
  const forced = (globalThis as { __lolaBase?: string }).__lolaBase;
  if (forced) return Promise.resolve(forced);
  let b = bases.get(path);
  if (b) return b;
  const remote = `https://stream.samlepirate.org/svc/v1/${path}`;
  const host = typeof location === "undefined" ? "" : location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") b = Promise.resolve(remote);
  else {
    const local = `${location.origin}/svc/v1/${path}`;
    b = fetch(`${local}/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { rows?: number } | null) => ((s?.rows ?? 0) > 0 ? local : remote))
      .catch(() => remote);
  }
  bases.set(path, b);
  return b;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Level {
  /** its index (its layer), its z (its tile 2^z degrees) */
  l: number;
  z: number;
  cols: number;
  rows: number;
  /** pixels round the world */
  S: number;
  /** imagery alone (its heights not read) */
  image: boolean;
  want: Rect | null;
  valid: Rect | null;
  key: (string | null)[];
  data: (Float32Array | null)[];
  /** each slot's imagery (null: none yet) */
  col: (Uint32Array | null)[];
}

// ---- the imagery: a mosaic's tiles (equirectangular from 180° W, 90° N), resampled onto a level's tile
interface Mosaic {
  url: (t: number, row: number, col: number) => string;
  /** its tiles' side [px], a level t's tile [°] */
  px: number;
  deg: (t: number) => number;
  /** its loads at once (Esri's CTX service answers 500 to a burst: 4, each tried again) */
  inflight: number;
  /** holes in it (Esri's CTX: an uncontrolled mosaic) — its texels there left out, not the whole tile */
  holes?: boolean;
  /** its holes transparent texels (a WMS's: Titan's radar's gaps between its swaths) */
  alphaHoles?: boolean;
}
/** Clementine's mosaic (Moon Trek's WMTS: z t a tile 180/2^t degrees, 256² grey PNGs, to z 6) */
export const CLEM_URL = "https://trek.nasa.gov/tiles/Moon/EQ/Clem_UVVIS_Mosaic_Global_256ppd_v02/1.0.0/default/default028mm";
const CLEM: Mosaic = { url: (t, r, c) => `${CLEM_URL}/${t}/${r}/${c}.png`, px: 256, deg: (t) => 180 / 2 ** t, inflight: 8 };
/** Viking's colour mosaic (Mars Trek, 256² JPEGs, to z 7) */
const VIKING: Mosaic = {
  url: (t, r, c) =>
    `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${t}/${r}/${c}.jpg`,
  px: 256,
  deg: (t) => 180 / 2 ** t,
  inflight: 8,
};
/** the Murray Lab's CTX mosaic (Esri's OnMars MapServer: geographic, 512² grey PNGs, level t a pixel 0.3515625/2^t degrees) */
const CTX: Mosaic = {
  url: (t, r, c) => `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/${t}/${r}/${c}`,
  px: 512,
  deg: (t) => 180 / 2 ** t,
  inflight: 4,
  holes: true,
};
/** Cassini's SAR and HiSAR mosaic of Titan (the USGS's WMS, CORS open: tiles of 180/2^t degrees, 256² PNGs, its gaps
 *  transparent) */
const TITAN_SAR: Mosaic = {
  url: (t, r, c) => {
    const d = 180 / 2 ** t,
      lon = -180 + c * d,
      lat = 90 - r * d;
    return `https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/saturn/titan_simp_cyl.map&service=WMS&version=1.1.1&request=GetMap&layers=Titan_HiSAR_Mosaic&styles=&srs=EPSG:4326&bbox=${lon},${lat - d},${lon + d},${lat}&width=256&height=256&format=image/png&transparent=true`;
  },
  px: 256,
  deg: (t) => 180 / 2 ** t,
  inflight: 4,
  holes: true,
  alphaHoles: true,
};
/** the radar's level for a level's texel (2^z/256 degrees): its pixel within it, to the mosaic's 128 a degree */
const sarLevel = (z: number) => Math.min(7, Math.max(0, Math.ceil(Math.log2(180 / 2 ** z))));
/** the Trek level a level's imagery is taken from (Clementine, Viking): its finest but no more than ~6 tiles across a window */
export const clemLevel = (z: number) => Math.min(6, Math.floor(Math.log2(270 / 2 ** z)));
const vikingLevel = (z: number) => Math.min(7, Math.floor(Math.log2(270 / 2 ** z)));
/** the CTX level whose pixel is within the level's texel (to its 12th: ~10 m) */
const ctxLevel = (z: number) => Math.min(12, Math.max(0, Math.ceil(Math.log2(90 / 2 ** z))));

const mosaicTiles = new Map<string, Promise<Uint8ClampedArray | null>>();
const running = new Map<Mosaic, number>();
const waiting = new Map<Mosaic, (() => void)[]>();
/** a turn among a mosaic's loads (m.inflight at once) */
async function turn<T>(m: Mosaic, f: () => Promise<T>): Promise<T> {
  if ((running.get(m) ?? 0) >= m.inflight) await new Promise<void>((go) => waiting.set(m, [...(waiting.get(m) ?? []), go]));
  running.set(m, (running.get(m) ?? 0) + 1);
  try {
    return await f();
  } finally {
    running.set(m, running.get(m)! - 1);
    waiting.get(m)?.shift()?.();
  }
}
function mosaicTile(m: Mosaic, t: number, row: number, col: number): Promise<Uint8ClampedArray | null> {
  const u = m.url(t, row, col);
  let p = mosaicTiles.get(u);
  if (!p) {
    // (a tile it has not: 4xx, none; a server's failure — 5xx, a timeout —: tried twice more)
    p = turn(m, async () => {
      for (let k = 0; k < 3; k++) {
        try {
          const r = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (r.ok) return await pixelsOf(await r.blob(), m.px);
          if (r.status < 500) return null;
        } catch {}
        await new Promise((go) => setTimeout(go, 1500 * (k + 1)));
      }
      return null;
    });
    mosaicTiles.set(u, p);
    while (mosaicTiles.size > 200) mosaicTiles.delete(mosaicTiles.keys().next().value!);
  }
  return p;
}
async function pixelsOf(blob: Blob, side: number): Promise<Uint8ClampedArray> {
  if (side === TILE) return pixels(blob);
  const img = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const cv = new OffscreenCanvas(side, side);
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  img.close();
  return ctx.getImageData(0, 0, side, side).data;
}

/**
 * A mosaic resampled onto a level's tile (z, x, y: 256² texels of 2^z/256 degrees), bilinear: each texel's rgba (the tiles'
 * own channels — a grey one's r = g = b); null if a tile of it will not come — a mosaic with holes: those texels −1 alone.
 */
async function resample(m: Mosaic, t: number, z: number, x: number, y: number): Promise<Float32Array | null> {
  const D = 2 ** z,
    td = m.deg(t),
    P = m.px;
  const cols = Math.round(360 / td),
    rows = Math.round(180 / td);
  const lon0 = -180 + x * D,
    lat0 = 90 - y * D;
  const X = (lon: number) => ((lon + 180) / td) * P - 0.5;
  const Y = (lat: number) => ((90 - lat) / td) * P - 0.5;
  // (the source tiles under the tile's texels and their bilinear neighbours: no more)
  const tx0 = Math.floor(Math.floor(X(lon0 + D / (2 * TILE))) / P),
    tx1 = Math.floor((Math.floor(X(lon0 + D - D / (2 * TILE))) + 1) / P);
  const ty0 = Math.max(Math.floor(Math.floor(Y(lat0 - D / (2 * TILE))) / P), 0),
    ty1 = Math.min(Math.floor((Math.floor(Y(lat0 - D + D / (2 * TILE))) + 1) / P), rows - 1);
  const got = new Map<string, Uint8ClampedArray>();
  const loads: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const c = ((tx % cols) + cols) % cols;
      loads.push(
        mosaicTile(m, t, ty, c).then((g) => {
          if (g) got.set(`${ty}/${c}`, g);
        }),
      );
    }
  await Promise.all(loads);
  const W = cols * P;
  const at = (px: number, py: number, ch: number) => {
    const yy = Math.min(Math.max(py, 0), rows * P - 1);
    const xx = ((px % W) + W) % W;
    const g = got.get(`${Math.floor(yy / P)}/${Math.floor(xx / P)}`);
    if (!g) return -1;
    const at4 = 4 * ((yy % P) * P + (xx % P));
    return m.alphaHoles && g[at4 + 3] === 0 ? -1 : g[at4 + ch]!;
  };
  const out = new Float32Array(4 * TILE * TILE);
  for (let j = 0; j < TILE; j++) {
    const py = Y(lat0 - ((j + 0.5) / TILE) * D);
    const y0 = Math.floor(py),
      fy = py - y0;
    for (let i = 0; i < TILE; i++) {
      const px = X(lon0 + ((i + 0.5) / TILE) * D);
      const x0 = Math.floor(px),
        fx = px - x0;
      for (let ch = 0; ch < 3; ch++) {
        const a = at(x0, y0, ch),
          b = at(x0 + 1, y0, ch),
          c = at(x0, y0 + 1, ch),
          d = at(x0 + 1, y0 + 1, ch);
        if (a < 0 || b < 0 || c < 0 || d < 0) {
          if (!m.holes) return null;
          out[4 * (j * TILE + i) + ch] = -1;
          continue;
        }
        out[4 * (j * TILE + i) + ch] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      }
    }
  }
  return out;
}

/** A level's tile's imagery, packed rgba8 (never 0 — the tracer's mark of none: its red at least 1): the Moon's Clementine
 *  grey in rgb (a 255); Mars's Viking colour in rgb and CTX's grey in a (0 where CTX has none: the tracer takes a coarser
 *  level's). null if it will not come. */
export async function worldImagery(world: string, z: number, x: number, y: number): Promise<Uint32Array | null> {
  const pack = (r: number, g: number, b: number, a: number) =>
    (Math.max(Math.round(r), 1) | (Math.round(g) << 8) | (Math.round(b) << 16) | (Math.round(a) << 24)) >>> 0;
  const out = new Uint32Array(TILE * TILE);
  if (world === "moon") {
    const c = await resample(CLEM, clemLevel(z), z, x, y);
    if (!c) return null;
    for (let i = 0; i < out.length; i++) out[i] = pack(c[4 * i]!, c[4 * i]!, c[4 * i]!, 255);
    return out;
  }
  if (world === "titan") {
    // (Titan: a flat grey in rgb — no colour of its own here —, the radar in alpha, 0 in its gaps: a coarser level's there)
    const c = await resample(TITAN_SAR, sarLevel(z), z, x, y);
    if (!c) return null;
    for (let i = 0; i < out.length; i++) out[i] = pack(128, 128, 128, c[4 * i]! >= 0 ? Math.max(c[4 * i]!, 1) : 0);
    return out;
  }
  const [v, c] = await Promise.all([resample(VIKING, vikingLevel(z), z, x, y), resample(CTX, ctxLevel(z), z, x, y)]);
  if (!v) return null;
  for (let i = 0; i < out.length; i++)
    out[i] = pack(v[4 * i]!, v[4 * i + 1]!, v[4 * i + 2]!, c && c[4 * i]! >= 0 ? Math.max(c[4 * i]!, 1) : 0);
  return out;
}
/** (the Moon's, as P6 had it) */
export const clemAlbedo = (l: number, x: number, y: number) => worldImagery("moon", l, x, y);

const same = (a: Rect | null, b: Rect | null) =>
  (!a && !b) || (!!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1);
const inside = (r: Rect | null, x: number, y: number) => !!r && x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
function intersect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || !b) return null;
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x0 < r.x1 && r.y0 < r.y1 ? r : null;
}

export class MoonTiles {
  /** its atlas (made once a world is drawn, its layers that world's levels) */
  texture!: GPUTexture;
  private layers = 0;
  /** the world drawn (WORLDS) */
  world = "moon";
  private levels: Level[] = [];
  private cache = new Map<string, { h: Float32Array; col: Uint32Array | null }>();
  private inflight = new Map<string, AbortController>();
  private missing = new Map<string, number>();
  /** the reference (the camera's place) [rad] */
  private lon = 0;
  private lat = 0;
  /** drawn: the tracer reads the tiles (the world near, its global map in) */
  active = false;
  /** wanted (off: the global map alone — an A/B, __bh.renderer.moonTiles.enabled) */
  enabled = true;
  /** bumped when what the tracer draws changes (a level's valid rectangle) */
  stamp = 0;
  /** heights of the global map [m] at a unit direction on the world's axes: a tile the server has not yet */
  fallback: ((q: Vec3) => number) | null = null;
  onChange: (() => void) | null = null;
  /** the tracer's binding changed (active switched, another atlas): the bind groups rebuilt */
  onSwitch: (() => void) | null = null;
  loaded = 0;
  failed = 0;
  /** bumped when a tile's imagery comes in */
  imagery = 0;
  /** where the tiles come from (lolaBase: the local server's box, or the room server's) */
  source = "";
  /** how far the windows' heights rise over the global map's under them, at most [m] — the marches' bound over the map's
   *  own (trace.wgsl demTop): the map's highest there plus this; the windows' highest anywhere was 20 km over a Martian plain
   *  (Tharsis in the 8° window), every ray stepping finely from there */
  top = 0;
  private tops = new WeakMap<Float32Array, number>();

  constructor(private device: GPUDevice) {
    this.setWorld("moon");
  }

  private get W() {
    return WORLDS[this.world]!;
  }

  /** The world whose tiles are drawn (its levels made anew, the cache dropped). */
  setWorld(world: string) {
    if (!WORLDS[world]) throw new Error(`no tiles for ${world}`);
    if (world === this.world && this.levels.length) return;
    this.clear();
    this.world = world;
    this.cache.clear();
    this.missing.clear();
    this.levels = this.W.zs.map((z, l) => ({
      l,
      z,
      cols: lolaCols(z),
      rows: lolaRows(z),
      S: lolaCols(z) * TILE,
      image: z < 0 || this.W.relief === false,
      want: null,
      valid: null,
      key: new Array(MOON_SPAN ** 2).fill(null),
      data: new Array(MOON_SPAN ** 2).fill(null),
      col: new Array(MOON_SPAN ** 2).fill(null),
    }));
  }

  private atlas() {
    if (this.layers === this.levels.length) return;
    this.texture?.destroy();
    this.layers = this.levels.length;
    this.texture = this.device.createTexture({
      size: [CLIP, CLIP, this.layers],
      format: "rg32uint",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: `${this.world} tiles`,
    });
    this.onSwitch?.();
  }

  /** whether any level is drawn */
  get drawn() {
    return this.active && this.levels.some((L) => L.valid);
  }
  /** tiles still loading */
  get pending() {
    return this.inflight.size;
  }

  private slotOf(_L: Level, x: number, y: number) {
    return (((y % MOON_SPAN) + MOON_SPAN) % MOON_SPAN) * MOON_SPAN + (((x % MOON_SPAN) + MOON_SPAN) % MOON_SPAN);
  }
  private keyOf(L: Level, x: number, y: number) {
    return `${L.z}/${y}/${((x % L.cols) + L.cols) % L.cols}`;
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
    if (on) this.atlas();
    this.active = on;
    this.onSwitch?.();
  }

  /** Off: no level drawn, the loads stopped (the world left). */
  clear() {
    for (const c of this.inflight.values()) c.abort();
    this.inflight.clear();
    for (const L of this.levels) {
      L.want = null;
      this.setValid(L, null);
      // (its slots to be written again: the atlas may be another when drawn again)
      L.key.fill(null);
    }
    this.setActive(false);
  }

  /**
   * The camera on the world's axes (a unit direction, c) and its height over the ground [m]; the pixel's angle [rad]: the
   * windows round it, the levels its footprint needs (a level whose texel is under half the nearest ground's footprint not
   * loaded; past the coarsest, none).
   */
  update(c: Vec3 | null, alt: number, pixAngle: number) {
    if (!c || !this.enabled) return this.clear();
    const r = Math.hypot(...c) || 1;
    this.lon = Math.atan2(c[1], c[0]);
    this.lat = Math.asin(Math.max(-1, Math.min(1, c[2] / r)));
    const foot = Math.max(alt, 1) * pixAngle;
    const texel = (L: Level) => (TAU * this.W.R) / L.S;
    const coarsest = this.levels[this.levels.length - 1]!;
    if (texel(coarsest) < foot / 2) return this.clear();
    this.setActive(true);
    for (const L of this.levels) {
      // (a level finer than half the footprint under the camera: not wanted — its tiles not loaded)
      if (texel(L) < foot / 2) {
        if (L.want) {
          L.want = null;
          this.setValid(L, null);
        }
        continue;
      }
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
    for (let l = this.levels.length - 1; l >= 0; l--) {
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
    const world = this.world;
    const done = () => {
      clearTimeout(timer);
      if (this.inflight.get(key) === ac) this.inflight.delete(key);
      if (this.active) this.request();
    };
    // (an imagery level: no heights — its imagery alone, the tile in flight until it comes, or will not)
    if (L.image) {
      void worldImagery(world, L.z, xx, y)
        .then((col) => {
          if (world !== this.world || !inside(L.want, x, y)) return;
          if (col) this.imagery++;
          const h = new Float32Array(TILE * TILE);
          this.keep(key, h, col);
          this.put(L, x, y, h, col);
        })
        .finally(done);
      return;
    }
    void lolaBase(this.W.path)
      .then((b) => {
        this.source = b;
        return fetch(`${b}/${L.z}/${y}/${xx}.bin`, { signal: ac.signal });
      })
      .then(async (r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // (gzipped by the server: the browser has undone it)
        const b = new Uint8Array(await r.arrayBuffer());
        const q = lolaDecode(b),
          unit = lolaUnit(b);
        const h = new Float32Array(q.length);
        for (let i = 0; i < q.length; i++) h[i] = q[i]! * unit;
        return h;
      })
      .then((h) => {
        if (world !== this.world) return;
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
        if (world !== this.world || (ac.signal.aborted && !this.inflight.has(key))) return;
        this.failed++;
        this.missing.set(key, performance.now());
        if (inside(L.want, x, y)) {
          this.put(L, x, y, this.fromFallback(L, x, y), null);
          this.albedo(L, x, y);
        }
      })
      .finally(done);
  }

  /** a tile's imagery, once its heights are in: into its slot, and kept with them */
  private albedo(L: Level, x: number, y: number) {
    const key = this.keyOf(L, x, y);
    const world = this.world;
    void worldImagery(world, L.z, ((x % L.cols) + L.cols) % L.cols, y).then((col) => {
      if (world !== this.world) return;
      const s = this.slotOf(L, x, y);
      if (!col || L.key[s] !== key || !L.data[s]) return;
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

  /** A tile's heights [m] and imagery (none: 0) into its window's slot: sent to the GPU. */
  private put(L: Level, x: number, y: number, h: Float32Array, col: Uint32Array | null) {
    const s = this.slotOf(L, x, y);
    L.key[s] = this.keyOf(L, x, y);
    L.data[s] = h;
    L.col[s] = col;
    if (!this.active) return;
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
    if (!this.fallback || L.image) return h;
    const deg = 2 ** L.z;
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
    let m = 0;
    for (const L of this.levels) {
      if (!L.valid || L.image) continue;
      for (const [s, d] of L.data.entries()) {
        if (!d) continue;
        let t = this.tops.get(d);
        if (t === undefined) {
          t = this.excess(L, L.key[s] ?? null, d);
          this.tops.set(d, t);
        }
        if (t > m) m = t;
      }
    }
    this.top = m;
  }

  /** A tile's heights' rise over the global map's under them, at most [m]: every other texel, 100 m more for those between
   *  (none: a tile filled from the map itself) */
  private excess(L: Level, key: string | null, d: Float32Array) {
    const f = this.fallback;
    if (!f || !key) return 0;
    const [, ys, xs] = key.split("/").map(Number) as [number, number, number];
    const deg = 2 ** L.z;
    let e = 0;
    for (let j = 0; j < TILE; j += 2) {
      const lat = ((90 - (ys + (j + 0.5) / TILE) * deg) * Math.PI) / 180;
      const cl = Math.cos(lat),
        sl = Math.sin(lat);
      for (let i = 0; i < TILE; i += 2) {
        const lon = ((-180 + (xs + (i + 0.5) / TILE) * deg) * Math.PI) / 180;
        const rise = d[j * TILE + i]! - f([cl * Math.cos(lon), cl * Math.sin(lon), sl]);
        if (rise > e) e = rise;
      }
    }
    return e > 0 ? e + 100 : 0;
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
   * latitude, −1: a world's tiles), then per level (its layer, finest first) the reference's place in its valid rectangle
   * [px], the rectangle's corner in its layer [px], its size [px], its pixels per radian, its window's side (0: off); then
   * the windows' highest height [m], the first relief level (the finer ones imagery alone), the coarsest level, the
   * imagery's finest [m].
   */
  params(): Float32Array {
    const f = new Float32Array(MOON_PARAM_VEC4S * 4);
    for (const L of this.levels) {
      const v = L.valid;
      if (!v || !this.active) continue;
      const [ax, ay] = this.anchor(L, v);
      const o = 4 + 8 * L.l;
      f.set([ax, ay, (((v.x0 * TILE) % CLIP) + CLIP) % CLIP, (v.y0 * TILE) % CLIP], o);
      f.set([(v.x1 - v.x0) * TILE, (v.y1 - v.y0) * TILE, L.S / TAU, CLIP], o + 4);
    }
    f.set([Math.cos(this.lon), Math.sin(this.lon), Math.sin(this.lat), this.drawn ? -1 : 0], 0);
    // (no relief level — Titan's —: the first past the last, none read)
    const firstRelief = this.levels.findIndex((L) => !L.image);
    f.set([this.top, firstRelief < 0 ? this.levels.length : firstRelief, this.levels.length - 1, this.W.imageRes], 4 + 8 * WORLD_LEVELS);
    return f;
  }

  /**
   * The relief levels' height at a unit direction on the world's axes, for a footprint [m] (trace.wgsl moonH, the same):
   * the finest within it and the next coarser, blended by the footprint and towards their windows' edges; rem the weight
   * left to the global map.
   */
  heightAt(q: Vec3, foot: number): { h: number; rem: number } {
    let h = 0,
      rem = 1;
    if (!this.drawn) return { h, rem };
    const c = Math.cos(this.lon),
      s = Math.sin(this.lon);
    const dlon = Math.atan2(-q[0] * s + q[1] * c, q[0] * c + q[1] * s);
    const dlat = latFrom(q, Math.sin(this.lat));
    for (const L of this.levels) {
      if (rem <= 1e-4) break;
      const v = L.valid;
      if (!v || L.image) continue;
      // (the footprint's level: a level whose texel is under half the footprint left to the coarser one)
      const zf = Math.log2((TAU * this.W.R) / (L.S * Math.max(foot, 0.5)));
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
