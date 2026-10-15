// The flight school's lessons (docs/PLAN-AVIATION-AAA.md, A4): a card for each manoeuvre — what it is, its steps
// with their numbers, the errors it is lost to —, and its ideal path in its own plane (the ILS's height against the
// distance to the threshold; the carrier's pattern seen from above in the ship's frame; a figure in its vertical
// plane, along its entry's heading and up) to draw it, our own trace over it as it is flown, the step we are at
// marked. Pure. Its words English, translated by t().

import { FIGURE_ORDER, FIGURES, type FigureId } from "./aerobatics";
import { ILS } from "./ils";

export type LessonId = "ils" | "case1" | FigureId;

export interface LessonStep {
  name: string;
  detail: string;
  /** where along the ideal path it begins [its point's index] */
  at: number;
}

export interface Lesson {
  id: LessonId;
  /** the instructor's channels and the run that flies it */
  kind: "ils" | "carrier" | "figure";
  title: string;
  summary: string;
  /** the plane it is drawn in: its axes' names and units */
  axes: { x: string; y: string };
  /** the ideal path in that plane [m] */
  path: [number, number][];
  steps: LessonStep[];
  errors: string[];
}

const D = Math.PI / 180;

/** The ILS's profile: level at the initial fix's height, the glideslope from its intercept, the flare. */
function ilsPath(): [number, number][] {
  const hI = Math.max((ILS.gpi + ILS.iaf) * Math.tan(ILS.glide * D), 600);
  const xI = ILS.gpi - hI / Math.tan(ILS.glide * D);
  const pts: [number, number][] = [[-ILS.iaf - 6000, hI]];
  for (let x = Math.max(xI, -ILS.iaf); x <= ILS.gpi + 400; x += 250) pts.push([x, Math.max((ILS.gpi - x) * Math.tan(ILS.glide * D), 0)]);
  return pts;
}

/** Case I's pattern from above, in the ship's frame (along its course, to port) [m]: the initial astern, up its
 *  starboard side, the break past the bow, the downwind abeam to port, the 180, the groove onto the angled deck. */
function case1Path(): [number, number][] {
  const pts: [number, number][] = [];
  for (let s = -5500; s <= 900; s += 400) pts.push([s, -150]);
  // (the break: a half circle to port)
  const r = 1175;
  for (let a = 0; a <= 180; a += 15) pts.push([900 + r * Math.sin(a * D), -150 + r * (1 - Math.cos(a * D))]);
  for (let s = 900; s >= -1300; s -= 400) pts.push([s, 2200]);
  // (the 180: round onto the axis, rolled out some 1 500 m astern)
  const r2 = 1100;
  for (let a = 0; a <= 170; a += 17) pts.push([-1300 - r2 * Math.sin(a * D), 2200 - r2 * (1 - Math.cos(a * D))]);
  for (let s = -1500; s <= 0; s += 300) pts.push([s, 0]);
  return pts;
}

/** A figure's shape in its vertical plane (along, up) [m] from its entry at speed `v`, pulled at its load. */
function figurePath(id: FigureId, v: number): [number, number][] {
  const R = (v * v) / (9.80665 * 3.5);
  const pts: [number, number][] = [];
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 10));
    for (let i = 0; i <= n; i++) {
      const a = (a0 + ((a1 - a0) * i) / n) * D;
      pts.push([cx + r * Math.sin(a), cy - r * Math.cos(a)]);
    }
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 0; i <= 6; i++) pts.push([x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6]);
  };
  // (the circle's points: its centre, radius, from angle a0 to a1 [°] — 0 at its bottom, 90 ahead, 180 at its top)
  switch (id) {
    case "loop":
      line(-R, 0, 0, 0);
      arc(0, R, R, 0, 360);
      line(0, 0, R, 0);
      break;
    case "immelmann":
      // (a half loop up, then rolled upright at the top: back the way it came, higher)
      line(-R, 0, 0, 0);
      arc(0, R, R, 0, 180);
      line(0, 2 * R, -R, 2 * R);
      break;
    case "splitS":
      // (rolled inverted, then a half loop down: back the way it came, lower)
      line(-R, 2 * R, 0, 2 * R);
      arc(0, R, R, 180, 0);
      line(0, 0, -R, 0);
      break;
    case "cuban8": {
      // (two five-eighths loops joined by their 45° descents: an 8 on its side)
      for (let i = 0; i <= 72; i++) {
        const t = (i / 72) * 2 * Math.PI;
        pts.push([1.6 * R * Math.sin(t), R + R * Math.sin(t) * Math.cos(t) * 1.6 + R * 0.4 * (1 - Math.cos(t))]);
      }
      break;
    }
    case "barrelRoll":
      for (let i = 0; i <= 36; i++) pts.push([(i / 36) * 4 * R, R * (1 - Math.cos((i / 36) * 2 * Math.PI)) * 0.6]);
      break;
    case "spin":
      line(-R, 0, 0, 0);
      for (let i = 0; i <= 40; i++) pts.push([Math.sin(i * 0.9) * 120, -(i / 40) * 2500]);
      break;
    default:
      // (a roll, inverted flight, high incidence, a reversal: straight and level along the entry)
      line(-R, 0, 3 * R, 0);
  }
  return pts;
}

