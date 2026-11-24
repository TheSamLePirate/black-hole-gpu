// Mission planner for Lagrange points (Halo orbit insertion like JWST, direct libration point
// insertion, or flyby) and JWST rendezvous in our solar system's full N-body gravity (predictOurs).
//
// Physics:
//  - Computes the exact target arrival state at tArrive:
//      • "halo": 3rd-order Richardson Halo orbit (differentially corrected in N-body when needed)
//      • "station": exact Lagrange point state (r_L, v_L) — ideal for stable L4/L5 or tight L1–L3 hold
//      • "flyby": passes through the Lagrange point / Halo point with no insertion burn
//      • "jwst": 200 m standoff beside JWST on its Sun–Earth L2 Southern Halo orbit
//  - Generates a smart physical first-guess transfer:
//      • From Earth LEO to Sun–Earth L1/L2 (or JWST): Ariane-5 / JWST-style high-energy transfer ellipse
//        (≈ 3.18 km/s from 400 km LEO, ~28–32 day flight time) phased along the parking orbit!
//      • From Earth LEO to Earth–Moon L1–L5: trans-lunar transfer ellipse (~3.5–5 days)!
//      • From any planetary orbit or heliocentric space to any Lagrange point: Lambert + patched escape!
//  - Refines the departure burn (t, dv) via Levenberg–Marquardt directly on the full N-body predictor
//    `predictOurs`, adds a mid-course correction (`mcc`) re-aimed in flight, and an insertion burn
//    (`capture`) that matches the exact Halo/Lagrange velocity and hands over to the Halo orbit autopilot!

import type { Vec3 } from "../physics";
import { add, cross, dot, len as norm, scale, sub, unit } from "../math/vec3";
import { C_MPS, M_METRES, M_SECONDS } from "../units";
import { solarBody, solarState } from "./solar";
import { referenceBody } from "./our-side";
import { nodeDvComponents, predictOurs, type OurPath } from "./our-predict";
import {
  coastOrbit,
  elementsOf,
  lambert,
  stateAt,
  type OurGoal,
  type OurMission,
  type OurPlanResult,
  type PlanNode,
  type PlanOptions,
} from "./our-plan";
import { haloAzOf, haloPhase0At, haloState, isLagrangeId, lagrangeName, lagrangeState, parseLagrangeId } from "./lagrange";
import { JWST_HALO, jwstAxes, jwstOrbit } from "./jwst";

const C = C_MPS;
const MS = 1 / C;
const KM = 1e3 / M_METRES;
const DAY = 86400 / M_SECONDS;

const kms = (v: number) => (v * C >= 1000 ? `${((v * C) / 1000).toFixed(2)} km/s` : `${(v * C).toFixed(0)} m/s`);
const days = (dt: number) => (dt >= 2 * DAY ? `${(dt / DAY).toFixed(1)} d` : `${(dt / (DAY / 24)).toFixed(1)} h`);
const kmTxt = (m: number) => `${Math.round(m / 1e3).toLocaleString("en")} km`;

export interface LagrangeArrivalState {
  pos: Vec3;
  vel: Vec3;
  /** Halo amplitude [m] when arrival === "halo" (or JWST) */
  azM: number;
  /** Halo phase0 [rad] */
  phase0: number;
  branch: 1 | -1;
}

/** Exact target arrival state (pos, vel) at time t [M] for a Lagrange point or JWST. */
export function lagrangeGoalState(
  target: string,
  arrival: string,
  altM: number,
  t: number,
  phase0 = 0,
  branch: 1 | -1 = -1,
): LagrangeArrivalState | null {
  if (target === "jwst") {
    const st = jwstOrbit(t);
    if (!st) return null;
    // 200 m standoff on JWST's mirror side (+X, +Y, +Z: the boresight is +Z — the secondary mirror stands in front of
    // the primary along it, jwst.ts jwstAxes —; until 2026-11-24 −Z put the arrival behind the primary)
    const A = jwstAxes(st.X, st.V, t);
    const off = scale(unit(add(add(scale(A[0], 0.55), A[1], 0.35), A[2], 0.76)), 200 / M_METRES);
    return { pos: add(st.X, off), vel: st.V, azM: JWST_HALO.azM, phase0: JWST_HALO.phase0, branch: JWST_HALO.branch };
  }
  if (!isLagrangeId(target)) return null;
  if (arrival === "halo" || arrival === "orbit") {
    const azM = haloAzOf(target, altM).azM;
    const h = haloState(target, t, { azM, branch, phase0 });
    if (!h) return null;
    return { pos: h.pos, vel: h.vel, azM, phase0, branch };
  }
  const L = lagrangeState(target, t);
  if (!L) return null;
  return { pos: L.pos, vel: L.vel, azM: 0, phase0: 0, branch: -1 };
}

