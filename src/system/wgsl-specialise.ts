// A WGSL module specialised for a pipeline's override constants, as source (docs/PLAN-LEAN-TRACER-KERNELS.md P1b).
//
// The tracer is one module whose features are switched by override constants (HAS_*, DISC_ONLY, QUALITY_PIPELINE…).
// Tint does not remove the branches a constant makes dead: on D3D12 it writes the whole reachable code into the HLSL, and
// DXC parses and inlines all of it before it folds the constants — dead code cost it as much as live code (key 516's
// `main`: 41 s of DXC, 1.6 s once its dead branches are gone, the same DXIL). So the dead branches are removed here, before
// the module is made: `if (<a constant-false conjunction>) { … }` becomes `if (false) {}` (its `else` kept), and only the
// functions the entry point still reaches are kept. What the compilers would fold, folded first — never anything else:
// - a term is false only by the constants given (an override `X` false, `!X` with X true, `X == n`/`X > n`… on a number),
//   a `let` of such a conjunction declared once in its function, a `bool` helper that returns one, or a `var` given a
//   literal and never given another value (nor its address taken);
// - a condition with a top-level `||` is left alone.
// The module's declarations (structs, globals, overrides — the pipeline's constants still name them) are kept as they are.

export interface WgslFn {
  name: string;
  /** the body, comments stripped (from after the opening brace to before the closing one) */
  body: string;
  /** the parameters' names */
  params: string[];
  /** the signature's return type ("" for none) */
  returns: string;
  /** an entry point (@compute) */
  entry: boolean;
  /** where the declaration starts (its attributes) and the body's place, in the comment-stripped text */
  declStart: number;
  start: number;
  end: number;
}

export const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** The functions of a comment-stripped module (top-level `fn name(…) … { … }`). */
export function parseFunctions(text: string): Map<string, WgslFn> {
  const out = new Map<string, WgslFn>();
  // (attribute lines are attributes alone — `@compute @workgroup_size(8, 8)` —: a global's `@group(0) @binding(3) var…;` on the
  // line before a function is not the function's)
  const re = /(^|\n)((?:[ \t]*(?:@\w+(?:\([^()\n]*\))?[ \t]*)+\n)*)[ \t]*fn\s+(\w+)\s*\(/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const name = m[3]!;
    const attrs = m[2] ?? "";
    const paramsAt = re.lastIndex;
    let i = paramsAt;
    let depth = 1;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    const params = [...text.slice(paramsAt, i - 1).matchAll(/(?:^|,)\s*(?:@[^,]*?\)\s*)?(\w+)\s*:/g)].map((p) => p[1]!);
    const open = text.indexOf("{", i);
    const returns = text
      .slice(i, open)
      .replace(/^\s*->\s*/, "")
      .replace(/@\w+(\([^)]*\))?/g, "")
      .trim();
    let d = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text[j] === "{") d++;
      else if (text[j] === "}" && --d === 0) break;
    }
    const declStart = m.index + (m[1]?.length ?? 0);
    out.set(name, {
      name,
      body: text.slice(open + 1, j),
      params,
      returns,
      entry: /@compute/.test(attrs),
      declStart,
      start: open + 1,
      end: j,
    });
    re.lastIndex = j;
  }
  return out;
}

/** The `override` constants' defaults (bool as 0/1; numbers as written). */
export function overrideDefaults(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = /override\s+(\w+)\s*:\s*\w+\s*=\s*([^;]+);/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const v = m[2]!.trim();
    out[m[1]!] = v === "true" ? 1 : v === "false" ? 0 : Number.parseFloat(v);
  }
  return out;
}

/** the names declared at module scope (a local of the same name is not taken for a constant) */
function moduleNames(text: string, fns: Map<string, WgslFn>): Set<string> {
  let outside = "";
  let at = 0;
  for (const f of [...fns.values()].sort((a, b) => a.start - b.start)) {
    outside += text.slice(at, f.start);
    at = f.end;
  }
  outside += text.slice(at);
  const out = new Set<string>(fns.keys());
  for (const m of outside.matchAll(/\b(?:const|var(?:<[^>]*>)?|override|let|struct|alias)\s+(\w+)/g)) out.add(m[1]!);
  return out;
}

