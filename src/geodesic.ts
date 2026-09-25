// Timelike geodesics of the Kerr metric (Boyer–Lindquist, G = c = M = 1) for the camera when gravity
// is on: a massive body in free fall, with optional thrust (proper acceleration) from the flight keys.
//
// Hamiltonian H = ½ g^{μν} u_μ u_ν = −½ with u_t = −E, u_φ = L (conserved without thrust):
//   dt/dτ = −g^{tt}E + g^{tφ}L,  dφ/dτ = −g^{tφ}E + g^{φφ}L,  dr/dτ = g^{rr}u_r,  dθ/dτ = g^{θθ}u_θ,
//   du_r/dτ = −∂H/∂r,  du_θ/dτ = −∂H/∂θ   (partial derivatives by central differences, float64).
// Velocities are exchanged with the rest of the program as 3-velocities β relative to the local ZAMO,
// components along (r̂, θ̂, φ̂).

import { horizon, zamo, type Vec3 } from "./physics";

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

type D = { t: number; r: number; th: number; ph: number; ur: number; uth: number };

function rhs(st: Massive, a: number): D {
  const { r, th, E, L, ur, uth } = st;
  const g = inverseMetric(r, th, a);
  const Hof = (rr: number, tt: number) => {
    const q = inverseMetric(rr, tt, a);
    return 0.5 * (q.tt * E * E - 2 * q.tph * E * L + q.phph * L * L + q.rr * ur * ur + q.thth * uth * uth);
  };
  const hr = 1e-6 * Math.max(r, 1);
  const hth = 1e-6;
  return {
    t: -g.tt * E + g.tph * L,
    ph: -g.tph * E + g.phph * L,
    r: g.rr * ur,
    th: g.thth * uth,
    ur: -(Hof(r + hr, th) - Hof(r - hr, th)) / (2 * hr),
    uth: -(Hof(r, th + hth) - Hof(r, th - hth)) / (2 * hth),
  };
}

function add(st: Massive, d: D, h: number): Massive {
  return { ...st, t: st.t + h * d.t, r: st.r + h * d.r, th: st.th + h * d.th, ph: st.ph + h * d.ph, ur: st.ur + h * d.ur, uth: st.uth + h * d.uth };
}

/** One RK4 step of proper time h. */
export function step(st: Massive, a: number, h: number): Massive {
  const k1 = rhs(st, a);
  const k2 = rhs(add(st, k1, h / 2), a);
  const k3 = rhs(add(st, k2, h / 2), a);
  const k4 = rhs(add(st, k3, h), a);
  const n: Massive = {
    ...st,
    t: st.t + (h / 6) * (k1.t + 2 * k2.t + 2 * k3.t + k4.t),
    r: st.r + (h / 6) * (k1.r + 2 * k2.r + 2 * k3.r + k4.r),
    th: st.th + (h / 6) * (k1.th + 2 * k2.th + 2 * k3.th + k4.th),
    ph: st.ph + (h / 6) * (k1.ph + 2 * k2.ph + 2 * k3.ph + k4.ph),
    ur: st.ur + (h / 6) * (k1.ur + 2 * k2.ur + 2 * k3.ur + k4.ur),
    uth: st.uth + (h / 6) * (k1.uth + 2 * k2.uth + 2 * k3.uth + k4.uth),
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
function stepSize(st: Massive, a: number) {
  const rH = horizon(a);
  return Math.min(0.02 * (st.r - rH) * Math.sqrt(st.r), 0.5 + 0.01 * st.r, 2);
}

/**
 * Advances the body by `dt` of coordinate time (the scene's time), or until it comes within
 * `stopAt` of the horizon. Returns the new state (its proper time is the sum of the steps).
 */
export function advance(st: Massive, a: number, dt: number, stopAt = 0.05, accel = 0, dir: Vec3 = [0, 0, 0]) {
  const rH = horizon(a);
  const tEnd = st.t + dt;
  let s = st;
  let tau = 0;
  for (let i = 0; i < 4000 && s.t < tEnd; i++) {
    let h = stepSize(s, a);
    const tdot = rhs(s, a).t;
    if (s.t + h * tdot > tEnd) h = Math.max((tEnd - s.t) / tdot, 1e-9);
    const n = thrust(step(s, a, h), dir, accel, h, a);
    if (!Number.isFinite(n.r) || n.r < rH + stopAt) return { st: s, tau, stopped: true };
    s = n;
    tau += h;
  }
  return { st: s, tau, stopped: false };
}

/** Future path (no thrust): Cartesian points (flat map of BL) until `tMax` of coordinate time. */
export function predict(st: Massive, a: number, tMax: number, maxPoints = 400) {
  const rH = horizon(a);
  const pts: Vec3[] = [];
  let s = st;
  let fate: "horizon" | "escape" | "continues" = "continues";
  const dtPoint = tMax / maxPoints;
  for (let i = 0; i < maxPoints; i++) {
    const r = advance(s, a, dtPoint, 0.05);
    s = r.st;
    pts.push([s.r * Math.sin(s.th) * Math.cos(s.ph), s.r * Math.sin(s.th) * Math.sin(s.ph), s.r * Math.cos(s.th)]);
    if (r.stopped) {
      fate = "horizon";
      break;
    }
    if (s.r > 2000) {
      fate = "escape";
      break;
    }
  }
  return { pts, fate };
}
