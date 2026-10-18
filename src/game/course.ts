// The guided lessons (docs/PLAN-AVIATION-AAA.md, I3): TARS flies first — each of his steps said as he begins it, the
// autopilot doing it —, then hands over ("your controls") and the pilot flies the rest, the instructor watching
// (game/instructor.ts) and correcting with the telemetry; the debrief at the end. A lesson as data: its steps, who
// flies each, what it asks (a height, a heading, a speed, a bank — relative to where the lesson began), what the
// autopilot is set to at its start, when it is done (the targets held a while, a time, an event the controller
// sees: the base point, the final, the touchdown, the six, a kill…), how long at most. Pure: the controller feeds the
// figures and the events, the step's changes come out. Its words English, translated by t().

import type { FigureId } from "./aerobatics";

export type CourseId = "first" | "circuit" | "landing" | "formation" | "intercept" | "guns" | "ils" | "case1" | FigureId;

/** What the controller does at a step's start. */
export type CourseAct =
  /** the holds set to the step's targets (altitude, heading, speed; the bank at most) */
  | "holds"
  /** the holds, the intercept, the formation let go: the pilot flies */
  | "free"
  /** the ILS's autopilot flies; the needles left to the pilot */
  | "ils-auto"
  | "ils-manual"
  /** the carrier's pass left to the pilot */
  | "trap-manual"
  /** the intercept on the lesson's target (to its shadow — its six —; to the formation's slot) */
  | "icpt"
  | "icpt-slot"
  /** the figure set up again for the pilot, judged */
  | "figure-judge"
  /** (a demonstration's — TARS flying the pilot's part too:) the circuit's base and final by the approach's autopilot */
  | "circuit-auto"
  /** the gun fired by TARS when its pipper is on the lesson's target */
  | "guns-auto";

/** Its targets, relative to the lesson's start: the height's change [m], the heading's [°], the speed [m/s], the
 *  bank while turning [°, + right]. */
export interface CourseTarget {
  dAlt?: number;
  dHdg?: number;
  spd?: number;
  bank?: number;
}

export type CourseDone = { held: number } | { time: number } | { event: string; hold?: number };

export interface CourseStep {
  who: "tars" | "you";
  name: string;
  /** what TARS says at its start ({alt}, {hdg}, {spd}: the targets in the pilot's units) */
  say: string;
  act?: CourseAct[];
  target?: CourseTarget;
  done: CourseDone;
  /** at most [s]: then on to the next anyway */
  max?: number;
  /** a pilot's step in a demonstration: what TARS does to fly it himself (none: left out of the demonstration —
   *  a figure's second time), his words then, its name */
  auto?: CourseAct[];
  demoSay?: string;
  demoName?: string;
}

export interface Course {
  id: CourseId;
  /** the instructor's channels for the pilot's steps (game/instructor.ts) */
  kind: "basic" | "circuit" | "formation" | "intercept" | "guns" | "ils" | "carrier" | "figure";
  steps: CourseStep[];
  /** said at its end */
  end: string;
}

/** The targets' tolerances for "held": the height [m], the heading [°], the speed [m/s]. */
export const COURSE = { alt: 40, hdg: 5, spd: 8 };

