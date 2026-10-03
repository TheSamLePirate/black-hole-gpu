// The French dictionary covers the interface: every English text drawn from the data (the settings,
// the scenes, the keyboard sheet) and every literal t("…") / tf("…") of the source has its French,
// with the same {n} values.

import { expect, test } from "bun:test";
import { shadowedCalls } from "../scripts/check-i18n-calls";
import { dataStrings, sourceStrings } from "../scripts/i18n-strings";
import { FRENCH } from "../src/i18n";

test("every interface text has its French", async () => {
  const all = new Set([...dataStrings(), ...(await sourceStrings())]);
  const missing = [...all].filter((en) => !FRENCH.has(en));
  expect(missing).toEqual([]);
});

test("a translation keeps the values ({0}, {1}…) of its English", () => {
  const holes = (s: string) => [...s.matchAll(/\{\d\}/g)].map((m) => m[0]).sort();
  const wrong = [...FRENCH].filter(([en, fr]) => holes(en).join() !== holes(fr).join() || !fr.trim());
  expect(wrong).toEqual([]);
});

test("the dictionaries agree where they share an English text", async () => {
  const seen = new Map<string, string>();
  const clash: string[] = [];
  for await (const f of new Bun.Glob("src/i18n/fr-*.ts").scan(".")) {
    const d: Record<string, string> = (await import(`../${f}`)).default;
    for (const [en, fr] of Object.entries(d)) {
      if (seen.has(en) && seen.get(en) !== fr) clash.push(`${en}: ${seen.get(en)} / ${fr}`);
      seen.set(en, fr);
    }
  }
  expect(clash).toEqual([]);
});

test("every t() / tf() / tr() call reaches the i18n module's (no local t hiding it)", () => {
  expect(shadowedCalls()).toEqual([]);
}, 30_000);
