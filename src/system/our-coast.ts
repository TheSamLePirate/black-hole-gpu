// A craft coasting in our universe, as the flown one falls (controller/motion.ts flyHome, in the vacuum,
// the engine off): on rails — Kepler's orbit, the oblateness's secular drift, the thin air's decay — when
// the frame is a good part of a stable orbit; else, about a world with air, kick-drift-kick steps of a
// hundredth of the fall time with the air's drag in each kick, elsewhere Yoshida's fourth-order composition
// — under every body's pull and the oblateness (gravityHome), a step never more than a tenth of the time
// to the ground. The fleet's craft not flown (fleet.ts) are moved
// by it frame by frame, as the flown one is: a rendezvous with them is the flight's own, exact.
import { airTop } from "../aero";
import type { Vec3 } from "../physics";
import { cross, dot, lin, sub } from "../math/vec3";
import { symmetricStep, YOSHIDA } from "./our-predict";
import { gravityHome, ourState, referenceBody, soiOf } from "./our-side";
import { dragAccel, gearHeight, groundVelocity, solidBody } from "./our-surface";
import { buildMeanOrbit, type MeanOrbit, meanOrbitState } from "./mean-orbit";
import { M_METRES, solarBody } from "./solar";
import { C_MPS } from "../units";

/** A stable orbit about the reference body — clear of its air, well inside its sphere — or null. */
export function stableOrbitOf(X: Vec3, V: Vec3, t: number): { ref: string; mass: number; period: number } | null {
  const ref = referenceBody(X, t);
  if (ref === "sun") return null;
  const b = solarBody(ref)!;
  const st = ourState(ref, t);
  const r = sub(X, st.pos),
    v = sub(V, st.vel);
  const R = Math.hypot(...r);
  const eps = dot(v, v) / 2 - b.mass / R;
  if (!(eps < 0)) return null;
  const a = -b.mass / (2 * eps);
  const h = cross(r, v);
  const e = Math.sqrt(Math.max(1 - dot(h, h) / (b.mass * a), 0));
  const clear = b.radius * 1.01 + airTop(b.atmosphere) / M_METRES;
  if (a * (1 - e) < clear || a * (1 + e) > 0.25 * soiOf(ref, t)) return null;
  return { ref, mass: b.mass, period: 2 * Math.PI * Math.sqrt(a ** 3 / b.mass) };
}

/**
 * On rails over simDt from a stable orbit (stableOrbitOf): the place and velocity at its end — the mean
 * orbit the flight's own integrator flies (mean-orbit.ts: a turn flown once, its mean elements and its
 * short-period terms), within the integrator's own consistency (~10 m a turn in a low Earth orbit, where a
 * Kepler orbit from the osculating state, turned by the J2's secular drift, ran 49 km a turn off it).
 */
export function railsCoast(rails: { ref: string; mass: number }, X: Vec3, V: Vec3, t0: number, simDt: number): { X: Vec3; V: Vec3 } {
  return meanOrbitState(railsModel(rails, X, V, t0), t0 + simDt);
}

// (the models in use: each kept while every call starts from the state it gave — no burn, no other pull
// in between —, rebuilt as its fit ages; a few at once: the flown craft, the fleet's coasting ones)
const models: (MeanOrbit & { calls?: number })[] = [];
/** the rails' models built so far (a turn's integration each: what a warp costs) */
export const railsStats = { builds: 0 };
const MAX_MODELS = 8;
/**
 * How many of its turns a model is trusted for — measured against the integrator in a 400 km orbit: 50 m
 * off after 15, 0.9 km after 50 (the air's drag varying, the Moon's and the Sun's long terms): 30 while it
 * is flown at the warps of a rendezvous (less than a turn a call), 300 at a cruise's (turns a call: a blur)
 * — a turn's integration (~50 ms) at most every few seconds, rebuilt as the warp comes down.
 */
const maxTurns = (m: MeanOrbit & { calls?: number }, t0: number) => ((t0 - m.t0) / Math.max(m.calls ?? 1, 1) < m.period ? 30 : 300);

