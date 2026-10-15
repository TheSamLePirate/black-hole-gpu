// The CameraController — the F-35C on a carrier (game/trap.ts): its hook catching a wire (the wire's pull in the
// flight's accelerations — motion.ts —, the craft stopped in some 100 m), the bolter; the approach's autopilot down
// the glide path, lined up on the angled deck; the LSO watching every pass on the final — the autopilot's or the
// pilot's —, calling it and grading it; the catapult's launch.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { bodyAxes, solarBody, utcOf } from "../system/solar";
const dot3 = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
import { CARRIER, type CarrierId, carrierPose, LANDING, toDeck } from "../game/carrier";
import { deckVelocity } from "../game/deckland";
import {
  approachSpeed,
  axisOf,
  CATS,
  catPull,
  catStart,
  GRADE_POINTS,
  gradePass,
  hookAt,
  newTrapRun,
  type TrapGrade,
  type TrapOut,
  type RecoveryCase,
  type TrapRun,
  trapStep,
  wireCaught,
  wirePull,
} from "../game/trap";
import { f35Variant } from "../f35/variant";
import { fleet } from "../fleet";
import { t, tf } from "../i18n";
import type { PilotInput } from "../pilot";
import { fromBodyFixed, groundVelocity, type Platform, platformUnder, toBodyFixed } from "../system/our-surface";
import { C_MPS, M_METRES } from "../units";
import { VESSELS } from "../vessels";
import { deckOf } from "./carriers";
import type { Vec3 } from "../math/vec3";
import type { CameraController } from "../controls";

/** A wire caught: its platform (the deck), the landing area's axis on its frame, the pull [m/s²], its number. */
export interface TrapWire {
  pl: Platform;
  axisL: Vec3;
  a0: number;
  wire: number;
}

declare module "../controls" {
  interface CameraController {
    trapRun?: (TrapRun & { manual?: boolean }) | null;
    trapWire?: TrapWire | null;
    trapLast?: { grade: TrapGrade; wire: number; points: number; kind: CarrierId; worst?: TrapRun["worst"] } | null;
    catRun?: { t: number; phase: "tension" | "stroke" | "airborne"; cat: number; air?: number } | null;
    trapHook?: { kind: CarrierId; h: Vec3 } | null;
    /** the tailhook raised (down with the gear, else): no wire caught — a touch-and-go, a bolter */
    hookUp?: boolean;
    onCatEnd?: (v: number) => void;
    trapLand: typeof trapLand;
    trapJet: typeof trapJet;
    trapFrame: typeof trapFrame;
    trapAccel: typeof trapAccel;
    catLaunch: typeof catLaunch;
  }
}

const memo = new WeakMap<TrapRun, { at: number; out: TrapOut | null }>();

/** What the LSO's English call is said as (the French too: i18n). */
const SAY: Record<string, () => string> = {
  "Roger ball.": () => t("Paddles: roger ball."),
  "Power!": () => t("Paddles: power!"),
  "You're low.": () => t("Paddles: you're low."),
  "You're high.": () => t("Paddles: you're high."),
  "Right for line-up.": () => t("Paddles: right for line-up."),
  "Come left.": () => t("Paddles: come left."),
  "Wave off, wave off!": () => t("Paddles: wave off, wave off!"),
  "Bolter, bolter, bolter!": () => t("Paddles: bolter, bolter, bolter!"),
  Commencing: () => t("F-35C commencing — out of marshal"),
  Platform: () => t("Ten miles — dirty up, the platform at 1 200 ft"),
  Initial: () => t("Initial, three miles"),
  Break: () => t("The break"),
  Abeam: () => t("Abeam — gear, flaps, hook"),
  "The 180": () => t("The 180 — into the groove"),
};

