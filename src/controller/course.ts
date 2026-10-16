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
import { interceptCues } from "../game/intercept";
import { tankerTrack } from "../game/jetmodes";
import type { Scenario } from "../game/scenarios";
import { approachSpeed } from "../game/trap";
import { fleet } from "../fleet";
import { t, tf } from "../i18n";
import { unitsOf } from "../ui/unitsys";
import { VESSELS } from "../vessels";
import type { CameraController } from "../controls";

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
}

declare module "../controls" {
  interface CameraController {
    course?: CourseState | null;
    /** a guided lesson's words (TARS says them, the page shows them) */
    onCourseSay?: (text: string) => void;
    /** a figure set up again for the pilot, judged (the page does it) */
    onCourseFigure?: (id: string) => void;
    courseStart: typeof courseStart;
    courseOff: typeof courseOff;
    courseFrame: typeof courseFrame;
    courseSample: typeof courseSample;
  }
}

/** A guided lesson begun where the page has placed the craft (its world and its first step at the first frame with
 *  the figures). What to say. */
function courseStart(this: CameraController, id: CourseId, mode: CourseState["mode"], o: { rwy?: IlsRunway } = {}): string {
  this.course = { id, mode, run: null, rwy: o.rwy };
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
  const agl = (e: number, n: number, alt: number) => Math.max(alt - W.groundZ(e, n), 800);
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
  if (!f) {
    // (on the ground: only the touchdown counts)
    const ev = new Set<string>();
    if (S.wasAir) ev.add("landed");
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
  }
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
  const F = fixOf(this, S, g);
  if (!F) return;
  const out = courseStep(S.run, F, dt);
  if (out.begin) begin(this, S, S.run, out.begin);
  if (out.end) {
    // (TARS's part alone: the pilot handed the jet as it is, the holds on)
    if (S.mode === "demo") this.onCourseSay?.(t("That was the demonstration. Your turn when you like — Try it."));
    else this.onCourseSay?.(t(S.run.course.end));
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

export function installCourse(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { courseStart, courseOff, courseFrame, courseSample });
}
