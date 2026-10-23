// The A320's systems as FlightGear's JSBSim files write them (docs/PLAN-A320.md, A10): the electrical network, the
// hydraulics, the fuel, the bleed air, the packs, the ignition, the lights, the indicators, the fire loops, the ADRs,
// the APU, the oxygen (src/a320/systems/sysdata.json, scripts/build-a320-systems.py) — run in their files' order on the
// property bag the deck shares, one pass per frame, each component as JSBSim's own does it: a switch gives its first
// passing test's value (else its default, else 0); an actuator follows its input at its rate limits; a lag filter, a
// kinematic, their states kept between frames; every output clipped. What they read and nothing writes — the engines,
// the APU's speed, the air data, the deck's switches — is the game's to set (inputs.md). Compiled once into closures.

import type { Props } from "../rig";
import type { Expr, Table } from "../jsbsim";

/** A value: a number or a property (negated by a leading "-"). */
export type SysV = number | { p: string; neg?: boolean };
/** A test's logic tree (JSBSim's FGCondition). */
export type SysCond = ["and" | "or", ...SysCond[]] | ["cmp", "eq" | "ne" | "lt" | "le" | "gt" | "ge", SysV, SysV];

/** A component as the converter writes it: its kind, its output properties (its own name's first), its clipping. */
export interface SysComp {
  t: "switch" | "fn" | "act" | "gain" | "sgain" | "sum" | "lag" | "washout" | "sensor" | "kin";
  out: string[];
  clip?: [SysV, SysV];
  in?: SysV;
  ins?: SysV[];
  default?: SysV;
  tests?: { value: SysV; cond: SysCond }[];
  expr?: Expr;
  incr?: SysV;
  decr?: SysV;
  bias?: SysV;
  gain?: SysV;
  table?: Table;
  c1?: SysV;
  lag?: SysV;
  quant?: [number, number, number];
  settings?: [number, number][];
  noscale?: boolean;
}

export interface SysData {
  source: string;
  props: [string, number][];
  systems: { name: string; file: string; channels: { name: string; rate: number; comps: SysComp[] }[] }[];
}

type Get = (P: Props) => number;

/** A property's value as a number (missing, or not a number: 0 — JSBSim's new property). */
const num = (v: number | string | boolean | undefined): number => (typeof v === "number" ? v : v === undefined ? 0 : +v || 0);

const prop =
  (k: string): Get =>
  (P) =>
    num(P[k]);

function value(v: SysV | undefined, dflt = 0): Get {
  if (v === undefined) return () => dflt;
  if (typeof v === "number") return () => v;
  const k = v.p;
  return v.neg ? (P) => -num(P[k]) : (P) => num(P[k]);
}

function cond(c: SysCond): (P: Props) => boolean {
  if (c[0] === "cmp") {
    const a = value(c[2]),
      b = value(c[3]);
    switch (c[1]) {
      case "eq":
        return (P) => a(P) === b(P);
      case "ne":
        return (P) => a(P) !== b(P);
      case "lt":
        return (P) => a(P) < b(P);
      case "le":
        return (P) => a(P) <= b(P);
      case "gt":
        return (P) => a(P) > b(P);
      case "ge":
        return (P) => a(P) >= b(P);
    }
  }
  const parts = (c.slice(1) as SysCond[]).map(cond);
  if (c[0] === "or") return (P) => parts.some((f) => f(P));
  return (P) => parts.every((f) => f(P));
}

/** i, f: the segment of `xs` holding x and the fraction along it (clamped at the ends) — as src/a320/jsbsim.ts. */
function seg(xs: number[], x: number): [number, number] {
  const n = xs.length;
  if (n < 2 || x <= xs[0]!) return [0, 0];
  if (x >= xs[n - 1]!) return [n - 2, 1];
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m]! <= x) lo = m;
    else hi = m;
  }
  return [lo, (x - xs[lo]!) / (xs[lo + 1]! - xs[lo]!)];
}

