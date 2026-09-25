// Timelike geodesics of the Kerr metric (Boyer–Lindquist, G = c = M = 1) for the camera when gravity
// is on: a massive body in free fall, with optional thrust (proper acceleration) from the flight keys.
//
// Hamiltonian H = ½ g^{μν} u_μ u_ν = −½ with u_t = −E, u_φ = L (conserved without thrust):
//   dt/dτ = −g^{tt}E + g^{tφ}L,  dφ/dτ = −g^{tφ}E + g^{φφ}L,  dr/dτ = g^{rr}u_r,  dθ/dτ = g^{θθ}u_θ,
//   du_r/dτ = −∂H/∂r,  du_θ/dτ = −∂H/∂θ   (partial derivatives by central differences, float64).
// Velocities are exchanged with the rest of the program as 3-velocities β relative to the local ZAMO,
// components along (r̂, θ̂, φ̂).
//
// A massive companion (the star, a Lens) adds its weak field, h_μν = −2Φ (η_μν + 2 u_μ u_ν) with
// Φ = −m/d_rest (u: the star's 4-velocity), in the flat far-field map: δH = Φ (2γ²(E − v·p)² − 1)
// (Newton for a slow body). E and L then change: dE/dτ = ∂δH/∂t (a moving star exchanges energy with
// the camera — the gravitational slingshot), dL/dτ = −∂δH/∂φ. On its surface the camera lands.

import { horizon, zamo, type Vec3 } from "./physics";

/** A massive body moving on a known path (weak field). */
export interface Lens {
  m: number;
  R: number;
  centre: (t: number) => Vec3;
  velocity: (t: number) => Vec3;
}

export interface Massive {
  t: number;
  r: number;
  th: number;
  ph: number;
  ur: number; // covariant u_r
  uth: number; // covariant u_θ
  E: number; // −u_t
  L: number; // u_φ
}

function inverseMetric(r: number, th: number, a: number) {
  const s = Math.sin(th);
  const c = Math.cos(th);
  const s2 = Math.max(s * s, 1e-12);
  const sig = r * r + a * a * c * c;
  const del = r * r - 2 * r + a * a;
  const A = (r * r + a * a) ** 2 - a * a * del * s2;
  return {
    tt: -A / (sig * del),
    tph: (-2 * a * r) / (sig * del),
    phph: (del - a * a * s2) / (sig * del * s2),
    rr: del / sig,
    thth: 1 / sig,
  };
}

export function hamiltonian(st: Massive, a: number) {
  const g = inverseMetric(st.r, st.th, a);
  return 0.5 * (g.tt * st.E * st.E - 2 * g.tph * st.E * st.L + g.phph * st.L * st.L + g.rr * st.ur * st.ur + g.thth * st.uth * st.uth);
}

type D = { t: number; r: number; th: number; ph: number; ur: number; uth: number; L: number; E: number };

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Spherical basis and Cartesian position at (r, θ, φ) (flat map of BL). */
function frame(r: number, th: number, ph: number) {
  const st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ph), cp = Math.cos(ph);
  const er: Vec3 = [st * cp, st * sp, ct];
  return { er, et: [ct * cp, ct * sp, -st] as Vec3, ep: [-sp, cp, 0] as Vec3, X: [r * er[0], r * er[1], r * er[2]] as Vec3, st };
}

/** The lens's field at a point: ∇Φ (rest-frame distance), its velocity, γ², distance. */
function lensField(lens: Lens, X: Vec3, t: number) {
  const c = lens.centre(t);
  const v = lens.velocity(t);
  const g2 = 1 / (1 - dot3(v, v));
  const dv: Vec3 = [X[0] - c[0], X[1] - c[1], X[2] - c[2]];
  const dvv = dot3(dv, v);
  const d2 = Math.max(dot3(dv, dv) + g2 * dvv * dvv, lens.R * lens.R);
  const k = lens.m / (d2 * Math.sqrt(d2));
  return { grad: [k * (dv[0] + g2 * dvv * v[0]), k * (dv[1] + g2 * dvv * v[1]), k * (dv[2] + g2 * dvv * v[2])] as Vec3, v, g2, c, dist: Math.hypot(...dv) };
}

