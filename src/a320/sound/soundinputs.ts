// What the A320's sounds read that the bag lacks (docs/PLAN-A320.md, A12 — inputs.md): the view (FlightGear's
// current-view: inside the cockpit, a wing's cabin window, its z-offset), the game's figures under FlightGear's names
// (the flaps' lever and surfaces, the rain, the gear's height 2 s ago, the minima, V1 and the take-off, the reversers,
// the tyres' slip), and FlightGear's Nasal/sounds.nas — its triggers' pulses (a button's click 0.05 s, the signs'
// chimes, the flap lever's and the speed brake's clicks, the relays' clunks), the engines' shutdowns. The engines'
// spools and states, the buses, the PTU, the autopilot are the systems' and the controller's already (sysinputs.ts,
// the ECAM). Pure but for its timers.

import type { Props } from "../rig";

type V3 = [number, number, number];

/** The game's figures for the sounds, a frame's. */
export interface SoundFrame {
  /** the ear: in the cockpit (inside) or at a wing's cabin window ("fwd", "aft": FlightGear's views 13, 14) or
   *  outside; its place in the ship's frame [m] */
  inside: boolean;
  wing?: "fwd" | "aft" | null;
  ear?: V3;
  /** the gear over the ground [ft] (the systems' position/gear-agl-ft is that), the flap lever 0–4, the flaps' angle
   *  over their travel 0…1, the rain 0…1 */
  aglFt: number;
  flapLever: number;
  flapNorm: number;
  rain?: number;
  /** the decision height [ft] (a radio minimum: the callouts "hundred above", "minimum"), none */
  minimums?: number | null;
  /** V1 [kt] (the FMS's), the take-off's roll under way (FlightGear's FMGC to-state) */
  v1?: number | null;
  takeoff?: boolean;
  /** the reversers' doors 0…1, the tyres' slip angle [deg] and side friction 0…1 (the screech) */
  reversers?: [number, number];
  slipDeg?: number;
  sideFriction?: number;
}

/** FlightGear's flap lever's positions (controls/flight/flaps: CONF 0, 1, 2, 3, FULL) */
const FLAPS = [0, 0.29, 0.596, 0.645, 1];

/** sounds.nas's pulses: a trigger set, cleared after [s] */
const PULSE: Record<string, number> = {
  "sim/sound/btn1": 0.05,
  "sim/sound/oh-btn": 0.05,
  "sim/sound/btn3": 0.05,
  "sim/sound/knb1": 0.05,
  "sim/sound/switch1": 0.05,
  "sim/sound/pushbutton": 0.2,
  "sim/sound/flaps-click": 0.4,
  "sim/sound/spdbrk-click": 0.4,
  "sim/sound/seatbelt-sign": 2,
  "sim/sound/no-smoking-sign": 1,
  "sim/sound/relay-batt-1": 0.35,
  "sim/sound/relay-batt-2": 0.35,
  "sim/sound/relay-apu": 0.35,
  "sim/sound/relay-ext": 0.35,
  "sim/sound/doorc_locking": 0.5,
  "sim/sound/doorc_unlocking": 0.5,
};
/** sounds.nas's listeners: a property's change sets its trigger */
const LISTEN: [string, string][] = [
  ["controls/lighting/seatbelt-sign", "sim/sound/seatbelt-sign"],
  ["controls/lighting/no-smoking-sign", "sim/sound/no-smoking-sign"],
  ["controls/flight/flaps-input", "sim/sound/flaps-click"],
  ["controls/flight/speedbrake", "sim/sound/spdbrk-click"],
  ["systems/electrical/sources/bat-1/bcl-supply", "sim/sound/relay-batt-1"],
  ["systems/electrical/sources/bat-2/bcl-supply", "sim/sound/relay-batt-2"],
  ["systems/electrical/relay/apu-glc/contact-pos", "sim/sound/relay-apu"],
  ["systems/electrical/relay/ext-epc/contact-pos", "sim/sound/relay-ext"],
];
/** an engine shut down: FlightGear's shutdown sound's trigger (sim/sound/shutdown[n] at 0) for [s] */
const SHUTDOWN_S = 3;

const n = (v: number | string | undefined) => Number(v ?? 0) || 0;

export class SoundInputs {
  /** the gear's height over the last seconds [s, ft] */
  private hist: [number, number][] = [];
  private t = 0;
  private until = new Map<string, number>();
  private last = new Map<string, number | string | undefined>();
  private ran: [boolean, boolean] = [false, false];
  private shut: [number, number] = [-1e9, -1e9];

