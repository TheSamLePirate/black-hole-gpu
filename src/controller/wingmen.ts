// The CameraController — the AI wingmen (docs/PLAN-AVIATION-AAA.md, F3): one to three F-35s flying with the
// flown one (game/aijet.ts: the real aircraft's forces and its law's way of flying), each its place in the flight
// (Two, Three, Four) in the formation chosen; the leader's orders carried out — the formation, the spacing, the
// break, the hold stacked by place, home, cover (the combat spread high), attack the leader's lock, engage the
// hostiles (in a fight: pursued, their AIM-120 and AIM-9X fired, the aggressors going after them too: hit, lost);
// their radio — the orders acknowledged, the contacts called, Fox, Splash, hit, down —; drawn, on the radar by
// the datalink, sent to the room (the host flies them).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { runwaySitesNear } from "../world/fieldsite";
import { AiJet, AIJET, type AiCmd, type Ground, headingOf } from "../game/aijet";
import { bankAccel, type FormCraft, type FormSlot, formationBank } from "../game/formation";
import { type CrossTurn, crossTurnNew, crossTurnStep, easeSlot, landingSlot, TAKEOFF, TAKEOFF_SLOTS } from "../game/formflow";
import { formSlotFor } from "./formation";
import { type IcptPhase, interceptStep } from "../game/intercept";
import { altHoldGamma, hdgHoldBank, wrapPi } from "../game/jet";
import { BREAK_BANK, type Order } from "../game/orders";
import { holdRadius, type Racetrack, racetrackHeading } from "../game/racetrack";
import { enu } from "../game/challenges";
import { gcCourse, gcDist } from "../game/flightplan";
import { SITES } from "../game/sites";
import type { RadarObject } from "../game/radar";
import { restPose, type F35Pose } from "../f35/model";
import { tr } from "../i18n";
import { cartToGeodetic, geodeticNormal, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { fallStep, startFall, type WreckFall } from "../game/wreckfall";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import { solarBody } from "../system/solar";
import { earthView } from "./netcraft";
import { unitsFor } from "../ui/unitsys";
import { fleet } from "../fleet";
import type { Vec3 } from "../math/vec3";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    wingStep: typeof wingStep;
    wingShips: typeof wingShips;
    wingOrder: typeof wingOrder;
    wingCount: typeof wingCount;
    wingHurt: typeof wingHurt;
    /** one of our wingmen's wreck crashed (where: the Earth's coordinates [m]; broken up in the air): the room told
     *  (ui/netmatch.ts) */
    onWingCrash?: (k: number, p: number[], broke: boolean) => void;
  }
}

type V3 = [number, number, number];
const D = Math.PI / 180;
const R_MEAN = 6_371_008.8;
const NAMES: Record<number, { fr: string; en: string }> = {
  2: { fr: "Deux", en: "Two" },
  3: { fr: "Trois", en: "Three" },
  4: { fr: "Quatre", en: "Four" },
};

export type WingMode = "form" | "free" | "break" | "hold" | "rtb" | "cover" | "attack" | "engage" | "ground" | "approach" | "rollout";

/** An AI wingman: its place (2…4), its craft, what it does, its state for each mode, its health and stores. */
export interface Wingman {
  k: number;
  jet: AiJet;
  mode: WingMode;
  phase: IcptPhase;
  mem: { iA: number; iU: number };
  /** the free flight's (after a break) heading and height held, the break's heading, the hold's racetrack */
  hdg: number;
  alt: number;
  brk: number | null;
  hold: { fix: { lat: number; lon: number }; R: Racetrack } | null;
  home: { lat: number; lon: number; name: string } | null;
  /** attack: the fight's target id it goes after; its missiles left, its next shot's time, those it fired */
  target: number | null;
  aim120: number;
  aim9x: number;
  nextShot: number;
  fired: { id: number; target: number; at: number }[];
  hp: number;
  alive: boolean;
  /** shot down: its wreck out of control to the ground (game/wreckfall.ts — a player's craft's fall), until it ends */
  wreck?: WreckFall | null;
  /** its slot's distance [m] (in formation, in cover), its last commands */
  dist: number;
  cmd: AiCmd | null;
  /** the slot flown now (moving to the formation's — game/formflow.ts), its tactical turn's state */
  now: FormSlot | null;
  turn: CrossTurn;
}

/** Another's AI wingman as the room sends it (10 times a second): its place, its velocity, its nose and top. */
export interface RemoteWing {
  k: number;
  p: number[];
  v: number[];
  f: number[];
  u: number[];
  /** shot down, falling to its crash */
  x?: 1;
}

/** A wingman's wreck still falling (shot down, not yet crashed). */
const fallingW = (w: Wingman) => !w.alive && !!w.wreck && !w.wreck.end;
/** A wingman as drawn and sent: its place, velocity, nose and top — alive, its craft's; falling, its wreck's. */
function poseOf(w: Wingman): { p: number[]; v: number[]; fwd: number[]; up: number[] } {
  if (w.wreck && !w.alive) return { p: w.wreck.p, v: w.wreck.v, fwd: w.wreck.fwd, up: w.wreck.up };
  const A = w.jet.axes();
  return { p: w.jet.p, v: w.jet.v, fwd: A.fwd, up: A.up };
}

