import { expect, test } from "bun:test";
import { airAt } from "../src/aero";
import { pressureFactor } from "../src/engine";
import { heightOf } from "../src/entry";
import { envOf } from "../src/entry-env";
import { lin } from "../src/math/vec3";
import { gameTimeOf, ISS_BALLISTIC, issElements, issOrbit } from "../src/system/iss";
import { predictOurs } from "../src/system/our-predict";
import { earthStart, gravityHome } from "../src/system/our-side";
import { dragAccel } from "../src/system/our-surface";
import { M_METRES, M_SECONDS, solarBody, solarState } from "../src/system/solar";

// Reference flights (phase 2, audit §7 item 10: "aucune trajectoire de référence"): the game's own
// physics — its gravity (J2–J4, the Moon and the Sun), its US76 air, its turning WGS84 Earth, its engines'
// thrust in the air — against what flew:
//  · the ISS a day on from its elements, against SGP4;
//  · Apollo 4's return from the Moon's distance (NASA: entry at 24 974 mph at 76 mi, a dip to 35 mi,
//    a skip back to 45 mi);
//  · a Falcon 9's ascent with its published stages (SpaceX's user's guide) lifting its published LEO
//    payload (22,8 t, expendable) — and no more;
//  · an orbit's energy kept over days by the predictor (its integrator, all the bodies' pulls: over 30
//    days, measured, 15 m at 400 km and 1.3 m at 1 500 km — three days here, the suite kept short).
// Points with published coefficients where a flight's are known (the capsule's C_D, L/D), flown by a
// fourth-order Runge–Kutta of their own through the game's Earth (entry-env.ts: the planner's).

type V = [number, number, number];
const add = (a: V, b: V, k = 1): V => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.hypot(...a);
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const D = Math.PI / 180;

test("the ISS a day on: within 5 km of SGP4 (its own error some km a day), 200 m in height (its drag, J2–J4, the Moon and the Sun)", () => {
  const t0 = gameTimeOf(issElements().epochMs);
  const s0 = issOrbit(t0)!;
  let X = s0.X,
    Vv = s0.V,
    t = t0;
  // (velocity Verlet at 4 s: the station's own propagation, iss.ts)
  const h = 4 / M_SECONDS;
  const acc = (Xq: V, Vq: V, tq: number) => lin(gravityHome(Xq, tq).acc, 1, dragAccel("earth", Xq, Vq, tq, ISS_BALLISTIC), 1);
  let a = acc(X, Vv, t);
  for (let i = 0; i < 86400 / 4; i++) {
    Vv = lin(Vv, 1, a, h / 2);
    X = lin(X, 1, Vv, h);
    t += h;
    a = acc(X, Vv, t);
    Vv = lin(Vv, 1, a, h / 2);
  }
  const ref = issOrbit(t)!;
  const E = solarState("earth", t);
  const d: V = [X[0] - ref.X[0], X[1] - ref.X[1], X[2] - ref.X[2]];
  const up = unit([ref.X[0] - E.pos[0], ref.X[1] - E.pos[1], ref.X[2] - E.pos[2]]);
  expect(len(d) * M_METRES).toBeLessThan(5000);
  expect(Math.abs(dot(d, up)) * M_METRES).toBeLessThan(200);
});

/** A point mass with a drag coefficient and a lift-to-drag ratio through the game's Earth, from h0 [m] at
 *  v0 [m/s] (inertial), γ0 [°], heading east at a latitude; the bank by a law. */
