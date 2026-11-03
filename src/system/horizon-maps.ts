// The horizon maps (docs/PLAN-REFRACTION-HORIZONS.md H1, §2.5): for each texel of a lattice over a body — its
// equirectangular map, or a polar cap's stereographic grid —, how high the relief rises round it, in 8 (16 on the caps)
// directions: each the highest sine of elevation over its sector (three rays: −15°, 0, +15° — ±7.5° on the caps), from
// D_bake (two of the lattice's texels) out to the reach the data allow (the body's whole relief over its curvature: past
// √(2RΔh) nothing rises over the horizon), at steps ×1.25 along great circles, the curvature exact, measured from the top of
// the texel and its neighbours (the heights' highest one level up: a point above the texel's mean sees a lower horizon — the
// map can under-shadow, the near marches and the Sun's map catch the near ground, never over-shadow a crest). The heights read
// as the highest of the 2 × 2 texels round the ray's point at the level whose texel is half the step (the DEM's mips' G: their
// maximum — trace.wgsl demTop). Baked on the GPU (shaders/horizon.wgsl), a band of rows a frame by the time it takes; this
// file's CPU bake is its reference, read for read (the unit tests, the pilot's e2e).
//
// Encoding: rgba8unorm, a direction a channel, the sine's signed square root over 0.75 (s = sign·√|sin e / 0.75|, stored as
// ½ + ½ s): ~0.07° a step round 0.5° of elevation where the penumbra's decided (a linear byte: 0.22°, more than the Sun's
// radius seen from Mars or Ceres). The sectors: N, NE, E, SE in layer 0, S, SW, W, NW in layer 1 (azimuth clockwise from
// the local north); on a cap, 16 directions by the grid's own axes (+x, then 22.5° a step towards +y), 4 layers a cap —
// no singular axis at the pole.

import type { Vec3 } from "../physics";
import horizonWGSL from "../shaders/horizon.wgsl" with { type: "text" };
import type { MapName } from "./solar";

export const HORIZON_SECTORS = 8;
export const POLE_SECTORS = 16;
/** the caps' grid (texels a side) and where they reach: 13° from the pole — read beyond 78°, faded into the map to 80° */
export const POLE_N = 256;
export const POLE_COLAT = (13 * Math.PI) / 180;
export const POLE_FADE = [78, 80] as const;
/** the steps' growth along a ray, and the rays' spread either side of a sector's axis (the map's, the caps') */
export const HORIZON_STEP = 1.25;
export const HORIZON_SPREAD = (15 * Math.PI) / 180;
export const POLE_SPREAD = (7.5 * Math.PI) / 180;
/** the largest sine the encoding holds */
export const HORIZON_SIN_MAX = 0.75;

/** a sine of elevation into its byte's unorm value [0, 1] (the signed root) */
export function encodeHorizon(sin: number): number {
  const x = Math.max(-1, Math.min(1, sin / HORIZON_SIN_MAX));
  return 0.5 + 0.5 * Math.sign(x) * Math.sqrt(Math.abs(x));
}
/** its byte */
export const encodeHorizonByte = (sin: number) => Math.round(encodeHorizon(sin) * 255);
/** a unorm value back to its sine */
export function decodeHorizon(u: number): number {
  const s = 2 * u - 1;
  return Math.sign(s) * s * s * HORIZON_SIN_MAX;
}

/**
 * A lattice the horizons are baked on: a latitude/longitude grid (the body's whole map — lon0 −π, lat0 π/2, dlon 2π/W,
 * dlat π/H —, or a local window: the Earth's cache, H5) or a polar cap's stereographic grid (pole +1 north, −1 south; its
 * texels from −rmax to rmax on the unit sphere's projection from the other pole, r = 2 tan(colatitude/2)).
 */
export type Lattice =
  | { kind: "latlon"; W: number; H: number; lon0: number; lat0: number; dlon: number; dlat: number }
  | { kind: "polar"; N: number; pole: 1 | -1; rmax: number };