function table(t: Table): Get {
  if (t.pages) {
    const z = prop(t.vars[2]!);
    const bps = t.pages.map((p) => p.bp);
    const pages = t.pages.map((p) => table(p.table));
    return (P) => {
      const [i, f] = seg(bps, z(P));
      const a = pages[i]!(P);
      return pages.length < 2 || f === 0 ? a : a + (pages[i + 1]!(P) - a) * f;
    };
  }
  const rows = t.rows!;
  const x = prop(t.vars[0]!);
  if (!t.cols) {
    const d = t.data as number[];
    return (P) => {
      if (rows.length < 2) return d[0]!;
      const [i, f] = seg(rows, x(P));
      return d[i]! + (d[i + 1]! - d[i]!) * f;
    };
  }
  const cols = t.cols;
  const d = t.data as number[][];
  const y = prop(t.vars[1]!);
  return (P) => {
    const [i, f] = seg(rows, x(P));
    const [j, g] = seg(cols, y(P));
    const at = (r: number) => {
      const row = d[r]!;
      return cols.length < 2 ? row[0]! : row[j]! + (row[j + 1]! - row[j]!) * g;
    };
    return rows.length < 2 ? at(0) : at(i) + (at(i + 1) - at(i)) * f;
  };
}

const D2R = Math.PI / 180;

/** An expression compiled — src/a320/jsbsim.ts's ops, and the system files' switch, interpolate1d, log10. */
function expr(e: Expr): Get {
  const op = e[0];
  if (op === "value") {
    const v = e[1] as number;
    return () => v;
  }
  if (op === "prop") return prop(e[1] as string);
  if (op === "table") return table(e[1] as Table);
  const a = (e.slice(1) as Expr[]).map(expr);
  const [a0, a1, a2] = a as [Get, Get, Get];
  switch (op) {
    case "product":
      return (P) => {
        let p = 1;
        for (const f of a) p *= f(P);
        return p;
      };
    case "sum":
      return (P) => {
        let s = 0;
        for (const f of a) s += f(P);
        return s;
      };
    case "difference":
      return (P) => {
        let s = a0(P);
        for (let i = 1; i < a.length; i++) s -= a[i]!(P);
        return s;
      };
    case "quotient":
      return (P) => {
        const d = a1(P);
        return d !== 0 ? a0(P) / d : Number.POSITIVE_INFINITY;
      };
    case "pow":
      return (P) => a0(P) ** a1(P);
    case "abs":
      return (P) => Math.abs(a0(P));
    case "sqrt":
      return (P) => Math.sqrt(a0(P));
    case "sin":
      return (P) => Math.sin(a0(P));
    case "cos":
      return (P) => Math.cos(a0(P));
    case "log10":
      return (P) => Math.log10(a0(P));
    case "toradians":
      return (P) => a0(P) * D2R;
    case "todegrees":
      return (P) => a0(P) / D2R;
    case "floor":
      return (P) => Math.floor(a0(P));
    case "integer":
      return (P) => Math.trunc(a0(P));
    case "min":
      return (P) => Math.min(...a.map((f) => f(P)));
    case "max":
      return (P) => Math.max(...a.map((f) => f(P)));
    case "ifthen":
      return (P) => (a0(P) ? a1(P) : a2(P));
    // (a choice by its index: the first argument, the choices after it — out of range, the last)
    case "switch":
      return (P) => {
        const i = Math.max(0, Math.trunc(a0(P)));
        return a[Math.min(i + 1, a.length - 1)]!(P);
      };
    // (x, then the breakpoints' x and y in pairs: linear between them, clamped at the ends)
    case "interpolate1d":
      return (P) => {
        const x = a0(P);
        const n = (a.length - 1) >> 1;
        const xi = (k: number) => a[1 + 2 * k]!(P);
        const yi = (k: number) => a[2 + 2 * k]!(P);
        if (x <= xi(0)) return yi(0);
        for (let k = 1; k < n; k++) {
          const x1 = xi(k);
          if (x <= x1) {
            const x0 = xi(k - 1);
            return yi(k - 1) + ((yi(k) - yi(k - 1)) * (x - x0)) / (x1 - x0);
          }
        }
        return yi(n - 1);
      };
    case "eq":
      return (P) => (a0(P) === a1(P) ? 1 : 0);
    case "nq":
      return (P) => (a0(P) !== a1(P) ? 1 : 0);
    case "lt":
      return (P) => (a0(P) < a1(P) ? 1 : 0);
    case "le":
      return (P) => (a0(P) <= a1(P) ? 1 : 0);
    case "gt":
      return (P) => (a0(P) > a1(P) ? 1 : 0);
    case "ge":
      return (P) => (a0(P) >= a1(P) ? 1 : 0);
    case "and":
      return (P) => (a.every((f) => f(P)) ? 1 : 0);
    case "or":
      return (P) => (a.some((f) => f(P)) ? 1 : 0);
    case "not":
      return (P) => (a0(P) ? 0 : 1);
  }
  throw new Error(`JSBSim system op ${op}`);
}

