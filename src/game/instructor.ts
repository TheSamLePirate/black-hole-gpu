// The instructor (docs/PLAN-AVIATION-AAA.md, A4): during an approach (the ILS, the carrier's pass) and an aerobatic
// figure, what is flown watched — each channel (the glideslope, the localizer, the speed, the incidence, the load…)
// against its target and its tolerance —; a deviation held past its limit called at the right moment (one at a time,
// the worst first, not the same again for five seconds), its fix said with it; the whole recorded for the debrief:
// each channel's time within its tolerance, its worst, each phase's mark, a score out of 20 and the tips for what was
// worst. Pure: the samples in, the calls and the debrief out. Its words English, translated by t() where shown.

export type LessonKind = "ils" | "carrier" | "figure";

/** A channel watched: its value is the deviation from its target (0: on it), its tolerance and its limit [its unit];
 *  the calls when past it the one way or the other, and their fixes. */
export interface Channel {
  key: string;
  label: string;
  unit: string;
  tol: number;
  warn: number;
  /** the call and the fix when the deviation is positive, negative */
  pos: [string, string];
  neg: [string, string];
  /** its weight in the score */
  weight: number;
}

export const CHANNELS: Record<LessonKind, Channel[]> = {
  ils: [
    {
      key: "gs",
      label: "Glideslope",
      unit: "dots",
      tol: 0.4,
      warn: 0.9,
      pos: ["Low — below the glideslope", "Ease the nose up and add a little power: the diamond comes back to the centre"],
      neg: ["High — above the glideslope", "Lower the nose a touch and reduce power: down to the path, then the descent rate back"],
      weight: 3,
    },
    {
      key: "loc",
      label: "Localizer",
      unit: "dots",
      tol: 0.4,
      warn: 0.9,
      pos: ["Left of the centreline", "Turn a few degrees right, and take it out as the needle comes in — no chasing it"],
      neg: ["Right of the centreline", "Turn a few degrees left, and take it out as the needle comes in — no chasing it"],
      weight: 3,
    },
    {
      key: "spd",
      label: "Speed",
      unit: "m/s",
      tol: 4,
      warn: 8,
      pos: ["Fast", "Reduce power — the speed bleeds without leaving the path"],
      neg: ["Slow — power!", "Power: slow, the jet sinks and its incidence climbs"],
      weight: 2,
    },
  ],
  carrier: [
    {
      key: "glide",
      label: "Glide path",
      unit: "°",
      tol: 0.25,
      warn: 0.6,
      pos: ["High on the ball", "A little less power: the ball settles to the datum lights"],
      neg: ["Low — power!", "Power now: low in close is the one that kills — the ball back up"],
      weight: 3,
    },
    {
      key: "lineup",
      label: "Line-up",
      unit: "m",
      tol: 2,
      warn: 6,
      pos: ["Left of the line-up", "Right for line-up: a small correction, then wings level"],
      neg: ["Right of the line-up", "Come left: a small correction, then wings level"],
      weight: 3,
    },
    {
      key: "spd",
      label: "Speed",
      unit: "m/s",
      tol: 3,
      warn: 6,
      pos: ["Fast", "Less power: on speed is on angle of attack"],
      neg: ["Slow — power!", "Power: slow on the ball sinks below the glide path"],
      weight: 2,
    },
  ],
  figure: [
    {
      key: "g",
      label: "Load",
      unit: "g",
      tol: 0.7,
      warn: 1.5,
      pos: ["Too much g — ease the pull", "Relax the stick: the figure is drawn by the load asked, not more"],
      neg: ["Pull harder", "More back stick: the load the figure asks, now — else the circle opens"],
      weight: 3,
    },
    {
      key: "spd",
      label: "Speed",
      unit: "m/s",
      tol: 30,
      warn: 70,
      pos: ["Fast", "Less power — fast, the figure grows and the load climbs"],
      neg: ["Slow — unload!", "Unload the pull and full power: slow at the top, the jet stops flying"],
      weight: 1,
    },
  ],
};

export interface InstrSample {
  t: number;
  /** where the manoeuvre is: the distance to the threshold or to the ramp [m], else its time [s] */
  x: number;
  phase: string;
  /** the channels' deviations; and the graph's own (the height, its ideal) */
  v: Record<string, number>;
}

export interface InstrRun {
  kind: LessonKind;
  /** the lesson's id: "ils", "carrier", a figure's */
  id: string;
  title: string;
  t: number;
  samples: InstrSample[];
  /** each channel's time past its limit [s] now; its last call's time, its calls so far */
  over: Record<string, number>;
  said: Record<string, number>;
  times: Record<string, number>;
  lastAt: number;
  last: { key: string; text: string; fix: string; at: number } | null;
}

export const newInstr = (kind: LessonKind, id: string, title: string): InstrRun => ({
  kind,
  id,
  title,
  t: 0,
  samples: [],
  over: {},
  said: {},
  times: {},
  lastAt: -1e9,
  last: null,
});

/** Its limits: a deviation held this long past its limit is called [s]; a channel not again within [s] — longer
 *  each time it is (a deviation kept, not nagged: 5, 10, 15 s… up to 20) —; nothing within [s] of another call; the
 *  samples kept this often [s]. */
