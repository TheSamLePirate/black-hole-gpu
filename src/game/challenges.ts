// The F-35's challenges (docs/PLAN-F35.md, F9): low-level gate courses through real valleys (the Welsh "Mach
// Loop", Death Valley's Rainbow Canyon) and a time trial over the dry lake of Edwards, a graded landing on a
// runway, a graded vertical landing on a pad, an aerobatic sequence. Pure: the courses, the judging — a gate
// passed or missed (its plane crossed inside its frame or not), the time and its penalties (each gate missed,
// each second over the course's ceiling), the landing's touchdown marked (its sink, where, how far off the
// centreline, its speed against the reference), the manoeuvres recognised and marked (a roll's heading and
// height held, a loop's roundness) —, the medals. The controller (controller/challenge.ts) feeds it.

import type { Text } from "../i18n";

const D = Math.PI / 180;
const R_EARTH = 6_371_008.8;

/** A gate: where (latitude, longitude [°]), its centre's height over the ground [m], the heading it is flown
 *  through [° true], its width and height [m]. */
export interface Gate {
  lat: number;
  lon: number;
  agl: number;
  hdg: number;
  w: number;
  h: number;
}

export type ChallengeKind = "gates" | "landing" | "vertical" | "aero";

export interface ChallengeDef {
  id: string;
  title: Text;
  brief: Text;
  kind: ChallengeKind;
  /** where it starts: in the air (latitude, longitude, height over the ground, heading, speed) or at a field */
  start: { lat: number; lon: number; agl: number; hdg: number; speed: number } | { field: string; final: number };
  gates?: Gate[];
  /** a low-level course's ceiling over the ground [m]: each second above it a second's penalty */
  ceiling?: number;
  /** the time a gold medal asks [s] (a course), or the marks [0 … 100] (a landing, the aerobatics) */
  par: number;
  /** the vertical landing's pad (latitude, longitude) */
  pad?: { lat: number; lon: number };
  /** the aerobatic sequence */
  figures?: ("roll" | "loop")[];
}

/** The Mach Loop (LFA 7, Wales): the valleys round Cadair Idris — Dolgellau, Cross Foxes, Bwlch Llyn Bach
 *  ("Cad West"), Corris, Machynlleth, Cemmaes Road, Dinas Mawddwy, Bwlch Oerddrws — flown anticlockwise. */
const MACH_LOOP: Gate[] = [
  { lat: 52.7335, lon: -3.8395, agl: 120, hdg: 205, w: 260, h: 160 },
  { lat: 52.7005, lon: -3.8605, agl: 110, hdg: 200, w: 240, h: 150 },
  { lat: 52.6725, lon: -3.864, agl: 110, hdg: 150, w: 260, h: 150 },
  { lat: 52.6515, lon: -3.8425, agl: 110, hdg: 175, w: 260, h: 150 },
  { lat: 52.607, lon: -3.846, agl: 120, hdg: 175, w: 300, h: 170 },
  { lat: 52.6205, lon: -3.76, agl: 120, hdg: 70, w: 300, h: 170 },
  { lat: 52.647, lon: -3.708, agl: 120, hdg: 40, w: 300, h: 170 },
  { lat: 52.703, lon: -3.682, agl: 110, hdg: 0, w: 280, h: 160 },
  { lat: 52.724, lon: -3.693, agl: 110, hdg: 330, w: 260, h: 160 },
  { lat: 52.736, lon: -3.745, agl: 120, hdg: 285, w: 260, h: 160 },
  { lat: 52.736, lon: -3.8, agl: 120, hdg: 265, w: 280, h: 160 },
];

/** Rainbow Canyon (Death Valley, the "Jedi Transition"): from the Panamint Springs side's mouth, up the canyon past
 *  Father Crowley Point, east. */
const RAINBOW: Gate[] = [
  { lat: 36.3395, lon: -117.588, agl: 90, hdg: 75, w: 220, h: 120 },
  { lat: 36.344, lon: -117.57, agl: 80, hdg: 60, w: 200, h: 110 },
  { lat: 36.353, lon: -117.554, agl: 80, hdg: 55, w: 200, h: 110 },
  { lat: 36.36, lon: -117.538, agl: 80, hdg: 80, w: 200, h: 110 },
  { lat: 36.362, lon: -117.517, agl: 90, hdg: 95, w: 220, h: 120 },
];