export const globalLattice = (W: number, H: number): Lattice => ({
  kind: "latlon",
  W,
  H,
  lon0: -Math.PI,
  lat0: Math.PI / 2,
  dlon: (2 * Math.PI) / W,
  dlat: Math.PI / H,
});
export type CapLattice = Extract<Lattice, { kind: "polar" }>;
export const capLattice = (pole: 1 | -1, N = POLE_N): CapLattice => ({ kind: "polar", N, pole, rmax: 2 * Math.tan(POLE_COLAT / 2) });
export const latticeSize = (l: Lattice) => (l.kind === "latlon" ? { w: l.W, h: l.H } : { w: l.N, h: l.N });
export const latticeSectors = (l: Lattice) => (l.kind === "latlon" ? HORIZON_SECTORS : POLE_SECTORS);
/** a lattice's texel [rad of arc] (its latitude step; a cap's at the pole) */
export const latticeTexel = (l: Lattice) => (l.kind === "latlon" ? l.dlat : (2 * l.rmax) / l.N);

/** a texel's centre on the unit sphere (z north), its latitude and longitude */
export function latticePoint(l: Lattice, i: number, j: number): { p: Vec3; lat: number; lon: number } {
  let lat: number, lon: number;
  if (l.kind === "latlon") {
    lat = l.lat0 - (j + 0.5) * l.dlat;
    lon = l.lon0 + (i + 0.5) * l.dlon;
  } else {
    const x = (-1 + ((i + 0.5) * 2) / l.N) * l.rmax,
      y = (-1 + ((j + 0.5) * 2) / l.N) * l.rmax;
    const c = 2 * Math.atan(Math.hypot(x, y) / 2);
    lon = Math.atan2(y, x);
    lat = l.pole * (Math.PI / 2 - c);
  }
  const cl = Math.cos(lat);
  return { p: [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)], lat, lon };
}

/** the unit tangent at a texel's point along a direction: on the map an azimuth (clockwise from north), on a cap an angle
 *  from the grid's +x axis towards +y (the projection is conformal: its angles are the sphere's) */
export function latticeTangent(l: Lattice, lat: number, lon: number, angle: number): Vec3 {
  const sl = Math.sin(lat),
    cl = Math.cos(lat),
    so = Math.sin(lon),
    co = Math.cos(lon);
  const east: Vec3 = [-so, co, 0],
    north: Vec3 = [-sl * co, -sl * so, cl];
  let a: number, b: number;
  if (l.kind === "latlon") {
    a = Math.cos(angle); // north
    b = Math.sin(angle); // east
  } else {
    // (the grid's radial — away from its pole — is south on the north cap, north on the south one)
    a = -l.pole * Math.cos(angle - lon);
    b = Math.sin(angle - lon);
  }
  return [a * north[0] + b * east[0], a * north[1] + b * east[1], a * north[2] + b * east[2]];
}

/** a sector's axis: its azimuth on the map (k · 45° from north, clockwise), its grid angle on a cap (k · 22.5° from +x) */
export const sectorAngle = (l: Lattice, k: number) => (k * 2 * Math.PI) / latticeSectors(l);
export const sectorSpread = (l: Lattice) => (l.kind === "latlon" ? HORIZON_SPREAD : POLE_SPREAD);

/**
 * A height map's pyramid as the GPU holds it (hd-maps.ts: rg16float, G the highest down the mips) — the CPU's reference
 * reads the same values: each height rounded to a half float, each level's maximum of its 2 × 2.
 */
export interface HeightPyramid {
  W: number;
  H: number;
  levels: { w: number; h: number; top: Float32Array; mean: Float32Array }[];
}
const F16 = new Float32Array(1),
  F16U = new Uint32Array(F16.buffer);
