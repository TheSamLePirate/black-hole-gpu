// A static estimate of what a WGSL compute kernel becomes once every call is inlined — what D3D12's compilers do
// (WGSL → HLSL → DXIL: no calls left in a shader), and the cost a player waits for on Windows, roughly in proportion to
// it (docs/PLAN-LEAN-TRACER-KERNELS.md, calibrated by scripts/d3d12-compile-proxy.ts). Override constants are
// substituted and the branches they make dead are pruned as the renderer's source specialisation prunes them
// (src/system/wgsl-specialise.ts). An upper bound: the compilers also fold what depends on runtime-uniform values, and
// inline small helpers into far fewer instructions than their lines.
import { WgslSpecialiser, prune } from "../../src/system/wgsl-specialise";

export { prune };

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

const cache = new Map<string, WgslSpecialiser>();
/** a module's specialiser, parsed once per source */
export function specialiser(src: string): WgslSpecialiser {
  let s = cache.get(src);
  if (!s) cache.set(src, (s = new WgslSpecialiser(src)));
  return s;
}

/** The module's source specialised for a pipeline's constants (only its entry point's functions, given one). */
export function specialiseWgsl(src: string, consts: Record<string, number>, entry?: string): string {
  return specialiser(src).specialise(consts, entry);
}

const lines = (s: string) => s.split("\n").filter((l) => l.trim() && l.trim() !== "{}" && l.trim() !== "}").length;

export class InlineModel {
  private bodies = new Map<string, string>();
  private calls = new Map<string, Map<string, number>>();
  private expMemo = new Map<string, number>();

  constructor(src: string, consts: Record<string, number>, stubs: Iterable<string> = []) {
    const sp = specialiser(src);
    const stubbed = new Set(stubs);
    for (const [name, body] of sp.bodies(consts)) this.bodies.set(name, stubbed.has(name) ? "" : body);
    const names = [...this.bodies.keys()].sort((a, b) => b.length - a.length);
    const callRe = new RegExp(`\\b(${names.join("|")})\\s*\\(`, "g");
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