/** Solves a 3×3 or n×m linear system via Gaussian elimination with partial pivoting. */
function gauss(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-300) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** Levenberg–Marquardt solver for N-body position targeting residuals(x) = 0. */
function solveLM(
  goals: (x: number[]) => number[] | null,
  x0: number[],
  step: number[],
  tol: number[],
  maxIt = 12,
): { x: number[]; r: number[]; ok: boolean } | null {
  let x = x0.slice();
  let r = goals(x);
  if (!r) return null;
  const cost = (q: number[]) => q.reduce((a, v, i) => a + (v / tol[i]!) ** 2, 0);
  let mu = 0;
  for (let it = 0; it < maxIt; it++) {
    if (r.every((v, i) => Math.abs(v) < tol[i]!)) return { x, r, ok: true };
    const m = r.length,
      n = x.length;
    const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const xp = x.slice();
      xp[j] = xp[j]! + step[j]!;
      const rp = goals(xp);
      if (!rp) return { x, r, ok: false };
      for (let i = 0; i < m; i++) J[i]![j] = (rp[i]! - r[i]!) / tol[i]!;
    }
    const rs = r.map((v, i) => v / tol[i]!);
    const JJ = Array.from({ length: m }, (_, a) =>
      Array.from({ length: m }, (_, b) => J[a]!.reduce((s, _v, k) => s + J[a]![k]! * J[b]![k]!, 0)),
    );
    const scale0 = Math.max(...JJ.map((row, a) => row[a]!), 1e-300);
    if (!(mu > 0)) mu = 1e-8 * scale0;
    const c0 = cost(r);
    let done = false;
    for (let k = 0; k < 10; k++) {
      const y = gauss(
        JJ.map((row, a) => row.map((v, b) => v + (a === b ? mu : 0))),
        rs,
      );
      if (y) {
        const dx = Array.from({ length: n }, (_, q) => -J.reduce((s, row, i) => s + row[q]! * y[i]!, 0) * step[q]!);
        const xn = x.map((v, i) => v + dx[i]!);
        const rn = goals(xn);
        if (rn && cost(rn) < c0) {
          x = xn;
          r = rn;
          done = true;
          mu = Math.max(mu / 3, 1e-12 * scale0);
          break;
        }
      }
      mu *= 10;
    }
    if (!done) return { x, r, ok: false };
  }
  return { x, r, ok: r.every((v, i) => Math.abs(v) < tol[i]!) };
}

/**
 * First-guess departure burn (t1, dv0, tArrive) from a parking orbit or free space to a Lagrange
 * arrival state (Halo point, fixed L-point, or JWST).
 */