/** a float rounded to the nearest half float (round to even) */
export function toHalf(v: number): number {
  F16[0] = v;
  const u = F16U[0]!,
    e = (u >>> 23) & 0xff;
  if (e === 0 || e === 0xff) return F16[0]!;
  // (a normal half keeps 10 mantissa bits: round the 13 dropped, to even)
  const shift = e < 113 ? 13 + (113 - e) : 13;
  if (shift >= 24) return 0;
  const half = 1 << (shift - 1),
    mask = (1 << shift) - 1;
  const low = u & mask;
  let r = u & ~mask;
  if (low > half || (low === half && (r >>> shift) & 1)) r += 1 << shift;
  F16U[0] = r >>> 0;
  return F16[0]!;
}
export function heightPyramid(map: ArrayLike<number>, W: number, H: number, half = true): HeightPyramid {
  const top0 = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) top0[i] = half ? toHalf(map[i]!) : map[i]!;
  const levels = [{ w: W, h: H, top: top0, mean: top0 }];
  while (levels.at(-1)!.w > 1 || levels.at(-1)!.h > 1) {
    const s = levels.at(-1)!;
    const w = Math.max(1, s.w >> 1),
      h = Math.max(1, s.h >> 1);
    const top = new Float32Array(w * h),
      mean = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const x0 = Math.min(2 * x, s.w - 1),
          x1 = Math.min(2 * x + 1, s.w - 1),
          y0 = Math.min(2 * y, s.h - 1),
          y1 = Math.min(2 * y + 1, s.h - 1);
        top[y * w + x] = Math.max(s.top[y0 * s.w + x0]!, s.top[y0 * s.w + x1]!, s.top[y1 * s.w + x0]!, s.top[y1 * s.w + x1]!);
        const m = 0.25 * (s.mean[y0 * s.w + x0]! + s.mean[y0 * s.w + x1]! + s.mean[y1 * s.w + x0]! + s.mean[y1 * s.w + x1]!);
        mean[y * w + x] = half ? toHalf(m) : m;
      }
    levels.push({ w, h, top, mean });
  }
  return { W, H, levels };
}
/** the highest of the 2 × 2 texels round a point (its unit vector) at a level (trace.wgsl demTop, horizon.wgsl topAt) */
export function topAt(src: HeightPyramid, q: Vec3, level: number): number {
  const L = src.levels[Math.max(0, Math.min(level, src.levels.length - 1))]!;
  const u = 0.5 + Math.atan2(q[1], q[0]) / (2 * Math.PI),
    v = 0.5 - Math.asin(Math.max(-1, Math.min(1, q[2]))) / Math.PI;
  const x = u * L.w - 0.5,
    y = v * L.h - 0.5;
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const x0 = ((ix % L.w) + L.w) % L.w,
    x1 = (x0 + 1) % L.w;
  const y0 = Math.max(0, Math.min(iy, L.h - 1)),
    y1 = Math.max(0, Math.min(iy + 1, L.h - 1));
  return Math.max(L.top[y0 * L.w + x0]!, L.top[y0 * L.w + x1]!, L.top[y1 * L.w + x0]!, L.top[y1 * L.w + x1]!);
}

/** the mean height at a point at a level, bilinear (the mips' R — the pilot's option of reading the ground's mean along the rays) */
export function meanLevelAt(src: HeightPyramid, q: Vec3, level: number): number {
  const L = src.levels[Math.max(0, Math.min(level, src.levels.length - 1))]!;
  const u = 0.5 + Math.atan2(q[1], q[0]) / (2 * Math.PI),
    v = 0.5 - Math.asin(Math.max(-1, Math.min(1, q[2]))) / Math.PI;
  const x = u * L.w - 0.5,
    y = v * L.h - 0.5;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const x0 = ((ix % L.w) + L.w) % L.w,
    x1 = (x0 + 1) % L.w;
  const y0 = Math.max(0, Math.min(iy, L.h - 1)),
    y1 = Math.max(0, Math.min(iy + 1, L.h - 1));
  const a = L.mean[y0 * L.w + x0]! * (1 - fx) + L.mean[y0 * L.w + x1]! * fx;
  const b = L.mean[y1 * L.w + x0]! * (1 - fx) + L.mean[y1 * L.w + x1]! * fx;
  return a * (1 - fy) + b * fy;
}

/** the receiver's height: the highest of the nearest texel at a level and its 8 neighbours (horizon.wgsl topAround) — the
 *  nearest, not the 2 × 2 round the point: a lattice's texel centre falls on a texel's corner one level up, where f32 and f64
 *  would pick different windows */
export function topAround(src: HeightPyramid, q: Vec3, level: number): number {
  const L = src.levels[Math.max(0, Math.min(level, src.levels.length - 1))]!;
  const u = 0.5 + Math.atan2(q[1], q[0]) / (2 * Math.PI),
    v = 0.5 - Math.asin(Math.max(-1, Math.min(1, q[2]))) / Math.PI;
  const cx = Math.floor(u * L.w),
    cy = Math.floor(v * L.h);
  let m = -Infinity;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = (((cx + dx) % L.w) + L.w) % L.w,
        y = Math.max(0, Math.min(cy + dy, L.h - 1));
      m = Math.max(m, L.top[y * L.w + x]!);
    }
  return m;
}

