// The A320's sound evaluated (docs/PLAN-A320.md, A12): FlightGear's sound files as SimGear plays them, on the
// systems' bag each frame (sounddata.json — scripts/build-a320-sounds.py): first their property rules (Systems/
// sound-common.xml, cfm56-sound.xml: gain filters, a noise-spike, logic — the volumes and pitches of each engine
// recording by N1 and N2, view by view), then each sound (SimGear's SGXmlSound::update: its condition — or its
// property non-zero, changing for "in-transit" —, its timers dt_play and dt_stop, its delay, its volume terms
// multiplied and their offsets added, its pitch's likewise; "once" played on its condition's rising edge, stopped when
// it falls), its cone (OpenAL's: the gain by the angle off its axis to the ear). Out: the voices heard (types.ts).
// Pure.

import type { Props } from "../rig";
import { SOUND_URL } from "./assets";
import data from "./sounddata.json";
import type { CraftVoice } from "./types";

type V3 = [number, number, number];
/** SimGear's expressions as the build script writes them: ["prop", p], ["val", x], ["table", input, rows], ["product",
 *  …], ["sum", …], ["difference", …], ["quotient", a, b], ["min"|"max", …], ["pow", a, b], ["abs"|"sqrt"|…, a] */
type Expr = [string, ...unknown[]];
/** a condition: rig.ts's, with expressions as operands */
type Cond = [string, ...unknown[]] | null;

interface Term {
  src?: Expr;
  fn?: string;
  factor: number;
  offset: number;
  sub?: boolean;
  min?: number;
  max?: number;
}
interface SoundDef {
  group: string;
  name: string;
  mode: "looped" | "once" | "in-transit";
  file: string;
  cond?: Cond;
  prop?: string;
  volume: Term[];
  pitch: Term[];
  avionics?: boolean;
  delay?: number;
  pos?: V3;
  cone?: { dir: V3; inner: number; outer: number; outerGain: number };
  refDist?: number;
  maxDist?: number;
  where: CraftVoice["where"];
}
interface RuleInput {
  cond: Cond;
  src: Expr;
  scale?: number;
  offset?: number;
  min?: number;
  max?: number;
}
type Rule =
  | { t: "gain"; in: RuleInput[]; out: string[]; gain?: Expr }
  | { t: "noise-spike"; in: RuleInput[]; out: string[]; rate: number }
  | { t: "logic"; cond: Cond; out: string[] };

const DATA = data as unknown as { init: Props; rules: Rule[]; sounds: SoundDef[] };
export const SOUNDS: readonly SoundDef[] = DATA.sounds;

/** (SimGear's sample defaults: the reference and maximum distances [m]; its transit's grace [s]) */
const REF_DIST = 500;
const MAX_DIST = 3000;
const MAX_TRANSIT = 0.1;
/** the model's origin in the ship's frame (a sound without a place but heard outside: there) */
const ORIGIN: V3 = [0, 2.648, 0];

const n = (v: number | string | undefined): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const truthy = (v: number | string | undefined | boolean) =>
  typeof v === "boolean" ? v : typeof v === "string" ? v !== "" && v !== "0" && v !== "false" : !!v;

/** an expression's value on the bag */
export function evaluate(e: Expr, P: Props): number {
  const a = e.slice(1) as Expr[];
  switch (e[0]) {
    case "prop":
      return n(P[e[1] as string]);
    case "val":
      return e[1] as number;
    case "table": {
      const x = evaluate(e[1] as Expr, P);
      const rows = e[2] as [number, number][];
      if (x <= rows[0]![0]) return rows[0]![1];
      for (let k = 1; k < rows.length; k++) {
        const [x1, y1] = rows[k]!;
        if (x <= x1) {
          const [x0, y0] = rows[k - 1]!;
          return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
        }
      }
      return rows[rows.length - 1]![1];
    }
    case "product":
      return a.reduce((s, k) => s * evaluate(k, P), 1);
    case "sum":
      return a.reduce((s, k) => s + evaluate(k, P), 0);
    case "difference":
      return a.slice(1).reduce((s, k) => s - evaluate(k, P), evaluate(a[0]!, P));
    case "quotient": {
      const d = evaluate(a[1]!, P);
      return d === 0 ? 0 : evaluate(a[0]!, P) / d;
    }
    case "min":
      return Math.min(...a.map((k) => evaluate(k, P)));
    case "max":
      return Math.max(...a.map((k) => evaluate(k, P)));
    case "pow":
      return evaluate(a[0]!, P) ** evaluate(a[1]!, P);
    case "abs":
      return Math.abs(evaluate(a[0]!, P));
    case "sqrt":
      return Math.sqrt(Math.max(evaluate(a[0]!, P), 0));
    case "sqr":
      return evaluate(a[0]!, P) ** 2;
    case "neg":
      return -evaluate(a[0]!, P);
    case "ln":
      return Math.log(evaluate(a[0]!, P));
    case "log10":
      return Math.log10(evaluate(a[0]!, P));
    case "exp":
      return Math.exp(evaluate(a[0]!, P));
  }
  throw new Error(`a320 sound: expression ${e[0]}`);
}

