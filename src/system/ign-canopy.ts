// The IGN's LiDAR under the forests over France (docs/ANALYSE-IGN-LIDAR.md I4): the scenery worker's trees where the
// survey's canopy height model (MNH: the LiDAR's surface less its terrain) says something stands 2 m or more — the wood's
// edges, the bocage's hedges, the trees along a river, a clearing, each at its own place —, each tree as tall as the
// canopy measured over it; and their feet, and the buildings', on the IGN's own ground (its LiDAR terrain, RGE ALTI in
// its holes): the tracer's relief over France since I2. Where the survey has nothing (unflown, the sea, abroad), the
// land cover's draw as before (forest.ts forestKind) — forest.ts growForest reads both through its sources.
//
// The data come by blocks — the Web Mercator tiles of CANOPY_Z, one WMS-R request each through the Géoplateforme, CORS
// open, kept 21 days by the browser, float32 uncompressed (no other format holds the values) —: within CANOPY_NEAR of the
// scene's centre the canopy at CANOPY_N² (3.1 m a texel at 49°: a hedge's 4 m caught) and the ground at GROUND_N² (6.2 m: a
// tree's foot sunk FOREST_SINK under it holds it), beyond it both at half that; only the blocks the forest's disc touches,
// the nearest first. 1.25 MB a near block, 0.31 MB a far one: ~20 MB for a high scene's 4.75 km, measured at Saint-Lô.

import { IGN_LIDAR, IGN_RGEALTI, ignHeightUrl, ORTHO_BOX, RateGate } from "./earth-tiles";
import { SWISSTOPO } from "./national";

/** the canopy height model's layer (LiDAR HD, 0.5 m where flown) */
export const IGN_MNH = "IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G";
/** the blocks' tile level, and their canopy's and ground's sides [px] */
export const CANOPY_Z = 14;
export const CANOPY_N = 512;
export const GROUND_N = 256;
/** the full sides within this of the scene's centre [m], half beyond */
export const CANOPY_NEAR = 2000;
/** a block's ground holes past this share: RGE ALTI fetched to fill them (fewer: the global relief under them) */
const HOLES = 0.02;
/** the canopy's code: 0.2 m a step, NODATA where the survey has none */
const STEP = 0.2;
const NODATA = 255;
/** a canopy under CANOPY_SURE [m] as flat as CANOPY_ROUGH [m] over a crown's reach: a field's crop at the survey's flight
 *  (maize, wheat: 1.6–2.5 m, flat — 6 % of the bocage's texels at Saint-Lô), not a hedge's or a thicket's (their tops
 *  ragged, their edges dropping to the ground) */
export const CANOPY_SURE = 5;
export const CANOPY_ROUGH = 1;
/** blocks fetched at once (the Géoplateforme's WMS-R: 40 requests a second an address, the terrain's tiles beside) */
const INFLIGHT = 4;
/** a request's tries */
const ATTEMPTS = 4;
/** the survey's share of the Géoplateforme's rate [requests a second] (earth-tiles.ts RateGate: the relief's tiles 20) */
export const SURVEY_RATE = 12;
const R = 6378137;
const D = Math.PI / 180;

/** whether a place is the IGN's (its box — metropolitan France and Corsica —, Switzerland swisstopo's: national.ts) */
export const inIgnBox = (lat: number, lon: number) =>
  lon > ORTHO_BOX.west && lon < ORTHO_BOX.east && lat > ORTHO_BOX.south && lat < ORTHO_BOX.north && !SWISSTOPO.holds(lat, lon);

