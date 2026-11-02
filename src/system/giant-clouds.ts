// The giants' clouds and lightning on the CPU (PLAN-PLANETES-AAA P11 D5): the twin of trace.wgsl's giantLayer, giantColAbove,
// giantLevel — the cockpit's figures (the deck the craft is in, the daylight left), the announcements, the thunder —, and the
// lightning's own search (giantFlashes: the renderer's, once a frame, its brightest flash handed to the shader — PLAN-GEANTES-
// VOLUME V1): the scene's clock (its seconds modulo 4 096 — Params.zamo2.z), pcg's hashes, the storms where the shader
// draws them — the Perlin–Worley of src/noise3d.ts ported here (its texture's g channel, sampled trilinearly and
// periodically as the GPU does), read where the shader reads it. tests/giant-clouds.test.ts holds the layers equal to the
// shader's.
//
// The decks sit at pressures (PLAN-GEANTES-VOLUME V4, Alex's formula — vr-solar-system GiantAir.LevelScale): their heights,
// every height over 1 bar the air sets — the decks, the hazes, the storms, the eye's wall, the air's profile (aero.ts) —, are
// the equator's scaled by s(φ) = g_eq / g(φ), the isobars' spacing going as 1/g: g the normal gravity on the 1 bar
// ellipsoid (Somigliana) between g_eq = GM/a² (1 + 3/2 J2) − ω² a and g_pole = GM/b² (1 − 3 J2 a²/b²), J2 Juno's and
// Cassini's. At the poles 0.859 (Jupiter), 0.753 (Saturn). A "level" height is the equator's: the real one over s(φ).

import { GIANT_WINDS, giantWindAt } from "./giant-winds";

/** a deck: its middle [m over 1 bar], its half thickness [m], its billows' scale [m], its extinction [1/m] */
export interface GiantLayer {
  c: number;
  w: number;
  scale: number;
  sigma: number;
  /** what it is made of */
  name: string;
}

/** trace.wgsl giantLayer — the ammonia ice, the ammonium hydrosulfide, the water — Jupiter's after Galileo and Juno,
 *  Saturn's after Cassini's sounding (deeper: its colder, lower-gravity air) */
export const GIANT_LAYERS: Record<"jupiter" | "saturn", [GiantLayer, GiantLayer, GiantLayer]> = {
  jupiter: [
    { c: 12e3, w: 5e3, scale: 4e3, sigma: 6e-4, name: "NH₃" },
    { c: -19e3, w: 4.5e3, scale: 3.5e3, sigma: 8e-4, name: "NH₄SH" },
    { c: -52e3, w: 7e3, scale: 6e3, sigma: 1.2e-3, name: "H₂O" },
  ],
  saturn: [
    { c: -18e3, w: 9e3, scale: 6e3, sigma: 4e-4, name: "NH₃" },
    { c: -89e3, w: 9e3, scale: 6e3, sigma: 6e-4, name: "NH₄SH" },
    { c: -189e3, w: 14e3, scale: 10e3, sigma: 1e-3, name: "H₂O" },
  ],
};
export type GiantId = keyof typeof GIANT_LAYERS;
type V3 = [number, number, number];
export const isGiant = (id: string): id is GiantId => id === "jupiter" || id === "saturn";

/** a giant's figure for the isobars' spacing (trace.wgsl giantLevel): b/a, its 1 bar ellipsoid's, and g_pole / g_eq (Alex's
 *  Somigliana — tests/giant-clouds.test.ts derives them from the bodies' masses, radii, spins and J2) */
export const GIANT_FIGURE: Record<GiantId, { ba: number; gpg: number }> = {
  jupiter: { ba: 0.935126, gpg: 1.164072 },
  saturn: { ba: 0.902038, gpg: 1.32838 },
};
/** s(φ) = g_eq / g(φ) at a geodetic latitude [rad]: a level height × s the real one over 1 bar (1 off the giants) */
export function giantLevelScale(id: string, lat: number): number {
  if (!isGiant(id)) return 1;
  const { ba, gpg } = GIANT_FIGURE[id];
  const c2 = Math.cos(lat) ** 2,
    s2 = 1 - c2;
  return Math.sqrt(c2 + ba * ba * s2) / (c2 + ba * gpg * s2);
}
/**
 * At q — a direction on the body's squashed axes (its 1 bar ellipsoid the unit sphere: trace.wgsl squashed) —: s(φ), and the
 * level metres a metre of squashed height (|p| − 1)·a makes there (trace.wgsl giantLevel's y: the real height is the
 * squashed one × k, k = 1 at the equator, b/a at the poles; the level one over s).
 */
