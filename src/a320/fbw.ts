// The A320's flight control laws (docs/PLAN-A320.md, A4) — FlightGear's (Systems/a320-fbw.xml, Nasal/Systems/fbw.nas)
// and Airbus's: what the side stick asks and what the computers hold. Pure.
//
// Normal law. Pitch: the stick a load factor (+2.5 g full aft clean, +2 g with the flaps; −1 g / 0 g full forward), let
// go the flight path held (1 g corrected for the bank up to 33°), the stabiliser trimming by itself (src/a320/fcs.ts);
// the pitch attitude kept within +30° (25° slow in CONF FULL) and −15°. Roll: the stick a roll rate (15°/s at full
// deflection), let go the bank held up to 33° — past it brought back to 33° —, 67° at most (45° in the protections).
// Yaw: the turn coordinated, the sideslip killed, the pedals a sideslip. Protections: high incidence — past α prot
// the stick commands the incidence itself, α prot let go, α max full aft; α floor the autothrust's TOGA —, high speed
// — past VMO + 6 kt / MMO + 0.01 a nose-up order, the bank back to level, 45° at most. The flare mode below 50 ft: the
// attitude at 50 ft memorised, then 2° nose down over 8 s — the pilot flares.
// Alternate law: the load factor law, no protection but the load's; the roll direct. Direct law: the stick on the
// surfaces (pilot.ts's direct branch). On the ground: the stick the elevators (pilot.ts's ground branch).

import { evaluate, type Table } from "./jsbsim";

const D = Math.PI / 180;
const G = 9.80665;

/** α prot and α max by Mach and configuration (FlightGear's a320-fbw.xml) [deg] */
const ALPHA_PROT: Table = {
  vars: ["velocities/mach", "fcs/flap-pos-deg", "fcs/slat-pos-deg"],
  pages: [
    {
      bp: 0,
      table: {
        vars: ["velocities/mach", "fcs/flap-pos-deg"],
        rows: [0.55, 0.9],
        cols: [0, 10, 15, 20, 35],
        data: [
          [8.6, 11.5, 11, 11, 10.5],
          [7.4, 7.4, 7.4, 7.4, 7.4],
        ],
      },
    },
    {
      bp: 18,
      table: {
        vars: ["velocities/mach", "fcs/flap-pos-deg"],
        rows: [0.55, 0.9],
        cols: [0, 10, 15, 20, 35],
        data: [
          [11, 11.5, 11, 11, 10.5],
          [7.4, 7.4, 7.4, 7.4, 7.4],
        ],
      },
    },
  ],
};
const ALPHA_MAX: Table = {
  vars: ["velocities/mach", "fcs/flap-pos-deg", "fcs/slat-pos-deg"],
  pages: [
    {
      bp: 0,
      table: {
        vars: ["velocities/mach", "fcs/flap-pos-deg"],
        rows: [0.2, 0.55, 0.9],
        cols: [0, 10, 15],
        data: [
          [11.7, 15, 14.5],
          [11.4, 11.4, 11.4],
          [7.8, 7.8, 7.8],
        ],
      },
    },
    {
      bp: 18,
      table: {
        vars: ["velocities/mach", "fcs/flap-pos-deg"],
        rows: [0.2, 0.55, 0.9],
        cols: [0, 10, 15],
        data: [
          [15, 15, 14.5],
          [11.4, 11.4, 11.4],
          [7.8, 7.8, 7.8],
        ],
      },
    },
  ],
};

/** The incidences of the protections [deg]: α prot, α floor (the FADEC's: 9.5° clean, 15° in CONF 1–2, 14° in 3, 13°
 *  in FULL), α max. */
export function alphaLimits(mach: number, slat: number, flap: number): { prot: number; floor: number; max: number } {
  const b = { "velocities/mach": mach, "fcs/flap-pos-deg": flap, "fcs/slat-pos-deg": slat };
  const prot = evaluate(["table", ALPHA_PROT], b);
  const max = evaluate(["table", ALPHA_MAX], b);
  const floor = slat < 1 ? 9.5 : flap < 17 ? 15 : flap < 25 ? 14 : 13;
  return { prot, floor: Math.min(floor, max - 0.3), max };
}

/** The A320's own figures in the flight's context (pilot.ts air.airbus). */
export interface AirbusCtx {
  /** the pitch attitude [rad], the slats' and flaps' angles [deg], the equivalent airspeed [kt], the height of the
   *  wheels over the ground [m] (none: far), the law */
  pitch: number;
  slat: number;
  flap: number;
  ias: number;
  agl?: number;
  law: "normal" | "alternate" | "direct";
  /** an autopilot flying (the flare mode is its own then) */
  ap?: boolean;
}