/** The bake's settings for a body: its radius [m], its source's texel [m], where the rays start and end [m], the steps. */
export interface BakeRange {
  R: number;
  texelSrc: number;
  D0: number;
  Dmax: number;
  steps: number;
  /** the level the receiver's height is read at (the texel and its neighbours' top) */
  obsLevel: number;
}
/**
 * D_bake: two of the lattice's texels; the reach: √(2R·Δh) — past it the body's whole relief Δh (its highest less its
 * lowest) is under the horizon of a point on its lowest ground —, at most half the radius.
 */
export function bakeRange(l: Lattice, src: { W: number; H: number }, R: number, relief: number): BakeRange {
  const texelSrc = (Math.PI * R) / src.H;
  const D0 = 2 * latticeTexel(l) * R;
  const Dmax = Math.max(Math.min(Math.sqrt(2 * R * Math.max(relief, 1)), 0.5 * R), 2 * D0);
  const steps = Math.ceil(Math.log(Dmax / D0) / Math.log(HORIZON_STEP)) + 1;
  // (the texel and its neighbours at the level of the lattice's texel — topAround: the map at half the DEM, 6 × 6 of its texels,
  // 16 km on the Moon; a level higher, 8 × 8 round the point, 21 km: valleys' receivers seen from their ridges)
  const obsLevel = Math.max(0, Math.round(Math.log2((latticeTexel(l) * R) / texelSrc)));
  return { R, texelSrc, D0, Dmax, steps, obsLevel };
}
/** the level read at a distance d along a ray: its texel at least half the step there (0.2·d at ×1.25) — the 2 × 2 read round
 *  each step then spans the step: no blocker slips between two (a texel at most half the step left gaps: the bake 1.2° under
 *  the reference on a cratered body) */
export const stepLevel = (r: BakeRange, d: number) => Math.max(0, Math.ceil(Math.log2((0.5 * (1 - 1 / HORIZON_STEP) * d) / r.texelSrc)));

/** the sine of the elevation of a point at height h, an arc θ away, seen from height h0 (radius R): the curvature exact,
 *  the cancellation of R·cos θ against R avoided */
export function elevationSin(R: number, h0: number, h: number, theta: number): number {
  const rt = R + h;
  const s = Math.sin(0.5 * theta);
  const vert = h - h0 - rt * 2 * s * s;
  const horiz = rt * Math.sin(theta);
  return vert / Math.hypot(vert, horiz);
}
/** the point an arc θ along the great circle from p (unit) leaving along the tangent t */
const along = (p: Vec3, t: Vec3, th: number): Vec3 => {
  const c = Math.cos(th),
    s = Math.sin(th);
  return [p[0] * c + t[0] * s, p[1] * c + t[1] * s, p[2] * c + t[2] * s];
};

/** One texel's horizons as the GPU bakes them (horizon.wgsl bake): the sectors' highest sines. `h0` overrides the receiver's
 *  height (the tests' "receiver higher or lower"); `reads` the rays' heights — the ground's mean a level over the step's
 *  (option (d), decision 37, the default) or its top. */
export function bakeTexel(
  l: Lattice,
  src: HeightPyramid,
  r: BakeRange,
  i: number,
  j: number,
  h0?: number,
  reads: "top" | "mean" = "mean",
): Float64Array {
  return bakeTexelSteps(l, src, r, i, j, h0, reads).sin;
}
/** bakeTexel with each sector's dominant blocker's step n — its distance D_bake × 1.25ⁿ — as the GPU stores it (its layers
 *  after the sines'), and the receiver's height it was seen from */
