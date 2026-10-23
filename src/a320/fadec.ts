// The A320's engines and their FADEC (docs/PLAN-A320.md, A3): two CFM56-5B4/P as FlightGear's A320-family has them —
// the thrust limits by pressure altitude, total air temperature and Mach (TOGA, FLEX, MCT, CLB, IDLE, the maximum
// reverse: N1 tables, Systems/a320-cfm56-5b4-engine-fadec.xml), the thrust levers' detents and the N1 each asks
// between them, N1 spooling at JSBSim's rates (Engines/cfm56-5b4_1.xml N1SpoolUp), the thrust at that N1 (JSBSim's
// FGTurbine: idle + (military − idle) × the N1's share², the FADEC's rated-thrust correction), the reversers, the fuel
// flow (thrust × TSFC, the idle's floor), N2 and EGT. Pure.

import { FDM } from "./fdm-data";
import { type Bag, evaluate, type Expr } from "./jsbsim";

const E = FDM.engine as Record<string, number> & Record<string, Expr>;
const MIL_LBF = E.milthrust as unknown as number;
const TSFC = E.tsfc as unknown as number;
const IDLE_N1 = E.idlen1 as unknown as number;
const IDLE_N2 = E.idlen2 as unknown as number;
const MAX_N1 = E.maxn1 as unknown as number;
const MAX_N2 = E.maxn2 as unknown as number;
const LBF = 4.4482216;
const LB = 0.45359237;
/** the detents on the lever's travel 0…1 (A320-main.xml): IDLE, CL, FLX/MCT, TOGA */
export const DETENT = FDM.detents as {
  "idle-t": number;
  "climb-b": number;
  "climb-t": number;
  "mct-b": number;
  "mct-t": number;
  "toga-b": number;
};

/** What the FADEC limits the N1 to now [%]. */
export interface Limits {
  toga: number;
  flex: number;
  mct: number;
  clb: number;
  idle: number;
  mrev: number;
}

/** The air the engines breathe: pressure altitude [ft], density altitude [ft], total air temperature [°C], Mach;
 *  on the ground (the idle's own), the flap lever (approach idle). */
export interface EngineAir {
  altFt: number;
  densFt: number;
  tatC: number;
  mach: number;
  onGround: boolean;
  flapLever: number;
}

const round1 = (x: number) => Math.floor(x * 10 + 0.5) / 10;

function bagOf(a: EngineAir, flexTemp: number | null): Bag {
  return {
    "position/altitude-ft": a.altFt,
    "atmosphere/density-altitude": a.densFt,
    "propulsion/tat-c": a.tatC,
    "velocities/mach": a.mach,
    "gear/unit[0]/WOW": a.onGround ? 1 : 0,
    "controls/flight/flaps-input": a.flapLever,
    "systems/fadec/limit/flex-temp-input": flexTemp ?? -99,
  };
}

/** The FADEC's limits for the air (a FLEX temperature [°C] set: its take-off thrust — never more than TOGA's). */
export function limits(a: EngineAir, flexTemp: number | null = null): Limits {
  const b = bagOf(a, null);
  const F = FDM.fadec;
  const toga = evaluate(F["toga-table"]!, b);
  b["systems/fadec/limit/toga-table"] = toga;
  let flex = toga;
  if (flexTemp !== null) {
    // (the flex table read at (the rated temperature − the flex temperature) + TAT: FlightGear's summer)
    const rated = 30;
    b["systems/fadec/limit/flex-temp-input"] = rated - flexTemp + a.tatC;
    flex = Math.min(toga, evaluate(F["flex-table"]!, b));
  }
  return {
    toga: round1(toga),
    flex: round1(flex),
    mct: round1(evaluate(F["mct-table"]!, b)),
    clb: round1(evaluate(F["climb-table"]!, b)),
    idle: Math.max(round1(evaluate(F["idle-table"]!, b)), IDLE_N1),
    mrev: round1(evaluate(F["mrev-table"]!, b)),
  };
}