  /** A frame [s] of the game's figures on the bag. */
  step(P: Props, dt: number, f: SoundFrame) {
    this.t += dt;
    const t = this.t;
    // (the view: FlightGear's cockpit view internal, its wing views 13 and 14 — sound-common.xml's internal-custom;
    // the ear's place along the fuselage, z-offset-m: aft > 0 from the model's origin)
    const wing = f.wing ?? null;
    P["sim/current-view/internal"] = f.inside && !wing ? 1 : 0;
    P["sim/current-view/view-number"] = wing === "fwd" ? 13 : wing === "aft" ? 14 : f.inside ? 0 : 1;
    P["sim/current-view/z-offset-m"] = f.ear ? -f.ear[2] : f.inside ? -16.193 : 0;
    // (the flaps, the rain)
    P["controls/flight/flaps"] = FLAPS[Math.round(Math.min(Math.max(f.flapLever, 0), 4))]!;
    P["surface-positions/flap-pos-norm"] = f.flapNorm;
    P["environment/rain-norm"] = f.rain ?? 0;
    // (the gear's height 2 s ago: the radio callouts sound descending only)
    this.hist.push([t, f.aglFt]);
    while (this.hist.length > 2 && this.hist[1]![0] <= t - 2) this.hist.shift();
    P["position/gear-agl-ft"] = f.aglFt;
    P["position/gear-agl-ft-2-sec"] = this.hist[0]![1];
    // (the minima: the PFD's — the callouts' gates 50 ft under and 50 and 100 over —, the radio height their
    // reference; none: out of reach)
    const dh = f.minimums ?? null;
    P["instrumentation/pfd/minimums-ref-alt"] = f.aglFt;
    P["instrumentation/pfd/minimums"] = dh ?? -1e4;
    P["instrumentation/pfd/minimums-minus-50"] = dh !== null ? dh - 50 : -1e4;
    P["instrumentation/pfd/minimums-plus-50"] = dh !== null ? dh + 50 : -1e4;
    P["instrumentation/pfd/minimums-plus-100"] = dh !== null ? dh + 100 : -1e4;
    // (a radio callout on the minimum itself: not said — the "minimum" is)
    P["instrumentation/pfd/minimums-no-gpws-alt"] = dh !== null ? Math.round(dh / 100) * 100 : -1;
    P["instrumentation/mk-viii/inputs/discretes/gpws-inhibit"] ??= 0;
    // (V1's callout: the FMS's V1 set, the take-off's roll)
    P["FMGC/internal/v1"] = f.v1 ?? 0;
    P["FMGC/internal/v1-set"] = f.v1 ? 1 : 0;
    P["FMGC/internal/to-state"] = f.takeoff ? 1 : 0;
    // (the reversers, the tyres)
    f.reversers?.forEach((r, k) => {
      P[`systems/fadec/reverse-${k + 1}/position-cmd-out`] = r;
      P[`engines/engine${k ? "[1]" : ""}/reverser-pos-norm`] = r;
    });
    P["fdm/jsbsim/gear/unit/slip-angle-deg"] = f.slipDeg ?? 0;
    P["fdm/jsbsim/gear/unit/side_friction_coeff"] = f.sideFriction ?? 0;
    // (the engines' shutdowns: a running engine stopped — its shutdown sound's trigger at 0 a while)
    for (const k of [0, 1] as const) {
      const run = n(P[`engines/engine${k ? "[1]" : ""}/state`]) === 3;
      if (this.ran[k] && !run) this.shut[k] = t;
      this.ran[k] = run;
      P[`sim/sound/shutdown${k ? "[1]" : ""}`] = t - this.shut[k] < SHUTDOWN_S ? 0 : 1;
    }
    // (sounds.nas: its listeners' triggers — not at the first frame —, its pulses cleared)
    for (const [src, trig] of LISTEN) {
      const v = P[src];
      if (this.last.has(src) && this.last.get(src) !== v) P[trig] = 1;
      this.last.set(src, v);
    }
    for (const [k, d] of Object.entries(PULSE)) {
      if (n(P[k])) {
        const u = this.until.get(k);
        if (u === undefined) this.until.set(k, t + d);
        else if (t >= u) {
          P[k] = 0;
          this.until.delete(k);
        }
      } else this.until.delete(k);
    }
  }
}
