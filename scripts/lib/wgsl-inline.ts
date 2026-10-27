// A static estimate of what a WGSL compute kernel becomes once every call is inlined — what D3D12's compilers do
// (WGSL → HLSL → DXIL: no calls left in a shader), and the cost a player waits for on Windows, roughly in proportion to
// it (docs/PLAN-LEAN-TRACER-KERNELS.md, calibrated by scripts/d3d12-compile-proxy.ts). Override constants are
// substituted and the branches they make dead (`if (HAS_X && …)`, `if (!DISC_ONLY …)`, a `let` or a `bool` helper that is
// such a conjunction) are pruned, as the compilers fold them. An upper bound: the compilers also fold what depends on
// runtime-uniform values, and inline small helpers into far fewer instructions than their lines.

export interface WgslFn {
  name: string;
  /** the body, comments stripped (from after the opening brace) */
  body: string;
  /** the signature's return type ("" for none) */
  returns: string;
  /** an entry point (@compute) */
  entry: boolean;
  /** the body's place in the comment-stripped text (after its opening brace, at its closing one) */
  start: number;
  end: number;
}

export interface KernelSize {
  entry: string;
  /** distinct functions reached */
  functions: number;
  /** their lines, each counted once */
  unique: number;
  /** the lines once every call is inlined */
  inlined: number;
}

export interface Multiplier {
  name: string;
  /** inlined copies in the kernel */
  copies: number;
  /** the lines one copy brings, its own calls inlined */
  each: number;
  /** copies × each */
  total: number;
}

export const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** The module's functions (top-level `fn name(…) … { … }`). */
export function parseFunctions(src: string): Map<string, WgslFn> {
  const text = stripComments(src);
  const out = new Map<string, WgslFn>();
  const re = /(^|\n)((?:@[^\n]*\n)*)\s*fn\s+(\w+)\s*\(/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const name = m[3]!;
    const attrs = m[2] ?? "";
    let i = re.lastIndex;
    // (the parameters, then the return type up to the body's brace)
    let depth = 1;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
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
    // (attributes on the line before: `@compute @workgroup_size(…)`)
    const before = text.slice(Math.max(0, m.index - 200), m.index + (m[1]?.length ?? 0));
    const entry = /@compute/.test(attrs) || /@compute[^\n]*\n?\s*$/.test(before);
    out.set(name, { name, body: text.slice(open + 1, j), returns, entry, start: open + 1, end: j });
    re.lastIndex = j;
  }
  return out;
}

/** The `override` constants' defaults (bool as 0/1; numbers as written). */
export function overrideDefaults(src: string): Record<string, number> {
  const out: Record<string, number> = {};
  const text = stripComments(src);
  const re = /override\s+(\w+)\s*:\s*\w+\s*=\s*([^;]+);/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const v = m[2]!.trim();
    out[m[1]!] = v === "true" ? 1 : v === "false" ? 0 : Number.parseFloat(v);
  }
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

/** whether a term is false for the constants (`X` false, `!X` true, a false local or helper) */
function falseTerm(t: string, consts: Record<string, number>, falseNames: Set<string>): boolean {
  // (a constant local compared to another value: `seg == 1u` with `var seg = 0u;` never assigned outside dead blocks)
  let m = /^(\w+)\s*==\s*(\d+)u?$/.exec(t);
  if (m) return falseNames.has(`${m[1]}=`) && consts[`${m[1]}=`] !== Number(m[2]);
  m = /^(\w+)$/.exec(t);
  if (m) return consts[m[1]!] === 0 || falseNames.has(m[1]!);
  m = /^!\s*(\w+)$/.exec(t);
  if (m) return consts[m[1]!] !== undefined && consts[m[1]!] !== 0;
  m = /^(\w+)\s*\(([^()]*)\)$/.exec(t);
  if (m) return falseNames.has(`${m[1]}()`);
  m = /^\((.*)\)$/.exec(t);
  if (m) return falseCond(m[1]!, consts, falseNames);
  return false;
}
function falseCond(cond: string, consts: Record<string, number>, falseNames: Set<string>): boolean {
  const terms = conjuncts(cond);
  return !!terms && terms.some((t) => falseTerm(t, consts, falseNames));
}

