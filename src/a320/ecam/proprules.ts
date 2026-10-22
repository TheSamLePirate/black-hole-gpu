// FlightGear's property rules for the ECAM (Systems/ecam-proprules.xml — docs/PLAN-A320.md, A11): its flip-flops
// (RS: reset first, SR: set first, monostable: on while set and `time` seconds after, inverted or not) and its filters
// (a derivative, a gain on the first input whose condition holds), as SimGear's autopilot runs them each frame —
// data from scripts/build-a320-fwc.py (proprules.json). Pure.

import type { Props } from "../rig";

export type RuleCond = ["p", string] | ["not", RuleCond] | ["eq", string, number | string] | ["and" | "or", ...RuleCond[]];

export type Rule =
  | { t: "RS" | "SR" | "monostable"; out: string; S?: RuleCond; R?: RuleCond; time?: number; inv?: boolean }
  | { t: "derivative"; out: string; in: string; tf: number }
  | { t: "gain"; out: string; gain: number; ins: { cond: RuleCond | null; v: number }[] };

const truth = (v: number | string | undefined) => (typeof v === "string" ? v !== "" && v !== "0" && v !== "false" : !!v);

function test(c: RuleCond, P: Props): boolean {
  switch (c[0]) {
    case "p":
      return truth(P[c[1]]);
    case "not":
      return !test(c[1], P);
    case "eq": {
      const v = P[c[1]];
      return typeof c[2] === "number" ? Number(v ?? 0) === c[2] : String(v ?? "") === c[2];
    }
    case "and":
      return c.slice(1).every((x) => test(x as RuleCond, P));
    case "or":
      return c.slice(1).some((x) => test(x as RuleCond, P));
  }
}

export class PropRules {
  /** each rule's state: a flip-flop's q, a monostable's time left, a derivative's last input */
  private q: boolean[];
  private left: number[];
  private last: number[];

  constructor(readonly rules: Rule[]) {
    this.q = rules.map(() => false);
    this.left = rules.map(() => 0);
    this.last = rules.map(() => Number.NaN);
  }

  reset() {
    this.q.fill(false);
    this.left.fill(0);
    this.last.fill(Number.NaN);
  }

  /** A frame [s]: each rule in its order, its output written. */
  step(P: Props, dt: number) {
    this.rules.forEach((r, k) => {
      if (r.t === "derivative") {
        const x = Number(P[r.in] ?? 0);
        const l = this.last[k]!;
        P[r.out] = Number.isFinite(l) && dt > 0 ? ((x - l) * r.tf) / dt : 0;
        this.last[k] = x;
        return;
      }
      if (r.t === "gain") {
        const i = r.ins.find((x) => !x.cond || test(x.cond, P));
        P[r.out] = (i?.v ?? 0) * r.gain;
        return;
      }
      // (SimGear's flip-flops: S and R both — RS's reset, SR's set; S alone sets, R alone resets; a monostable
      // retriggered while set, back to off `time` seconds after)
      const s = r.S ? test(r.S, P) : false;
      const rr = r.R ? test(r.R, P) : false;
      let q = this.q[k]!;
      let changed = true;
      if (s && rr) q = r.t === "SR";
      else if (s) q = true;
      else if (rr) q = false;
      else changed = false;
      if (r.t === "monostable") {
        if (changed) this.left[k] = q ? (r.time ?? 0) : 0;
        else if (this.left[k]! > 0) {
          this.left[k]! -= dt;
          if (this.left[k]! <= 0) q = false;
        }
      }
      this.q[k] = q;
      P[r.out] = (r.inv ? !q : q) ? 1 : 0;
    });
  }
}
