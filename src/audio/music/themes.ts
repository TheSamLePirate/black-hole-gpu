// The score's themes: an orchestral score built on the harmony, the structure and the orchestration of the best-known
// film scores — Hans Zimmer's Interstellar (its main theme, Day One, Mountains, No Time for Caution) and Inception
// (Time), John Williams's Star Wars, Imperial March, Jurassic Park and E.T. (Flying), Max Richter's On the Nature of
// Daylight. Their chord progressions, keys, tempi, metres and forms are taken from published analyses (Hooktheory,
// Film Music Notes, Attack Magazine, the Wikipedia article on Daylight); progressions are not a work's protected
// part. Their melodies are not: each theme's melody is this game's own, written on those chords. The composer
// (music/composer.ts) plays them bar by bar; the energy — the section's, raised or lowered by the flight's intensity —
// decides which sections of the orchestra play. Data only.

import type { ScaleName } from "./theory";

/** The orchestra's sections, each its own bus in the mixer (music/engine.ts). */
export type Layer = "perc" | "bass" | "strings" | "ostinato" | "brass" | "melody" | "keys" | "organ" | "choir";
export const LAYERS: Layer[] = ["perc", "bass", "strings", "ostinato", "brass", "melody", "keys", "organ", "choir"];

export type SectionName = "intro" | "verse" | "build" | "drop" | "break" | "outro";
export interface Section {
  name: SectionName;
  bars: number;
  /** its energy 0 … 1 (the orchestra's sections enter by it) */
  energy: number;
  /** its progression's name (default: "a"; builds and drops "b" when the theme has one) */
  prog?: string;
  /** only these sections of the orchestra play in it (a solo piano's ending, the low strings' opening) */
  only?: Layer[];
}
/** A chord of a progression: its symbol (music/theory.ts parseChord: "Fmaj7", "Em/G", "Fq"), the bars it lasts. */
export interface ChordStep {
  chord: string;
  bars: number;
}

/** The percussion's manner: a march (snare, bass drum, timpani), a march in triplets, action (toms and taikos in
 *  3-3-2), taikos, an insistent pulse, a heartbeat, a clock's ticking eighths, booms on the chords, timpani alone. */
export type PercStyle = "march" | "tripletMarch" | "action" | "taiko" | "pulse" | "heartbeat" | "clock" | "booms" | "timpani";
/** The bass: the organ's pedal (32'), low strings' eighths, a march's root and fifth, a held drone, the cellos'
 *  ground bass (the elegy) — each on the chord's bass (its slash's) */
export type BassStyle = "pedal" | "pulse" | "march" | "drone" | "elegy";
/** The strings' chords: held, tremolo, high (the violins' shimmer), the elegy's middle voices, a hymn (re-struck with
 *  the melody, chord and tune moving together). */
export type StringsStyle = "sustain" | "tremolo" | "high" | "elegy" | "hymn";
export interface OstinatoStyle {
  /** pendulum: two notes rocking; spiccato: the root and its neighbours on the grid; organ: sixteenths across the
   *  chord; arpeggio: triplets up and down two octaves; piano: sparse notes on the beats; clock: one note repeated on
   *  the grid (a pedal, a clock's ticking); broken: the left hand's broken chord in eighths */
  pattern: "pendulum" | "spiccato" | "organ" | "arpeggio" | "piano" | "clock" | "broken";
  sound: "spiccato" | "pizz" | "harp" | "celesta" | "piano" | "organ";
  /** its register's centre (MIDI) */
  register: number;
  /** the clock's repeated note (a pitch class: 4 = E) */
  pedal?: number;
}
export interface BrassStyle {
  /** the horns holding the chords; a braam on each chord change; Williams's fanfare stabs; a chorale (the horns'
   *  chord with each note of the melody) */
  chords: boolean;
  braam: boolean;
  fanfare: boolean;
  chorale?: boolean;
}
export type MelodySound = "horn" | "trumpet" | "violins" | "viola" | "cello" | "flute" | "piano" | "organlead";
export interface MelodyStyle {
  sound: MelodySound;
  /** octaves above the theme's root */
  oct: number;
  /** the phrases, one per progression: `degree/beats` tokens in the theme's scale ("4+": raised a semitone, "6-":
   *  lowered; "r": a rest; "/t": a triplet eighth, a third of a beat), whole bars */
  phrases: Record<string, string>;
  /** in the strongest sections, doubled an octave up or down by another section */
  double?: { sound: MelodySound; oct: 1 | -1 };
}
export interface KeysStyle {
  /** the harp's glissando into each new section */
  gliss: boolean;
  /** the celesta's sparkles over the chords */
  sparkle: boolean;
  /** a Shepard tone rising without end */
  shepard: boolean;
}