/** A body with the blocks of its constant-false `if`s emptied (their `else` kept). */
export function prune(body: string, consts: Record<string, number>, falseFns: Set<string>): string {
  // (locals that are such a conjunction: `let whOn = HAS_WH && …;`)
  const names = new Set(falseFns);
  // (a name declared once only: another scope's `let on = …` of the same name would be taken for it)
  const declared = (name: string) => [...body.matchAll(new RegExp(`\\b(?:let|var|const)\\s+${name}\\b`, "g"))].length;
  for (const m of body.matchAll(/\blet\s+(\w+)\s*=\s*([^;]+);/g))
    if (declared(m[1]!) === 1 && falseCond(m[2]!, consts, names)) names.add(m[1]!);
  const once = pruneOnce(body, consts, names);
  // (then the `var`s given a literal and assigned nowhere else once the dead blocks are gone: constants, as the compilers
  // propagate them — the wormhole's segment, `var seg = 0u;`, set to 1 only under `whOn`)
  const locals = { ...consts };
  let found = false;
  for (const m of once.matchAll(/\bvar\s+(\w+)\s*(?::\s*\w+\s*)?=\s*(\d+)u?\s*;/g)) {
    const name = m[1]!;
    if (declared(name) !== 1) continue;
    const value = Number(m[2]);
    // (assigned again to the same value: still that constant)
    const other = [...once.matchAll(new RegExp(`\\b${name}\\s*(?:=(?!=)\\s*([^;]*);|\\+=|-=|\\*=|\\+\\+|--)`, "g"))].filter(
      (a) => a[1] === undefined || Number.parseFloat(a[1].trim()) !== value || !/^\d+u?$/.test(a[1].trim()),
    );
    // (the declaration itself matches `name = literal;`: one same-value match is expected)
    if (other.length === 0) {
      names.add(`${name}=`);
      locals[`${name}=`] = Number(m[2]);
      found = true;
    }
  }
  return found ? pruneOnce(once, locals, names) : once;
}