function rhs(st: Massive, a: number, lens?: Lens): D {
  const { r, th, E, L, ur, uth } = st;
  const g = inverseMetric(r, th, a);
  const Hof = (rr: number, tt: number) => {
    const q = inverseMetric(rr, tt, a);
    return 0.5 * (q.tt * E * E - 2 * q.tph * E * L + q.phph * L * L + q.rr * ur * ur + q.thth * uth * uth);
  };
  const hr = 1e-6 * Math.max(r, 1);
  const hth = 1e-6;
  const d: D = {
    t: -g.tt * E + g.tph * L,
    ph: -g.tph * E + g.phph * L,
    r: g.rr * ur,
    th: g.thth * uth,
    ur: -(Hof(r + hr, th) - Hof(r - hr, th)) / (2 * hr),
    uth: -(Hof(r, th + hth) - Hof(r, th - hth)) / (2 * hth),
    L: 0,
    E: 0,
  };
  if (lens) {
    const f = frame(r, th, st.ph);
    const F = lensField(lens, f.X, st.t);
    // spatial covariant momentum in Cartesian components (flat map)
    const p: Vec3 = [0, 1, 2].map((i) => ur * f.er[i]! + (uth / r) * f.et[i]! + (L / (r * Math.max(f.st, 1e-9))) * f.ep[i]!) as Vec3;
    const w = E - dot3(F.v, p);
    const fac = 2 * F.g2 * w * w - 1; // δH = Φ · fac
    d.ur -= fac * dot3(F.grad, f.er);
    d.uth -= fac * r * dot3(F.grad, f.et);
    d.L = -fac * r * f.st * dot3(F.grad, f.ep);
    d.E = -fac * dot3(F.grad, F.v); // ∂δH/∂t = fac ∂Φ/∂t, ∂Φ/∂t = −∇Φ·v
  }
  return d;
}

function add(st: Massive, d: D, h: number): Massive {
  return {
    t: st.t + h * d.t, r: st.r + h * d.r, th: st.th + h * d.th, ph: st.ph + h * d.ph, ur: st.ur + h * d.ur, uth: st.uth + h * d.uth,
    L: st.L + h * d.L, E: st.E + h * d.E,
  };
}

/** One RK4 step of proper time h. */
export function step(st: Massive, a: number, h: number, lens?: Lens): Massive {
  const k1 = rhs(st, a, lens);
  const k2 = rhs(add(st, k1, h / 2), a, lens);
  const k3 = rhs(add(st, k2, h / 2), a, lens);
  const k4 = rhs(add(st, k3, h), a, lens);
  const n: Massive = {
    ...st,
    t: st.t + (h / 6) * (k1.t + 2 * k2.t + 2 * k3.t + k4.t),
    r: st.r + (h / 6) * (k1.r + 2 * k2.r + 2 * k3.r + k4.r),
    th: st.th + (h / 6) * (k1.th + 2 * k2.th + 2 * k3.th + k4.th),
    ph: st.ph + (h / 6) * (k1.ph + 2 * k2.ph + 2 * k3.ph + k4.ph),
    ur: st.ur + (h / 6) * (k1.ur + 2 * k2.ur + 2 * k3.ur + k4.ur),
    uth: st.uth + (h / 6) * (k1.uth + 2 * k2.uth + 2 * k3.uth + k4.uth),
    L: st.L + (h / 6) * (k1.L + 2 * k2.L + 2 * k3.L + k4.L),
    E: st.E + (h / 6) * (k1.E + 2 * k2.E + 2 * k3.E + k4.E),
  };
  // across the polar axis: reflect (θ → −θ or 2π − θ, φ → φ + π)
  if (n.th < 0) return { ...n, th: -n.th, ph: n.ph + Math.PI, uth: -n.uth };
  if (n.th > Math.PI) return { ...n, th: 2 * Math.PI - n.th, ph: n.ph + Math.PI, uth: -n.uth };
  return n;
}

/** State at (r, θ, φ) moving with 3-velocity β (|β| < 1) relative to the ZAMO, components (r̂, θ̂, φ̂). */
export function fromZamo(r: number, th: number, ph: number, beta: Vec3, a: number, t = 0): Massive {
  const z = zamo(r, th, a);
  const b2 = Math.min(beta[0] ** 2 + beta[1] ** 2 + beta[2] ** 2, 0.999999);
  const g = 1 / Math.sqrt(1 - b2);
  const U: Vec3 = [g * beta[0], g * beta[1], g * beta[2]];
  const L = z.varpi * U[2];
  return { t, r, th, ph, ur: z.sqrtSigOverDel * U[0], uth: z.sqrtSig * U[1], L, E: z.alpha * g + z.omega * L };
}

/** 3-velocity relative to the local ZAMO, components (r̂, θ̂, φ̂). */
export function toZamo(st: Massive, a: number): Vec3 {
  const z = zamo(st.r, st.th, a);
  const Ur = st.ur / z.sqrtSigOverDel;
  const Uth = st.uth / z.sqrtSig;
  const Uph = st.L / z.varpi;
  const g = (st.E - z.omega * st.L) / z.alpha;
  return [Ur / g, Uth / g, Uph / g];
}

/**
 * Proper acceleration: changes the 4-velocity by a·dτ along the unit direction `dir` of the ZAMO
 * frame (applied as an impulse at the current point; E and L change accordingly).
 */
export function thrust(st: Massive, dir: Vec3, accel: number, dtau: number, a: number): Massive {
  if (accel === 0) return st;
  const beta = toZamo(st, a);
  const b2 = beta[0] ** 2 + beta[1] ** 2 + beta[2] ** 2;
  const g = 1 / Math.sqrt(Math.max(1 - b2, 1e-12));
  const U: Vec3 = [g * beta[0] + accel * dtau * dir[0], g * beta[1] + accel * dtau * dir[1], g * beta[2] + accel * dtau * dir[2]];
  const g2 = Math.sqrt(1 + U[0] ** 2 + U[1] ** 2 + U[2] ** 2);
  return fromZamo(st.r, st.th, st.ph, [U[0] / g2, U[1] / g2, U[2] / g2], a, st.t);
}