/** What the law asks this frame. */
export interface AirbusOut {
  /** the rates wanted (pilot.ts's: pitch up, yaw right, roll LEFT) [rad/s] */
  want: [number, number, number];
  alphaProt: boolean;
  alphaFloor: boolean;
  highSpeed: boolean;
  flare: boolean;
  /** the bank and pitch limits flown now [rad] */
  bankMax: number;
}

/** The flight's figures the law reads (pilot.ts's air context). */
export interface LawState {
  alpha: number;
  beta: number;
  gamma: number;
  bank: number;
  /** the flight path's turn (pilot.ts's sign: pitch up, yaw right, roll left) [rad/s] */
  path: [number, number, number];
  speed: number;
  mach: number;
  nz: number;
  ground: boolean;
  /** the autopilot's commands (game/jet.ts): the flight path angle, the bank */
  gammaCmd?: number | null;
  bankCmd?: number | null;
}

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

export class AirbusLaw {
  private gammaHold: number | null = null;
  private bankHold: number | null = null;
  private nInt = 0;
  private gammaPrev: number | null = null;
  private inProt = false;
  private flareRef: number | null = null;
  private flareT = 0;
  /** the speed's trend [kt/s], the last speed (the high speed protection anticipates: the speed 6 s on) */
  private iasDot = 0;
  private iasPrev: number | null = null;

  reset() {
    this.gammaHold = this.bankHold = this.gammaPrev = this.flareRef = this.iasPrev = null;
    this.iasDot = 0;
    this.nInt = this.flareT = 0;
    this.inProt = false;
  }