export interface Theme {
  id: string;
  name: string;
  /** in whose manner, and the score it is built on */
  manner: "zimmer" | "williams" | "richter";
  /** what it is and how it is made, in the game's own words (shown: no real work named — those only in the
   *  comments here) */
  mood: string;
  bpm: number;
  /** beats a bar (3: a waltz's, Day One's), the grid's subdivisions a beat (3: triplets — a 6/8's or 12/8's feel) */
  beats?: 3 | 4;
  grid?: 3 | 4;
  /** the tonic (MIDI, the octave of the chords: ~A3) and its mode (the melody's degrees) */
  root: number;
  scale: ScaleName;
  progressions: Record<string, ChordStep[]>;
  form: Section[];
  /** the section the form loops back to once played through */
  loopFrom: number;
  perc: PercStyle | null;
  bass: BassStyle | null;
  strings: StringsStyle | null;
  ostinato: OstinatoStyle | null;
  brass: BrassStyle | null;
  melody: MelodyStyle | null;
  keys: KeysStyle | null;
  /** the pipe organ's and the choir's levels (0: none), the choir's vowel */
  organ: number;
  choir: number;
  vowel?: "ah" | "oo";
  fx: { reverb: "hall" | "plate" | "cathedral"; wet: number; delay: number; feedback: number };
  /** a tick every so many seconds (Miller's: 1.25 s) */
  tick?: number;
}

const F = (name: SectionName, bars: number, energy: number, o: { prog?: string; only?: Layer[] } = {}): Section => ({
  name,
  bars,
  energy,
  ...o,
});
const BRASS = (chords: boolean, braam: boolean, fanfare: boolean, chorale = false): BrassStyle => ({ chords, braam, fanfare, chorale });
const KEYS = (gliss: boolean, sparkle: boolean, shepard: boolean): KeysStyle => ({ gliss, sparkle, shepard });
/** A progression from its chords' symbols, each "symbol" (a bar) or "symbol:bars". */
const P = (s: string): ChordStep[] =>
  s
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const [chord, bars] = tok.split(":");
      return { chord: chord!, bars: bars ? Number(bars) : 1 };
    });