/** A carrier with wires near, and our place on it: its spawn and pose, our reference point, nose and top on its frame. */
function nearWires(c: CameraController, within = 6000) {
  const o = c.netOwn();
  if (!o) return null;
  for (const { sp, P } of c.carrierNow()) {
    if (!LANDING[sp.kind]) continue;
    const l = toDeck(P, o.p);
    if (Math.hypot(l[0], l[2]) > within) continue;
    const dirL = (v: readonly number[]): Vec3 => [
      v[0]! * P.port[0] + v[1]! * P.port[1] + v[2]! * P.port[2],
      v[0]! * P.up[0] + v[1]! * P.up[1] + v[2]! * P.up[2],
      v[0]! * P.bow[0] + v[1]! * P.bow[1] + v[2]! * P.bow[2],
    ];
    return { sp, P, o, l, fwdL: dirL(o.fwd), upL: dirL(o.up) };
  }
  return null;
}

/**
 * The F-35C's recovery engaged on a carrier with wires (`kind`, else the nearest within 30 km): the autopilot to the
 * gate astern, down the glide path at its approach speed, the hook and the gear down. What to say; null: none near.
 */
function trapLand(this: CameraController, kind?: CarrierId, o: { case?: RecoveryCase; marshal?: number } = {}): string | null {
  const near = this.carrierNow()
    .filter((c) => (!kind || c.sp.kind === kind) && LANDING[c.sp.kind])
    .map((c) => {
      const o = this.netOwn();
      return { c, d: o ? Math.hypot(...[0, 1, 2].map((k) => c.P.p[k]! - o.p[k]!)) : 0 };
    })
    .sort((a, b) => a.d - b.d)[0];
  if (!near || (!kind && near.d > 30_000)) {
    const other = kind && !LANDING[kind];
    return other ? tf("No wires on {0}: the F-35B lands there", CARRIER[kind].name) : kind ? null : null;
  }
  if (this.form) this.formOff();
  if (this.icpt) this.icptOff();
  this.deckRun = null;
  if (this.pilot.auto !== "none") this.pilot.setAuto(this.pilot.auto);
  this.pilot.auto = "none";
  this.trapRun = newTrapRun(near.c.sp.kind);
  // (already on the final — astern on the axis, lined up, heading along it —: flown from there)
  const w = nearWires(this, 6000);
  if (w && w.sp.kind === near.c.sp.kind) {
    const A = axisOf(LANDING[w.sp.kind]!);
    const h = A.at(w.l[0], w.l[2]);
    const head = w.fwdL[0] * A.ax[0] + w.fwdL[2] * A.ax[1];
    if (h.s < -800 && h.s > -5000 && Math.abs(h.e) < 150 && head > 0.95) this.trapRun.phase = "final";
  }
  this.gearDown = true;
  // (the recovery's case: the one asked, else by the light and the weather — night or a low ceiling: III; clouds: II)
  const R = this.trapRun;
  if (R.phase !== "final") {
    const cs = o.case ?? recoveryCase(this);
    R.case = cs;
    R.leg = cs === "I" ? "initial" : cs === "II" ? "penetration" : cs === "III" ? "marshal" : undefined;
    R.marshal = o.marshal ?? 0;
  }
  const name = CARRIER[near.c.sp.kind].name;
  this.onRadio?.(
    R.case === "III"
      ? tf("{0}, Mother: Case III recovery. Marshal on the final bearing, 21 miles, angels 6.", "F-35C")
      : R.case === "II"
        ? tf("{0}, Mother: Case II recovery. Descend to ten miles, then the initial.", "F-35C")
        : R.case === "I"
          ? tf("{0}, Mother: Charlie. Case I — the initial, the break.", "F-35C")
          : tf("{0}, Mother: Charlie. Case I, the wires — the ball at three-quarters of a mile.", "F-35C"),
  );
  return tf("Carrier landing on {0} — {1}", name, R.case && R.case !== "straight" ? `Case ${R.case}` : t("straight in"));
}

/** The recovery's case for the hour and the weather there: night (the sun down at the ship) or a low ceiling — III;
 *  clouds — II; else I. */
function recoveryCase(c: CameraController): RecoveryCase {
  const g = c.geoNow();
  const utcH = (((utcOf(c.nowTime()) / 3.6e6) % 24) + 24) % 24;
  const local = g ? (((utcH + g.lon / 15) % 24) + 24) % 24 : 12;
  if (local < 6.5 || local > 19.5) return "III";
  const w = c.s.weather;
  if (w === "overcast" || w === "rain" || w === "storm" || w === "fog") return "III";
  if (w === "cloudy" || w === "windy") return "II";
  return "I";
}

