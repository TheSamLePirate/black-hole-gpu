// The A320's failures (docs/PLAN-A320.md, A11): each one FlightGear's own failure properties on the systems' bag where
// it has them (AircraftConfig/fail.xml, Nasal/Systems/fbw.nas: systems/failures/* — the JSBSim files and the Nasal read
// them: the buses, the pumps, the fires, the valves, the flight control computers), the game's own besides (an engine
// flamed out or seized, a pitot iced, an ADR faulty, the cabin's leak, a fuel leak, the gear's normal extension, the
// brakes) under systems/failures/* too, so that the ECAM and the network see them all; armed now, at V1, at the
// lift-off or at random within a window (the school's scenarios). And what they do to the flight, read from the bag:
// the engines' (EngineCtl's failed, seized — fadec.ts), the flight control law Airbus's reconfiguration gives
// (lawOf), what each hydraulic system still moves (surfacesPowered — fcs.ts), the air data each ADR gives (AdrSet).
// Pure but for the dice (rand).

import type { EngineCtl } from "./fadec";
import type { Props } from "./rig";

export type FailCat =
  | "engines"
  | "fire"
  | "hydraulics"
  | "electrics"
  | "flight controls"
  | "air data"
  | "pressurisation"
  | "pneumatics"
  | "fuel"
  | "gear"
  | "apu";

export interface A320Failure {
  id: string;
  /** its name (English: the game's t() gives the French) */
  name: string;
  cat: FailCat;
  /** the bag's properties it sets to 1 (FlightGear's where it has them) */
  props: string[];
}

const FS = "systems/failures/";
const f = (id: string, name: string, cat: FailCat, ...props: string[]): A320Failure => ({
  id,
  name,
  cat,
  props: props.map((p) => FS + p),
});

