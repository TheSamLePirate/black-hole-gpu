// A measure for drawing the HUD in a worker (docs/progress/j0/FICHE-CPU-kerr-mini-2026-11-14.md): what in the HUD's frame data a
// structuredClone would refuse or change — functions, the page's elements, class instances (their methods lost) —, by path. Off unless
// globalThis.__hudCloneProbe is a Set (the e2e sets it); flighthud.ts calls it once a frame then.

const CLONABLE = new Set<unknown>([
  Object.prototype,
  Array.prototype,
  Map.prototype,
  Set.prototype,
  Date.prototype,
  RegExp.prototype,
  ArrayBuffer.prototype,
  Float32Array.prototype,
  Float64Array.prototype,
  Int32Array.prototype,
  Uint32Array.prototype,
  Uint8Array.prototype,
  Uint8ClampedArray.prototype,
  Int16Array.prototype,
  Uint16Array.prototype,
  Int8Array.prototype,
  null,
]);

/** Adds to `out` the paths (a[0].b…, array indices folded to []) of what would not survive a structuredClone. */
export function noteUnclonable(v: unknown, out: Set<string>, path = "", seen = new Set<unknown>(), depth = 0) {
  if (v === null || v === undefined || depth > 10) return;
  const t = typeof v;
  if (t === "function") {
    out.add(`${path} (function)`);
    return;
  }
  if (t !== "object") return;
  if (seen.has(v)) return;
  seen.add(v);
  if (typeof Node !== "undefined" && v instanceof Node) {
    out.add(`${path} (element)`);
    return;
  }
  const proto = Object.getPrototypeOf(v);
  if (!CLONABLE.has(proto)) out.add(`${path} (class ${proto?.constructor?.name ?? "?"})`);
  if (ArrayBuffer.isView(v)) return;
  if (Array.isArray(v)) {
    for (const x of v) noteUnclonable(x, out, `${path}[]`, seen, depth + 1);
    return;
  }
  if (v instanceof Map) {
    for (const x of v.values()) noteUnclonable(x, out, `${path}{}`, seen, depth + 1);
    return;
  }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) noteUnclonable(x, out, path ? `${path}.${k}` : k, seen, depth + 1);
}