/** A component compiled: its value for this frame before the clipping (dt: its channel's step) — its state, an
 *  actuator's or a filter's, kept unclipped as JSBSim does —, its outputs, its clipping, its state's reset. */
interface Run {
  f: (P: Props, dt: number) => number;
  out: string[];
  lo?: Get;
  hi?: Get;
  reset: () => void;
}

function compile(c: SysComp): Run {
  const r: Run = { f: () => 0, out: c.out, reset: () => {} };
  if (c.clip) {
    r.lo = value(c.clip[0]);
    r.hi = value(c.clip[1]);
  }
  const inp = value(c.in);
  switch (c.t) {
    case "switch": {
      const tests = c.tests!.map((t) => ({ v: value(t.value), c: cond(t.cond) }));
      const d = value(c.default);
      r.f = (P) => {
        for (const t of tests) if (t.c(P)) return t.v(P);
        return d(P);
      };
      break;
    }
    case "fn": {
      const f = expr(c.expr!);
      r.f = (P) => f(P);
      break;
    }
    case "gain": {
      const g = value(c.gain, 1);
      r.f = (P) => inp(P) * g(P);
      break;
    }
    case "sgain": {
      const t = table(c.table!);
      const g = value(c.gain, 1);
      r.f = (P) => inp(P) * t(P) * g(P);
      break;
    }
    case "sum": {
      const ins = c.ins!.map((v) => value(v));
      const b = value(c.bias);
      r.f = (P) => {
        let s = b(P);
        for (const f of ins) s += f(P);
        return s;
      };
      break;
    }
    // (FGActuator: the perfect actuator's output, then the rate limits — from the first run on: that run follows its
    // input —, then the bias)
    case "act": {
      const incr = c.incr === undefined ? null : value(c.incr);
      const decr = c.decr === undefined ? null : value(c.decr);
      const bias = value(c.bias);
      let init = false;
      let prev = 0;
      r.reset = () => (init = false);
      r.f = (P, dt) => {
        let o = inp(P);
        if (init) {
          const d = o - prev;
          if (incr) {
            const k = incr(P);
            if (d > dt * k) o = prev + k * dt;
          }
          if (decr) {
            const k = decr(P);
            if (d < -dt * k) o = prev - k * dt;
          }
        }
        init = true;
        prev = o;
        return o + bias(P);
      };
      break;
    }
    // (FGFilter: the first run follows its input; then the lag's, or the washout's, bilinear step)
    case "lag":
    case "washout": {
      const c1 = value(c.c1);
      const lag = c.t === "lag";
      let init = false;
      let pin = 0,
        pout = 0;
      r.reset = () => (init = false);
      r.f = (P, dt) => {
        const x = inp(P);
        let o = x;
        if (init) {
          const k = c1(P);
          const cb = (2 - dt * k) / (2 + dt * k);
          o = lag ? (x + pin) * ((dt * k) / (2 + dt * k)) + pout * cb : (x - pin) * (2 / (2 + dt * k)) + pout * cb;
        }
        init = true;
        pin = x;
        pout = o;
        return o;
      };
      break;
    }
    // (FGSensor: its lag first, then its quantization over 2^bits steps from min to max; the noise left out)
    case "sensor": {
      const c1 = c.lag === undefined ? null : value(c.lag);
      const q = c.quant;
      let init = false;
      let pin = 0,
        pout = 0;
      r.reset = () => (init = false);
      r.f = (P, dt) => {
        const x = inp(P);
        let o = x;
        if (c1) {
          if (init) {
            const k = c1(P);
            o = (x + pin) * ((dt * k) / (2 + dt * k)) + pout * ((2 - dt * k) / (2 + dt * k));
          }
          init = true;
          pin = x;
          pout = o;
        }
        if (q) {
          const [bits, lo, hi] = q;
          const g = (hi - lo) / 2 ** bits;
          o = Math.min(Math.max(o, lo), hi);
          o = Math.trunc((o - lo) / g) * g + lo;
        }
        return o;
      };
      break;
    }
    // (FGKinemat: the output moves to its input — scaled by the last setting's position — across the settings, each
    // segment in its own time)
    case "kin": {
      const pos = c.settings!.map((s) => s[0]);
      const tim = c.settings!.map((s) => s[1]);
      const scale = c.noscale ? 1 : pos[pos.length - 1]!;
      let o = 0;
      r.reset = () => (o = 0);
      r.f = (P, dt) => {
        const x = inp(P) * scale;
        let t = dt;
        while (t > 0 && Math.abs(x - o) > 1e-12) {
          // (the segment the output is in, on the side it moves to)
          const up = x > o;
          let i = 1;
          while (i < pos.length - 1 && (up ? pos[i]! <= o : pos[i]! < o)) i++;
          const to = Math.min(Math.max(x, pos[i - 1]!), pos[i]!);
          // (a time of 0: at once)
          if (tim[i]! <= 0) {
            if (to === o) break;
            o = to;
            continue;
          }
          const rate = (pos[i]! - pos[i - 1]!) / tim[i]!;
          const need = Math.abs((to - o) / rate);
          if (need >= t || to === x) {
            o = need >= t ? o + (up ? 1 : -1) * t * rate : to;
            t -= need;
          } else if (to === o) break;
          else {
            o = to;
            t -= need;
          }
        }
        return o;
      };
      break;
    }
  }
  return r;
}