/** The lever's detent there: 0 idle, 1 manual (idle–CL), 2 CL, 3 manual (CL–MCT), 4 FLX/MCT, 5 manual (MCT–TOGA), 6 TOGA. */
export function detentOf(lever: number): number {
  const d = DETENT;
  return lever >= d["toga-b"]
    ? 6
    : lever > d["mct-t"]
      ? 5
      : lever >= d["mct-b"]
        ? 4
        : lever > d["climb-t"]
          ? 3
          : lever >= d["climb-b"]
            ? 2
            : lever > d["idle-t"]
              ? 1
              : 0;
}
/** The lever's angle [°] for a position (0 idle, 25 CL, 35 FLX/MCT, 45 TOGA). */
export function leverAngle(lever: number): number {
  const d = DETENT;
  const k = detentOf(lever);
  const lin = (a: number, b: number, x0: number, x1: number) => a + ((Math.min(Math.max(lever, x0), x1) - x0) / (x1 - x0)) * (b - a);
  return [
    0,
    lin(2, 23, d["idle-t"], d["climb-b"]),
    25,
    lin(27, 33, d["climb-t"], d["mct-b"]),
    35,
    lin(37, 43, d["mct-t"], d["toga-b"]),
    45,
  ][k]!;
}

/** The N1 the lever asks (FlightGear's control channel: idle to CL, CL to MCT — or FLEX —, MCT to TOGA). */
export function leverN1(lever: number, L: Limits, flex = false): number {
  const d = DETENT;
  const mct = flex ? L.flex : L.mct;
  const lin = (a: number, b: number, x0: number, x1: number) =>
    Math.min(Math.max(a + ((lever - x0) * (b - a)) / (x1 - x0), Math.min(a, b)), Math.max(a, b));
  if (lever > d["mct-t"]) return lin(mct, L.toga, d["mct-t"], d["toga-b"]);
  if (lever > d["climb-t"]) return lin(L.clb, mct, d["climb-t"], d["mct-b"]);
  return lin(Math.max(L.idle, IDLE_N1), L.clb, d["idle-t"], d["climb-b"]);
}

/** One engine's state. */
export interface Engine {
  /** running (lit), its N1 and N2 [%], EGT [°C], fuel flow [kg/s], thrust [N] (< 0 reversed), the reverser's doors 0…1;
   *  starting (the fuel lit, spooling up to idle) */
  running: boolean;
  starting?: boolean;
  /** flamed out by a failure (failures.ts): no relight until its MASTER is cycled — OFF, then ON */
  flamedOut?: boolean;
  n1: number;
  n2: number;
  egt: number;
  ff: number;
  thrust: number;
  rev: number;
}

/** FlightGear's EGT over the total air's temperature [°C] by N2 [%] at sea level and at 50 000 ft of density altitude
 *  (a320-cfm56-5b4-engine-fadec.xml egt-cmd, the engine running) */
const EGT_N2 = [10, 45, 50, 59.4, 105];
const EGT_SL = [0, 390, 385, 330, 650];
const EGT_HI = [0, 345, 340, 290, 550];
export function egtTable(n2: number, densFt: number): number {
  const x = Math.min(Math.max(n2, EGT_N2[0]!), EGT_N2.at(-1)!);
  let k = 0;
  while (k < EGT_N2.length - 2 && x > EGT_N2[k + 1]!) k++;
  const u = (x - EGT_N2[k]!) / (EGT_N2[k + 1]! - EGT_N2[k]!);
  const at = (t: number[]) => t[k]! + (t[k + 1]! - t[k]!) * u;
  const h = Math.min(Math.max(densFt / 50_000, 0), 1);
  return at(EGT_SL) + (at(EGT_HI) - at(EGT_SL)) * h;
}

export const newEngine = (running = true): Engine => ({
  running,
  n1: running ? IDLE_N1 : 0,
  n2: running ? IDLE_N2 : 0,
  egt: running ? 345 : 15,
  ff: 0,
  thrust: 0,
  rev: 0,
});

/** JSBSim's spool rates by N1 [%/s] (N1SpoolUp, N2SpoolUp — FlightGear's: slow from idle, quick at high power), ×1.6:
 *  FlightGear's took 13 s from ground idle to take-off power, the CFM56's certified acceleration some 8 */
const SPOOL_K = 1.6;
const spool1 = (n1: number) =>
  SPOOL_K * evaluate(E.N1SpoolUp as Expr, { "propulsion/engine[0]/n1": n1, "systems/acconfig/autoconfig-running": 0 });
const spool2 = (n1: number) =>
  SPOOL_K * evaluate(E.N2SpoolUp as Expr, { "engines/engine[0]/n1": n1, "systems/acconfig/autoconfig-running": 0 });