function railsModel(rails: { ref: string; mass: number }, X: Vec3, V: Vec3, t0: number): MeanOrbit {
  // (the same state, to a centimetre and a micrometre a second: what the model itself gave, through the
  // flight's frames' round trips — sub-millimetre)
  const tolX = 1e-2 / M_METRES,
    tolV = 1e-6 / C_MPS;
  for (let k = 0; k < models.length; k++) {
    const m = models[k]!;
    if (m.ref !== rails.ref || t0 < m.t0 || t0 - m.t0 > maxTurns(m, t0) * m.period) continue;
    const s = meanOrbitState(m, t0);
    if (Math.hypot(...sub(s.X, X)) < tolX && Math.hypot(...sub(s.V, V)) < tolV) {
      m.calls = (m.calls ?? 0) + 1;
      if (k > 0) models.unshift(...models.splice(k, 1));
      return m;
    }
  }
  railsStats.builds++;
  const m = buildMeanOrbit(rails.ref, rails.mass, X, V, t0, (x, v, t, dt) => coastHome(x, v, t, dt));
  models.unshift(m);
  if (models.length > MAX_MODELS) models.pop();
  return m;
}

/** The fall over simDt [M] from (X, V) at t0 [home frame, c], the engine off: as the flown craft's (its end, t: tEnd unless subCap steps stopped short). */
export function coastHome(X: Vec3, V: Vec3, t0: number, simDt: number, subCap = 400): { X: Vec3; V: Vec3; t: number } {
  const rails = stableOrbitOf(X, V, t0);
  if (rails && simDt > 0.02 * rails.period) return { ...railsCoast(rails, X, V, t0, simDt), t: t0 + simDt };
  const ref = referenceBody(X, t0);
  const ground = solidBody(ref) ? ref : null;
  const atm = ref !== "sun" ? solarBody(ref)?.atmosphere : undefined;
  // (about a world with air, the flown craft flies through it at every height — its steps a hundredth of
  // the fall time, a kick-drift-kick, the air's pull in each kick: here the thin air's drag on the craft)
  const airy = !!atm;
  let g = gravityHome(X, t0, V);
  let aAir = 0;
  const accAt = (Xq: Vec3, Vq: Vec3, tq: number, gq: typeof g): Vec3 => {
    if (!airy) return lin(gq.acc, 1, [0, 0, 0], 1);
    const d = dragAccel(ref, Xq, Vq, tq);
    aAir = Math.hypot(...d) / (Math.hypot(...sub(Vq, groundVelocity(ref, Xq, tq))) + 1e-30);
    return lin(gq.acc, 1, d, 1);
  };
  let t = t0;
  const tEnd = t0 + simDt;
  let a = accAt(X, V, t, g);
  for (let i = 0; i < subCap && t < tEnd - 1e-12; i++) {
    let dt = airy ? 0.01 * g.tDyn : symmetricStep(0.025, g.tDyn, g.tDot);
    if (ground || airy) {
      const h = Math.max(gearHeight(ref, X, t), 0) / M_METRES;
      const vr = Math.hypot(...sub(V, groundVelocity(ref, X, t))) + 1e-12;
      dt = Math.min(dt, Math.max((0.1 * h) / vr, 2e-4));
      if (aAir > 0) dt = Math.min(dt, Math.max(0.05 / aAir, 1e-6));
    }
    dt = Math.min(dt, tEnd - t);
    let last = dt;
    const tn = t + dt;
    if (!airy && !(ground && gearHeight(ground, X, t) < 1e5)) {
      for (const w of YOSHIDA.slice(0, 2)) {
        const h = w * dt;
        V = lin(V, 1, a, h / 2);
        X = lin(X, 1, V, h);
        t += h;
        g = gravityHome(X, t, V);
        a = g.acc;
        V = lin(V, 1, a, h / 2);
      }
      const h = YOSHIDA[2]! * dt;
      V = lin(V, 1, a, h / 2);
      X = lin(X, 1, V, h);
      t = tn;
      last = h;
      if (atm) V = lin(V, 1, dragAccel(ref, X, V, t), dt);
    } else {
      V = lin(V, 1, a, dt / 2);
      X = lin(X, 1, V, dt);
      t = tn;
    }
    g = gravityHome(X, t, V);
    a = accAt(X, V, t, g);
    V = lin(V, 1, a, last / 2);
  }
  // (its time: where the steps stopped — a gap longer than subCap steps is caught up over frames)
  return { X, V, t };
}
