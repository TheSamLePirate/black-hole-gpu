// The CameraController — the guided lessons (game/course.ts, docs/PLAN-AVIATION-AAA.md I3): TARS flies first — his
// step said as he begins it, the holds, the ILS's autopilot, the carrier's, the intercept doing it —, then hands over
// ("your controls": the holds, the intercept let go, the approach's autopilot off) and the instructor watches the
// pilot (controller/instructor.ts reads courseSample: the step's targets against the figures, the circuit's track and
// path, the formation's slot, the intercept's course, the gun's aim). The lesson's world made where it needs one: a
// leader to fly on, an unknown to intercept, a drone to shoot. The events the steps wait for seen here.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import {
  type CourseAct,
  type CourseFix,
  type CourseId,
  type CourseRun,
  type CourseStep,
  courseStep,
  deviations,
  newCourse,
  targetsOf,
} from "../game/course";
import { type IlsRunway, ILS, onRunway } from "../game/ils";
import { gunSolution } from "../game/gunsight";
import { interceptCues } from "../game/intercept";
import { tankerTrack } from "../game/jetmodes";
import type { Scenario } from "../game/scenarios";
import { approachSpeed } from "../game/trap";
import { fleet } from "../fleet";
import { t, tf } from "../i18n";
import { unitsOf } from "../ui/unitsys";
import { VESSELS } from "../vessels";
import type { CameraController } from "../controls";
import { geoidDeg } from "../system/geoid-grid";

const D = Math.PI / 180;
const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** A guided lesson flown: its course, how it was asked, its world's target (a fight's id), its runway and the
 *  circuit's side, whether a figure was seen flying in this step, whether begun. */
export interface CourseState {
  id: CourseId;
  mode: "guided" | "demo" | "try";
  run: CourseRun | null;
  target?: number;
  rwy?: IlsRunway;
  side?: number;
  sawFly?: boolean;
  sawTrap?: boolean;
  wasAir?: boolean;
  /** the last words said (the page's panel shows them) */
  said?: string;
  /** an act waiting for the lesson's craft on the radar (its first frames) */
  pending?: CourseAct;
  /** the step's progress: what is left of it (its measure — a distance, the deviations…), the least seen and when
   *  [the step's time, s]; stalled: how long it has not come nearer [s] */
  left?: number;
  best?: number;
  bestAt?: number;
  stalled?: number;
  /** the autopilots' phases last seen */
  key?: string;
  /** a demonstration given up: stalled too long */
  failed?: string;
  /** TARS's guns (a demonstration's): the target's velocity last seen, its acceleration eased, the fight's time */
  gun?: { v: [number, number, number]; a: [number, number, number]; t: number; hot: boolean };
}

declare module "../controls" {
  interface CameraController {
    course?: CourseState | null;
    /** the last lesson flown to its end (or given up): its time, its steps left at their time at most */
    courseLast?: { id: CourseId; mode: CourseState["mode"]; t: number; late: string[]; failed?: string } | null;
    /** a guided lesson's words (TARS says them, the page shows them) */
    onCourseSay?: (text: string) => void;
    /** a figure set up again for the pilot, judged (the page does it) */
    onCourseFigure?: (id: string) => void;
    courseStart: typeof courseStart;
    courseOff: typeof courseOff;
    courseFrame: typeof courseFrame;
    courseSample: typeof courseSample;
    courseJet: typeof courseJet;
    courseState: typeof courseState;
  }
}

/** A guided lesson begun where the page has placed the craft (its world and its first step at the first frame with
 *  the figures). What to say. */
function courseStart(this: CameraController, id: CourseId, mode: CourseState["mode"], o: { rwy?: IlsRunway } = {}): string {
  this.course = { id, mode, run: null, rwy: o.rwy };
  this.courseLast = null;
  return mode === "demo"
    ? t("TARS flies it: watch")
    : mode === "try"
      ? t("Your controls — the instructor watching")
      : t("TARS flies first, then hands over to you");
}

function courseOff(this: CameraController) {
  this.course = null;
}

/** The world a lesson needs, `ahead` [m] in front of us: a leader to fly on (formation), an unknown on our right
 *  crossing (intercept), a drone flying its racetrack (guns). Its target's id. */
