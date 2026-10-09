// The settings for TARS (PLAN-TARS-AGENT A2): every setting of the panel's schema found by words — English or
// French, its name, group, keywords, help — and a value checked against it before it is set: a number in
// its range, a toggle true or false, a choice among its options (by value or label), a colour "#rrggbb".
// A setting outside the schema (internal) keeps the type of its current value.

import { FRENCH } from "../i18n";
import type { Settings } from "../settings";
import { SCHEMA, SCHEMA_BY_KEY, type ControlDef } from "../ui/schema";

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** a setting's words: its key, name, group, keywords, help, in English and French */
function words(d: ControlDef): string {
  const fr = (en?: string) => (en ? (FRENCH.get(en) ?? "") : "");
  return fold([d.key, d.label, fr(d.label), d.group, fr(d.group), d.keywords ?? "", d.help ?? "", fr(d.help)].join(" "));
}
const WORDS = new Map<string, string>();
const wordsOf = (d: ControlDef) => {
  let w = WORDS.get(d.key);
  if (w === undefined) WORDS.set(d.key, (w = words(d)));
  return w;
};

/** What the model is told of a setting: its key, name, type, value, range or options. */
export function describe(d: ControlDef, s: Settings) {
  const base = { key: d.key, label: d.label, group: d.group, value: s[d.key] as unknown };
  switch (d.type) {
    case "number":
      return { ...base, type: "number", min: d.min, max: d.max, ...(d.unit ? { unit: d.unit } : {}) };
    case "toggle":
      return { ...base, type: "boolean" };
    case "choice":
      return { ...base, type: "choice", options: d.options.map((o) => ({ value: o.value, label: o.label })) };
    case "color":
      return { ...base, type: "color #rrggbb" };
  }
}

/** The settings matching words (each word counted where it appears; the name and key weigh more). */
export function findSettings(query: string, s: Settings, max = 10) {
  const q = fold(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
  if (!q.length) return [];
  const scored = SCHEMA.map((d) => {
    const all = wordsOf(d);
    const head = fold(`${d.key} ${d.label} ${FRENCH.get(d.label) ?? ""}`);
    let n = 0;
    for (const w of q) {
      if (head.includes(w)) n += 3;
      else if (all.includes(w)) n += 1;
    }
    return { d, n };
  })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, max);
  return scored.map((x) => describe(x.d, s));
}

/** A value checked for a setting: the value to set, or what is wrong. */
export function checkSetting(key: string, value: unknown, s: Settings): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!(key in s)) return { ok: false, error: `no setting "${key}" — find_settings finds them by words` };
  const d = SCHEMA_BY_KEY.get(key as keyof Settings);
  if (!d) {
    const cur = s[key as keyof Settings];
    return typeof value === typeof cur ? { ok: true, value } : { ok: false, error: `${key} is a ${typeof cur}` };
  }
  switch (d.type) {
    case "number": {
      const v = typeof value === "string" ? Number(value) : value;
      if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, error: `${key} is a number (${d.min} … ${d.max})` };
      if (v < d.min || v > d.max)
        return { ok: false, error: `${key} must be within ${d.min} … ${d.max}${d.unit ? ` ${d.unit}` : ""} (got ${v})` };
      return { ok: true, value: v };
    }
    case "toggle": {
      if (typeof value === "boolean") return { ok: true, value };
      const v = typeof value === "string" ? fold(value) : "";
      if (["true", "on", "yes", "oui"].includes(v)) return { ok: true, value: true };
      if (["false", "off", "no", "non"].includes(v)) return { ok: true, value: false };
      return { ok: false, error: `${key} is true or false` };
    }
    case "choice": {
      const o =
        d.options.find((x) => x.value === value || String(x.value) === String(value)) ??
        d.options.find(
          (x) => typeof value === "string" && (fold(x.label) === fold(value) || fold(FRENCH.get(x.label) ?? "") === fold(value)),
        );
      if (!o) return { ok: false, error: `${key} must be one of ${d.options.map((x) => JSON.stringify(x.value)).join(", ")}` };
      return { ok: true, value: o.value };
    }
    case "color":
      return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
        ? { ok: true, value: value.toLowerCase() }
        : { ok: false, error: `${key} is a colour "#rrggbb"` };
  }
}