/** The run's guidance this frame (worked out once). */
function trapGuide(c: CameraController, R: TrapRun): TrapOut | null {
  const now = c.nowTime();
  const m = memo.get(R);
  if (m && m.at === now) return m.out;
  const w = nearWires(c, 40_000);
  if (!w || w.sp.kind !== R.kind) return null;
  // (the ball, the glide path and the line-up stabilised — the real IFLOLS is, against the ship's pitch and roll:
  // its course without its motion in the sea; the wires the real deck's)
  const P0 = carrierPose(w.sp, utcOf(now) / 1000, 0);
  const dirL = (v: readonly number[]): Vec3 => [dot3(v, P0.port), dot3(v, P0.up), dot3(v, P0.bow)];
  const hook = hookAt(toDeck(P0, w.o.p), dirL(w.o.fwd), dirL(w.o.up));
  const dt = m ? Math.min(Math.max((now - m.at) * 4.925490947e-6 * c.s.massSolar, 0), 0.25) : 0;
  const vApp = approachSpeed(fleet.massProps().mass, VESSELS.f35.aero!.wing!.S);
  // (on the wheels, or held by a wire — a bounce in the arrestment is no bolter)
  const down = !!(c.rolling || c.ourLanded || c.trapWire);
  const out = trapStep(R, { p: w.o.p, v: w.o.v, V: c.airFlight.last?.speed ?? 0, hook, down, caught: !!c.trapWire }, w.sp, P0, vApp, dt);
  memo.set(R, { at: now, out });
  if (out?.call) c.onRadio?.(SAY[out.call]?.() ?? out.call);
  return out;
}

/** A frame of the jet's systems with the approach flown: its flight path, bank and speed (full power: the speed past
 *  reach); the stick takes it back — the LSO still watching. */
function trapJet(this: CameraController, inp: PilotInput): { gamma: number; bank: number; spd: number; acc: number } | null {
  // (off the catapult: the climb flown at once — the real one rotates itself, hands off —, wings level, the
  // afterburner on, a few seconds)
  if (this.catRun?.phase === "airborne") {
    if (inp.pitch !== 0 || inp.roll !== 0) this.catRun = null;
    else return { gamma: 8 * (Math.PI / 180), bank: 0, spd: 250, acc: 2 };
  }
  const R = this.trapRun;
  if (!R || R.manual) return null;
  if (inp.pitch !== 0 || inp.roll !== 0 || inp.throttle !== 0) {
    R.manual = true;
    this.onPilotMessage?.(t("Carrier landing: the autopilot off — the LSO still watching"));
    return null;
  }
  const out = trapGuide(this, R);
  if (!out) return null;
  return { gamma: out.gamma, bank: out.bank, spd: out.full ? 250 : out.spd, acc: out.full ? 2 : 0 };
}

/**
 * A frame of the hook, the wires and the catapult (before the flight's step): the LSO taking over a pilot's pass on
 * the final (the F-35C, its gear down); the wire caught as the hook crosses it on the deck; the craft stopped, the
 * pass graded; on the deck, full power until the wire holds (a bolter's insurance); the catapult run up and fired.
 */