export const INSTR = { hold: 1, again: 5, againMax: 20, gap: 2.2, every: 0.2 };

/**
 * A frame of the instructor: the channels' deviations now (`v`, by key; others ride along for the graphs), where it
 * is (`x`) and in which phase. A sample kept every 0.2 s; the call due, if any (the worst deviation held past its
 * limit, its words and its fix).
 */
export function instrStep(
  R: InstrRun,
  x: number,
  phase: string,
  v: Record<string, number>,
  dt: number,
): { key: string; text: string; fix: string } | null {
  R.t += dt;
  const lastS = R.samples[R.samples.length - 1];
  if (!lastS || R.t - lastS.t >= INSTR.every) R.samples.push({ t: R.t, x, phase, v: { ...v } });
  let worst: { c: Channel; k: number; dev: number } | null = null;
  for (const c of CHANNELS[R.kind]) {
    const dev = v[c.key];
    if (dev === undefined || !Number.isFinite(dev)) continue;
    const k = Math.abs(dev) / c.warn;
    R.over[c.key] = k > 1 ? (R.over[c.key] ?? 0) + dt : 0;
    const again = Math.min(INSTR.again * (1 + (R.times[c.key] ?? 0)), INSTR.againMax);
    // (back within its limit: its count started again)
    if (k <= 1 && R.over[c.key] === 0 && R.t - (R.said[c.key] ?? -1e9) > INSTR.againMax) R.times[c.key] = 0;
    if (
      R.over[c.key]! >= INSTR.hold &&
      R.t - (R.said[c.key] ?? -1e9) >= (R.times[c.key] ? again : 0) &&
      (!worst || k * c.weight > worst.k * worst.c.weight)
    )
      worst = { c, k, dev };
  }
  if (!worst || R.t - R.lastAt < INSTR.gap) return null;
  const [text, fix] = worst.dev > 0 ? worst.c.pos : worst.c.neg;
  R.said[worst.c.key] = R.t;
  R.times[worst.c.key] = (R.times[worst.c.key] ?? 0) + 1;
  R.lastAt = R.t;
  R.last = { key: worst.c.key, text, fix, at: R.t };
  return { key: worst.c.key, text, fix };
}

/** A channel's measure over the samples: its share within the tolerance, its root mean square and its worst. */
function measure(S: InstrSample[], c: Channel) {
  const xs = S.map((s) => s.v[c.key]).filter((d): d is number => d !== undefined && Number.isFinite(d));
  if (!xs.length) return null;
  const inTol = xs.filter((d) => Math.abs(d) <= c.tol).length / xs.length;
  const rms = Math.sqrt(xs.reduce((a, d) => a + d * d, 0) / xs.length);
  const worst = xs.reduce((a, d) => (Math.abs(d) > Math.abs(a) ? d : a), 0);
  // (its mark: all within the tolerance 1, its limit's edge 0.5, twice it 0)
  const mark = xs.reduce((a, d) => a + Math.max(0, Math.min(1, 1 - (Math.abs(d) - c.tol) / (2 * c.warn - c.tol))), 0) / xs.length;
  return { inTol, rms, worst, mark };
}

export interface InstrDebrief {
  score: number;
  channels: { key: string; label: string; unit: string; inTol: number; rms: number; worst: number; mark: number }[];
  phases: { phase: string; mark: number; secs: number }[];
  /** what to work on, the worst first: its words and its fix */
  tips: { text: string; fix: string }[];
}

/** The debrief: each channel's measure, each phase's mark (its channels' weighted), the score out of 20, the tips
 *  for the two worst channels (the way they went the most). */
export function instrDebrief(R: InstrRun): InstrDebrief {
  const C = CHANNELS[R.kind];
  const S = R.samples;
  const channels = C.flatMap((c) => {
    const m = measure(S, c);
    return m ? [{ key: c.key, label: c.label, unit: c.unit, ...m }] : [];
  });
  const wsum = channels.reduce((a, ch) => a + C.find((c) => c.key === ch.key)!.weight, 0) || 1;
  const score = Math.round(((20 * channels.reduce((a, ch) => a + ch.mark * C.find((c) => c.key === ch.key)!.weight, 0)) / wsum) * 10) / 10;
  const order: string[] = [];
  for (const s of S) if (order[order.length - 1] !== s.phase) order.push(s.phase);
  const phases = [...new Set(order)].map((phase) => {
    const P = S.filter((s) => s.phase === phase);
    const ms = C.map((c) => ({ c, m: measure(P, c) })).filter((x) => x.m);
    const w = ms.reduce((a, x) => a + x.c.weight, 0) || 1;
    return { phase, mark: ms.reduce((a, x) => a + x.m!.mark * x.c.weight, 0) / w, secs: P.length * INSTR.every };
  });
  const tips = [...channels]
    .filter((ch) => ch.mark < 0.95)
    .sort((a, b) => a.mark - b.mark)
    .slice(0, 2)
    .map((ch) => {
      const c = C.find((x) => x.key === ch.key)!;
      const [text, fix] = ch.worst > 0 ? c.pos : c.neg;
      return { text, fix };
    });
  return { score, channels, phases, tips };
}
