import { expect, test } from "bun:test";
import { defaultSettings, SETTING_KIND, type Settings } from "../src/settings";
import { type ControlDef, SCHEMA } from "../src/ui/schema";

// Every setting's contract held statically (audit 2026-11-10, AR-21, wave 4.3): each control of the schema has its default, a
// number's within its range, a choice's among its options, a toggle's a boolean, a colour's #rrggbb; every setting has its kind
// (pref / scene / carried — SETTING_KIND, what a save and the preferences keep). Their French is i18n.test.ts's. On 13 Nov 2026:
// 372 controls, 388 settings, none out.

/** what is wrong with a control's default (empty: nothing) */
export function defaultFaults(schema: ControlDef[], d: Record<string, unknown>): string[] {
  const bad: string[] = [];
  for (const c of schema) {
    const v = d[c.key];
    if (!(c.key in d)) bad.push(`${c.key}: no default`);
    else if (c.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) bad.push(`${c.key}: a number's default ${String(v)}`);
      else if (v < c.min || v > c.max) bad.push(`${c.key}: default ${v} outside [${c.min}, ${c.max}]`);
    } else if (c.type === "choice") {
      if (!c.options.some((o) => o.value === v)) bad.push(`${c.key}: default ${JSON.stringify(v)} not among its options`);
    } else if (c.type === "toggle") {
      if (typeof v !== "boolean") bad.push(`${c.key}: a toggle's default ${String(v)}`);
    } else if (c.type === "color" && (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v)))
      bad.push(`${c.key}: a colour's default ${String(v)}`);
  }
  return bad;
}

test("every control's default within its range, among its options, of its type", () => {
  expect(defaultFaults(SCHEMA, defaultSettings() as unknown as Record<string, unknown>)).toEqual([]);
});

test("the check sees a default out (its witness): a number past its range, a choice not offered", () => {
  const d = defaultSettings() as unknown as Record<string, unknown>;
  const num = SCHEMA.find((c) => c.type === "number")!;
  const ch = SCHEMA.find((c) => c.type === "choice")!;
  d[num.key] = num.type === "number" ? num.max + 1 : 0;
  d[ch.key] = "no such option";
  expect(defaultFaults(SCHEMA, d).length).toBe(2);
});

test("every setting has its kind (pref, scene or carried)", () => {
  const keys = Object.keys(defaultSettings()) as (keyof Settings)[];
  expect(keys.filter((k) => !(k in SETTING_KIND))).toEqual([]);
});