const N1F = MAX_N1 - IDLE_N1;
const N2F = MAX_N2 - IDLE_N2;

/**
 * The thrust at an N2 [N] (FGTurbine: idle + (military − idle) × the military table × N2's share², the military
 * thrust's table corrected by the FADEC to give the rated thrust at the rated N1; the reversers' doors take 35 % off).
 */
export function thrustAt(n2: number, a: EngineAir, rev = 0): number {
  const b = bagOf(a, null);
  const idleShare = evaluate(E.IdleThrust as Expr, { "velocities/mach": a.mach, "atmosphere/density-altitude": a.densFt });
  const milShare = evaluate(FDM.fadec["milthrust-density"]!, b);
  const ratedN1 = evaluate(FDM.fadec["rated-thrust-n1"]!, b);
  const noDens = evaluate(FDM.fadec["milthrust-no-density"]!, b);
  const nR = Math.max((ratedN1 - IDLE_N1) / N1F, 0);
  // (FlightGear's rated-thrust-factor: rated-thrust-target / rated-thrust-actual)
  const target = idleShare + (1 - idleShare) * noDens;
  const actual = idleShare + (1 - idleShare) * milShare * nR * nR;
  const factor = actual !== 0 ? target / actual : 1;
  const idle = MIL_LBF * idleShare;
  const n = Math.max((n2 - IDLE_N2) / N2F, 0);
  const revK = rev > 0.01 ? 1 - 0.35 * Math.min(rev, 1) : 1;
  return (idle + (MIL_LBF - idle) * milShare * factor * n * n) * revK * LBF;
}
/** the N2 that holds an N1 (both seek the throttle's share of their range: JSBSim's) */
export const n2Of = (n1: number) => IDLE_N2 + ((n1 - IDLE_N1) * N2F) / N1F;

/**
 * One engine over dt [s]: its N1 and N2 towards what the lever asks (reverse: the reverse lever's share of the maximum
 * reverse N1, once the doors are open), its doors, its thrust (reversed: its reverse flow's share against the motion),
 * EGT, its fuel flow.
 */
/** The engine's start and stop (FGTurbine's phases): the starter (its air valve open) and the fuel's cutoff, as
 *  FlightGear's ignition system sets them (Systems/a320-ignition.xml: systems/ignition/starter-jsb-1, cutoff-jsb-1). */
export interface EngineCtl {
  starter: boolean;
  cutoff: boolean;
  /** a failure (failures.ts): flamed out — windmilling, relit once cleared and its MASTER cycled —, seized — its spools
   *  stopped */
  failed?: boolean;
  seized?: boolean;
}

const START = {
  ignN1: E.ignitionn1 as unknown as number,
  ignN2: E.ignitionn2 as unknown as number,
  spinN1: E.n1spinup as unknown as number,
  spinN2: E.n2spinup as unknown as number,
  rateN1: E.n1startrate as unknown as number,
  rateN2: E.n2startrate as unknown as number,
};