/** Our wingmen as sent to the room. */
export function wingsOut(c: CameraController): RemoteWing[] {
  const r = (x: number, k = 10) => Math.round(x * k) / k;
  return (c.wing?.list ?? [])
    .filter((w) => w.alive || fallingW(w))
    .map((w) => {
      const P = poseOf(w);
      return {
        k: w.k,
        p: P.p.map((x) => r(x)),
        v: P.v.map((x) => r(x)),
        f: P.fwd.map((x) => r(x, 1000)),
        u: P.up.map((x) => r(x, 1000)),
        ...(w.alive ? {} : { x: 1 as const }),
      };
    });
}

/** The wingmen flying (null when none), the contacts already called (by radar id), the last call's time. */
export interface WingState {
  list: Wingman[];
  called: Set<string>;
  callAt: number;
  t: number;
  /** out of the air since (the flown craft on the ground, not an F-35): gone after 5 s */
  away: number;
  /** the leader's place last frame (a placing — a fight's start, a teleport —: mustered again about him) */
  lastP: number[] | null;
  /** a formation take-off: the runway's line (the leader's place and heading when mustered), when he began his roll */
  runway?: { p0: number[]; hdg: number; rollAt: number | null };
  /** a formation landing: the leader on his final last frame; where he touched down and his heading (those still in
   *  the air then fly their own approach to it) */
  wasFinal?: boolean;
  td?: { p: number[]; hdg: number } | null;
}

const nameOf = (k: number) => tr(NAMES[k] ?? { fr: `${k}`, en: `${k}` });

/** Its place now: geodetic latitude, longitude [°], its altitude over the sea (the WGS84 ellipsoid — the Earth's
 *  figure) and its height over the ground [m] (the relief over that figure). */
function geoOf(p: readonly number[]): { lat: number; lon: number; agl: number; alt: number } {
  const g = cartToGeodetic(WGS84_A, WGS84_F, p as V3);
  const lat = (g.lat * 180) / Math.PI,
    lon = (g.lon * 180) / Math.PI;
  const ground = groundRelief("earth", bodyFixedOf("earth", lat, lon, 0));
  return { lat, lon, alt: g.h, agl: g.h - ground };
}