export function bakeTexelSteps(
  l: Lattice,
  src: HeightPyramid,
  r: BakeRange,
  i: number,
  j: number,
  h0?: number,
  reads: "top" | "mean" = "mean",
) {
  const { p, lat, lon } = latticePoint(l, i, j);
  const obs = h0 ?? topAround(src, p, r.obsLevel);
  const S = latticeSectors(l),
    spread = sectorSpread(l);
  const sin = new Float64Array(S),
    step = new Uint8Array(S);
  for (let k = 0; k < S; k++) {
    let best = -1;
    for (const o of [-spread, 0, spread]) {
      const t = latticeTangent(l, lat, lon, sectorAngle(l, k) + o);
      let d = r.D0;
      for (let n = 0; n < r.steps; n++, d *= HORIZON_STEP) {
        const th = d / r.R;
        const q = along(p, t, th);
        const h = reads === "top" ? topAt(src, q, stepLevel(r, d)) : meanLevelAt(src, q, stepLevel(r, d) + 1);
        const e = elevationSin(r.R, obs, h, th);
        if (e > best) (best = e), (step[k] = n);
      }
    }
    sin[k] = best;
  }
  return { sin, step, obs };
}
/** option (d)'s horizon seen again from a receiver at h — the bake's from h0, its blocker d away: tan e' = tan e + (h0 − h)/d
 *  (decision 37; the shading's, H2/H3) — as a sine */
export function horizonSeenFrom(sinBaked: number, h0: number, h: number, d: number): number {
  const c = Math.sqrt(Math.max(1 - sinBaked * sinBaked, 1e-12));
  const t = sinBaked / c + (h0 - h) / d;
  return t / Math.sqrt(1 + t * t);
}

/** The same texel baked as the reference does (the plan's "cuisson de référence au pas d'un texel"): the same three rays a
 *  sector, but a step of one source texel from D_bake to the reach and the heights at their level 0 (no mips). */
export function bakeTexelReference(l: Lattice, src: HeightPyramid, r: BakeRange, i: number, j: number, h0?: number): Float64Array {
  const { p, lat, lon } = latticePoint(l, i, j);
  const obs = h0 ?? topAround(src, p, r.obsLevel);
  const S = latticeSectors(l),
    spread = sectorSpread(l);
  const out = new Float64Array(S);
  for (let k = 0; k < S; k++) {
    let best = -1;
    for (const o of [-spread, 0, spread]) {
      const t = latticeTangent(l, lat, lon, sectorAngle(l, k) + o);
      for (let d = r.D0; d <= r.Dmax; d += r.texelSrc) {
        const th = d / r.R;
        const e = elevationSin(r.R, obs, topAt(src, along(p, t, th), 0), th);
        if (e > best) best = e;
      }
    }
    out[k] = best;
  }
  return out;
}

/** The same bake keeping each sector's dominant blocker — its distance [m] and height [m] (the plan's "distance by direction",
 *  2 more layers, §2.5): the horizon then seen again from another receiver's height (`horizonFrom`). CPU only (the pilot's
 *  measure of that option). */
export function bakeTexelBlockers(
  l: Lattice,
  src: HeightPyramid,
  r: BakeRange,
  i: number,
  j: number,
  h0?: number,
  reads: "top" | "mean" = "top",
) {
  const { p, lat, lon } = latticePoint(l, i, j);
  const obs = h0 ?? topAround(src, p, r.obsLevel);
  const S = latticeSectors(l),
    spread = sectorSpread(l);
  const sin = new Float64Array(S),
    dist = new Float64Array(S),
    height = new Float64Array(S);
  for (let k = 0; k < S; k++) {
    let best = -1;
    for (const o of [-spread, 0, spread]) {
      const t = latticeTangent(l, lat, lon, sectorAngle(l, k) + o);
      let d = r.D0;
      for (let n = 0; n < r.steps; n++, d *= HORIZON_STEP) {
        const th = d / r.R;
        // (the mean's level: its texel the step's — a bilinear read of the means spans it)
        const q = along(p, t, th);
        const h = reads === "top" ? topAt(src, q, stepLevel(r, d)) : meanLevelAt(src, q, stepLevel(r, d) + 1);
        const e = elevationSin(r.R, obs, h, th);
        if (e > best) (best = e), (dist[k] = d), (height[k] = h);
      }
    }
    sin[k] = best;
  }
  return { sin, dist, height, obs };
}
/** a sector's horizon seen from a receiver at h instead of the bake's (its dominant blocker kept) */
export const horizonFrom = (R: number, h: number, dist: number, height: number) => elevationSin(R, h, height, dist / R);

/** a direction's horizon read from the sectors' (as the shading will: the two neighbours of its angle, interpolated) */
export function horizonAt(sectors: ArrayLike<number>, angle: number): number {
  const S = sectors.length;
  const a = ((((angle / (2 * Math.PI)) * S) % S) + S) % S;
  const k = Math.floor(a),
    f = a - k;
  return sectors[k]! * (1 - f) + sectors[(k + 1) % S]! * f;
}

