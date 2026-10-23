// JSBSim's functions evaluated (docs/PLAN-A320.md, A3): the A320's flight model as FlightGear's A320-family writes it
// (src/a320/fdm-data.ts, scripts/build-a320-data.py) — products, sums, quotients, powers, comparisons, and its tables of
// one, two or three variables, looked up as JSBSim does (linear between breakpoints, clamped at the ends). Pure.

/** A JSBSim table: its variables (row, column, table), its breakpoints and data; or pages of 2-D tables by the
 *  third variable's breakpoints. */
export interface Table {
  vars: string[];
  rows?: number[];
  cols?: number[];
  data?: number[] | number[][];
  pages?: { bp: number; table: Table }[];
}

export type Expr = ["value", number] | ["prop", string] | ["table", Table] | [string, ...Expr[]];

export interface FdmFn {
  name: string;
  expr: Expr;
}

/** The generated data's shape (fdm-data.ts). */
export interface FdmData {
  source: string;
  metrics: { S: number; b: number; c: number; AERORP: number[]; EYEPOINT: number[]; VRP: number[] };
  mass: { Ixx: number; Iyy: number; Izz: number; empty: number; cg: number[]; points: { name: string; kg: number; at: number[] }[] };
  tanks: { type: string; at: number[]; capacityKg: number; kg: number }[];
  engines: { file: string; at: number[]; feed: number[] }[];
  engine: Record<string, number | Expr>;
  fadec: Record<string, Expr>;
  detents: Record<string, number>;
  aero: { functions: FdmFn[]; axes: Record<string, FdmFn[]> };
}

/** The properties a function reads (JSBSim's paths, without the leading "/"); missing: 0. */
export type Bag = Record<string, number>;

/** i, f: the segment of `xs` holding x and the fraction along it (clamped at the ends). */
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

/** A table's value for the bag. */
export function lookup(t: Table, b: Bag): number {
  if (t.pages) {
    const z = b[t.vars[2]!] ?? 0;
    const bps = t.pages.map((p) => p.bp);
    const [i, f] = seg(bps, z);
    const a = lookup(t.pages[i]!.table, b);
    if (t.pages.length < 2 || f === 0) return a;
    return a + (lookup(t.pages[i + 1]!.table, b) - a) * f;
  }
  const rows = t.rows!;
  const [i, f] = seg(rows, b[t.vars[0]!] ?? 0);
  if (!t.cols) {
    const d = t.data as number[];
    return rows.length < 2 ? d[0]! : d[i]! + (d[i + 1]! - d[i]!) * f;
  }
  const d = t.data as number[][];
  const [j, g] = seg(t.cols, b[t.vars[1]!] ?? 0);
  const at = (r: number) => {
    const row = d[r]!;
    return t.cols!.length < 2 ? row[0]! : row[j]! + (row[j + 1]! - row[j]!) * g;
  };
  return rows.length < 2 ? at(0) : at(i) + (at(i + 1) - at(i)) * f;
}

const D2R = Math.PI / 180;

/** An expression's value for the bag. */
export function evaluate(e: Expr, b: Bag): number {
  const op = e[0];
  switch (op) {
    case "value":
      return e[1] as number;
    case "prop":
      return b[e[1] as string] ?? 0;
    case "table":
      return lookup(e[1] as Table, b);
  }
  const a = (e.slice(1) as Expr[]).map((x) => evaluate(x, b));
  switch (op) {
    case "product":
      return a.reduce((p, x) => p * x, 1);
    case "sum":
      return a.reduce((p, x) => p + x, 0);
    case "difference":
      return a.slice(1).reduce((p, x) => p - x, a[0]!);
    case "quotient":
      return a[1] !== 0 ? a[0]! / a[1]! : Number.POSITIVE_INFINITY;
    case "pow":
      return a[0]! ** a[1]!;
    case "abs":
      return Math.abs(a[0]!);
    case "sqrt":
      return Math.sqrt(a[0]!);
    case "sin":
      return Math.sin(a[0]!);
    case "cos":
      return Math.cos(a[0]!);
    case "toradians":
      return a[0]! * D2R;
    case "todegrees":
      return a[0]! / D2R;
    case "floor":
      return Math.floor(a[0]!);
    case "integer":
      return Math.trunc(a[0]!);
    case "min":
      return Math.min(...a);
    case "max":
      return Math.max(...a);
    case "ifthen":
      return a[0] ? a[1]! : a[2]!;
    case "eq":
      return a[0] === a[1] ? 1 : 0;
    case "nq":
      return a[0] !== a[1] ? 1 : 0;
    case "lt":
      return a[0]! < a[1]! ? 1 : 0;
    case "le":
      return a[0]! <= a[1]! ? 1 : 0;
    case "gt":
      return a[0]! > a[1]! ? 1 : 0;
    case "ge":
      return a[0]! >= a[1]! ? 1 : 0;
    case "and":
      return a.every((x) => x) ? 1 : 0;
    case "or":
      return a.some((x) => x) ? 1 : 0;
    case "not":
      return a[0] ? 0 : 1;
  }
  throw new Error(`JSBSim op ${op}`);
}

/** A function's short name (its last path element). */
export const short = (f: FdmFn) => f.name.split("/").pop()!;
