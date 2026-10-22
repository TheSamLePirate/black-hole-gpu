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
  /** running (lit), its N1 and N2 [%], EGT [°C], fuel flow [kg/s], thrust [N] (< 0 reversed), the reverser's doors 0…1 */
  running: boolean;
  n1: number;
  n2: number;
  egt: number;
  ff: number;
  thrust: number;
  rev: number;
}

export const newEngine = (running = true): Engine => ({
  running,
  n1: running ? IDLE_N1 : 0,
  n2: running ? IDLE_N2 : 0,
  egt: running ? 390 : 15,
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
export function stepEngine(e: Engine, want: { n1: number; reverse: number }, a: EngineAir, dt: number): Engine {
  const out = { ...e };
  if (!e.running) {
    // (spooling down — windmilling: N1 about a tenth of the airspeed's share)
    out.n1 = Math.max(e.n1 - 9.5 * dt, Math.min(a.mach * 30, e.n1));
    out.n2 = Math.max(e.n2 - 9.5 * dt, 0);
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
  // (EGT: some 400 °C at idle to 900 at take-off power, with the outside air)
  const egtWant = 380 + 5.6 * Math.max(out.n1 - IDLE_N1, 0) + 0.8 * a.tatC;
  out.egt = e.egt + (egtWant - e.egt) * Math.min(dt / 3, 1);
  return out;
}

/** The FADEC's own figures: the idle N1, the maximum (for gauges). */
export const N1_IDLE = IDLE_N1;
export const N1_MAX = MAX_N1;