function lessonWorld(c: CameraController, S: CourseState): number | undefined {
  const g = c.geoNow();
  const f = c.jetFigures();
  if (!g || !f) return undefined;
  const h = Number.isFinite(f.hdg) ? f.hdg : g.track;
  if (c.combat) c.combatEnd();
  const def: Scenario = {
    id: `lesson-${S.id}`,
    title: { fr: "Leçon", en: "Lesson" },
    brief: { fr: "", en: "" },
    anchor: { lat: g.lat, lon: g.lon },
    start: { e: 0, n: 0, agl: f.h, hdg: (h / D + 360) % 360, speed: f.V },
    loadout: "gun",
    targets: [],
    limit: 1e9,
    mission: true,
  };
  c.combatStart(def);
  const W = c.combat!.world;
  const ahead = (d: number, right = 0): [number, number] => [Math.sin(h) * d + Math.cos(h) * right, Math.cos(h) * d - Math.sin(h) * right];
  // (alt over the sea, the fight's ground over the ellipsoid: the geoid between them)
  const agl = (e: number, n: number, alt: number) => Math.max(alt + geoidDeg(g.lat, g.lon) - W.groundZ(e, n), 800);
  const hdgDeg = (h / D + 360) % 360;
  if (S.id === "formation") {
    const [e, n] = ahead(1500);
    const route = tankerTrack(h).map(([de, dn]) => [e + de, n + dn, agl(e + de, n + dn, g.alt)] as [number, number, number]);
    return W.addTarget({
      kind: "airliner",
      at: [e, n, agl(e, n, g.alt)],
      hdg: hdgDeg,
      speed: 170,
      name: "LEAD",
      friendly: true,
      route,
      routeLoop: true,
    });
  }
  if (S.id === "intercept") {
    const [e, n] = ahead(45_000, 15_000);
    const id = W.addTarget({
      kind: "airliner",
      at: [e, n, agl(e, n, g.alt + 1000)],
      hdg: (hdgDeg + 270) % 360,
      speed: 200,
      name: "UNKNOWN",
    });
    const q = W.target(id);
    if (q) (q.neutral = true), (q.squawkOff = true);
    return id;
  }
  // (guns: a drone on a racetrack — its legs 15 km, its turns gentle —, 3 km ahead)
  const [e, n] = ahead(3000);
  const route = tankerTrack(h)
    .map(([de, dn]) => [de / 2, dn / 2] as [number, number])
    .map(([de, dn]) => [e + de, n + dn, agl(e + de, n + dn, g.alt)] as [number, number, number]);
  return W.addTarget({ kind: "drone", at: [e, n, agl(e, n, g.alt)], hdg: hdgDeg, speed: 150, name: "BQM-7", route, routeLoop: true });
}

/** The lesson's target on the radar's picture (its place and velocity relative to us, local frame). */
const targetObj = (c: CameraController, S: CourseState) =>
  S.target === undefined ? undefined : c.radarObjects.find((o) => o.id === `cmb:${S.target}`);

/** The figures and the events now. */
function fixOf(c: CameraController, S: CourseState, g: { lat: number; lon: number; alt: number }): CourseFix | null {
  const f = c.jetFigures();
  const att = c.attitudeNow() as { heading?: number; bank?: number };
  // (on the wheels — rolling out: the jet's figures still there —, after having flown: only the touchdown counts)
  const onGround = !!(c.rolling || c.ourLanded || (c.gearLast?.contact ?? 0) > 0);
  if (!f || onGround) {
    const ev = new Set<string>();
    if (S.wasAir) ev.add("landed");
    // (on the deck: the carrier's pass ended — the wire)
    if (c.trapRun) S.sawTrap = true;
    if (S.sawTrap && !c.trapRun) ev.add("trap-end");
    return { alt: g.alt, hdg: ((att.heading ?? 0) / D + 360) % 360, spd: c.airFlight.last?.speed ?? 0, bank: 0, events: ev };
  }
  S.wasAir = true;
  const ev = new Set<string>();
  // (the runway's frame: the circuit's base point and its centreline, the final's distance)
  const rwy = S.rwy ?? c.ilsRun?.rwy;
  if (rwy) {
    const r = onRunway(rwy, g);
    if (r.along < -3000 && Math.abs(r.across) > 1000) ev.add("base");
    if (Math.abs(r.across) < 250 && Math.abs(wrap180(f.hdg / D - rwy.hdg)) < 25 && r.along < 0) ev.add("axis");
    for (const x of [-3500, -7000]) if (r.along > x) ev.add(`x>${x}`);
  }
  const T = c.trapRun;
  if (T) S.sawTrap = true;
  if (T?.phase === "final") ev.add("trap-final");
  if (S.sawTrap && !T) ev.add("trap-end");
  const A = c.aero;
  if (A?.status === "fly") S.sawFly = true;
  if (S.sawFly && A?.status !== "fly") ev.add("figure-done");
  const o = targetObj(c, S);
  if (o) {
    const d = Math.hypot(...o.r);
    if (d < 25_000) ev.add("range<25km");
    const own = c.radarFix()?.own.v;
    const cues = own ? interceptCues(o.r, o.v, own) : null;
    if (d < 1800 && cues && cues.aspect < 45 && Math.abs(o.r[2]) < 400) ev.add("behind");
    // (in its six: within the gun's reach behind it — a turning drone never lets the intercept settle to its shadow)
    if (d < 700 && cues && cues.aspect < 40) ev.add("six");
  }
  if (c.icpt?.phase === "shadow") {
    ev.add("six");
    if ((c.icpt.last?.dist ?? 99) < 12) ev.add("slot");
  }
  if (S.target !== undefined && c.combat && !c.combat.world.target(S.target)?.alive) ev.add("kill");
  return {
    alt: f.h,
    hdg: ((((Number.isFinite(f.hdg) ? f.hdg : 0) / D) % 360) + 360) % 360,
    spd: f.V,
    bank: (att.bank ?? 0) / D,
    events: ev,
  };
}