/** The catalogue (FlightGear's fail.xml, its groups; the game's own after). */
export const FAILURES: A320Failure[] = [
  // ---- the engines (not FlightGear's: its FADEC files have no failure — the game's)
  f("eng1-fail", "Engine 1 failure (flame-out)", "engines", "engines/eng-1-flameout"),
  f("eng2-fail", "Engine 2 failure (flame-out)", "engines", "engines/eng-2-flameout"),
  f("eng1-seize", "Engine 1 seized", "engines", "engines/eng-1-seized"),
  f("eng2-seize", "Engine 2 seized", "engines", "engines/eng-2-seized"),
  f("eng-dual", "Both engines failed", "engines", "engines/eng-1-flameout", "engines/eng-2-flameout"),
  // ---- the fires (fail.xml's "Fire", "Engine Fire": the detection loops' temperature — a320-engine-fire.xml)
  f("eng1-fire", "Engine 1 fire", "fire", "fire/engine-left-fire"),
  f("eng2-fire", "Engine 2 fire", "fire", "fire/engine-right-fire"),
  f("apu-fire", "APU fire", "fire", "fire/apu-fire"),
  f("cargo-fwd-fire", "Forward cargo smoke", "fire", "fire/cargo-fwd-fire"),
  f("cargo-aft-fire", "Aft cargo smoke", "fire", "fire/cargo-aft-fire"),
  f("lav-fire", "Lavatory smoke", "fire", "fire/lavatory-fire"),
  // ---- the hydraulics (fail.xml's "HYD SYS Fail")
  f("hyd-g-leak", "Green hydraulic leak", "hydraulics", "hydraulic/green-leak"),
  f("hyd-b-leak", "Blue hydraulic leak", "hydraulics", "hydraulic/blue-leak"),
  f("hyd-y-leak", "Yellow hydraulic leak", "hydraulics", "hydraulic/yellow-leak"),
  f("hyd-g-edp", "Green engine pump", "hydraulics", "hydraulic/green-edp"),
  f("hyd-y-edp", "Yellow engine pump", "hydraulics", "hydraulic/yellow-edp"),
  f("hyd-b-elec", "Blue electric pump", "hydraulics", "hydraulic/blue-elec"),
  f("hyd-y-elec", "Yellow electric pump", "hydraulics", "hydraulic/yellow-elec"),
  f("hyd-ptu", "PTU", "hydraulics", "hydraulic/ptu"),
  f("hyd-gy", "Green and yellow lost", "hydraulics", "hydraulic/green-leak", "hydraulic/yellow-leak"),
  f("hyd-gb", "Green and blue lost", "hydraulics", "hydraulic/green-leak", "hydraulic/blue-leak"),
  f("hyd-by", "Blue and yellow lost", "hydraulics", "hydraulic/blue-leak", "hydraulic/yellow-leak"),
  // ---- the electrics (fail.xml's "ELEC SYS Fail"; the buses, IDGs and TRs a320-electrical.xml reads)
  f("elec-gen1", "Generator 1", "electrics", "electrical/gen-1"),
  f("elec-gen2", "Generator 2", "electrics", "electrical/gen-2"),
  f("elec-idg1", "IDG 1", "electrics", "electrical/idg-1"),
  f("elec-idg2", "IDG 2", "electrics", "electrical/idg-2"),
  f("elec-apu-gen", "APU generator", "electrics", "electrical/apu"),
  f("elec-ac1", "AC bus 1", "electrics", "electrical/ac-1-bus"),
  f("elec-ac2", "AC bus 2", "electrics", "electrical/ac-2-bus"),
  f("elec-ac-ess", "AC ESS bus", "electrics", "electrical/ac-ess-bus"),
  f("elec-dc1", "DC bus 1", "electrics", "electrical/dc-1-bus"),
  f("elec-dc2", "DC bus 2", "electrics", "electrical/dc-2-bus"),
  f("elec-dc-ess", "DC ESS bus", "electrics", "electrical/dc-ess-bus"),
  f("elec-dc-bat", "DC BAT bus", "electrics", "electrical/dc-bat-bus"),
  f("elec-tr1", "TR 1", "electrics", "electrical/tr-1"),
  f("elec-tr2", "TR 2", "electrics", "electrical/tr-2"),
  f("elec-ess-tr", "ESS TR", "electrics", "electrical/ess-tr"),
  f("elec-emer-gen", "Emergency generator", "electrics", "electrical/emer-gen"),
  f("elec-stat-inv", "Static inverter", "electrics", "electrical/stat-inv"),
  // (both generators lost: EMER ELEC CONFIG — the RAT out at speed, the emergency generator on the blue)
  f("elec-emer", "Total electrical loss (both generators)", "electrics", "electrical/gen-1", "electrical/gen-2", "electrical/apu"),
  // ---- the flight control computers (fail.xml's "FCTL SYS Fail" — fbw.nas)
  f("fctl-elac1", "ELAC 1", "flight controls", "fctl/elac1"),
  f("fctl-elac2", "ELAC 2", "flight controls", "fctl/elac2"),
  f("fctl-elacs", "ELAC 1 and 2", "flight controls", "fctl/elac1", "fctl/elac2"),
  f("fctl-sec1", "SEC 1", "flight controls", "fctl/sec1"),
  f("fctl-sec2", "SEC 2", "flight controls", "fctl/sec2"),
  f("fctl-sec3", "SEC 3", "flight controls", "fctl/sec3"),
  f("fctl-fac1", "FAC 1", "flight controls", "fctl/fac1"),
  f("fctl-fac2", "FAC 2", "flight controls", "fctl/fac2"),
  f("fctl-ths", "Stabiliser jammed", "flight controls", "fctl/ths-jam"),
  f("fctl-yd", "Both yaw dampers", "flight controls", "fctl/yaw-damper-1", "fctl/yaw-damper-2"),
  // ---- the air data (the game's: a pitot iced — its speed unreliable —, an ADR faulty)
  f("pitot1", "Pitot 1 iced", "air data", "navigation/pitot-1"),
  f("pitot2", "Pitot 2 iced", "air data", "navigation/pitot-2"),
  f("pitot3", "Pitot 3 iced", "air data", "navigation/pitot-3"),
  f("pitot-all", "All pitots iced (unreliable speed)", "air data", "navigation/pitot-1", "navigation/pitot-2", "navigation/pitot-3"),
  f("adr1", "ADR 1 fault", "air data", "navigation/adr-1"),
  f("adr2", "ADR 2 fault", "air data", "navigation/adr-2"),
  f("adr3", "ADR 3 fault", "air data", "navigation/adr-3"),
  // ---- the pressurisation (the game's) and the pneumatics (fail.xml's "PNEU SYS Fail")
  f("cab-leak", "Cabin pressure leak", "pressurisation", "pressurization/leak"),
  f("cab-decomp", "Explosive decompression", "pressurisation", "pressurization/decompression"),
  f("bleed1", "Engine 1 bleed", "pneumatics", "pneumatics/bleed-1-valve"),
  f("bleed2", "Engine 2 bleed", "pneumatics", "pneumatics/bleed-2-valve"),
  f("pack1", "Pack 1", "pneumatics", "pneumatics/pack-1-valve"),
  f("pack2", "Pack 2", "pneumatics", "pneumatics/pack-2-valve"),
  f("xbleed", "Cross bleed valve", "pneumatics", "pneumatics/x-bleed-valve"),
  // ---- the fuel (fail.xml's "FUEL SYS Fail"; the leaks the game's)
  f("fuel-l1", "Left tank pump 1", "fuel", "fuel/left-tank-pump-1"),
  f("fuel-l2", "Left tank pump 2", "fuel", "fuel/left-tank-pump-2"),
  f("fuel-c1", "Centre tank pump 1", "fuel", "fuel/center-tank-pump-1"),
  f("fuel-c2", "Centre tank pump 2", "fuel", "fuel/center-tank-pump-2"),
  f("fuel-r1", "Right tank pump 1", "fuel", "fuel/right-tank-pump-1"),
  f("fuel-r2", "Right tank pump 2", "fuel", "fuel/right-tank-pump-2"),
  f("fuel-leak-l", "Fuel leak, left wing", "fuel", "fuel/leak-left"),
  f("fuel-leak-r", "Fuel leak, right wing", "fuel", "fuel/leak-right"),
  // ---- the gear and the brakes (the game's)
  f("gear-ext", "Gear: no normal extension (gravity)", "gear", "gear/normal-extension"),
  f("brk-norm", "Normal brakes (green)", "gear", "brakes/normal"),
  f("brk-askid", "Anti-skid", "gear", "brakes/antiskid"),
  // ---- the APU (the game's: its auto shutdown)
  f("apu-fault", "APU fault (auto shutdown)", "apu", "apu/fault"),
];

