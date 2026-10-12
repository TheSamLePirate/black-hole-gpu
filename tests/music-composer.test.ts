// The orchestral score (audio/music/*): the themes in Hans Zimmer's, John Williams's and Max Richter's manners,
// their melodies fitted to their chords, the composer's orchestra bar by bar.
import { describe, expect, test } from "bun:test";
import { barEnergy, chordStepOf, composeBar, melodyIn, placeInForm, progressionOf } from "../src/audio/music/composer";
import { INSTRUMENTS } from "../src/audio/music/instruments";
import { LAYERS, parsePhrase, THEMES } from "../src/audio/music/themes";
import { chordOn, degreeNote, inScale, voiceLead } from "../src/audio/music/theory";

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
  test("twelve, their own ids, in the three manners, each with a form, a progression and a melody", () => {
    expect(THEMES.length).toBe(12);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    const manners = new Set(THEMES.map((t) => t.manner));
    expect([...manners].sort()).toEqual(["richter", "williams", "zimmer"]);
    for (const t of THEMES) {
      expect(t.form.length).toBeGreaterThan(1);
      expect(t.progressions.a!.length).toBeGreaterThan(0);
      expect(t.bpm).toBeGreaterThan(40);
      expect(t.loopFrom).toBeLessThan(t.form.length);
      expect(t.melody).not.toBeNull();
    }
  });

  for (const theme of THEMES)
    test(`${theme.name}: each phrase whole bars, fitted to its progression — its notes on the strong beats the chord's`, () => {
      for (const [key, phrase] of Object.entries(theme.melody!.phrases)) {
        const { notes, beats } = parsePhrase(phrase);
        expect(beats % 4).toBe(0);
        const prog = theme.progressions[key] ?? theme.progressions.a!;
        const progBars = prog.reduce((a, s) => a + (s.bars ?? 1), 0);
        expect((beats / 4) % progBars === 0 || progBars % (beats / 4) === 0).toBe(true);
        // (on the bar's first and third beats: a tone of the bar's chord, its ninth or its suspension allowed)
        let on = 0,
          strong = 0;
        for (const n of notes) {
          if (n.deg === null || n.at % 2 !== 0) continue;
          const bar = Math.floor(n.at / 4);
          const section = theme.form.find((s) => progressionOf(theme, s) === key) ?? theme.form[0]!;
          const { step } = chordStepOf(theme, section, bar);
          const tones = [
            ...chordOn(theme.root, theme.scale, step.deg, step.kind ?? "triad"),
            degreeNote(theme.root, theme.scale, step.deg + 1),
          ];
          const pcs = tones.map((x) => ((x % 12) + 12) % 12);
          strong++;
          if (pcs.includes(((degreeNote(theme.root, theme.scale, n.deg) % 12) + 12) % 12)) on++;
        }
        expect(on / Math.max(1, strong)).toBeGreaterThanOrEqual(0.8);
      }
    });

  for (const theme of THEMES)
    test(`${theme.name}: 96 bars at three intensities — every note in time, in range, the pitched ones in the mode, an orchestra's instruments`, () => {
      let prev: number[] | null = null;
      const seen = new Set<string>();
      for (const intensity of [0.15, 0.5, 1])
        for (let bar = 0; bar < 96; bar++) {
          const p = composeBar(theme, bar, intensity, 0, prev);
          prev = p.chord;
          for (const e of p.events) {
            seen.add(e.layer);
            expect(INSTRUMENTS as readonly string[]).toContain(e.inst);
            expect(e.beat).toBeGreaterThanOrEqual(0);
            expect(e.beat).toBeLessThan(4);
            expect(e.dur).toBeGreaterThan(0);
            expect(e.vel).toBeGreaterThan(0);
            expect(e.vel).toBeLessThanOrEqual(1.2);
            if (e.layer !== "perc") {
              expect(e.note).toBeGreaterThanOrEqual(21);
              expect(e.note).toBeLessThanOrEqual(108);
              if (e.inst !== "shepard") expect(inScale(theme.root, theme.scale, e.note)).toBe(true);
            }
          }
          // (sorted in time: the engine schedules them in order)
          for (let i = 1; i < p.events.length; i++) expect(p.events[i]!.beat).toBeGreaterThanOrEqual(p.events[i - 1]!.beat);
        }
      // (its orchestra all heard at some point)
      if (theme.perc && theme.perc !== "timpani") expect(seen.has("perc")).toBe(true);
      if (theme.bass) expect(seen.has("bass")).toBe(true);
      if (theme.strings) expect(seen.has("strings")).toBe(true);
      if (theme.ostinato) expect(seen.has("ostinato")).toBe(true);
      if (theme.brass) expect(seen.has("brass")).toBe(true);
      expect(seen.has("melody")).toBe(true);
      for (const l of seen) expect(LAYERS as string[]).toContain(l);
    });
});