export const THEMES: Theme[] = [
  {
    id: "event-horizon",
    name: "Event Horizon",
    manner: "zimmer",
    // (after Interstellar — main theme — its harmony and form; named here only)
    mood: "Gargantua: A minor, the VI7 – v6 – i – v65 loop, the organ's clock ticking on an E pedal in triplets, the organ and its pedal, the strings and the choir swelling",
    bpm: 96,
    grid: 3,
    root: 57,
    scale: "minor",
    progressions: { a: P("Fmaj7 Em/G Am Em7/G"), b: P("Fmaj7 G6 Am Em/G") },
    form: [F("intro", 4, 0.22), F("verse", 8, 0.45), F("build", 4, 0.65), F("drop", 8, 0.95), F("break", 4, 0.3)],
    loopFrom: 1,
    perc: "booms",
    bass: "pedal",
    strings: "high",
    ostinato: { pattern: "clock", sound: "organ", register: 76, pedal: 4 },
    brass: BRASS(true, false, false),
    melody: {
      sound: "organlead",
      oct: 0,
      phrases: {
        a: "9/3 7/1 6/2 4/2 7/3 8/1 11/4 11/2 12/2 13/3 11/1 14/2 11/2 10/4",
        b: "12/2 11/2 13/2 11/1 9/1 11/3 7/1 8/2 6/2",
      },
      double: { sound: "horn", oct: -1 },
    },
    keys: null,
    organ: 1,
    choir: 0.6,
    vowel: "ah",
    fx: { reverb: "cathedral", wet: 0.7, delay: 0, feedback: 0 },
  },
  {
    id: "ascent",
    name: "Ascent",
    manner: "williams",
    // (after Star Wars — main title — its harmony and form; named here only)
    mood: "The lift-off: B♭, a fanfare on the tonic, the big tune between the tonic and a chord of fourths on F, A♭ before the dominant, every phrase ending on it, a march in triplets, a lyrical middle for the strings and horns",
    bpm: 104,
    grid: 3,
    root: 58,
    scale: "mixolydian",
    progressions: {
      i: P("Bbq Bb Bbq Fq"),
      a: P("Bb Fq Bb Fq Bb Ab F F"),
      b: P("Bb Ab F Fm"),
      c: P("Eb/G F7sus4 Db F"),
    },
    form: [
      F("intro", 4, 0.6, { prog: "i" }),
      F("verse", 8, 0.75),
      F("build", 4, 0.8),
      F("break", 4, 0.45, { prog: "c" }),
      F("drop", 8, 1, { prog: "a" }),
    ],
    loopFrom: 1,
    perc: "tripletMarch",
    bass: "march",
    strings: "sustain",
    ostinato: { pattern: "spiccato", sound: "spiccato", register: 70 },
    brass: BRASS(true, false, true),
    melody: {
      sound: "trumpet",
      oct: 0,
      phrases: {
        i: "r/4 r/4 r/4 r/4",
        a: "7/1.5 4/0.5 9/2 10/2 7/2 9/1 8/1 9/2 11/3 r/1 9/t 9/t 9/t 11/1 14/2 13/2 10/2 11/1 12/1 8/2 11/4",
        b: "11/2 9/2 10/t 10/t 10/t 13/3 11/2 8/2 13/2 11/2",
        c: "10/4 11/2 8/2 13/2 11/2 8/4",
      },
      double: { sound: "horn", oct: -1 },
    },
    keys: KEYS(true, false, false),
    organ: 0,
    choir: 0,
    fx: { reverb: "hall", wet: 0.38, delay: 0, feedback: 0 },
  },
  {
    id: "reentry",
    name: "Re-entry Fire",
    manner: "williams",
    // (after The Imperial March — its harmony and form; named here only)
    mood: "The plasma: G minor, the low strings, horns and timpani on G minor and E♭ minor, then i – ♯iv – ♯v – i (all minor chords, a semitone off the expected ones), trumpets and trombones in the middle register, the snare",
    bpm: 104,
    root: 55,
    scale: "minor",
    progressions: { a: P("Gm Ebm Gm Ebm"), b: P("Gm C#m D#m Gm") },
    form: [F("intro", 4, 0.4), F("verse", 8, 0.65), F("build", 4, 0.8), F("drop", 8, 1), F("break", 4, 0.45)],
    loopFrom: 1,
    perc: "march",
    bass: "pulse",
    strings: "tremolo",
    ostinato: null,
    brass: BRASS(true, false, false),
    melody: {
      sound: "trumpet",
      oct: 0,
      phrases: { a: "4/2 2/1 0/1 5/2 2/2 4/1 7/1 4/2 2/3 5/1", b: "7/4 3+/2 5+/2 4+/2 6+/2 4/4" },
      double: { sound: "horn", oct: -1 },
    },
    keys: null,
    organ: 0,
    choir: 0,
    fx: { reverb: "hall", wet: 0.42, delay: 0, feedback: 0 },
  },
  {
    id: "final-approach",
    name: "Final Approach",
    manner: "williams",
    // (after E.T. — the Lydian neighbour chord — its harmony and form; named here only)
    mood: "The final, lyrical: F, the tonic and its Lydian neighbour (II over the tonic's bass), a horn line doubled by the violins, the harp's arpeggios, soft timpani",
    bpm: 88,
    root: 65,
    scale: "lydian",
    progressions: { a: P("F G/F F G/F"), b: P("Dm Bb F C") },
    form: [F("intro", 4, 0.25), F("verse", 8, 0.45), F("build", 8, 0.65), F("break", 4, 0.3)],
    loopFrom: 1,
    perc: "timpani",
    bass: "drone",
    strings: "sustain",
    ostinato: { pattern: "arpeggio", sound: "harp", register: 67 },
    brass: BRASS(true, false, false),
    melody: {
      sound: "horn",
      oct: -1,
      phrases: { a: "4/2 2/1 4/1 8/3 6/1 7/2 4/2 5/1 3/1 1/2", b: "5/2 7/2 7/2 5/2 4/2 2/2 4/4" },
      double: { sound: "violins", oct: 1 },
    },
    keys: KEYS(false, true, false),
    organ: 0,
    choir: 0,
    fx: { reverb: "hall", wet: 0.45, delay: 0.75, feedback: 0.2 },
  },
  {
    id: "wormhole",
    name: "Through the Throat",
    manner: "zimmer",
    // (after Interstellar — The Wormhole; Dunkirk's Shepard tone — its harmony and form; named here only)
    mood: "The wormhole: E minor, i – VI – III – VII, a Shepard tone rising without end, the organ's sixteenths, high violins, the choir and the taikos",
    bpm: 120,
    root: 64,
    scale: "minor",
    progressions: { a: P("Em C G D"), b: P("C D Em Em") },
    form: [F("intro", 8, 0.4), F("build", 8, 0.7), F("drop", 16, 1), F("break", 8, 0.45), F("drop", 16, 1)],
    loopFrom: 1,
    perc: "taiko",
    bass: "pedal",
    strings: "high",
    ostinato: { pattern: "organ", sound: "organ", register: 64 },
    brass: BRASS(true, true, false),
    melody: {
      sound: "violins",
      oct: 0,
      phrases: { a: "7/4 9/2 7/2 11/4 10/2 8/2", b: "12/2 11/2 10/4 9/2 7/2 11/4" },
      double: { sound: "horn", oct: -1 },
    },
    keys: KEYS(false, false, true),
    organ: 0.6,
    choir: 0.7,
    vowel: "ah",
    fx: { reverb: "cathedral", wet: 0.55, delay: 0, feedback: 0 },
  },
  {
    id: "millers-tide",
    name: "Miller's Tide",
    manner: "zimmer",
    // (after Interstellar — Mountains — its harmony and form; named here only)
    mood: "Miller: the tick every 1.25 s (an hour there, seven years on Earth), A minor, the organ low with Fmaj7 and G6, the strings and the horns swelling like the wave, booms",
    bpm: 48,
    root: 57,
    scale: "minor",
    progressions: { a: P("Am:2 Fmaj7:2 Dm/F:2 Esus4:2"), b: P("Fmaj7:2 G6:2 Am:4") },
    form: [F("intro", 8, 0.25), F("verse", 8, 0.45), F("build", 8, 0.65), F("drop", 8, 0.85), F("break", 8, 0.3)],
    loopFrom: 1,
    perc: "booms",
    bass: "pedal",
    strings: "sustain",
    ostinato: null,
    brass: BRASS(true, true, false),
    melody: {
      sound: "horn",
      oct: 0,
      phrases: { a: "4/4 2/4 4/2 5/2 7/4 5/4 3/4 4/4 1/4", b: "5/4 4/4 6/4 4/4 2/8 0/8" },
    },
    keys: null,
    organ: 0.8,
    choir: 0.4,
    vowel: "oo",
    fx: { reverb: "cathedral", wet: 0.6, delay: 0, feedback: 0 },
    tick: 1.25,
  },
  {
    id: "orbit-drift",
    name: "Earthlight",
    manner: "richter",
    // (after On the Nature of Daylight — its harmony and form; named here only)
    mood: "In orbit: B♭ minor at 61 BPM, a ground bass under i – v6 – III6 – VI – VII looping unchanged, the low strings first, the violins' long melody later, built up and stripped back like a palindrome",
    bpm: 61,
    root: 58,
    scale: "minor",
    progressions: { a: P("Bbm:2 Fm/Ab:2 Db/F:2 Gb Ab"), b: P("Bbm:2 Fm/Ab:2 Db/F:2 Gb Ab") },
    form: [
      F("intro", 8, 0.25, { only: ["bass", "strings"] }),
      F("verse", 8, 0.45),
      F("build", 8, 0.65),
      F("drop", 8, 0.9),
      F("verse", 8, 0.5),
      F("outro", 8, 0.25, { only: ["bass", "strings"] }),
    ],
    loopFrom: 0,
    perc: null,
    bass: "elegy",
    strings: "elegy",
    ostinato: null,
    brass: null,
    melody: {
      sound: "violins",
      oct: 0,
      phrases: {
        a: "9/4 11/4 8/6 6/2 6/4 4/4 5/2 7/2 8/4",
        b: "11/4 14/4 13/4 11/2 15/2 16/4 13/4 12/2 14/2 15/4",
      },
      double: { sound: "viola", oct: -1 },
    },
    keys: null,
    organ: 0,
    choir: 0,
    fx: { reverb: "hall", wet: 0.5, delay: 0, feedback: 0 },
  },
  {
    id: "low-pass",
    name: "Low Pass",
    manner: "williams",
    // (after E.T. — Flying — its harmony and form; named here only)
    mood: "Flying low and fast: C with its Lydian neighbour chord (D over C), the violins soaring, brass stabs, the strings' sixteenths, the harp and the celesta, timpani and cymbals",
    bpm: 132,
    root: 60,
    scale: "lydian",
    progressions: { a: P("C D/C C D/C"), b: P("Am F C G F Am D G") },
    form: [F("intro", 4, 0.45), F("verse", 8, 0.65), F("build", 8, 0.8), F("drop", 8, 1), F("break", 4, 0.5)],
    loopFrom: 1,
    perc: "action",
    bass: "pulse",
    strings: "sustain",
    ostinato: { pattern: "spiccato", sound: "spiccato", register: 67 },
    brass: BRASS(true, false, true),
    melody: {
      sound: "violins",
      oct: 0,
      phrases: {
        a: "9/1 11/1 14/2 12/1.5 10/0.5 8/2 9/2 7/2 10/3 r/1",
        b: "12/2 9/2 14/2 12/2 11/1 9/1 7/2 8/2 6/2 12/2 14/2 16/2 14/2 15/2 12/2 11/4",
      },
      double: { sound: "trumpet", oct: -1 },
    },
    keys: KEYS(true, true, false),
    organ: 0,
    choir: 0,
    fx: { reverb: "hall", wet: 0.34, delay: 0, feedback: 0 },
  },
  {
    id: "docking",
    name: "Soft Capture",
    manner: "zimmer",
    // (after Interstellar — No Time for Caution — its harmony and form; named here only)
    mood: "Docking: A minor, Am – F – C – G, the organ's sixteenths building, a clock ticking in eighths, the strings held, a horn line at the height, braams at the climax",
    bpm: 104,
    root: 57,
    scale: "minor",
    progressions: { a: P("Am F C G"), b: P("F G Am Am") },
    form: [F("intro", 4, 0.3), F("verse", 8, 0.5), F("build", 8, 0.7), F("drop", 8, 0.95), F("break", 4, 0.35)],
    loopFrom: 1,
    perc: "clock",
    bass: "pedal",
    strings: "sustain",
    ostinato: { pattern: "organ", sound: "organ", register: 67 },
    brass: BRASS(true, true, false),
    melody: { sound: "horn", oct: 0, phrases: { a: "4/4 5/2 7/2 6/2 4/2 1/2 6/2", b: "5/2 7/2 6/2 8/2 7/4 4/4" } },
    keys: null,
    organ: 0.75,
    choir: 0.3,
    vowel: "ah",
    fx: { reverb: "cathedral", wet: 0.5, delay: 0, feedback: 0 },
  },
  {
    id: "deep-space",
    name: "Deep Space",
    manner: "zimmer",
    // (after Interstellar — Day One — its harmony and form; named here only)
    mood: "Between the worlds: A minor in 3/4, the piano's left hand in broken chords, a few notes over them, the organ and the choir held far away",
    bpm: 92,
    beats: 3,
    root: 57,
    scale: "minor",
    progressions: { a: P("Am:2 F:2 C:2 G:2"), b: P("F:2 G:2 Am:2 Em:2") },
    form: [F("intro", 8, 0.2), F("verse", 16, 0.4), F("build", 8, 0.55), F("break", 8, 0.25)],
    loopFrom: 1,
    perc: null,
    bass: "drone",
    strings: "sustain",
    ostinato: { pattern: "broken", sound: "piano", register: 57 },
    brass: null,
    melody: {
      sound: "piano",
      oct: 0,
      phrases: { a: "11/2 9/1 7/3 12/2 11/1 9/3 11/2 13/1 11/3 10/2 8/1 6/3", b: "12/3 9/3 13/2 10/1 8/3 7/3 9/3 6/3 4/3" },
    },
    keys: null,
    organ: 0.35,
    choir: 0.5,
    vowel: "oo",
    fx: { reverb: "cathedral", wet: 0.65, delay: 1, feedback: 0.25 },
  },
  {
    id: "endurance",
    name: "Endurance",
    manner: "zimmer",
    // (after Inception — Time — its harmony and form; named here only)
    mood: "The ship's theme: E minor at 60 BPM, Am – Em – G – D – Am – Cmaj7 – G – D (the Cmaj7 its lift), an insistent drum, the layers added one by one to the horns' climax, a solo piano to end",
    bpm: 60,
    root: 64,
    scale: "minor",
    progressions: { a: P("Am Em G D Am Cmaj7 G D") },
    form: [
      F("intro", 8, 0.25),
      F("verse", 8, 0.45),
      F("build", 8, 0.65),
      F("drop", 8, 0.95),
      F("drop", 8, 1),
      F("break", 8, 0.3, { only: ["ostinato"] }),
    ],
    loopFrom: 1,
    perc: "pulse",
    bass: "pedal",
    strings: "sustain",
    ostinato: { pattern: "broken", sound: "piano", register: 57 },
    brass: BRASS(true, true, false),
    melody: {
      sound: "horn",
      oct: 0,
      phrases: { a: "3/4 4/2 2/2 6/3 4/1 3/4 5/2 7/2 11/2 7/2 9/3 6/1 8/4" },
      double: { sound: "trumpet", oct: 1 },
    },
    keys: null,
    organ: 0,
    choir: 0.45,
    vowel: "ah",
    fx: { reverb: "hall", wet: 0.5, delay: 0, feedback: 0 },
  },
  {
    id: "new-worlds",
    name: "New Worlds",
    manner: "williams",
    // (after Jurassic Park — main theme — its harmony and form; named here only)
    mood: "On foot on another world: B♭ major, reverently, I(add9) – V7sus4 to open, then I – IV – I (the IV resolving back home), only major chords, a hymn where chord and tune move together, low strings and horns first, the choir later, A♭ at the climaxes",
    bpm: 76,
    root: 58,
    scale: "major",
    progressions: { i: P("Bbadd9:2 F7sus4:2"), a: P("Bb Eb/Bb Bb F"), b: P("Eb Bb Eb Bb Ab Eb F:2") },
    form: [F("intro", 4, 0.25, { prog: "i" }), F("verse", 8, 0.45), F("build", 8, 0.65), F("drop", 8, 0.85), F("break", 4, 0.3)],
    loopFrom: 1,
    perc: "timpani",
    bass: "drone",
    strings: "hymn",
    ostinato: null,
    brass: BRASS(false, false, false, true),
    melody: {
      sound: "horn",
      oct: 0,
      phrases: {
        i: "r/4 r/4 r/4 r/4",
        a: "4/1.5 2/0.5 4/2 5/1.5 3/0.5 7/2 2/1 4/1 7/2 8/3 r/1",
        b: "10/1.5 9/0.5 7/2 9/2 11/2 12/1.5 10/0.5 12/2 11/4 10/2 8/2 10/2 12/2 11/2 13/2 11/4",
      },
      double: { sound: "violins", oct: 1 },
    },
    keys: null,
    organ: 0,
    choir: 0.4,
    vowel: "ah",
    fx: { reverb: "hall", wet: 0.48, delay: 0, feedback: 0 },
  },
];

export const THEME_BY_ID: Record<string, Theme> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

/** A theme's beats a bar and its grid's subdivisions a beat. */
export const beatsOf = (t: Theme) => t.beats ?? 4;
export const gridOf = (t: Theme) => t.grid ?? 4;

/**
 * A phrase's notes: `degree/beats` tokens ("r": a rest; "4+" raised a semitone, "6-" lowered; "/t": a triplet
 * eighth, a third of a beat) → their start [beats from the phrase's], length, degree and alteration (null: a rest);
 * its length [beats].
 */
export function parsePhrase(p: string): { notes: { at: number; dur: number; deg: number | null; acc: number }[]; beats: number } {
  let at = 0;
  const notes = p
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const [d, l] = tok.split("/");
      const dur = l === "t" ? 1 / 3 : Number(l);
      const m = /^(-?\d+)([+-]?)$/.exec(d!);
      const n = {
        at: Math.round(at * 1e6) / 1e6,
        dur,
        deg: d === "r" || !m ? null : Number(m[1]),
        acc: m?.[2] === "+" ? 1 : m?.[2] === "-" ? -1 : 0,
      };
      at += dur;
      return n;
    });
  return { notes, beats: Math.round(at * 1e6) / 1e6 };
}