export const failureById = (id: string) => FAILURES.find((x) => x.id === id) ?? null;

/** When an armed failure happens: now, past V1 (the take-off's roll), at the lift-off, at random within a window [s]
 *  from its arming, past a speed [kt]. */
export interface FailWhen {
  at?: "now" | "v1" | "takeoff" | "random" | "ias";
  /** the window's start and end [s] (random) */
  from?: number;
  to?: number;
  /** the speed [kt] ("ias"; V1's when not given the context's) */
  kt?: number;
}

export interface FailCtx {
  /** the indicated airspeed [kt], on the wheels, V1 [kt] (the FMS's; none: 140), the pressure altitude [ft] */
  ias: number;
  onGround: boolean;
  v1?: number | null;
  altFt?: number;
}

const PR = "systems/pressurization/";
const n = (P: Props, k: string) => Number(P[k] ?? 0) || 0;
const on = (P: Props, k: string) => n(P, FS + k) !== 0;

export class FailureSet {
  /** the failures happened (their properties set) */
  readonly active = new Set<string>();
  /** the failures armed: when, the time since their arming [s], the instant drawn (random) */
  readonly armed = new Map<string, { when: FailWhen; t: number; at: number }>();
  private wasOnGround = true;

  constructor(private rand: () => number = Math.random) {}

  /** A failure armed (now: at the next frame). */
  arm(id: string, when: FailWhen = { at: "now" }) {
    if (!failureById(id)) return;
    const from = when.from ?? 0,
      to = when.to ?? from + 600;
    this.armed.set(id, { when, t: 0, at: from + this.rand() * Math.max(to - from, 0) });
  }

  /** A failure happening now: its properties set. */
  fail(P: Props, id: string) {
    const F = failureById(id);
    if (!F) return;
    for (const p of F.props) P[p] = 1;
    this.armed.delete(id);
    this.active.add(id);
  }

  /** A failure cleared (repaired: its properties back to 0 — unless another active failure sets them too). */
  clear(P: Props, id: string) {
    this.armed.delete(id);
    if (!this.active.delete(id)) return;
    const still = new Set([...this.active].flatMap((k) => failureById(k)?.props ?? []));
    for (const p of failureById(id)!.props) if (!still.has(p)) P[p] = 0;
  }

