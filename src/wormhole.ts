// Interstellar's Double Negative ("Dneg") wormhole (James, von Tunzelmann, Franklin & Thorne,
// Am. J. Phys. 83, 486 (2015)) and how it is glued into the black hole's universe.
//
// Metric: ds² = −dt² + dℓ² + r(ℓ)²(dθ² + sin²θ dφ²), with
//   r = ρ                                          for |ℓ| ≤ a   (cylindrical interior of length 2a)
//   r = ρ + M [x arctan x − ½ ln(1 + x²)],  x = 2(|ℓ| − a)/(πM)   for |ℓ| > a
// and lensing width W = 1.42953 M. ℓ > 0 is the Gargantua side (the black hole's universe), ℓ < 0
// our side ("home", the real sky), as in the paper. g_tt = −1: no gravitational frequency shift.
//
// Coordinates used here ("rep"): a position is (ℓ, n̂) with n̂ the unit vector of (θ, φ); a vector
// v is written in the orthonormal frame (ê_ℓ, ê_θ, ê_φ) laid onto (n̂, θ̂, φ̂), so v·n̂ is its ℓ
// component. On the Gargantua side ê_ℓ points away from the mouth and rep vectors are Cartesian
// vectors of the mouth's local frame. On our side ê_ℓ points into the mouth: the embedding there
// flips the radial component and mirrors y, which keeps both universes right-handed (no mirror
// image through the wormhole).

import { horizon, zamo, type Vec3 } from "./physics";
import type { Settings } from "./settings";

const DEG = Math.PI / 180;

/** W/M = (π/2√2) tan(π/2√2) − ln sec(π/2√2) = 1.42953 (lensing width over the lensing mass). */
export const W_OVER_M = (() => {
  const k = Math.PI / (2 * Math.SQRT2);
  return k * Math.tan(k) + Math.log(Math.cos(k));
})();

export interface Dneg {
  rho: number; // throat radius
  a: number; // half length of the cylindrical interior
  M: number; // lensing mass (smoothness of the mouth)
}

type WormholeKeys = "whRho" | "whLength" | "whLensing";
export function dneg(s: Pick<Settings, WormholeKeys>): Dneg {
  const rho = s.whRho;
  return { rho, a: 0.5 * s.whLength * rho, M: Math.max((s.whLensing * rho) / W_OVER_M, 1e-4 * rho) };
}

/** r(ℓ) and dr/dℓ. */
export function radius(w: Dneg, l: number): [number, number] {
  const al = Math.abs(l);
  if (al <= w.a) return [w.rho, 0];
  const x = (2 * (al - w.a)) / (Math.PI * w.M);
  return [w.rho + w.M * (x * Math.atan(x) - 0.5 * Math.log1p(x * x)), Math.sign(l) * (2 / Math.PI) * Math.atan(x)];
}

/** ℓ ≥ a at which r(ℓ) = r (r ≥ ρ). */
export function ellOfR(w: Dneg, r: number): number {
  if (r <= w.rho) return w.a;
  let lo = w.a + (r - w.rho); // r' ≤ 1 → r(ℓ) ≤ ρ + ℓ − a
  let hi = lo * 2 + w.M * 4;
  while (radius(w, hi)[0] < r) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (radius(w, mid)[0] < r) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ---------------------------------------------------------------------------------------------
// Rays. By spherical symmetry a ray stays in the plane of its initial position and direction:
// dℓ/dt = p_ℓ, dp_ℓ/dt = b² r'/r³, dψ/dt = b/r² (Eqs. A.7 of the paper, reduced to that plane),
// with the impact parameter b conserved and p_ℓ² + b²/r² = 1. The same equations give the straight
// flight of the camera (spatial geodesics: the metric is static with g_tt = −1).
// ---------------------------------------------------------------------------------------------

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));

/**
 * Integration step: resolves the mouth's transition region (scale M), turns by at most 0.05 rad
 * around the centre (b/r² per unit length) and grows ∝ r on the way out.
 */
export function dnegStep(w: Dneg, l: number, b: number): number {
  const r = radius(w, l)[0];
  const dist = Math.max(Math.abs(l) - w.a, 0);
  return Math.min((0.05 * r * r) / Math.max(b, 1e-3 * w.rho), 0.25 * r, 0.08 * (dist + w.M) + 0.006 * w.rho);
}