/** A step's words, its targets in the pilot's units. */
function sayOf(c: CameraController, R: CourseRun, s: CourseStep): string {
  const u = unitsOf(c.s.units);
  const T = targetsOf(R, s);
  return t(s.say)
    .replace("{alt}", T?.alt !== undefined ? u.fAlt(Math.round(T.alt / 10) * 10) : "")
    .replace("{hdg}", T?.hdg !== undefined ? `${String(Math.round(T.hdg) % 360).padStart(3, "0")}°` : "")
    .replace("{spd}", T?.spd !== undefined ? u.fSpd(T.spd) : "");
}

/** A step begun: said, its acts done. */
function begin(c: CameraController, S: CourseState, R: CourseRun, s: CourseStep) {
  S.sawFly = false;
  S.said = sayOf(c, R, s);
  c.onCourseSay?.(S.said);
  const m = c.jetModes;
  for (const a of s.act ?? ([] as CourseAct[])) {
    if (a === "holds") {
      const T = targetsOf(R, s);
      if (S.id === "circuit" && S.rwy) {
        // (the downwind: 300 m over the field, opposite the landing, 100 m/s, the gear down)
        m.alt = Math.round(S.rwy.elev + 300);
        m.hdg = (((S.rwy.hdg + 180) % 360) * D) as number;
        m.spd = 100;
        c.gearDown = true;
      } else if (T) {
        if (T.alt !== undefined) m.alt = Math.round(T.alt);
        if (T.hdg !== undefined) m.hdg = T.hdg * D;
        if (T.spd !== undefined) m.spd = T.spd;
        m.bankMax = T.bank !== undefined ? Math.abs(T.bank) * D : undefined;
      }
      c.s.flightMode = "plane";
    } else if (a === "free") {
      S.pending = undefined;
      if (c.icpt) c.icptOff();
      if (c.form) c.formOff();
      m.alt = m.hdg = m.spd = null;
      m.bankMax = undefined;
      // (handed over beside another craft: trimmed hands-off — its height and speed held until the stick and the
      // throttle take them —, not left climbing on the intercept's last flight path)
      const k = R.course.kind;
      const f = c.jetFigures();
      if (f && (k === "formation" || k === "intercept" || k === "guns")) {
        m.alt = Math.round(f.h);
        m.spd = Math.round(f.V);
      }
      if (c.ilsRun) c.ilsRun.manual = true;
    } else if (a === "ils-auto" && c.ilsRun) c.ilsRun.manual = false;
    else if (a === "ils-manual" && c.ilsRun) c.ilsRun.manual = true;
    else if (a === "trap-manual" && c.trapRun) c.trapRun.manual = true;
    else if ((a === "icpt" || a === "icpt-slot") && S.target !== undefined) targetAct(c, S, a);
    else if (a === "figure-judge") c.onCourseFigure?.(S.id);
    else if (a === "circuit-auto" && S.rwy) {
      // (the base and the final flown by the approach's autopilot, round from the downwind onto the centreline)
      m.alt = m.hdg = m.spd = null;
      m.bankMax = undefined;
      c.gearDown = true;
      c.ilsStart(S.rwy.icao, { rwy: S.rwy, base: true });
    }
  }
  c.gunTrigger = false;
}

