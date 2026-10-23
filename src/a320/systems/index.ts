// The A320's systems run (docs/PLAN-A320.md, A10): on the deck's bag (rig.ts Props — its switches set there by the
// controls, its lights and displays reading it), each frame the game's figures put in (sysinputs.ts), FlightGear's
// JSBSim system files interpreted (jsbsys.ts: the electrics, the hydraulics, the fuel, the ignition, the bleed, the
// air data…), its Nasal ported (nasal/*: the APU, the ADIRS, the fire…); the game reading back what they decide —
// each engine's starter and fuel (the FADEC's start: fadec.ts), the buses (the displays powered), the hydraulics.

import type { EngineCtl } from "../fadec";
import type { Props } from "../rig";
import { JsbSystems, type SysData } from "./jsbsys";
import { nasalModules, type NasalOptions } from "./nasal";
import { putInputs, type SysFrame } from "./sysinputs";
import data from "./sysdata.json";
import type { NasalModule, StartState } from "./types";

export type { StartState } from "./types";
export type { SysFrame } from "./sysinputs";

const n = (v: number | string | undefined) => Number(v ?? 0) || 0;

/** FlightGear's files as they are, but for one quirk mended: the green reservoir's 2.1 l the gear's extension gives back
 *  (a320-hydraulic.xml green-qty-cmd) came back even with the green system leaking — its gravity extension refilled
 *  it: none with the leak. */
function mended(d: SysData): SysData {
  for (const s of d.systems)
    for (const ch of s.channels)
      for (const c of ch.comps as { out?: string[]; expr?: unknown }[])
        if (c.out?.[0] === "systems/hydraulic/green-qty-cmd" && Array.isArray(c.expr) && !JSON.stringify(c.expr).includes("green-leak"))
          (c.expr as unknown[])[2] = [
            "product",
            c.expr[2],
            ["difference", ["value", 1], ["prop", "systems/failures/hydraulic/green-leak"]],
          ];
  return d;
}
const DATA = mended(data as unknown as SysData);
const ENG = ["controls/engines/engine", "controls/engines/engine[1]"] as const;

export class A320Systems {
  readonly jsb = new JsbSystems(DATA);
  readonly nasal: NasalModule[];
  /** the time since the flight began [s] */
  elapsed = 0;
  state: StartState = "cold";
  /** the fuel each engine used since the flight began [kg] */
  used: [number, number] = [0, 0];

  constructor(
    readonly P: Props,
    o: NasalOptions = {},
  ) {
    this.nasal = nasalModules(o);
  }

  /** The bag as FlightGear's would be for a start: cold and dark, the APU's (batteries, APU, its bleed, the IRs in NAV
   *  and aligned), ready (the engines running, the APU off), in flight. The engines' own state is the FADEC's
   *  (fcs.ts setEngines); the systems then settle a few seconds on the frame given. */
  reset(state: StartState, f?: SysFrame) {
    const P = this.P;
    this.state = state;
    this.jsb.reset(P);
    for (const m of this.nasal) m.reset?.(P, state);
    const run = state === "ready" || state === "air";
    for (const E of ENG) {
      // (the ENG MASTERs, the MAN STARTs; the ENG MODE selector at NORM)
      P[`${E}/cutoff-switch`] = run ? 0 : 1;
      P[`${E}/start-switch`] = 0;
    }
    P["controls/ignition/start-sw"] = 1;
    // (the flight control computers' pushbuttons: in, but cold and dark — FlightGear's -set file's 0)
    for (const c of ["elac1", "elac2", "sec1", "sec2", "sec3", "fac1", "fac2"]) P[`controls/fctl/switches/${c}`] = state === "cold" ? 0 : 1;
    // (the batteries' charge and voltage: FlightGear gives the charge's computed value only — its first frame, cold and
    // dark, copies it —, a warm start would read 0 and its current formula divide by a 0 V)
    for (const b of ["bat-1", "bat-2"]) {
      const S = `systems/electrical/sources/${b}/`;
      P[`${S}percent`] = n(P[`${S}percent-calc`]) || 80;
      P[`${S}volt`] = 27.36;
    }
    // (warm: the DC BAT bus up from the first frame — the APU's power-loss watch, an actuator following its input at
    // once after a reset, would latch on a bus not yet computed)
    if (state !== "cold") P["systems/electrical/bus/dc-bat"] = 28;
    // (the APU running: its oil's pressure and temperature as a320-apu.xml's tables give them at 100 % — read by its
    // Nasal before the files' first frame, a 0 psi would stop it)
    if (state === "apu") Object.assign(P, { "systems/apu/oil/oil-pressure-psi": 55, "systems/apu/oil/oil-temperature-degC": 100 });
    // (FlightGear's -set file starts the ditching pushbutton at 14.7: its typo — Nasal sets it 0)
    P["systems/pressurization/ditchingpb"] = 0;
    this.elapsed = state === "cold" ? 0 : 60;
    this.used = [0, 0];
    if (f) for (let k = 0; k < 120; k++) this.step(1 / 30, f);
    // (the APU's: started again once the network has settled — its generator's coming on line drops the DC BAT bus a
    // fraction of a second, which its power-loss watch would take for a loss)
    if (state === "apu") {
      for (const m of this.nasal) if (m.name === "APU") m.reset?.(P, state);
      Object.assign(P, {
        "systems/apu/oil/oil-pressure-psi": 55,
        "systems/apu/oil/oil-temperature-degC": 100,
        "systems/apu/shutdown-power-loss-timer": 0,
        "systems/apu/shutdown-power-loss": 0,
      });
      if (f) for (let k = 0; k < 30; k++) this.step(1 / 30, f);
    }
    this.used = [0, 0];
  }