/** Over Rogers Dry Lake at Edwards: a slalom low and fast, the lake's flat floor under it. */
const ROGERS: Gate[] = [
  { lat: 34.93, lon: -117.83, agl: 40, hdg: 20, w: 120, h: 60 },
  { lat: 34.958, lon: -117.818, agl: 40, hdg: 20, w: 120, h: 60 },
  { lat: 34.986, lon: -117.808, agl: 30, hdg: 10, w: 100, h: 50 },
  { lat: 35.012, lon: -117.812, agl: 30, hdg: 350, w: 100, h: 50 },
  { lat: 35.032, lon: -117.83, agl: 40, hdg: 300, w: 120, h: 60 },
  { lat: 35.03, lon: -117.862, agl: 40, hdg: 230, w: 120, h: 60 },
  { lat: 35.005, lon: -117.875, agl: 30, hdg: 200, w: 100, h: 50 },
  { lat: 34.975, lon: -117.88, agl: 25, hdg: 190, w: 90, h: 45 },
];

export const CHALLENGES: ChallengeDef[] = [
  {
    id: "machloop",
    title: { fr: "Le Mach Loop", en: "The Mach Loop" },
    brief: {
      fr: "Les vallées galloises autour du Cadair Idris, sous 250 m sol : onze portes, dans le sens antihoraire.",
      en: "The Welsh valleys round Cadair Idris, below 250 m: eleven gates, anticlockwise.",
    },
    kind: "gates",
    start: { lat: 52.752, lon: -3.816, agl: 150, hdg: 215, speed: 220 },
    gates: MACH_LOOP,
    ceiling: 250,
    par: 230,
  },
  {
    id: "rainbow",
    title: { fr: "Rainbow Canyon", en: "Rainbow Canyon" },
    brief: {
      fr: "La « Jedi Transition » de la vallée de la Mort : cinq portes au fond du canyon, sous 200 m.",
      en: 'Death Valley\'s "Jedi Transition": five gates down in the canyon, below 200 m.',
    },
    kind: "gates",
    start: { lat: 36.333, lon: -117.616, agl: 120, hdg: 75, speed: 200 },
    gates: RAINBOW,
    ceiling: 200,
    par: 52,
  },
  {
    id: "rogers",
    title: { fr: "Slalom de Rogers", en: "The Rogers slalom" },
    brief: {
      fr: "Contre la montre au ras du lac salé d'Edwards : huit portes de plus en plus basses.",
      en: "Against the clock just over Edwards' dry lake: eight gates, ever lower.",
    },
    kind: "gates",
    start: { lat: 34.9, lon: -117.845, agl: 80, hdg: 20, speed: 230 },
    gates: ROGERS,
    ceiling: 150,
    par: 72,
  },
  {
    id: "landing",
    title: { fr: "Atterrissage noté", en: "Graded landing" },
    brief: {
      fr: "Finale de 12 km à Edwards : toucher doux, au point visé (300 m), sur l'axe, à la vitesse de référence (140 kt).",
      en: "A 12 km final at Edwards: a soft touchdown, on the aim point (300 m), on the centreline, at the reference speed (140 kt).",
    },
    kind: "landing",
    start: { field: "Edwards", final: 12 },
    par: 85,
  },
  {
    id: "vertical",
    title: { fr: "Atterrissage vertical", en: "Vertical landing" },
    brief: {
      fr: "Mode STOVL (⇧B), stationnaire puis posé sur la plateforme près de la piste : précision, douceur, dérive nulle.",
      en: "STOVL mode (⇧B), a hover then down on the pad beside the runway: precision, softness, no drift.",
    },
    kind: "vertical",
    start: { lat: 34.88, lon: -117.905, agl: 300, hdg: 40, speed: 70 },
    pad: { lat: 34.9035, lon: -117.8805 },
    par: 85,
  },
  {
    id: "aero",
    title: { fr: "Voltige", en: "Aerobatics" },
    brief: {
      fr: "Un tonneau, une boucle, un tonneau : cap et altitude tenus dans les tonneaux, boucle ronde et dans son plan.",
      en: "A roll, a loop, a roll: the heading and height held through the rolls, the loop round and in its plane.",
    },
    kind: "aero",
    start: { lat: 34.95, lon: -117.7, agl: 3000, hdg: 90, speed: 240 },
    figures: ["roll", "loop", "roll"],
    par: 85,
  },
];

// ------------------------------------------------------------------------------------ geometry

type LL = { lat: number; lon: number };

/** East, north [m] of a point from another (a plane tangent there: a gate's few hundred metres). */
export function enu(from: LL, p: LL): [number, number] {
  return [(p.lon - from.lon) * D * R_EARTH * Math.cos(from.lat * D), (p.lat - from.lat) * D * R_EARTH];
}

