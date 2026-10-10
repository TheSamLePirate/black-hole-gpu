// The planets' relief on the CPU: the same function as the tracer's (trace.wgsl: relief), so the
// ship stands on the ground that is drawn. Gradient noise on the PCG hash (32-bit integer
// arithmetic, as on the GPU); heights in metres above the sphere at a unit direction on the body's
// own axes (x away from its primary, y along its orbit, z north).

import { WGS84_A } from "./system/ellipsoid";

export type V3 = [number, number, number];

/** surface kinds, as the GPU body list numbers them */
export const SURF = { ocean: 0, ice: 1, rock: 2, gas: 3 } as const;

function pcg(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
const hash3u = (x: number, y: number, z: number) => pcg((x ^ pcg((y ^ pcg(z)) >>> 0)) >>> 0);

/** Gradient noise (the tracer's gnoise). */
export function gnoise(p: V3): number {
  const i = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  const f = [p[0] - i[0]!, p[1] - i[1]!, p[2] - i[2]!];
  const u = f.map((x) => x * x * x * (x * (x * 6 - 15) + 10));
  const n: number[] = [];
  for (let c = 0; c < 8; c++) {
    const o = [c & 1, (c >> 1) & 1, (c >> 2) & 1];
    const h = hash3u((i[0]! + o[0]!) >>> 0, (i[1]! + o[1]!) >>> 0, (i[2]! + o[2]!) >>> 0);
    const g = [h & 0x3ff, (h >>> 10) & 0x3ff, (h >>> 20) & 0x3ff].map((k) => (k * 2) / 1023 - 1);
    n.push(g[0]! * (f[0]! - o[0]!) + g[1]! * (f[1]! - o[1]!) + g[2]! * (f[2]! - o[2]!));
  }
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return (
    1.6 *
    mix(
      mix(mix(n[0]!, n[1]!, u[0]!), mix(n[2]!, n[3]!, u[0]!), u[1]!),
      mix(mix(n[4]!, n[5]!, u[0]!), mix(n[6]!, n[7]!, u[0]!), u[1]!),
      u[2]!,
    )
  );
}

function tfbm(p0: V3, oct: number): number {
  let p = p0;
  let a = 0.5,
    s = 0,
    n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * gnoise(p);
    n += a;
    p = [p[0] * 2.03 + 1.7, p[1] * 2.03 + 9.2, p[2] * 2.03 + 3.1];
    a *= 0.5;
  }
  return s / n;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

const layerOct = (f: number, foot: number, mR: number, most: number) =>
  Math.min(Math.max(Math.trunc(Math.log2(mR / (f * 4 * Math.max(foot, 0.05)))), 0), most);

function ridged(p: V3, oct: number) {
  if (oct <= 0) return 0.5;
  const r = 1 - Math.abs(tfbm(p, oct));
  return r * r;
}

const sc = (q: V3, k: number, o = 0): V3 => [q[0] * k + o, q[1] * k + o, q[2] * k + o];

/**
 * The ground's height [m] at a unit direction on the body's axes, as the tracer draws it at a pixel
 * footprint `foot` [m] (the finest detail: 0.05 m) on a body of `mR` metres per radius. Miller: sea
 * level — its giant waves are drawn, not felt.
 */
export function relief(surf: number, q: V3, mR: number, foot = 0.05): number {
  if (surf === SURF.ice) {
    let h = (0.5 + 0.5 * tfbm(sc(q, 6), Math.max(layerOct(6, foot, mR, 5), 1))) * 1400;
    h += ridged(sc(q, 24, 5), layerOct(24, foot, mR, 4)) * 900;
    const oh = layerOctF(300, foot, mR, 5);
    if (oh > 0) h += ridgedMF(sc(q, 300, 2), oh) * 1800;
    const oc = layerOct(3000, foot, mR, 3);
    if (oc > 0) h += ridged(sc(q, 3000, 7), oc) * 300;
    const orc = layerOct(30000, foot, mR, 3);
    if (orc > 0) h += (0.5 + 0.5 * tfbm(sc(q, 30000), orc)) * 40;
    const ou = layerOct(300000, foot, mR, 2);
    if (ou > 0) h += (0.5 + 0.5 * tfbm(sc(q, 300000), ou)) * 4;
    return h;
  }
  if (surf === SURF.rock) {
    const base = 0.5 + 0.5 * tfbm(sc(q, 5), Math.max(layerOct(5, foot, mR, 5), 1));
    let h = base * 1000;
    const om = layerOct(300, foot, mR, 3);
    if (om > 0) h += smooth(0.55, 0.62, 0.5 + 0.5 * tfbm(sc(q, 300), om)) * 380;
    const oh = layerOct(3000, foot, mR, 3);
    if (oh > 0) h += (0.5 + 0.5 * tfbm(sc(q, 3000, 3), oh)) * 200;
    const ou = layerOct(300000, foot, mR, 2);
    if (ou > 0) h += (0.5 + 0.5 * tfbm(sc(q, 300000), ou)) * 3;
    const od = layerOct(30000, foot, mR, 1);
    if (od > 0) {
      const dune = 0.5 + 0.5 * Math.sin((q[0] * 0.6 + q[1] * 0.8) * 30000 + 4 * tfbm(sc(q, 80), 2));
      h += dune * 25 * smooth(0.45, 0.25, base);
    }
    return h;
  }
  return 0;
}

const u2f = (h: number) => (h >>> 8) / 16777216;
/** The tracer's hash4: four uniform numbers from a lattice cell (x ^ a, y ^ b, z ^ c). */
function hash4(x: number, y: number, z: number): [number, number, number, number] {
  const h = hash3u(x >>> 0, y >>> 0, z >>> 0);
  const h2 = pcg(h),
    h3 = pcg(h2),
    h4 = pcg(h3);
  return [u2f(h), u2f(h2), u2f(h3), u2f(h4)];
}

/** How cratered one of our airless worlds is, by its map's index (the tracer's craterDensity). */
export function craterDensity(m: number) {
  return m === 10 ? 0.03 : m === 11 ? 0.12 : m === 15 ? 0.5 : m === 12 ? 0.75 : 1;
}

/**
 * The ground of one of our airless worlds finer than its map (the tracer's craterRelief): craters in six
 * sizes (cells 4 km … 5 m, at most one in each: a bowl, its rim, its ejecta; fresh or worn) and a
 * swell of a few km — height [m] at a unit direction q on its axes (m: its map's index; mR: metres per
 * radius; foot: the pixel's footprint [m]).
 */
export function craterRelief(m: number, q: V3, mR: number, foot = 0.05): number {
  const dens = craterDensity(m);
  let h = 0;
  let cell = 4000;
  for (let l = 0; l < 7; l++) {
    const w = Math.min(Math.max(Math.log2(cell / (8 * Math.max(foot, 0.05))), 0), 1);
    if (w <= 0) break;
    const k = mR / cell;
    const p: V3 = [q[0] * k, q[1] * k, q[2] * k];
    const c = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
    const r = hash4(c[0]! ^ Math.imul(m, 7919), c[1]! ^ Math.imul(l, 104729), c[2]! ^ 0x9e3779b9);
    if (r[3] < dens * 0.55) {
      const r2 = hash4(c[0]! ^ Math.imul(l, 2654435), c[1]! ^ Math.imul(m, 40503), c[2]! ^ 0x85ebca6b);
      const rad = 0.08 + 0.2 * r2[0] * r2[0];
      const ctr = [0, 1, 2].map((i) => c[i]! + 0.5 + (r[i]! - 0.5) * (1 - 3.2 * rad));
      const x = Math.hypot(p[0] - ctr[0]!, p[1] - ctr[1]!, p[2] - ctr[2]!) / rad;
      if (x < 1.6) {
        const fresh = 0.3 + 0.7 * r2[1];
        const D = 0.4 * rad * cell * fresh;
        const Hr = 0.22 * D;
        h += w * (x < 1 ? (x * x - 1) * D + Hr : Hr * Math.exp(-4 * (x - 1)) * smooth(1.6, 1.15, x));
      }
    }
    cell *= 0.33333;
  }
  const os = layerOctF(mR / 3000, foot, mR, 5);
  if (os > 0) h += tfbmF(sc(q, mR / 3000, m * 3.7), os) * Math.min(os, 1) * 90;
  return h;
}

/**
 * Miller's giant waves (the tracer's: drawn, not felt): their height [m] at a unit direction q on its
 * axes, tSec seconds into the scene's clock.
 */
export function millerWaves(q: V3, tSec: number, mR: number, foot = 0.05): number {
  let h = 0;
  for (let i = 0; i < 3; i++) {
    const d = [Math.cos(i * 2.1 + 0.3), Math.sin(i * 2.1 + 0.3), 0.35 * i - 0.3];
    const l = Math.hypot(d[0]!, d[1]!, d[2]!);
    const ph = ((q[0] * d[0]! + q[1] * d[1]! + q[2] * d[2]!) / l) * 14 + i * 1.7 - tSec * (4e-5 + 1e-5 * i);
    const crest = (0.5 + 0.5 * Math.sin(ph)) ** 40;
    h += crest * (0.65 + 0.35 * tfbm(sc(q, 40, i), Math.max(layerOct(40, foot, mR, 5), 1)));
  }
  return h * 1200;
}

/** The Earth's radius [m] (its relief's scale): WGS84's a — the ellipsoid on its squashed axes the sphere (ellipsoid.ts). */
export const EARTH_RM = WGS84_A;

/** Musgrave's ridged multifractal (the tracer's ridgedMF): sharp crests, smooth valleys; 0 … ~1; `oct`
 *  fractional (the last octave faded in). */
function ridgedMF(p0: V3, oct: number): number {
  let p = p0;
  let sig = 1 - Math.abs(gnoise(p));
  sig *= sig;
  let sum = sig,
    amp = 1,
    norm = 1;
  for (let i = 1; i < oct; i++) {
    p = [p[0] * 2.03 + 1.7, p[1] * 2.03 + 9.2, p[2] * 2.03 + 3.1];
    const w = Math.min(Math.max(sig * 1.8, 0), 1);
    amp *= 0.5;
    const fade = Math.min(Math.max(oct - i, 0), 1);
    sig = 1 - Math.abs(gnoise(p));
    sig = sig * sig * w;
    sum += sig * amp * fade;
    norm += amp * fade;
  }
  return sum / norm;
}
/** Fractal noise with a fractional number of octaves (the tracer's tfbmF). */
function tfbmF(p0: V3, oct: number): number {
  let p = p0;
  let a = 0.5,
    s = 0,
    n = 0;
  for (let i = 0; i < oct; i++) {
    const fade = Math.min(Math.max(oct - i, 0), 1);
    s += a * fade * gnoise(p);
    n += a * fade;
    p = [p[0] * 2.03 + 1.7, p[1] * 2.03 + 9.2, p[2] * 2.03 + 3.1];
    a *= 0.5;
  }
  return s / Math.max(n, 1e-6);
}
/** The tracer's octaveKept, ridgedMFw, tfbmFw: each octave (wavelength λ [m]) weighed by what the
 *  heights hold — drawn where their resolution res is coarser, faded out where they resolve it. */
const octaveKept = (lam: number, res: number) => 1 - smooth(res, 3 * res, lam);
/** the first octave kept (λ < 3 res) of a ladder from lam0 halved by 2.03 (the tracer's firstKept) */
const firstKept = (lam0: number, res: number) => Math.max(Math.floor(Math.fround(Math.log2(lam0 / (3 * res)) / 1.0215)) + 1, 0);
function ridgedMFw(p0: V3, oct: number, lam0: number, res: number): number {
  const i0 = firstKept(lam0, res);
  let p = p0;
  let lam = lam0,
    amp = 1,
    norm = 1;
  for (let i = 1; i <= i0; i++) {
    p = [p[0] * 2.03 + 1.7, p[1] * 2.03 + 9.2, p[2] * 2.03 + 3.1];
    lam /= 2.03;
    amp *= 0.5;
    norm += amp * Math.min(Math.max(oct - i, 0), 1);
  }
  if (i0 >= oct) return 0;
  let sig = 1 - Math.abs(gnoise(p));
  sig *= sig;
  let sum = (sig - 0.3) * amp * (i0 === 0 ? 1 : Math.min(Math.max(oct - i0, 0), 1)) * octaveKept(lam, res);
  for (let i = i0 + 1; i < oct; i++) {
    p = [p[0] * 2.03 + 1.7, p[1] * 2.03 + 9.2, p[2] * 2.03 + 3.1];
    lam /= 2.03;
    const w = Math.min(Math.max(sig * 1.8, 0), 1);
    amp *= 0.5;
    const fade = Math.min(Math.max(oct - i, 0), 1);
    sig = 1 - Math.abs(gnoise(p));
    sig = sig * sig * w;
    sum += (sig - 0.3) * amp * fade * octaveKept(lam, res);
    norm += amp * fade;
  }
  return sum / norm;
}
function tfbmFw(p0: V3, oct: number, lam0: number, res: number): number {
  const i0 = firstKept(lam0, res);
  let p = p0;
  let a = 0.5,
    s = 0,
    n = 0,
    lam = lam0;
  for (let i = 0; i < oct; i++) {
    const fade = Math.min(Math.max(oct - i, 0), 1);
    if (i >= i0) s += a * fade * gnoise(p) * octaveKept(lam, res);
    n += a * fade;
    p = [p[0] * 2.03 + 1.7, p[1] * 2.03 + 9.2, p[2] * 2.03 + 3.1];
    a *= 0.5;
    lam /= 2.03;
  }
  return s / Math.max(n, 1e-6);
}
/** A layer's octaves resolved at a footprint, fractional (the tracer's layerOctF). */
const layerOctF = (f: number, foot: number, mR: number, most: number) =>
  Math.min(Math.max(Math.log2(mR / (f * 4 * Math.max(foot, 0.05))), 0), most);

/**
 * The Earth's relief finer than its height map (h0: the map's height there [m]; res: the heights'
 * resolution there [m] — the layers it resolves faded out): on its mountains a ridged multifractal on a
 * warped lattice (ridges ~4 km apart down to ~100 m), hills on its plains, rocks — the tracer's
 * earthDetail, at a pixel footprint `foot` [m].
 */
export function earthDetail(q: V3, h0: number, foot = 0.05, res = EARTH_MAP_RES): number {
  const mount = smooth(300, 2500, h0);
  const land = smooth(0, 40, h0);
  let h = 0;
  const o1 = layerOctF(1500, foot, EARTH_RM, 7);
  if (o1 > firstKept(EARTH_RM / 1500, res) && mount > 0) {
    const w: V3 = [tfbm(sc(q, 600, 3.1), 2), tfbm(sc(q, 600, 7.7), 2), tfbm(sc(q, 600, 1.3), 2)];
    const pw: V3 = [q[0] * 1500 + 11 + 0.7 * w[0], q[1] * 1500 + 11 + 0.7 * w[1], q[2] * 1500 + 11 + 0.7 * w[2]];
    h += ridgedMFw(pw, o1, EARTH_RM / 1500, res) * 1500 * mount;
  }
  const o2 = layerOctF(20000, foot, EARTH_RM, 3);
  if (o2 > 0 && land > 0) h += tfbmFw(sc(q, 20000, 5), o2, EARTH_RM / 20000, res) * Math.min(o2, 1) * 50 * land * (1 - mount);
  const o3 = layerOctF(200000, foot, EARTH_RM, 3);
  if (o3 > 0 && land > 0) h += tfbmF(sc(q, 200000, 3), o3) * Math.min(o3, 1) * (3 + 8 * mount) * land;
  return h;
}

/** The global height map's texel at the equator [m] (8192 wide: the resolution earthDetail assumes). */
export const EARTH_MAP_RES = (EARTH_RM * 2 * Math.PI) / 8192;

/** Cubic B-spline weights for the texels −1 … +2 around a fraction t. */
const bspline4 = (t: number) => {
  const t2 = t * t,
    t3 = t2 * t;
  return [(1 - 3 * t + 3 * t2 - t3) / 6, (4 - 6 * t2 + 3 * t3) / 6, (1 + 3 * t + 3 * t2 - 3 * t3) / 6, t3 / 6];
};

/** A value as a half float holds it (the tracer's r16float height map: 1 m steps up to 2 048 m, 4 m to 8 192). */
export function toHalf(v: number): number {
  const a = Math.abs(v);
  if (a < 6.103515625e-5) return Math.round(v / 5.960464477539063e-8) * 5.960464477539063e-8;
  const e = Math.floor(Math.log2(a));
  const ulp = 2 ** (e - 10);
  return Math.round(v / ulp) * ulp;
}

/**
 * A height map's height [m] at a unit direction on its body's axes (whole metres per texel, W × H
 * equirectangular: u = 0.5 + longitude/360°, texel centres — as the tracer holds them: half floats) as
 * the tracer samples it near: a cubic B-spline over its texels, wrapping in longitude (trace.wgsl:
 * earthH0, demH0 — the same weights).
 */
export function mapHeightSampler(map: Int16Array, W: number, H: number) {
  return (q: V3): number => {
    const lon = Math.atan2(q[1], q[0]);
    const lat = Math.asin(Math.min(Math.max(q[2], -1), 1));
    const x = (0.5 + lon / (2 * Math.PI)) * W - 0.5;
    const y = (0.5 - lat / Math.PI) * H - 0.5;
    const x0 = Math.floor(x),
      y0 = Math.floor(y);
    const wx = bspline4(x - x0),
      wy = bspline4(y - y0);
    let v = 0;
    for (let j = 0; j < 4; j++) {
      const yy = Math.min(Math.max(y0 + j - 1, 0), H - 1);
      let row = 0;
      for (let i = 0; i < 4; i++) row += wx[i]! * toHalf(map[yy * W + ((((x0 + i - 1) % W) + W) % W)]!);
      v += wy[j]! * row;
    }
    return v;
  };
}

/**
 * The heights a terrain tile takes where its own will not load (offline, refused, timed out): the map's,
 * sampled as the ground had them (mapHeightSampler's B-spline, the sea floor at 0) — on a runway, graded
 * flat, the very ground the craft rolled on before the tile; elsewhere a ground as smooth as the map's
 * (the tracer's detail then the tile's own octaves: finer, no longer the map's — a change in the hills,
 * never a step). (Read at the map's nearest texel, they once made terraces — steps of metres a kilometre
 * apart: a landing's rollout at Edwards ran into one and broke its gear.)
 */
export function tileFallbackSampler(map: Int16Array, W: number, H: number) {
  const fromMap = mapHeightSampler(map, W, H);
  return (q: V3): number => Math.max(fromMap(q), 0);
}

/**
 * The Earth's height [m] at a unit direction on its axes, from its height map (whole metres per texel,
 * W × H equirectangular, the sea floor below 0 — as the tracer holds them: half floats) as the tracer
 * samples it near — a cubic B-spline over its texels, wrapping in longitude — under the terrain tiles
 * near the camera (tiles: earth-tiles.ts, their heights and what they leave to the map), and the detail
 * finer than them; the sea at 0.
 */
export function earthHeightSampler(
  map: Int16Array,
  W: number,
  H: number,
  tiles?: (q: V3, foot: number) => { h: number; res: number; rem: number },
  /** where the ground is graded (runways: game/sites.ts runwayGrade) — flat, 0…1: the drawn detail taken off
   * there; level, 0…1: the relief brought to elev [m] */
  graded?: (q: V3) => { flat: number; level: number; elev: number },
) {
  const texelA = (EARTH_RM * 2 * Math.PI) / W;
  const fromMap = mapHeightSampler(map, W, H);
  return (q: V3, foot = 0.05): number => {
    let h0: number, res: number;
    const t = tiles?.(q, foot);
    if (t && t.rem < 1) {
      h0 = t.h + (t.rem >= 1e-4 ? t.rem * fromMap(q) : 0);
      res = t.res + (t.rem >= 1e-4 ? t.rem * texelA : 0);
    } else {
      h0 = fromMap(q);
      res = texelA;
    }
    const g = graded?.(q);
    const flat = g?.flat ?? 0;
    if (g && g.level > 0) h0 += (g.elev - h0) * g.level;
    return Math.max(h0 + (flat < 1 ? (1 - flat) * earthDetail(q, h0, foot, res) : 0), 0);
  };
}