function firstGuessLagrange(
  X: Vec3,
  V: Vec3,
  t: number,
  home: string,
  target: string,
  arrival: string,
  altM: number,
  o: PlanOptions,
): { t1: number; dv0: Vec3; tArrive: number; phase0: number; azM: number } | null {
  const isJwst = target === "jwst";
  const parsed = isJwst ? { primary: "sun", secondary: "earth", index: 2 as const } : parseLagrangeId(target);
  if (!parsed) return null;

  const hb = solarBody(home)!;
  const h0 = solarState(home, t);
  const r0 = sub(X, h0.pos);
  const v0 = sub(V, h0.vel);
  const el = elementsOf(hb.mass, r0, v0);
  const inParking = home !== "sun" && el.e < 0.7 && Number.isFinite(el.period);

  // Determine natural transfer duration (TOF)
  let tof: number;
  if (home === parsed.secondary && parsed.index <= 2) {
    // E.g. Earth orbit -> Sun–Earth L1/L2 (JWST: ~29 days) or Moon orbit -> Earth–Moon L1/L2 (~2 days)
    const L0 = lagrangeState(isJwst ? "lag:earth:2" : target, t)!;
    const dist = L0.distSecondary;
    const aGuess = (norm(r0) + dist) / 2;
    tof = Math.min(Math.max(Math.PI * Math.sqrt(aGuess ** 3 / hb.mass) * 1.1, 0.4 * DAY), 60 * DAY);
    if (parsed.secondary === "earth" && parsed.primary === "sun") tof = 29 * DAY;
  } else if (home === parsed.primary) {
    // E.g. Earth orbit -> Earth–Moon L1..L5 (~4.2 days) or Sun orbit -> Sun–Earth L2
    const L0 = lagrangeState(isJwst ? "lag:earth:2" : target, t)!;
    const dist = norm(sub(L0.pos, h0.pos));
    const aGuess = (norm(r0) + dist) / 2;
    tof = Math.PI * Math.sqrt(aGuess ** 3 / hb.mass);
    if (home === "earth" && parsed.secondary === "moon") tof = 4.2 * DAY;
  } else {
    // Interplanetary / cross-system (e.g. Earth -> Sun–Mars L2, Earth -> Sun–Earth L4/L5)
    const sun = solarBody("sun")!;
    const pStart = sub(solarState(home, t).pos, solarState("sun", t).pos);
    const g0 = lagrangeGoalState(target, arrival, altM, t)!;
    const pEnd = sub(g0.pos, solarState("sun", t).pos);
    const aT = (norm(pStart) + norm(pEnd)) / 2;
    const hohTof = Math.PI * Math.sqrt(aT ** 3 / sun.mass);
    // For co-orbital Sun–Earth L3/L4/L5 (same a as Earth!), use a phased 180–300 day transfer
    if (parsed.secondary === home && parsed.index >= 3) {
      tof = parsed.index === 3 ? 210 * DAY : 150 * DAY;
    } else {
      tof = Math.min(Math.max(hohTof * 0.9, 15 * DAY), 900 * DAY);
    }
  }

  // The orbit's amplitude (the one asked, else the point's own — as flown: within the model's range, haloAzOf) and its
  // phase at the arrival
  const tArr0 = t + o.lead + tof;
  const haloArrival = !isJwst && (arrival === "halo" || arrival === "orbit");
  const azM = isJwst ? JWST_HALO.azM : haloArrival ? haloAzOf(target, altM).azM : 0;

  // Case 1: Local transfer within home's gravity well (Earth -> SE-L1/L2/JWST, Earth -> EM-L1..L5, Moon -> EM-L1/L2)
  const local = home === parsed.primary || (home === parsed.secondary && parsed.index <= 2);
  if (local && inParking) {
    // Scan one parking orbit for the departure whose two-body Lambert arc (around `home`, `tof`) reaches the arrival
    // point the cheapest: its departure burn plus its velocity left to match at the arrival (the insertion's)
    const period = el.period;
    const nScan = 48;
    const scan = (phase0: number) => {
      const goalAt = (ta: number) => lagrangeGoalState(target, arrival, azM, ta, phase0, -1)!;
      const tgt = goalAt(tArr0);
      const hArr = solarState(home, tArr0);
      const targetDir = unit(sub(tgt.pos, hArr.pos));
      const targetDist = norm(sub(tgt.pos, hArr.pos));
      let bestT1 = t + o.lead;
      let bestDv: Vec3 = [0, 0, 0];
      let bestScore = Infinity;
      for (let k = 0; k <= nScan; k++) {
        const tk = t + o.lead + (period * k) / nScan;
        const st = coastOrbit(home, hb.mass, r0, v0, tk - t, t);
        const hk = solarState(home, tk);
        const Xk = add(hk.pos, st.r);
        const Vk = add(hk.vel, st.v);
        const rMag = norm(st.r);
        // Departure apsis is opposite to targetDir (periapsis on the far side from L2/Moon!)
        // Use Lambert around `home` from st.r to targetVec in tof!
        const gK = goalAt(tk + tof);
        const hKArr = solarState(home, tk + tof);
        const r2 = sub(gK.pos, hKArr.pos);
        const orbN = unit(cross(st.r, st.v));
        const lam = lambert(hb.mass, st.r, r2, tof, orbN);
        if (lam) {
          const dvHome = sub(lam.v1, st.v);
          const dvMag = norm(dvHome);
          // Penalize dives into the planet
          const elL = elementsOf(hb.mass, st.r, lam.v1);
          const pen = elL.rp < hb.radius * 1.01 ? 1e3 : 0;
          const ins = arrival === "flyby" ? 0 : norm(sub(add(hKArr.vel, lam.v2), gK.vel));
          const score = dvMag + ins + pen;
          if (score < bestScore) {
            bestScore = score;
            bestT1 = tk;
            bestDv = nodeDvComponents(Xk, Vk, tk, dvHome);
          }
        } else {
          // Fallback: analytical Hohmann-like tangential burn when r_hat ≈ -targetDir
          const align = dot(unit(st.r), targetDir);
          const aT = (rMag + targetDist) / 2;
          const vNeed = Math.sqrt(Math.max(hb.mass * (2 / rMag - 1 / aT), 0));
          const dvMag = Math.abs(vNeed - norm(st.v)) + (1 + align) * 0.01;
          if (dvMag < bestScore) {
            bestScore = dvMag;
            bestT1 = tk;
            bestDv = [vNeed - norm(st.v), 0, 0];
          }
        }
      }
      return { t1: bestT1, dv0: bestDv, tArrive: bestT1 + tof, phase0, azM, score: bestScore };
    };
    if (!(haloArrival && parsed.index <= 3)) return scan(isJwst ? JWST_HALO.phase0 : 0);
    // A Halo arrival: the arrival's phase chosen too — the orbit's clock runs with the pair's synodic angle, so each
    // phase τ at tArr0 has its phase0 (haloPhase0At); twelve tried, the cheapest kept (from LEO to Sun–Earth L2 the
    // insertion where the transfer meets the loop: ≈ 3.3 km/s + 0.4 km/s, against 6.7 + 0.5 at the x–z crossing)
    let best: ReturnType<typeof scan> | null = null;
    for (let k = 0; k < 12; k++) {
      const s = scan(haloPhase0At(target, tArr0, (k / 12) * 2 * Math.PI, { azM, branch: -1 }));
      if (!best || s.score < best.score) best = s;
    }
    return best!;
  }
  const phase0 = isJwst ? JWST_HALO.phase0 : haloArrival && parsed.index <= 3 ? haloPhase0At(target, tArr0, 0, { azM, branch: -1 }) : 0;

  // Case 2: Heliocentric or non-parking transfer — direct Lambert around the dominant central body
  const central = home === "sun" || !local ? "sun" : home;
  const cb = solarBody(central)!;
  const t1 = t + o.lead;
  const c1 = solarState(central, t1);
  const c2 = solarState(central, t1 + tof);
  const free = predictOurs(X, V, t, [], { tMax: o.lead * 1.15 + 1e-4, maxSteps: 8000, mouthR: o.mouthR });
  const s1 = stateAt(free, t1) ?? { X, V };
  const gArr = lagrangeGoalState(target, arrival, azM, t1 + tof, phase0, -1)!;
  const r1 = sub(s1.X, c1.pos);
  const r2 = sub(gArr.pos, c2.pos);
  const nRef = norm(cross(r1, sub(s1.V, c1.vel))) > 1e-25 ? unit(cross(r1, sub(s1.V, c1.vel))) : ([0, 0, 1] as Vec3);

  // If leaving a planet's parking orbit for a heliocentric Lagrange point (e.g. Earth -> Mars L2 or Earth -> SE-L4)
  if (inParking && central === "sun") {
    const pStart = sub(solarState(home, t1).pos, c1.pos);
    const vHomeHelio = sub(solarState(home, t1).vel, c1.vel);
    const lam = lambert(cb.mass, pStart, r2, tof, [0, 0, 1]);
    if (!lam) return null;
    const vinf = sub(lam.v1, vHomeHelio);
    const vinfMag = norm(vinf);
    const vinfDir = unit(vinf);
    // Scan parking orbit for hyperbola departure whose outgoing asymptote aligns with vinfDir
    const period = el.period;
    let bestT1 = t1;
    let bestDv: Vec3 = [0, 0, 0];
    let bestMis = Infinity;
    for (let k = 0; k <= 48; k++) {
      const tk = t + o.lead + (period * k) / 48;
      const st = coastOrbit(home, hb.mass, r0, v0, tk - t, t);
      const rm = norm(st.r);
      const vp = Math.sqrt(vinfMag * vinfMag + (2 * hb.mass) / rm);
      const hDir = unit(cross(st.r, st.v));
      const tang = unit(cross(hDir, st.r));
      const vEsc = scale(tang, vp);
      const eHyp = 1 + (rm * vinfMag * vinfMag) / hb.mass;
      const turn = Math.acos(Math.min(1, Math.max(-1, -1 / eHyp)));
      // Outgoing asymptote direction
      const asym = unit(add(scale(unit(st.r), Math.cos(turn)), tang, Math.sin(turn)));
      const mis = norm(sub(asym, vinfDir));
      if (mis < bestMis) {
        bestMis = mis;
        bestT1 = tk;
        const hk = solarState(home, tk);
        bestDv = nodeDvComponents(add(hk.pos, st.r), add(hk.vel, st.v), tk, sub(vEsc, st.v));
      }
    }
    return { t1: bestT1, dv0: bestDv, tArrive: bestT1 + tof, phase0, azM };
  }

  const lam = lambert(cb.mass, r1, r2, tof, nRef);
  if (!lam) return null;
  const dvHome = sub(add(c1.vel, lam.v1), s1.V);
  const dv0 = nodeDvComponents(s1.X, s1.V, t1, dvHome);
  return { t1, dv0, tArrive: t1 + tof, phase0, azM };
}