export function giantLevel(id: GiantId, q: V3): { s: number; kl: number } {
  const { ba, gpg } = GIANT_FIGURE[id];
  const l = Math.hypot(...q);
  const rho = Math.hypot(q[0], q[1]) / l,
    z = q[2] / l;
  const nl = Math.hypot(rho, z / ba);
  const c = rho / nl,
    sn = z / ba / nl;
  const s = Math.sqrt(c * c + ba * ba * sn * sn) / (c * c + ba * gpg * sn * sn);
  return { s, kl: 1 / ((c * rho + (sn * Math.abs(z)) / ba) * s) };
}

/** the top of a giant's clouds [m over 1 bar]: its highest deck's — 0 for the giants without decks (Uranus, Neptune) */
export const giantTop = (id: string) => (isGiant(id) ? GIANT_LAYERS[id][0].c + GIANT_LAYERS[id][0].w : 0);

/** the deck at a height h [m over 1 bar] — within its half thickness —, or null between them */
export function giantDeckAt(id: GiantId, h: number): GiantLayer | null {
  for (const L of GIANT_LAYERS[id]) if (Math.abs(h - L.c) <= L.w) return L;
  return null;
}

/** trace.wgsl giantColAbove: the share of a deck's column above h (its profile's tail, a logistic) [m] */
export const colAbove = (h: number, L: GiantLayer) => (L.w * 1.7725) / (1 + Math.exp((2.5 * (h - L.c)) / L.w));

/**
 * The daylight left at a height h [m over 1 bar], the Sun mu0 (its height's sine) over the horizon — the decks' mean
 * cover (the shader's: 0.6, 0.6, 0.45) —: the direct share and the diffuse sky's (trace.wgsl giantInside's column and its
 * diffuse transmission 1/(1 + 0.3 τ)), 0 … 1 of the light over the clouds.
 */
export function giantDaylight(id: GiantId, h: number, mu0: number): { direct: number; diffuse: number } {
  if (mu0 <= -0.15) return { direct: 0, diffuse: 0 };
  const cover = [0.6, 0.6, 0.45];
  let tz = 0;
  GIANT_LAYERS[id].forEach((L, j) => {
    tz += L.sigma * cover[j]! * 0.35 * colAbove(h, L);
  });
  const fade = Math.min(Math.max((mu0 + 0.15) / 0.2, 0), 1);
  return { direct: Math.exp(-tz / Math.max(mu0 + 0.15, 0.03)) * fade, diffuse: (Math.max(mu0 + 0.1, 0) / (1 + 0.3 * tz)) * fade };
}

// ---- src/noise3d.ts's Perlin–Worley (the g channel), on the CPU ----

const pcg = (v: number) => {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
};
export const hash3u = (x: number, y: number, z: number) => pcg((x ^ pcg((y ^ pcg(z >>> 0)) >>> 0)) >>> 0);
const PERIOD = 32;
const grad = (h: number, x: number, y: number, z: number) =>
  ((h & 0x3ff) * (2 / 1023) - 1) * x + (((h >>> 10) & 0x3ff) * (2 / 1023) - 1) * y + (((h >>> 20) & 0x3ff) * (2 / 1023) - 1) * z;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const fade = (f: number) => f * f * f * (f * (f * 6 - 15) + 10);