/** a condition's top-level `&&` terms (null when it has a top-level `||`) */
function conjuncts(cond: string): string[] | null {
  const terms: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cond.length; i++) {
    const c = cond[i]!;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && cond.startsWith("||", i)) return null;
    else if (depth === 0 && cond.startsWith("&&", i)) {
      terms.push(cond.slice(start, i).trim());
      start = i + 2;
    }
  }
  terms.push(cond.slice(start).trim());
  return terms;
}

/** what is known false: the constants, the false locals (`name`), constant vars (`name=` → value), false helpers (`name()`) */
interface Facts {
  consts: Record<string, number>;
  names: Set<string>;
  values: Record<string, number>;
}

const COMPARE: Record<string, (a: number, b: number) => boolean> = {
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  ">": (a, b) => a > b,
  "<": (a, b) => a < b,
  ">=": (a, b) => a >= b,
  "<=": (a, b) => a <= b,
};

/** whether a term is false under the facts */
function falseTerm(t: string, f: Facts): boolean {
  // (a constant compared to a number: an override, or a constant var)
  let m = /^(\w+)\s*(==|!=|>=|<=|>|<)\s*(-?[\d.]+)[uif]?$/.exec(t);
  if (m) {
    const v = f.consts[m[1]!] ?? f.values[m[1]!];
    return v !== undefined && !COMPARE[m[2]!]!(v, Number.parseFloat(m[3]!));
  }
  m = /^(\w+)$/.exec(t);
  if (m) return f.consts[m[1]!] === 0 || f.names.has(m[1]!);
  m = /^!\s*(\w+)$/.exec(t);
  if (m) return f.consts[m[1]!] !== undefined && f.consts[m[1]!] !== 0;
  m = /^(\w+)\s*\(([^()]*)\)$/.exec(t);
  if (m) return f.names.has(`${m[1]}()`);
  m = /^\((.*)\)$/.exec(t);
  if (m) return falseCond(m[1]!, f);
  return false;
}
function falseCond(cond: string, f: Facts): boolean {
  const terms = conjuncts(cond);
  return !!terms && terms.some((t) => falseTerm(t, f));
}

/** the bool helpers whose whole body is a false conjunction: `fn rasterPrimary() -> bool { return HAS_TERRAIN_RASTER && …; }` */
export function falseHelpers(fns: Map<string, WgslFn>, consts: Record<string, number>): Set<string> {
  const names = new Set<string>();
  const f: Facts = { consts, names, values: {} };
  for (let pass = 0; pass < 4; pass++)
    for (const fn of fns.values()) {
      if (fn.returns !== "bool" || names.has(`${fn.name}()`)) continue;
      const m = /^\s*return\s+([^;]+);\s*$/.exec(fn.body);
      if (m && falseCond(m[1]!, f)) names.add(`${fn.name}()`);
    }
  return names;
}

/**
 * A body with the blocks of its constant-false `if`s emptied (their `else` kept). `taken`: the names a local may not be
 * (the module's and the function's parameters: a local of that name is not known to be the one meant everywhere).
 */
export function prune(body: string, consts: Record<string, number>, falseFns: Set<string>, taken: Set<string> = new Set()): string {
  const declared = (name: string) => [...body.matchAll(new RegExp(`\\b(?:let|var|const)\\s+${name}\\b`, "g"))].length;
  const local = (name: string) => !taken.has(name) && declared(name) === 1;
  const f: Facts = { consts, names: new Set(falseFns), values: {} };
  // (locals that are such a conjunction: `let whOn = HAS_WH && …;`)
  for (const m of body.matchAll(/\blet\s+(\w+)\s*=\s*([^;]+);/g)) if (local(m[1]!) && falseCond(m[2]!, f)) f.names.add(m[1]!);
  const once = pruneOnce(body, f);
  // (then the `var`s given a literal and never another value once the dead blocks are gone — nor their address taken —:
  // constants, as the compilers propagate them — the wormhole's segment, `var seg = 0u;`, set to 1 only under `whOn`)
  let found = false;
  for (const m of once.matchAll(/\bvar\s+(\w+)\s*(?::\s*\w+\s*)?=\s*(-?\d+)[ui]?\s*;/g)) {
    const name = m[1]!;
    if (!local(name) || new RegExp(`(?<!&)&\\s*${name}\\b`).test(once)) continue;
    const value = Number(m[2]);
    const changes = [
      ...once.matchAll(new RegExp(`\\b${name}\\s*(?:=(?!=)\\s*([^;]*);|\\+=|-=|\\*=|/=|%=|&=|\\|=|\\^=|<<=|>>=|\\+\\+|--)`, "g")),
    ].filter((a) => a[1] === undefined || !/^-?\d+[ui]?$/.test(a[1].trim()) || Number.parseInt(a[1].trim(), 10) !== value);
    if (changes.length === 0) {
      f.values[name] = value;
      found = true;
    }
  }
  return found ? pruneOnce(once, f) : once;
}

