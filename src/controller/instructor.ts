// The CameraController — the instructor (game/instructor.ts, A4): the manoeuvre flown found (an ILS approach from its
// localizer on, a carrier's pass on its final, an aerobatic figure once flown), its channels measured each frame —
// the needles in dots, the glide path's error and the line-up, the load against the one asked, the speed against
// its target — with where it is (the distance, the time) and its phase; the calls handed to the page (said by TARS,
// shown with their fix); the debrief at its end (the page's charts). The setting: off, the calls only, or the calls
// and the page's panel.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { approachSpeed } from "../game/trap";
import { FIGURES, type FigureId } from "../game/aerobatics";
import { ilsReading } from "../game/ils";
import { type InstrDebrief, instrDebrief, type InstrRun, instrStep, type LessonKind, newInstr } from "../game/instructor";
import { fleet } from "../fleet";
import { LESSONS } from "../game/lessons";
import { t } from "../i18n";
import { VESSELS } from "../vessels";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    instr?: InstrRun | null;
    instrLast?: { run: InstrRun; debrief: InstrDebrief } | null;
    /** a call (its words, its fix) — the page says and shows it */
    onInstrCall?: (text: string, fix: string) => void;
    /** a manoeuvre ended: its debrief — the page shows it */
    onInstrDebrief?: (last: NonNullable<CameraController["instrLast"]>) => void;
    instrFrame: typeof instrFrame;
  }
}

/** The approach's speed for the jet's mass now [m/s] (as the ILS's and the carrier's autopilots fly it). */
const vApp = () => approachSpeed(fleet.massProps().mass, VESSELS.f35.aero!.wing!.S);

/** What is flown now that the instructor watches: its kind, its lesson's id and title, and its sample (where, the
 *  phase, the channels and the graphs' values). Null: nothing. */
function watched(
  c: CameraController,
): { kind: LessonKind; id: string; title: string; x: number; phase: string; v: Record<string, number> } | null {
  // (a guided lesson — controller/course.ts —: the pilot's steps alone, as its own lesson; its own kinds sampled there)
  const C = c.course;
  if (C) {
    const s = C.run?.steps[C.run.i];
    if (!C.run || C.run.done || s?.who !== "you") return null;
    const L = LESSONS.find((x) => x.id === C.id);
    const title = L ? t(L.title) : C.id;
    const own = c.courseSample();
    if (own) return { ...own, id: C.id, title };
    const w = watchedOwn(c);
    return w ? { ...w, id: C.id, title } : null;
  }
  return watchedOwn(c);
}

/** What is flown now outside a guided lesson: an ILS approach, a carrier's pass, a figure. */
function watchedOwn(
  c: CameraController,
): { kind: LessonKind; id: string; title: string; x: number; phase: string; v: Record<string, number> } | null {
  const V = c.airFlight.last?.speed ?? 0;
  const I = c.ilsRun;
  if (I && (I.phase === "intercept" || I.phase === "final" || I.phase === "flare")) {
    const g = c.geoNow();
    if (!g) return null;
    const r = ilsReading(I.rwy, g);
    return {
      kind: "ils",
      id: "ils",
      title: t("ILS approach"),
      x: r.along,
      phase: I.phase === "intercept" ? "Intercept" : I.phase === "final" ? "Final" : "Flare",
      v: {
        gs: r.locIn && r.gsIn ? r.gs : Number.NaN,
        loc: r.locIn ? r.loc : Number.NaN,
        spd: I.phase === "intercept" ? Number.NaN : V - (vApp() + 4),
        h: r.h,
        across: r.across,
      },
    };
  }
  const T = c.trapRun;
  if (T?.phase === "final" && T.now) {
    return {
      kind: "carrier",
      id: "case1",
      title: t("Carrier: Case I and the ball"),
      x: -T.now.dist,
      phase: T.now.dist > 1300 ? "Groove" : T.now.dist > 450 ? "In the middle" : "In close",
      v: { glide: T.now.err, lineup: T.now.lineup, spd: V - vApp() },
    };
  }
  const A = c.aero;
  if (A && A.status === "fly" && A.tr.length > 1) {
    const s = A.tr[A.tr.length - 1]!;
    const f0 = A.tr[0]!.fwd;
    const hl = Math.hypot(f0[0], f0[1]) || 1;
    const along = (s.pa[0] * f0[0] + s.pa[1] * f0[1]) / hl;
    const H = c.aeroHud();
    const load = H?.guide?.load;
    return {
      kind: "figure",
      id: A.id,
      title: t(FIGURES[A.id as FigureId].name),
      x: A.t,
      phase: H?.cue ?? "",
      v: { g: load != null ? s.nz - load : Number.NaN, spd: s.V < 120 ? s.V - 150 : Number.NaN, along, up: s.pa[2] },
    };
  }
  return null;
}

/** A frame of the instructor: the manoeuvre's run begun, stepped (its call handed on), ended (its debrief). */
function instrFrame(this: CameraController, dt: number) {
  const mode = this.s.f35Instructor ?? "full";
  const w = fleet.active === "f35" && mode !== "off" && dt > 0 ? watched(this) : null;
  const R = this.instr;
  if (R && (!w || w.id !== R.id)) {
    // (ended: its debrief, when it was flown long enough to judge)
    if (R.samples.length > 15) {
      this.instrLast = { run: R, debrief: instrDebrief(R) };
      this.onInstrDebrief?.(this.instrLast);
    }
    this.instr = null;
  }
  if (!w) return;
  const run = (this.instr ??= newInstr(w.kind, w.id, w.title));
  const call = instrStep(run, w.x, w.phase, w.v, dt);
  if (call) this.onInstrCall?.(t(call.text), t(call.fix));
}

export function installInstructor(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { instrFrame });
}