const wrap = (i: number, n: number) => ((i % n) + n) % n;
function gnoiseP(x: number, y: number, z: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  const bx = wrap(ix, PERIOD),
    by = wrap(iy, PERIOD),
    bz = wrap(iz, PERIOD);
  const bx1 = (bx + 1) % PERIOD,
    by1 = (by + 1) % PERIOD,
    bz1 = (bz + 1) % PERIOD;
  const z0 = pcg(bz),
    z1 = pcg(bz1);
  const y00 = pcg((by ^ z0) >>> 0),
    y10 = pcg((by1 ^ z0) >>> 0),
    y01 = pcg((by ^ z1) >>> 0),
    y11 = pcg((by1 ^ z1) >>> 0);
  const n0 = grad(pcg((bx ^ y00) >>> 0), fx, fy, fz);
  const n1 = grad(pcg((bx1 ^ y00) >>> 0), fx - 1, fy, fz);
  const n2 = grad(pcg((bx ^ y10) >>> 0), fx, fy - 1, fz);
  const n3 = grad(pcg((bx1 ^ y10) >>> 0), fx - 1, fy - 1, fz);
  const n4 = grad(pcg((bx ^ y01) >>> 0), fx, fy, fz - 1);
  const n5 = grad(pcg((bx1 ^ y01) >>> 0), fx - 1, fy, fz - 1);
  const n6 = grad(pcg((bx ^ y11) >>> 0), fx, fy - 1, fz - 1);
  const n7 = grad(pcg((bx1 ^ y11) >>> 0), fx - 1, fy - 1, fz - 1);
  const ux = fade(fx),
    uy = fade(fy),
    uz = fade(fz);
  return 1.6 * mix(mix(mix(n0, n1, ux), mix(n2, n3, ux), uy), mix(mix(n4, n5, ux), mix(n6, n7, ux), uy), uz);
}
function worley(x: number, y: number, z: number, C: number): number {
  const k = C / PERIOD;
  const qx = x * k,
    qy = y * k,
    qz = z * k;
  const ix = Math.floor(qx),
    iy = Math.floor(qy),
    iz = Math.floor(qz);
  const fx = qx - ix,
    fy = qy - iy,
    fz = qz - iz;
  let d = 9;
  for (let oz = -1; oz <= 1; oz++)
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const cx = wrap(ix + ox, C),
          cy = wrap(iy + oy, C),
          cz = wrap(iz + oz, C);
        const h = pcg((cx ^ pcg((cy ^ pcg((cz ^ Math.imul(C, 7919)) >>> 0)) >>> 0)) >>> 0);
        const px = (h & 1023) / 1023,
          py = ((h >>> 10) & 1023) / 1023,
          pz = ((h >>> 20) & 1023) / 1023;
        d = Math.min(d, Math.hypot(ox + px - fx, oy + py - fy, oz + pz - fz));
      }
  return Math.min(Math.max(1 - d, 0), 1);
}
const worleyFbm = (x: number, y: number, z: number, C: number) =>
  0.625 * worley(x, y, z, C) + 0.25 * worley(x, y, z, 2 * C) + 0.125 * worley(x, y, z, 4 * C);
/** the baked texel's Perlin–Worley at the lattice point (x, y, z) (noise3d.ts's fragment) */
function perlinWorley(x: number, y: number, z: number): number {
  const perlin = Math.min(
    Math.max(0.5 + 0.5 * (0.6 * gnoiseP(x, y, z) + 0.3 * gnoiseP(2 * x, 2 * y, 2 * z) + 0.1 * gnoiseP(4 * x, 4 * y, 4 * z)), 0),
    1,
  );
  const w0 = worleyFbm(x, y, z, 8);
  return Math.min(Math.max((perlin - (w0 - 1)) / (2 - w0), 0), 1);
}
/** trace.wgsl cloudNoise(p).g: the texture's texels (4 a lattice unit, their centres at (i + ½)/4, 128 a period) read
 *  trilinearly, wrapped */