/** A gate's frame, its centre's altitude [m] fixed at the start (over the ground then). */
export interface GateAbs extends Gate {
  alt: number;
}

/**
 * The gate's plane crossed between two positions (each a latitude, longitude, altitude [m]): null if not;
 * else where — across [m, > 0 right of its centre flying through], up [m from its centre] — and whether
 * inside its frame. Crossed forwards only (its heading's way).
 */
export function gateCrossing(
  g: GateAbs,
  a: LL & { alt: number },
  b: LL & { alt: number },
): { across: number; up: number; inside: boolean } | null {
  const [ea, na] = enu(g, a),
    [eb, nb] = enu(g, b);
  const h = g.hdg * D;
  const fx = Math.sin(h),
    fy = Math.cos(h);
  const sa = ea * fx + na * fy,
    sb = eb * fx + nb * fy;
  if (!(sa < 0 && sb >= 0)) return null;
  const k = sa / (sa - sb);
  const e = ea + (eb - ea) * k,
    n = na + (nb - na) * k;
  const across = e * Math.cos(h) - n * Math.sin(h);
  const up = a.alt + (b.alt - a.alt) * k - g.alt;
  // (a crossing kilometres off is not this gate's: the plane extended — ignored)
  if (Math.abs(across) > 3000) return null;
  return { across, up, inside: Math.abs(across) <= g.w / 2 && Math.abs(up) <= g.h / 2 };
}

/** Its distance [m] and bearing [rad] from a point. */
export function toward(p: LL, g: LL): { dist: number; brg: number } {
  const [e, n] = enu(p, g);
  return { dist: Math.hypot(e, n), brg: Math.atan2(e, n) };
}

// ------------------------------------------------------------------------------------ the judging

export type Medal = "gold" | "silver" | "bronze" | null;

/** A course's medal for a time [s] against its par (gold within it, silver 15 % over, bronze 35 %). */
export function courseMedal(time: number, par: number): Medal {
  return time <= par ? "gold" : time <= par * 1.15 ? "silver" : time <= par * 1.35 ? "bronze" : null;
}

/** Marks' medal (0 … 100) against the par (gold at it, silver 12 under, bronze 25 under). */
export function marksMedal(marks: number, par: number): Medal {
  return marks >= par ? "gold" : marks >= par - 12 ? "silver" : marks >= par - 25 ? "bronze" : null;
}

const lerpMark = (x: number, good: number, bad: number) => Math.max(0, Math.min(1, (bad - x) / (bad - good)));

/** A runway landing marked: the touchdown's sink [m/s], its distance past the threshold [m], off the
 *  centreline [m], its speed's difference from the reference [m/s]. Marks 0 … 100 and each criterion's. */
export function landingMarks(t: { sink: number; past: number; off: number; dv: number }): { marks: number; parts: Record<string, number> } {
  const parts = {
    // (a firm Navy-style arrival is not wanted here: under 1 m/s the best, 3 m/s and more nothing)
    sink: 30 * lerpMark(Math.max(t.sink, 1), 1, 3.2),
    // (the aim point 300 m past the threshold: within 60 m full marks, 500 m off none — short of the
    // threshold, none)
    aim: t.past < 0 ? 0 : 30 * lerpMark(Math.max(Math.abs(t.past - 300) - 60, 0), 0, 450),
    line: 20 * lerpMark(Math.max(Math.abs(t.off) - 3, 0), 0, 25),
    speed: 20 * lerpMark(Math.max(Math.abs(t.dv) - 2.5, 0), 0, 15),
  };
  return { marks: Math.round(parts.sink + parts.aim + parts.line + parts.speed), parts };
}

/** A vertical landing marked: the distance from the pad's centre [m], the sink [m/s], the drift over the
 *  ground at the touchdown [m/s]. */
export function verticalMarks(t: { dist: number; sink: number; drift: number }): { marks: number; parts: Record<string, number> } {
  const parts = {
    spot: 45 * lerpMark(Math.max(t.dist - 3, 0), 0, 30),
    sink: 30 * lerpMark(Math.max(t.sink, 0.8), 0.8, 3),
    drift: 25 * lerpMark(Math.max(t.drift, 0.3), 0.3, 4),
  };
  return { marks: Math.round(parts.spot + parts.sink + parts.drift), parts };
}