/**
 * Aims a single burn (at tn, from X,V,t) in full N-body `predictOurs` so the spacecraft reaches the
 * target Lagrange arrival position at `tArrive`!
 */
function aimLagrangeBurn(
  X: Vec3,
  V: Vec3,
  t: number,
  tn: number,
  dv0: Vec3,
  target: string,
  arrival: string,
  azM: number,
  phase0: number,
  tArrive: number,
  o: PlanOptions,
  allowMoveTime = false,
  tolKm = 500,
): { t: number; dv: Vec3; path: OurPath; missKm: number; ok: boolean } | null {
  const goalPos = lagrangeGoalState(target, arrival, azM, tArrive, phase0, -1);
  if (!goalPos) return null;
  const tMax = Math.max(tArrive - t, 0) + 0.25 * DAY;
  const run = (dv: Vec3, tb: number) =>
    predictOurs(X, V, t, [{ t: tb, dv }], { tMax, maxSteps: 120000, mouthR: o.mouthR, accel: o.accel, step: 0.025 });

  const tol = [tolKm * KM, tolKm * KM, tolKm * KM];
  const x0 = allowMoveTime ? [dv0[0], dv0[1], dv0[2], 0] : [dv0[0], dv0[1], dv0[2]];
  const step = allowMoveTime ? [0.1 * MS, 0.1 * MS, 0.1 * MS, 10 / M_SECONDS] : [0.05 * MS, 0.05 * MS, 0.05 * MS];

  const residuals = (x: number[]): number[] | null => {
    const tb = allowMoveTime ? Math.max(t + o.lead * 0.5, tn + x[3]!) : tn;
    const p = run([x[0]!, x[1]!, x[2]!], tb);
    if (p.fate === "impact") return null;
    const st = stateAt(p, tArrive);
    if (!st) return null;
    return [st.X[0] - goalPos.pos[0], st.X[1] - goalPos.pos[1], st.X[2] - goalPos.pos[2]];
  };

  const res = solveLM(residuals, x0, step, tol, 14);
  if (!res) return null;
  const dv: Vec3 = [res.x[0]!, res.x[1]!, res.x[2]!];
  const tb = allowMoveTime ? Math.max(t + o.lead * 0.5, tn + res.x[3]!) : tn;
  const path = run(dv, tb);
  const missKm = (Math.hypot(res.r[0]!, res.r[1]!, res.r[2]!) * M_METRES) / 1e3;
  return { t: tb, dv, path, missKm, ok: res.ok };
}