  clearAll(P: Props) {
    this.armed.clear();
    for (const id of [...this.active]) this.clear(P, id);
    for (const F of FAILURES) for (const p of F.props) P[p] = 0;
  }

  /** A frame [s]: the armed failures due happen (their ids returned); the fires put out by the crew's agents dropped
   *  (the systems clear their properties — fire.nas); the cabin's leak, the APU's fault worked on the bag. */
  step(P: Props, dt: number, c: FailCtx): string[] {
    const fired: string[] = [];
    const liftOff = this.wasOnGround && !c.onGround;
    this.wasOnGround = c.onGround;
    for (const [id, a] of [...this.armed]) {
      a.t += dt;
      const w = a.when.at ?? "now";
      const due =
        w === "now" ||
        (w === "v1" && c.onGround && c.ias >= (a.when.kt ?? c.v1 ?? 140)) ||
        (w === "takeoff" && liftOff) ||
        (w === "random" && a.t >= a.at) ||
        (w === "ias" && c.ias >= (a.when.kt ?? 0));
      if (due) {
        this.fail(P, id);
        fired.push(id);
      }
    }
    for (const id of [...this.active]) {
      const F = failureById(id)!;
      if (F.cat === "fire" && F.props.every((p) => n(P, p) === 0)) this.active.delete(id);
    }
    // (the cabin's leak: its altitude climbing towards the aircraft's — 2 000 ft/min; the decompression's within
    // seconds — over what the controller makes of it — pneumatics.ts)
    const alt = c.altFt ?? n(P, "instrumentation/altimeter/indicated-altitude-ft");
    const leak = on(P, "pressurization/decompression") ? 40_000 : on(P, "pressurization/leak") ? 2_000 : 0;
    if (leak && !c.onGround) {
      const ca = n(P, `${PR}cabinalt`);
      if (ca < alt) P[`${PR}cabinalt`] = Math.min(ca + (leak / 60) * dt, alt);
    }
    // (the APU's fault: its oil overheating — APU.nas's auto shutdown past 135 °C, read at its next frame)
    if (on(P, "apu/fault") && n(P, "engines/engine[2]/n1") > 10) P["systems/apu/oil/oil-temperature-degC"] = 140;
    return fired;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The engines

/** An engine's failure (0, 1) on the bag: flamed out, seized — merged into the ignition's EngineCtl. */
export function engineFault(P: Props, k: number): Pick<EngineCtl, "failed" | "seized"> {
  return { failed: on(P, `engines/eng-${k + 1}-flameout`), seized: on(P, `engines/eng-${k + 1}-seized`) };
}

/** The fuel leaking [kg/s] from the left and right wings' tanks (some 2 t/h, a big leak: FUEL LEAK's procedure). */
export function fuelLeak(P: Props): [number, number] {
  return [on(P, "fuel/leak-left") ? 0.55 : 0, on(P, "fuel/leak-right") ? 0.55 : 0];
}

/** The yawing moment of thrust asymmetry [N·m, nose right > 0]: the thrust lines FlightGear's FDM puts 2.8775 m off
 *  the centreline (FDE/A320-200-CFM.xml's thrusters — its rudder's Cndr tuned to them, the nacelles themselves 5.75 m
 *  out). */
export const thrustYaw = (left: number, right: number) => (left - right) * 2.8775;

// ---------------------------------------------------------------------------------------------------------------------
// The hydraulics, the computers: what still moves, the law

/** A hydraulic system's pressure is there (Airbus's LO PR: under 1 450 psi). */
export const hydOk = (P: Props, sys: "green" | "blue" | "yellow") => n(P, `systems/hydraulic/${sys}-psi`) >= 1450;

/** What the hydraulics still move: each surface's actuators powered (Airbus's allocation — the ailerons G and B, the
 *  elevators B+G (left) and Y+B (right), the rudder G, B, Y, the THS's motors G and Y, the spoilers 1–5 G, Y, B, Y, G,
 *  the slats G and B, the flaps G and Y, the gear G, the nose wheel's steering Y, the normal brakes G, the alternate
 *  Y with its accumulator, the reversers 1 G and 2 Y); the slats' and flaps' rate (one system: half). */
export interface Powered {
  g: boolean;
  b: boolean;
  y: boolean;
  aileron: [boolean, boolean];
  elevator: [boolean, boolean];
  rudder: boolean;
  ths: boolean;
  /** L1…L5, R1…R5 (and the computers driving them: the SECs, ELACs — a spoiler pair lost with its SEC) */
  spoilers: boolean[];
  slatRate: number;
  flapRate: number;
  /** the gear retracted and extended normally (green); else only by gravity */
  gear: boolean;
  nws: boolean;
  brakes: { normal: boolean; altn: boolean; antiskid: boolean };
  reversers: [boolean, boolean];
}

const SPOILER_SYS = ["g", "y", "b", "y", "g"] as const;
/** each spoiler pair's computer: SEC 3, SEC 3, SEC 1, SEC 1, SEC 2 (FCOM's: 1–2 SEC 3, 3–4 SEC 1, 5 SEC 2) */
const SPOILER_SEC = [3, 3, 1, 1, 2] as const;

export function surfacesPowered(P: Props): Powered {
  const g = hydOk(P, "green"),
    b = hydOk(P, "blue"),
    y = hydOk(P, "yellow");
  const sys = { g, b, y };
  const sec = [1, 2, 3].map((k) => computerOk(P, "sec", k));
  const spoilers = Array.from({ length: 10 }, (_, i) => sys[SPOILER_SYS[i % 5]!] && sec[SPOILER_SEC[i % 5]! - 1]!);
  const two = (a: boolean, c: boolean) => (a && c ? 1 : a || c ? 0.5 : 0);
  return {
    g,
    b,
    y,
    aileron: [g || b, g || b],
    elevator: [b || g, y || b],
    rudder: g || b || y,
    ths: (g || y) && !on(P, "fctl/ths-jam"),
    spoilers,
    slatRate: two(g, b),
    flapRate: two(g, y),
    gear: g && !on(P, "gear/normal-extension"),
    nws: y,
    brakes: {
      normal: g && !on(P, "brakes/normal"),
      altn: y || n(P, "systems/hydraulic/yellow-accumulator-psi") > 1000,
      antiskid: !on(P, "brakes/antiskid"),
    },
    reversers: [g, y],
  };
}

/** a flight control computer working: not failed, its pushbutton in, its DC bus (ELAC 1: DC ESS, ELAC 2: DC 2; SEC 1:
 *  DC ESS, SEC 2 and 3: DC 2; FAC 1: DC ESS SHED, FAC 2: DC 2) — the buses checked only once the systems write them */
export function computerOk(P: Props, kind: "elac" | "sec" | "fac", k: number): boolean {
  const bus =
    kind === "elac" ? (k === 1 ? "dc-ess" : "dc-2") : kind === "sec" ? (k === 1 ? "dc-ess" : "dc-2") : k === 1 ? "dc-ess-shed" : "dc-2";
  const v = P[`systems/electrical/bus/${bus}`];
  const pb = P[`controls/fctl/switches/${kind}${k}`];
  return !on(P, `fctl/${kind}${k}`) && (pb === undefined || Number(pb) !== 0) && (v === undefined || Number(v) > 20);
}

export type Law = "normal" | "alternate" | "direct";

/** The flight control law by Airbus's reconfiguration: alternate with two hydraulic systems lost, both ELACs lost, two
 *  ADRs lost or disagreeing (AdrSet: systems/navigation/adr/disagree), the AC buses 1 and 2 both lost (EMER ELEC),
 *  both yaw dampers lost; direct in alternate once the gear is down (the flare's), or with all the ELACs and SECs lost
 *  (the mechanical backup: flown as direct). The reasons said (the ECAM's STATUS). */
export function lawOf(P: Props, gearDown = n(P, "gear/gear/position-norm") > 0.5): { law: Law; reasons: string[] } {
  const reasons: string[] = [];
  const lost = (["green", "blue", "yellow"] as const).filter((s) => !hydOk(P, s) && P[`systems/hydraulic/${s}-psi`] !== undefined);
  if (lost.length >= 2) reasons.push(`HYD ${lost.map((s) => s[0]!.toUpperCase()).join("+")} SYS LO PR`);
  const elacs = [1, 2].filter((k) => computerOk(P, "elac", k)).length;
  const secs = [1, 2, 3].filter((k) => computerOk(P, "sec", k)).length;
  if (!elacs) reasons.push("ELAC 1+2 FAULT");
  if (n(P, "systems/navigation/adr/disagree")) reasons.push("ADR DISAGREE");
  const bus = (b: string) => P[`systems/electrical/bus/${b}`];
  if (bus("ac-1") !== undefined && Number(bus("ac-1")) < 100 && Number(bus("ac-2") ?? 0) < 100) reasons.push("EMER ELEC");
  if (on(P, "fctl/yaw-damper-1") && on(P, "fctl/yaw-damper-2")) reasons.push("YAW DAMPER 1+2");
  if (!elacs && !secs) return { law: "direct", reasons: [...reasons, "MECH BACKUP"] };
  if (!reasons.length) return { law: "normal", reasons };
  return { law: gearDown ? "direct" : "alternate", reasons };
}

// ---------------------------------------------------------------------------------------------------------------------
// The air data

const P0 = 29.92126;
/** the static pressure at a pressure altitude [inHg] (ISA's troposphere) */
const staticAt = (ft: number) => P0 * (1 - 6.8755856e-6 * Math.min(ft, 36089)) ** 5.255876;
/** the impact pressure of a calibrated airspeed [inHg], and back */
const qcOf = (kt: number) => P0 * ((1 + 0.2 * (kt / 661.4786) ** 2) ** 3.5 - 1);
const ktOf = (qc: number) => 661.4786 * Math.sqrt(5 * ((Math.max(qc, 0) / P0 + 1) ** (2 / 7) - 1));

/** One ADR's reading: its speed [kt] and altitude [ft], valid (powered, operating, not failed), rejected (out by the
 *  others' vote). */
export interface AdrReading {
  ias: number;
  alt: number;
  valid: boolean;
  rejected: boolean;
}

/** The three ADRs: each its pitot (iced: its total pressure trapped as it was — the drain blocked too —, the speed
 *  it reads climbing with the altitude like an altimeter's, dropping in a descent), its static port, its unit (the
 *  ADIRS's operating-N; failed: invalid); the voting (one more than 16 kt from the two others: rejected); the captain's
 *  ADR 1 and the first officer's 2 — ADR 3 for either by the AIR DATA selector. Written on the bag for the displays,
 *  the law and the ECAM: systems/navigation/adr/output/ias-N, alt-N, valid-N, rejected-N, disagree. */
export class AdrSet {
  private trapped: (number | null)[] = [null, null, null];
  readonly out: AdrReading[] = [0, 1, 2].map(() => ({ ias: 0, alt: 0, valid: true, rejected: false }));

  step(P: Props, ias: number, altFt: number): { cpt: AdrReading; fo: AdrReading; disagree: boolean } {
    const ps = staticAt(altFt);
    for (let k = 0; k < 3; k++) {
      const iced = on(P, `navigation/pitot-${k + 1}`);
      if (iced && this.trapped[k] === null) this.trapped[k] = ps + qcOf(ias);
      if (!iced) this.trapped[k] = null;
      const pt = this.trapped[k] ?? ps + qcOf(ias);
      const op = P[`systems/navigation/adr/operating-${k + 1}`];
      const R = this.out[k]!;
      R.ias = ktOf(pt - ps);
      R.alt = altFt;
      R.valid = !on(P, `navigation/adr-${k + 1}`) && (op === undefined || Number(op) !== 0);
    }
    // (the vote: each valid one against the others — rejected when no other agrees within 16 kt)
    const ok = this.out.filter((r) => r.valid);
    for (const r of this.out) r.rejected = !r.valid || (ok.length >= 2 && !ok.some((o) => o !== r && Math.abs(o.ias - r.ias) <= 16));
    const agree = this.out.filter((r) => !r.rejected).length;
    const disagree = agree < 2;
    this.out.forEach((r, k) => {
      const o = `systems/navigation/adr/output/`;
      P[`${o}ias-${k + 1}`] = r.ias;
      P[`${o}alt-${k + 1}`] = r.alt;
      P[`${o}valid-${k + 1}`] = r.valid ? 1 : 0;
      P[`${o}rejected-${k + 1}`] = r.rejected ? 1 : 0;
    });
    P["systems/navigation/adr/disagree"] = disagree ? 1 : 0;
    // (the AIR DATA selector: −1 CAPT 3, 0 NORM, 1 F/O 3 — SwitchingPanel.nas)
    const sw = n(P, "controls/navigation/switching/air-data");
    return { cpt: this.out[sw === -1 ? 2 : 0]!, fo: this.out[sw === 1 ? 2 : 1]!, disagree };
  }
}