export function cloudNoiseG(x: number, y: number, z: number): number {
  const N = 128;
  const tx = x * 4 - 0.5,
    ty = y * 4 - 0.5,
    tz = z * 4 - 0.5;
  const i = Math.floor(tx),
    j = Math.floor(ty),
    k = Math.floor(tz);
  const fx = tx - i,
    fy = ty - j,
    fz = tz - k;
  const at = (a: number, b: number, c: number) => perlinWorley((wrap(a, N) + 0.5) / 4, (wrap(b, N) + 0.5) / 4, (wrap(c, N) + 0.5) / 4);
  return mix(
    mix(mix(at(i, j, k), at(i + 1, j, k), fx), mix(at(i, j + 1, k), at(i + 1, j + 1, k), fx), fy),
    mix(mix(at(i, j, k + 1), at(i + 1, j, k + 1), fx), mix(at(i, j + 1, k + 1), at(i + 1, j + 1, k + 1), fx), fy),
    fz,
  );
}

// ---- the volume carried by the zonal wind (PLAN-GEANTES-VOLUME V7: trace.wgsl giantInside's GI_FLOW, giantSigma) ----

/** the zonal flow's cycle [s] (trace.wgsl GIANT_CYCLE: the surface's and the volume's) */
export const GIANT_CYCLE = 36000;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
/** the volume's two phases at the scene's clock tS [s] and its rate [game s / s]: their ages [s] and weights — each alone 70 %
 *  of the cycle, faded in 30 %; held, the first mid-window, when the clock runs faster than ~1 000 × (giantTurb's rule) */
export function giantFlowPhases(tS: number, rate: number): [number, number, number, number] {
  const ph = (((tS / GIANT_CYCLE) % 1) + 1) % 1;
  const fr = smooth(1000, 3000, rate);
  const w1 = smooth(0.35, 0.65, Math.abs(2 * ph - 1)) * (1 - fr);
  return [(ph + (0.5 - ph) * fr) * GIANT_CYCLE, ((ph + 0.5) % 1) * GIANT_CYCLE, 1 - w1, w1];
}
/** the zonal wind's shear at a latitude [deg]: its change over the table's 2.5° [m/s] — central differences at the nodes,
 *  interpolated (trace.wgsl giantWind's y) */
function giantWindShear(id: GiantId, latDeg: number): number {
  const x = Math.min(Math.max((latDeg + 90) / 2.5, 0), 71.999);
  const i = Math.floor(x) + (id === "jupiter" ? 0 : 73);
  const a = [0, 1, 2, 3].map((n) => GIANT_WINDS[Math.min(Math.max(i + n, 1), 146) - 1]!);
  const f = x - Math.floor(x);
  return 0.5 * (a[2]! - a[0]!) + (0.5 * (a[3]! - a[1]!) - 0.5 * (a[2]! - a[0]!)) * f;
}
/** Jupiter's named anticyclones (trace.wgsl giantFlow, giantInside — V7b): centre [lon, lat rad], semi-axes [rad], the speed
 *  of its ring [m/s] — the Great Red Spot, the Oval BA */
const VORTICES: [number, number, number, number, number][] = [
  [2.2066, -0.384, 0.157, 0.0916, 180],
  [-1.0071, -0.5603, 0.0733, 0.0698, 135],
];
/** Saturn's polar cyclone's jet at a colatitude [rad] (~150 m/s eastward 2° from the pole) [m/s] */
const polarJet = (rho: number) => 150 * (rho / 0.0349) * Math.exp(0.5 * (1 - (rho / 0.0349) ** 2));
/**
 * Where the matter at q (squashed axes, unit) was age seconds ago — giantSigma's reading place, the shader's turn found once
 * a ray at the camera qc (unit): a named vortex about it turned about its centre by its spin there (V7b), else (faded) the
 * zonal wind at the camera's latitude — its shear about it to first order in z —, Saturn's polar jet added; rm the body's
 * metres a radius.
 */
