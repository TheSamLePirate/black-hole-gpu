// The orchestral score (audio/music/*): the themes on the harmony and the structure of the best-known film scores,
// their own melodies fitted to those chords, the composer's orchestra bar by bar.
import { describe, expect, test } from "bun:test";
import { barEnergy, chordOfTheme, chordStepOf, composeBar, melodyIn, placeInForm, progressionOf } from "../src/audio/music/composer";
import { INSTRUMENTS } from "../src/audio/music/instruments";
import { beatsOf, LAYERS, parsePhrase, THEME_BY_ID, THEMES } from "../src/audio/music/themes";
import { chordOn, degreeNote, inScale, parseChord, voiceLead } from "../src/audio/music/theory";

const pcs = (ns: number[]) => ns.map((n) => ((n % 12) + 12) % 12);
const prog = (id: string, key: string) =>
  THEME_BY_ID[id]!.progressions[key]!.map((s) => (s.bars > 1 ? `${s.chord}:${s.bars}` : s.chord)).join(" ");

describe("the theory", () => {
  test("chords diatonic, voices led by steps", () => {
    expect(chordOn(57, "minor", 0)).toEqual([57, 60, 64]);
    expect(chordOn(57, "minor", 5)).toEqual([65, 69, 72]);
    const a = voiceLead(null, chordOn(57, "minor", 0));
    const b = voiceLead(a, chordOn(57, "minor", 5));
    expect(b.reduce((s, n, i) => s + Math.abs(n - (a[i] ?? n)), 0)).toBeLessThanOrEqual(6);
  });
  test("chords by their symbols: qualities, slashes, flats and sharps, fourths", () => {
    expect(pcs(parseChord("Fmaj7").notes)).toEqual([5, 9, 0, 4]);
    const em = parseChord("Em/G");
    expect(pcs(em.notes)).toEqual([4, 7, 11]);
    expect(em.bass % 12).toBe(7);
    expect(em.bass).toBeLessThanOrEqual(em.notes[0]!);
    expect(pcs(parseChord("Ebm").notes)).toEqual([3, 6, 10]);
    expect(pcs(parseChord("C#m").notes)).toEqual([1, 4, 8]);
    expect(pcs(parseChord("F7sus4").notes)).toEqual([5, 10, 0, 3]);
    expect(pcs(parseChord("Fq").notes)).toEqual([5, 10, 3, 8]);
    expect(() => parseChord("H7")).toThrow();
  });
});

describe("the references: the published analyses' progressions", () => {
  test("Interstellar's main theme: VI7 – v6 – i – v65 in A minor", () => expect(prog("event-horizon", "a")).toBe("Fmaj7 Em/G Am Em7/G"));
  test("Inception's Time: Am – Em – G – D – Am – Cmaj7 – G – D, at 60 BPM", () => {
    expect(prog("endurance", "a")).toBe("Am Em G D Am Cmaj7 G D");
    expect(THEME_BY_ID.endurance!.bpm).toBe(60);
  });
  test("On the Nature of Daylight: B♭ minor, i – v6 – III6 – VI – VII, 61 BPM", () => {
    expect(prog("orbit-drift", "a")).toBe("Bbm:2 Fm/Ab:2 Db/F:2 Gb Ab");
    expect(THEME_BY_ID["orbit-drift"]!.bpm).toBe(61);
  });
  test("Star Wars: B♭, the tonic and the fourths on F, A♭ before the dominant, I – ♭VII – V – v, IV6 – V7sus4 – ♭III – V", () => {
    expect(prog("ascent", "a")).toBe("Bb Fq Bb Fq Bb Ab F F");
    expect(prog("ascent", "b")).toBe("Bb Ab F Fm");
    expect(prog("ascent", "c")).toBe("Eb/G F7sus4 Db F");
    expect(THEME_BY_ID.ascent!.grid).toBe(3);
  });
  test("the Imperial March: G minor and E♭ minor, then i – ♯iv – ♯v – i", () => {
    expect(prog("reentry", "a")).toBe("Gm Ebm Gm Ebm");
    expect(prog("reentry", "b")).toBe("Gm C#m D#m Gm");
  });
  test("Jurassic Park: B♭, I(add9) – V7sus4, I – IV – I, A♭ at the climax", () => {
    expect(prog("new-worlds", "i")).toBe("Bbadd9:2 F7sus4:2");
    expect(prog("new-worlds", "a")).toBe("Bb Eb/Bb Bb F");
    expect(prog("new-worlds", "b")).toContain("Ab");
  });
  test("Day One: A minor in 3/4", () => {
    expect(beatsOf(THEME_BY_ID["deep-space"]!)).toBe(3);
    expect(THEME_BY_ID["deep-space"]!.root % 12).toBe(9);
  });
});