/** The intercept on the lesson's craft — to its six, or to the formation's slot —, once the radar has it. */
function targetAct(c: CameraController, S: CourseState, a: "icpt" | "icpt-slot") {
  const o = targetObj(c, S);
  S.pending = o ? undefined : a;
  if (!o) return;
  if (a === "icpt") c.icptOn(o.name);
  else {
    if (c.form) c.formOff();
    c.icpt = {
      id: o.id,
      name: o.name,
      phase: "run",
      seen: null,
      armed: false,
      last: null,
      slot: { right: 40, back: 40, up: 0 },
      slotName: tf("In the echelon right on {0}", o.name),
    };
    c.s.flightMode = "plane";
  }
}

/** TARS's guns (the guns lesson's steps he flies): within 6 km of the drone, ahead of its beam, a lead pursuit —
 *  near, the nose flown onto the gun's solution: the rounds' lead on its velocity and its turn (game/gunsight.ts) —,
 *  the range closed to 450 m; in his bursts' step, the trigger while the gun's line is within 12 mrad of it, between
 *  150 and 900 m. Null: the intercept brings us there first. */
function courseJet(
  this: CameraController,
  f: { h: number; hdg: number; V: number },
): { gamma: number; bank: number; spd: number; acc: number } | null {
  const S = this.course;
  const st = S?.run?.steps[S.run.i];
  const C = this.combat;
  const P = C?.last;
  const q = S?.target !== undefined ? C?.world.target(S.target) : undefined;
  // (TARS's own steps of the guns lesson: into its six, then the bursts — the intercept's formation law, made for a
  // slot's last metres, fell kilometres behind the drone at its racetrack's corners)
  if (!S || S.id !== "guns" || st?.who !== "tars" || !C || !P || !q?.alive) {
    if (S?.gun) S.gun.hot = false;
    return null;
  }
  const fire = !!st.act?.includes("guns-auto");
  const r: [number, number, number] = [q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]];
  const rng = Math.hypot(...r);
  const vl = Math.hypot(...P.v) || 1;
  const u = P.v.map((x) => x / vl) as [number, number, number];
  // (its acceleration: the velocity's change eased over half a second)
  const G = (S.gun ??= { v: [...q.v] as [number, number, number], a: [0, 0, 0], t: C.t, hot: false });
  const dt = C.t - G.t;
  if (dt > 0.05) {
    const k = Math.min(1, dt / 0.5);
    for (let i = 0; i < 3; i++) G.a[i] = G.a[i]! + ((q.v[i]! - G.v[i]!) / dt - G.a[i]!) * k;
    G.v = [...q.v] as [number, number, number];
    G.t = C.t;
  }
  const ahead = (r[0] * u[0] + r[1] * u[1] + r[2] * u[2]) / Math.max(rng, 1);
  // (far, or behind its beam: the intercept's run first)
  if (rng > 6000 || ahead < 0) return (G.hot = false), null;
  // (the gun's solution near; farther, a lead pursuit on where it will be in some seconds)
  const sol = rng < 2500 ? gunSolution(P, { p: q.p, v: q.v, a: G.a }) : null;
  const lead = Math.min(rng / 400, 8);
  const fut = [0, 1, 2].map((k) => r[k]! + q.v[k]! * lead);
  const fl = Math.hypot(...fut) || 1;
  const d: [number, number, number] = sol ? sol.dir : [fut[0]! / fl, fut[1]! / fl, fut[2]! / fl];
  // (the nose's offset from the path — the incidence —: the path aimed that much under the solution)
  const nl = Math.hypot(...P.fwd) || 1;
  const w = [d[0] - (P.fwd[0] / nl - u[0]), d[1] - (P.fwd[1] / nl - u[1]), d[2] - (P.fwd[2] / nl - u[2])];
  const wl = Math.hypot(w[0]!, w[1]!, w[2]!) || 1;
  const gammaWant = Math.asin(Math.max(-1, Math.min(1, w[2]! / wl)));
  const gammaNow = Math.asin(Math.max(-1, Math.min(1, u[2])));
  const trk = Math.atan2(u[0], u[1]);
  const hErr = wrap180((Math.atan2(w[0]!, w[1]!) - trk) / D) * D;
  // (its own turn led: the target's rate about the vertical, then the gap closed in about a second)
  const vt = Math.hypot(q.v[0], q.v[1]) || 1;
  const wT = (q.v[0] * G.a[1] - q.v[1] * G.a[0]) / (vt * vt);
  const omega = -wT + 1.2 * hErr;
  const bank = Math.max(-75 * D, Math.min(75 * D, Math.atan2(f.V * omega, 9.80665)));
  const gamma = gammaWant + 0.8 * (gammaWant - gammaNow);
  const close = Math.max(-30, Math.min(70, 0.08 * (rng - 450)));
  const err = Math.acos(Math.max(-1, Math.min(1, (d[0] * P.fwd[0] + d[1] * P.fwd[1] + d[2] * P.fwd[2]) / nl)));
  G.hot = fire && !!sol && err < 0.012 && rng > 150 && rng < 900;
  return { gamma: Math.max(-30 * D, Math.min(30 * D, gamma)), bank, spd: Math.hypot(...q.v) + close, acc: close / 10 };
}

