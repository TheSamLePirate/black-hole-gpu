// The composer: a theme (music/themes.ts) played bar by bar — where the bar falls in the form (its section, the
// form looped once through), its chord (the section's progression, by its symbol, voiced near the last, its bass the
// slash's), its energy (the section's, raised or lowered by the flight's intensity) and the orchestra's notes for it:
//  - the percussion by its manner (a march, a march in triplets, action toms in 3-3-2, taikos, an insistent pulse, a
//    heartbeat, a clock's eighths, booms, timpani), a roll before a stronger section, a suspended cymbal swelling at
//    a build's end, a clash, a boom and the timpani at a drop;
//  - the bass on the chord's bass (the organ's pedal, the low strings' eighths, a march's root and fifth, a drone,
//    the elegy's ground bass);
//  - the strings', the organ's and the choir's chords (held, tremolo, high, the elegy's, a hymn's moving with the
//    tune);
//  - the ostinato (a pendulum, spiccato, the organ's sixteenths, the harp's triplets, a few piano notes, a clock's
//    repeated pedal, the piano's broken chords);
//  - the brass (the horns' chords, a braam on each chord, the fanfare's stabs, a chorale with the tune);
//  - the melody — the theme's own phrases on its chords — doubled an octave away in the strongest bars;
//  - the harp's glissando into a section, the celesta's sparkles, the Shepard tone.
// Bars of three or four beats, a grid of sixteenths or triplets. Pure and deterministic: the same theme, bar,
// intensity and variation, the same notes.

import { beatsOf, gridOf, type Layer, parsePhrase, type Section, type Theme } from "./themes";
import { degreeNote, parseChord, Rng, seedOf, voiceLead } from "./theory";

/** A note of the bar: its layer and instrument, its start and length [beats from the bar's start], its pitch (MIDI;
 *  the unpitched percussion: none), its velocity 0 … 1, its place in the stereo field (−1 … 1). */
export interface NoteEvent {
  layer: Layer;
  inst: string;
  beat: number;
  dur: number;
  note: number;
  vel: number;
  pan?: number;
}

export interface BarPlan {
  bar: number;
  section: Section;
  /** the bar's place in its section, the section's index in the form */
  inSection: number;
  sectionIndex: number;
  /** the bar's energy 0 … 1, its chord (MIDI, voiced) and its symbol */
  energy: number;
  chord: number[];
  symbol: string;
  /** the chord's root (its name's; the voicing may be inverted) */
  root: number;
  events: NoteEvent[];
}

/** Each part's entry: the energy from which it plays. */
export const ENTRY: Record<string, number> = {
  strings: 0,
  organ: 0,
  bass: 0.15,
  keys: 0.2,
  choir: 0.3,
  ostinato: 0.3,
  perc: 0.36,
  melody: 0.4,
  brass: 0.5,
  braam: 0.55,
  percFull: 0.62,
  fill: 0.5,
  fanfare: 0.7,
  double: 0.78,
};

/** Where a bar falls in the form: the section, its index, the bar in it (the form looped from loopFrom). */
export function placeInForm(theme: Theme, bar: number): { section: Section; index: number; inSection: number } {
  const F = theme.form;
  const total = F.reduce((a, s) => a + s.bars, 0);
  let b = bar;
  let start = 0;
  if (b >= total) {
    const loop = F.slice(theme.loopFrom).reduce((a, s) => a + s.bars, 0);
    b = (b - total) % Math.max(loop, 1);
    start = theme.loopFrom;
  }
  for (let i = start; i < F.length; i++) {
    if (b < F[i]!.bars) return { section: F[i]!, index: i, inSection: b };
    b -= F[i]!.bars;
  }
  return { section: F[F.length - 1]!, index: F.length - 1, inSection: 0 };
}

/** The next section after one (its energy: a roll before a stronger one). */
function nextSection(theme: Theme, index: number): Section {
  return theme.form[index + 1] ?? theme.form[theme.loopFrom]!;
}

/** The bar's energy: the section's, the flight's intensity (0.5: as written) raising or lowering it. */
export function barEnergy(section: Section, intensity: number): number {
  return Math.min(1, Math.max(0, section.energy * (0.45 + 1.1 * intensity)));
}