/** a condition's value on the bag (SimGear's SGCondition: a property alone true when non-zero) */
export function test(c: Cond | undefined, P: Props): boolean {
  if (!c) return true;
  return truthy(operand(c, P));
}
function operand(c: Cond, P: Props): number | string | boolean {
  if (!c) return true;
  switch (c[0]) {
    case "prop":
      return P[c[1] as string] ?? 0;
    case "val":
      return c[1] as number | string;
    case "expr":
      return evaluate(c[1] as Expr, P);
    case "not":
      return !test(c[1] as Cond, P);
    case "and":
      return (c.slice(1) as Cond[]).every((k) => test(k, P));
    case "or":
      return (c.slice(1) as Cond[]).some((k) => test(k, P));
  }
  const ra = operand(c[1] as Cond, P),
    rb = operand(c[2] as Cond, P);
  if (typeof ra === "string" || typeof rb === "string")
    return c[0] === "equals" ? String(ra) === String(rb) : c[0] === "not-equals" ? String(ra) !== String(rb) : false;
  const x = Number(ra),
    y = Number(rb);
  switch (c[0]) {
    case "greater-than":
      return x > y;
    case "less-than":
      return x < y;
    case "greater-than-equals":
      return x >= y;
    case "less-than-equals":
      return x <= y;
    case "equals":
      return x === y;
    case "not-equals":
      return x !== y;
  }
  throw new Error(`a320 sound: condition ${c[0]}`);
}

/** SimGear's sound functions (xmlsound.cxx __sound_fn) */
const FN: Record<string, (v: number) => number> = {
  inv: (v) => (v === 0 ? 1e99 : 1 / v),
  abs: Math.abs,
  sqrt: (v) => Math.sqrt(Math.abs(v)),
  log: (v) => Math.log10(Math.abs(v) + 1e-9),
  ln: (v) => Math.log(Math.abs(v) + 1e-9),
  sqr: (v) => v * v,
  pow3: (v) => v * v * v,
};

/** A sound's state between frames (SGXmlSound's: active, its timers, the last value of its property). */
interface State {
  active: boolean;
  dtPlay: number;
  dtStop: number;
  stopping: number;
  prev: number;
  shot: number;
  last: CraftVoice | null;
  /** a once-sound already true at the flight's first frame: not played until its condition falls */
  muted: boolean;
}

/** Volume or pitch: each term's value — an expression, a property, a timer —, its function, × its factor, within
 *  its max and min (0 by default); multiplied (a "subtract" term: the offset less it), the offsets added (xmlsound.cxx update). */
function terms(ts: Term[], P: Props, s: State): number {
  let v = 1,
    off = 0;
  for (const t of ts) {
    let x = 1;
    const src = t.src;
    if (src?.[0] === "internal") x = src[1] === "dt_play" ? s.dtPlay : src[1] === "dt_stop" ? s.dtStop : 1;
    else if (src) x = evaluate(src, P);
    if (t.fn) x = FN[t.fn]!(x);
    x *= t.factor;
    // (SimGear's: a max of 0 none, a min of 0 by default — no term below 0)
    if (t.max && x > t.max) x = t.max;
    else if (x < (t.min ?? 0)) x = t.min ?? 0;
    if (t.sub) v = t.offset - x;
    else {
      off += t.offset;
      v *= x;
    }
  }
  return off + v;
}

/** OpenAL's cone: full within half its inner angle off its axis, its outer gain past half its outer, in between
 *  linear */
function cone(c: NonNullable<SoundDef["cone"]>, at: V3, ear: V3): number {
  const L: V3 = [ear[0] - at[0], ear[1] - at[1], ear[2] - at[2]];
  const l = Math.hypot(...L),
    d = Math.hypot(...c.dir);
  if (l < 1e-6 || d < 1e-9) return 1;
  const ang = (Math.acos(Math.max(-1, Math.min(1, (L[0] * c.dir[0] + L[1] * c.dir[1] + L[2] * c.dir[2]) / (l * d)))) * 180) / Math.PI;
  if (ang <= c.inner / 2) return 1;
  if (ang <= c.outer / 2) return 1 + ((c.outerGain - 1) * (ang - c.inner / 2)) / (c.outer / 2 - c.inner / 2);
  return c.outerGain;
}

