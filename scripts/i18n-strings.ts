// The English strings the French dictionary must cover: the settings' schema, the sections, the
// scenes, the keyboard sheet, and every literal t("…") / tf("…") in the source. Prints JSON; the
// unit test (tests/i18n.test.ts) checks the same list against the dictionary.

import { SCHEMA, SECTIONS, SCENE_GROUPS, PRESET_INFO } from "../src/ui/schema";
import { KEYMAP } from "../src/input/keymap";

export function dataStrings(): Set<string> {
  const out = new Set<string>();
  const add = (s?: string) => {
    if (s && /[A-Za-z]{2}/.test(s)) out.add(s);
  };
  for (const s of SECTIONS) add(s.label);
  for (const d of SCHEMA) {
    add(d.label);
    add(d.help);
    add(d.group);
    if (d.type === "number") add(d.unit);
    if (d.type === "choice") for (const o of d.options) add(o.label), add(o.hint);
  }
  for (const g of SCENE_GROUPS) add(g.label), add(g.hint);
  for (const i of Object.values(PRESET_INFO)) add(i.title), add(i.description);
  for (const sec of KEYMAP) {
    add(sec.title);
    for (const r of sec.rows) add(r.keys), add(r.text);
  }
  return out;
}

export async function sourceStrings(): Promise<Set<string>> {
  const out = new Set<string>();
  for await (const f of new Bun.Glob("src/**/*.ts").scan(".")) {
    const src = await Bun.file(f).text();
    for (const m of src.matchAll(/\btf?\(\s*"((?:[^"\\]|\\.)*)"/g)) if (/[A-Za-z]{2}/.test(m[1]!)) out.add(JSON.parse(`"${m[1]}"`));
  }
  return out;
}

if (import.meta.main) {
  const all = new Set([...dataStrings(), ...(await sourceStrings())]);
  console.log(JSON.stringify([...all], null, 1));
}