/** The progression a section plays. */
export function progressionOf(theme: Theme, section: Section): string {
  const key = section.prog ?? ((section.name === "build" || section.name === "drop") && theme.progressions.b ? "b" : "a");
  return theme.progressions[key] ? key : "a";
}

/** The chord of a bar: its section's progression, its steps each so many bars, looped. */
export function chordStepOf(theme: Theme, section: Section, inSection: number) {
  const prog = theme.progressions[progressionOf(theme, section)]!;
  const len = prog.reduce((a, s) => a + s.bars, 0);
  let b = inSection % len;
  for (const s of prog) {
    if (b < s.bars) return { step: s, first: b === 0 };
    b -= s.bars;
  }
  return { step: prog[0]!, first: true };
}

/** A chord of the theme: its notes about the theme's octave, its bass, its root's pitch class. */
export function chordOfTheme(theme: Theme, symbol: string) {
  return parseChord(symbol, theme.root - 5);
}

const pat = (s: string) => [...s].map((c, i) => (c === "x" ? i : c === "o" ? -i - 1 : null)).filter((x) => x !== null) as number[];

/** The percussion's patterns by manner: their grid (steps a beat), per instrument the steps struck over four beats
 *  ("x"; "o": a softer one); `full`: from the stronger energy only. */
const PERC: Record<string, { grid: number; light: Record<string, string>; full: Record<string, string> }> = {
  march: { grid: 4, light: { bassdrum: "x.......x.......", snare: "....x.......x..." }, full: { snare: "x.oox.o.x.oox.oo" } },
  tripletMarch: {
    grid: 3,
    light: { bassdrum: "x.....x.....", snare: "...x.....x.." },
    full: { snare: "x.ox.ox.oxxx", bassdrum: "x.....x....." },
  },
  action: {
    grid: 4,
    light: { taiko: "x.......x.......", tom: "x..x..x.x..x..x." },
    full: { snare: "....x.......x...", tom: "x..x..x.x..x.xxx" },
  },
  taiko: { grid: 4, light: { taiko: "x.....x.x......." }, full: { tom: "....x..o....x.xx", taiko: "x.....x.x...x..." } },
  pulse: { grid: 4, light: { bassdrum: "x.o.x.o.x.o.x.o." }, full: { bassdrum: "x.o.x.o.x.o.x.oo", taiko: "x.......x......." } },
  heartbeat: { grid: 4, light: { bassdrum: "x..o............" }, full: { bassdrum: "x..o....x..o...." } },
  clock: { grid: 4, light: { tick: "x.o.x.o.x.o.x.o." }, full: { tick: "x.oox.oox.oox.oo", bassdrum: "x.......x......." } },
  booms: { grid: 4, light: {}, full: {} },
  timpani: { grid: 4, light: {}, full: {} },
};

/** The melody's notes in a bar: the phrase of its progression (varied by the seed), the bar's share of it. */
export function melodyIn(theme: Theme, section: Section, inSection: number, seed: number) {
  const M = theme.melody;
  if (!M) return [];
  const B = beatsOf(theme);
  const prog = progressionOf(theme, section);
  const key = M.phrases[prog] ? prog : "a";
  if (!M.phrases[key]) return [];
  const { notes, beats } = parsePhrase(M.phrases[key]!);
  const varied = varyPhrase(notes, theme.id, key, seed);
  const bars = Math.max(1, Math.round(beats / B));
  const b0 = (inSection % bars) * B;
  return varied
    .filter((n) => n.deg !== null && n.at >= b0 - 1e-6 && n.at < b0 + B - 1e-6)
    .map((n) => ({ beat: Math.max(0, n.at - b0), dur: n.dur, deg: n.deg!, acc: n.acc }));
}

/** A variation of a phrase (seed 0: as written): its notes now and then turned into the note and a neighbour (its long
 *  ones) or a note and the step to the next one (a passing note) — the same line, ornamented otherwise. */