/** What the figures' judge reads each frame: the time [s], the bank, the heading, the flight path's angle
 *  [rad], the altitude [m], the position (for the loop's plane). */
export interface AeroSample {
  t: number;
  bank: number;
  heading: number;
  gamma: number;
  alt: number;
  lat: number;
  lon: number;
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The aerobatic judge: the figures flown in order, each recognised and marked out of 10 — a roll: the bank
 * turned through a whole turn within 8 s, its marks the heading and the height kept; a loop: the flight path
 * turned through a whole turn upwards, its marks the height regained at its exit and the drift out of its
 * plane. Stateful.
 */
export class AeroJudge {
  idx = 0;
  marks: number[] = [];
  private start: AeroSample | null = null;
  private acc = 0;
  private last: AeroSample | null = null;
  private devH = 0;
  private devA = 0;

  constructor(public figures: ("roll" | "loop")[]) {}

  get done() {
    return this.idx >= this.figures.length;
  }

  /** A frame: the figure just completed (its kind and marks), or null. */
  step(s: AeroSample): { figure: "roll" | "loop"; marks: number } | null {
    const f = this.figures[this.idx];
    if (!f) return null;
    const L = this.last;
    this.last = s;
    if (!L) return null;
    if (f === "roll") {
      const d = wrapPi(s.bank - L.bank);
      // (a figure begins with the stick: the bank turning faster than 40°/s; it lapses when it stalls)
      if (!this.start) {
        if (Math.abs(d) / Math.max(s.t - L.t, 1e-3) > 40 * D) {
          this.start = L;
          this.acc = 0;
          this.devH = this.devA = 0;
        } else return null;
      }
      this.acc += d;
      this.devH = Math.max(this.devH, Math.abs(wrapPi(s.heading - this.start.heading)));
      this.devA = Math.max(this.devA, Math.abs(s.alt - this.start.alt));
      if (Math.abs(this.acc) >= 2 * Math.PI - 0.05) {
        const m = 10 * (0.5 * lerpMark(this.devH / D, 3, 25) + 0.5 * lerpMark(this.devA, 20, 200));
        return this.complete("roll", m);
      }
      if (s.t - this.start.t > 8) this.start = null;
      return null;
    }
    // the loop: the flight path angle unwrapped through a whole turn
    if (!this.start) {
      if (s.gamma > 20 * D && L.gamma <= 20 * D) {
        this.start = L;
        this.acc = 0;
        this.devH = 0;
      } else return null;
    }
    // (the path's angle in the loop's plane: over the top it runs past 90° — the heading reversed —, the
    // pitch's sense read from the heading against the entry's)
    const rev = (h: number) => Math.abs(wrapPi(h - this.start!.heading)) > Math.PI / 2;
    const ang = (q: AeroSample) => (rev(q.heading) ? Math.PI - q.gamma : q.gamma);
    this.acc += wrapPi(ang(s) - ang(L));
    // (the drift out of the plane: across the entry's heading [m])
    const [e, n] = enu(this.start, s);
    const across = Math.abs(e * Math.cos(this.start.heading) - n * Math.sin(this.start.heading));
    this.devH = Math.max(this.devH, across);
    // (whole when back to level: the turn counted from the entry's 20°)
    if (this.acc + this.start.gamma >= 2 * Math.PI - 0.1) {
      const m = 10 * (0.5 * lerpMark(Math.abs(s.alt - this.start.alt), 30, 400) + 0.5 * lerpMark(this.devH, 60, 600));
      return this.complete("loop", m);
    }
    // (abandoned: back level under the entry without the turn done)
    if (this.acc < 0 || s.t - this.start.t > 60) this.start = null;
    return null;
  }

  private complete(f: "roll" | "loop", m: number) {
    this.marks.push(Math.round(m * 10) / 10);
    this.idx++;
    this.start = null;
    return { figure: f, marks: this.marks[this.marks.length - 1]! };
  }

  /** The sequence's marks out of 100. */
  total() {
    return this.figures.length ? Math.round((this.marks.reduce((a, b) => a + b, 0) / (10 * this.figures.length)) * 100) : 0;
  }
}

// ------------------------------------------------------------------------------------ the best scores

/** A result kept: the time [s] (a course) or the marks; when; the medal. */
export interface Best {
  score: number;
  at: string;
  medal: Medal;
}

/** Whether a score beats the best kept (a course: lower; marks: higher). */
export function better(kind: ChallengeKind, a: number, best: Best | undefined): boolean {
  if (!best) return true;
  return kind === "gates" ? a < best.score : a > best.score;
}