/**
 * What is left of the step now — the measure its end comes nearer by (null: none, a time's step): the deviations from
 * its targets (in their tolerances); the distance to the threshold, to the circuit's base point, to the centreline;
 * to the carrier; the range to the lesson's craft (its slot's distance once joined), its hit points left; a figure's
 * own clock flying (its time, negative: going on is progress).
 */
function leftOf(
  c: CameraController,
  S: CourseState,
  st: CourseStep,
  F: CourseFix,
  g: { lat: number; lon: number; alt: number },
): number | null {
  const R = S.run!;
  const d = st.done;
  if ("time" in d) return null;
  if ("held" in d) {
    const v = deviations(R, F);
    const n = (x: number, tol: number) => (Number.isFinite(x) ? Math.abs(x) / tol : 0);
    // (while the turn is to be made: the heading still to turn)
    const T = targetsOf(R, st);
    const turn = T?.hdg !== undefined && !Number.isFinite(v.hdg) ? Math.abs(wrap180(F.hdg - T.hdg)) / 5 : 0;
    return n(v.alt, 40) + n(v.hdg, 5) + n(v.spd, 8) + turn;
  }
  const ev = d.event;
  const rwy = c.ilsRun?.rwy ?? S.rwy;
  if (ev === "landed") {
    // (down: the roll-out's speed; in the air: the way to the threshold, then its height)
    if (F.events.has("landed")) return 0;
    if (!rwy) return null;
    const r = onRunway(rwy, g);
    return Math.hypot(Math.min(r.along, 0), r.across) + Math.max(r.h, 0);
  }
  if (ev.startsWith("x>") && rwy) return Math.max(Number(ev.slice(2)) - onRunway(rwy, g).along, 0);
  if (ev === "base" && rwy) return Math.max(onRunway(rwy, g).along + 3000, 0);
  if (ev === "axis" && rwy) {
    const r = onRunway(rwy, g);
    return Math.abs(r.across) + Math.abs(wrap180((F.hdg - rwy.hdg + 360) % 360)) * 10;
  }
  if (ev === "trap-final" || ev === "trap-end") {
    const P = c.carrierNow()[0]?.P;
    if (!P) return null;
    if (ev === "trap-end" && (c.trapRun?.phase === "trapped" || c.ourLanded)) return 0;
    const e = (P.lon - g.lon) * D * 6_371_008.8 * Math.cos(g.lat * D);
    const n = (P.lat - g.lat) * D * 6_371_008.8;
    return Math.hypot(e, n);
  }
  if (ev === "figure-done") {
    const A = c.aero;
    return A ? -A.t : null;
  }
  const o = targetObj(c, S);
  if (ev === "kill") {
    const q = S.target !== undefined ? c.combat?.world.target(S.target) : undefined;
    return q ? (q.alive ? q.hp * 100 + (o ? Math.hypot(...o.r) : 0) : 0) : null;
  }
  if (ev === "slot") return c.icpt?.last?.dist ?? (o ? Math.hypot(...o.r) : null);
  return o ? Math.hypot(...o.r) : null;
}

/** A demonstration that has not come nearer its step's end this long is given up [s]. */
export const COURSE_STALL = 90;

