// A spacecraft's systems (docs/PLAN-VAISSEAUX-AAA.md, X3): its consumables — electricity (a battery fed by its
// generators, drawn by its systems, its thrusters and its reaction wheels), oxygen for its crew (0.84 kg a person a
// day, NASA's figure), the scrubbers taking out their CO₂ — and its failures, drawn at a rate the player sets
// (off, rare, realistic, hard) from a seeded generator (the same flight, the same failures), each with its causes'
// symptoms, its effect on the flight, and its checklist: the steps a crew follows, the last one the action that saves
// what can be saved. Pure: the state and a step in, the state out.

/** The figures of each craft. */
export interface SystemsSpec {
  crew: number;
  /** battery [kWh], generators [kW] (fuel cells, panels), the systems' own draw [kW], the thrusters' and wheels' at
   *  full effort [kW] */
  batteryKWh: number;
  genKW: number;
  baseKW: number;
  effortKW: number;
  /** oxygen carried [kg]; the scrubbers' life [days of the crew's breathing] */
  o2Kg: number;
  scrubDays: number;
}

export const SYSTEMS: Record<"ranger" | "lander" | "endurance", SystemsSpec> = {
  // (the Ranger: four, a few days' flight — fuel cells)
  ranger: { crew: 4, batteryKWh: 60, genKW: 4, baseKW: 2.6, effortKW: 6, o2Kg: 40, scrubDays: 14 },
  // (the Lander: two, its batteries the larger, its generators the smaller — a descent and a stay)
  lander: { crew: 2, batteryKWh: 120, genKW: 1.6, baseKW: 2, effortKW: 9, o2Kg: 20, scrubDays: 10 },
  // (the Endurance: the expedition's ship — twelve, its arrays and its reactor, years of air)
  endurance: { crew: 12, batteryKWh: 2000, genKW: 40, baseKW: 25, effortKW: 60, o2Kg: 8000, scrubDays: 730 },
};

/** NASA's oxygen per person per day [kg]. */
export const O2_PER_DAY = 0.84;

export type FailureKind = "engine" | "rcsStuck" | "gyro" | "bus" | "o2Leak" | "scrubber";
export const FAILURES: FailureKind[] = ["engine", "rcsStuck", "gyro", "bus", "o2Leak", "scrubber"];

/** A failure under way: what, since when [s of the flight], fixed or not, its parameters (a stuck thruster's axis). */
export interface Failure {
  kind: FailureKind;
  at: number;
  fixed: boolean;
  /** the stuck thruster's push (translation keys' share: tx, ty, tz) */
  push?: [number, number, number];
  /** a fix under way: done at that time [s] */
  fixAt?: number;
}

export interface SystemsState {
  /** battery left [kWh], oxygen [kg], the scrubbers' life left [days] */
  battery: number;
  o2: number;
  scrub: number;
  failures: Failure[];
  /** the generator's state (mulberry32) and the flight's seconds */
  seed: number;
  t: number;
  /** what was lost for good: an engine relit only half (one of two) */
  engineFactor: number;
  rcsFactor: number;
  /** the battery gone flat: the thrusters and wheels dead until it is charged back to 5 % */
  flat?: boolean;
}

export type FailureRate = "off" | "rare" | "realistic" | "hard";
/** Failures an hour of flight. */
export const FAILURE_RATE: Record<FailureRate, number> = { off: 0, rare: 0.05, realistic: 0.3, hard: 1.5 };

/** A fresh craft's systems (its tanks full, its battery charged). */
export function freshSystems(spec: SystemsSpec, seed = 1): SystemsState {
  return {
    battery: spec.batteryKWh,
    o2: spec.o2Kg,
    scrub: spec.scrubDays,
    failures: [],
    seed: seed >>> 0 || 1,
    t: 0,
    engineFactor: 1,
    rcsFactor: 1,
  };
}