  /** A frame [s]: the game's figures in, the Nasal, the JSBSim channels. */
  step(dt: number, f: SysFrame) {
    const P = this.P;
    this.elapsed += dt;
    f.engines.forEach((e, k) => (this.used[k as 0 | 1] += e.ff * dt));
    putInputs(P, { ...f, elapsed: this.elapsed, fuelUsed: this.used });
    for (const m of this.nasal) m.step(P, dt);
    this.jsb.step(P, dt);
  }

  /** A deck's Nasal call (its button's binding): true if a system answered it. */
  call(fn: string, args: (number | string)[]): boolean {
    for (const m of this.nasal) if (m.call?.(fn, args, this.P)) return true;
    return false;
  }

  /** Each engine's starter and fuel as the ignition decides them (JSBSim's starter and cutoff). */
  engineCtl(): [EngineCtl, EngineCtl] {
    const P = this.P;
    const c = (k: 1 | 2): EngineCtl => ({
      starter: n(P[`systems/ignition/starter-jsb-${k}`]) > 0.5,
      cutoff: n(P[`systems/ignition/cutoff-jsb-${k}`]) > 0.5,
    });
    return [c(1), c(2)];
  }

  /** A bus's voltage [V] ("ac-1", "dc-ess"…). */
  bus(name: string): number {
    return n(this.P[`systems/electrical/bus/${name}`]);
  }

  /** the AC essential bus powered — the captain's displays, the MCDU 1 */
  get acEss(): boolean {
    return this.bus("ac-ess") > 100;
  }

  /** a hydraulic system's pressure [psi] */
  psi(sys: "green" | "blue" | "yellow"): number {
    return n(this.P[`systems/hydraulic/${sys}-psi`]);
  }
}

/** The deck's Nasal calls the systems answer (nasal/*: the APU's, the ADIRS's, the air data's switching). */
export const SYS_CALLS = /^systems\.(APUController\.APU\.|ADIRSControlPanel\.|SwitchingPanel\.do|ADIRS\.ADIRunits)/;

let sysProps: Set<string> | null = null;
/** A property the systems read or write — its switch then works (the JSBSim files' properties, the Nasal's panels:
 *  the APU, the fire, the ADIRS, the bleed, the electrics, the hydraulics, the fuel, the engines' masters). */
export function sysProp(p: string): boolean {
  if (!sysProps) {
    sysProps = new Set();
    const walk = (v: unknown) => {
      if (typeof v === "string") {
        if (v.includes("/")) sysProps!.add(v);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk((data as { systems: unknown }).systems);
    walk((data as { props: unknown }).props);
  }
  return (
    sysProps.has(p) || /^controls\/(apu|fire|adirs|engines|electrical|hydraulic|fuel|pneumatics|ignition|navigation\/adirscp)\//.test(p)
  );
}