type Planar = { l: number; pl: number; psi: number };

/** Shortens a step to end on a mouth (|ℓ| = a), where r'' jumps: keeps RK4 at full order. */
function landing(w: Dneg, s: Planar, h: number): number {
  if (Math.abs(s.pl) < 1e-9) return h;
  for (const B of [w.a, -w.a]) {
    const t = (B - s.l) / s.pl;
    if (t > 1e-7 * w.rho && t < h) h = t;
  }
  return h;
}

function planarRK4(w: Dneg, s: Planar, b: number, h: number): Planar {
  const f = (l: number, pl: number): Planar => {
    const [r, dr] = radius(w, l);
    return { l: pl, pl: (b * b * dr) / (r * r * r), psi: b / (r * r) };
  };
  const k1 = f(s.l, s.pl);
  const k2 = f(s.l + 0.5 * h * k1.l, s.pl + 0.5 * h * k1.pl);
  const k3 = f(s.l + 0.5 * h * k2.l, s.pl + 0.5 * h * k2.pl);
  const k4 = f(s.l + h * k3.l, s.pl + h * k3.pl);
  return {
    l: s.l + (h / 6) * (k1.l + 2 * k2.l + 2 * k3.l + k4.l),
    pl: s.pl + (h / 6) * (k1.pl + 2 * k2.pl + 2 * k3.pl + k4.pl),
    psi: s.psi + (h / 6) * (k1.psi + 2 * k2.psi + 2 * k3.psi + k4.psi),
  };
}

export interface RayEnd {
  side: 1 | -1 | 0; // left through ℓ ≥ lPlus (+1), ℓ ≤ −lMinus (−1), or ran out of steps (0)
  l: number;
  n: Vec3; // rep position
  d: Vec3; // rep direction (unit)
  steps: number;
  /** p_ℓ² + b²/r² − 1 at the end (conservation check). */
  constraint: number;
  /** path length travelled */
  length: number;
}

