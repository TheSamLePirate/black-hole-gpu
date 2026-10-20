// The space flight school flown (PLAN-VAISSEAUX X9 — game/spacecourse.ts): a lesson's run on the controller — each
// frame its figures read (the orbit, the hold's alignment, the docking, the ground, the failures…), its steps' changes
// acted on: a step begun said (TARS's voice, a toast) and its acts done (TARS's steps; in a demonstration the pilot's
// too), a step done said, the lesson's end graded (its report). The acts that need the game's tools (a manoeuvre
// planned, a mission, the plan executed, the warp, the launch goal) handed to the page (onSpaceCourseAct).

import { cameraFrame } from "../camera";
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import type { FailureKind } from "../game/systems";
import {
  lessonScore,
  SPACE_LESSONS,
  type SpaceAct,
  type SpaceFix,
  type SpaceLessonId,
  type SpaceRun,
  startRun,
  stepRun,
} from "../game/spacecourse";
import type { RangerStatus } from "../game/status";
import { t, tf } from "../i18n";
import type { Hold } from "../pilot";
import { cartToGeodetic, flatteningOf } from "../system/ellipsoid";
import { toBodyFixed } from "../system/our-surface";
import { solarBody, solarState } from "../system/solar";
import { C_MPS } from "../units";

declare module "../controls" {
  interface CameraController {
    spaceCourse: SpaceRun | null;
    spaceCourseBegin: typeof spaceCourseBegin;
    spaceCourseOff: typeof spaceCourseOff;
    spaceCourseFrame: typeof spaceCourseFrame;
    /** the page's acts (a manoeuvre, a mission, the plan executed, the warp, the launch goal) */
    onSpaceCourseAct?: (a: SpaceAct) => void;
    /** a step said: by TARS or as the instructor */
    onLessonSay?: (text: string) => void;
    /** where the current step began: the nose, the Δv spent */
    spaceStep0?: { nose: [number, number, number] | null; spent: number };
  }
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const D = 180 / Math.PI;

/** A lesson begun (the page has set its scene up): its run, its first step said. */
function spaceCourseBegin(this: CameraController, id: SpaceLessonId, mode: SpaceRun["mode"]): string {
  const L = SPACE_LESSONS.find((x) => x.id === id);
  if (!L) return t("No such lesson");
  this.spaceCourse = startRun(L, mode);
  this.spaceStep0 = undefined;
  return tf("Lesson: {0}", t(L.title));
}

function spaceCourseOff(this: CameraController) {
  this.spaceCourse = null;
}

/** A step's acts done (the controller's own; the others the page's). */
function act(c: CameraController, a: SpaceAct) {
  if ("sas" in a) c.pilot.sas = a.sas;
  else if ("hold" in a) c.pilot.setHold(a.hold as Hold);
  else if ("auto" in a) {
    if (a.auto === "dock" && c.pilot.auto !== "dock") {
      const said = c.rendezvousStart();
      if (said) c.onPilotMessage?.(said);
    }
    c.pilot.setAuto(a.auto as never);
  } else if ("rcs" in a) {
    if ((c.rcsMode ?? "rotate") !== a.rcs) c.rcsModeToggle();
  } else if ("fail" in a) c.systemsFail(a.fail as FailureKind);
  else if ("fix" in a) {
    const k = a.fix as FailureKind;
    c.systemsFix(k);
  } else if ("spin" in a) {
    c.pilot.omega = [...a.spin];
  } else if ("recover" in a) c.recoverStart();
  else c.onSpaceCourseAct?.(a);
}

/** The lesson's figures now (a spacecraft on our side; the hole's: the clocks only) — the challenges' too. */
export function fixOf(c: CameraController, st: RangerStatus | null): Omit<SpaceFix, "stepT"> {
  const P = c.pilot;
  const pose = c.activePoseNow();
  const nose = pose ? (pose.ax[2] as V3) : null;
  // the hold's direction: about the body of the sphere (its prograde, normal, radial)
  let holdOk = false;
  const nav = cameraFrame(c.s).region !== "hole" ? c.ourNav(cameraFrame(c.s)) : null;
  const body = st?.soi;
  if (nose && nav && body && solarBody(body) && P.hold !== "none") {
    const B = solarState(body, nav.t);
    const r = unit([nav.X[0] - B.pos[0], nav.X[1] - B.pos[1], nav.X[2] - B.pos[2]]);
    const v = unit([nav.V[0] - B.vel[0], nav.V[1] - B.vel[1], nav.V[2] - B.vel[2]]);
    const n = unit(cross(r, v));
    const dir: Record<string, V3> = {
      prograde: v,
      retrograde: [-v[0], -v[1], -v[2]],
      normal: n,
      antinormal: [-n[0], -n[1], -n[2]],
      radialOut: r,
      radialIn: [-r[0], -r[1], -r[2]],
    };
    const d = dir[P.hold];
    holdOk = !!d && Math.acos(Math.max(-1, Math.min(1, dot(unit(nose), d)))) * D < 5;
  }
  const S0 = (c.spaceStep0 ??= { nose: nose ? [...nose] : null, spent: c.spent });
  const turn = nose && S0.nose ? Math.acos(Math.max(-1, Math.min(1, dot(unit(nose), unit(S0.nose))))) * D : 0;
  const o = st?.orbit;
  // (where over the body: its fixed axes, its figure — the challenges' landing points)
  let lat: number | null = null,
    lon: number | null = null;
  const B = body ? solarBody(body) : null;
  if (nav && B && body) {
    const g = cartToGeodetic(B.radius, flatteningOf(body), toBodyFixed(body, nav.X, nav.t));
    lat = g.lat * D;
    lon = g.lon * D;
  }
  return {
    lat,
    lon,
    altKm: st ? st.altKm : null,
    g: Math.abs(c.airInfo().g || 0),
    side: st?.side ?? "ours",
    kerrR: st?.kerr ? st.kerr.r : null,
    ringRpm: c.ringInfo()?.rpm ?? null,
    soi: st?.soi ?? "",
    pe: o ? o.peKm : null,
    ap: o && o.ecc < 1 ? o.apKm : null,
    ecc: o ? o.ecc : null,
    inc: o ? o.incDeg : null,
    hold: P.hold,
    holdOk,
    sas: P.sas,
    rcs: c.rcsMode ?? "rotate",
    auto: P.auto,
    docked: !!c.docked || fleet.links.length > 0,
    landed: !!(c.ourLanded || c.rolling),
    targetM: st?.target ? st.target.distKm * 1000 : null,
    nodes: c.plan.nodes.length,
    failures: c.systemsInfo()?.failures.length ?? 0,
    rate: Math.hypot(...P.omega) * D,
    turn,
    dv: (c.spent - S0.spent) * C_MPS,
    lpdMoved: !!c.landRun?.moved,
    next: st?.next?.kind ?? "",
  };
}

/** One frame of the lesson (main.ts, with the flight's status). */
function spaceCourseFrame(this: CameraController, dt: number, st: RangerStatus | null) {
  const R = this.spaceCourse;
  if (!R || R.done || !this.piloting || !this.s.animate) return;
  const F = fixOf(this, st);
  for (const e of stepRun(R, F, dt)) {
    if (e.kind === "begin") {
      this.spaceStep0 = undefined;
      const s = e.step;
      const flies = s.who === "tars" ? s.act : R.mode === "demo" ? s.auto : undefined;
      // (a demonstration: TARS flies the pilot's steps — his own words for them, else "I fly it")
      this.onLessonSay?.(s.who === "you" && R.mode === "demo" ? (s.demoSay ? t(s.demoSay) : tf("I fly it: {0}", t(s.name))) : t(s.say));
      for (const a of flies ?? []) act(this, a);
    } else if (e.kind === "done") {
      if (e.step.who === "you")
        this.onPilotMessage?.(e.ok ? tf("✓ {0}", t(e.step.name)) : tf("{0}: the time is up — on to the next", t(e.step.name)));
    } else {
      const L = R.lesson;
      this.onLessonSay?.(t(L.end));
      const score = lessonScore(R);
      this.onFlightReport?.({
        kind: "lesson",
        ref: `lesson:${L.id}`,
        title: tf("Lesson · {0}", t(L.title)),
        score,
        letter: score >= 17 ? "A" : score >= 14 ? "B" : score >= 10 ? "C" : score >= 6 ? "D" : "F",
        lines: R.results.map((r) => ({
          label: t(r.name),
          value: r.ok ? `✓ ${Math.round(r.s)} s` : t("time up"),
          q: r.ok ? "good" : "bad",
        })),
      });
      this.spaceCourse = null;
    }
  }
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installSpaceCourse(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { spaceCourseBegin, spaceCourseOff, spaceCourseFrame });
}
