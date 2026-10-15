import { expect, test } from "bun:test";
import { KNOWLEDGE_PAGES, readKnowledge, searchKnowledge } from "../src/ai/knowledge";

// PLAN-AVIATION-AAA I1: TARS's aviation knowledge — eleven pages in English and in French, their sections parallel;
// a question finds the section that answers it, in its language (the accents, the case, a word's ending aside); a
// page read whole or by one section.

test("eleven pages in each language, their sections the same", () => {
  expect(KNOWLEDGE_PAGES.length).toBe(11);
  for (const p of KNOWLEDGE_PAGES) {
    const en = readKnowledge(p, "en")!;
    const fr = readKnowledge(p, "fr")!;
    expect(en.length).toBeGreaterThan(600);
    expect(fr.length).toBeGreaterThan(600);
    const n = (s: string) => s.split(/^## /m).length;
    expect(n(fr)).toBe(n(en));
  }
});

test("a question finds the section that answers it, in its language", () => {
  const top = (q: string, l: "en" | "fr") => searchKnowledge(q, l, 1)[0]?.title ?? "";
  expect(top("ILS minimums decision height", "en")).toBe("The ILS approach — The procedure in the game");
  expect(top("vitesse d'approche porte-avions brin", "fr")).toBe("Le porte-avions — Le F-35C sur les brins");
  expect(top("missile defence flares", "en")).toMatch(/defence/i);
  expect(top("corner speed", "en")).toBe("Energy — The corner speed");
  expect(top("comment rejoindre le leader", "fr")).toMatch(/Rejoindre/);
  expect(top("appontage cas III marshal", "fr")).toMatch(/cas de récupération/);
  expect(top("Auto-GCAS", "en")).toMatch(/F-35|Emergencies/);
  // (a word's ending aside: "missiles" finds "missile")
  expect(searchKnowledge("missiles", "en").length).toBeGreaterThan(0);
  expect(searchKnowledge("zzzz", "en")).toEqual([]);
  // (one section read by a word of its title)
  expect(readKnowledge("ils", "fr", "procédure")).toMatch(/^## L'approche ILS — La procédure dans le jeu\n1\. Le point/);
});