/** FlightGear's system files run on the bag (JsbSystems.step each frame). */
export class JsbSystems {
  readonly data: SysData;
  private chans: { rate: number; n: number; acc: number; runs: Run[] }[] = [];

  constructor(data: SysData) {
    this.data = data;
    for (const s of data.systems)
      for (const ch of s.channels) this.chans.push({ rate: Math.max(1, ch.rate), n: 0, acc: 0, runs: ch.comps.map(compile) });
  }

  /** One frame: every channel in order (one at an execution rate of n every n-th frame, its step n frames long). */
  step(P: Props, dt: number) {
    for (const ch of this.chans) {
      ch.acc += dt;
      if (ch.n++ % ch.rate !== 0) continue;
      const h = ch.acc;
      ch.acc = 0;
      P["fdm/jsbsim/simulation/channel-dt"] = h;
      for (const r of ch.runs) {
        let v = r.f(P, h);
        if (r.lo) {
          const lo = r.lo(P),
            hi = r.hi!(P);
          if (v > hi) v = hi;
          else if (v < lo) v = lo;
        }
        for (const k of r.out) P[k] = v;
      }
    }
  }

  /** The declared properties at their values, every component's state anew (its next run follows its input). */
  reset(P: Props) {
    for (const [k, v] of this.data.props) P[k] = v;
    for (const ch of this.chans) {
      ch.n = 0;
      ch.acc = 0;
      for (const r of ch.runs) r.reset();
    }
  }
}