/** A frame of the lesson: its world made, its first step begun, its steps followed; its end said. */
function courseFrame(this: CameraController, dt: number) {
  const S = this.course;
  if (!S || !(dt > 0)) return;
  if (fleet.active !== "f35") return this.courseOff();
  const g = this.geoNow();
  if (!g) return;
  if (!S.run) {
    const f = this.jetFigures();
    if (!f || !Number.isFinite(f.hdg)) return;
    if (S.id === "formation" || S.id === "intercept" || S.id === "guns") {
      S.target = lessonWorld(this, S);
      // (the radar sweeps the lesson's craft at once)
      this.radarSweep = true;
    }
    if (S.rwy) S.side = Math.sign(onRunway(S.rwy, g).across) || 1;
    S.run = newCourse(S.id, S.mode, f.h, (((f.hdg / D) % 360) + 360) % 360);
    if (S.run.done) return this.courseOff();
    begin(this, S, S.run, S.run.steps[0]!);
    return;
  }
  if (S.pending === "icpt" || S.pending === "icpt-slot") targetAct(this, S, S.pending);
  // (the circuit's downwind flown by TARS: its track held 1.8 km abeam — the heading nudged by the gap)
  const st = S.run.steps[S.run.i];
  if (S.id === "circuit" && S.rwy && st?.who === "tars" && this.jetModes.hdg !== null) {
    const r = onRunway(S.rwy, g);
    const side = S.side ?? 1;
    const k = Math.max(-20, Math.min(20, 0.08 * (side * 1800 - r.across) * side));
    this.jetModes.hdg = ((((S.rwy.hdg + 180 - k * side) % 360) + 360) % 360) * D;
  }
  if (st?.act?.includes("guns-auto")) this.gunTrigger = !!S.gun?.hot;
  const F = fixOf(this, S, g);
  if (!F) return;
  // (the step's progress: the least of what is left, when; stalled since — a demonstration stalled too long given up:
  // said, logged, the jet left as it is)
  const left = st ? leftOf(this, S, st, F, g) : null;
  S.left = left ?? undefined;
  // (an autopilot's phase changed — the ILS's, the carrier pattern's leg, the intercept's, the figure's —: progress)
  const key = `${this.ilsRun?.phase}|${this.trapRun?.phase}|${this.trapRun?.leg ?? ""}|${this.icpt?.phase}|${this.aero?.status}`;
  if (key !== S.key) {
    S.key = key;
    S.best = S.bestAt = undefined;
  }
  if (left === null) S.stalled = 0;
  else {
    const eps = Math.max(Math.abs(S.best ?? 0) * 0.01, 1);
    if (S.best === undefined || left < S.best - eps) {
      S.best = left;
      S.bestAt = S.run.st;
    }
    S.stalled = S.run.st - (S.bestAt ?? 0);
  }
  if (S.mode === "demo" && (S.stalled ?? 0) > COURSE_STALL) {
    S.failed = st?.name ?? "?";
    this.gunTrigger = false;
    this.onCourseSay?.(tf("The demonstration stopped: {0} went nowhere for {1} s", t(S.failed), COURSE_STALL));
    this.courseLast = { id: S.id, mode: S.mode, t: S.run.t, late: [...S.run.late], failed: S.failed };
    this.course = null;
    return;
  }
  const out = courseStep(S.run, F, dt);
  if (out.begin) {
    S.best = S.bestAt = undefined;
    S.stalled = 0;
    begin(this, S, S.run, out.begin);
  }
  if (out.end) {
    this.gunTrigger = false;
    // (a demonstration: the pilot handed the jet as it is, the holds on)
    if (S.mode === "demo") this.onCourseSay?.(t("That was the demonstration. Your turn when you like — Try it."));
    else this.onCourseSay?.(t(S.run.course.end));
    this.courseLast = { id: S.id, mode: S.mode, t: S.run.t, late: [...S.run.late] };
    this.course = null;
  }
}

/** The approach speed now [m/s]. */
const vApp = () => approachSpeed(fleet.massProps().mass, VESSELS.f35.aero!.wing!.S);

/**
 * What the instructor watches in a guided lesson's own kinds, while the pilot flies (null: TARS's steps, or the
 * approach's and the figure's — watched as ever): its kind, its lesson, where (the time, the distance), its phase (the
 * step), the channels' deviations, its point in the lesson's plane (px, py).
 */