const FIRST: Course = {
  id: "first",
  kind: "basic",
  steps: [
    {
      who: "tars",
      name: "Level flight",
      say: "I have control. Level flight: the nose on the horizon, the wings level, {spd}. Watch the attitude — the autopilot holds it.",
      act: ["holds"],
      target: { dAlt: 0, dHdg: 0, spd: 200 },
      done: { time: 8 },
    },
    {
      who: "tars",
      name: "A level turn",
      say: "A level turn to the right, 90°: 30° of bank, a little back pressure to hold the height.",
      act: ["holds"],
      target: { dAlt: 0, dHdg: 90, spd: 200, bank: 30 },
      done: { held: 2 },
      // (90° at 30° of bank and 200 m/s: 1.6° a second — some 60 s with the roll in and out)
      max: 90,
    },
    {
      who: "tars",
      name: "A climb",
      say: "A climb of 500 m: power and the nose up — then the level-off, begun a little before the height.",
      act: ["holds"],
      target: { dAlt: 500, dHdg: 90, spd: 200 },
      done: { held: 3 },
      max: 60,
    },
    {
      who: "you",
      name: "Your controls: level",
      say: "Your controls. Hold this: level at {alt}, heading {hdg}, {spd}.",
      act: ["free"],
      auto: ["holds"],
      demoName: "Holding level",
      demoSay: "Level at {alt}, heading {hdg}, {spd}: the attitude set, the trim taking the pressure off — hands light.",
      target: { dAlt: 500, dHdg: 90, spd: 200 },
      done: { held: 10 },
      max: 60,
    },
    {
      who: "you",
      name: "Turn back left",
      say: "Now a level turn to the left, back to heading {hdg}: 30° of bank, the height held.",
      auto: ["holds"],
      demoName: "Turn back left",
      demoSay: "A level turn to the left, back to heading {hdg}: 30° of bank, the nose on the horizon.",
      target: { dAlt: 500, dHdg: 0, spd: 200, bank: -30 },
      done: { held: 3 },
      max: 90,
    },
    {
      who: "you",
      name: "Descend",
      say: "Descend 500 m, back to {alt}: the nose a little down, the power back — and level off smoothly.",
      auto: ["holds"],
      demoName: "Descend",
      demoSay: "A descent of 500 m, back to {alt}: the power back, the nose a little down — the level-off begun early.",
      target: { dAlt: 0, dHdg: 0, spd: 200 },
      done: { held: 5 },
      max: 90,
    },
    {
      who: "you",
      name: "Slow down",
      say: "Slow to {spd}: the power back, the nose up as it slows, the height held.",
      auto: ["holds"],
      demoName: "Slow down",
      demoSay: "Slowing to {spd}: the power back, the nose raised as the speed falls, the height held.",
      target: { dAlt: 0, dHdg: 0, spd: 160 },
      done: { held: 5 },
      max: 60,
    },
  ],
  end: "That was your first flight. The debrief is on screen.",
};

const CIRCUIT: Course = {
  id: "circuit",
  kind: "circuit",
  steps: [
    {
      who: "tars",
      name: "Downwind",
      say: "I have control. The downwind leg: 300 m over the field, 1.8 km abeam, 100 m/s, the gear down — opposite the landing.",
      act: ["holds"],
      done: { event: "base" },
      max: 150,
    },
    {
      who: "you",
      name: "Base turn",
      say: "Your controls. The base turn now: 90° towards the runway, down to 200 m, 90 m/s.",
      act: ["free"],
      auto: ["circuit-auto"],
      demoName: "Base turn",
      demoSay: "The base turn: 90° towards the runway, the power back, down to 200 m — then onto the centreline.",
      done: { event: "axis" },
      max: 120,
    },
    {
      who: "you",
      name: "Final",
      say: "Final: lined up on the centreline, the 3° path to the numbers, on speed — the flare from 14 m.",
      auto: [],
      demoName: "Final and landing",
      demoSay: "Final: the centreline, the 3° path to the numbers, on speed. The flare from 14 m, the throttle idle — down, the brakes.",
      done: { event: "landed" },
      max: 150,
    },
  ],
  end: "Down — that was a whole circuit. The debrief is on screen.",
};

const LANDING: Course = {
  id: "landing",
  kind: "ils",
  steps: [
    {
      who: "tars",
      name: "Short final",
      say: "I have control: 6 km out on the path, the gear down, on speed. Watch the aim point stay still in the windscreen.",
      act: ["ils-auto"],
      done: { event: "x>-3500" },
      max: 90,
    },
    {
      who: "you",
      name: "Your controls: the landing",
      say: "Your controls. Hold the aim point and the speed; from 14 m the flare — the throttle idle, the descent eased.",
      act: ["ils-manual"],
      auto: ["ils-auto"],
      demoName: "The landing",
      demoSay:
        "The aim point still in the windscreen, on speed. From 14 m the flare: the throttle idle, the descent eased — touchdown, the brakes.",
      done: { event: "landed" },
      max: 120,
    },
  ],
  end: "On the runway. The debrief is on screen.",
};

const ILS_GUIDED: Course = {
  id: "ils",
  kind: "ils",
  steps: [
    {
      who: "tars",
      name: "Intercept and glideslope",
      say: "I have control: the localizer intercepted, the glideslope captured from below. Watch the needles centre.",
      act: ["ils-auto"],
      done: { event: "x>-7000" },
      max: 150,
    },
    {
      who: "you",
      name: "Your controls: the final",
      say: "Your controls. Keep the needles centred — small corrections, taken out early — and the speed; the flare at 14 m.",
      act: ["ils-manual"],
      auto: ["ils-auto"],
      demoName: "The final and the landing",
      demoSay: "The needles centred, small corrections; the gear down, on speed — minimums, the flare at 14 m, touchdown.",
      done: { event: "landed" },
      max: 180,
    },
  ],
  end: "Down on the ILS. The debrief is on screen.",
};