/**
 * Plans a full N-body transfer to any Lagrange point (`lag:<sec>:<1..5>`) or JWST (`jwst`),
 * with Halo orbit insertion (JWST-style), direct libration-point insertion, or flyby!
 */
export function planLagrangeTransfer(X: Vec3, V: Vec3, t: number, goal: OurGoal, o: PlanOptions): OurPlanResult {
  const target = goal.target;
  const isJwst = target === "jwst";
  if (!isJwst && !isLagrangeId(target)) return { error: `Unknown Lagrange target: ${target}` };
  const home = referenceBody(X, t);
  const guess = firstGuessLagrange(X, V, t, home, target, goal.arrival, goal.altM, o);
  if (!guess) return { error: `Transfer: no trajectory to ${isJwst ? "JWST" : lagrangeName(target)} found` };

  const tolKm = isJwst ? 5 : goal.target.startsWith("lag:moon:") ? 50 : 500;
  // Aim departure burn in full N-body gravity
  let dep = aimLagrangeBurn(X, V, t, guess.t1, guess.dv0, target, goal.arrival, guess.azM, guess.phase0, guess.tArrive, o, true, tolKm);
  if (!dep) {
    // Fallback without time variable if LM hit a planet during time step
    dep = aimLagrangeBurn(X, V, t, guess.t1, guess.dv0, target, goal.arrival, guess.azM, guess.phase0, guess.tArrive, o, false, tolKm * 4);
  }
  if (!dep) return { error: `Transfer: N-body aim to ${isJwst ? "JWST" : lagrangeName(target)} did not converge` };

  const t1 = dep.t;
  const tArrive = guess.tArrive;
  const tMcc = t1 + 0.4 * (tArrive - t1);

  // Mid-course correction refinement (aimed from the post-departure state at tMcc)
  const sMcc = stateAt(dep.path, tMcc);
  let mccDv: Vec3 = [0, 0, 0];
  let fullPath = dep.path;
  if (sMcc && dep.missKm > (isJwst ? 0.5 : 10)) {
    const mcc = aimLagrangeBurn(
      sMcc.X,
      sMcc.V,
      tMcc,
      tMcc,
      [0, 0, 0],
      target,
      goal.arrival,
      guess.azM,
      guess.phase0,
      tArrive,
      o,
      false,
      isJwst ? 0.2 : 10,
    );
    if (mcc && norm(mcc.dv) < 500 * MS) {
      mccDv = mcc.dv;
      fullPath = predictOurs(
        X,
        V,
        t,
        [
          { t: t1, dv: dep.dv },
          { t: tMcc, dv: mccDv },
        ],
        { tMax: tArrive - t + 0.5 * DAY, maxSteps: 120000, mouthR: o.mouthR, accel: o.accel, step: 0.025 },
      );
    }
  }

  // Insertion burn at arrival to match the exact Halo orbit velocity (or L-point / JWST velocity)
  const sArr = stateAt(fullPath, tArrive);
  const gArr = lagrangeGoalState(target, goal.arrival, guess.azM, tArrive, guess.phase0, -1)!;
  const nodes: PlanNode[] = [
    { t: t1, dv: dep.dv, role: "depart" },
    { t: tMcc, dv: mccDv, role: "mcc" },
  ];

  const isFlyby = goal.arrival === "flyby";
  const labelName = isJwst ? "JWST" : lagrangeName(target);
  let note = `${kms(norm(dep.dv))} burn in ${days(t1 - t)} · ${labelName} at +${days(tArrive - t1)}`;

  if (!isFlyby && sArr) {
    const dvInsertHome = sub(gArr.vel, sArr.V);
    const dvInsert = nodeDvComponents(sArr.X, sArr.V, tArrive, dvInsertHome);
    const thenMode = isJwst ? "keep" : goal.arrival === "station" ? "keep" : "orbit";
    nodes.push({ t: tArrive, dv: dvInsert, role: "capture", body: target, then: thenMode as PlanNode["then"] });
    note += ` · ${isJwst ? "rendezvous" : goal.arrival === "station" ? "insertion" : "Halo insertion"} ${kms(norm(dvInsert))}`;
    // (the amplitude flown, said — and the one asked when the model's range changed it: never silently)
    if (!isJwst && goal.arrival !== "station") {
      const A = haloAzOf(target, goal.altM);
      note += ` · A_z ${kmTxt(A.azM)}`;
      if (A.clamped) note += ` (asked ${kmTxt(goal.altM)}: valid ${kmTxt(A.minM)}–${kmTxt(A.maxM)})`;
    }
  } else {
    nodes.push({ t: tArrive, dv: [0, 0, 0], role: "arrive", body: target });
  }

  // Predict the full mission including 10–30 days of post-insertion Halo orbit coast so the 3D map shows the Halo arc!
  const postCoast = isFlyby ? 1 * DAY : target.startsWith("lag:moon:") ? 7 * DAY : 25 * DAY;
  const finalPath = predictOurs(
    X,
    V,
    t,
    nodes.map((n) => ({ t: n.t, dv: n.dv })),
    { tMax: tArrive - t + postCoast, maxSteps: 120000, mouthR: o.mouthR, accel: o.accel, step: 0.025 },
  );

  const mission: OurMission = {
    goal: { ...goal, altM: guess.azM },
    home,
    type: "lagrange",
    bDir: [1, 0],
    tEnd: tArrive + postCoast,
    tArrive,
    haloPhase0: guess.phase0,
    haloBranch: -1,
  };

  return { nodes, mission, note, path: finalPath };
}