/** Proper-time step: small near the horizon and where the body moves fast in angle. */
function stepSize(st: Massive, a: number, lens?: Lens) {
  const rH = horizon(a);
  let h = Math.min(0.02 * (st.r - rH) * Math.sqrt(st.r), 0.5 + 0.01 * st.r, 2);
  if (lens) {
    // near the star: small against the distance and the local orbital period
    const d = Math.max(lensField(lens, frame(st.r, st.th, st.ph).X, st.t).dist, lens.R);
    h = Math.min(h, Math.max(0.1 * (d - lens.R), 0.02 * lens.R), (0.03 * d ** 1.5) / Math.sqrt(lens.m));
  }
  return h;
}

/**
 * On (or in) the star: the camera sits on its surface and moves with it (an inelastic landing; it
 * takes off again with enough thrust). Returns the corrected state, or null if not in contact.
 */
function land(st: Massive, a: number, lens: Lens): Massive | null {
  const f = frame(st.r, st.th, st.ph);
  const c = lens.centre(st.t);
  const n: Vec3 = [f.X[0] - c[0], f.X[1] - c[1], f.X[2] - c[2]];
  const d = Math.hypot(...n);
  if (d >= lens.R) return null;
  const k = (lens.R * 1.0002) / Math.max(d, 1e-9);
  const X: Vec3 = [c[0] + n[0] * k, c[1] + n[1] * k, c[2] + n[2] * k];
  const r = Math.hypot(...X);
  const th = Math.acos(Math.max(-1, Math.min(1, X[2] / r)));
  const ph = Math.atan2(X[1], X[0]);
  const g = frame(r, th, ph);
  // the star's velocity seen by the local ZAMO
  const z = zamo(r, th, a);
  const v = lens.velocity(st.t);
  const beta: Vec3 = [
    (z.sqrtSigOverDel * dot3(v, g.er)) / z.alpha,
    (z.sqrtSig * (dot3(v, g.et) / r)) / z.alpha,
    (z.varpi * (dot3(v, g.ep) / (r * Math.max(g.st, 1e-9)) - z.omega)) / z.alpha,
  ];
  // keep an outward motion (take-off), drop the inward one
  const cur = toZamo(st, a);
  const nz: Vec3 = [dot3(n, g.er) / d, dot3(n, g.et) / d, dot3(n, g.ep) / d];
  const out = Math.max(0, dot3(cur, nz) - dot3(beta, nz));
  return fromZamo(r, th, ph, [beta[0] + out * nz[0], beta[1] + out * nz[1], beta[2] + out * nz[2]], a, st.t);
}

/**
 * Advances the body by `dt` of coordinate time (the scene's time), or until it comes within
 * `stopAt` of the horizon. Returns the new state (its proper time is the sum of the steps).
 */
export function advance(st: Massive, a: number, dt: number, stopAt = 0.05, accel = 0, dir: Vec3 = [0, 0, 0], lens?: Lens) {
  const rH = horizon(a);
  const tEnd = st.t + dt;
  let s = st;
  let tau = 0;
  let landed = false;
  for (let i = 0; i < 4000 && s.t < tEnd; i++) {
    let h = stepSize(s, a, lens);
    const tdot = rhs(s, a).t;
    if (s.t + h * tdot > tEnd) h = Math.max((tEnd - s.t) / tdot, 1e-9);
    let n = thrust(step(s, a, h, lens), dir, accel, h, a);
    if (!Number.isFinite(n.r) || n.r < rH + stopAt) return { st: s, tau, stopped: true, landed };
    if (lens) {
      const l = land(n, a, lens);
      if (l) (n = l), (landed = true);
    }
    s = n;
    tau += h;
  }
  return { st: s, tau, stopped: false, landed };
}

/** Future path (no thrust): Cartesian points (flat map of BL) until `tMax` of coordinate time. */
export function predict(st: Massive, a: number, tMax: number, maxPoints = 400, lens?: Lens) {
  const rH = horizon(a);
  const pts: Vec3[] = [];
  let s = st;
  let fate: "horizon" | "escape" | "continues" | "star" = "continues";
  const dtPoint = tMax / maxPoints;
  for (let i = 0; i < maxPoints; i++) {
    const r = advance(s, a, dtPoint, 0.05, 0, [0, 0, 0], lens);
    s = r.st;
    pts.push([s.r * Math.sin(s.th) * Math.cos(s.ph), s.r * Math.sin(s.th) * Math.sin(s.ph), s.r * Math.cos(s.th)]);
    if (r.stopped) {
      fate = "horizon";
      break;
    }
    if (r.landed) {
      fate = "star"; // it hits the star
      break;
    }
    if (s.r > 2000) {
      fate = "escape";
      break;
    }
  }
  return { pts, fate };
}