export function giantFlowBack(id: GiantId, q: V3, age: number, rm: number, qc: V3 = q): V3 {
  if (age === 0) return q;
  const latR = Math.asin(Math.min(Math.max(qc[2], -1), 1));
  const latc = (latR * 180) / Math.PI;
  const cc = Math.max(Math.hypot(qc[0], qc[1]), 0.05);
  let om = giantWindAt(id, latc) / (rm * cc);
  let dom = giantWindShear(id, latc) / (0.0436332 * rm * cc * cc);
  let qv = q;
  if (id === "jupiter") {
    const lonc = Math.atan2(qc[1], qc[0]);
    for (const [lon, lat, ex, ey, vm] of VORTICES) {
      let dx = lonc - lon;
      dx -= 2 * Math.PI * Math.round(dx / (2 * Math.PI));
      const r = Math.hypot(dx / ex, (latR - lat) / ey);
      if (r >= 1.3) continue;
      const v = vm * (r < 0.8 ? (r / 0.8) ** 2 : Math.exp(-(((r - 0.8) / 0.25) ** 2)));
      const t = Math.min(Math.max((1.3 - r) / 0.3, 0), 1);
      const wv = t * t * (3 - 2 * t);
      const ang = ((-v * age) / (Math.max(r, 1e-4) * rm * Math.max(ex * Math.cos(lat), ey))) * wv;
      const k: V3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
      const c = Math.cos(ang),
        s = Math.sin(ang),
        kq = k[0] * q[0] + k[1] * q[1] + k[2] * q[2];
      const kx: V3 = [k[1] * q[2] - k[2] * q[1], k[2] * q[0] - k[0] * q[2], k[0] * q[1] - k[1] * q[0]];
      qv = [0, 1, 2].map((i) => q[i]! * c + kx[i]! * s + k[i]! * kq * (1 - c)) as V3;
      om *= 1 - wv;
      dom *= 1 - wv;
    }
  } else {
    const rho = Math.acos(Math.min(Math.max(qc[2], -1), 1));
    om += polarJet(rho) / (rm * Math.max(Math.sin(rho), 1e-4));
  }
  const a = -(om + dom * (q[2] - qc[2])) * age,
    c = Math.cos(a),
    s = Math.sin(a);
  return [qv[0] * c - qv[1] * s, qv[0] * s + qv[1] * c, qv[2]];
}
/** the scene's clock and its rate, as the tracer has them (renderer nearCamera.flow) */
export interface GiantFlowClock {
  tS: number;
  rate: number;
}

// ---- the lightning (once a frame: the renderer's, for trace.wgsl giantFlashGlow) ----
/** a flash: its slot (stream j, slot n — each one once), its place (the body's squashed axes [its radii]), its light now,
 *  shallow (in the ammonia's clouds) */
export interface GiantFlash {
  j: number;
  n: number;
  pos: V3;
  light: number;
  shallow: boolean;
}

/**
 * The flashes at the clock tc [s, modulo 4 096], seen from the camera c (the body's squashed axes [its
 * radii] — the renderer's nearCam), the body m (4 Jupiter, 5 Saturn), rm its metres a radius: every stream's lit flash
 * found in a storm (the renderer hands the brightest one to the shader: P.wx[6]).
 */