function entry(o: {
  m: number;
  A: number;
  CD: number;
  LD: number;
  h0: number;
  v0: number;
  g0: number;
  lat: number;
  bank: (vr: number, t: number) => number;
}) {
  const env = envOf({ universe: "ours", body: "earth", t: 109.6, massSolar: 1e8 })!;
  // (the pole: the axis the ground turns about)
  const a1 = env.ground([1, 0, 0]),
    a2 = env.ground([0, 1, 0]);
  const pole = unit([a2[2], -a1[2], a1[1]]);
  const xEq = unit(cross(pole, cross([1, 0, 0], pole)));
  const up = add(add([0, 0, 0], xEq, Math.cos(o.lat * D)), pole, Math.sin(o.lat * D));
  const east = unit(cross(pole, up));
  let x: V = add([0, 0, 0], up, env.R + o.h0);
  x = add(x, up, o.h0 - heightOf(env, x));
  let v: V = add(add([0, 0, 0], east, o.v0 * Math.cos(o.g0 * D)), up, o.v0 * Math.sin(o.g0 * D));
  let bank = 0;
  const acc = (xq: V, vq: V): V => {
    const air = airAt(env.atm, heightOf(env, xq));
    let ag = env.gravity(xq, vq);
    if (air.rho > 0) {
      const va = add(vq, env.ground(xq), -1);
      const s = len(va);
      const drag = (0.5 * air.rho * s * s * o.CD * o.A) / o.m;
      const vh = unit(va);
      const n0 = unit(add(unit(xq), vh, -dot(unit(xq), vh)));
      const lift = add(add([0, 0, 0], n0, Math.cos(bank)), cross(vh, n0), Math.sin(bank));
      ag = add(add(ag, vh, -drag), lift, drag * o.LD);
    }
    return ag;
  };
  const r = { gPeak: 0, dip: Infinity, skip: 0, mach: 30 };
  let phase = 0,
    t = 0;
  for (let i = 0; i < 40000 && r.mach > 2; i++) {
    const dt = 0.2;
    const k1v = acc(x, v),
      k2v = acc(add(x, v, dt / 2), add(v, k1v, dt / 2)),
      k3v = acc(add(x, add(v, k1v, dt / 2), dt / 2), add(v, k2v, dt / 2)),
      k4v = acc(add(x, add(v, k2v, dt / 2), dt), add(v, k3v, dt));
    const k2x = add(v, k1v, dt / 2),
      k3x = add(v, k2v, dt / 2),
      k4x = add(v, k3v, dt);
    x = [0, 1, 2].map((j) => x[j]! + (dt / 6) * (v[j]! + 2 * k2x[j]! + 2 * k3x[j]! + k4x[j]!)) as V;
    v = [0, 1, 2].map((j) => v[j]! + (dt / 6) * (k1v[j]! + 2 * k2v[j]! + 2 * k3v[j]! + k4v[j]!)) as V;
    t += dt;
    const hh = heightOf(env, x);
    const air = airAt(env.atm, hh);
    const s = len(add(v, env.ground(x), -1));
    r.gPeak = Math.max(r.gPeak, (0.5 * air.rho * s * s * o.CD * o.A * Math.hypot(1, o.LD)) / o.m / 9.80665);
    r.mach = air.rho > 0 ? s / air.a : 30;
    const vr = dot(unit(x), v);
    // (the first dip's bottom, then the skip's top)
    if (phase === 0 && vr > 0) (phase = 1), (r.dip = hh);
    else if (phase === 1 && vr < 0) (phase = 2), (r.skip = hh);
    bank = o.bank(vr, t);
    if (hh < 0) break;
  }
  return r;
}

test("Apollo 4's return: the dip to 35 mi, the skip back to 45 mi, a lunar return's g", () => {
  // (the command module: 5.4 t, 3.91 m across, C_D 1.29 and L/D 0.36 at its trim; from 76 mi at 24 974 mph,
  // 7.08° down — lift up into the dip, then rolled to 75° to hold the skip)
  const r = entry({
    m: 5400,
    A: 12.02,
    CD: 1.29,
    LD: 0.36,
    h0: 121.92e3,
    v0: 11164,
    g0: -7.077,
    lat: 25,
    bank: (vr, t) => (vr > 0 || t > 200 ? 75 * D : 0),
  });
  expect(Math.abs(r.dip - 56.3e3)).toBeLessThan(4e3);
  expect(Math.abs(r.skip - 72.4e3)).toBeLessThan(6e3);
  expect(r.gPeak).toBeGreaterThan(6);
  expect(r.gPeak).toBeLessThan(10);
});

/** A Falcon 9 (Full Thrust) ascent from Cape Canaveral, planar, the turning Earth's speed at the pad: a
 *  10 s rise, a pitch kick, a gravity turn on the first stage, the second held to 200 km until circular. */
