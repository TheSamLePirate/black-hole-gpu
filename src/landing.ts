// The planet's own frame: flying low, landing, taking off.
//
// Within its sphere of influence the ship is integrated in the planet's rest frame, turning with it
// (the planets are tidally locked: their ground is at rest in the frame that turns with their orbit),
// in proper lengths and the planet's proper time — float64 metres-scale motion instead of positions
// ten M from the hole. Local axes: x away from the primary (Gargantua, or the host star), y along the
// orbit, z north. The forces:
//   · the planet's gravity, −m ξ/|ξ|³, exact;
//   · the primary's tide, Coriolis and centrifugal terms: the linear relative motion about the orbit
//     (lowthrust.ts: Kerr's epicycles about Gargantua; Hill's equations about a star), carried to
//     proper lengths (the metric's scale factors, the Lorentz stretch along the motion) and proper
//     time (dt = uᵗ dτ);
//   · the atmosphere's drag (exponential, at rest on the turning ground): ½ ρ v² / B (B: the ship's
//     ballistic coefficient m/(C_D A));
//   · the engines (proper acceleration).
// Contact: the ship stops on the ground (above its gear) and turns with it; it takes off when its
// thrust beats its weight there.

import { coordToZamo, zamo, zamoToCoord, type Vec3 } from "./physics";
import { epicycle } from "./lowthrust";
import { accelUnit } from "./engine";
import { body as sysBody, GARGANTUA_SYSTEM, type BodyDef } from "./system/bodies";
import { bodyTrack, meanMotion } from "./system/ephemeris";
import { circularOrbit } from "./system/kerr-orbits";
import { sphericalFrame } from "./wormhole";
import { relief, SURF } from "./terrain";

type M6 = number[][];

/** height of the ship's centre above its gear [m] */
export const GEAR = 6;
/** ballistic coefficient m/(C_D A) [kg/m²] (a dense lander) */
export const BALLISTIC = 900;
/** above this impact speed [m/s] the landing is a crash */
export const CRASH_SPEED = 12;

export interface PlanetFrame {
  id: string;
  /** radius, GM [M] */
  R: number;
  m: number;
  /** the primary (hole: origin) and the planet: places, coordinate velocities, orbit radius, rate */
  H: Vec3;
  VH: Vec3;
  C: Vec3;
  V: Vec3;
  rOrb: number;
  n: number;
  /** dt/dτ of the planet */
  ut: number;
  /** coordinate (x, y, z) → proper lengths */
  S: Vec3;
  /** the relative motion's system matrix in proper coordinates and time */
  A: M6;
  atm: { rho0: number; H: number } | null;
  /** its surface kind (terrain.ts) */
  surf: number;
  /** metres per M */
  mPerM: number;
  /** c²/M in m/s² */
  aUnit: number;
}

