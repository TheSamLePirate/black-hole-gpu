// The F-35C on a carrier's wires and catapults (docs/PLAN-AVIATION-AAA.md, M3): the landing area's axis, the hook's
// place on it, the wire it crosses on the deck — caught, the craft stopped in some 100 m —, the bolter past the last;
// the autopilot's approach down the glide path at its approach speed, lined up on the angled deck's axis as it moves;
// the LSO's calls and grade of the pass (as on the real carriers: _OK_, OK, Fair, No grade, Cut; B a bolter, WO a
// wave-off); the catapults' strokes. Pure: the ship's pose, our place and velocity fixed to the Earth in.

import { CARRIER, type CarrierId, type CarrierPose, type CarrierSpawn, fromDeck, LANDING, type LandingArea, toDeck } from "./carrier";
import { deckVelocity, enuOf } from "./deckland";
import { holdRadius, type Racetrack, racetrackHeading } from "./racetrack";

type V3 = [number, number, number];

/** The hook's tip from the craft's reference point (its frame: along the nose, up) [m]; the arresting gear's run
 *  [m] and its pull at most [g]; the wire caught only within this of the deck [m]. */
export const HOOK = { back: 7.2, down: 1.08, run: 100, gMax: 4.5, reach: 0.9 };

/** The approach: its speed's lift coefficient (on-speed: some 12° of incidence); the gate on the axis astern [m];
 *  in close [m]; the wave-off's limits (low [°], off the axis [m]). */
export const TRAP = { clApp: 1.0, gate: 6000, close: 450, waveLow: -1.4, waveLineup: 15 };

/** The catapults (their frame: from where the shuttle holds the nose wheel, their way, their stroke [m]) and the
 *  speed over the deck at its end [m/s]. */
export const CATS: Partial<Record<CarrierId, { x: number; z: number; dir: [number, number]; len: number }[]>> = {
  ford: [
    { x: -11, z: 58, dir: [0, 1], len: 94 },
    { x: 11, z: 58, dir: [0, 1], len: 94 },
  ],
};
export const CAT_END = 72;