function falcon9(payload: number) {
  const atm = solarBody("earth")!.atmosphere!;
  const MU = 3.986004418e14,
    R = 6378137,
    W = 7.2921159e-5,
    G0 = 9.80665,
    lat = 28.5 * D;
  // (SpaceX's figures: 9 Merlin 1D, 7 607 kN at sea level, 8 227 kN in vacuum, 311 s; an MVac, 981 kN, 348 s)
  const S1 = { dry: 25600, prop: 395700, Fvac: 8227e3, Fsl: 7607e3, Isp: 311 };
  const S2 = { dry: 3900, prop: 92670, Fvac: 981e3, Isp: 348 };
  let r = R,
    vt = W * R * Math.cos(lat),
    vr = 0,
    m = S1.dry + S1.prop + S2.dry + S2.prop + payload + 1900,
    prop = S1.prop,
    t = 0,
    stage = 1,
    fairing = true;
  let gLoss = 0,
    qMax = 0,
    qT = 0;
  const A = Math.PI * 1.83 ** 2,
    CD = 0.4,
    kick = 0.13,
    dt = 0.05;
  for (let i = 0; i < 20000; i++) {
    const h = r - R;
    const air = airAt(atm, h);
    const p = air.rho * 287.05 * air.T;
    const ut = vt - W * r * Math.cos(lat),
      sp = Math.max(Math.hypot(ut, vr), 1);
    const q = 0.5 * air.rho * sp * sp;
    if (q > qMax) (qMax = q), (qT = t);
    const g = MU / (r * r);
    let F: number, mdot: number, sinT: number;
    if (stage === 1) {
      // (the thrust in the air: the exit's area times the pressure taken off — engine.ts)
      F = S1.Fvac * pressureFactor(S1.Fsl / S1.Fvac, p);
      mdot = S1.Fvac / (S1.Isp * G0);
      sinT = t < 10 ? 1 : t < 20 ? Math.cos(kick * ((t - 10) / 10)) : vr / sp;
    } else {
      if (vt >= Math.sqrt(MU / r)) break;
      F = S2.Fvac;
      mdot = S2.Fvac / (S2.Isp * G0);
      const want = (200e3 - h) * 2e-4 - vr * 0.03 + g - (vt * vt) / r;
      sinT = Math.max(-0.5, Math.min(0.9, (want * m) / F));
    }
    const cosT = stage === 1 && t >= 20 ? ut / sp : Math.sqrt(1 - sinT * sinT);
    const drag = q * CD * A;
    const ar = (F * sinT - (drag * vr) / sp) / m,
      at = (F * cosT - (drag * ut) / sp) / m;
    vr += ((vt * vt) / r - g + ar) * dt;
    vt += ((-vr * vt) / r + at) * dt;
    r += vr * dt;
    gLoss += ((g * vr) / Math.hypot(vr, vt)) * dt;
    m -= mdot * dt;
    prop -= mdot * dt;
    t += dt;
    if (fairing && h > 110e3) (fairing = false), (m -= 1900);
    if (stage === 1 && prop <= 0) (stage = 2), (m -= S1.dry), (prop = S2.prop);
    else if (stage === 2 && prop <= 0) break;
  }
  const eps = (vt * vt + vr * vr) / 2 - MU / r;
  const a = -MU / (2 * eps);
  const e = Math.sqrt(Math.max(1 - (r * vt) ** 2 / (MU * a), 0));
  return { pe: a * (1 - e) - R, prop, qMax, qT, gLoss };
}

test("a Falcon 9 lifts its published 22.8 t to low orbit through the game's air — and not 14 % more", () => {
  const f = falcon9(22800);
  expect(f.pe).toBeGreaterThan(140e3);
  expect(f.prop).toBeGreaterThan(0);
  // (max-Q a minute in, some 30–45 kPa — the flights' ~32 kPa throttled back; gravity losses ~1 km/s)
  expect(f.qMax).toBeGreaterThan(30e3);
  expect(f.qMax).toBeLessThan(50e3);
  expect(f.qT).toBeGreaterThan(50);
  expect(f.qT).toBeLessThan(80);
  expect(f.gLoss).toBeGreaterThan(700);
  expect(f.gLoss).toBeLessThan(1500);
  expect(falcon9(26000).pe).toBeLessThan(140e3);
});

test("an orbit's energy over three days in the predictor: its mean size kept to metres (the Moon's and the Sun's pulls make it breathe)", () => {
  const t0 = 109.6;
  const s = earthStart(t0, 1500);
  const p = predictOurs(s.X, s.vel, t0, [], { tMax: (3 * 86400) / M_SECONDS, maxSteps: 1e6 });
  expect(p.fate).toBe("continues");
  const mu = solarBody("earth")!.mass;
  // (the semi-major axis averaged over the first and the last of the days: the periodic terms out)
  const mean = (d: number) => {
    let s = 0,
      n = 0;
    for (let i = 0; i < p.pts.length; i++) {
      const t = p.times[i]!;
      if (Math.floor(((t - t0) * M_SECONDS) / 86400) !== d) continue;
      const E = solarState("earth", t);
      const r = p.pts[i]!.map((x, k) => x - E.pos[k]!) as V;
      const v = p.vels[i]!.map((x, k) => x - E.vel[k]!) as V;
      s += -mu / (2 * (dot(v, v) / 2 - mu / len(r)));
      n++;
    }
    return s / n;
  };
  expect(Math.abs(mean(2) - mean(0)) * M_METRES).toBeLessThan(15);
}, 30_000);