export function varyPhrase(notes: { at: number; dur: number; deg: number | null; acc: number }[], id: string, key: string, seed: number) {
  if (!seed) return notes;
  const r = new Rng(seedOf(id, "phrase", key, seed));
  const out: typeof notes = [];
  notes.forEach((n, i) => {
    const nextDeg = notes[i + 1]?.deg ?? null;
    if (n.deg !== null && n.dur >= 2 && r.chance(0.6)) {
      const lead = n.dur >= 3 ? 1 : 0.5;
      out.push({ ...n, dur: n.dur - lead });
      out.push({ at: n.at + n.dur - lead, dur: lead, deg: n.deg + r.pick([-1, 1, 2]), acc: 0 });
    } else if (n.deg !== null && n.dur === 1 && nextDeg !== null && Math.abs(nextDeg - n.deg) >= 2 && r.chance(0.5)) {
      out.push({ ...n, dur: 0.5 });
      out.push({ at: n.at + 0.5, dur: 0.5, deg: n.deg + Math.sign(nextDeg - n.deg), acc: 0 });
    } else out.push(n);
  });
  return out;
}

/**
 * The bar's notes. `intensity` 0 … 1 (0.5: as written), `seed` the variation, `prev` the last bar's chord voicing
 * (the voices led from it).
 */