function trapFrame(this: CameraController, dt: number) {
  this.catStep(dt);
  const isC = fleet.active === "f35" && f35Variant() === "C";
  if (!isC) {
    this.trapRun = null;
    this.trapWire = null;
    this.trapHook = null;
    return;
  }
  const w = nearWires(this);
  if (!w) {
    this.trapHook = null;
    return;
  }
  const L = LANDING[w.sp.kind]!;
  const A = axisOf(L);
  const hook = hookAt(w.l, w.fwdL, w.upL);
  // (a pilot's own pass: watched from the final in, its gear down)
  if (!this.trapRun && this.gearDown && !this.ourLanded && !this.rolling) {
    const h = A.at(hook[0], hook[2]);
    if (h.s < -300 && h.s > -2000 && Math.abs(h.e) < 250) this.trapRun = { ...newTrapRun(w.sp.kind), phase: "final", manual: true };
  }
  // (the guidance each frame — on the wheels too, the jet's systems then idle: the touchdown, the bolter)
  const R = this.trapRun;
  if (R) trapGuide(this, R);
  // the hook across a wire on the deck: caught
  const prev = this.trapHook;
  if (!this.trapWire && prev && prev.kind === w.sp.kind && this.gearDown && !this.hookUp) {
    const n = wireCaught(w.sp.kind, prev.h, hook);
    if (n) {
      const qm = w.o.p as Vec3;
      const pu = platformUnder("earth", [qm[0] / M_METRES, qm[1] / M_METRES, qm[2] / M_METRES], this.nowTime());
      if (pu) {
        const axisL: Vec3 = [A.ax[0], 0, A.ax[1]];
        const ax = [0, 1, 2].map((k) => w.P.port[k]! * axisL[0] + w.P.bow[k]! * axisL[2]);
        const vRel = [0, 1, 2].map((k) => w.o.v[k]! - deckVelocity(w.P, w.o.p)[k]!);
        const v0 = vRel[0]! * ax[0]! + vRel[1]! * ax[1]! + vRel[2]! * ax[2]!;
        // (its pull set for the run — the engine at full against it: the arresting gear stops it all the same)
        const aThrust = this.thrustMax() * ((C_MPS * C_MPS) / (1476.625 * this.s.massSolar)) * this.jetThrust();
        this.trapWire = { pl: pu.pl, axisL, a0: wirePull(Math.max(v0, 1)) + aThrust, wire: n };
        if (R) R.wire = n;
        this.pilot.throttle = 1;
      }
    }
  }
  this.trapHook = { kind: w.sp.kind, h: hook };
  // on the deck: full power — the wire holds it, or it flies off: a bolter
  if (R && (R.phase === "touch" || R.phase === "bolter")) this.pilot.throttle = 1;
  // stopped by the wire: the engine to idle, the wire let go, the pass graded
  const W = this.trapWire;
  if (W) {
    const vRel = [0, 1, 2].map((k) => w.o.v[k]! - deckVelocity(w.P, w.o.p)[k]!);
    if (Math.hypot(...vRel) < 0.6) {
      this.trapWire = null;
      this.pilot.throttle = 0;
      const run = R ?? newTrapRun(w.sp.kind);
      run.wire = W.wire;
      run.phase = "trapped";
      const g = gradePass(run);
      run.grade = g;
      this.trapLast = { grade: g, wire: W.wire, points: GRADE_POINTS[g], kind: w.sp.kind, worst: run.worst };
      this.onRadio?.(
        tf(
          "Paddles: {0}, {1}-wire.",
          g === "_OK_"
            ? t("OK, underlined")
            : g === "OK"
              ? t("OK")
              : g === "Fair"
                ? t("Fair")
                : g === "Cut"
                  ? t("Cut pass")
                  : t("No grade"),
          W.wire,
        ),
      );
      this.trapRun = null;
    }
  }
  // a bolter or a wave-off graded once off
  if (R && (R.phase === "bolter" || R.phase === "waveoff") && R.grade && !R.said?.what.startsWith("graded")) {
    this.trapLast = { grade: R.grade, wire: 0, points: GRADE_POINTS[R.grade], kind: R.kind };
    R.said = { at: R.t, what: "graded" };
    if (R.manual) this.trapRun = null;
  }
}

/** The wire's pull [m/s², the home frame's axes] on the craft at Xq moving at Vq (home) at tq: along the deck's
 *  axis against our motion over it, steady, until stopped; null: none. */