export interface LocalState {
  /** position [M] and velocity [c] in the turning local frame (proper) */
  xi: Vec3;
  w: Vec3;
  landed: boolean;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(...a);
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

/** The frame of a planet of the Gargantua system at coordinate time t (spin a, hole of massSolar). */
export function planetFrame(id: string, t: number, a: number, massSolar: number): PlanetFrame {
  const sys = GARGANTUA_SYSTEM;
  const b: BodyDef = sysBody(sys, id);
  const tr = bodyTrack(sys, id);
  const C = tr.pos(t), V = tr.vel(t);
  const hostId = b.orbit.type === "kepler" && b.parent && b.parent !== "gargantua" ? b.parent : null;
  const H: Vec3 = hostId ? bodyTrack(sys, hostId).pos(t) : [0, 0, 0];
  const VH: Vec3 = hostId ? bodyTrack(sys, hostId).vel(t) : [0, 0, 0];
  const rel: Vec3 = [C[0] - H[0], C[1] - H[1], C[2] - H[2]];
  const rOrb = Math.hypot(rel[0], rel[1]);
  const n = meanMotion(sys, b);
  let A: M6;
  let S: Vec3;
  let ut: number;
  if (!hostId) {
    const e = epicycle(rOrb, Math.abs(a));
    const o = circularOrbit(rOrb, Math.abs(a));
    ut = o.ut;
    const f = sphericalFrame(C);
    const z = zamo(f.r, Math.PI / 2, a);
    const g = 1 / Math.sqrt(1 - o.vZamo * o.vZamo);
    S = [z.sqrtSigOverDel, (g * z.varpi) / rOrb, z.sqrtSig / f.r];
    A = systemMatrix(e.kappa2, e.nu2, e.gamma, e.Gamma);
  } else {
    // around a star, in its weak field: Hill's equations (κ = ν = n, γ = 2n, Γ = n/2)
    ut = 1;
    S = [1, 1, 1];
    A = systemMatrix(n * n, n * n, 2 * n, n / 2);
  }
  // to proper coordinates and time: s_p = T s, T = diag(S, uᵗ S); ds_p/dτ = uᵗ T A T⁻¹ s_p
  const Td = [S[0], S[1], S[2], ut * S[0], ut * S[1], ut * S[2]];
  const Ap = A.map((row, i) => row.map((v, j) => (ut * Td[i]! * v) / Td[j]!));
  return {
    id, R: b.radius, m: b.mass, H, VH, C, V, rOrb, n, ut, S, A: Ap,
    atm: b.surface?.atmosphere ?? null, surf: SURF[b.surface?.kind ?? "rock"],
    mPerM: 1476.625 * massSolar, aUnit: accelUnit({ massSolar }),
  };
}

function systemMatrix(kappa2: number, nu2: number, gamma: number, Gamma: number): M6 {
  const Z = () => [0, 0, 0, 0, 0, 0];
  const A: M6 = [Z(), Z(), Z(), Z(), Z(), Z()];
  A[0]![3] = A[1]![4] = A[2]![5] = 1;
  A[3]![0] = -kappa2 + (kappa2 * gamma) / Gamma;
  A[3]![4] = kappa2 / Gamma;
  A[4]![3] = -gamma;
  A[5]![2] = -nu2;
  return A;
}

/** The ship (map place X, coordinate velocity Vs) in the planet's frame. */
export function toLocal(F: PlanetFrame, X: Vec3, Vs: Vec3): LocalState {
  const rel: Vec3 = [X[0] - F.H[0], X[1] - F.H[1], X[2] - F.H[2]];
  const crel: Vec3 = [F.C[0] - F.H[0], F.C[1] - F.H[1], F.C[2] - F.H[2]];
  const ws = Math.hypot(rel[0], rel[1]);
  const eR: Vec3 = [rel[0] / ws, rel[1] / ws, 0], eP: Vec3 = [-rel[1] / ws, rel[0] / ws, 0];
  const dv: Vec3 = [Vs[0] - F.VH[0], Vs[1] - F.VH[1], Vs[2] - F.VH[2]];
  const x = ws - F.rOrb;
  const y = F.rOrb * wrap(Math.atan2(rel[1], rel[0]) - Math.atan2(crel[1], crel[0]));
  const z = rel[2] - crel[2];
  const u = dot(dv, eR), v = F.rOrb * (dot(dv, eP) / ws - F.n), w = dv[2];
  const { S, ut } = F;
  return { xi: [S[0] * x, S[1] * y, S[2] * z], w: [ut * S[0] * u, ut * S[1] * v, ut * S[2] * w], landed: false };
}

/** Back to the map: place and coordinate velocity. */
export function toGlobal(F: PlanetFrame, L: LocalState): { X: Vec3; V: Vec3 } {
  const { S, ut } = F;
  const x = L.xi[0] / S[0], y = L.xi[1] / S[1], z = L.xi[2] / S[2];
  const u = L.w[0] / (ut * S[0]), v = L.w[1] / (ut * S[1]), w = L.w[2] / (ut * S[2]);
  const crel: Vec3 = [F.C[0] - F.H[0], F.C[1] - F.H[1], F.C[2] - F.H[2]];
  const ph = Math.atan2(crel[1], crel[0]) + y / F.rOrb;
  const ws = F.rOrb + x;
  const eR: Vec3 = [Math.cos(ph), Math.sin(ph), 0], eP: Vec3 = [-Math.sin(ph), Math.cos(ph), 0];
  const X: Vec3 = [F.H[0] + ws * eR[0], F.H[1] + ws * eR[1], crel[2] + F.H[2] + z];
  const vp = ws * (F.n + v / F.rOrb);
  const V: Vec3 = [F.VH[0] + u * eR[0] + vp * eP[0], F.VH[1] + u * eR[1] + vp * eP[1], F.VH[2] + w];
  return { X, V };
}

/** A map coordinate velocity at X as the ZAMO there measures it (β, components r̂ θ̂ φ̂). */
export function zamoBeta(X: Vec3, V: Vec3, a: number): Vec3 {
  const f = sphericalFrame(X);
  return coordToZamo([dot(V, f.er), dot(V, f.et), dot(V, f.ep)], f.r, f.th, zamo(f.r, f.th, a));
}

/** The reverse: β at X → map coordinate velocity. */
export function betaToCoord(X: Vec3, b: Vec3, a: number): Vec3 {
  const f = sphericalFrame(X);
  const c = zamoToCoord(b, f.r, f.th, zamo(f.r, f.th, a));
  return [0, 1, 2].map((i) => c[0] * f.er[i]! + c[1] * f.et[i]! + c[2] * f.ep[i]!) as Vec3;
}

/** Local axes (x out, y along, z north) of a vector given along the ZAMO axes (r̂, θ̂, φ̂), and back. */
export const zamoToLocal = (v: Vec3): Vec3 => [v[0], v[2], -v[1]];
export const localToZamo = (v: Vec3): Vec3 => [v[0], -v[2], v[1]];

/** Radius of the ground under a local position (the relief of terrain.ts) [M]. */
export function groundR(F: PlanetFrame, xi: Vec3): number {
  const d = len(xi);
  return F.R + relief(F.surf, [xi[0] / d, xi[1] / d, xi[2] / d], F.R * F.mPerM) / F.mPerM;
}

/** Air density at a height [kg/m³]. */
export function airDensity(F: PlanetFrame, hM: number): number {
  if (!F.atm) return 0;
  const h = Math.max(hM, 0) * F.mPerM;
  return h > 30 * F.atm.H ? 0 : F.atm.rho0 * Math.exp(-h / F.atm.H);
}

/** Acceleration in the local frame [c²/M]: primary's field (linear), planet's gravity, drag, thrust. */
export function localAccel(F: PlanetFrame, xi: Vec3, w: Vec3, thrust: Vec3): Vec3 {
  const s = [...xi, ...w];
  const a: Vec3 = [0, 1, 2].map((i) => F.A[3 + i]!.reduce((acc, v, j) => acc + v * s[j]!, 0)) as Vec3;
  const d = len(xi);
  const g = F.m / Math.max(d * d * d, 1e-300);
  let out: Vec3 = [a[0] - g * xi[0] + thrust[0], a[1] - g * xi[1] + thrust[1], a[2] - g * xi[2] + thrust[2]];
  const rho = airDensity(F, d - F.R);
  const sp = len(w);
  if (rho > 0 && sp > 0) {
    // ½ ρ v² / B, in c²/M: v [c] → m/s, the result → c²/M
    const vs = sp * 299792458;
    const k = (0.5 * rho * vs * vs) / BALLISTIC / F.aUnit / sp;
    out = [out[0] - k * w[0], out[1] - k * w[1], out[2] - k * w[2]];
  }
  return out;
}

/** The local weight: what the engine must beat to lift off, along the local up [c²/M]. */
export function weightUp(F: PlanetFrame, xi: Vec3): number {
  const up: Vec3 = [xi[0] / len(xi), xi[1] / len(xi), xi[2] / len(xi)];
  return -dot(localAccel(F, xi, [0, 0, 0], [0, 0, 0]), up);
}

/**
 * Advances the local state by dτ (proper time of the planet, M) with a constant thrust (proper
 * acceleration, local axes, c²/M): RK4 substeps small against the orbit around the planet, the drag
 * time and the time to the ground. Returns the impact speed [m/s] if it touched down.
 */
export function stepLocal(F: PlanetFrame, L: LocalState, dtau: number, thrust: Vec3): { impact: number | null } {
  const gear = GEAR / F.mPerM;
  if (L.landed) {
    // on the ground: stays, unless the thrust lifts it
    const up: Vec3 = [L.xi[0] / len(L.xi), L.xi[1] / len(L.xi), L.xi[2] / len(L.xi)];
    if (dot(thrust, up) > weightUp(F, L.xi)) L.landed = false;
    else return { impact: null };
  }
  let left = dtau;
  let impact: number | null = null;
  for (let guard = 0; left > 0 && guard < 20000; guard++) {
    const d = len(L.xi);
    const sp = len(L.w) + 1e-30;
    const hNow = Math.max(d - groundR(F, L.xi) - gear, 1e-12);
    const rho = airDensity(F, d - F.R);
    // (v/a of the drag, in M: B a_unit / (½ ρ v c²))
    const dragT = rho > 0 ? (BALLISTIC * F.aUnit) / (0.5 * rho * sp * 299792458 ** 2) : Infinity;
    const orbitT = Math.sqrt((d * d * d) / F.m);
    let h = Math.min(left, 0.02 * orbitT, 0.2 * dragT, Math.max(0.2 * hNow / sp, 1e-3 * orbitT));
    h = Math.max(h, 1e-14);
    const f = (x: Vec3, v: Vec3) => localAccel(F, x, v, thrust);
    const x0 = L.xi, v0 = L.w;
    const k1v = f(x0, v0), k1x = v0;
    const x1: Vec3 = [x0[0] + 0.5 * h * k1x[0], x0[1] + 0.5 * h * k1x[1], x0[2] + 0.5 * h * k1x[2]];
    const v1: Vec3 = [v0[0] + 0.5 * h * k1v[0], v0[1] + 0.5 * h * k1v[1], v0[2] + 0.5 * h * k1v[2]];
    const k2v = f(x1, v1), k2x = v1;
    const x2: Vec3 = [x0[0] + 0.5 * h * k2x[0], x0[1] + 0.5 * h * k2x[1], x0[2] + 0.5 * h * k2x[2]];
    const v2: Vec3 = [v0[0] + 0.5 * h * k2v[0], v0[1] + 0.5 * h * k2v[1], v0[2] + 0.5 * h * k2v[2]];
    const k3v = f(x2, v2), k3x = v2;
    const x3: Vec3 = [x0[0] + h * k3x[0], x0[1] + h * k3x[1], x0[2] + h * k3x[2]];
    const v3: Vec3 = [v0[0] + h * k3v[0], v0[1] + h * k3v[1], v0[2] + h * k3v[2]];
    const k4v = f(x3, v3), k4x = v3;
    L.xi = [0, 1, 2].map((i) => x0[i]! + (h / 6) * (k1x[i]! + 2 * k2x[i]! + 2 * k3x[i]! + k4x[i]!)) as Vec3;
    L.w = [0, 1, 2].map((i) => v0[i]! + (h / 6) * (k1v[i]! + 2 * k2v[i]! + 2 * k3v[i]! + k4v[i]!)) as Vec3;
    left -= h;
    // the ground
    const dn = len(L.xi);
    const gr = groundR(F, L.xi);
    if (dn <= gr + gear) {
      const up: Vec3 = [L.xi[0] / dn, L.xi[1] / dn, L.xi[2] / dn];
      impact = len(L.w) * 299792458;
      L.xi = [up[0] * (gr + gear), up[1] * (gr + gear), up[2] * (gr + gear)];
      L.w = [0, 0, 0];
      L.landed = true;
      break;
    }
  }
  return { impact };
}