/** The seeded generator: the next number in [0, 1), the state moved on. */
export function rand(S: SystemsState): number {
  let a = (S.seed = (S.seed + 0x6d2b79f5) >>> 0);
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/** What the systems feel this step: the effort of the thrusters and wheels (0 … 1). */
export interface SystemsIn {
  effort: number;
}

/** The effects of the failures on the flight now. */
export interface SystemsEffects {
  /** the main engine's thrust share; the thrusters' authority share */
  engine: number;
  rcs: number;
  /** a stuck thruster's push (translation keys' share), none: [0, 0, 0] */
  push: [number, number, number];
  /** an attitude drifting [rad/s on the craft's axes] (a gyroscope failing) */
  drift: [number, number, number];
  /** the battery flat: no thrusters, no wheels (only the main engine) */
  powerOut: boolean;
}

/** The effects now. Pure. */
export function effectsOf(S: SystemsState): SystemsEffects {
  const live = (k: FailureKind) => S.failures.find((f) => f.kind === k && !f.fixed);
  const e = live("engine");
  const r = live("rcsStuck");
  const g = live("gyro");
  return {
    engine: e ? 0 : S.engineFactor,
    rcs: S.rcsFactor,
    push: r?.push ?? [0, 0, 0],
    drift: g ? [0.0035, -0.002, 0.0015] : [0, 0, 0],
    powerOut: S.battery <= 0 || !!S.flat,
  };
}

/** The draw now [kW]: the systems', the effort's, a shorted bus's (twice the systems'). */
export function drawKW(spec: SystemsSpec, S: SystemsState, effort: number): number {
  const bus = S.failures.some((f) => f.kind === "bus" && !f.fixed);
  return spec.baseKW * (bus ? 3 : 1) + spec.effortKW * Math.max(0, Math.min(1, effort));
}

/**
 * A step of the systems [s of the flight]: the battery charged and drawn, the oxygen breathed (and leaking), the
 * scrubbers used, the fixes under way done, and — consumables and failures on — a failure drawn at its rate. The
 * kinds of failure the craft can have (no engine to lose: none such).
 */
export function stepSystems(
  spec: SystemsSpec,
  S: SystemsState,
  dt: number,
  i: SystemsIn,
  o: { consumables: boolean; rate: FailureRate; kinds?: FailureKind[] },
): Failure | null {
  if (!(dt > 0)) return null;
  S.t += dt;
  if (o.consumables) {
    const h = dt / 3600,
      d = dt / 86400;
    // (flat: its breakers open — nothing draws but the systems' own — until charged back to 5 %)
    if (S.battery <= 0) S.flat = true;
    const draw = S.flat ? drawKW(spec, S, 0) : drawKW(spec, S, i.effort);
    S.battery = Math.min(spec.batteryKWh, Math.max(0, S.battery + (spec.genKW - draw) * h));
    if (S.flat && S.battery > 0.05 * spec.batteryKWh) S.flat = false;
    const leak = S.failures.some((f) => f.kind === "o2Leak" && !f.fixed);
    // (a leak: the whole stock in about six hours)
    S.o2 = Math.max(0, S.o2 - spec.crew * O2_PER_DAY * d - (leak ? (spec.o2Kg / 6) * h : 0));
    const scrubDead = S.failures.some((f) => f.kind === "scrubber" && !f.fixed);
    if (!scrubDead) S.scrub = Math.max(0, S.scrub - d);
  }
  // the fixes under way, done
  for (const f of S.failures) {
    if (f.fixed || f.fixAt === undefined || S.t < f.fixAt) continue;
    f.fixed = true;
    // (an engine relit: on half its chambers a time in three — one of two lost for good)
    if (f.kind === "engine" && rand(S) < 1 / 3) S.engineFactor = 0.5;
    // (a quad isolated: a quarter of the thrusters' authority gone)
    if (f.kind === "rcsStuck") S.rcsFactor = Math.min(S.rcsFactor, 0.75);
  }
  // a failure drawn: its rate an hour, one under way of each kind at most
  const rate = FAILURE_RATE[o.rate] / 3600;
  if (rate > 0 && rand(S) < rate * dt) {
    const kinds = (o.kinds ?? FAILURES).filter((k) => !S.failures.some((f) => f.kind === k && !f.fixed));
    if (!kinds.length) return null;
    const kind = kinds[Math.floor(rand(S) * kinds.length)]!;
    return failNow(S, kind);
  }
  return null;
}

/** A failure of that kind now (a test's, a scenario's). */
export function failNow(S: SystemsState, kind: FailureKind): Failure {
  const f: Failure = { kind, at: S.t, fixed: false };
  if (kind === "rcsStuck") {
    // (one thruster open: a push along one of the craft's axes, a third of the translation's authority)
    const ax = Math.floor(rand(S) * 3);
    const sgn = rand(S) < 0.5 ? -1 : 1;
    f.push = [0, 0, 0];
    f.push[ax] = sgn / 3;
  }
  S.failures.push(f);
  return f;
}

/** The fix's time [s] once its last step is taken (a relight cools first; a valve closes at once). */
export const FIX_S: Record<FailureKind, number> = { engine: 30, rcsStuck: 2, gyro: 5, bus: 3, o2Leak: 60, scrubber: 20 };

/** The last step of a failure's checklist taken: its fix under way. What it does (false: nothing to fix). */
export function startFix(S: SystemsState, kind: FailureKind): boolean {
  const f = S.failures.find((q) => q.kind === kind && !q.fixed);
  if (!f || f.fixAt !== undefined) return false;
  f.fixAt = S.t + FIX_S[kind];
  return true;
}

/** Each failure's checklist (English: the caller translates), its last step the action. */
export const CHECKLISTS: Record<FailureKind, { title: string; steps: string[]; action: string }> = {
  engine: {
    title: "MAIN ENGINE OUT",
    steps: ["Throttle to zero", "Check propellant feed pressure", "Wait 30 s for the chamber to cool", "Igniters armed"],
    action: "RELIGHT",
  },
  rcsStuck: {
    title: "RCS THRUSTER STUCK OPEN",
    steps: ["Identify the quad by the drift", "Hold the attitude with the SAS", "Close the quad's isolation valves"],
    action: "ISOLATE THE QUAD",
  },
  gyro: {
    title: "IMU DRIFT",
    steps: ["Compare the attitude with the star tracker", "Release the holds", "Select the backup IMU"],
    action: "SWITCH TO THE BACKUP IMU",
  },
  bus: {
    title: "MAIN BUS SHORT",
    steps: ["Shed the non-essential loads", "Open the faulty bus's breaker", "Tie the essential loads to bus B"],
    action: "BUS TIE",
  },
  o2Leak: {
    title: "CABIN OXYGEN LEAK",
    steps: ["Suits on, helmets closed", "Find the leak by the pressure drop", "Close the tank's cross-feed valve"],
    action: "CLOSE THE VALVE",
  },
  scrubber: {
    title: "CO₂ SCRUBBER FAILED",
    steps: ["Check the CO₂ partial pressure", "Fit the spare cartridge's adapter", "Restart the fan"],
    action: "FIT THE SPARE CARTRIDGE",
  },
};

/** The normal checklists (the phases a crew reads one for). */
export const NORMAL_CHECKLISTS: { id: string; title: string; steps: string[] }[] = [
  {
    id: "launch",
    title: "BEFORE LAUNCH",
    steps: [
      "Hatches closed and locked",
      "Propellant: full, pressures green",
      "SAS on, guidance aligned",
      "Gear: armed for retraction",
      "Take-off goal set (altitude, inclination)",
    ],
  },
  {
    id: "orbit",
    title: "ORBIT INSERTION",
    steps: ["Engine cut off at the target apoapsis", "Circularize at the apoapsis", "Periapsis above the air", "Power: generators on line"],
  },
  {
    id: "dock",
    title: "RENDEZVOUS AND DOCKING",
    steps: [
      "Target selected, its port free",
      "Station keeping at the waypoint",
      "Docking camera view (V)",
      "Closing under 0.1 m/s the last 10 m",
      "Capture: latches confirmed",
    ],
  },
  {
    id: "entry",
    title: "DEORBIT AND ENTRY",
    steps: ["Site and runway chosen", "Deorbit burn retrograde", "Heat shield to the flow, 40° of attack", "Gear down below 500 m"],
  },
  {
    id: "landing",
    title: "POWERED LANDING",
    steps: ["Landing point designated (LPD)", "Hover seconds above 60", "Drift under 1 m/s below 30 m", "Engine cut at contact"],
  },
];
