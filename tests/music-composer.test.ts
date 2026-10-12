import { describe, expect, test } from "bun:test";
import { barEnergy, composeBar, leadMotif, placeInForm } from "../src/audio/music/composer";
import { LAYERS, THEMES } from "../src/audio/music/themes";
import { chordOn, inScale, voiceLead } from "../src/audio/music/theory";

describe("the theory", () => {
  test("chords diatonic, voices led by steps", () => {
    // (A minor: i = A C E, VI = F A C)
    expect(chordOn(57, "minor", 0)).toEqual([57, 60, 64]);
    expect(chordOn(57, "minor", 5)).toEqual([65, 69, 72]);
    const a = voiceLead(null, chordOn(57, "minor", 0));
    const b = voiceLead(a, chordOn(57, "minor", 5));
    const move = b.reduce((s, n, i) => s + Math.abs(n - (a[i] ?? n)), 0);
    expect(move).toBeLessThanOrEqual(6);
  });
});

describe("the themes", () => {
  test("at least ten, each with its own id, a form, a progression", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    for (const t of THEMES) {
      expect(t.form.length).toBeGreaterThan(1);
      expect(t.progressions.a!.length).toBeGreaterThan(0);
      expect(t.bpm).toBeGreaterThan(40);
      expect(t.loopFrom).toBeLessThan(t.form.length);
    }
  });

  for (const theme of THEMES)
    test(`${theme.name}: 96 bars at three intensities — every note in time, in range, the melodic ones in the mode`, () => {
      let prev: number[] | null = null;
      const seen = new Set<string>();
      for (const intensity of [0.15, 0.5, 1])
        for (let bar = 0; bar < 96; bar++) {
          const p = composeBar(theme, bar, intensity, 0, prev);
          prev = p.chord;
          for (const e of p.events) {
            seen.add(e.layer);
            expect(e.beat).toBeGreaterThanOrEqual(0);
            expect(e.beat).toBeLessThan(4);
            expect(e.dur).toBeGreaterThan(0);
            expect(e.vel).toBeGreaterThan(0);
            expect(e.vel).toBeLessThanOrEqual(1.2);
            if (e.layer !== "drums") {
              expect(e.note).toBeGreaterThanOrEqual(21);
              expect(e.note).toBeLessThanOrEqual(108);
              expect(inScale(theme.root, theme.scale, e.note)).toBe(true);
            }
          }
          // (sorted in time: the engine schedules them in order)
          for (let i = 1; i < p.events.length; i++) expect(p.events[i]!.beat).toBeGreaterThanOrEqual(p.events[i - 1]!.beat);
        }
      // (its band all heard at some point)
      if (theme.drums && theme.drums !== "booms") expect(seen.has("drums")).toBe(true);
      if (theme.bass) expect(seen.has("bass")).toBe(true);
      if (theme.lead) expect(seen.has("lead")).toBe(true);
      if (theme.guitar) expect(seen.has("guitar")).toBe(true);
      for (const l of seen) expect(LAYERS as string[]).toContain(l);
    });
});

describe("the form and the energy", () => {
  const t = THEMES.find((x) => x.id === "ascent")!;
  test("the form played through, then looped from the verse — the intro not again", () => {
    const total = t.form.reduce((a, s) => a + s.bars, 0);
    expect(placeInForm(t, 0).section.name).toBe("intro");
    expect(placeInForm(t, total).section.name).toBe(t.form[t.loopFrom]!.name);
    expect(placeInForm(t, total).inSection).toBe(0);
  });
  test("the flight's intensity raises and lowers the energy, 0.5 about as written", () => {
    const s = t.form[1]!;
    expect(barEnergy(s, 0.5)).toBeCloseTo(s.energy, 6);
    expect(barEnergy(s, 1)).toBeGreaterThan(barEnergy(s, 0.5));
    expect(barEnergy(s, 0)).toBeLessThan(barEnergy(s, 0.5));
  });
  test("the band builds with the energy: sparse when quiet, full in a drop", () => {
    const count = (i: number, bar: number) => composeBar(t, bar, i).events.length;
    // (the drop starts after intro 8 + verse 16 + build 8)
    expect(count(1, 33)).toBeGreaterThan(3 * count(0, 2));
    const layers = new Set(composeBar(t, 33, 1).events.map((e) => e.layer));
    for (const l of ["drums", "bass", "arp", "lead"] as const) expect(layers.has(l)).toBe(true);
    const quiet = new Set(composeBar(t, 2, 0).events.map((e) => e.layer));
    expect(quiet.has("drums")).toBe(false);
  });
  test("a fill before a stronger section, a riser at a build's end, a crash and a boom at the drop", () => {
    const verseEnd = composeBar(t, 8 + 16 - 1, 0.8).events;
    expect(verseEnd.filter((e) => e.inst === "snare" && e.beat >= 2).length).toBeGreaterThan(3);
    expect(composeBar(t, 8 + 16 + 8 - 2, 0.8).events.some((e) => e.inst === "riser")).toBe(true);
    const drop = composeBar(t, 32, 0.8).events;
    expect(drop.some((e) => e.inst === "crash")).toBe(true);
    expect(drop.some((e) => e.inst === "boom")).toBe(true);
  });
  test("deterministic; another variation, another melody", () => {
    expect(composeBar(t, 40, 0.9, 3)).toEqual(composeBar(t, 40, 0.9, 3));
    expect(leadMotif(t, 1)).not.toEqual(leadMotif(t, 2));
  });
});

describe("the panel's chord names", () => {
  test("from the root, whatever the inversion", async () => {
    const { chordName } = await import("../src/ui/musicpanel");
    expect(chordName([57, 60, 64])).toBe("Am");
    expect(chordName([60, 64, 69], 57)).toBe("Am");
    expect(chordName([62, 66, 69])).toBe("D");
    expect(chordName([57, 60, 64, 71], 57)).toBe("Amadd9".replace("madd9", "madd9"));
    expect(chordName([55, 57, 62])).toBe("Gsus2");
    expect(chordName([55, 59, 62, 65])).toBe("G7");
  });
});