describe("the themes", () => {
  test("twelve, their own ids, in the three manners, each after a score, with a form, a progression and a melody", () => {
    expect(THEMES.length).toBe(12);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect([...new Set(THEMES.map((t) => t.manner))].sort()).toEqual(["richter", "williams", "zimmer"]);
    for (const t of THEMES) {
      expect(t.mood.length).toBeGreaterThan(3);
      expect(t.form.length).toBeGreaterThan(1);
      expect(t.progressions.a!.length).toBeGreaterThan(0);
      expect(t.loopFrom).toBeLessThan(t.form.length);
      expect(t.melody).not.toBeNull();
      for (const p of Object.values(t.progressions)) for (const s of p) expect(() => parseChord(s.chord)).not.toThrow();
    }
  });

  for (const theme of THEMES)
    test(`${theme.name}: each phrase whole bars, fitted to its progression — its notes on the strong beats the chord's`, () => {
      const B = beatsOf(theme);
      for (const [key, phrase] of Object.entries(theme.melody!.phrases)) {
        const { notes, beats } = parsePhrase(phrase);
        expect(Math.abs(beats / B - Math.round(beats / B))).toBeLessThan(1e-6);
        const steps = theme.progressions[key] ?? theme.progressions.a!;
        const progBars = steps.reduce((a, s) => a + s.bars, 0);
        const bars = Math.round(beats / B);
        expect(bars % progBars === 0 || progBars % bars === 0).toBe(true);
        let on = 0,
          strong = 0;
        for (const n of notes) {
          const inBar = n.at % B;
          if (n.deg === null || !(Math.abs(inBar) < 1e-6 || (B === 4 && Math.abs(inBar - 2) < 1e-6))) continue;
          const section = theme.form.find((s) => progressionOf(theme, s) === key) ?? theme.form[0]!;
          const { step } = chordStepOf(theme, section, Math.floor(n.at / B + 1e-6));
          const C = chordOfTheme(theme, step.chord);
          strong++;
          if (pcs([...C.notes, C.bass]).includes(pcs([degreeNote(theme.root, theme.scale, n.deg) + n.acc])[0]!)) on++;
        }
        // (an intro's phrase all rests: nothing to fit)
        if (strong) expect(on / strong).toBeGreaterThanOrEqual(0.8);
      }
    });

  for (const theme of THEMES)
    test(`${theme.name}: 96 bars at three intensities — every note in time, in range, in the mode or the chord, an orchestra's instruments`, () => {
      const B = beatsOf(theme);
      let prev: number[] | null = null;
      const seen = new Set<string>();
      for (const intensity of [0.15, 0.5, 1])
        for (let bar = 0; bar < 96; bar++) {
          const p = composeBar(theme, bar, intensity, 0, prev);
          prev = p.chord;
          const C = chordOfTheme(theme, p.symbol);
          const chordPcs = pcs([...C.notes, C.bass]);
          for (const e of p.events) {
            seen.add(e.layer);
            expect(INSTRUMENTS as readonly string[]).toContain(e.inst);
            expect(e.beat).toBeGreaterThanOrEqual(0);
            expect(e.beat).toBeLessThan(B);
            expect(e.dur).toBeGreaterThan(0);
            expect(e.vel).toBeGreaterThan(0);
            expect(e.vel).toBeLessThanOrEqual(1.2);
            if (e.layer !== "perc") {
              expect(e.note).toBeGreaterThanOrEqual(21);
              expect(e.note).toBeLessThanOrEqual(108);
              if (e.inst !== "shepard") expect(inScale(theme.root, theme.scale, e.note) || chordPcs.includes(pcs([e.note])[0]!)).toBe(true);
            }
          }
          for (let i = 1; i < p.events.length; i++) expect(p.events[i]!.beat).toBeGreaterThanOrEqual(p.events[i - 1]!.beat);
        }
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
  test("Daylight: the strings alone, the low strings opening and closing it (a palindrome), the violins' melody", () => {
    const t = THEME_BY_ID["orbit-drift"]!;
    const insts = new Set<string>();
    for (const i of [0.2, 1]) for (let bar = 0; bar < 48; bar++) for (const e of composeBar(t, bar, i).events) insts.add(e.inst);
    for (const x of insts) expect(["strings", "cello", "contrabass", "viola", "violins"]).toContain(x);
    expect(insts.has("violins")).toBe(true);
    const opening = new Set(composeBar(t, 1, 1).events.map((e) => e.layer));
    expect([...opening].every((l) => l === "bass" || l === "strings")).toBe(true);
    expect(composeBar(t, 44, 1).section.name).toBe("outro");
  });
  test("Star Wars: the triplet march, the timpani, the fanfare's triplets, the harp's glissando into a section", () => {
    const t = THEME_BY_ID.ascent!;
    // (intro 4, verse 8, build 4, break 4, drop 8: the drop from bar 20)
    const drop = composeBar(t, 21, 1).events;
    expect(drop.some((e) => e.inst === "snare" && e.beat % 1 !== 0 && Math.abs(e.beat * 3 - Math.round(e.beat * 3)) < 1e-6)).toBe(true);
    expect(drop.some((e) => e.inst === "timpani")).toBe(true);
    expect(drop.filter((e) => e.inst === "trumpet" && e.beat > 2 && e.beat < 3).length).toBeGreaterThanOrEqual(2);
    expect(composeBar(t, 4, 0.6).events.filter((e) => e.inst === "harp").length).toBeGreaterThan(10);
  });
  test("Interstellar: the organ's clock repeating E in triplets, the pedal on the chord's bass (G under Em/G)", () => {
    const t = THEME_BY_ID["event-horizon"]!;
    const b = composeBar(t, 5, 1).events;
    const clock = b.filter((e) => e.layer === "ostinato" && e.note % 12 === 4);
    expect(clock.length).toBeGreaterThanOrEqual(12);
    expect(clock.some((e) => Math.abs(e.beat - 1 / 3) < 1e-6)).toBe(true);
    expect(b.find((e) => e.inst === "pedal")!.note % 12).toBe(7);
  });
  test("Time: an insistent pulse, the horns and braams at the height, the solo piano to end", () => {
    const t = THEME_BY_ID.endurance!;
    expect(placeInForm(t, 8 * 5).section.name).toBe("break");
    expect(new Set(composeBar(t, 8 * 5 + 1, 1).events.map((e) => e.inst))).toEqual(new Set(["piano"]));
    const height = composeBar(t, 24, 1).events;
    for (const x of ["bassdrum", "horns", "braam", "horn"]) expect(height.some((e) => e.inst === x)).toBe(true);
  });
  test("Day One: bars of three beats, the piano's left hand in broken chords", () => {
    const b = composeBar(THEME_BY_ID["deep-space"]!, 10, 1).events.filter((e) => e.layer === "ostinato");
    expect(b.length).toBe(6);
    for (const e of b) expect(e.beat).toBeLessThan(3);
  });
  test("Jurassic Park: a hymn — the strings' and the horns' chords moving with each note of the tune", () => {
    const ev = composeBar(THEME_BY_ID["new-worlds"]!, 6, 1).events;
    const tune = new Set(ev.filter((e) => e.layer === "melody").map((e) => e.beat));
    const strings = new Set(ev.filter((e) => e.layer === "strings").map((e) => e.beat));
    expect(tune.size).toBeGreaterThan(1);
    for (const b of tune) expect(strings.has(b)).toBe(true);
    expect(ev.some((e) => e.inst === "horns")).toBe(true);
  });
  test("the wormhole's Shepard tone, rising two semitones a bar", () => {
    const w = THEME_BY_ID.wormhole!;
    const sh = [20, 21, 22].map((b) => composeBar(w, b, 1).events.find((e) => e.inst === "shepard")!.note % 12);
    expect((sh[1]! - sh[0]! + 12) % 12).toBe(2);
    expect((sh[2]! - sh[1]! + 12) % 12).toBe(2);
  });
});

describe("the form and the energy", () => {
  const t = THEME_BY_ID.ascent!;
  test("the form played through, then looped from the verse", () => {
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
  test("the orchestra builds with the energy: few when quiet, everyone in a drop", () => {
    expect(composeBar(t, 21, 1).events.length).toBeGreaterThan(3 * composeBar(t, 1, 0).events.length);
    const layers = new Set(composeBar(t, 20, 1).events.map((e) => e.layer));
    for (const l of ["perc", "bass", "strings", "ostinato", "brass", "melody"] as const) expect(layers.has(l)).toBe(true);
    const quiet = new Set(composeBar(t, 1, 0).events.map((e) => e.layer));
    expect(quiet.has("perc")).toBe(false);
    expect(quiet.has("brass")).toBe(false);
  });
  test("a roll before a stronger section, the cymbal swelling at a build's end, a clash, a boom and the timpani at the drop", () => {
    expect(composeBar(t, 4 + 8 - 1, 0.8).events.some((e) => e.inst === "roll")).toBe(true);
    expect(composeBar(t, 4 + 8 + 4 - 1, 0.8).events.some((e) => e.inst === "cymbal")).toBe(true);
    const drop = composeBar(t, 20, 0.8).events;
    for (const x of ["crash", "boom", "timpani"]) expect(drop.some((e) => e.inst === x)).toBe(true);
  });
  test("deterministic; another variation, the melody ornamented otherwise", () => {
    expect(composeBar(t, 22, 0.9, 3)).toEqual(composeBar(t, 22, 0.9, 3));
    const sec = t.form[1]!;
    const line = (seed: number) =>
      [0, 1, 2, 3, 4, 5, 6, 7].flatMap((b) => melodyIn(t, sec, b, seed).map((n) => `${n.beat}:${n.deg}`)).join(" ");
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