/** The local east, north, up at a place (fixed to the Earth). */
function enuAxes(p: readonly number[]) {
  const l = Math.hypot(p[0]!, p[1]!, p[2]!);
  const U = [p[0]! / l, p[1]! / l, p[2]! / l];
  const e = [-U[1]!, U[0]!, 0];
  const el = Math.hypot(e[0]!, e[1]!) || 1;
  const E = [e[0]! / el, e[1]! / el, 0];
  const N = [U[1]! * E[2]! - U[2]! * E[1]!, U[2]! * E[0]! - U[0]! * E[2]!, U[0]! * E[1]! - U[1]! * E[0]!];
  return { E, N, U };
}
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** How many wingmen fly (the setting's, alive). */
function wingCount(this: CameraController): number {
  return this.wing?.list.filter((w) => w.alive).length ?? 0;
}

/** One of our wingmen hit by another player's shot (the free fight: ui/netmatch.ts) — `damage` off its 100. */
function wingHurt(this: CameraController, k: number, damage: number, by: string) {
  const w = this.wing?.list.find((x) => x.k === k && x.alive);
  if (!w) return;
  w.hp -= damage;
  if (w.hp > 0) return radio(this, tr({ fr: `${nameOf(w.k)}, touché par ${by} !`, en: `${nameOf(w.k)}, hit by ${by}!` }));
  radio(this, tr({ fr: `${nameOf(w.k)} abattu par ${by} !`, en: `${nameOf(w.k)} shot down by ${by}!` }));
  wingDown(this, w);
}

/** One of our wingmen shot down: out of control to the ground as a player's craft is (game/wreckfall.ts), its burst
 *  where it was hit. */
function wingDown(c: CameraController, w: Wingman) {
  w.alive = false;
  const A = w.jet.axes();
  w.wreck = startFall({ p: [...w.jet.p] as V3, v: [...w.jet.v] as V3, fwd: [...A.fwd] as V3, up: [...A.up] as V3 });
  const C = c.combat;
  if (C) C.booms.push({ p: fightP(c, w.jet.p) ?? [0, 0, 0], t: C.t, size: 1.5 });
}

const normalE = (p: V3) => geodeticNormal(WGS84_A, WGS84_F, p);
const aglE = (p: V3) => geoOf(p).agl;

/** A frame of a wingman's wreck [s]: down along the WGS84 normal to the ground (the relief over the ellipsoid); its
 *  crash there. */
function wingFall(c: CameraController, w: Wingman, dt: number) {
  const F = w.wreck;
  if (!F || F.end || !fallStep(F, dt, normalE, aglE)) return;
  wingCrash(c, w, F.end!, F.broke);
}

/** A wingman's crash (its wreck's end, or flown into the ground): the explosion, its smoke rising (a fight's), the
 *  room told. */
function wingCrash(c: CameraController, w: Wingman, at: readonly number[], broke = false) {
  const C = c.combat;
  const fp = fightP(c, at);
  if (C && fp) {
    const p: V3 = [fp[0], fp[1], broke ? fp[2] : C.world.groundZ(fp[0], fp[1])];
    C.booms.push({ p, t: C.t, size: 2.5 });
    C.events.push({ kind: "explode", p, size: 2.5 });
    if (!broke) C.crashes = [...(C.crashes ?? []).filter((x) => C.t - x.t < 60), { key: `w${w.k}`, p, t: C.t }];
  }
  c.onWingCrash?.(w.k, [...at], broke);
}

/** A radio call: said aloud and shown. */
function radio(c: CameraController, text: string) {
  c.onPilotMessage?.(text);
  c.onRadio?.(text, "wingman");
}

/** The leader (the flown craft) as the formation law reads it, on the ground or flying (his height over it, on a
 *  final: his gear down, low, coming down); null: not near the Earth. */
function leaderOf(c: CameraController): (FormCraft & { ground: boolean; agl: number; final: boolean; hdg: number }) | null {
  const o = c.netOwn();
  if (!o) return null;
  const ground = !!(c.ourLanded || c.rolling);
  if (!ground && !c.airFlight.inAir) return null;
  const agl = geoOf(o.p).agl;
  const U = o.p.map((x) => x / Math.hypot(...o.p));
  const vs = dot(o.v, U);
  const hdg = headingOf(o.p, Math.hypot(o.v[0]!, o.v[1]!, o.v[2]!) > 5 ? o.v : o.fwd);
  return {
    p: o.p,
    v: o.v,
    fwd: o.fwd,
    aLat: ground ? 0 : bankAccel(formationBank(o.p, o.up, o.right)),
    ground,
    agl,
    final: !ground && c.gearDown && agl < 600 && vs < 0.5,
    hdg,
  };
}

/** The ground's height under a place [m over the mean radius]. */
const groundAt: Ground = (p) => {
  const g = geoOf(p);
  return { alt: g.alt, agl: g.agl };
};

/** The wingmen made up to the setting's count: the missing ones at their places about the leader, at his velocity. */
function muster(c: CameraController, L: FormCraft & { ground: boolean; hdg: number }) {
  const S = c.s;
  const W = (c.wing ??= { list: [], called: new Set(), callAt: -1e9, t: 0, away: 0, lastP: null });
  // (the leader placed elsewhere — moved 3 km in a frame —: his wingmen with him, at their places)
  if (W.lastP && Math.hypot(...[0, 1, 2].map((k) => L.p[k]! - W.lastP![k]!)) > 3000) W.list = [];
  W.lastP = [...L.p];
  const want = Math.min(Math.max(Math.round(S.wingmen ?? 0), 0), 3);
  W.list = W.list.filter((w) => w.k <= want + 1);
  const o = c.netOwn()!;
  // (on the ground: mustered only stopped — lined up for a formation take-off, on the runway beside and behind him)
  const vL = Math.hypot(o.v[0]!, o.v[1]!, o.v[2]!);
  if (L.ground && vL > 5) return;
  const R = enuAxes(o.p);
  const fwdG = [0, 1, 2].map((i) => R.E[i]! * Math.sin(L.hdg) + R.N[i]! * Math.cos(L.hdg));
  const rightG = [0, 1, 2].map((i) => R.E[i]! * Math.cos(L.hdg) - R.N[i]! * Math.sin(L.hdg));
  for (let k = 2; k <= want + 1; k++) {
    if (W.list.some((w) => w.k === k)) continue;
    const slot = L.ground ? TAKEOFF_SLOTS[k]! : formSlotFor(S.formShape, k, S.formSpacing);
    let p = L.ground
      ? [0, 1, 2].map((i) => o.p[i]! + rightG[i]! * slot.right - fwdG[i]! * slot.back)
      : [0, 1, 2].map((i) => o.p[i]! + o.right[i]! * slot.right - o.fwd[i]! * slot.back + o.up[i]! * slot.up);
    const J = new AiJet(p, L.ground ? [0, 0, 0] : o.v);
    if (L.ground) {
      W.runway = { p0: [...o.p], hdg: L.hdg, rollAt: null };
      // (on its wheels on the ground there, stopped, the brakes on)
      const l = Math.hypot(...p);
      const above = geoOf(p).agl - AIJET.gear;
      p = p.map((x) => (x / l) * (l - above));
      J.p = p;
      J.gnd = { hdg: L.hdg };
      J.alpha = 0;
      J.throttle = 0;
    }
    const g = geoOf(p);
    W.list.push({
      k,
      jet: J,
      mode: L.ground ? "ground" : "form",
      phase: "join",
      mem: { iA: 0, iU: 0 },
      hdg: headingOf(p, o.v),
      alt: g.alt,
      brk: null,
      hold: null,
      home: null,
      target: null,
      aim120: 4,
      aim9x: 2,
      nextShot: 0,
      fired: [],
      hp: 100,
      alive: true,
      dist: 0,
      cmd: null,
      now: { ...slot },
      turn: crossTurnNew(),
    });
    radio(c, tr({ fr: `${nameOf(k)}, en place`, en: `${nameOf(k)}, in position` }));
  }
  W.list.sort((a, b) => a.k - b.k);
  void L;
}

/** The commands of a heading and a height held [rad, m] at a speed [m/s] (a bank at most). */
function holdCmd(w: Wingman, hdg: number, alt: number, spd: number, bankMax = 30 * D): AiCmd {
  const J = w.jet;
  const g = geoOf(J.p);
  return {
    bank: hdgHoldBank(headingOf(J.p, J.v), hdg, bankMax),
    gamma: altHoldGamma(g.alt, alt, J.V),
    spd,
  };
}

/**
 * A frame of the wingmen [s]: mustered while an F-35 flies in the Earth's air (gone 5 s after it no longer does),
 * each flown by its mode, the fight's part (placed in it, its hits, its shots), the contacts called.
 */
function wingStep(this: CameraController, dt: number) {
  const S = this.s;
  const L = fleet.active === "f35" && (S.wingmen ?? 0) > 0 ? leaderOf(this) : null;
  const W = this.wing;
  if (!L) {
    if (W) {
      W.away += dt;
      if (W.away > 5 || !(S.wingmen ?? 0)) this.wing = null;
    }
    this.radarSources.delete("wng");
    return;
  }
  muster(this, L);
  const Wg = this.wing!;
  Wg.away = 0;
  Wg.t += dt;
  // (the leader down off his final: his touchdown kept — the wingmen still in the air land on it)
  if (L.ground && Wg.wasFinal && !Wg.td) {
    Wg.td = { p: [...L.p], hdg: L.hdg };
    for (const w of Wg.list) if (w.alive && !w.jet.gnd && w.mode === "form") w.mode = "approach";
  }
  if (!L.ground && !L.final) Wg.td = null;
  Wg.wasFinal = L.final || (L.ground && !!Wg.wasFinal);
  const atm = solarBody("earth")!.atmosphere;
  const C = this.combat;
  const CW = C?.status === "run" ? C.world : null;
  // (the fight: its hits on our wingmen taken — the aggressors' —, the targets' places in the fight's frame)
  if (CW) {
    const keep = [];
    for (const h of CW.netHits) {
      if (h.peer !== undefined && h.peer < 0) {
        const w = Wg.list.find((x) => x.k === -h.peer! && x.alive);
        if (w) {
          w.hp -= h.damage;
          if (w.hp <= 0) {
            radio(this, tr({ fr: `${nameOf(w.k)} est abattu !`, en: `${nameOf(w.k)} is down!` }));
            wingDown(this, w);
          } else radio(this, tr({ fr: `${nameOf(w.k)}, touché !`, en: `${nameOf(w.k)}, I'm hit!` }));
        }
      } else keep.push(h);
    }
    CW.netHits = keep;
  }
  for (const w of Wg.list) {
    if (!w.alive) {
      wingFall(this, w, dt);
      continue;
    }
    const J = w.jet;
    const g = geoOf(J.p);
    let cmd: AiCmd;
    const formCmd = (shape = S.formShape, spacing = S.formSpacing): AiCmd => {
      // (on his final: the landing's places; else the formation's — a tactical one's sides swapped in his turns —,
      // the slot flown moving to it without a jump, across him under and behind)
      const base = L.final ? landingSlot(w.k) : formSlotFor(shape, w.k, spacing);
      const target = L.final ? base : crossTurnStep(w.turn, shape, L.hdg, L.aLat ?? 0, base);
      w.now = easeSlot(w.now ?? target, target, dt);
      const slot = w.now;
      const r = interceptStep({ p: J.p, v: J.v, fwd: J.axes().fwd }, J.V, g.alt, L, w.phase, slot, w.mem, dt, true);
      w.phase = r.phase === "shadow" ? "join" : r.phase;
      w.dist = r.dist;
      return { bank: r.bank, gamma: r.gamma, spd: r.spd, ab: r.acc > 1.2 ? true : undefined };
    };
    // (down on the runway on his final: the roll-out)
    if (J.gnd && w.mode !== "ground" && w.mode !== "rollout") {
      w.mode = "rollout";
      radio(this, tr({ fr: `${nameOf(w.k)}, posé`, en: `${nameOf(w.k)}, touchdown` }));
    }
    switch (w.mode) {
      case "form":
        cmd = formCmd();
        break;
      case "ground": {
        // the formation take-off: the brakes on until the leader rolls (the second element 8 s after him), then
        // full power on his runway's line — Two holding its place beside him —, rotated at 70 m/s
        const R0 = Wg.runway;
        if (!J.gnd || !R0) {
          w.mode = "form";
          w.phase = "join";
          w.now = null;
          cmd = formCmd();
          break;
        }
        const vL = Math.hypot(L.v[0]!, L.v[1]!, L.v[2]!);
        if (R0.rollAt === null && vL > 3) R0.rollAt = Wg.t;
        const go = R0.rollAt !== null && Wg.t - R0.rollAt >= (w.k >= 3 ? TAKEOFF.delay : 0);
        const E = enuAxes(R0.p0);
        const fwdR = [0, 1, 2].map((i) => E.E[i]! * Math.sin(R0.hdg) + E.N[i]! * Math.cos(R0.hdg));
        const rightR = [0, 1, 2].map((i) => E.E[i]! * Math.cos(R0.hdg) - E.N[i]! * Math.sin(R0.hdg));
        const slot = TAKEOFF_SLOTS[w.k]!;
        const off = [0, 1, 2].map((i) => J.p[i]! - R0.p0[i]!);
        const lat = dot(off, rightR) - slot.right;
        const gHdg = R0.hdg - Math.max(-5 * D, Math.min(5 * D, 0.01 * lat));
        if (!go) cmd = { bank: 0, gamma: 0, spd: 0, brake: true, gHdg };
        else if (w.k === 2) {
          const err =
            dot(
              [0, 1, 2].map((i) => L.p[i]! - R0.p0[i]!),
              fwdR,
            ) -
            slot.back -
            dot(off, fwdR);
          cmd = { bank: 0, gamma: 0, spd: Math.max(0, vL + 0.5 * err), ab: err > 10 || vL > 40, gHdg, rotate: J.V > TAKEOFF.vRotate };
        } else cmd = { bank: 0, gamma: 0, spd: 999, ab: true, gHdg, rotate: J.V > TAKEOFF.vRotate };
        break;
      }
      case "approach": {
        // its own approach to the leader's touchdown (its place across kept): the runway's line, 3° down to it, the
        // flare under 12 m, 75 m/s
        const T = Wg.td!;
        const E = enuAxes(T.p);
        const fwdR = [0, 1, 2].map((i) => E.E[i]! * Math.sin(T.hdg) + E.N[i]! * Math.cos(T.hdg));
        const rightR = [0, 1, 2].map((i) => E.E[i]! * Math.cos(T.hdg) - E.N[i]! * Math.sin(T.hdg));
        const off = [0, 1, 2].map((i) => J.p[i]! - T.p[i]!);
        const along = dot(off, fwdR);
        const lat = dot(off, rightR) - landingSlot(w.k).right;
        const want = Math.max(-along, 0) * Math.tan(3 * D);
        const flare = g.agl < 12;
        const gamma = flare ? -0.8 * D : Math.max(-6 * D, Math.min(1 * D, -3 * D + ((want - g.agl) / Math.max(J.V, 50)) * 0.8));
        const hdg = T.hdg - Math.max(-15 * D, Math.min(15 * D, 0.004 * lat + (0.04 * dot(J.v, rightR)) / Math.max(J.V, 1)));
        cmd = { bank: hdgHoldBank(headingOf(J.p, J.v), hdg, 25 * D), gamma, spd: 75 };
        break;
      }
      case "rollout":
        // (on the runway: braked to a stop, its heading kept)
        cmd = { bank: 0, gamma: 0, spd: 0, brake: true, gHdg: J.gnd?.hdg };
        if (!J.gnd) w.mode = "form";
        break;
      case "cover":
        // (the combat spread, high and wide: eyes on the leader's six)
        cmd = formCmd("spread", "normal");
        break;
      case "break": {
        cmd = holdCmd(w, w.brk ?? w.hdg, w.alt, J.V + 30, BREAK_BANK);
        cmd.ab = true;
        if (Math.abs(wrapPi(headingOf(J.p, J.v) - (w.brk ?? 0))) < 8 * D) {
          w.mode = "free";
          w.hdg = w.brk ?? w.hdg;
        }
        break;
      }
      case "hold": {
        const H = w.hold!;
        const e = (g.lon - H.fix.lon) * D * R_MEAN * Math.cos(H.fix.lat * D),
          n = (g.lat - H.fix.lat) * D * R_MEAN;
        cmd = holdCmd(w, racetrackHeading(H.R, [e, n], Math.max(J.V, 100) * 10).hdg, w.alt, 200);
        break;
      }
      case "rtb": {
        const Hm = w.home!;
        const d = gcDist(g, Hm);
        // (over the field: a hold above it, 1 500 m over it)
        if (d < 6000 && !w.hold) w.hold = { fix: { lat: Hm.lat, lon: Hm.lon }, R: { inbound: 0, leg: 6000, radius: holdRadius(180) } };
        if (w.hold) {
          const e = (g.lon - Hm.lon) * D * R_MEAN * Math.cos(Hm.lat * D),
            n = (g.lat - Hm.lat) * D * R_MEAN;
          cmd = holdCmd(w, racetrackHeading(w.hold.R, [e, n], 1800).hdg, w.alt, 180);
        } else cmd = holdCmd(w, gcCourse(g, Hm), w.alt, 240);
        break;
      }
      case "attack":
      case "engage": {
        const tg = CW && w.target !== null ? CW.target(w.target) : null;
        if (!CW || !tg || !tg.alive) {
          // (none to go after — out of a fight, or it is down —: engage the next hostile, else back in formation)
          const next = CW ? nearestHostile(this, w) : null;
          if (next !== null) w.target = next;
          else {
            w.mode = "form";
            w.target = null;
          }
          cmd = formCmd();
          break;
        }
        const T = ecefOfFight(this, tg.p, tg.v);
        if (!T) {
          cmd = formCmd();
          break;
        }
        // (its six at 900 m: the run, then the pursuit — the formation law on a slot behind it)
        const r = interceptStep(
          { p: J.p, v: J.v, fwd: J.axes().fwd },
          J.V,
          g.alt,
          { p: T.p, v: T.v },
          w.phase,
          { right: 0, back: 900, up: 0 },
          w.mem,
          dt,
          true,
        );
        w.phase = r.phase === "shadow" ? "join" : r.phase;
        cmd = { bank: r.bank, gamma: r.gamma, spd: Math.max(r.spd, 200), ab: r.acc > 1.2 ? true : undefined };
        shoot(this, w, tg.id, T.p);
        break;
      }
      default:
        cmd = holdCmd(w, w.hdg, w.alt, Math.max(200, J.V));
    }
    w.cmd = cmd;
    J.step(dt, cmd, atm, groundAt);
    // (the ground: lost)
    if (J.crashed) {
      w.alive = false;
      radio(this, tr({ fr: `${nameOf(w.k)} s'est écrasé`, en: `${nameOf(w.k)} crashed` }));
      wingCrash(this, w, J.p);
    }
  }
  // (the fight: our wingmen in it — the aggressors go after them —, our kills said)
  if (CW) {
    CW.setWingmen(
      Wg.list.map((w) => {
        const A = poseOf(w);
        const P = fightP(this, A.p) ?? [0, 0, -1e6];
        const R = enuAxes(A.p);
        const loc = (x: readonly number[]): V3 => [dot(x, R.E), dot(x, R.N), dot(x, R.U)];
        return {
          k: w.k,
          name: nameOf(w.k),
          p: P,
          v: loc(A.v),
          fwd: loc(A.fwd),
          up: loc(A.up),
          alive: w.alive,
          falling: fallingW(w),
        };
      }),
    );
    for (const w of Wg.list)
      for (const f of w.fired.splice(0)) {
        const q = CW.target(f.target);
        if (q && !q.alive && Math.abs(q.diedAt - CW.t) < 0.5)
          radio(this, tr({ fr: `${nameOf(w.k)}, splash !`, en: `${nameOf(w.k)}, splash one!` }));
        else if (CW.t - f.at < 80 && q?.alive) w.fired.push(f);
      }
  }
  // the radar: our wingmen by the datalink
  this.radarSources.set("wng", (fix) =>
    Wg.list
      .filter((w) => w.alive)
      .map(
        (w): RadarObject => ({
          id: `wng:${w.k}`,
          r: fix.toLocal(w.jet.p as V3),
          v: [dot(w.jet.v, fix.E), dot(w.jet.v, fix.N), dot(w.jet.v, fix.U)],
          rcs: 4,
          kind: "air",
          iff: "friend",
          name: nameOf(w.k).toUpperCase(),
          squawk: true,
          offboard: true,
          colour: "rgba(110, 200, 255, 1)",
        }),
      ),
  );
  // the contacts: a hostile or unknown new on our radar, called by the first wingman (every 8 s at most)
  if (Wg.t - Wg.callAt > 8) {
    const first = Wg.list.find((w) => w.alive);
    const U = unitsFor(S);
    for (const T of this.radar.tracks.values()) {
      if (T.datalink || Wg.called.has(T.id) || (T.iff !== "hostile" && T.iff !== "unknown")) continue;
      Wg.called.add(T.id);
      if (!first) break;
      const brg = Math.round(((Math.atan2(T.r[0], T.r[1]) / D) % 360) + 360) % 360;
      const alt = this.jetFigures()?.h ?? 0;
      const what = T.iff === "hostile" ? tr({ fr: "bandit", en: "bandit" }) : tr({ fr: "inconnu", en: "bogey" });
      radio(
        this,
        tr({
          fr: `${nameOf(first.k)}, contact, ${what}, au ${String(brg).padStart(3, "0")}, ${U.fDist(Math.hypot(...T.r), 0)}, ${U.fAlt(alt + T.r[2])}`,
          en: `${nameOf(first.k)}, contact, ${what}, bearing ${String(brg).padStart(3, "0")}, ${U.fDist(Math.hypot(...T.r), 0)}, ${U.fAlt(alt + T.r[2])}`,
        }),
      );
      Wg.callAt = Wg.t;
      break;
    }
  }
}

/** A place fixed to the Earth → the fight's frame (east, north of its anchor, the height over the mean radius). */
function fightP(c: CameraController, p: readonly number[]): V3 | null {
  const C = c.combat;
  if (!C) return null;
  const g = geoOf(p);
  const [e, n] = enu(C.def.anchor, g);
  return [e, n, g.alt];
}

/** A fight's place and velocity → fixed to the Earth (the inverse, about our own place). */
function ecefOfFight(c: CameraController, fp: V3, fv: V3): { p: number[]; v: number[] } | null {
  const C = c.combat;
  const P = C?.last;
  const o = c.netOwn();
  if (!C || !P || !o) return null;
  const R = enuAxes(o.p);
  const d = [fp[0] - P.p[0], fp[1] - P.p[1], fp[2] - P.p[2]];
  return {
    p: [0, 1, 2].map((k) => o.p[k]! + R.E[k]! * d[0]! + R.N[k]! * d[1]! + R.U[k]! * d[2]!),
    v: [0, 1, 2].map((k) => R.E[k]! * fv[0] + R.N[k]! * fv[1] + R.U[k]! * fv[2]),
  };
}

/** The nearest hostile alive in the fight to a wingman (none taken by another of ours first), null: none. */
function nearestHostile(c: CameraController, w: Wingman): number | null {
  const CW = c.combat?.world;
  const P = fightP(c, w.jet.p);
  if (!CW || !P) return null;
  const taken = new Set((c.wing?.list ?? []).filter((x) => x !== w && x.alive).map((x) => x.target));
  let best: number | null = null,
    bd = Infinity;
  for (const q of CW.targets) {
    if (!q.alive || q.friendly || q.peer !== undefined || q.site || q.kind === "truck" || q.kind === "bunker") continue;
    const d = Math.hypot(q.p[0] - P[0], q.p[1] - P[1], q.p[2] - P[2]) + (taken.has(q.id) ? 20_000 : 0);
    if (d < bd) (bd = d), (best = q.id);
  }
  return best;
}

/** A wingman's shot: its AIM-120 beyond 6 km (within 35), its AIM-9X closer — the target before its nose. */
function shoot(c: CameraController, w: Wingman, target: number, Tp: number[]) {
  const C = c.combat;
  const CW = C?.world;
  if (!C || !CW || CW.t < w.nextShot) return;
  const J = w.jet;
  const A = J.axes();
  const r = [0, 1, 2].map((k) => Tp[k]! - J.p[k]!);
  const d = Math.hypot(...r);
  const off = Math.acos(Math.min(1, Math.max(-1, dot(r, A.fwd) / Math.max(d, 1))));
  const kind =
    d > 6000 && d < 35_000 && w.aim120 > 0 && off < 30 * D ? "aim120" : d < 6000 && d > 600 && w.aim9x > 0 && off < 30 * D ? "aim9x" : null;
  if (!kind) return;
  const P = fightP(c, J.p);
  if (!P) return;
  const R = enuAxes(J.p);
  const loc = (x: readonly number[]): V3 => [dot(x, R.E), dot(x, R.N), dot(x, R.U)];
  const m = CW.launchFrom({ p: P, v: loc(J.v), up: loc(A.up) }, kind, target, 20_000 + w.k);
  if (kind === "aim120") w.aim120--;
  else w.aim9x--;
  w.nextShot = CW.t + (kind === "aim120" ? 12 : 6);
  w.fired.push({ id: m.id, target, at: CW.t });
  radio(
    c,
    tr({
      fr: `${nameOf(w.k)}, ${kind === "aim120" ? "Fox trois" : "Fox deux"}`,
      en: `${nameOf(w.k)}, ${kind === "aim120" ? "Fox three" : "Fox two"}`,
    }),
  );
}

/** An order to our AI wingmen (the leader's, controller/orders.ts): carried out, acknowledged. */
function wingOrder(this: CameraController, o: Order) {
  const Wg = this.wing;
  if (!Wg) return;
  const live = Wg.list.filter((w) => w.alive);
  if (!live.length) return;
  const g0 = this.geoNow();
  for (const w of live) {
    const J = w.jet;
    const g = geoOf(J.p);
    w.mem = { iA: 0, iU: 0 };
    switch (o.id) {
      case "rejoin":
      case "shape":
      case "show":
      case "tighten":
      case "loosen":
        w.mode = "form";
        w.phase = "run";
        w.hold = null;
        break;
      case "breakL":
      case "breakR":
        w.mode = "break";
        w.alt = g.alt;
        w.brk = headingOf(J.p, J.v) + (o.id === "breakL" ? -1 : 1) * (Math.PI / 2);
        break;
      case "hold":
        if (o.fix && o.inbound !== undefined) {
          w.mode = "hold";
          w.alt = (this.jetFigures()?.h ?? g.alt) + 300 * (w.k - 1);
          w.hold = { fix: o.fix, R: { inbound: o.inbound, leg: 8000, radius: holdRadius(200) } };
        }
        break;
      case "rtb": {
        const here = g0 ?? g;
        // (the nearest a jet lands on: the game's sites, the world's within 300 km — PLAN-RADAR-AAA RD13)
        const fields = [...SITES.filter((x) => x.body === "earth" && x.runway), ...runwaySitesNear(here.lat, here.lon, 300_000)];
        let best = fields[0]!,
          bd = Infinity;
        for (const x of fields) {
          const d = gcDist(here, x);
          if (d < bd) (bd = d), (best = x);
        }
        w.mode = "rtb";
        w.home = { lat: best.lat, lon: best.lon, name: best.icao ?? best.name };
        w.hold = null;
        w.alt = Math.max(g.alt, (best.elev ?? 0) + 1500 + 300 * (w.k - 2));
        break;
      }
      case "cover":
        w.mode = "cover";
        w.phase = "run";
        break;
      case "attack":
      case "engage": {
        w.mode = o.id;
        w.phase = "run";
        const lock = o.target?.startsWith("cmb:") ? Number(o.target.slice(4)) : null;
        w.target = o.id === "attack" ? lock : nearestHostile(this, w);
        break;
      }
    }
  }
  const ack = live.map((w) => nameOf(w.k)).join(", ");
  const engaged = o.id === "attack" || o.id === "engage";
  radio(this, engaged ? tr({ fr: `${ack}, engagé`, en: `${ack}, engaged` }) : ack);
}

/** Our wingmen for the renderer: their place and axes on the camera's (from the flown craft), at rest, gear up. */
function wingShips(this: CameraController): { id: "f35"; rel: Vec3; axes: [Vec3, Vec3, Vec3]; jet: F35Pose; hidden: boolean }[] {
  const Wg = this.wing;
  if (!Wg?.list.length && !this.remoteWings.size) return [];
  const E = earthView(this);
  if (!E) return [];
  const pose: F35Pose = { ...restPose(), gear: 0, canopy: 0 };
  const cam = (b: readonly number[]) => E.toCam(E.toHome(b as Vec3));
  const n = (v: Vec3): Vec3 => {
    const l = Math.hypot(...v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const ship = (p: readonly number[], fwd: readonly number[], up: readonly number[]) => {
    const left = [up[1]! * fwd[2]! - up[2]! * fwd[1]!, up[2]! * fwd[0]! - up[0]! * fwd[2]!, up[0]! * fwd[1]! - up[1]! * fwd[0]!];
    return {
      id: "f35" as const,
      rel: cam([0, 1, 2].map((k) => p[k]! - E.p0[k]!)),
      axes: [n(cam(left)), n(cam(up)), n(cam(fwd))] as [Vec3, Vec3, Vec3],
      jet: pose,
      hidden: false,
    };
  };
  // (ours flying, and those shot down falling to their crash)
  const out = (Wg?.list ?? [])
    .filter((w) => w.alive || fallingW(w))
    .map((w) => {
      const A = poseOf(w);
      return ship(A.p, A.fwd, A.up);
    });
  // (the room's others': carried on from their last sample — a second at most —, drawn smoothed: the place carried
  // on by its velocity frame to frame and eased onto each new sample's over a quarter second, the attitude eased so;
  // a sample's step — 20 a second, the network's jitter — no longer a jump)
  const now = performance.now() / 1000;
  const live = new Set<string>();
  for (const [slot, R] of this.remoteWings) {
    const age = Math.min(now - R.at, 1);
    for (const w of R.list) {
      const key = `${slot}:${w.k}`;
      live.add(key);
      const want = w.p.map((x, k) => x + w.v[k]! * age);
      let S = drawn.get(key);
      if (!S || now - S.t > 1 || Math.hypot(...want.map((x, k) => x - S!.p[k]!)) > 200) {
        S = { p: [...want], f: [...w.f], u: [...w.u], t: now };
        drawn.set(key, S);
      } else {
        const dt = Math.min(now - S.t, 0.1);
        const a = 1 - Math.exp(-dt / 0.25);
        const b = 1 - Math.exp(-dt / 0.15);
        S.p = S.p.map((x, k) => x + w.v[k]! * dt);
        S.p = S.p.map((x, k) => x + (want[k]! - x) * a);
        S.f = n(S.f.map((x, k) => x + (w.f[k]! - x) * b) as Vec3);
        S.u = n(S.u.map((x, k) => x + (w.u[k]! - x) * b) as Vec3);
        S.t = now;
      }
      out.push(ship(S.p, S.f, S.u));
    }
  }
  for (const k of drawn.keys()) if (!live.has(k)) drawn.delete(k);
  return out;
}

/** The others' AI wingmen as drawn (their smoothed place and attitude, when) — by their player's slot and number. */
const drawn = new Map<string, { p: number[]; f: number[]; u: number[]; t: number }>();

export function installWingmen(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { wingStep, wingShips, wingOrder, wingCount, wingHurt });
}
