// Light probes of the planets: what reaches each one, traced from its place in its own frame.
//
// The tracer's light-probe kernel (the one that lights the Ranger) is run now and then from a planet's
// centre, moving with it, the planet itself left out: a 256 × 128 map of the radiance it receives — the
// accretion disk lensed around Gargantua, Gargantua's shadow, the sky, the other bodies. From it:
//   · spherical harmonics (lighting of its surface in the local patch, without the Ranger's probe),
//   · the irradiance along the dominant direction (the far view's brightness, consistent with the
//     close-up one),
//   · the bolometric irradiance and the equilibrium temperature — the habitability guard. Each texel's
//     colour gives its colour temperature T_c; its luminance, relative to a blackbody's at T_c in the
//     tracer's units (10^(log Y(T_c) − log Y_ref)), the fraction of a blackbody surface it amounts to;
//     that fraction of σT_c⁴/π is its bolometric radiance (the disk is drawn as blackbodies: exact for
//     it, approximate for the sky).

import type { CameraFrame } from "../camera";
import { BB_LOG_T_MAX, BB_LOG_T_MIN, BB_LUT_SIZE, buildBlackbodyLUT, coordToZamo, zamo, type Vec3 } from "../physics";
import { sphericalFrame } from "../wormhole";
import { blToCartesian } from "../camera";
import { aberrate } from "./local-patch";

export const PROBE_W = 256;
export const PROBE_H = 128;
const SIGMA = 5.670374419e-8;
/** solar constant at the Earth [W/m²] */
export const EARTH_IRRADIANCE = 1361;

