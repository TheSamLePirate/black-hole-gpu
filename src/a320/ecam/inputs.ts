// What the ECAM reads that the game's systems do not write yet (docs/PLAN-A320.md, A11 — inputs.md lists them all),
// given from what the bag has: the engines' oil pressure from their N2 (FlightGear's FADEC files), the flight
// controls' pressure switches from the hydraulics (a320-fcs.xml: each surface's two systems), the computers healthy
// from their pushbuttons and buses (fbw.nas), the levers' detents, the flaps' position, the autobrake's mode, the
// fuel's total; the radios, TCAS, the datalink at rest (FlightGear's own defaults). The game's own (the flight
// control law, the reversers, FLEX) given by the caller. Pure.

import type { Props } from "../rig";

/** what only the game knows: the flight control law (0 normal, 1 alternate, 2 direct, 3 mechanical backup —
 *  FlightGear's it-fbw/law), the levers' detents (0 IDLE … 2 CL … 4 FLX/MCT … 6 TOGA: fadec.ts detentOf's), the
 *  reversers' doors 0…1, the FLEX temperature set [°C], the autobrake (0 off, 1 LO, 2 MED, 3 MAX) */
export interface EcamGame {
  law?: number;
  detents?: [number, number];
  reversers?: [number, number];
  flex?: number | null;
  autobrake?: number;
}

const n = (P: Props, k: string) => Number(P[k] ?? 0) || 0;
const DETENT: Record<string, number> = { IDLE: 0, MAN: 1, CL: 2, MCT: 4, TOGA: 6 };

/** an engine's oil pressure [psi] at its N2 [%] (a CFM56: some 30 psi at idle, 90 at take-off; nothing stopped) */
export const oilPsi = (n2: number) => (n2 < 5 ? 0 : Math.min(18 + Math.max(n2 - 20, 0) * 1.6, 95));

/** The ECAM's inputs set on the bag, a frame's (before Ecam.step). */
export function ecamInputs(P: Props, G: EcamGame = {}) {
  const once = (k: string, v: number | string) => {
    if (P[k] === undefined) P[k] = v;
  };
  // (the engines: oil, detents, the reversers, FLEX — the FADEC's)
  for (const [k, E] of [
    [1, "engines/engine"],
    [2, "engines/engine[1]"],
  ] as const) {
    P[`${E}/oil-psi-actual`] = oilPsi(n(P, `${E}/n2-actual`));
    P[`${E}/reverser-pos-norm`] = G.reversers?.[k - 1] ?? 0;
    P[`systems/fadec/control-${k}/detent`] =
      G.detents?.[k - 1] ?? DETENT[String(P[`systems/fadec/control-${k}/detent-text`] ?? "IDLE")] ?? 0;
    P[`systems/fadec/reverse-${k}/engage`] = (G.reversers?.[k - 1] ?? 0) > 0.05 ? 1 : 0;
  }
  P["systems/fadec/both-at-idle"] = n(P, "systems/fadec/control-1/detent") === 0 && n(P, "systems/fadec/control-2/detent") === 0 ? 1 : 0;
  P["systems/fadec/eng-out"] = (n(P, "engines/engine/state") === 3) !== (n(P, "engines/engine[1]/state") === 3) ? 1 : 0;
  P["systems/fadec/limit/flex-active"] = G.flex !== undefined && G.flex !== null ? 1 : 0;
  P["systems/fadec/limit/flex-temp"] = G.flex ?? 0;
  // (the flight controls: each surface's actuators on two systems — the elevators B+G and Y+B, the ailerons G+B; the
  // computers healthy with their pushbuttons in and their buses; the law)
  const hyd = (s: string) => n(P, `systems/hydraulic/${s}-psi`) >= 1500;
  P["systems/fcs/elevator-l/pressure-switch-or"] = hyd("blue") || hyd("green") ? 1 : 0;
  P["systems/fcs/elevator-r/pressure-switch-or"] = hyd("yellow") || hyd("blue") ? 1 : 0;
  P["systems/fcs/aileron-l/pressure-switch-or"] = P["systems/fcs/aileron-r/pressure-switch-or"] = hyd("green") || hyd("blue") ? 1 : 0;
  const dc = n(P, "systems/electrical/bus/dc-ess") >= 25 || n(P, "systems/electrical/bus/dc-1") >= 25;
  for (const c of ["elac1", "elac2", "sec1", "sec2"]) P[`systems/fctl/${c}`] = dc && n(P, `controls/fctl/switches/${c}`) ? 1 : 0;
  for (const k of [1, 2]) {
    const fac = dc && n(P, `controls/fctl/switches/fac${k}`) ? 1 : 0;
    P[`systems/fctl/fac${k}-healthy-signal`] = P[`systems/fctl/fac${k}-rtlu-avail`] = P[`systems/fctl/yawdamper-${k}-active`] = fac;
  }
  P["it-fbw/law"] = G.law ?? 0;
  for (const k of ["stabilizer/final-deg", "rudder/trim-cmd-deg", "rudder/trim-deg"]) once(`systems/fcs/${k}`, 0);
  // (the flaps' position: FlightGear's 0, 1, 1+F, 2, 3, FULL as 0…5 from the lever 0…4; the speed brake's lever)
  const lever = Math.round(n(P, "controls/flight/flaps-input"));
  P["controls/flight/flaps-pos"] = [0, 1, 3, 4, 5][lever] ?? 0;
  P["controls/flight/speedbrake"] = n(P, "fdm/jsbsim/spoilers/lever-cmd");
  // (the autobrake: the game's, else the deck's buttons)
  P["controls/autobrake/mode"] =
    G.autobrake ??
    (n(P, "controls/indicators/autobrake-max-on")
      ? 3
      : n(P, "controls/indicators/autobrake-med-on")
        ? 2
        : n(P, "controls/indicators/autobrake-low-on")
          ? 1
          : 0);
  // (the gear: all down and locked, the wheels' speed)
  P["systems/gear/all-norm"] = n(P, "gear/gear/position-norm");
  P["gear/gear[1]/rollspeed-ms"] = n(P, "gear/gear[1]/wow") ? n(P, "velocities/groundspeed-kt") * 0.514444 : 0;
  // (the fuel: the tanks' total, the centre's)
  let lbs = 0;
  for (let k = 0; k < 5; k++) lbs += n(P, `fdm/jsbsim/propulsion/tank${k ? `[${k}]` : ""}/contents-lbs`);
  P["consumables/fuel/total-fuel-lbs"] = lbs;
  P["consumables/fuel/tank[2]/level-lbs"] = n(P, "fdm/jsbsim/propulsion/tank[2]/contents-lbs");
  // (at rest, as FlightGear starts them: the FCU working, TCAS in TA/RA, VHF 3 on data, no company call, no fuel truck,
  // the weights in kilograms, the CFM engines)
  once("FMGC/FCU-working", 1);
  once("FMGC/internal/vmca-kt", 108);
  once("FMGC/internal/vmcg-kt", 109);
  once("instrumentation/tcas/inputs/mode", 3);
  once("instrumentation/tcas/serviceable", 1);
  once("systems/radio/vhf3-data-mode", 1);
  once("@atc.Transponders.vector[0].condition", 100);
  once("@atc.Transponders.vector[1].condition", 100);
  once("@atsu.CompanyCall.frequency", 999.99);
  once("@atsu.CompanyCall.received", 0);
  once("services/fuel-truck/connect", 0);
  once("systems/acconfig/options/weight-kgs", 1);
  once("options/engine-name", "CFM56-5B4");
}