/** the tiles of level `z` the disc of `reach` metres round a place touches, the nearest first, each with its distance [m] */
export function tilesWithin(z: number, lat: number, lon: number, reach: number): { x: number; y: number; d: number }[] {
  const t = 2 ** z,
    m = (2 * Math.PI * R * Math.cos(lat * D)) / t;
  const fx = ((lon + 180) / 360) * t,
    fy = ((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * t;
  const cx = Math.floor(fx),
    cy = Math.floor(fy),
    k = Math.ceil(reach / m) + 1;
  const out: { x: number; y: number; d: number }[] = [];
  for (let y = cy - k; y <= cy + k; y++)
    for (let x = cx - k; x <= cx + k; x++) {
      const d = m * Math.hypot(Math.max(x - fx, 0, fx - x - 1), Math.max(y - fy, 0, fy - y - 1));
      if (d <= reach) out.push({ x, y, d });
    }
  return out.sort((a, b) => a.d - b.d);
}
/** the survey's blocks within `reach` metres of a place (tilesWithin at CANOPY_Z) */
export const blocksWithin = (lat: number, lon: number, reach: number) => tilesWithin(CANOPY_Z, lat, lon, reach);

/** a block's grids' sides [px]: within CANOPY_NEAR of the scene's centre the full ones, half beyond */
export const blockSides = (d: number) => {
  const shrink = d <= CANOPY_NEAR ? 1 : 2;
  return { canopy: CANOPY_N / shrink, ground: GROUND_N / shrink };
};
/** A block's fetches as IgnLand makes them, as chains (system/zones.ts ZoneChain): its canopy; its ground — the LiDAR's,
 *  RGE ALTI's where it falls short. */
export function blockChains(x: number, y: number, sides: { canopy: number; ground: number }): string[][] {
  return [
    [ignHeightUrl(IGN_MNH, CANOPY_Z, x, y, sides.canopy)],
    [ignHeightUrl(IGN_LIDAR, CANOPY_Z, x, y, sides.ground), ignHeightUrl(IGN_RGEALTI, CANOPY_Z, x, y, sides.ground)],
  ];
}
/** the survey's fetches for a scene of `reach` metres round a place (IgnLand.prepare's) */
export const surveyChains = (lat: number, lon: number, reach: number): string[][] =>
  blocksWithin(lat, lon, reach).flatMap((b) => blockChains(b.x, b.y, blockSides(b.d)));

/** a place's block and its fractional pixel there (n a side; row 0 the north) */
export function blockOf(lat: number, lon: number, n: number): { x: number; y: number; u: number; v: number } {
  const t = 2 ** CANOPY_Z;
  const fx = ((lon + 180) / 360) * t,
    fy = ((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * t;
  const x = Math.floor(fx),
    y = Math.floor(fy);
  return { x, y, u: (fx - x) * n - 0.5, v: (fy - y) * n - 0.5 };
}

/** a block's canopy coded a byte a texel: its no-data (and the junk the WMS-R resamples into it) NODATA, under 0 none */
export function codeCanopy(v: Float32Array): Uint8Array {
  const out = new Uint8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const h = v[i]!;
    out[i] = !Number.isFinite(h) || h < -100 || h > 200 ? NODATA : Math.min(NODATA - 1, Math.max(0, Math.round(h / STEP)));
  }
  return out;
}

/** The survey over a scenery's box: its blocks fetched once, then read as the worker grows its forest. */
export class IgnLand {
  private canopyBlocks = new Map<string, { n: number; v: Uint8Array } | null>();
  private groundBlocks = new Map<string, { n: number; v: Float32Array } | null>();
  /** the requests made, their bytes, the failures (the scenery's stats) */
  requests = 0;
  errors: string[] = [];
  private gate: RateGate;
  constructor(
    private fetchBytes: (url: string) => Promise<ArrayBuffer>,
    rate = SURVEY_RATE,
  ) {
    this.gate = new RateGate(rate);
  }

  /** the blocks within `reach` metres of a place, fetched INFLIGHT at a time, the nearest first */
  async prepare(lat: number, lon: number, reach: number) {
    const keys = blocksWithin(lat, lon, reach);
    let next = 0;
    const run = async () => {
      while (next < keys.length) {
        const { x, y, d } = keys[next++]!;
        await this.block(x, y, blockSides(d));
      }
    };
    await Promise.all(Array.from({ length: INFLIGHT }, run));
  }

  /** a block's grid, within SURVEY_RATE, asked up to ATTEMPTS times (the Géoplateforme refuses a request now and then —
   *  "LayerNotDefined" over its rate, a 502 —, the next one answered); null when it failed — the land cover's there, the
   *  scene whole */
  private async grid(layer: string, x: number, y: number, n: number): Promise<Float32Array | null> {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++)
      try {
        await this.gate.take();
        this.requests++;
        const b = await this.fetchBytes(ignHeightUrl(layer, CANOPY_Z, x, y, n));
        return b.byteLength === n * n * 4 ? new Float32Array(b) : null;
      } catch (e) {
        if (attempt === ATTEMPTS - 1) {
          if (this.errors.length < 4) this.errors.push(String(e).slice(0, 320));
        } else await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
      }
    return null;
  }

  private async block(x: number, y: number, sides: { canopy: number; ground: number }) {
    const key = `${x}/${y}`,
      cn = sides.canopy,
      gn = sides.ground;
    const [mnh, lidar] = await Promise.all([this.grid(IGN_MNH, x, y, cn), this.grid(IGN_LIDAR, x, y, gn)]);
    this.canopyBlocks.set(key, mnh && { n: cn, v: codeCanopy(mnh) });
    // (the ground: the LiDAR's terrain, RGE ALTI in its holes — earth-tiles' rule, its no-data and coastal junk dropped)
    const clean = (v: Float32Array | null) => {
      if (!v) return null;
      let any = false;
      for (let i = 0; i < v.length; i++) {
        const h = v[i]!;
        if (!Number.isFinite(h) || h < -100 || h > 9000) v[i] = Number.NaN;
        else any = true;
      }
      return any ? v : null;
    };
    let g = clean(lidar);
    let holes = 0;
    if (g) for (const h of g) if (Number.isNaN(h)) holes++;
    if (!g || holes > HOLES * g.length) {
      const r = clean(await this.grid(IGN_RGEALTI, x, y, gn));
      if (!g) g = r;
      else if (r) for (let i = 0; i < g.length; i++) if (Number.isNaN(g[i]!)) g[i] = r[i]!;
    }
    this.groundBlocks.set(key, g && { n: gn, v: g });
  }

  /** the IGN's ground at a place [m above the sea] (bilinear; NaN where it has none) */
  ground(lat: number, lon: number): number {
    const b = blockOf(lat, lon, 1);
    const g = this.groundBlocks.get(`${b.x}/${b.y}`);
    if (!g) return Number.NaN;
    const n = g.n,
      u = (b.u + 0.5) * n - 0.5,
      v = (b.v + 0.5) * n - 0.5;
    const i = Math.max(0, Math.min(n - 2, Math.floor(u))),
      j = Math.max(0, Math.min(n - 2, Math.floor(v)));
    const fx = Math.max(0, Math.min(1, u - i)),
      fy = Math.max(0, Math.min(1, v - j));
    const at = (a: number, c: number) => g.v[(j + c) * n + i + a]!;
    return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
  }

  /** the canopy's height at a place [m] (its texel; NaN where the survey has none) */
  canopy(lat: number, lon: number): number {
    const b = blockOf(lat, lon, 1);
    const c = this.canopyBlocks.get(`${b.x}/${b.y}`);
    if (!c) return Number.NaN;
    const n = c.n,
      i = Math.max(0, Math.min(n - 1, Math.floor((b.u + 0.5) * n))),
      j = Math.max(0, Math.min(n - 1, Math.floor((b.v + 0.5) * n)));
    const code = c.v[j * n + i]!;
    return code === NODATA ? Number.NaN : code * STEP;
  }

  /** the canopy's top within `r` metres of a place — the place and eight round it: a crown reaching over a hedge from its
   *  cell's foot —, NaN where the survey has none at the place itself; 0 over a crop (CANOPY_SURE, CANOPY_ROUGH) */
  canopyNear(lat: number, lon: number, r: number): number {
    const h0 = this.canopy(lat, lon);
    if (!Number.isFinite(h0)) return h0;
    const dLat = r / (R * D),
      dLon = r / (R * D * Math.cos(lat * D));
    let top = h0,
      low = h0;
    for (let a = 0; a < 8; a++) {
      const s = a < 4 ? 1 : Math.SQRT1_2;
      const ex = [1, -1, 0, 0, 1, 1, -1, -1][a]! * s,
        ny = [0, 0, 1, -1, 1, -1, 1, -1][a]! * s;
      const h = this.canopy(lat + ny * dLat, lon + ex * dLon);
      if (h > top) top = h;
      if (h < low) low = h;
    }
    return top < CANOPY_SURE && top - low < CANOPY_ROUGH ? 0 : top;
  }
}
