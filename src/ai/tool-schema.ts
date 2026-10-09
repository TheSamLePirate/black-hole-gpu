// TARS's tools (PLAN-TARS-AGENT): how a tool is described to the model — a name, what it does, its
// arguments as a small JSON-schema subset (string with its allowed values, number with its range, boolean,
// object, array) — and the arguments the model sent checked against it before anything runs: a number in
// its range, a value among the allowed ones, nothing unknown, nothing required missing. A wrong call
// is answered with what was wrong, so the model corrects itself; it never reaches the game.

export type Param =
  | { type: "string"; description?: string; enum?: readonly string[] }
  | { type: "number"; description?: string; minimum?: number; maximum?: number; integer?: boolean }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: Param; maxItems?: number }
  | { type: "object"; description?: string; properties: Record<string, Param>; required?: readonly string[] };

export type Args = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  /** what it does, for the model (English) */
  description: string;
  /** its arguments (none: an empty object) */
  params?: Record<string, Param>;
  required?: readonly string[];
}

/** A tool as the chat completions' `tools` want it (OpenAI's function format). */
export function toFunction(t: ToolSpec) {
  return {
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: { type: "object", properties: t.params ?? {}, required: [...(t.required ?? [])], additionalProperties: false },
    },
  };
}

/** What is wrong with a value against its parameter (null: right). `at` names it in the message. */
function wrong(p: Param, v: unknown, at: string): string | null {
  switch (p.type) {
    case "string":
      if (typeof v !== "string") return `${at} must be a string`;
      if (p.enum && !p.enum.includes(v)) return `${at} must be one of ${p.enum.join(", ")} (got "${v}")`;
      return null;
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) return `${at} must be a finite number`;
      if (p.integer && !Number.isInteger(v)) return `${at} must be an integer`;
      if (p.minimum !== undefined && v < p.minimum) return `${at} must be ≥ ${p.minimum} (got ${v})`;
      if (p.maximum !== undefined && v > p.maximum) return `${at} must be ≤ ${p.maximum} (got ${v})`;
      return null;
    case "boolean":
      return typeof v === "boolean" ? null : `${at} must be true or false`;
    case "array": {
      if (!Array.isArray(v)) return `${at} must be an array`;
      if (p.maxItems !== undefined && v.length > p.maxItems) return `${at} has at most ${p.maxItems} items`;
      for (let i = 0; i < v.length; i++) {
        const w = wrong(p.items, v[i], `${at}[${i}]`);
        if (w) return w;
      }
      return null;
    }
    case "object":
      if (typeof v !== "object" || v === null || Array.isArray(v)) return `${at} must be an object`;
      return wrongObject(p.properties, p.required ?? [], v as Args, `${at}.`);
  }
}

function wrongObject(props: Record<string, Param>, required: readonly string[], a: Args, prefix: string): string | null {
  for (const k of Object.keys(a))
    if (!(k in props)) return `unknown argument ${prefix}${k} (known: ${Object.keys(props).join(", ") || "none"})`;
  for (const k of required) if (a[k] === undefined || a[k] === null) return `missing argument ${prefix}${k}`;
  for (const [k, p] of Object.entries(props)) {
    if (a[k] === undefined || a[k] === null) continue;
    const w = wrong(p, a[k], prefix + k);
    if (w) return w;
  }
  return null;
}

/** The arguments of a call, parsed (the model sends a JSON string) and checked: the arguments, or why not. */
export function checkArgs(t: ToolSpec, raw: unknown): { ok: true; args: Args } | { ok: false; error: string } {
  let a: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) a = {};
    else
      try {
        a = JSON.parse(raw);
      } catch {
        return { ok: false, error: `arguments are not valid JSON: ${raw.slice(0, 120)}` };
      }
  }
  if (a === undefined || a === null) a = {};
  if (typeof a !== "object" || Array.isArray(a)) return { ok: false, error: "arguments must be a JSON object" };
  // (a null the model sent for an optional argument: left out)
  const args = Object.fromEntries(Object.entries(a as Args).filter(([, v]) => v !== null));
  const w = wrongObject(t.params ?? {}, t.required ?? [], args, "");
  return w ? { ok: false, error: w } : { ok: true, args };
}
