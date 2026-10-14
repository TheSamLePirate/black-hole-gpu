// The jet's systems for the plane mode (a fighter's): the autopilot's altitude and heading holds, the
// autothrottle's speed hold, the afterburner. The plane law (pilot.ts) holds a flight path angle and a bank
// when the stick is let go; these set them — the altitude hold a climb or a descent towards the altitude
// selected, the heading hold a bank towards the heading —, and the autothrottle sets the throttle to the speed
// selected. The stick flies through them (control wheel steering): moved, it flies; let go, the altitude and
// heading it leaves are the new ones. Pure: a frame's figures in, the commands out (controller/jet.ts flies them).

const D = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
/** An angle's difference wrapped to (−π, π]. */
export const wrapPi = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

export const JET = {
  /** the heading hold's bank at most, the altitude hold's climb angle at most [rad] */
  bankMax: 30 * D,
  gammaMax: 12 * D,
  /** the altitude hold's vertical speed per metre off [1/s], and at most [m/s] (and a share of the speed) */
  altGain: 0.1,
  vsMax: 40,
  /** the heading hold's bank per radian off */
  hdgGain: 2.5,
  /** the afterburner: its thrust over the dry engine's, its propellant over it */
  abThrust: 1.5,
  abFlow: 3,
  /** the autothrottle: the acceleration asked per m/s off [1/s], at most [m/s²]; the throttle's answer's time [s] */
  spdGain: 0.25,
  accMax: 3,
  athrTau: 0.6,
  /** the speed and altitude selected moved by the throttle keys (A/T on) [m/s per s held] */
  spdRate: 10,
} as const;

/** The modes engaged and their targets (null: off): altitude [m], heading [rad], speed [m/s]; the afterburner. */
export interface JetModes {
  alt: number | null;
  hdg: number | null;
  spd: number | null;
  ab: boolean;
  /** the flight plan's guidance moving the holds' targets (controller/fplan.ts; the displays' copy only) */
  lnav?: boolean;
  vnav?: boolean;
  /** a formation flown (controller/formation.ts): the leader's name, the slot's distance [m] (the displays' copy) */
  form?: string;
  formDist?: number;
}
export const noJetModes = (): JetModes => ({ alt: null, hdg: null, spd: null, ab: false });

/** The altitude hold's flight path angle [rad]: towards hT at a vertical speed proportional to the error. */
export function altHoldGamma(h: number, hT: number, V: number): number {
  const vsMax = Math.max(5, Math.min(JET.vsMax, 0.15 * V));
  const vs = clamp(JET.altGain * (hT - h), -vsMax, vsMax);
  return clamp(Math.asin(clamp(vs / Math.max(V, 30), -1, 1)), -JET.gammaMax, JET.gammaMax);
}

/** The heading hold's bank [rad] (right > 0): towards the heading (clockwise from north). */
export function hdgHoldBank(hdg: number, hT: number): number {
  return clamp(JET.hdgGain * wrapPi(hT - hdg), -JET.bankMax, JET.bankMax);
}

/** The autothrottle: the throttle moved so the speed comes to its target, its acceleration measured (the
 *  thrust's share of the acceleration known: `aFull` [m/s²] at full throttle). */
export class Autothrottle {
  private v = NaN;
  private a = 0;
  reset() {
    this.v = NaN;
    this.a = 0;
  }
  /** the throttle now → the throttle next; V the speed [m/s], VT the target, dt [s] */
  step(throttle: number, V: number, VT: number, aFull: number, dt: number): number {
    if (!(dt > 0)) return throttle;
    // (the acceleration measured, eased over ~0.3 s: the speed's own steps are noisy)
    if (Number.isFinite(this.v)) this.a += ((V - this.v) / dt - this.a) * Math.min(1, dt / 0.3);
    this.v = V;
    const want = clamp(JET.spdGain * (VT - V), -JET.accMax, JET.accMax);
    // (the throttle that adds the missing acceleration, reached over athrTau)
    const dThr = (want - this.a) / Math.max(aFull, 0.5);
    return clamp(throttle + dThr * Math.min(1, dt / JET.athrTau), 0, 1);
  }
}

/** What the flight's figures ask of the plane law: its flight path angle and bank to hold (null: its own). */
export function jetCommands(m: JetModes, f: { h: number; hdg: number; V: number }): { gamma: number | null; bank: number | null } {
  return {
    gamma: m.alt !== null && Number.isFinite(f.h) ? altHoldGamma(f.h, m.alt, f.V) : null,
    bank: m.hdg !== null && Number.isFinite(f.hdg) ? hdgHoldBank(f.hdg, m.hdg) : null,
  };
}

/** The annunciators (the HUD's top line): the modes engaged and their targets, in the units shown. */
export function jetAnnunciators(m: JetModes, u: { alt: (m: number) => string; spd: (v: number) => string }): string[] {
  const out: string[] = [];
  if (m.form) {
    out.push(`FORM ${m.form.toUpperCase()}${m.formDist !== undefined ? ` ${u.alt(m.formDist)}` : ""}`);
    if (m.ab) out.push("AB");
    return out;
  }
  if (m.alt !== null) out.push(`${m.vnav ? "VNAV " : "ALT "}${u.alt(m.alt)}`);
  if (m.hdg !== null && m.lnav) out.push("LNAV");
  else if (m.hdg !== null) out.push(`HDG ${String(Math.round(((m.hdg / D) % 360) + 360) % 360).padStart(3, "0")}`);
  if (m.spd !== null) out.push(`A/T ${u.spd(m.spd)}`);
  if (m.ab) out.push("AB");
  return out;
}