/** Plane of motion of a ray at n̂ with direction d: (e1 = n̂, e2 = in-plane tangent, b = r sin angle). */
function plane(n: Vec3, d: Vec3): { e2: Vec3; tl: number } {
  const t = sub(d, scale(n, dot(d, n)));
  const tl = Math.hypot(...t);
  if (tl > 1e-12) return { e2: scale(t, 1 / tl), tl };
  const ref: Vec3 = Math.abs(n[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0];
  return { e2: normalize(cross(n, ref)), tl: 0 };
}

/**
 * Follows a ray (or a straight flight) from (l0, n0) with unit direction d0 until it leaves through
 * ℓ ≥ lPlus or ℓ ≤ −lMinus, or after maxLength of path.
 */
export function traceDneg(
  w: Dneg,
  l0: number,
  n0: Vec3,
  d0: Vec3,
  lPlus: number,
  lMinus: number,
  opts: { maxSteps?: number; maxLength?: number; stepScale?: number } = {},
): RayEnd {
  const { e2, tl } = plane(n0, d0);
  const b = radius(w, l0)[0] * tl;
  let s: Planar = { l: l0, pl: dot(d0, n0), psi: 0 };
  let side: RayEnd["side"] = 0;
  let steps = 0;
  let length = 0;
  const maxSteps = opts.maxSteps ?? 20000;
  const maxLength = opts.maxLength ?? Infinity;
  const k = opts.stepScale ?? 1;
  for (; steps < maxSteps; steps++) {
    if (s.l >= lPlus && s.pl > 0) { side = 1; break; }
    if (s.l <= -lMinus && s.pl < 0) { side = -1; break; }
    if (length >= maxLength) break;
    const h = Math.min(landing(w, s, dnegStep(w, s.l, b) * k), maxLength - length);
    s = planarRK4(w, s, b, h);
    length += h;
  }
  const r = radius(w, s.l)[0];
  const n = add(scale(n0, Math.cos(s.psi)), scale(e2, Math.sin(s.psi)));
  const t = add(scale(n0, -Math.sin(s.psi)), scale(e2, Math.cos(s.psi)));
  return {
    side, l: s.l, n, d: normalize(add(scale(n, s.pl), scale(t, b / r))), steps,
    constraint: s.pl * s.pl + (b * b) / (r * r) - 1, length,
  };
}

/**
 * Moves a camera by `ds` along the unit rep direction `dir` (a spatial geodesic) and parallel-
 * transports the given vectors: their component normal to the plane of motion is kept, the in-plane
 * part turns with the direction of motion (radial flight: rep vectors are carried unchanged).
 */
export function flyDneg(w: Dneg, l0: number, n0: Vec3, dir: Vec3, vectors: Vec3[], ds: number) {
  const end = traceDneg(w, l0, n0, dir, Infinity, Infinity, { maxLength: Math.abs(ds), stepScale: 0.5 });
  const N = cross(n0, dir); // normal to the plane of motion
  const nn = Math.hypot(...N);
  let moved = vectors;
  if (nn > 1e-9) {
    const Nu = scale(N, 1 / nn);
    const perp0 = cross(Nu, dir);
    const perp1 = cross(Nu, end.d);
    moved = vectors.map((v) =>
      normalize(add(add(scale(Nu, dot(v, Nu)), scale(end.d, dot(v, dir))), scale(perp1, dot(v, perp0)))),
    );
  }
  return { l: end.l, n: end.n, dir: end.d, vectors: moved };
}

// ---------------------------------------------------------------------------------------------
// Frames: rep ↔ the embedding of each side
// ---------------------------------------------------------------------------------------------

const mirror = (v: Vec3): Vec3 => [v[0], -v[1], v[2]];

/** Unit position of a rep point in the Cartesian frame of its own side. */
export function sidePosition(side: number, n: Vec3): Vec3 {
  return side > 0 ? n : mirror(n);
}
/** Rep vector at n (on side `side`) → Cartesian vector of that side's frame. */
export function repToSide(side: number, n: Vec3, v: Vec3): Vec3 {
  if (side > 0) return v;
  const vl = dot(v, n);
  return mirror(add(scale(n, -vl), sub(v, scale(n, vl))));
}
/** Inverse of repToSide. */
export function sideToRep(side: number, n: Vec3, v: Vec3): Vec3 {
  if (side > 0) return v;
  const u = mirror(v);
  const ul = dot(u, n);
  return add(scale(n, -ul), sub(u, scale(n, ul)));
}

// ---------------------------------------------------------------------------------------------
// The Gargantua-side mouth in the black hole's frame
// ---------------------------------------------------------------------------------------------

export interface Mouth {
  w: Dneg;
  C: Vec3; // centre, Cartesian coordinates of the black hole's frame (flat far-field map of BL)
  ex: Vec3; // mouth frame axes: +x points at the black hole, z towards its spin axis
  ey: Vec3;
  ez: Vec3;
  rGlue: number; // radius of the gluing sphere: inside it the Dneg metric, outside it Kerr
  lGlue: number;
  lFar: number; // our side: rays are followed to ℓ = −lFar (r = 100 ρ), then straight
  /** coordinate velocity of the centre (black hole's frame): an orbiting mouth moves, 0 otherwise */
  V: Vec3;
  /** its angular velocity on its circle around the spin axis (dφ/dt), 0: static */
  omega: number;
}

/**
 * The scene's current coordinate time, for an orbiting mouth (set once a frame by the app, and by
 * an offline render for its own time): everything within a frame sees the mouth at the same place.
 */
let sceneTime = 0;
export function setSceneTime(t: number) {
  sceneTime = t;
}

type MouthKeys = WormholeKeys | "whDist" | "whIncl" | "whAzimuth" | "whOrbit" | "whPhase" | "spin" | "disk" | "diskOuter";
/**
 * The far mouth at time t. Static: at (whDist, whIncl, whAzimuth). Orbiting: a test particle on the
 * prograde circular equatorial Kerr orbit at whDist (Ω = 1/(r^{3/2} + a)), its frame axes fixed —
 * the mouth translates without turning (the axes are those it has at t = 0).
 */
export function mouth(s: Pick<Settings, MouthKeys>, t = sceneTime): Mouth {
  const w = dneg(s);
  const orbit = !!s.whOrbit;
  const th = orbit ? Math.PI / 2 : s.whIncl * DEG;
  const ph0 = orbit ? (s.whPhase ?? 0) * DEG : s.whAzimuth * DEG;
  const D = Math.max(s.whDist, horizon(s.spin) + 4 * w.rho);
  const omega = orbit ? 1 / (D ** 1.5 + s.spin) : 0;
  const ph = ph0 + omega * t;
  const C: Vec3 = [D * Math.sin(th) * Math.cos(ph), D * Math.sin(th) * Math.sin(ph), D * Math.cos(th)];
  const V: Vec3 = [-omega * C[1], omega * C[0], 0];
  const C0: Vec3 = [D * Math.sin(th) * Math.cos(ph0), D * Math.sin(th) * Math.sin(ph0), D * Math.cos(th)];
  const ex = scale(C0, -1 / D);
  let ez = sub([0, 0, 1], scale(ex, ex[2]));
  ez = Math.hypot(...ez) < 1e-6 ? normalize(cross(ex, [0, 1, 0])) : normalize(ez);
  const ey = cross(ez, ex);
  // Large enough for the wormhole's own lensing to be done, small against the distance to the hole,
  // and clear of the accretion disk.
  const R = D * Math.sin(th);
  const toDisk = s.disk ? Math.hypot(Math.max(R - s.diskOuter, 0), D * Math.cos(th)) : Infinity;
  const rGlue = Math.max(Math.min(Math.max(8 * w.rho, w.rho + 12 * w.M), 0.3 * D, 0.8 * toDisk), 2 * w.rho);
  return { w, C, ex, ey, ez, rGlue, lGlue: ellOfR(w, rGlue), lFar: ellOfR(w, 100 * w.rho), V, omega };
}

/**
 * Relativistic composition of velocities: the velocity (3-velocity) of a body moving at u in a frame
 * that moves at v, seen from the frame in which v was measured (v = 0: u).
 */
export function addVelocity(v: Vec3, u: Vec3): Vec3 {
  const v2 = dot(v, v);
  if (v2 < 1e-24) return u;
  const g = 1 / Math.sqrt(1 - v2);
  const vu = dot(v, u);
  const k = 1 / (1 + vu);
  // u∥ + v and u⊥/γ, over 1 + v·u
  const par = scale(v, vu / v2);
  const perp = sub(u, par);
  return scale(add(add(par, v), scale(perp, 1 / g)), k);
}

/** A 3-velocity in the black hole's frame → the mouth's rest frame (rep components). */
export const velToMouth = (m: Mouth, u: Vec3): Vec3 => toMouth(m, addVelocity(scale(m.V, -1), u));
/** A 3-velocity in the mouth's rest frame (rep components) → the black hole's frame. */
export const velFromMouth = (m: Mouth, u: Vec3): Vec3 => addVelocity(m.V, fromMouth(m, u));

export const toMouth = (m: Mouth, v: Vec3): Vec3 => [dot(v, m.ex), dot(v, m.ey), dot(v, m.ez)];
export const fromMouth = (m: Mouth, v: Vec3): Vec3 => add(add(scale(m.ex, v[0]), scale(m.ey, v[1])), scale(m.ez, v[2]));

/** Spherical frame at a Cartesian direction: (r̂, θ̂, φ̂) and the angles. */
export function sphericalFrame(p: Vec3) {
  const r = Math.hypot(...p);
  const th = Math.acos(Math.min(1, Math.max(-1, p[2] / r)));
  const ph = Math.atan2(p[1], p[0]);
  const st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ph), cp = Math.cos(ph);
  return {
    r, th, ph,
    er: [st * cp, st * sp, ct] as Vec3,
    et: [ct * cp, ct * sp, -st] as Vec3,
    ep: [-sp, cp, 0] as Vec3,
  };
}

/** Rep pose on the Gargantua side → black-hole frame position and vectors. */
export function repToHole(m: Mouth, l: number, n: Vec3) {
  const r = radius(m.w, l)[0];
  return add(m.C, fromMouth(m, scale(n, r)));
}

/** Black-hole frame position → rep pose (Gargantua side, ℓ ≥ a). */
export function holeToRep(m: Mouth, X: Vec3) {
  const q = toMouth(m, sub(X, m.C));
  const r = Math.hypot(...q);
  return { l: ellOfR(m.w, r), n: r > 0 ? scale(q, 1 / r) : ([1, 0, 0] as Vec3), r };
}

/** ZAMO lapse etc. at a Cartesian point of the black-hole frame (flat map of BL coordinates). */
export function zamoAt(X: Vec3, a: number) {
  const f = sphericalFrame(X);
  return { ...f, z: zamo(f.r, f.th, a) };
}