const CASE1: Course = {
  id: "case1",
  kind: "carrier",
  steps: [
    {
      who: "tars",
      name: "The break and the downwind",
      say: "I have control: up the starboard side, the break past the bow, the downwind, the 180. Watch the ship.",
      done: { event: "trap-final" },
      max: 300,
    },
    {
      who: "you",
      name: "Your controls: the groove",
      say: "Your controls. Call the ball: the meatball on the datum lights, the line-up, on speed — to the wire.",
      act: ["trap-manual"],
      auto: [],
      demoName: "The groove",
      demoSay: "The groove: the meatball on the datum lights, lined up, on speed — full power at the touchdown, to the wire.",
      done: { event: "trap-end" },
      max: 120,
    },
  ],
  end: "On the deck. The debrief is on screen.",
};

const FORMATION: Course = {
  id: "formation",
  kind: "formation",
  steps: [
    {
      who: "tars",
      name: "The rejoin",
      say: "I have control: the rejoin on LEAD, to the echelon right — 40 m behind it, 40 m to its right, level.",
      act: ["icpt-slot"],
      done: { event: "slot", hold: 4 },
      max: 180,
    },
    {
      who: "you",
      name: "Your controls: hold the slot",
      say: "Your controls. Hold the slot: its wingtip on your canopy, small corrections — the power for the distance.",
      act: ["free"],
      auto: [],
      demoName: "Holding the slot",
      demoSay: "In the slot: its wingtip on the canopy, small corrections — the power for the distance. A minute like this.",
      done: { time: 60 },
    },
  ],
  end: "Good formation flying. The debrief is on screen.",
};

const INTERCEPT: Course = {
  id: "intercept",
  kind: "intercept",
  steps: [
    {
      who: "tars",
      name: "Radar contact",
      say: "I have control. Radar contact: UNKNOWN, ahead. I lock it and fly the collision course — its bearing steady.",
      act: ["icpt"],
      done: { event: "range<25km" },
      max: 150,
    },
    {
      who: "you",
      name: "Your controls: the intercept",
      say: "Your controls. Keep the collision course, then lag behind it and roll out 1.5 km on its tail, at its height.",
      act: ["free"],
      auto: ["icpt"],
      demoName: "The conversion",
      demoSay: "The collision course held, then the turn behind it — lag — to roll out on its tail, at its height.",
      done: { event: "behind", hold: 3 },
      max: 300,
    },
  ],
  end: "On its tail: intercepted. The debrief is on screen.",
};

const GUNS: Course = {
  id: "guns",
  kind: "guns",
  steps: [
    {
      who: "tars",
      name: "Into its six",
      say: "I have control: into the drone's six, 300 m behind — the gun's range.",
      act: ["icpt"],
      done: { event: "six", hold: 3 },
      max: 150,
    },
    {
      who: "you",
      name: "Your controls: guns",
      say: "Your controls. The pipper on it — lead its turn, short bursts (Space) between 300 and 600 m.",
      act: ["free"],
      auto: ["icpt", "guns-auto"],
      demoName: "Guns",
      demoSay: "The pipper on it, its turn led — short bursts between 300 and 600 m.",
      done: { event: "kill" },
      max: 90,
    },
  ],
  end: "Splash. The debrief is on screen.",
};

const figureCourse = (id: FigureId): Course => ({
  id,
  kind: "figure",
  steps: [
    {
      who: "tars",
      name: "The demonstration",
      say: "I have control: the figure flown once — watch the load and the cues.",
      done: { event: "figure-done" },
      // (the Cuban eight's two loops at 3.5 g from 240 m/s: some 130 s)
      max: 200,
    },
    {
      who: "you",
      name: "Your turn",
      say: "Your turn: the same figure from its entry, the cues on the HUD.",
      act: ["figure-judge"],
      done: { event: "figure-done" },
      max: 150,
    },
  ],
  end: "Your figure is judged. The debrief is on screen.",
});

const COURSES: Partial<Record<CourseId, Course>> = {
  first: FIRST,
  circuit: CIRCUIT,
  landing: LANDING,
  formation: FORMATION,
  intercept: INTERCEPT,
  guns: GUNS,
  ils: ILS_GUIDED,
  case1: CASE1,
};

/** A lesson's guided course. */
export const courseOf = (id: CourseId): Course => COURSES[id] ?? figureCourse(id as FigureId);

/** The figures and the events of a frame, as the controller sees them: the height [m], the heading [°], the speed
 *  [m/s], the bank [°, + right] now; the events now true. */
export interface CourseFix {
  alt: number;
  hdg: number;
  spd: number;
  bank: number;
  events: Set<string>;
}