describe("the manners", () => {
  test("no synth-pop left: no kick, hats, supersaws, plucks, guitars", () => {
    for (const x of ["kick", "clap", "hat", "openhat", "shaker", "supersaw", "pluck", "lead", "guitar", "growl", "riser"])
      expect(INSTRUMENTS as readonly string[]).not.toContain(x);
  });
  test("Max Richter's elegy: the strings alone — no percussion, no brass, the viola's melody, the cellos under", () => {
    const t = THEMES.find((x) => x.manner === "richter")!;
    const insts = new Set<string>();
    for (const i of [0.2, 1]) for (let bar = 0; bar < 48; bar++) for (const e of composeBar(t, bar, i).events) insts.add(e.inst);
    for (const x of insts) expect(["strings", "cello", "contrabass", "viola", "violins"]).toContain(x);
    expect(insts.has("viola")).toBe(true);
    expect(insts.has("cello")).toBe(true);
  });
  test("John Williams's: the march's snare and timpani, the fanfare's triplets, the harp's glissando into a section", () => {
    const t = THEMES.find((x) => x.id === "ascent")!;
    // (intro 4, verse 8, build 4, drop 8: the drop from bar 16)
    const drop = composeBar(t, 17, 1).events;
    expect(drop.some((e) => e.inst === "snare")).toBe(true);
    expect(drop.some((e) => e.inst === "timpani")).toBe(true);
    expect(drop.filter((e) => e.inst === "trumpet" && e.beat > 2 && e.beat < 3).length).toBeGreaterThanOrEqual(2);
    expect(composeBar(t, 4, 0.6).events.filter((e) => e.inst === "harp").length).toBeGreaterThan(10);
  });
  test("Hans Zimmer's: the organ and its pedal, the braams, the Shepard tone rising two semitones a bar", () => {
    const w = THEMES.find((x) => x.id === "wormhole")!;
    const bars = [20, 21, 22].map((b) => composeBar(w, b, 1).events);
    expect(bars[0]!.some((e) => e.inst === "organ")).toBe(true);
    expect(bars[0]!.some((e) => e.inst === "pedal")).toBe(true);
    expect(bars[0]!.some((e) => e.inst === "braam")).toBe(true);
    const sh = bars.map((b) => b.find((e) => e.inst === "shepard")!.note % 12);
    expect((sh[1]! - sh[0]! + 12) % 12).toBe(2);
    expect((sh[2]! - sh[1]! + 12) % 12).toBe(2);
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
  test("the orchestra builds with the energy: strings alone when quiet, everyone in a drop", () => {
    const count = (i: number, bar: number) => composeBar(t, bar, i).events.length;
    expect(count(1, 17)).toBeGreaterThan(3 * count(0, 1));
    const layers = new Set(composeBar(t, 16, 1).events.map((e) => e.layer));
    for (const l of ["perc", "bass", "strings", "ostinato", "brass", "melody"] as const) expect(layers.has(l)).toBe(true);
    const quiet = new Set(composeBar(t, 1, 0).events.map((e) => e.layer));
    expect(quiet.has("perc")).toBe(false);
    expect(quiet.has("brass")).toBe(false);
  });
  test("a roll before a stronger section, the cymbal swelling at a build's end, a clash, a boom and the timpani at the drop", () => {
    // (the verse's last bar, into the build: the snare's roll)
    expect(composeBar(t, 4 + 8 - 1, 0.8).events.some((e) => e.inst === "roll")).toBe(true);
    expect(composeBar(t, 4 + 8 + 4 - 1, 0.8).events.some((e) => e.inst === "cymbal")).toBe(true);
    const drop = composeBar(t, 16, 0.8).events;
    for (const x of ["crash", "boom", "timpani"]) expect(drop.some((e) => e.inst === x)).toBe(true);
  });
  test("deterministic; another variation, the melody ornamented otherwise", () => {
    expect(composeBar(t, 20, 0.9, 3)).toEqual(composeBar(t, 20, 0.9, 3));
    const sec = t.form[1]!;
    const line = (seed: number) => [0, 1, 2, 3].flatMap((b) => melodyIn(t, sec, b, seed).map((n) => `${n.beat}:${n.deg}`)).join(" ");
    expect(line(1)).not.toEqual(line(0));
    expect(line(1)).not.toEqual(line(2));
  });
});

describe("the panel's chord names", () => {
  test("from the root, whatever the inversion", async () => {
    const { chordName } = await import("../src/ui/musicpanel");
    expect(chordName([57, 60, 64])).toBe("Am");
    expect(chordName([60, 64, 69], 57)).toBe("Am");
    expect(chordName([62, 66, 69])).toBe("D");
    expect(chordName([55, 57, 62])).toBe("Gsus2");
    expect(chordName([55, 59, 62, 65])).toBe("G7");
  });
});
