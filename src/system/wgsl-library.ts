// The tracer's WGSL as the ground's library (docs/PLAN-J1-OPAQUE-FORWARD.md J1-3): a shader beside the tracer — the relief
// cache's bake, the raster's passes, and the forward ground fragment of J1-4 — takes the functions it needs from the tracer's own
// composed source, never a second copy: the closure of some roots (the functions they reach, the module-scope constants, overrides
// and private variables those read, the structures they name) and the list of the tracer's resources (its bound buffers, textures,
// samplers) that closure reads — which the shader declares at its own group and bindings. Pure text: no GPU.

import { wgslFunction } from "./warp-grid";

export interface WgslClosure {
  /** the functions reached, in the order they were found (a root first, then its callees depth-first) */
  functions: Map<string, string>;
  /** the module-scope `const`, `override` and `var<private>` declarations they read, in the order found */
  declarations: Map<string, string>;
  /** the structures named by the functions or declarations (Params aside: the caller places it) */
  structs: Map<string, string>;
  /** the tracer's bound resources the closure reads (`@group(g) @binding(b) var … name`), name → its declaration */
  resources: Map<string, string>;
}

/** every `fn` of a module, name → its text */
export function wgslFunctions(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name] of src.matchAll(/^fn (\w+)\(/gm)) out.set(name!, wgslFunction(src, name!));
  return out;
}

/** a `struct Name { … }` of a module (with its `;` if it has one), or null */
export function wgslStruct(src: string, name: string): string | null {
  const at = src.search(new RegExp(`^struct ${name}\\s*\\{`, "m"));
  if (at < 0) return null;
  let i = src.indexOf("{", at);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(at, src[i + 1] === ";" ? i + 2 : i + 1);
}

/**
 * The closure of `roots` in `src`. `replace`: functions given in place of the source's (or added); `stop`: names never taken
 * (`cost`, the tracer's counters — the caller declares an empty one).
 */
export function wgslClosure(
  src: string,
  roots: string[],
  replace: Map<string, string> = new Map(),
  stop: ReadonlySet<string> = new Set(["cost"]),
): WgslClosure {
  const all = wgslFunctions(src);
  for (const [n, body] of replace) all.set(n, body);
  const functions = new Map<string, string>();
  const add = (name: string) => {
    if (stop.has(name) || functions.has(name)) return;
    const body = all.get(name);
    if (!body) throw new Error(`wgsl-library: missing ${name}`);
    functions.set(name, body);
    for (const [, callee] of body.matchAll(/\b(\w+)\s*\(/g)) if (all.has(callee!)) add(callee!);
  };
  for (const r of roots) add(r);
  // (the module-scope values they read, to a fixed point — one may name another)
  const candidates = new Map<string, string>();
  for (const [line, name] of src.matchAll(/^(?:const|override|var<private>)\s+(\w+)\b[^;]*;/gm)) candidates.set(name!, line!);
  const declarations = new Map<string, string>();
  let text = [...functions.values()].join("\n");
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, declaration] of candidates) {
      if (!declarations.has(name) && new RegExp(`\\b${name}\\b`).test(text)) {
        declarations.set(name, declaration);
        text += `\n${declaration}`;
        grew = true;
      }
    }
  }
  // (the structures named — and those their fields name)
  const structs = new Map<string, string>();
  const structNames = [...src.matchAll(/^struct (\w+)\s*\{/gm)].map((m) => m[1]!).filter((n) => n !== "Params");
  grew = true;
  while (grew) {
    grew = false;
    for (const name of structNames) {
      if (structs.has(name) || !new RegExp(`\\b${name}\\b`).test(text)) continue;
      const s = wgslStruct(src, name);
      if (!s) continue;
      structs.set(name, s);
      text += `\n${s}`;
      grew = true;
    }
  }
  const resources = new Map<string, string>();
  for (const [line, name] of src.matchAll(/^@group\(\d+\)\s*@binding\(\d+\)\s*var(?:<[^>]*>)?\s+(\w+)\s*:[^;]*;/gm))
    if (new RegExp(`\\b${name}\\b`).test(text)) resources.set(name!, line!);
  return { functions, declarations, structs, resources };
}

/**
 * A stand-alone module of the closure of `roots` (the tracer's Params, the structures, values and resources they read — the
 * resources at the tracer's own group and bindings —, an empty `cost`) and `tail` (the caller's entry points). What J1-4's forward
 * ground fragment starts from; check-wgsl compiles the ground's families this way.
 */
export function wgslLibraryModule(src: string, roots: string[], tail: string): string {
  const c = wgslClosure(src, roots);
  const params = wgslStruct(src, "Params");
  if (!params) throw new Error("wgsl-library: missing Params");
  return [
    params,
    ...c.structs.values(),
    ...c.declarations.values(),
    ...c.resources.values(),
    "fn cost(k: u32) {}",
    ...c.functions.values(),
    tail,
  ].join("\n");
}