function courseSample(
  this: CameraController,
): { kind: "basic" | "circuit" | "formation" | "intercept" | "guns"; x: number; phase: string; v: Record<string, number> } | null {
  const S = this.course;
  const R = S?.run;
  if (!S || !R || R.done) return null;
  const s = R.steps[R.i];
  if (!s || s.who !== "you") return null;
  const kind = R.course.kind;
  const g = this.geoNow();
  const f = this.jetFigures();
  if (!g || !f) return null;
  const att = this.attitudeNow() as { heading?: number; bank?: number };
  const phase = s.name;
  if (kind === "basic") {
    const d = deviations(R, { alt: f.h, hdg: (((f.hdg / D) % 360) + 360) % 360, spd: f.V, bank: (att.bank ?? 0) / D, events: new Set() });
    return { kind, x: R.t, phase, v: { ...d, px: R.t, py: f.h - R.alt0 } };
  }
  if (kind === "circuit" && S.rwy) {
    const r = onRunway(S.rwy, g);
    const side = S.side ?? 1;
    const final = s.name === "Final";
    const path = Math.max((ILS.gpi - r.along) * Math.tan(ILS.glide * D), 0);
    return {
      kind,
      x: r.along,
      phase: final && r.h < ILS.flare ? "Flare" : phase,
      v: {
        alt: final ? r.h - path : r.h - 200,
        off: final ? r.across * side : Number.NaN,
        spd: f.V - (final ? vApp() + 4 : 90),
        px: r.along,
        py: r.across * side,
      },
    };
  }
  const o = targetObj(this, S);
  const own = this.radarFix()?.own;
  if (!o || !own) return null;
  if (kind === "formation") {
    const vh = Math.hypot(o.v[0], o.v[1]) || 1;
    const fw = [o.v[0] / vh, o.v[1] / vh];
    const rt = [fw[1]!, -fw[0]!];
    // (the slot from us: the leader, 40 m back, 40 m to its right)
    const sl = [o.r[0] - fw[0]! * 40 + rt[0]! * 40, o.r[1] - fw[1]! * 40 + rt[1]! * 40, o.r[2]];
    const fwd = -(sl[0]! * fw[0]! + sl[1]! * fw[1]!);
    const right = -(sl[0]! * rt[0]! + sl[1]! * rt[1]!);
    return { kind, x: R.t, phase, v: { fwd, right, up: -sl[2]!, px: 40 + right, py: -sl[2]! } };
  }
  if (kind === "intercept") {
    const cues = interceptCues(o.r, o.v, own.v);
    const d = Math.hypot(...o.r);
    const ideal = d > 8000 ? (cues.collHdg ?? cues.pureHdg) : cues.pureHdg;
    const trk = Math.atan2(own.v[0], own.v[1]);
    const vh = Math.hypot(o.v[0], o.v[1]) || 1;
    const tu = [o.v[0] / vh, o.v[1] / vh];
    return {
      kind,
      x: R.t,
      phase: d > 8000 ? "The collision course" : "The conversion",
      v: {
        hdg: wrap180((trk - ideal) / D),
        alt: -o.r[2],
        px: -(o.r[0] * tu[0]! + o.r[1] * tu[1]!),
        py: -(o.r[0] * -tu[1]! + o.r[1] * tu[0]!),
      },
    };
  }
  // guns: the target off the nose
  const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const ahead = dot(o.r, own.fwd);
  const az = Math.atan2(dot(o.r, own.right), ahead) / D;
  const el = Math.atan2(dot(o.r, own.up), ahead) / D;
  const rng = Math.hypot(...o.r);
  return { kind: "guns", x: R.t, phase, v: { az, el, rng: rng - 450, px: az, py: el } };
}

/** A lesson's state for the page and the tests: its step (of how many, who flies it, its name), the step's time and
 *  its most, the lesson's time, what is left of the step, how long it has not come nearer; the last one's end. */
function courseState(this: CameraController) {
  const S = this.course;
  const R = S?.run;
  const st = R?.steps[R.i];
  return {
    id: S?.id ?? null,
    mode: S?.mode ?? null,
    step: R ? R.i + 1 : 0,
    steps: R?.steps.length ?? 0,
    who: st?.who ?? null,
    name: st?.name ?? null,
    stepT: R?.st ?? 0,
    stepMax: st?.max ?? null,
    t: R?.t ?? 0,
    left: S?.left ?? null,
    stalled: S?.stalled ?? 0,
    late: R ? [...R.late] : [],
    last: this.courseLast ?? null,
  };
}

export function installCourse(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { courseStart, courseOff, courseFrame, courseSample, courseJet, courseState });
}