export interface PlanetProbe {
  /** spherical harmonics of the radiance (9 × rgb), directions in the planet's rest frame, along the
   *  ZAMO axes at its place (r̂, θ̂, φ̂) */
  sh: Vec3[];
  /** direction of the strongest irradiance (same axes) and that irradiance (luminance, tracer units) */
  dir: Vec3;
  /** the same direction in the black-hole frame's flat map (for the far view's shading) */
  worldDir: Vec3;
  /** colour temperature of the light it receives (the disk's, Doppler shifted by its motion) [K] */
  tColour: number;
  eMax: number;
  /** bolometric: irradiance along the dominant direction [W/m²], mean radiance over the sky [W/m²/sr] */
  eBol: number;
  meanBol: number;
  /** equilibrium temperature [K] of a planet of this albedo redistributing its heat */
  teq: number;
  at: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * A light direction seen by the probe (its rest frame, ZAMO axes) as a direction of the black-hole
 * frame's map: back to the ZAMO (the aberration undone), then the metric's scale factors undone.
 */
function toWorld(l: Vec3, cam: CameraFrame): Vec3 {
  const z = cam.zamo;
  const lz = aberrate(l, [-cam.beta[0], -cam.beta[1], -cam.beta[2]]);
  const st = Math.max(Math.sin(cam.theta), 1e-9);
  const m: Vec3 = [lz[0] / z.sqrtSigOverDel, (lz[1] * cam.r) / z.sqrtSig, (lz[2] * cam.r * st) / z.varpi];
  const f = sphericalFrame(blToCartesian(cam.r, cam.theta, cam.phi));
  const w: Vec3 = [0, 1, 2].map((i) => m[0] * f.er[i]! + m[1] * f.et[i]! + m[2] * f.ep[i]!) as Vec3;
  const n = Math.hypot(...w) || 1;
  return [w[0] / n, w[1] / n, w[2] / n];
}

/** A camera at a planet's centre, moving with it (just off the equator, as the camera always is). */
export function probeCamera(pos: Vec3, vel: Vec3, spin: number): CameraFrame {
  const f = sphericalFrame(pos);
  const theta = Math.abs(f.th - Math.PI / 2) < 1e-7 ? f.th + 2e-7 : f.th;
  const z = zamo(f.r, theta, spin);
  const b = coordToZamo([dot(vel, f.er), dot(vel, f.et), dot(vel, f.ep)], f.r, theta, z);
  const speed = Math.min(Math.hypot(...b), 0.9999);
  // (any orthonormal basis: the probe's texels are turned back into these axes)
  return {
    region: "hole", r: f.r, theta, phi: f.ph, ell: 0, n: [1, 0, 0],
    right: [0, 0, 1], up: [0, -1, 0], fwd: [-1, 0, 0],
    zamo: z, beta: b, gamma: 1 / Math.sqrt(1 - speed * speed), speed,
  };
}

let lut: { rgb: Vec3[]; logT: number[]; logY: number[] } | null = null;

/** Colour temperature of a linear rgb (nearest blackbody chromaticity, 1 000 K – tMax). */
function colourTemperature(r: number, g: number, b: number, tMax = 1e5): { T: number; logY: number } {
  if (!lut) {
    const L = buildBlackbodyLUT();
    lut = { rgb: [], logT: [], logY: [] };
    for (let i = 0; i < BB_LUT_SIZE; i++) {
      const lt = BB_LOG_T_MIN + ((BB_LOG_T_MAX - BB_LOG_T_MIN) * i) / (BB_LUT_SIZE - 1);
      if (lt < 3 || lt > 5) continue;
      lut.rgb.push([L[4 * i]!, L[4 * i + 1]!, L[4 * i + 2]!]);
      lut.logT.push(lt);
      lut.logY.push(L[4 * i + 3]!);
    }
  }
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const c: Vec3 = [r / lum, g / lum, b / lum];
  let best = 0, bd = Infinity;
  const ltMax = Math.log10(tMax);
  for (let i = 0; i < lut.rgb.length; i += 2) {
    if (lut.logT[i]! > ltMax) break;
    const q = lut.rgb[i]!;
    const d = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2;
    if (d < bd) (bd = d), (best = i);
  }
  return { T: 10 ** lut.logT[best]!, logY: lut.logY[best]! };
}

/**
 * Reduces a probe (PROBE_W × PROBE_H rgba, equirectangular in the camera's x right, y up, z forward)
 * taken with `cam`. logYref: the tracer's reference luminance (log10 Y of the disk's peak temperature).
 */
export function reduceProbe(data: Float32Array, cam: CameraFrame, logYref: number, albedo: number, tMax = 1e5): PlanetProbe {
  const sh: Vec3[] = Array.from({ length: 9 }, () => [0, 0, 0] as Vec3);
  const dirs: Vec3[] = [];
  const lums: number[] = [];
  const bols: number[] = [];
  const dws: number[] = [];
  let flux: Vec3 = [0, 0, 0];
  let maxL = 0;
  for (let y = 0; y < PROBE_H; y++) {
    const v = (y + 0.5) / PROBE_H;
    const th = v * Math.PI;
    const dw = ((2 * Math.PI) / PROBE_W) * (Math.PI / PROBE_H) * Math.sin(th);
    for (let x = 0; x < PROBE_W; x++) {
      const i = 4 * (y * PROBE_W + x);
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      const ph = ((x + 0.5) / PROBE_W - 0.5) * 2 * Math.PI;
      const dl: Vec3 = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
      const d: Vec3 = [0, 1, 2].map((k) => dl[0] * cam.right[k]! + dl[1] * cam.up[k]! + dl[2] * cam.fwd[k]!) as Vec3;
      const basis = [
        0.282095, 0.488603 * d[1], 0.488603 * d[2], 0.488603 * d[0],
        1.092548 * d[0] * d[1], 1.092548 * d[1] * d[2], 0.315392 * (3 * d[2] * d[2] - 1),
        1.092548 * d[0] * d[2], 0.546274 * (d[0] * d[0] - d[1] * d[1]),
      ];
      for (let k = 0; k < 9; k++) {
        sh[k]![0] += r * basis[k]! * dw;
        sh[k]![1] += g * basis[k]! * dw;
        sh[k]![2] += b * basis[k]! * dw;
      }
      const lum = Math.max(0.2126 * r + 0.7152 * g + 0.0722 * b, 0);
      flux = [flux[0] + lum * d[0] * dw, flux[1] + lum * d[1] * dw, flux[2] + lum * d[2] * dw];
      maxL = Math.max(maxL, lum);
      dirs.push(d);
      lums.push(lum);
      dws.push(dw);
      bols.push(0);
    }
  }
  // bolometric radiance of the texels that matter (brighter than 10⁻⁵ of the brightest)
  let sumBol = 0;
  for (let j = 0; j < lums.length; j++) {
    if (!(lums[j]! > 1e-5 * maxL)) continue;
    const i = 4 * j;
    const ct = colourTemperature(Math.max(data[i]!, 0), Math.max(data[i + 1]!, 0), Math.max(data[i + 2]!, 0), tMax);
    const frac = lums[j]! / 10 ** (ct.logY - logYref);
    bols[j] = (frac * SIGMA * ct.T ** 4) / Math.PI;
    sumBol += bols[j]! * dws[j]!;
  }
  const fl = Math.hypot(...flux);
  const dir: Vec3 = fl > 0 ? [flux[0] / fl, flux[1] / fl, flux[2] / fl] : [1, 0, 0];
  let eMax = 0, eBol = 0;
  for (let j = 0; j < lums.length; j++) {
    const c = Math.max(dot(dirs[j]!, dir), 0) * dws[j]!;
    eMax += lums[j]! * c;
    eBol += bols[j]! * c;
  }
  const meanBol = sumBol / (4 * Math.PI);
  // absorbed (1 − A) π R² · 4π⟨L⟩ = emitted 4π R² σ T⁴
  const teq = (((1 - albedo) * Math.PI * meanBol) / SIGMA) ** 0.25;
  const c0 = sh[0]!;
  const tColour = c0[0] + c0[1] + c0[2] > 0 ? colourTemperature(Math.max(c0[0], 0), Math.max(c0[1], 0), Math.max(c0[2], 0)).T : 0;
  return { sh, dir, worldDir: toWorld(dir, cam), tColour, eMax, eBol, meanBol, teq, at: performance.now() };
}

/**
 * Successive probes of a planet, averaged (each one samples every texel once, jittered: the thin
 * bright structures — the photon ring, the Doppler-boosted side of the disk — are noisy).
 */
export function blendProbe(old: PlanetProbe | undefined, p: PlanetProbe, w = 0.25): PlanetProbe {
  if (!old) return p;
  const m = (a: number, b: number) => a + w * (b - a);
  const mv = (a: Vec3, b: Vec3): Vec3 => [m(a[0], b[0]), m(a[1], b[1]), m(a[2], b[2])];
  const dir = mv(old.dir, p.dir), wd = mv(old.worldDir, p.worldDir);
  const n = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  return {
    sh: old.sh.map((c, k) => mv(c, p.sh[k]!)), dir: n(dir), worldDir: n(wd), tColour: m(old.tColour, p.tColour),
    eMax: m(old.eMax, p.eMax), eBol: m(old.eBol, p.eBol), meanBol: m(old.meanBol, p.meanBol), teq: m(old.teq, p.teq), at: p.at,
  };
}