function pruneOnce(body: string, f: Facts): string {
  let out = "";
  let i = 0;
  for (;;) {
    const k = body.indexOf("if (", i);
    if (k < 0) {
      out += body.slice(i);
      break;
    }
    if (k > 0 && /\w/.test(body[k - 1]!)) {
      out += body.slice(i, k + 4);
      i = k + 4;
      continue;
    }
    let depth = 0;
    let j = k + 3;
    for (; j < body.length; j++) {
      if (body[j] === "(") depth++;
      else if (body[j] === ")" && --depth === 0) break;
    }
    const cond = body.slice(k + 4, j);
    let b = j + 1;
    while (/\s/.test(body[b] ?? "")) b++;
    if (body[b] !== "{" || !falseCond(cond, f)) {
      out += body.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    let e = b;
    let d = 0;
    for (; e < body.length; e++) {
      if (body[e] === "{") d++;
      else if (body[e] === "}" && --d === 0) break;
    }
    out += `${body.slice(i, k)}if (false) {}`;
    i = e + 1;
  }
  return out;
}

/** A module parsed once, specialised for each pipeline's constants. */
export class WgslSpecialiser {
  readonly text: string;
  readonly fns: Map<string, WgslFn>;
  readonly defaults: Record<string, number>;
  private readonly names: Set<string>;
  private readonly callRe: RegExp;

  constructor(src: string) {
    this.text = stripComments(src);
    this.fns = parseFunctions(this.text);
    this.defaults = overrideDefaults(this.text);
    this.names = moduleNames(this.text, this.fns);
    const fnNames = [...this.fns.keys()].sort((a, b) => b.length - a.length);
    this.callRe = new RegExp(`\\b(${fnNames.join("|")})\\s*\\(`, "g");
  }

  /** each function's body pruned for the constants */
  bodies(consts: Record<string, number>): Map<string, string> {
    const all = { ...this.defaults, ...consts };
    const falseFns = falseHelpers(this.fns, all);
    const out = new Map<string, string>();
    for (const fn of this.fns.values()) out.set(fn.name, prune(fn.body, all, falseFns, new Set([...this.names, ...fn.params])));
    return out;
  }

  /** the functions a set of bodies reaches from an entry point */
  reach(bodies: Map<string, string>, entry: string): Set<string> {
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n) || !bodies.has(n)) continue;
      seen.add(n);
      for (const c of bodies.get(n)!.matchAll(this.callRe)) if (!seen.has(c[1]!)) stack.push(c[1]!);
    }
    return seen;
  }

  /**
   * The module's source for a pipeline: its dead branches removed and, given its entry point, only the functions that entry
   * still reaches (the other entry points and the code only dead branches called gone). Comments stripped.
   */
  specialise(consts: Record<string, number>, entry?: string): string {
    const bodies = this.bodies(consts);
    const keep = entry ? this.reach(bodies, entry) : null;
    let out = "";
    let at = 0;
    for (const fn of [...this.fns.values()].sort((a, b) => a.start - b.start)) {
      if (keep && !keep.has(fn.name)) {
        out += this.text.slice(at, fn.declStart);
        at = fn.end + 1;
        continue;
      }
      out += this.text.slice(at, fn.start) + bodies.get(fn.name)!;
      at = fn.end;
    }
    return (out + this.text.slice(at)).replace(/\n{3,}/g, "\n\n");
  }
}