function pruneOnce(body: string, consts: Record<string, number>, names: Set<string>): string {
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
    if (body[b] !== "{") {
      out += body.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (!falseCond(cond, consts, names)) {
      out += body.slice(i, b + 1);
      i = b + 1;
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

/** the bool helpers whose whole body is a false conjunction: `fn rasterPrimary() -> bool { return HAS_TERRAIN_RASTER && …; }` */
function falseHelpers(fns: Map<string, WgslFn>, consts: Record<string, number>): Set<string> {
  const out = new Set<string>();
  for (let pass = 0; pass < 4; pass++)
    for (const f of fns.values()) {
      if (f.returns !== "bool") continue;
      const m = /^\s*return\s+([^;]+);\s*$/.exec(f.body);
      if (m && falseCond(m[1]!, consts, out)) out.add(`${f.name}()`);
    }
  return out;
}

/**
 * The module specialised for a pipeline's constants, as source: every function's constant-false branches removed
 * (`if (false) {}` left in their place, their `else` kept) — what the shader compilers would fold anyway, done before
 * them, so that the code those branches reach is no longer reachable from the entry point at all: Tint then leaves it
 * out of the HLSL/MSL it writes, and DXC never parses it (it parses and inlines a pipeline's whole HLSL before it folds
 * a constant: dead code costs it time all the same — docs/PLAN-LEAN-TRACER-KERNELS.md, P0). Comments are stripped.
 * The override declarations stay: the pipeline's constants still set them.
 */
export function specialiseWgsl(src: string, consts: Record<string, number>): string {
  const fns = parseFunctions(src);
  const text = stripComments(src);
  const all = { ...overrideDefaults(src), ...consts };
  const falseFns = falseHelpers(fns, all);
  let out = "";
  let at = 0;
  for (const f of [...fns.values()].sort((a, b) => a.start - b.start)) {
    out += text.slice(at, f.start) + prune(f.body, all, falseFns);
    at = f.end;
  }
  return out + text.slice(at);
}

const lines = (s: string) => s.split("\n").filter((l) => l.trim() && l.trim() !== "{}" && l.trim() !== "}").length;

/** A module analysed for a set of constants: each kernel's size, its multipliers. */
export class InlineModel {
  readonly fns: Map<string, WgslFn>;
  private bodies = new Map<string, string>();
  private calls = new Map<string, Map<string, number>>();
  private expMemo = new Map<string, number>();

  constructor(src: string, consts: Record<string, number>, stubs: Iterable<string> = []) {
    this.fns = parseFunctions(src);
    const all = { ...overrideDefaults(src), ...consts };
    const stubbed = new Set(stubs);
    const falseFns = falseHelpers(this.fns, all);
    for (const f of this.fns.values()) this.bodies.set(f.name, stubbed.has(f.name) ? "" : prune(f.body, all, falseFns));
    const names = [...this.fns.keys()];
    const callRe = new RegExp(`\\b(${names.map((n) => n.replace(/[$]/g, "\\$")).join("|")})\\s*\\(`, "g");
    for (const [name, body] of this.bodies) {
      const m = new Map<string, number>();
      for (const c of body.matchAll(callRe)) if (c[1] !== name) m.set(c[1]!, (m.get(c[1]!) ?? 0) + 1);
      this.calls.set(name, m);
    }
  }

  own(name: string) {
    return lines(this.bodies.get(name) ?? "");
  }

  /** the lines of a function with every call inlined */
  inlined(name: string): number {
    const memo = this.expMemo.get(name);
    if (memo !== undefined) return memo;
    let n = this.own(name);
    for (const [c, k] of this.calls.get(name) ?? []) n += k * this.inlined(c);
    this.expMemo.set(name, n);
    return n;
  }

  /** the functions an entry reaches, callees after callers */
  reach(entry: string): string[] {
    const seen = new Set<string>();
    const post: string[] = [];
    const visit = (n: string) => {
      if (seen.has(n)) return;
      seen.add(n);
      for (const c of this.calls.get(n)?.keys() ?? []) visit(c);
      post.push(n);
    };
    visit(entry);
    return post.reverse();
  }

  size(entry: string): KernelSize {
    const r = this.reach(entry);
    return { entry, functions: r.length, unique: r.reduce((s, n) => s + this.own(n), 0), inlined: this.inlined(entry) };
  }

  /** each function's inlined copies in the kernel and the lines they bring, largest first */
  multipliers(entry: string, minEach = 0): Multiplier[] {
    const order = this.reach(entry);
    const copies = new Map<string, number>([[entry, 1]]);
    for (const n of order) {
      const c = copies.get(n) ?? 0;
      for (const [callee, k] of this.calls.get(n) ?? []) copies.set(callee, (copies.get(callee) ?? 0) + c * k);
    }
    return [...copies]
      .filter(([n]) => n !== entry && this.inlined(n) >= minEach)
      .map(([name, c]) => ({ name, copies: c, each: this.inlined(name), total: c * this.inlined(name) }))
      .sort((a, b) => b.total - a.total);
  }

  /** the call edges with several sites, weighted by what they inline */
  heavyEdges(entry: string, top = 15) {
    const copies = new Map<string, number>([[entry, 1]]);
    const order = this.reach(entry);
    for (const n of order)
      for (const [callee, k] of this.calls.get(n) ?? []) copies.set(callee, (copies.get(callee) ?? 0) + (copies.get(n) ?? 0) * k);
    const edges: { caller: string; callee: string; sites: number; each: number; weight: number }[] = [];
    for (const n of order)
      for (const [callee, k] of this.calls.get(n) ?? [])
        if (k > 1)
          edges.push({ caller: n, callee, sites: k, each: this.inlined(callee), weight: (copies.get(n) ?? 0) * k * this.inlined(callee) });
    return edges.sort((a, b) => b.weight - a.weight).slice(0, top);
  }
}