export function composeBar(theme: Theme, bar: number, intensity: number, seed = 0, prev: number[] | null = null): BarPlan {
  const { section, index, inSection } = placeInForm(theme, bar);
  const e = barEnergy(section, intensity);
  const B = beatsOf(theme);
  const G = gridOf(theme);
  const r = new Rng(seedOf(theme.id, bar, seed));
  const { step, first } = chordStepOf(theme, section, inSection);
  const C = chordOfTheme(theme, step.chord);
  const chord = C.notes;
  const voiced = voiceLead(prev, chord, 50, 76);
  const ev: NoteEvent[] = [];
  const push = (n: NoteEvent) => ev.push(n);
  const lastOfSection = inSection === section.bars - 1;
  const next = nextSection(theme, index);
  const held = B * step.bars - 0.05;
  const into = (n: number, lo: number, hi: number) => {
    let m = n;
    while (m < lo) m += 12;
    while (m > hi) m -= 12;
    return m;
  };
  // (the chord's bass — its slash's — low; its root; its fifth, else its top)
  const bassLow = into(C.bass, 33, 44);
  const rootLow = into(chord[0]!, 33, 44);
  const fifth = chord.find((n) => (n - chord[0]! + 120) % 12 === 7) ?? chord[chord.length - 1]!;
  const melody = theme.melody && e >= ENTRY.melody! ? melodyIn(theme, section, inSection, seed) : [];

  // ---- the percussion
  const PS = theme.perc;
  if (PS) {
    const S = PERC[PS]!;
    const pg = S.grid;
    const steps = B * pg;
    const hit = (inst: string, s: number, vel: number, pan = 0, note = 0) =>
      push({ layer: "perc", inst, beat: Math.abs(s < 0 ? -s - 1 : s) / pg, dur: 0.5, note, vel: (s < 0 ? 0.45 : 1) * vel, pan });
    const roll = lastOfSection && e >= ENTRY.fill! && next.energy > section.energy;
    const parts = { ...(e >= ENTRY.perc! ? S.light : {}), ...(e >= ENTRY.percFull! ? S.full : {}) };
    for (const [inst, p] of Object.entries(parts)) {
      for (const s of pat(p.slice(0, steps))) {
        const at = Math.abs(s < 0 ? -s - 1 : s);
        if (roll && at >= steps / 2 && inst !== "bassdrum") continue;
        const accent = (at % pg === 0 ? 1 : 0.8) * (0.85 + 0.15 * r.next());
        if (inst === "tom") hit("tom", s, 0.75 * accent, r.next() * 1.2 - 0.6);
        else if (inst === "tick") hit("tick", s, 0.55 * accent);
        else hit(inst, s, (inst === "snare" ? 0.7 : 0.9) * accent * (0.7 + 0.3 * e));
      }
    }
    // (the timpani: the marches' and the timpani's own — the root on the first beat, the fifth on the middle one)
    const marches = PS === "march" || PS === "tripletMarch";
    if ((marches || PS === "timpani") && e >= (PS === "timpani" ? ENTRY.percFull! : ENTRY.perc!) && first)
      push({ layer: "perc", inst: "timpani", beat: 0, dur: 2, note: into(chord[0]!, 41, 52), vel: 0.55 + 0.35 * e });
    if (marches && e >= ENTRY.percFull! && B === 4)
      push({ layer: "perc", inst: "timpani", beat: 2, dur: 2, note: into(fifth, 41, 55), vel: 0.6 + 0.3 * e });
    if ((PS === "booms" || PS === "taiko") && first && e > 0.3)
      push({ layer: "perc", inst: "boom", beat: 0, dur: B, note: rootLow - 12, vel: 0.35 + 0.55 * e });
    // (a roll into a stronger section: the snare's for a march or action, else the timpani's on the root)
    if (roll) {
      if (marches || PS === "action") push({ layer: "perc", inst: "roll", beat: B / 2, dur: B / 2, note: 0, vel: 0.75 });
      else push({ layer: "perc", inst: "timproll", beat: B / 2, dur: B / 2, note: into(chord[0]!, 41, 52), vel: 0.75 });
    }
  }
  // (a build's last bar: the suspended cymbal swelling into the drop; a drop's first: a clash, a boom, the timpani)
  if (section.name === "build" && lastOfSection && e > 0.45 && theme.manner !== "richter")
    push({ layer: "perc", inst: "cymbal", beat: 0, dur: B, note: 0, vel: 0.5 + 0.4 * e });
  if (inSection === 0 && section.name === "drop" && theme.perc) {
    push({ layer: "perc", inst: "crash", beat: 0, dur: B, note: 0, vel: 0.75 });
    push({ layer: "perc", inst: "boom", beat: 0, dur: B, note: rootLow - 12, vel: 0.95 });
    push({ layer: "perc", inst: "timpani", beat: 0, dur: 2, note: into(chord[0]!, 41, 52), vel: 1 });
  }

  // ---- the bass, on the chord's bass
  if (theme.bass && e >= ENTRY.bass!) {
    const BS = theme.bass;
    const note = (inst: string, beat: number, dur: number, n: number, vel: number) =>
      push({ layer: "bass", inst, beat, dur, note: n, vel });
    if (BS === "pedal") {
      if (first) {
        note(theme.organ > 0 ? "pedal" : "contrabass", 0, held, bassLow, 0.7 + 0.2 * e);
        if (e >= 0.55) note("sub", 0, held, bassLow, 0.45 + 0.4 * e);
      }
    } else if (BS === "drone") {
      if (first) note("contrabass", 0, held, bassLow + 12, 0.45 + 0.3 * e);
      if (first && e >= 0.5) note("sub", 0, held, bassLow, 0.35 + 0.3 * e);
    } else if (BS === "pulse") {
      // (the low strings' eighths, the first of each beat leaning)
      for (let i = 0; i < B * 2; i++) note("lowspic", i / 2, 0.45, bassLow + 12, i % 2 ? 0.55 : 0.8);
      if (first && e >= 0.6) note("sub", 0, held, bassLow, 0.4 + 0.4 * e);
    } else if (BS === "march") {
      const inst = e >= ENTRY.percFull! ? "lowspic" : "pizz";
      for (let i = 0; i < B; i++) note(inst, i, 0.8, i % 2 ? into(fifth, bassLow + 12, bassLow + 23) : bassLow + 12, i % 2 ? 0.65 : 0.85);
    } else if (BS === "elegy") {
      // (the ground bass: the cellos on the chord's bass, the basses an octave under them once it grows)
      if (first) note("cello", 0, held, into(C.bass, 41, 52), 0.5 + 0.35 * e);
      if (first && e >= 0.5) note("contrabass", 0, held, into(C.bass, 29, 40), 0.4 + 0.35 * e);
    }
  }

  // ---- the strings', the organ's and the choir's chords (their first bar: the whole step)
  const S = theme.strings;
  if (S && e >= ENTRY.strings!) {
    const notes = S === "high" ? voiced.map((n) => n + 12) : S === "elegy" ? voiced.filter((n) => n >= 53) : voiced;
    const inst = S === "tremolo" ? "tremolo" : "strings";
    if (S === "hymn" && melody.length) {
      // (a hymn: the chord re-sung with each note of the tune, chord and tune moving together)
      for (const m of melody)
        for (const n of notes)
          push({ layer: "strings", inst, beat: m.beat, dur: Math.max(0.4, m.dur - 0.05), note: n, vel: 0.35 + 0.45 * e });
    } else if (first) {
      for (const n of notes) push({ layer: "strings", inst, beat: 0, dur: held, note: n, vel: (S === "elegy" ? 0.4 : 0.35) + 0.45 * e });
      if (S === "high" && e >= 0.5)
        push({ layer: "strings", inst: "strings", beat: 0, dur: held, note: notes[notes.length - 1]! + 12, vel: 0.3 + 0.3 * e });
    }
  }
  if (first) {
    if (theme.organ > 0)
      for (const n of voiced) push({ layer: "organ", inst: "organ", beat: 0, dur: held, note: n, vel: theme.organ * (0.55 + 0.4 * e) });
    if (theme.choir > 0 && e >= ENTRY.choir!)
      for (const n of voiced.slice(-3))
        push({
          layer: "choir",
          inst: theme.vowel === "oo" ? "choiroo" : "choir",
          beat: 0,
          dur: held,
          note: n < 57 ? n + 12 : n,
          vel: theme.choir * (0.4 + 0.5 * e),
        });
  }

  // ---- the ostinato
  const O = theme.ostinato;
  if (O && e >= ENTRY.ostinato!) {
    const tones = voiceLead(null, chord, O.register - 7, O.register + 9);
    const t = (i: number) => tones[((i % tones.length) + tones.length) % tones.length]!;
    const inst = O.sound;
    const play = (beat: number, dur: number, note: number, vel: number, pan = 0) =>
      push({ layer: "ostinato", inst, beat, dur, note, vel, pan });
    if (O.pattern === "pendulum") {
      const lo = t(0),
        hi = tones.find((n) => n - lo >= 5) ?? lo + 7;
      for (let i = 0; i < B * 2; i++) play(i / 2, 0.5, i % 2 ? lo : hi, i % 2 ? 0.55 : 0.75, i % 2 ? -0.3 : 0.3);
    } else if (O.pattern === "spiccato") {
      const shape = G === 3 ? [0, 2, 1, 0, 2, 1, 0, 2, 3, 2, 1, 2] : [0, 0, 2, 0, 1, 0, 2, 1, 0, 0, 2, 0, 1, 2, 3, 2];
      for (let i = 0; i < B * G; i++)
        play(i / G, 1 / G, t(shape[i % shape.length]!), i % G === 0 ? 0.8 : 0.5 + 0.15 * r.next(), Math.sin(i) * 0.3);
    } else if (O.pattern === "organ") {
      const up = [0, 1, 2, 3, 2, 1, 2, 3];
      for (let i = 0; i < B * 4; i++) {
        const leap = e > 0.75 && i % 8 === 6 ? 12 : 0;
        play(i / 4, 0.24, t(up[i % 8]!) + leap, i % 4 === 0 ? 0.75 : 0.5, i % 2 ? 0.25 : -0.25);
      }
    } else if (O.pattern === "arpeggio") {
      const up = [...tones, ...tones.map((n) => n + 12)];
      const seq = [...up, ...up.slice(1, -1).reverse()];
      for (let i = 0; i < B * 3; i++) play(i / 3, 0.6, seq[i % seq.length]!, i % 3 === 0 ? 0.65 : 0.45, Math.sin(i * 0.7) * 0.5);
    } else if (O.pattern === "piano") {
      play(0, 2, t(r.int(0, tones.length - 1)) + 12, 0.5 + 0.2 * e);
      if (B === 4) play(2, 2, t(r.int(0, tones.length - 1)) + 12, 0.42 + 0.2 * e);
    } else if (O.pattern === "clock") {
      // (one note repeated on the grid — the pedal, a clock's ticking —, the beat leaning, its octave below on the
      // stronger energy)
      const pedal = into(O.pedal ?? chord[0]!, O.register - 6, O.register + 5);
      for (let i = 0; i < B * G; i++) {
        play(i / G, 1 / G, pedal, i % G === 0 ? 0.7 : 0.45, i % 2 ? 0.2 : -0.2);
        if (e > 0.7 && i % G === 0) play(i / G, 1 / G, pedal - 12, 0.5);
      }
    } else if (O.pattern === "broken") {
      // (the left hand: the bass, its fifth, its tenth, its fifth again, in eighths, the pedal down)
      const b0 = into(C.bass, O.register - 14, O.register - 3);
      const shape = [b0, b0 + 7, into(chord[1]!, b0 + 12, b0 + 23), b0 + 7];
      for (let i = 0; i < B * 2; i++) play(i / 2, 1.5, shape[i % 4]!, i === 0 ? 0.6 : 0.42 + 0.08 * r.next());
    }
  }

  // ---- the brass
  const BR = theme.brass;
  if (BR) {
    if (BR.chords && first && e >= ENTRY.brass!)
      for (const n of voiceLead(null, chord, 50, 69))
        push({ layer: "brass", inst: "horns", beat: 0, dur: held, note: n, vel: 0.35 + 0.55 * e });
    if (BR.chorale && e >= ENTRY.brass!)
      for (const m of melody)
        for (const n of voiceLead(null, chord, 50, 67))
          push({ layer: "brass", inst: "horns", beat: m.beat, dur: Math.max(0.4, m.dur - 0.05), note: n, vel: 0.3 + 0.5 * e });
    if (BR.braam && first && e >= ENTRY.braam!)
      push({ layer: "brass", inst: "braam", beat: 0, dur: Math.min(held, 3), note: rootLow + 12, vel: 0.5 + 0.5 * e });
    if (BR.fanfare && e >= ENTRY.fanfare!) {
      // (the stabs: a triplet on the bar's second-to-last beat into a held last one, the chord's top voices)
      const top = voiceLead(null, chord, 62, 76).slice(-2);
      for (const [b, d] of [
        [B - 2, 1 / 3],
        [B - 2 + 1 / 3, 1 / 3],
        [B - 2 + 2 / 3, 1 / 3],
        [B - 1, 0.9],
      ] as const)
        for (const n of top) push({ layer: "brass", inst: "trumpet", beat: b, dur: d, note: n, vel: b === B - 1 ? 0.85 : 0.65 });
    }
  }

  // ---- the melody, doubled an octave away in the strongest bars
  const M = theme.melody;
  if (M)
    for (const m of melody) {
      const note = degreeNote(theme.root, theme.scale, m.deg) + m.acc + 12 * M.oct;
      const vel = Math.min(1, 0.55 + 0.4 * e + (m.beat % 1 === 0 ? 0.05 : 0));
      push({ layer: "melody", inst: M.sound, beat: m.beat, dur: m.dur, note, vel, pan: -0.1 });
      if (M.double && e >= ENTRY.double!)
        push({
          layer: "melody",
          inst: M.double.sound,
          beat: m.beat,
          dur: m.dur,
          note: note + 12 * M.double.oct,
          vel: vel * 0.85,
          pan: 0.15,
        });
    }

  // ---- the harp's glissando, the celesta, the Shepard tone
  const K = theme.keys;
  if (K && e >= ENTRY.keys!) {
    if (K.gliss && inSection === 0 && section.name !== "intro")
      for (let i = 0; i < 15; i++)
        push({
          layer: "keys",
          inst: "harp",
          beat: (i / 15) * 0.9,
          dur: 1.5,
          note: degreeNote(theme.root, theme.scale, i),
          vel: 0.35 + (0.35 * i) / 14,
          pan: -0.6 + (1.2 * i) / 14,
        });
    if (K.sparkle && bar % 2 === 1)
      for (const [i, b] of [B - 1.5, B - 1, B - 0.5].entries())
        push({
          layer: "keys",
          inst: "celesta",
          beat: b,
          dur: 1,
          note: voiced[(i + bar) % voiced.length]! + 24,
          vel: 0.4 + 0.15 * e,
          pan: 0.4,
        });
    if (K.shepard) push({ layer: "keys", inst: "shepard", beat: 0, dur: B, note: 48 + ((bar * 2) % 12), vel: 0.4 + 0.5 * e });
  }

  // (a section for a few of the orchestra only: the rest silent)
  const events = section.only ? ev.filter((x) => section.only!.includes(x.layer)) : ev;
  events.sort((a, b) => a.beat - b.beat);
  return { bar, section, inSection, sectionIndex: index, energy: e, chord: voiced, symbol: step.chord, root: chord[0]!, events };
}