/** A figure's steps: its cues along its shape (spread over it). */
function figureSteps(id: FigureId, n: number): LessonStep[] {
  const F = FIGURES[id];
  return F.cues.map((c, i) => ({
    name: c.replace("{v}", `${F.entry.v} m/s`),
    detail: "",
    at: Math.round((i / Math.max(F.cues.length, 1)) * (n - 1)),
  }));
}

/** The ILS profile's point nearest a distance to the threshold [m] (its index). */
function ilsIdx(x: number): number {
  const P = ilsPath();
  let best = 0;
  P.forEach((p, i) => {
    if (Math.abs(p[0] - x) < Math.abs(P[best]![0] - x)) best = i;
  });
  return best;
}
const ILS_MIN_X = ILS.gpi - ILS.dh / Math.tan(ILS.glide * D);
const ILS_FLARE_X = ILS.gpi - ILS.flare / Math.tan(ILS.glide * D);

export const LESSONS: Lesson[] = [
  {
    id: "ils",
    kind: "ils",
    title: "ILS approach",
    summary:
      "To a runway in any weather: the localizer's centreline and the 3° glideslope down to the minimums, the flare, the touchdown in the zone.",
    axes: { x: "To the threshold", y: "Height" },
    path: ilsPath(),
    steps: [
      { name: "Initial fix", detail: "18.5 km out on the axis, at the glideslope's height or above — a hold there if asked.", at: 0 },
      {
        name: "Localizer",
        detail: "Intercepted at 30–45°, led as the needle moves: wings level as it centres.",
        at: ilsIdx(-ILS.iaf + 1500),
      },
      {
        name: "Glideslope",
        detail: "Met from below: the descent begun as the diamond centres — some 4 m/s down at 85 m/s.",
        at: ilsIdx(-ILS.iaf + 3000),
      },
      { name: "Final fix", detail: "9.3 km: gear and flaps, on speed, stable — the needles within a dot.", at: ilsIdx(-ILS.faf) },
      { name: "Minimums", detail: "60 m: stable — continue; else the missed approach, climbing straight ahead.", at: ilsIdx(ILS_MIN_X) },
      {
        name: "Flare",
        detail: "From 14 m: the descent eased to under 1 m/s, the throttle idle, onto the zone 150–900 m in.",
        at: ilsIdx(ILS_FLARE_X),
      },
    ],
    errors: [
      "Chasing the needles: big corrections that cross the centreline — small ones, taken out early.",
      "Diving at the glideslope from above: it is met from below, else not stable at minimums.",
      "Slow on the final: the jet sinks and its incidence climbs — power first.",
    ],
  },
  {
    id: "case1",
    kind: "carrier",
    title: "Carrier: Case I and the ball",
    summary:
      "The day's recovery: the initial astern, the break past the bow, the downwind, the 180, the groove — the ball flown to a wire.",
    axes: { x: "Along the ship's course", y: "To port" },
    path: case1Path(),
    steps: [
      { name: "Initial", detail: "3 NM astern on the ship's course, 800 ft, 350 kt, up its starboard side.", at: 0 },
      { name: "The break", detail: "Past the bow: a hard level turn to port, 60° of bank, slowing.", at: 17 },
      { name: "Downwind", detail: "600 ft, 1.2 NM abeam to port, gear, flaps, hook — on speed.", at: 30 },
      { name: "The 180", detail: "Past abeam the LSO: a descending turn onto the angled deck, rolled out in the groove.", at: 37 },
      {
        name: "The groove",
        detail: "Call the ball at ¾ NM: the meatball on the datum lights, line-up, angle of attack — to the 2-wire.",
        at: 48,
      },
    ],
    errors: [
      "Rolling out of the 180 wide: no groove left to line up — the bank set by the distance abeam.",
      "Settling low in close: power at once — low at the ramp is the cut pass.",
      "Overcorrecting the line-up in the groove: small corrections, the wings level by the ramp.",
    ],
  },
  ...FIGURE_ORDER.map((id): Lesson => {
    const F = FIGURES[id];
    const path = figurePath(id, F.entry.v);
    return {
      id,
      kind: "figure",
      title: F.name,
      summary: F.brief,
      axes: { x: "Along the entry", y: "Up" },
      path,
      steps: figureSteps(id, path.length),
      errors: [
        "Entering slow: below the entry speed, the figure runs out of energy at its top.",
        "Pulling unevenly: the load the figure asks, held — a round figure is a steady pull.",
        "Wings not level at the entry: the figure leaves its plane and drifts.",
      ],
    };
  }),
];

/** The step reached at a point of the plane (the ideal path's nearest point's). */
export function stepAt(L: Lesson, p: readonly [number, number]): number {
  let best = 0,
    bd = Infinity;
  L.path.forEach((q, i) => {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) (bd = d), (best = i);
  });
  let s = 0;
  L.steps.forEach((st, i) => {
    if (best >= st.at) s = i;
  });
  return s;
}