/** A course flown: its steps (all, or the TARS's only — a demonstration —, or the pilot's only — a try), the step
 *  and its time, how long its condition has held, where it began (height, heading). */
export interface CourseRun {
  course: Course;
  steps: CourseStep[];
  i: number;
  t: number;
  st: number;
  held: number;
  alt0: number;
  hdg0: number;
  done: boolean;
  /** the steps left at their time at most, their condition never met (their names) */
  late: string[];
}

export function newCourse(id: CourseId, mode: "guided" | "demo" | "try", alt0: number, hdg0: number): CourseRun {
  const C = courseOf(id);
  const first = C.steps.findIndex((s) => s.who === "you");
  // (a demonstration: TARS flies the whole lesson — the pilot's steps too, as he would fly them —, those he cannot
  // left out)
  const demo = C.steps
    .filter((s) => s.who === "tars" || s.auto)
    .map((s) => (s.who === "tars" ? s : { ...s, who: "tars" as const, act: s.auto, say: s.demoSay ?? s.say, name: s.demoName ?? s.name }));
  const steps = mode === "demo" ? demo : mode === "try" ? C.steps.slice(first) : C.steps;
  // (a try: the pilot's first step does what TARS's handover would)
  if (mode === "try" && steps[0] && !steps[0].act) steps[0] = { ...steps[0], act: ["free"] };
  return { course: C, steps, i: 0, t: 0, st: 0, held: 0, alt0, hdg0, done: steps.length === 0, late: [] };
}

const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** A step's targets absolute: the height [m], the heading [°], the speed [m/s], the bank [°]. */
export function targetsOf(R: CourseRun, s: CourseStep) {
  const T = s.target;
  if (!T) return null;
  return {
    alt: T.dAlt !== undefined ? R.alt0 + T.dAlt : undefined,
    hdg: T.dHdg !== undefined ? (((R.hdg0 + T.dHdg) % 360) + 360) % 360 : undefined,
    spd: T.spd,
    bank: T.bank,
  };
}

/** The deviations from the step's targets now (NaN: none asked): the height, the heading, the speed; the bank's
 *  while the turn is still to be made (the heading's then not counted). */
export function deviations(R: CourseRun, f: CourseFix): { alt: number; hdg: number; spd: number; bank: number } {
  const s = R.steps[R.i];
  const T = s ? targetsOf(R, s) : null;
  const dh = T?.hdg !== undefined ? wrap180(f.hdg - T.hdg) : Number.NaN;
  const turning = T?.bank !== undefined && Math.abs(dh) > 15;
  return {
    alt: T?.alt !== undefined ? f.alt - T.alt : Number.NaN,
    hdg: turning ? Number.NaN : dh,
    spd: T?.spd !== undefined ? f.spd - T.spd : Number.NaN,
    bank: turning ? f.bank - T!.bank! : Number.NaN,
  };
}

/** Whether the step's targets are met now (each within its tolerance). */
function met(R: CourseRun, f: CourseFix): boolean {
  const d = deviations(R, f);
  const s = R.steps[R.i];
  const T = s && targetsOf(R, s);
  if (!T) return false;
  if (T.alt !== undefined && !(Math.abs(d.alt) <= COURSE.alt)) return false;
  if (T.hdg !== undefined && !(Math.abs(wrap180(f.hdg - T.hdg)) <= COURSE.hdg)) return false;
  if (T.spd !== undefined && !(Math.abs(d.spd) <= COURSE.spd)) return false;
  return true;
}

/**
 * A frame of the course: its step's condition (held, its time, its event — held a while if asked), its time at most;
 * the step changed: the new one (to be begun by the controller: said, its acts done), or the course's end.
 */
export function courseStep(R: CourseRun, f: CourseFix, dt: number): { begin?: CourseStep; end?: boolean } {
  if (R.done) return {};
  R.t += dt;
  R.st += dt;
  const s = R.steps[R.i]!;
  const d = s.done;
  let ok = false;
  if ("held" in d) {
    R.held = met(R, f) ? R.held + dt : 0;
    ok = R.held >= d.held;
  } else if ("time" in d) ok = R.st >= d.time;
  else {
    R.held = f.events.has(d.event) ? R.held + dt : 0;
    ok = R.held >= (d.hold ?? 0) && f.events.has(d.event);
  }
  if (!ok && s.max !== undefined && R.st >= s.max) {
    ok = true;
    R.late.push(s.name);
  }
  if (!ok) return {};
  R.i++;
  R.st = 0;
  R.held = 0;
  if (R.i >= R.steps.length) {
    R.done = true;
    return { end: true };
  }
  return { begin: R.steps[R.i]! };
}
