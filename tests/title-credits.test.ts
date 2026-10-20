import { expect, test } from "bun:test";
import { LANDSCAPES } from "../src/system/landscapes";
import { CREDITS, creditsMarkdown, whoOf } from "../src/ui/title/credits";

// The credits (PLAN-TITRE-AAA E7): one source for the screen and CREDITS.md. Each entry taken from an asset's README
// says what that README says (its author, its licence); CREDITS.md is the one the script writes; every entry has its
// French and English; the landscapes' photographers all there.

test("each credit taken from an asset's README: its author and its licence are in it", async () => {
  const checked: string[] = [];
  for (const s of CREDITS)
    for (const c of s.items) {
      if (!c.readme) continue;
      const text = await Bun.file(c.readme).text();
      // (the authors' first part: before a bracket, a list, a dash, a slash)
      const who = whoOf(c, "en")
        .split(/ \(| ·| —| \/|, /)[0]!
        .trim();
      expect(`${c.readme}: ${text.includes(who) ? who : `missing "${who}"`}`).toBe(`${c.readme}: ${who}`);
      for (const w of (c.licence ?? "").split(" ").filter(Boolean))
        expect(`${c.readme}: ${text.includes(w) ? w : `missing "${w}"`}`).toBe(`${c.readme}: ${w}`);
      checked.push(c.readme);
    }
  // (every README of a model or of the sky's and the worlds' data cited)
  for (const r of ["ranger", "lander", "endurance", "f35", "character", "iss", "sky", "earth", "earth-surface", "planets-hd"])
    expect(checked).toContain(`assets/${r}/README.md`);
});

test("CREDITS.md is the one bun scripts/build-credits.ts writes", async () => {
  expect(await Bun.file("CREDITS.md").text()).toBe(creditsMarkdown("en"));
});

test("every entry in French and English; the game by SamLePirate first; every photographer", () => {
  expect(CREDITS[0]!.items[0]!.who).toBe("SamLePirate");
  for (const s of CREDITS) {
    expect(s.title.fr && s.title.en).toBeTruthy();
    expect(s.items.length).toBeGreaterThan(0);
    for (const c of s.items) {
      expect(c.what.fr && c.what.en).toBeTruthy();
      expect(whoOf(c, "fr").length && whoOf(c, "en").length).toBeTruthy();
    }
  }
  const photos = CREDITS.find((s) => s.id === "photos")!.items;
  expect(photos.map((c) => c.who).sort()).toEqual(LANDSCAPES.map((l) => l.photo.author).sort());
  expect(new Set(CREDITS.map((s) => s.id)).size).toBe(CREDITS.length);
});