export function giantFlashes(m: 4 | 5, c: V3, rm: number, tc: number, flow: GiantFlowClock | null = null): GiantFlash[] {
  const id: GiantId = m === 4 ? "jupiter" : "saturn";
  const L = GIANT_LAYERS[id];
  const rkm = rm * 1e-3;
  const l0 = Math.hypot(...c);
  const q0: V3 = [c[0] / l0, c[1] / l0, c[2] / l0];
  // (east, north: the shader's — under a pole any horizontal axis)
  let ex: V3 = [-q0[1], q0[0], 0];
  const el = Math.hypot(...ex);
  ex = el < 1e-6 ? [1, 0, 0] : [ex[0] / el, ex[1] / el, 0];
  const nx: V3 = [q0[1] * ex[2] - q0[2] * ex[1], q0[2] * ex[0] - q0[0] * ex[2], q0[0] * ex[1] - q0[1] * ex[0]];
  const rare = m === 4 ? 0 : 0.05;
  const re = m === 4 ? 0.0175 : 0.0166;
  const { kl } = giantLevel(id, q0);
  // (the storms where the wind has carried them — V7: the phase most seen)
  const ph = flow ? giantFlowPhases(flow.tS, flow.rate) : null;
  const age = ph ? (ph[3] > ph[2] ? ph[1] : ph[0]) : 0;
  const out: GiantFlash[] = [];
  for (let j = 0; j < 4; j++) {
    const tj = tc + j * 0.137;
    const n = Math.floor(tj / 0.5);
    const tau = tj - n * 0.5;
    const h1 = hash3u(n, j, 0x9e37 + m),
      h2 = hash3u(n, j, 0x51ed + m);
    const u = [h1 & 0xffff, h1 >>> 16, h2 & 0xffff, h2 >>> 16].map((x) => x / 65535) as [number, number, number, number];
    const t0 = 0.15 * u[3];
    const ns = 1 + Math.floor(u[2] * 2.99);
    let I = 0;
    for (let k = 0; k < ns; k++) {
      const tk = t0 + k * (0.07 + 0.05 * ((u[2] * 13 + k) % 1));
      if (tau >= tk) I += Math.exp(-(tau - tk) / 0.035) * (1 - 0.3 * k);
    }
    if (I < 0.01) continue;
    const shallow = (u[2] * 7) % 1 < 0.17;
    const hf = shallow ? L[0].c - 8e3 : L[2].c + 15e3;
    let q = q0;
    let best = -1;
    for (let i = 0; i < 4; i++) {
      const hi = hash3u(n, j * 4 + i, 0x7f4a + m);
      const rr = 300e3 * ((u[0] + ((hi & 0xff) / 255) * 0.15) % 1);
      const a = 2 * Math.PI * (u[1] + ((hi >>> 24) / 255) * 0.03);
      const k = rr / rm;
      const v: V3 = [
        q0[0] + (ex[0] * Math.cos(a) + nx[0] * Math.sin(a)) * k,
        q0[1] + (ex[1] * Math.cos(a) + nx[1] * Math.sin(a)) * k,
        q0[2] + (ex[2] * Math.cos(a) + nx[2] * Math.sin(a)) * k,
      ];
      const vl = Math.hypot(...v);
      const qi: V3 = [v[0] / vl, v[1] / vl, v[2] / vl];
      const s = (rkm + hf * 1e-3) / 80;
      const qn = giantFlowBack(id, qi, age, rm, q0);
      const g = cloudNoiseG(qn[0] * s + 3.1, qn[1] * s + 7.7, qn[2] * s + 1.3);
      if (g > best) {
        best = g;
        q = qi;
      }
    }
    // (out of a storm, or in an eye's well — trace.wgsl giantEye's x over 0.95)
    const rho = Math.acos(Math.min(Math.max(q[2], -1), 1));
    const eyeClear = Math.min(Math.max((rho - 0.6 * re) / (0.4 * re), 0), 1);
    if (best < 0.7 + rare || eyeClear * eyeClear * (3 - 2 * eyeClear) < 0.95) continue;
    // (its level height on the squashed axes — the shader's giantLevel at the camera, its decks' frame)
    const r = 1 + hf / (kl * rm);
    out.push({ j, n, pos: [q[0] * r, q[1] * r, q[2] * r], light: I * (shallow ? 0.4 : 1), shallow });
  }
  return out;
}

/**
 * The thunder's ear (main.ts each frame): the flashes born since the last call — each slot once —, with their distance
 * from the camera [m]; nothing while the clock stands still or runs backwards.
 */
export class GiantThunder {
  private seen = new Set<string>();
  private last = Number.NaN;
  step(m: 4 | 5, c: V3, rm: number, tc: number, flow: GiantFlowClock | null = null): { dist: number; flash: GiantFlash }[] {
    const back = !(tc > this.last) || tc - this.last > 2;
    this.last = tc;
    if (back) {
      this.seen.clear();
      return [];
    }
    const out: { dist: number; flash: GiantFlash }[] = [];
    for (const f of giantFlashes(m, c, rm, tc, flow)) {
      const key = `${f.j}/${f.n}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      out.push({ dist: Math.hypot(f.pos[0] - c[0], f.pos[1] - c[1], f.pos[2] - c[2]) * rm, flash: f });
    }
    if (this.seen.size > 256) this.seen = new Set([...this.seen].slice(-64));
    return out;
  }
}