/** the mean height at a point, bilinear over the level-0 texels (a receiver's own ground, the reference's blockers) */
export function meanAt(map: ArrayLike<number>, W: number, H: number, q: Vec3): number {
  const u = 0.5 + Math.atan2(q[1], q[0]) / (2 * Math.PI),
    v = 0.5 - Math.asin(Math.max(-1, Math.min(1, q[2]))) / Math.PI;
  const x = u * W - 0.5,
    y = v * H - 0.5;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const x0 = ((ix % W) + W) % W,
    x1 = (x0 + 1) % W;
  const y0 = Math.max(0, Math.min(iy, H - 1)),
    y1 = Math.max(0, Math.min(iy + 1, H - 1));
  const a = map[y0 * W + x0]! * (1 - fx) + map[y0 * W + x1]! * fx;
  const b = map[y1 * W + x0]! * (1 - fx) + map[y1 * W + x1]! * fx;
  return a * (1 - fy) + b * fy;
}

/**
 * The truth the map is measured against (the pilot): from a point at its own height, along one exact azimuth, the highest
 * sine of elevation of the ground — its mean heights, bilinear, a step of `step` of their texels — from `from` to `to` [m].
 */
export function referenceHorizon(
  map: ArrayLike<number>,
  W: number,
  H: number,
  R: number,
  p: Vec3,
  t: Vec3,
  h0: number,
  from: number,
  to: number,
  step = 1,
): number {
  const ds = ((Math.PI * R) / H) * step;
  let best = -1;
  for (let d = from; d <= to; d += ds) {
    const th = d / R;
    const e = elevationSin(R, h0, meanAt(map, W, H, along(p, t, th)), th);
    if (e > best) best = e;
  }
  return best;
}

/** the worlds baked (H1: the Moon, the pilot — Mars, Mercury and Ceres after its decision gate) */
export const HORIZON_BODIES: readonly MapName[] = ["moon"];
/** the map's width: half the DEM's, 2048 at most (plan §2.4: 2048 × 1024, ~22 MB with its mips) */
export const horizonMapWidth = (demW: number) => Math.min(2048, Math.max(256, demW >> 1));

type Job = { lattice: Lattice; range: BakeRange; target: GPUTexture; layer0: number; row: number; uniform: GPUBuffer; group: GPUBindGroup };

/**
 * A body's horizon maps on the GPU (its map: W × W/2 × 2 layers; its caps: 256² × 8 layers — 4 north, 4 south —; both
 * rgba8unorm, mip-mapped), baked a band of rows a frame — the band sized on its measured time (GpuProfiler, `budgetMs`) —,
 * dropped when the body's finer maps go (another body, or none). `doneMs`: the time from its start to the whole map, mips in.
 */
export class HorizonMaps {
  map: GPUTexture | null = null;
  pole: GPUTexture | null = null;
  /** the body baked or baking, and its source (the finer maps' relief it was started from) */
  body: MapName | null = null;
  private source: GPUTexture | null = null;
  state: "idle" | "baking" | "done" = "idle";
  /** the rows a dispatch (the map's; a cap's band scaled to its width), the time a frame's band aims at [ms] */
  rows = 16;
  budgetMs = 2;
  /** the rays' reads: the ground's mean a level over the step's (option (d), decision 37) or its top (the pilot's (a)) */
  reads: "mean" | "top" = "mean";
  startedAt = 0;
  doneMs = 0;
  frames = 0;
  /** the band's last measured time [ms] (0: none yet), the bands dispatched */
  lastMs = 0;
  bands = 0;
  /** what a bake was started for: radius [m], the source's size, its relief's span [m] */
  ranges: { map: BakeRange; pole: BakeRange } | null = null;
  private jobs: Job[] = [];
  /** a finished band's uniforms, freed at the next frame (this one's commands not yet submitted) */
  private retired: GPUBuffer[] = [];
  private pipeline: GPUComputePipeline | null = null;
  private mipPipeline: GPUComputePipeline | null = null;
  constructor(private device: GPUDevice) {}