function trapAccel(this: CameraController, Xq: Vec3, Vq: Vec3, tq: number): Vec3 | null {
  const W = this.trapWire;
  if (!W) return null;
  const q = toBodyFixed("earth", Xq, tq);
  const qm: Vec3 = [q[0] * M_METRES, q[1] * M_METRES, q[2] * M_METRES];
  const u = W.pl.under(qm, tq);
  if (!u) return null;
  const A = bodyAxes(solarBody("earth")!, tq);
  const home = (v: readonly number[]): Vec3 => [0, 1, 2].map((i) => v[0]! * A[0]![i]! + v[1]! * A[1]![i]! + v[2]! * A[2]![i]!) as Vec3;
  const gv = groundVelocity("earth", Xq, tq);
  const dv = home(u.v);
  const axis = home(W.pl.dirToFixed(W.axisL, tq));
  const n = Math.hypot(...axis) || 1;
  const rel = [0, 1, 2].map((i) => (Vq[i]! - gv[i]!) * C_MPS - dv[i]!);
  const along = (rel[0]! * axis[0]! + rel[1]! * axis[1]! + rel[2]! * axis[2]!) / n;
  if (along <= 0.2) return null;
  return [(-axis[0]! / n) * W.a0, (-axis[1]! / n) * W.a0, (-axis[2]! / n) * W.a0];
}

/**
 * The F-35C launched by a catapult of the carrier it stands near (the Ford's bow cats; `n`, else the first): set on
 * its shuttle, the engine run up three seconds, fired — CAT_END over the deck at the stroke's end —, then its
 * holds on the climb. What to say; null: none near.
 */
function catLaunch(this: CameraController, n = 0): string | null {
  const w = nearWires(this, 600);
  const kind = w?.sp.kind ?? this.carrierNow().find((c) => CATS[c.sp.kind])?.sp.kind;
  if (!kind || !CATS[kind]) return null;
  const at = catStart(kind, n);
  const cat = CATS[kind]![n]!;
  if (!at || !deckOf(kind)) return t("Catapult: the deck's map still loading");
  // (taxied to the catapult: its fuel kept — the placing's new flight fills the tanks)
  const fuel = fleet.fuel.f35;
  const said = this.carrierLand(kind, { x: at.l[0], z: at.l[2], facing: 0 });
  if (fuel !== undefined) fleet.fuel.f35 = fuel;
  if (!said.startsWith("On")) return said;
  const Dk = this.ourLanded?.deck;
  if (!Dk) return null;
  Dk.cat = { dirL: [cat.dir[0], 0, cat.dir[1]], l0: [...Dk.l] as Vec3, s: 0, v: 0, a: catPull(cat.len), len: cat.len, fired: false };
  this.catRun = { t: 0, phase: "tension", cat: n + 1 };
  this.onCatEnd = (v) => {
    if (this.catRun) this.catRun.phase = "airborne";
    const m = this.jetModes;
    m.alt = 250;
    m.hdg = (this.jetFigures()?.hdg ?? Number.NaN) || null;
    m.spd = 150;
    this.jetAthr.reset();
    this.onPilotMessage?.(tf("Off the catapult: {0} m/s over the deck", v.toFixed(0)));
  };
  this.onRadio?.(tf("{0}, Mother: on cat {1}. Tension — run it up.", "F-35C", n + 1));
  return tf("Catapult {0} on {1}", n + 1, CARRIER[kind].name);
}

declare module "../controls" {
  interface CameraController {
    catStep: typeof catStep;
  }
}

/** A frame of the catapult: the engine run up under tension, fired after three seconds; off it, a few seconds. */
function catStep(this: CameraController, dt: number) {
  const C = this.catRun;
  if (!C) return;
  C.t += dt;
  if (C.phase === "tension") {
    this.pilot.throttle = 1;
    const cat = this.ourLanded?.deck?.cat;
    if (!cat) {
      this.catRun = null;
      return;
    }
    if (C.t > 3 && !cat.fired) {
      cat.fired = true;
      this.jetModes = { ...this.jetModes, ab: true };
      C.phase = "stroke";
      this.onRadio?.(t("Shooter: launch!"));
    }
    return;
  }
  // (off, climbing: some 8 s, then the holds — the afterburner out)
  if (C.phase === "airborne") {
    C.air = (C.air ?? 0) + dt;
    if (C.air > 8) {
      this.catRun = null;
      this.onCatEnd = undefined;
      this.jetModes = { ...this.jetModes, ab: false };
    }
  }
}

export function installTrap(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { trapLand, trapJet, trapFrame, trapAccel, catLaunch, catStep });
}

export { fromBodyFixed };