  /**
   * The rates for the stick (−1…1: pitch aft > 0, yaw right > 0, roll right > 0) — the normal or the alternate law
   * (the direct and ground laws are pilot.ts's own).
   */
  step(P: LawState, A: AirbusCtx, stick: { pitch: number; roll: number; yaw: number }, dt: number): AirbusOut {
    const V = Math.max(P.speed, 30);
    const k = G / V;
    const normal = A.law === "normal";
    const lim = alphaLimits(P.mach, A.slat, A.flap);
    const alphaDeg = P.alpha / D;
    const gdot = this.gammaPrev !== null && dt > 0 ? (P.gamma - this.gammaPrev) / dt : 0;
    this.gammaPrev = P.gamma;
    // ---- the protections' state
    const vmo = 350;
    if (this.iasPrev !== null && dt > 0) this.iasDot += ((A.ias - this.iasPrev) / dt - this.iasDot) * Math.min(dt / 1.5, 1);
    this.iasPrev = A.ias;
    // (the speed 6 s on: the protection pulls before VMO + 6 is passed in a dive)
    const iasAhead = A.ias + 6 * Math.max(this.iasDot, 0);
    const highSpeed = normal && (iasAhead > vmo + 6 || P.mach > 0.83);
    // (α prot: entered past it — the stick not pushed —, left once below it by 2° or the stick pushed)
    if (normal && !P.ground && (A.agl ?? 1e4) > 30 && alphaDeg > lim.prot && stick.pitch >= 0) this.inProt = true;
    if (!normal || P.ground || alphaDeg < lim.prot - 2 || stick.pitch < -0.5) this.inProt = false;
    const alphaFloor = normal && !P.ground && (A.agl ?? 1e4) > 30 && alphaDeg > lim.floor;
    const bankMax = (normal ? (this.inProt || highSpeed ? 45 : 67) : 67) * D;
    // ---- the flare mode: below 50 ft on an approach, the attitude memorised, then 2° nose down over 8 s
    const flareZone = normal && !A.ap && A.agl !== undefined && A.agl < 15.2 && P.gamma < 0.02 && A.flap > 10;
    if (flareZone && this.flareRef === null) {
      this.flareRef = A.pitch;
      this.flareT = 0;
    }
    if (!flareZone && (A.agl === undefined || A.agl > 30 || P.ground)) this.flareRef = null;
    const flare = this.flareRef !== null;
    // ---- pitch
    let wantP: number;
    const nMax = A.flap > 1 ? 2 : 2.5;
    const nMin = A.flap > 1 ? 0 : -1;
    if (flare) {
      // (the stick on the pitch rate, about an attitude falling 2° in 8 s — the flare is the pilot's)
      this.flareT += dt;
      const ref = this.flareRef! - Math.min(this.flareT / 8, 1) * 2 * D;
      wantP = 0.8 * (ref - A.pitch) + stick.pitch * 5 * D;
      this.gammaHold = null;
    } else if (this.inProt) {
      // (the incidence law: α prot let go, α max full aft)
      const aCmd = (stick.pitch > 0 ? lim.prot + stick.pitch * (lim.max - lim.prot) : lim.prot + stick.pitch * 4) * D;
      wantP = P.path[0] + 1.5 * (aCmd - P.alpha);
      this.gammaHold = null;
    } else if (stick.pitch !== 0 || highSpeed) {
      // (the load factor: the flight path's 1 g corrected for the bank, plus the stick's share of the limits; past VMO
      // the high speed protection's nose-up order — 0.08 g a knot over, the stick forward's authority halved)
      const base = Math.cos(P.gamma) / Math.cos(clamp(P.bank, -33 * D, 33 * D));
      const sp = highSpeed && stick.pitch < 0 ? stick.pitch / 2 : stick.pitch;
      let nCmd = clamp(sp > 0 ? base + sp * (nMax - 1) : base + -sp * (nMin - 1), nMin, nMax);
      if (highSpeed) nCmd = Math.min(Math.max(nCmd, base + 0.08 * Math.max(iasAhead - vmo - 6, (P.mach - 0.83) * 600, 0)), nMax);
      this.nInt = clamp(this.nInt + (nCmd - P.nz) * dt, -0.5, 0.5);
      wantP = P.path[0] + k * (3 * (nCmd - P.nz) + 2 * this.nInt);
      this.gammaHold = null;
    } else {
      // (let go: the flight path held — the one it settles on once the load is back to 1 g)
      this.nInt = 0;
      if (P.gammaCmd != null) this.gammaHold = P.gammaCmd;
      if (this.gammaHold === null && Math.abs(gdot) < 0.02) this.gammaHold = P.gamma;
      wantP =
        this.gammaHold === null
          ? P.path[0] + k * 3 * (Math.cos(P.gamma) / Math.cos(clamp(P.bank, -33 * D, 33 * D)) - P.nz)
          : P.path[0] + 1.0 * (this.gammaHold - P.gamma) - 1.2 * gdot;
    }
    // (α max: never past it — the stick's full aft in the protection holds it there)
    if (normal) wantP = Math.min(wantP, P.path[0] + 2 * (lim.max * D - P.alpha));
    // (the load factor kept within its limits, whatever asked)
    const g1 = Math.cos(P.gamma) * Math.cos(P.bank);
    wantP = clamp(wantP, (nMin - 0.2 - g1) * k, (nMax + 0.2 - g1) * k);
    if (normal) {
      // (the pitch attitude: +30° — 25° slow in CONF FULL — and −15°, approached softly)
      const up = (A.flap > 30 && A.ias < 160 ? 25 : 30) * D;
      wantP = Math.min(wantP, 0.6 * (up - A.pitch));
      wantP = Math.max(wantP, 0.6 * (-15 * D - A.pitch));
      // (high speed: a nose-up order growing past VMO + 6 kt, the stick forward's authority halved)
    }
    // ---- roll (the pilot's sign: left > 0)
    let wantR: number;
    const rollRate = 15 * D;
    if (stick.roll !== 0) {
      wantR = -stick.roll * rollRate;
      this.bankHold = null;
      // (the bank limit: the stick held, the roll stops there)
      if (P.bank > bankMax - 2 * D && stick.roll > 0) wantR = Math.max(wantR, 0.8 * (P.bank - bankMax));
      if (P.bank < -bankMax + 2 * D && stick.roll < 0) wantR = Math.min(wantR, 0.8 * (P.bank + bankMax));
    } else {
      // (let go: the bank held up to 33° — 0 in high speed, past 33° brought back to it —, the autopilot's asked)
      if (P.bankCmd != null) this.bankHold = P.bankCmd;
      if (this.bankHold === null) this.bankHold = Math.abs(P.bank) < 1 * D ? 0 : P.bank;
      if (normal) this.bankHold = clamp(this.bankHold, -33 * D, 33 * D);
      if (highSpeed) this.bankHold = 0;
      wantR = 0.8 * (P.bank - this.bankHold);
      wantR = clamp(wantR, -rollRate, rollRate);
    }
    // ---- yaw: the turn coordinated (the sideslip killed), the pedals a sideslip
    const wantY = P.ground ? stick.yaw * 0.3 : P.path[1] - 2 * P.beta + stick.yaw * 0.05;
    return { want: [wantP, wantY, wantR], alphaProt: this.inProt, alphaFloor, highSpeed, flare, bankMax };
  }
}