  private pipelines() {
    if (this.pipeline) return;
    const module = this.device.createShaderModule({ code: horizonWGSL, label: "horizon bake" });
    this.pipeline = this.device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "bake" }, label: "horizon bake" });
    this.mipPipeline = this.device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "mip" }, label: "horizon mips" });
  }

  /** Drops the bake and its maps (the body's finer maps gone). */
  cancel() {
    const old = [this.map, this.pole];
    this.map = this.pole = null;
    this.body = null;
    this.source = null;
    this.state = "idle";
    this.ranges = null;
    for (const j of this.jobs) j.uniform.destroy();
    this.jobs = [];
    void this.device.queue.onSubmittedWorkDone().then(() => old.forEach((t) => t?.destroy()));
  }

  /**
   * A frame's share of the bake for the body whose finer maps are in (`name`, its relief texture — rg16float, G the highest
   * down the mips —, its heights' size and span, its radius [m]): started anew when they change, a band of rows encoded,
   * the mips once the rows are all in. Nothing for a body not baked (HORIZON_BODIES) or without heights.
   */
  encode(
    enc: GPUCommandEncoder,
    hd: { name: MapName | null; relief: GPUTexture; dem: { W: number; H: number; lo: number; hi: number } | null },
    R: number,
    desc?: () => GPUComputePassDescriptor,
    measuredMs?: number,
  ): boolean {
    for (const b of this.retired.splice(0)) b.destroy();
    const wanted = !!hd.name && !!hd.dem && HORIZON_BODIES.includes(hd.name);
    if (!wanted) {
      if (this.body) this.cancel();
      return false;
    }
    if (this.body !== hd.name || this.source !== hd.relief) this.start(hd.name!, hd.relief, hd.dem!, R);
    if (this.state !== "baking") return false;
    this.frames++;
    const job = this.jobs[0];
    if (!job) {
      this.encodeMips(enc);
      this.state = "done";
      this.doneMs = performance.now() - this.startedAt;
      return true;
    }
    const { w, h } = latticeSize(job.lattice);
    // (a cap's band as many texels as the map's)
    const map = this.jobs.find((j) => j.lattice.kind === "latlon")?.lattice ?? job.lattice;
    const rows = Math.max(1, Math.round((this.rows * latticeSize(map).w) / w));
    const n = Math.min(rows, h - job.row);
    // (the profiler's last measure of a band — when it is on —: the next bands sized to the budget, by at most ×2 at once)
    if (measuredMs && measuredMs > 0 && measuredMs !== this.lastMs) {
      this.lastMs = measuredMs;
      this.rows = Math.max(1, Math.min(512, Math.round(this.rows * Math.min(2, Math.max(0.5, this.budgetMs / measuredMs)))));
    }
    this.device.queue.writeBuffer(job.uniform, 12, new Uint32Array([job.row]));
    const pass = enc.beginComputePass(desc?.() ?? { label: "horizon bake" });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, job.group);
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(n / 8));
    pass.end();
    job.row += n;
    this.bands++;
    if (job.row >= h) {
      this.retired.push(job.uniform);
      this.jobs.shift();
    }
    return true;
  }

  private start(name: MapName, relief: GPUTexture, dem: { W: number; H: number; lo: number; hi: number }, R: number) {
    this.cancel();
    this.pipelines();
    const d = this.device;
    this.body = name;
    this.source = relief;
    this.state = "baking";
    this.startedAt = performance.now();
    this.frames = 0;
    this.bands = 0;
    this.doneMs = 0;
    const W = horizonMapWidth(dem.W);
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;
    const levels = (n: number) => Math.floor(Math.log2(n)) + 1;
    // (option (d): the sines' layers, then as many for the blockers' steps — the map 2 + 2, a cap 4 + 4)
    this.map = d.createTexture({ size: [W, W / 2, 4], format: "rgba8unorm", mipLevelCount: levels(W), usage, label: "horizon map" });
    this.pole = d.createTexture({
      size: [POLE_N, POLE_N, 16],
      format: "rgba8unorm",
      mipLevelCount: levels(POLE_N),
      usage,
      label: "horizon caps",
    });
    const srcView = relief.createView();
    const top = relief.mipLevelCount - 1;
    const add = (lattice: Lattice, target: GPUTexture, layer0: number) => {
      const range = bakeRange(lattice, dem, R, dem.hi - dem.lo);
      const { w, h } = latticeSize(lattice);
      const u = new ArrayBuffer(80);
      const U = new Uint32Array(u),
        F = new Float32Array(u);
      U.set([lattice.kind === "latlon" ? 0 : 1, w, h, 0], 0);
      if (lattice.kind === "latlon") F.set([lattice.lon0, lattice.lat0, lattice.dlon, lattice.dlat], 4);
      else F.set([lattice.pole, lattice.rmax, 0, 0], 4);
      F.set([range.R, range.D0, range.Dmax, range.texelSrc], 8);
      U.set([range.steps, range.obsLevel, latticeSectors(lattice), top], 12);
      F.set([sectorSpread(lattice), layer0, this.reads === "mean" ? 1 : 0, 0], 16);
      const uniform = d.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: "horizon bake" });
      d.queue.writeBuffer(uniform, 0, u);
      const group = d.createBindGroup({
        layout: this.pipeline!.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: srcView },
          { binding: 2, resource: target.createView({ dimension: "2d-array", baseMipLevel: 0, mipLevelCount: 1 }) },
        ],
      });
      this.jobs.push({ lattice, range, target, layer0, row: 0, uniform, group });
      return range;
    };
    const map = add(globalLattice(W, W / 2), this.map, 0);
    const pole = add(capLattice(1), this.pole, 0);
    add(capLattice(-1), this.pole, 8);
    this.ranges = { map, pole };
  }

  private encodeMips(enc: GPUCommandEncoder) {
    for (const t of [this.map!, this.pole!]) {
      for (let l = 1; l < t.mipLevelCount; l++) {
        const group = this.device.createBindGroup({
          layout: this.mipPipeline!.getBindGroupLayout(0),
          entries: [
            { binding: 3, resource: t.createView({ dimension: "2d-array", baseMipLevel: l - 1, mipLevelCount: 1 }) },
            { binding: 4, resource: t.createView({ dimension: "2d-array", baseMipLevel: l, mipLevelCount: 1 }) },
          ],
        });
        const pass = enc.beginComputePass({ label: "horizon mips" });
        pass.setPipeline(this.mipPipeline!);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(Math.ceil(Math.max(1, t.width >> l) / 8), Math.ceil(Math.max(1, t.height >> l) / 8), t.depthOrArrayLayers);
        pass.end();
      }
    }
  }

  /** the maps' bytes on the GPU (their mips in) */
  get bytes() {
    const b = (t: GPUTexture | null) => (t ? t.width * t.height * t.depthOrArrayLayers * 4 * (4 / 3) : 0);
    return Math.round(b(this.map) + b(this.pole));
  }

  stats() {
    return {
      body: this.body,
      state: this.state,
      rows: this.rows,
      lastMs: this.lastMs,
      frames: this.frames,
      bands: this.bands,
      doneMs: Math.round(this.doneMs),
      left: this.jobs.reduce((a, j) => a + latticeSize(j.lattice).h - j.row, 0),
      bytes: this.bytes,
      ranges: this.ranges,
    };
  }

  /** The baked maps' level 0 read back (the e2e's: the pilot's measure, the CPU reference's comparison): each layer's bytes. */
  async read(): Promise<{
    map: { w: number; h: number; layers: Uint8Array[] };
    pole: { w: number; h: number; layers: Uint8Array[] };
  } | null> {
    if (this.state !== "done" || !this.map || !this.pole) return null;
    const one = async (t: GPUTexture) => {
      const bpr = Math.ceil((t.width * 4) / 256) * 256;
      const buf = this.device.createBuffer({
        size: bpr * t.height * t.depthOrArrayLayers,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const enc = this.device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: t }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: t.height }, [
        t.width,
        t.height,
        t.depthOrArrayLayers,
      ]);
      this.device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const all = new Uint8Array(buf.getMappedRange());
      const layers: Uint8Array[] = [];
      for (let l = 0; l < t.depthOrArrayLayers; l++) {
        const out = new Uint8Array(t.width * t.height * 4);
        for (let y = 0; y < t.height; y++)
          out.set(all.subarray(l * bpr * t.height + y * bpr, l * bpr * t.height + y * bpr + t.width * 4), y * t.width * 4);
        layers.push(out);
      }
      buf.unmap();
      buf.destroy();
      return { w: t.width, h: t.height, layers };
    };
    return { map: await one(this.map), pole: await one(this.pole) };
  }
}