const D = Math.PI / 180;
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const add = (a: readonly number[], b: readonly number[]): V3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
const scale = (a: readonly number[], k: number): V3 => [a[0]! * k, a[1]! * k, a[2]! * k];
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const len = (a: readonly number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** The landing area's axis on the deck: its way (x, z), across it to port, and a deck point's place along it from
 *  the hook's aim [m] and across it [m]. */
export function axisOf(L: LandingArea) {
  const a = L.angle * D;
  const ax: [number, number] = [Math.sin(a), Math.cos(a)];
  const across: [number, number] = [Math.cos(a), -Math.sin(a)];
  const at = (x: number, z: number) => {
    const dx = x - L.aim[0],
      dz = z - L.aim[1];
    return { s: dx * ax[0] + dz * ax[1], e: dx * across[0] + dz * across[1] };
  };
  return { ax, across, at, wires: L.wires.map(([x, z]) => at(x, z).s) };
}

/** The hook's tip on the deck's frame [m], from our reference point's and our nose and top there. */
export function hookAt(l: readonly number[], fwd: readonly number[], up: readonly number[]): V3 {
  return sub(sub(l, scale(fwd, HOOK.back)), scale(up, HOOK.down));
}

/**
 * The wire the hook caught between two frames (its tip then and now, the deck's frame), 1… — none: 0. On the deck
 * (its tip within HOOK.reach of it), within the landing area's width, crossing the wire's line forwards.
 */
export function wireCaught(kind: CarrierId, h0: readonly number[], h1: readonly number[]): number {
  const L = LANDING[kind];
  if (!L) return 0;
  const A = axisOf(L);
  const deckY = CARRIER[kind].deck;
  if (Math.min(h0[1]!, h1[1]!) - deckY > HOOK.reach) return 0;
  const a = A.at(h0[0]!, h0[2]!),
    b = A.at(h1[0]!, h1[2]!);
  if (Math.abs(b.e) > L.half) return 0;
  for (let i = 0; i < A.wires.length; i++) if (a.s < A.wires[i]! && b.s >= A.wires[i]!) return i + 1;
  return 0;
}

/** The arresting gear's pull for a speed over the deck along the axis at the catch [m/s]: steady, the craft
 *  stopped within its run [m/s²]. */
export const wirePull = (v0: number) => Math.min((v0 * v0) / (2 * (HOOK.run - 5)), HOOK.gMax * 9.80665);

/** The approach speed of a mass [m/s] (its lift at on-speed incidence over the wing — sea level). */
export const approachSpeed = (mass: number, S: number) => Math.sqrt((2 * mass * 9.80665) / (1.225 * S * TRAP.clApp));

export type TrapPhase = "inbound" | "final" | "touch" | "trapped" | "bolter" | "waveoff" | "done";
export type TrapGrade = "_OK_" | "OK" | "Fair" | "No grade" | "Cut" | "B" | "WO";
export const GRADE_POINTS: Record<TrapGrade, number> = { _OK_: 5, OK: 4, Fair: 3, B: 2.5, "No grade": 2, WO: 1, Cut: 0 };

export interface TrapRun {
  kind: CarrierId;
  phase: TrapPhase;
  t: number;
  /** the glide path's error [°, + high] and the line-up's [m, + to port] at their worst in each part of the pass:
   *  the start, in the middle, in close, at the ramp */
  worst: { X: [number, number]; IM: [number, number]; IC: [number, number]; AR: [number, number] };
  /** the LSO's last call, when [s of the run]; the ball called */
  said: { at: number; what: string } | null;
  ball: boolean;
  /** the wire caught (0: none) and the grade, once given */
  wire: number;
  grade?: TrapGrade;
  /** on the deck since [s] (a bolter: rolled past the last wire) */
  down?: number;
  /** intercepting the axis astern (a localizer's way) */
  loc?: boolean;
  /** an intercept let go short of the final: the next one only homing, closing, with the room to close */
  missed?: boolean;
  /** why it was waved off (the glide path's error, the line-up, the distance) */
  why?: string;
  /** the recovery's case (P4): I — the overhead break, day and clear —, II — the descent then the break —, III —
   *  the marshal and the straight-in, night or weather —; straight: the straight-in from the gate (the quals') */
  case?: RecoveryCase;
  /** its leg now (the pattern's; "groove": handed to the final's intercept) */
  leg?: CaseLeg;
  /** laps in the marshal's hold left (Case III) */
  marshal?: number;
  holdS?: number;
  /** the height held until the glide path is met [m over the sea] (the platform's: Case III, II) */
  platform?: number;
  /** on the final, now: the glide path's error [°, + high], the line-up [m, + to port], the distance to the hook's
   *  aim [m] (the instructor's — A4) */
  now?: { err: number; lineup: number; dist: number };
}

export type RecoveryCase = "I" | "II" | "III" | "straight";
export type CaseLeg = "initial" | "upwind" | "break" | "downwind" | "the180" | "marshal" | "penetration" | "groove";

/** The patterns' figures [m, m/s]: Case I's initial 3 NM astern at 800 ft, 350 kt; the break past the bow; the
 *  downwind at 600 ft, 1.2 NM abeam to port; the 180 begun 600 m past abeam the aim; Case III's marshal 21 NM astern
 *  on the final bearing at 6 000 ft, the descent to 1 200 ft by 10 NM (dirty there), the platform held to the
 *  glide path; Case II's descent to 800 ft by 10 NM, then the initial. */
export const CASE = {
  initial: 5500,
  initialH: 245,
  initialV: 180,
  breakPast: 900,
  downwindH: 185,
  abeam: 2200,
  start180: 1300,
  marshal: 39_000,
  marshalH: 1830,
  tenMiles: 18_500,
  platformH: 365,
  caseIIH: 245,
  descentV: 130,
};

export const newTrapRun = (kind: CarrierId): TrapRun => ({
  kind,
  phase: "inbound",
  t: 0,
  worst: { X: [0, 0], IM: [0, 0], IC: [0, 0], AR: [0, 0] },
  said: null,
  ball: false,
  wire: 0,
});

/** What the guidance asks the jet: its flight path [rad], bank [rad], speed [m/s]; full power (a wave-off, a
 *  bolter, the touchdown's insurance). */
export interface TrapOut {
  gamma: number;
  bank: number;
  spd: number;
  full: boolean;
  /** the LSO's call this frame, if any */
  call?: string;
}

/** The pass's grade from its worst errors and the wire (none: a bolter). */
export function gradePass(R: TrapRun): TrapGrade {
  if (R.phase === "waveoff") return "WO";
  if (!R.wire) return "B";
  const W = R.worst;
  const lowClose = Math.min(W.IC[0], W.AR[0]);
  const errClose = Math.max(Math.abs(W.IC[0]), Math.abs(W.AR[0]));
  const lineClose = Math.max(Math.abs(W.IC[1]), Math.abs(W.AR[1]));
  const errAll = Math.max(errClose, Math.abs(W.IM[0]));
  if (lowClose < -1.0) return "Cut";
  if (errClose > 0.75 || lineClose > 6) return "No grade";
  if (errAll > 0.5 || lineClose > 3) return "Fair";
  if (errAll <= 0.25 && lineClose <= 1.5 && R.wire === 2) return "_OK_";
  return "OK";
}

/**
 * A frame of the approach: our place, velocity [m/s] and airspeed, our reference point's and hook's places on the
 * deck's frame, on its wheels; the ship's spawn and pose; the approach speed; dt [s]. Its phase moved on; what to fly.
 */
export function trapStep(
  R: TrapRun,
  own: { p: readonly number[]; v: readonly number[]; V: number; hook: readonly number[]; down: boolean; caught?: boolean },
  sp: CarrierSpawn,
  P: CarrierPose,
  vApp: number,
  dt: number,
): TrapOut | null {
  R.t += dt;
  const L = LANDING[R.kind]!;
  const A = axisOf(L);
  const deckY = CARRIER[R.kind].deck;
  const { E, N, U } = enuOf(own.p);
  // the axis on the Earth (its way along the deck, level), the deck's motion at the aim
  const aim = fromDeck(P, [L.aim[0], deckY, L.aim[1]]);
  const axE = sub(fromDeck(P, [L.aim[0] + A.ax[0], deckY, L.aim[1] + A.ax[1]]), aim);
  const axH = (() => {
    const f = sub(axE, scale(U, dot(axE, U)));
    return scale(f, 1 / (len(f) || 1));
  })();
  const vDeck = deckVelocity(P, aim);
  const h = A.at(own.hook[0]!, own.hook[2]!);
  const vRel = sub(own.v, vDeck);
  const bearing = (w: readonly number[]) => Math.atan2(dot(w, E), dot(w, N));
  // (the glide path's error at the hook [°] — its height over the deck against the path's at its distance — and the
  // line-up's [m])
  const dist = Math.max(-h.s, 1);
  const err = Math.atan2(own.hook[1]! - deckY, dist) / D - L.glide;
  const lineup = h.e;
  // (our speed across the axis, to port [m/s])
  const eRate = dot(vRel, sub(fromDeck(P, [L.aim[0] + A.across[0], deckY, L.aim[1] + A.across[1]]), aim));
  if (R.phase === "done" || R.phase === "trapped") return null;
  // on the deck: full power (a bolter's insurance) until the wire takes it; past the last wire, a bolter
  if (own.down && (R.phase === "final" || R.phase === "touch")) {
    R.phase = "touch";
    R.down ??= R.t;
    if (!own.caught && h.s > A.wires[A.wires.length - 1]! + 5) {
      R.phase = "bolter";
      R.grade = "B";
      return { gamma: 8 * D, bank: 0, spd: vApp + 15, full: true, call: "Bolter, bolter, bolter!" };
    }
    return { gamma: 0, bank: 0, spd: vApp, full: true };
  }
  // (past the hook's aim and not down — floated over the wires —: a bolter as well)
  if (R.phase === "final" && h.s > 30 && !own.down && !own.caught) {
    R.phase = "bolter";
    R.grade = "B";
    return { gamma: 8 * D, bank: 0, spd: vApp + 15, full: true, call: "Bolter, bolter, bolter!" };
  }
  if (R.phase === "bolter" || R.phase === "waveoff") {
    // (off and climbing, then round again: back to the gate)
    if (own.p && dot(sub(own.p, aim), U) > 250) {
      R.phase = "inbound";
      R.ball = false;
      R.loc = false;
      // (a pattern's bolter: round again by its own way — upwind to the break; Case III's, down the final bearing)
      if (R.case && R.case !== "straight") {
        R.leg = R.case === "III" ? "penetration" : "upwind";
        R.platform = undefined;
      }
      R.worst = { X: [0, 0], IM: [0, 0], IC: [0, 0], AR: [0, 0] };
    }
    return { gamma: 8 * D, bank: 0, spd: vApp + 20, full: true };
  }
  if (R.phase === "inbound" && R.case && R.case !== "straight" && R.leg && R.leg !== "groove") {
    const out = casePattern(R, own, { aim, axH, U, E, N, vDeck, deckY, P, glide: L.glide, lineup, eRate }, vApp, dt);
    if (out) return out;
  }
  if (R.phase === "inbound") {
    const gate = add(aim, add(scale(axH, -TRAP.gate), scale(U, TRAP.gate * Math.tan(L.glide * D) + 30)));
    const e = sub(gate, own.p);
    const eh = sub(e, scale(U, dot(e, U)));
    const d = len(eh);
    const vh = sub(own.v, scale(U, dot(own.v, U)));
    const closingV = Math.max(len(vh) - dot(vDeck, scale(vh, 1 / (len(vh) || 1))), 20);
    const lead = add(gate, scale(vDeck, d / closingV));
    // (astern of it, within 3 km of its axis: onto the axis as a localizer is intercepted — at an angle as the gap
    // asks, 45° at most —, the final once on it; else the run to the gate)
    const along = dot(sub(own.p, aim), axH);
    // (the intercept, once begun, kept on to 1.2 km: else, crossing back and forth over 2.5 km, it went round and
    // round between it and the gate)
    // (a pattern's groove — after Case I's 180 — handed over in close: latched from 1 800 m, kept to 400 m)
    // (one let go short of the final: the next only heading for the ship within 45° of the axis, closing on it, with
    // the room to close the gap — half what is left before it lets go —: after a bolter in a heavy sea, round again,
    // it went for the axis while running astern for the gate, turned about across it, crossed it a kilometre or two
    // over, was still off it at 1.2 km, ran astern for the gate again; homing but 3 km across, or drawing away from
    // it, never on it in time either)
    const groove = R.leg === "groove" && R.case !== "straight";
    const homing = dot(vh, axH) > 0.7 * len(vh) && lineup * eRate <= 0;
    const room = -along - (groove ? 400 : 1200);
    const retry = homing && Math.abs(lineup) < 0.5 * room;
    if (along < (groove ? -900 : -2500) && Math.abs(lineup) < 3000 && (!R.missed || retry)) {
      R.loc = true;
      R.missed = false;
    }
    if (R.loc && (along > (groove ? -400 : -1200) || Math.abs(lineup) > 4000)) {
      R.loc = false;
      R.missed = true;
    }
    if (R.loc) {
      const axisBrg = bearing(axH);
      // (the gap foreseen 8 s on — the turn onto it begun before it, as a pilot leads a localizer's)
      const want = axisBrg + clamp(0.0015 * (lineup + 8 * eRate), -45 * D, 45 * D);
      let dw = want - bearing(vh);
      dw = Math.atan2(Math.sin(dw), Math.cos(dw));
      // (on it: near it, along it, not crossing it fast — else the final's 20° of bank could not stop the crossing)
      // (and with a platform held — Case III —, once the glide path has come down to it)
      const pathMet = R.platform === undefined || deckY - along * Math.tan(L.glide * D) <= dot(sub(own.p, aim), U) + deckY + 15;
      if (Math.abs(lineup) < 60 && Math.abs(eRate) < 6 && dot(vh, axH) > 0.96 * len(vh) && pathMet) R.phase = "final";
      // (down to the glide path's height for where it is along the axis — a little over it —, slowing to the
      // approach's speed: on the final already settled)
      const hT = Math.min(deckY + -along * Math.tan(L.glide * D) + 20, R.platform ?? Infinity);
      const hNow = dot(sub(own.p, aim), U) + deckY;
      const gammaL = clamp(Math.atan2(hT - hNow, 1500), -6 * D, 4 * D);
      return { gamma: gammaL, bank: clamp(1.5 * dw, -25 * D, 25 * D), spd: vApp + 8, full: false };
    }
    const hdg = bearing(sub(lead, own.p));
    const now = bearing(vh);
    let dh = hdg - now;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const bank = clamp(2 * dh, -30 * D, 30 * D);
    const gamma = clamp(Math.atan2(dot(e, U), Math.max(d, 600)), -6 * D, 6 * D);
    return { gamma, bank, spd: d > 6000 ? 140 : vApp + 25, full: false };
  }
  // the final: lined up on the axis as it moves, down the glide path at the approach speed
  // (two loops: the speed across the axis asked by the gap — 20 m/s at most —, the bank closing that speed's error)
  const eRateWant = clamp(-0.1 * lineup, -25, 25);
  const aLat = 0.35 * (eRateWant - eRate);
  // (a positive bank turns right — to starboard —, the line-up positive to port: a lateral push to port asks a left bank)
  const bank = clamp(-Math.atan2(aLat, 9.80665), -20 * D, 20 * D);
  const closing = Math.max(dot(vRel, axH), 10);
  // (the path's descent, the height's error closed over some 5 s; in close no flare — the deck's ground effect
  // floated it high over the ramp —: a little more down)
  // (and over the ramp, the deck's ground effect floating it high: a little more down)
  const vzRel = -closing * Math.tan(L.glide * D) - (dist < 400 ? 0.32 : 0.2) * (Math.tan(err * D) * dist) - (dist < 200 ? 0.4 : 0);
  const vz = vzRel + dot(vDeck, U);
  const vg = len(sub(own.v, scale(U, dot(own.v, U))));
  const gamma = Math.atan2(vz, Math.max(vg, 1));
  R.now = { err, lineup, dist };
  // (the last 60 m: the ball no longer read — the hook over the ramp, the deck under it —: nothing judged, nothing
  // called; the glide path flown on)
  if (dist < 60) return { gamma, bank, spd: vApp, full: false };
  // (the pass's errors, at their worst in each part)
  const part = dist > 1300 ? null : dist > 900 ? "X" : dist > TRAP.close ? "IM" : dist > 150 ? "IC" : "AR";
  if (part) {
    const w = R.worst[part];
    if (Math.abs(err) > Math.abs(w[0])) w[0] = err;
    if (Math.abs(lineup) > Math.abs(w[1])) w[1] = lineup;
  }
  // (the wave-off: low in close, or far off the axis)
  if (dist < TRAP.close && (err < TRAP.waveLow || Math.abs(lineup) > TRAP.waveLineup)) {
    R.why = `${err.toFixed(2)}° ${lineup.toFixed(1)} m at ${dist.toFixed(0)} m`;
    R.phase = "waveoff";
    R.grade = "WO";
    return { gamma: 8 * D, bank: 0, spd: vApp + 20, full: true, call: "Wave off, wave off!" };
  }
  // the LSO's calls: the ball, then what is off, a call every 3 s at most
  let call: string | undefined;
  if (!R.ball && dist < 1300) {
    R.ball = true;
    call = "Roger ball.";
  } else if (R.ball && (!R.said || R.t - R.said.at > 3)) {
    if (err < -0.9 && dist < 900) call = "Power!";
    else if (err < -0.45) call = "You're low.";
    else if (err > 0.6) call = "You're high.";
    else if (lineup > 4) call = "Right for line-up.";
    else if (lineup < -4) call = "Come left.";
  }
  if (call) R.said = { at: R.t, what: call };
  return { gamma, bank, spd: vApp, full: false, call };
}

/**
 * A frame of a recovery's pattern (P4 — Case I, II, III) until its groove, the ship's moving frame read as the final's
 * is (its stabilised pose): what to fly, or null once handed to the final's intercept.
 */
function casePattern(
  R: TrapRun,
  own: { p: readonly number[]; v: readonly number[] },
  G: {
    aim: V3;
    axH: V3;
    U: V3;
    E: V3;
    N: V3;
    vDeck: V3;
    deckY: number;
    P: CarrierPose;
    glide: number;
    lineup: number;
    eRate: number;
  },
  vApp: number,
  dt: number,
): TrapOut | null {
  const { aim, axH, U, E, N, vDeck, deckY } = G;
  const level = (w: readonly number[]) => {
    const f = sub(w, scale(U, dot(w, U)));
    return scale(f, 1 / (len(f) || 1));
  };
  const bow = level(G.P.bow);
  const port = level(G.P.port);
  const bearing = (w: readonly number[]) => Math.atan2(dot(w, E), dot(w, N));
  const rel = sub(own.p, aim);
  const s = dot(rel, bow);
  const x = dot(rel, port);
  const h = dot(rel, U) + deckY;
  const vh = sub(own.v, scale(U, dot(own.v, U)));
  const trk = bearing(vh);
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const steer = (want: number, max = 30 * D) => clamp(2 * wrap(want - trk), -max, max);
  const climbTo = (hT: number, run = 2500, lo = -6, hi = 6) => clamp(Math.atan2(hT - h, run), lo * D, hi * D);
  /** to a point moving with the ship (led by where it will be on our arrival) */
  const toward = (T: V3) => {
    const e = sub(T, own.p);
    const d = len(sub(e, scale(U, dot(e, U))));
    const lead = add(T, scale(vDeck, d / Math.max(len(vh) - dot(vDeck, level(vh)), 30)));
    return { brg: bearing(sub(lead, own.p)), d };
  };
  switch (R.leg) {
    case "marshal": {
      // (the marshal: its fix on the final bearing astern, a hold there as many laps as asked; inside it already and
      // none asked: the descent from here)
      const fix = add(aim, scale(axH, -CASE.marshal));
      const t = toward(fix);
      const along = dot(rel, axH);
      if (!R.marshal && along > -CASE.marshal + 2000) {
        R.leg = "penetration";
        return { gamma: 0, bank: 0, spd: CASE.descentV, full: false, call: "Commencing" };
      }
      if (t.d > 2500 && !R.holdS) return { gamma: climbTo(CASE.marshalH), bank: steer(t.brg), spd: CASE.descentV, full: false };
      R.holdS = (R.holdS ?? 0) + dt;
      const inb = bearing(axH);
      const T: Racetrack = { inbound: inb, leg: 8000, radius: holdRadius(Math.max(len(vh), 100)) };
      const pf = sub(own.p, fix);
      const hd = racetrackHeading(T, [dot(pf, E), dot(pf, N)], 1500);
      if (t.d < 1500 && Math.cos(wrap(trk - inb)) > 0.8 && R.holdS > 60) {
        R.marshal = Math.max((R.marshal ?? 0) - 1, 0);
        R.holdS = 1e-3;
        if (!R.marshal) {
          R.leg = "penetration";
          return { gamma: 0, bank: 0, spd: CASE.descentV, full: false, call: "Commencing" };
        }
      }
      return { gamma: climbTo(CASE.marshalH), bank: steer(hd.hdg), spd: CASE.descentV, full: false };
    }
    case "penetration": {
      // (down the final bearing to ten miles — 1 200 ft for Case III, dirty there; 800 ft for Case II, then the
      // initial)
      const hT = R.case === "III" ? CASE.platformH : CASE.caseIIH;
      const ten = add(aim, scale(axH, -CASE.tenMiles));
      const along = dot(rel, axH);
      const t = toward(ten);
      if (along > -CASE.tenMiles - 1500 && Math.abs(G.lineup) < 3000) {
        if (R.case === "III") {
          R.leg = "groove";
          R.platform = CASE.platformH;
          return null;
        }
        R.leg = "initial";
        return { gamma: climbTo(hT), bank: 0, spd: CASE.initialV, full: false };
      }
      const call = R.case === "III" && t.d < 4000 ? "Platform" : undefined;
      const gamma = climbTo(hT, Math.max(t.d * 0.6, 2500), -8, 4);
      return { gamma, bank: steer(t.brg), spd: CASE.descentV, full: false, call };
    }
    case "initial": {
      const T = add(add(aim, scale(bow, -CASE.initial)), scale(U, CASE.initialH - deckY));
      const t = toward(T);
      if (t.d < 900 || (s > -CASE.initial && s < -1000 && Math.abs(x) < 900 && Math.cos(wrap(trk - bearing(bow))) > 0.9)) {
        R.leg = "upwind";
        return { gamma: climbTo(CASE.initialH), bank: steer(bearing(bow)), spd: CASE.initialV, full: false, call: "Initial" };
      }
      return { gamma: climbTo(CASE.initialH), bank: steer(t.brg), spd: CASE.initialV, full: false };
    }
    case "upwind": {
      // (up the ship's course over its starboard side, to the break past the bow)
      if (s > CASE.breakPast) {
        R.leg = "break";
        return { gamma: 0, bank: -60 * D, spd: vApp + 15, full: false, call: "Break" };
      }
      const want = bearing(bow) + clamp(0.0008 * (x + 150), -20 * D, 20 * D);
      return { gamma: climbTo(CASE.initialH), bank: steer(want), spd: CASE.initialV, full: false };
    }
    case "break": {
      // (a hard level turn to port, slowing, down to the downwind's height; out of it on the reciprocal course)
      const recip = bearing(bow) + Math.PI;
      if (Math.abs(wrap(trk - recip)) < 15 * D) {
        R.leg = "downwind";
        return { gamma: climbTo(CASE.downwindH), bank: 0, spd: vApp, full: false, call: "Abeam" };
      }
      return { gamma: climbTo(CASE.downwindH, 3000), bank: -60 * D, spd: vApp + 15, full: false };
    }
    case "downwind": {
      // (the reciprocal course 1.2 NM abeam to port, at 600 ft, on speed; the 180 begun past abeam the aim)
      if (s < -CASE.start180) {
        R.leg = "the180";
        return { gamma: climbTo(150), bank: -27 * D, spd: vApp, full: false, call: "The 180" };
      }
      const want = bearing(bow) + Math.PI + clamp(0.0008 * (x - CASE.abeam), -20 * D, 20 * D);
      return { gamma: climbTo(CASE.downwindH), bank: steer(want), spd: vApp, full: false };
    }
    case "the180": {
      // (a descending turn to port onto the angled deck's axis, its bank for a 1.1 km radius; into the groove when
      // nearly on it)
      // (its radius half our distance abeam the angled deck's axis — round onto it —; handed to the groove's
      // intercept once the track closes it at 40°, the localizer's law leading the roll-out)
      const ax = bearing(axH);
      const off = Math.abs(wrap(trk - ax));
      if (off < 12 * D || (off < 40 * D && Math.abs(G.lineup) < 150)) {
        R.leg = "groove";
        return null;
      }
      // (the radius that rolls out on the axis — the gap closed as the heading comes round: gap = r (1 − cos off))
      const v = Math.max(len(vh), 50);
      const r = Math.max(Math.abs(G.lineup), 100) / Math.max(1 - Math.cos(off), 0.05);
      const bank = -clamp(Math.atan2(v * v, 9.80665 * r), 12 * D, 40 * D);
      return { gamma: climbTo(130, 1500), bank, spd: vApp, full: false };
    }
  }
  return null;
}

/** Where the craft's reference point and attitude are as the catapult's shuttle holds it (the deck's frame). */
export function catStart(kind: CarrierId, n: number): { l: V3; fwd: V3 } | null {
  const c = CATS[kind]?.[n];
  if (!c) return null;
  return { l: [c.x, CARRIER[kind].deck + HOOK.down, c.z], fwd: [c.dir[0], 0, c.dir[1]] };
}

/** The catapult's steady pull [m/s²]: CAT_END over the deck at its stroke's end. */
export const catPull = (stroke: number) => (CAT_END * CAT_END) / (2 * stroke);

export { toDeck };