/**
 * In-flight re-aiming for Lagrange / JWST missions (called from refineOurNode):
 *  - `depart`: re-aims departure onto exact arrival state at m.tArrive
 *  - `mcc`: re-aims mid-course correction in full N-body to hit arrival within kilometres (or drops if < 5 cm/s)
 *  - `capture`: recomputes the exact Halo / Lagrange / JWST velocity-matching insertion burn at m.tArrive
 */
export function refineLagrangeNode(X: Vec3, V: Vec3, t: number, m: OurMission, node: PlanNode, o: PlanOptions): PlanNode | null {
  const target = m.goal.target;
  const azM = m.goal.altM;
  const phase0 = m.haloPhase0 ?? 0;
  const branch = m.haloBranch ?? -1;
  const tArrive = m.tArrive;

  if (node.role === "arrive") {
    return { ...node, t: Math.max(tArrive, t + o.lead), dv: [0, 0, 0] };
  }

  if (node.role === "capture") {
    const tt = Math.max(tArrive, t + o.lead);
    const p = predictOurs(X, V, t, [], { tMax: tt - t + 0.1 * DAY, maxSteps: 60000, mouthR: o.mouthR, accel: o.accel });
    const st = stateAt(p, tt) ?? { X: p.pts[p.pts.length - 1]!, V: p.vels[p.vels.length - 1]! };
    const gArr = lagrangeGoalState(target, m.goal.arrival, azM, tt, phase0, branch);
    if (!gArr) return node;
    const dv = nodeDvComponents(st.X, st.V, tt, sub(gArr.vel, st.V));
    return { ...node, t: tt, dv };
  }

  // depart or mcc
  const tn = Math.max(node.t, t + o.lead);
  const tolKm = target === "jwst" ? 0.5 : 20;
  const res = aimLagrangeBurn(
    X,
    V,
    t,
    tn,
    node.role === "depart" ? node.dv : [0, 0, 0],
    target,
    m.goal.arrival,
    azM,
    phase0,
    tArrive,
    o,
    node.role === "depart",
    tolKm,
  );
  if (!res) return { ...node, t: tn };
  if (node.role === "mcc" && norm(res.dv) < 0.05 * MS) return res.ok ? null : { ...node, t: tn };
  if (node.role === "mcc" && norm(res.dv) > 800 * MS) return { ...node, t: tn };
  return { ...node, t: res.t, dv: res.dv, aim: { ok: res.ok, passKm: res.missKm } };
}
