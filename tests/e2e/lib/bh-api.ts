// The automation handle's shape, read live from a page: every member of globalThis.__bh (src/automation.ts)
// and of its namespaces, with its kind — what docs/BH-API.md must cover (tests/e2e/bh-api.e2e.test.ts checks
// it; scripts/bh-api.ts prints it). Read from the running app, not the source: members are added in several
// places (automation.ts, main.ts's context, the game's tools) and a production bundle's names are minified,
// so only the keys and the kinds are trusted here — the meanings come from the source's comments.

export interface BhMember {
  /** e.g. "__bh.game.status" */
  path: string;
  kind: "function" | "object" | "array" | "class-instance" | "string" | "number" | "boolean" | "null" | "undefined" | "other";
  /** a function's declared parameter count (Function.length: defaults and rest not counted) */
  arity?: number;
  /** an object's or instance's member count (not walked further when it is not a namespace) */
  size?: number;
  /** a class instance's constructor name (minified in production: a hint only) */
  ctor?: string;
}

/**
 * The namespaces whose every member docs/BH-API.md documents one by one — small, hand-made API objects.
 * The big live objects (settings, camera, renderer, sim, fleet, tars, …) are documented by their main
 * members only: their own schemas and classes are their reference.
 */
export const NAMESPACES = ["game", "bench", "iss", "sky", "gpu", "hud", "sys", "pwa", "tarsVoice", "tars"] as const;

/** Page code: the members of __bh (top level, then the namespaces' own), as a JSON-able list. */
export const WALK = `(() => {
  const NS = ${JSON.stringify(NAMESPACES)};
  const kindOf = (v) => {
    if (v === null) return { kind: "null" };
    if (Array.isArray(v)) return { kind: "array", size: v.length };
    const t = typeof v;
    if (t === "function") return { kind: "function", arity: v.length };
    if (t === "string" || t === "number" || t === "boolean" || t === "undefined") return { kind: t };
    if (t !== "object") return { kind: "other" };
    const proto = Object.getPrototypeOf(v);
    const plain = proto === Object.prototype || proto === null;
    return plain
      ? { kind: "object", size: Object.keys(v).length }
      : { kind: "class-instance", size: keysOf(v).length, ctor: v.constructor?.name };
  };
  // (an instance's own fields and its classes' methods, getters included — not Object's)
  const keysOf = (o) => {
    const out = new Set(Object.keys(o));
    for (let p = Object.getPrototypeOf(o); p && p !== Object.prototype; p = Object.getPrototypeOf(p))
      for (const k of Object.getOwnPropertyNames(p)) if (k !== "constructor") out.add(k);
    return [...out];
  };
  const read = (o, k) => { try { return o[k]; } catch { return undefined; } };
  const out = [];
  for (const k of Object.keys(__bh).sort()) {
    const v = read(__bh, k);
    out.push({ path: "__bh." + k, ...kindOf(v) });
    if (NS.includes(k) && v && typeof v === "object")
      for (const m of keysOf(v).sort()) if (!m.startsWith("_")) out.push({ path: "__bh." + k + "." + m, ...kindOf(read(v, m)) });
  }
  return out;
})()`;

/**
 * The members docs/BH-API.md leaves out: a member counts as documented when a heading or a table row of it
 * starts with its full path in backquotes — `### \`__bh.game.status(…)\`` or `| \`__bh.gpu.lost\` |` — so a
 * mention in passing, or a list of names, does not count: each has its own entry.
 */
export function undocumented(members: BhMember[], doc: string): string[] {
  return members.map((m) => m.path).filter((p) => !new RegExp(`^(#{2,4} |\\| )\`${p.replace(/[.$]/g, "\\$&")}(?![\\w$])`, "m").test(doc));
}
