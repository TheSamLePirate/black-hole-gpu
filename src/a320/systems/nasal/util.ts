// What FlightGear's Nasal does with time and properties, on the systems' bag (docs/PLAN-A320.md, A10): a module's
// own clock and its timers (settimer, maketimer), its listeners (setlistener: a property's value changed since the
// last frame), aircraft.door (a position 0…1 moved at its swing time), the bag's numbers and booleans read as Nasal
// reads them (a missing property: its default). Pure.

import type { Props } from "../../rig";

/** a property read as a number (missing, or not a number: d) */
export const num = (P: Props, k: string, d = 0): number => {
  const v = P[k];
  if (v === undefined) return d;
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
/** a property read as Nasal's getBoolValue */
export const bool = (P: Props, k: string): boolean => num(P, k) !== 0;
/** a boolean set as Nasal's setBoolValue */
export const setb = (P: Props, k: string, v: boolean | number) => {
  P[k] = v ? 1 : 0;
};
/** a set of properties written at once (a state's switches) */
export const assign = (P: Props, vals: Record<string, number | string>) => {
  for (const k in vals) P[k] = vals[k]!;
};

/** A module's clock [s] and its timers: one-shot (settimer) and repeating checks (maketimer, run each frame here —
 *  FlightGear's 0.1 s period is finer than nothing the systems show). */
export class Clock {
  t = 0;
  private q: { at: number; fn: () => void; tag?: string }[] = [];
  /** fn in s seconds (a tag: cancelled together) */
  after(s: number, fn: () => void, tag?: string) {
    this.q.push({ at: this.t + s, fn, tag });
  }
  cancel(tag: string) {
    this.q = this.q.filter((x) => x.tag !== tag);
  }
  /** the clock moved on by dt, the timers due run (in their order) */
  tick(dt: number) {
    this.t += dt;
    for (;;) {
      let i = -1;
      for (let k = 0; k < this.q.length; k++) if (this.q[k]!.at <= this.t && (i < 0 || this.q[k]!.at < this.q[i]!.at)) i = k;
      if (i < 0) break;
      const [x] = this.q.splice(i, 1);
      x!.fn();
    }
  }
  clear() {
    this.q = [];
  }
}

/** FlightGear's setlistener(p, f, 0, 0): f when p's value changed — seen here once a frame, against its last value. */
export class Listen {
  private last = new Map<string, number | string | undefined>();
  /** true if k changed since the last look (the first look primes it) */
  edge(P: Props, k: string): boolean {
    const v = P[k];
    if (!this.last.has(k)) {
      this.last.set(k, v);
      return false;
    }
    const was = this.last.get(k);
    this.last.set(k, v);
    if (typeof v === "string" || typeof was === "string") return v !== was;
    return Number(was ?? 0) !== Number(v ?? 0);
  }
  /** the properties taken as they are now (no edge for what a reset wrote) */
  prime(P: Props, keys: string[]) {
    for (const k of keys) this.last.set(k, P[k]);
  }
}

/** aircraft.door: a position 0…1 moved towards its target at 1 / swing a second. */
export class Door {
  target = 0;
  constructor(
    readonly prop: string,
    readonly swing: number,
  ) {}
  open() {
    this.target = 1;
  }
  close() {
    this.target = 0;
  }
  setpos(P: Props, x: number) {
    this.target = x;
    P[this.prop] = x;
  }
  step(P: Props, dt: number) {
    const x = num(P, this.prop);
    if (x === this.target) return;
    const d = dt / this.swing;
    P[this.prop] = this.target > x ? Math.min(this.target, x + d) : Math.max(this.target, x - d);
  }
}

/** A deck knob's argument: a number as it is, or the Nasal it had — "….getValue() + 1" / "- 1" — read from the switch's
 *  value now (deckctl's nasalCalls keeps a non-literal argument's text, or gives NaN: then null, nothing done). */
export function knobArg(a: number | string | undefined, now: number): number | null {
  if (typeof a === "number") return Number.isFinite(a) ? a : null;
  if (typeof a !== "string") return null;
  const n = Number(a);
  if (a.trim() !== "" && Number.isFinite(n)) return n;
  const m = /([+-])\s*(\d+(?:\.\d+)?)\s*$/.exec(a);
  return m ? now + (m[1] === "+" ? 1 : -1) * Number(m[2]) : null;
}