export function stepEngine(e: Engine, want: { n1: number; reverse: number }, a: EngineAir, dt: number, ctl?: EngineCtl): Engine {
  const out = { ...e };
  const seekTo = (x: number, to: number, up: number, down: number) => (x < to ? Math.min(x + up * dt, to) : Math.max(x - down * dt, to));
  // (the fuel cut: the engine stops — spooling down —; a start: FGTurbine's — the starter spins N2 to its ignition's 28.5 %,
  // the fuel lit past 15 % of N2 then both spools up to idle at their start rates, the EGT up to TAT + 363 °C)
  if (ctl) {
    if (ctl.cutoff) {
      out.running = false;
      out.starting = false;
      out.flamedOut = false;
    }
    // (a failure: the flame out — or the core seized, the spools braked to a stop within seconds)
    if (ctl.failed || ctl.seized) {
      if (out.running || out.starting) out.flamedOut = true;
      out.running = false;
      out.starting = false;
    }
    if (ctl.seized) {
      out.n1 = Math.max(e.n1 - 25 * dt, 0);
      out.n2 = Math.max(e.n2 - 30 * dt, 0);
      out.thrust = 0;
      out.ff = 0;
      out.egt = e.egt + (Math.max(a.tatC, 15) - e.egt) * Math.min(dt / 20, 1);
      out.rev = Math.max(e.rev - dt / 2, 0);
      return out;
    }
    if (!out.running && !ctl.cutoff && !ctl.failed && !out.flamedOut && e.n2 > 15) {
      out.starting = true;
      out.n1 = seekTo(e.n1, IDLE_N1, START.rateN1, 1);
      out.n2 = seekTo(e.n2, IDLE_N2, START.rateN2, 1);
      // (the EGT's start peak — some 650 °C on a CFM56-5B, about 42 % of N2 —, then back to idle's: lit, it rises fast)
      const hump = 300 * Math.exp(-(((out.n2 - 42) / 11) ** 2));
      out.egt = seekTo(e.egt, a.tatC + 363.1 + hump, 50, 7.3);
      out.ff = ((107 * MIL_LBF ** 0.2 * LB) / 3600) * Math.min(e.n2 / IDLE_N2, 1);
      out.thrust = thrustAt(out.n2, a, 0) * Math.max((out.n2 - 40) / (IDLE_N2 - 40), 0);
      out.rev = Math.max(e.rev - dt / 2, 0);
      if (out.n2 >= IDLE_N2 - 0.05 && out.n1 >= IDLE_N1 - 0.05) {
        out.running = true;
        out.starting = false;
      }
      return out;
    } else if (!out.running && ctl.starter && !ctl.failed) {
      out.n1 = seekTo(e.n1, START.ignN1, START.spinN1, 1);
      out.n2 = seekTo(e.n2, START.ignN2, START.spinN2, 1);
      out.thrust = 0;
      out.ff = 0;
      out.egt = e.egt + (Math.max(a.tatC, 15) - e.egt) * Math.min(dt / 30, 1);
      return out;
    }
  }
  if (!out.running) {
    // (spooling down — windmilling in flight: N1 about 30 % of the Mach number, N2 some 40 % — 30 % of N2 at M 0.75,
    // enough for a windmill relight —; to rest on the ground)
    const wind = a.onGround ? 0 : a.mach;
    const mill = (x: number, w: number) => (x > w ? Math.max(x - 9.5 * dt, w) : Math.min(x + 2 * dt, w));
    out.n1 = mill(e.n1, wind * 30);
    out.n2 = mill(e.n2, wind * 40);
    out.thrust = 0;
    out.ff = 0;
    out.egt = e.egt + (Math.max(a.tatC, 15) - e.egt) * Math.min(dt / 30, 1);
    out.rev = Math.max(e.rev - dt / 2, 0);
    return out;
  }
  // (the doors: 2 s to open, the N1 kept at idle meanwhile)
  const revWanted = want.reverse > 0;
  out.rev = Math.min(Math.max(e.rev + (revWanted ? dt / 2 : -dt / 2), 0), 1);
  const target = revWanted ? (out.rev > 0.95 ? want.n1 : IDLE_N1) : out.rev > 0.05 ? IDLE_N1 : want.n1;
  const seek = (x: number, to: number, r: number) => (x < to ? Math.min(x + r * dt, to) : Math.max(x - r * dt, to));
  out.n1 = seek(e.n1, target, spool1(e.n1));
  out.n2 = seek(e.n2, n2Of(target), spool2(e.n1));
  const T = thrustAt(out.n2, a, out.rev);
  // (reversed: the fan's flow turned forward — some 45 % of the thrust against the motion at full reverse)
  out.thrust = out.rev > 0.05 ? -T * 0.45 * out.rev : T;
  // (the fuel: thrust × TSFC [lb/h], at least the idle's — FGTurbine's 107 × milthrust^0.2)
  const pph = Math.max(Math.abs(T / LBF) * TSFC, 107 * MIL_LBF ** 0.2);
  out.ff = (pph * LB) / 3600;
  // (EGT: FlightGear's FADEC's — Systems/a320-cfm56-5b4-engine-fadec.xml egt-cmd: the total air's temperature and a
  // table of N2 by the density altitude, eased by its lag (c1 0.35) —, the one its bleed's precoolers are set for)
  out.egt = e.egt + (a.tatC + egtTable(out.n2, a.densFt) - e.egt) * Math.min(dt * 0.35, 1);
  return out;
}

/** The FADEC's own figures: the idle N1, the maximum (for gauges). */
export const N1_IDLE = IDLE_N1;
export const N1_MAX = MAX_N1;
