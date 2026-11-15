// The Labo panel's decisions that touch no page (audit 2026-11-10, QA-10: src/ui/panel.ts — 1 190 lines — never imported by a test):
// the settings off their defaults (a preset's content), a settings object imported onto them (unknown keys and wrong types left out),
// the quality the settings still are, a setting found by its words in either language, an undo's name. Moved out of panel.ts as they
// were; tested in tests/panel-pure.test.ts.

import { t, tf } from "../i18n";
import { QUALITY, type Quality, type Settings } from "../settings";
import { type ControlDef, SCHEMA_BY_KEY } from "./schema";
import { sameValue } from "./settings/values";

type Key = keyof Settings;
export type Diff = { key: Key; before: unknown; after: unknown }[];

/** The settings off their defaults (the screen's pixel ratio left out: the machine's, not a choice). */
export function diffFromDefaults(s: Settings, d: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(s) as Key[]) {
    if (k === "pixelRatio") continue;
    if (!sameValue(s[k], d[k])) out[k] = s[k];
  }
  return out as Partial<Settings>;
}

/**
 * A (partial) settings object put on the defaults (`fromDefaults`) or on the current settings: what the result would be — its keys
 * unknown to the defaults left out, a value of another type than the default's left out (the subsampling: "auto" or a number).
 */
export function mergedSettings(obj: Partial<Settings>, d: Settings, s: Settings, fromDefaults: boolean): Record<string, unknown> {
  const target: Record<string, unknown> = fromDefaults ? { ...d, pixelRatio: s.pixelRatio } : { ...s };
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in d)) continue;
    const dv = (d as unknown as Record<string, unknown>)[k];
    if (k === "realtimeSubsampling" ? v === "auto" || typeof v === "number" : typeof v === typeof dv) target[k] = v;
  }
  return target;
}

/** The quality the settings still are: their chosen quality's every value held, else null (a setting moved off it). */
export function matchingQuality(s: Settings): Quality | null {
  const q = s.quality;
  const ref = QUALITY[q];
  if (!ref) return null;
  return (Object.keys(ref) as (keyof typeof ref)[]).every((k) => sameValue(ref[k], s[k])) ? q : null;
}

/** A setting found by the words searched (each one somewhere in its label, group, section, help, keywords or key, in either language). */
export function matchesControl(d: ControlDef, q: string): boolean {
  const hay =
    `${d.label} ${d.group} ${d.section} ${d.help ?? ""} ${d.keywords ?? ""} ${String(d.key)} ${t(d.label)} ${t(d.group)} ${t(d.help ?? "")}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** An undo's name: the one setting's label, else how many. */
export function describeDiff(d: Diff): string {
  if (d.length === 1) return t(SCHEMA_BY_KEY.get(d[0]!.key)?.label ?? String(d[0]!.key));
  return tf("{0} settings", d.length);
}