export class A320Sound {
  private states: State[] = SOUNDS.map(() => ({
    active: false,
    dtPlay: 0,
    dtStop: 0,
    stopping: 0,
    prev: 0,
    shot: 0,
    last: null,
    muted: false,
  }));
  /** the first frame after a reset (its once-sounds already true: primed, not played) */
  private first = true;

  /** The bag's sound properties as FlightGear's A320-main.xml starts them (each set unless the game has). */
  reset(P: Props) {
    for (const [k, v] of Object.entries(DATA.init)) if (P[k] === undefined) P[k] = v;
    for (const s of this.states) Object.assign(s, { active: false, dtPlay: 0, dtStop: 0, stopping: 0, prev: 0, last: null, muted: false });
    this.first = true;
  }

  /** The property rules' frame (in their files' order: sound-common.xml's, then cfm56-sound.xml's). */
  rules(P: Props, dt: number) {
    for (const r of DATA.rules) {
      if (r.t === "logic") {
        const v = test(r.cond, P) ? 1 : 0;
        for (const o of r.out) P[o] = v;
        continue;
      }
      // (the first input whose condition holds: its value scaled, offset, clamped; none: 0)
      let v = 0;
      for (const i of r.in) {
        if (!test(i.cond, P)) continue;
        v = evaluate(i.src, P) * (i.scale ?? 1) + (i.offset ?? 0);
        if (i.min !== undefined) v = Math.max(v, i.min);
        if (i.max !== undefined) v = Math.min(v, i.max);
        break;
      }
      if (r.t === "gain") {
        const g = r.gain ? evaluate(r.gain, P) : 1;
        for (const o of r.out) P[o] = v * g;
      } else {
        // (the noise spike: towards it at its rate at most)
        for (const o of r.out) {
          const was = n(P[o]);
          P[o] = was + Math.max(-r.rate * dt, Math.min(r.rate * dt, v - was));
        }
      }
    }
  }

  /** A frame [s]: the rules, then each sound; the voices heard (a once-sound kept while its condition holds — it
   *  plays once per `shot` —, a loop while it has a gain). `view.ear`: the ear in the ship's frame (the cones). */
  step(P: Props, dt: number, view: { inside: boolean; ear?: V3 }): CraftVoice[] {
    this.rules(P, dt);
    const out: CraftVoice[] = [];
    SOUNDS.forEach((d, k) => {
      const s = this.states[k]!;
      const cur = d.prop ? n(P[d.prop]) : 0;
      const off = d.cond ? !test(d.cond, P) : !!d.prop && (!cur || (d.mode === "in-transit" && cur === s.prev));
      if (off) {
        if (d.mode !== "in-transit" || s.stopping > MAX_TRANSIT) {
          s.active = false;
          s.dtStop += dt;
          s.dtPlay = 0;
          s.last = null;
          s.muted = false;
        } else {
          // (in transit: still playing a moment after its property stopped moving)
          s.stopping += dt;
          if (s.last) out.push(s.last);
        }
        return;
      }
      if (s.active && d.mode === "once") s.dtPlay += dt;
      else {
        s.dtPlay += dt;
        s.prev = cur;
        s.stopping = 0;
      }
      if (s.dtPlay < (d.delay ?? 0)) return;
      if (!s.active) {
        s.active = true;
        s.dtStop = 0;
        // (FlightGear plays a once-sound true when the sim starts — the wheels' thump, the levers' detents: not here)
        if (d.mode === "once" && this.first) s.muted = true;
        else if (d.mode === "once") s.shot++;
      }
      if (s.muted) return;
      // (SimGear's sample: its volume at most 1, its pitch within 0.01 … 2)
      let gain = Math.min(terms(d.volume, P, s), 1);
      const rate = Math.min(Math.max(terms(d.pitch, P, s), 0.01), 2);
      const pos = d.pos ?? (d.avionics || d.where === "inside" ? null : ORIGIN);
      if (d.cone && pos && view.ear) gain *= cone(d.cone, pos, view.ear);
      if (!(gain > 1e-4) && d.mode !== "once") {
        s.last = null;
        return;
      }
      const v: CraftVoice = {
        id: `${k}:${d.name}`,
        url: SOUND_URL[d.file]!,
        loop: d.mode !== "once",
        ...(d.mode === "once" ? { shot: s.shot } : {}),
        gain: Math.max(gain, 0),
        rate,
        pos,
        ...(pos ? { refDist: d.refDist ?? REF_DIST, maxDist: d.maxDist ?? MAX_DIST } : {}),
        where: d.where,
      };
      s.last = v;
      out.push(v);
    });
    this.first = false;
    return out;
  }
}
