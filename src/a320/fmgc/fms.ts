// The A320's flight management (docs/PLAN-A320.md, A9): what the crew enters in the MCDUs — INIT A (the route's ends,
// the flight number, the cost index, the cruise level), INIT B (the weights, the fuel), PERF TAKE OFF (V1, VR, V2, the
// FLEX temperature, the thrust reduction and acceleration heights, the flaps), PERF APPR (the QNH, the temperature,
// the wind, the minima, the landing configuration), RAD NAV (the ILS) — and what it computes from it: the V speeds it
// proposes, the managed speeds by phase (ECON by the cost index), VAPP, the fuel and time at the destination. The flight
// plan itself is the game's (game/flightplan.ts: controller/fplan.ts edits it). Pure.

import { vs1g } from "../du/data";

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** The flaps' setting for the take-off (CONF 1+F, 2, 3) and its index in CONF (pose.ts): 2, 3, 4. */
export const TO_CONF: Record<number, number> = { 1: 2, 2: 3, 3: 4 };

export class Fms {
  // ---- INIT A
  from: string | null = null;
  to: string | null = null;
  altn: string | null = null;
  fltNbr = "";
  costIndex: number | null = null;
  /** the cruise flight level (FL: hundreds of feet), its temperature [°C], the tropopause [ft] */
  crzFl: number | null = null;
  crzTemp: number | null = null;
  tropo = 36090;
  // ---- INIT B [t] (the A320's FMGC in tonnes), the CG [% MAC]
  zfw: number | null = null;
  zfwcg: number | null = null;
  block: number | null = null;
  taxi = 0.2;
  /** the route's reserve [%], the final reserve [min] */
  rtePct = 5;
  finalMin = 30;
  // ---- PERF TAKE OFF [kt, ft over the field]
  v1: number | null = null;
  vr: number | null = null;
  v2: number | null = null;
  flex: number | null = null;
  thrRed = 1500;
  acc = 1500;
  /** the flaps lever's take-off position (1, 2, 3) and the trim "UP1.0" / "DN0.5" */
  toConf: number | null = null;
  ths = "";
  // ---- PERF APPR
  qnh: number | null = null;
  appTemp: number | null = null;
  appWind: { dir: number; kt: number } | null = null;
  mda: number | null = null;
  dh: number | null = null;
  ldgConf: 3 | 4 = 4;
  /** VAPP entered (null: computed) */
  vappSet: number | null = null;
  // ---- RAD NAV: the ILS's identifier and course (null: the arrival runway's, tuned by the FMGC)
  ils: { id: string; course: number } | null = null;
  /** the FMGC's messages for the scratchpad ("CHECK TAKE OFF DATA", "NOT ALLOWED"…) */
  messages: string[] = [];

  /** the take-off weight [t] (ZFW + block − taxi), null without INIT B */
  get tow(): number | null {
    return this.zfw !== null && this.block !== null ? this.zfw + this.block - this.taxi : null;
  }

  /** The V speeds proposed for a take-off weight [kg] and a flaps position (1, 2, 3) — Airbus's rules of thumb on the
   *  A320's own stall speeds: V2 1.13 VS1G (≥ VMCA 115), VR 4 kt under, V1 3 kt under VR (a dry runway). */
  proposeV(towKg: number, conf: number): { v1: number; vr: number; v2: number } {
    const ci = TO_CONF[conf] ?? 3;
    const v2 = Math.max(Math.round(vs1g(towKg, ci) * 1.13), 120);
    const vr = Math.max(v2 - 4, 116);
    return { v1: vr - 3, vr, v2 };
  }

  /** VLS in the landing configuration [kt] at a mass [kg] */
  vls(massKg: number, conf: 3 | 4 = this.ldgConf) {
    return vs1g(massKg, conf === 4 ? 5 : 4) * 1.23;
  }

  /** VAPP [kt]: VLS + ⅓ of the head wind's component, 5 to 15 kt (entered: that) */
  vapp(massKg: number, rwyHdg?: number): number {
    if (this.vappSet !== null) return this.vappSet;
    const hw = this.appWind && rwyHdg !== undefined ? this.appWind.kt * Math.cos(((this.appWind.dir - rwyHdg) * Math.PI) / 180) : 0;
    return Math.round(this.vls(massKg) + clamp(hw / 3, 5, 15));
  }

  /** The managed speeds by the cost index [kt / Mach]: climb, cruise (Mach), descent — ECON's trade of fuel for time. */
  econ(): { clb: number; crzMach: number; des: number } {
    const ci = clamp(this.costIndex ?? 30, 0, 999);
    const k = Math.min(ci, 100) / 100;
    return { clb: Math.round(280 + 30 * k), crzMach: Math.round((0.76 + 0.03 * k) * 100) / 100, des: Math.round(270 + 40 * k) };
  }

  /** A scratchpad message (most recent first, three kept). */
  say(m: string) {
    this.messages = [m, ...this.messages.filter((x) => x !== m)].slice(0, 3);
  }
}
