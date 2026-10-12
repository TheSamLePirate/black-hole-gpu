// The score's themes: an orchestral score in three manners — Hans Zimmer's (the pipe organ and its pedal, the
// minimal ostinatos of strings or organ, the ticking clock, the braams and the taikos, the rising Shepard tone, the
// choir), John Williams's (the heroic brass melody with its leaps, the Lydian brightness, the march's snare and the
// timpani, the string ostinatos, the harp and the celesta) and Max Richter's (a string elegy: a slow loop of chords,
// the viola's long melody, the violins over it later, the cellos under). The melodies are this game's own, written
// in the manner, not taken from any film: each theme its key, mode and tempo, its form (intro, verse, build, drop,
// break: each a few bars and an energy), its progressions, its melody (phrases in the scale's degrees, fitted to
// the progressions' chords) and its orchestra. The composer (music/composer.ts) plays them bar by bar; the energy —
// the section's, raised or lowered by the flight's intensity — decides which sections of the orchestra play.
// Data only.

import type { ChordKind, ScaleName } from "./theory";

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
}
export interface ChordStep {
  /** the scale's degree (0: the tonic) */
  deg: number;
  kind?: ChordKind;
  /** bars it lasts (1 by default) */
  bars?: number;
}

/** The percussion's manner: a march (snare, bass drum, timpani), action (toms and taikos in 3-3-2), taikos, a
 *  heartbeat, a clock's ticking eighths, booms on the chords, timpani alone. */
export type PercStyle = "march" | "action" | "taiko" | "heartbeat" | "clock" | "booms" | "timpani";
/** The bass: the organ's pedal (32'), low strings' eighths, a march's root and fifth, a held drone, the cellos'
 *  whole notes (the elegy). */
export type BassStyle = "pedal" | "pulse" | "march" | "drone" | "elegy";
/** The strings' chords: held, tremolo, high (the violins' shimmer), the elegy's middle voices. */
export type StringsStyle = "sustain" | "tremolo" | "high" | "elegy";
export interface OstinatoStyle {
  /** pendulum: two notes rocking in eighths; spiccato: sixteenths on the root and its neighbours; organ: sixteenths
   *  across the chord; arpeggio: triplets up and down two octaves; piano: sparse notes on the beats */
  pattern: "pendulum" | "spiccato" | "organ" | "arpeggio" | "piano";
  sound: "spiccato" | "pizz" | "harp" | "celesta" | "piano" | "organ";
  /** its register's centre (MIDI) */
  register: number;
}
export interface BrassStyle {
  /** the horns holding the chords; a braam on each chord change; Williams's fanfare stabs */
  chords: boolean;
  braam: boolean;
  fanfare: boolean;
}
export type MelodySound = "horn" | "trumpet" | "violins" | "viola" | "cello" | "flute" | "piano" | "organlead";
export interface MelodyStyle {
  sound: MelodySound;
  /** octaves above the chords' octave (the theme's root) */
  oct: number;
  /** the phrases, one per progression ("a", "b"): `degree/beats` tokens ("r/2": a rest), in bars of four beats */
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
  /** in whose manner */
  manner: "zimmer" | "williams" | "richter";
  mood: string;
  bpm: number;
  /** the tonic (MIDI, the octave of the chords: ~A3) and its mode */
  root: number;
  scale: ScaleName;
  progressions: Record<string, ChordStep[]>;
  form: Section[];
  /** the section the form loops back to once played through (the intro not again) */
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

const F = (name: SectionName, bars: number, energy: number, prog?: string): Section => ({ name, bars, energy, ...(prog ? { prog } : {}) });
const BRASS = (chords: boolean, braam: boolean, fanfare: boolean): BrassStyle => ({ chords, braam, fanfare });
const KEYS = (gliss: boolean, sparkle: boolean, shepard: boolean): KeysStyle => ({ gliss, sparkle, shepard });

export const THEMES: Theme[] = [
  {
    id: "event-horizon",
    name: "Event Horizon",
    manner: "zimmer",
    mood: "Gargantua, in Hans Zimmer's manner: the pipe organ and its 32-foot pedal, a long melody rising on the organ, the strings and the choir swelling, booms far away",
    bpm: 60,
    root: 57,
    scale: "minor",
    progressions: {
      a: [
        { deg: 0, kind: "add9", bars: 2 },
        { deg: 5, kind: "seventh", bars: 2 },
        { deg: 2, kind: "add9", bars: 2 },
        { deg: 6, kind: "sus2", bars: 2 },
      ],
      b: [
        { deg: 0, kind: "add9" },
        { deg: 5, kind: "triad" },
        { deg: 3, kind: "seventh" },
        { deg: 4, kind: "sus4" },
      ],
    },
    form: [F("intro", 8, 0.2), F("verse", 16, 0.45), F("build", 8, 0.65), F("drop", 16, 0.92), F("break", 8, 0.3)],
    loopFrom: 1,
    perc: "booms",
    bass: "pedal",
    strings: "high",
    ostinato: { pattern: "pendulum", sound: "organ", register: 69 },
    brass: BRASS(true, false, false),
    melody: {
      sound: "organlead",
      oct: 0,
      phrases: {
        a: "4/3 7/1 8/4 9/3 7/1 11/4 11/3 10/1 9/4 10/2 11/2 7/4",
        b: "7/2 11/2 12/3 9/1 10/2 12/2 11/4",
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
    mood: "The lift-off, in John Williams's manner: a heroic trumpet melody leaping in D Lydian, the horns under it, string sixteenths, the snare's march, timpani and the harp's glissandi",
    bpm: 112,
    root: 62,
    scale: "lydian",
    progressions: {
      a: [
        { deg: 0, kind: "add9" },
        { deg: 1, kind: "triad" },
        { deg: 5, kind: "triad" },
        { deg: 4, kind: "triad" },
      ],
      b: [
        { deg: 0, kind: "triad" },
        { deg: 4, kind: "triad" },
        { deg: 5, kind: "triad" },
        { deg: 1, kind: "triad" },
      ],
    },
    form: [F("intro", 4, 0.35), F("verse", 8, 0.55), F("build", 4, 0.75), F("drop", 8, 1), F("break", 4, 0.45), F("drop", 8, 1)],
    loopFrom: 1,
    perc: "march",
    bass: "march",
    strings: "sustain",
    ostinato: { pattern: "spiccato", sound: "spiccato", register: 69 },
    brass: BRASS(true, false, true),
    melody: {
      sound: "trumpet",
      oct: 0,
      phrases: {
        a: "4/1.5 2/0.5 4/1 9/1 8/2 10/1 8/1 7/1.5 5/0.5 6/1 7/1 8/3 r/1",
        b: "9/2 11/1 9/1 8/1.5 6/0.5 8/2 9/1 7/1 5/2 10/3 r/1",
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
    manner: "zimmer",
    mood: "The plasma, in Hans Zimmer's manner: braams of low brass on every chord, taikos, the low strings' eighths, a menacing half-step motif in D Phrygian, the choir",
    bpm: 92,
    root: 62,
    scale: "phrygian",
    progressions: {
      a: [
        { deg: 0, kind: "power" },
        { deg: 1, kind: "triad" },
        { deg: 0, kind: "power" },
        { deg: 6, kind: "triad" },
      ],
      b: [
        { deg: 0, kind: "triad" },
        { deg: 5, kind: "triad" },
        { deg: 1, kind: "triad" },
        { deg: 6, kind: "triad" },
      ],
    },
    form: [F("intro", 4, 0.35), F("verse", 8, 0.6), F("build", 4, 0.8), F("drop", 16, 1), F("break", 4, 0.45)],
    loopFrom: 1,
    perc: "taiko",
    bass: "pulse",
    strings: "tremolo",
    ostinato: null,
    brass: BRASS(false, true, false),
    melody: {
      sound: "horn",
      oct: -1,
      phrases: {
        a: "0/1.5 1/0.5 0/2 1/3 r/1 0/1.5 1/0.5 4/2 3/2 1/2",
        b: "4/1.5 5/0.5 4/2 5/3 r/1 3/1.5 1/0.5 3/2 1/4",
      },
      double: { sound: "cello", oct: -1 },
    },
    keys: null,
    organ: 0,
    choir: 0.8,
    vowel: "ah",
    fx: { reverb: "hall", wet: 0.45, delay: 0, feedback: 0 },
  },
  {
    id: "final-approach",
    name: "Final Approach",
    manner: "williams",
    mood: "The final, in John Williams's manner: a lyrical horn line in F Lydian, the strings held, the harp's arpeggios, soft timpani",
    bpm: 96,
    root: 65,
    scale: "lydian",
    progressions: {
      a: [
        { deg: 0, kind: "add9" },
        { deg: 4, kind: "sus2" },
        { deg: 2, kind: "seventh" },
        { deg: 1, kind: "add9" },
      ],
    },
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
      phrases: { a: "4/2 2/1 4/1 8/3 7/1 6/2 4/2 5/1 3/1 1/2" },
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
    mood: "The wormhole, in Hans Zimmer's manner: a Shepard tone rising without end, the organ's sixteenths, high violins, the choir and the taikos",
    bpm: 120,
    root: 64,
    scale: "minor",
    progressions: {
      a: [
        { deg: 0, kind: "add9" },
        { deg: 5, kind: "add9" },
        { deg: 2, kind: "add9" },
        { deg: 6, kind: "sus2" },
      ],
      b: [
        { deg: 5, kind: "seventh" },
        { deg: 6, kind: "triad" },
        { deg: 0, kind: "add9" },
        { deg: 4, kind: "sus4" },
      ],
    },
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
      phrases: { a: "7/4 9/2 7/2 10/4 7/4", b: "12/2 11/2 10/4 9/2 7/2 8/4" },
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
    mood: "Miller, in Hans Zimmer's manner: the 1.25 s tick, the organ low, the strings and the horns swelling like the wave, booms",
    bpm: 48,
    root: 57,
    scale: "minor",
    progressions: {
      a: [
        { deg: 0, kind: "add9", bars: 2 },
        { deg: 5, kind: "add9", bars: 2 },
      ],
      b: [
        { deg: 3, kind: "seventh", bars: 2 },
        { deg: 4, kind: "sus4", bars: 2 },
      ],
    },
    form: [F("intro", 4, 0.25), F("verse", 8, 0.45), F("build", 4, 0.6), F("drop", 8, 0.8), F("break", 4, 0.3)],
    loopFrom: 1,
    perc: "booms",
    bass: "pedal",
    strings: "sustain",
    ostinato: null,
    brass: BRASS(true, true, false),
    melody: {
      sound: "horn",
      oct: 0,
      phrases: { a: "4/4 3/2 2/2 2/4 0/4", b: "3/4 2/2 0/2 1/4 4/4" },
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
    mood: "In orbit, in Max Richter's manner (On the Nature of Daylight): a string elegy — a slow loop of chords, the viola's long melody, the violins over it later, the cellos under",
    bpm: 54,
    root: 53,
    scale: "minor",
    progressions: {
      a: [{ deg: 0 }, { deg: 5 }, { deg: 2 }, { deg: 6 }],
      b: [{ deg: 3 }, { deg: 5 }, { deg: 0, kind: "add9" }, { deg: 4, kind: "sus4" }],
    },
    form: [F("intro", 4, 0.2), F("verse", 8, 0.4), F("verse", 8, 0.55), F("build", 4, 0.7, "b"), F("drop", 8, 0.85), F("break", 4, 0.3)],
    loopFrom: 1,
    perc: null,
    bass: "elegy",
    strings: "elegy",
    ostinato: null,
    brass: null,
    melody: {
      sound: "viola",
      oct: 0,
      phrases: {
        a: "4/4 5/2 4/2 4/4 3/2 1/2 2/3 4/1 7/2 5/2 6/2 4/2 3/4",
        b: "10/2 12/2 12/2 11/2 9/2 8/2 7/4",
      },
      double: { sound: "violins", oct: 1 },
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
    mood: "Flying low and fast, in John Williams's manner: trumpets' fanfare in A harmonic minor, brass stabs, the strings' driving sixteenths, toms and timpani",
    bpm: 138,
    root: 57,
    scale: "harmonicMinor",
    progressions: {
      a: [
        { deg: 0, kind: "triad" },
        { deg: 5, kind: "triad" },
        { deg: 3, kind: "triad" },
        { deg: 4, kind: "triad" },
      ],
      b: [
        { deg: 5, kind: "triad" },
        { deg: 3, kind: "triad" },
        { deg: 0, kind: "triad" },
        { deg: 4, kind: "triad" },
      ],
    },
    form: [F("intro", 4, 0.45), F("verse", 8, 0.65), F("build", 4, 0.8), F("drop", 8, 1), F("break", 4, 0.5)],
    loopFrom: 1,
    perc: "action",
    bass: "pulse",
    strings: "sustain",
    ostinato: { pattern: "spiccato", sound: "spiccato", register: 64 },
    brass: BRASS(true, false, true),
    melody: {
      sound: "trumpet",
      oct: 0,
      phrases: {
        a: "7/1 7/0.5 7/0.5 11/2 12/1.5 11/0.5 9/2 10/1 9/1 7/1 5/1 6/2 4/2",
        b: "12/2 9/2 10/1.5 9/0.5 7/2 9/1 11/1 14/2 13/3 r/1",
      },
      double: { sound: "horn", oct: -1 },
    },
    keys: KEYS(true, false, false),
    organ: 0,
    choir: 0,
    fx: { reverb: "hall", wet: 0.32, delay: 0, feedback: 0 },
  },
  {
    id: "docking",
    name: "Soft Capture",
    manner: "zimmer",
    mood: "Docking, in Hans Zimmer's manner: the organ's sixteenths building, a clock ticking in eighths, the strings held, a horn line at the height",
    bpm: 96,
    root: 55,
    scale: "minor",
    progressions: {
      a: [
        { deg: 0, kind: "sus2" },
        { deg: 0, kind: "add9" },
        { deg: 5, kind: "sus2" },
        { deg: 4, kind: "sus4" },
      ],
    },
    form: [F("intro", 4, 0.3), F("verse", 8, 0.5), F("build", 8, 0.7), F("drop", 8, 0.9), F("break", 4, 0.35)],
    loopFrom: 1,
    perc: "clock",
    bass: "pedal",
    strings: "sustain",
    ostinato: { pattern: "organ", sound: "organ", register: 67 },
    brass: BRASS(true, false, false),
    melody: { sound: "horn", oct: 1, phrases: { a: "4/4 2/2 4/2 5/2 6/2 4/4" } },
    keys: null,
    organ: 0.7,
    choir: 0,
    fx: { reverb: "cathedral", wet: 0.5, delay: 0, feedback: 0 },
  },
  {
    id: "deep-space",
    name: "Deep Space",
    manner: "zimmer",
    mood: "Between the worlds, in Hans Zimmer's manner: a few piano notes in a vast hall, the organ and the choir held, the strings low",
    bpm: 64,
    root: 61,
    scale: "minor",
    progressions: {
      a: [
        { deg: 0, kind: "add9", bars: 2 },
        { deg: 3, kind: "add9", bars: 2 },
        { deg: 5, kind: "seventh", bars: 2 },
        { deg: 4, kind: "sus4", bars: 2 },
      ],
    },
    form: [F("intro", 8, 0.15), F("verse", 16, 0.35), F("build", 8, 0.5), F("break", 8, 0.2)],
    loopFrom: 1,
    perc: "heartbeat",
    bass: "drone",
    strings: "sustain",
    ostinato: { pattern: "piano", sound: "piano", register: 76 },
    brass: null,
    melody: { sound: "piano", oct: 0, phrases: { a: "7/2 4/2 8/4 10/2 7/2 11/4 9/2 7/2 5/4 8/2 7/2 4/4" } },
    keys: null,
    organ: 0.35,
    choir: 0.6,
    vowel: "oo",
    fx: { reverb: "cathedral", wet: 0.7, delay: 1, feedback: 0.3 },
  },
  {
    id: "endurance",
    name: "Endurance",
    manner: "zimmer",
    mood: "The ship's theme, in Hans Zimmer's manner with John Williams's horns: the organ and the strings' eighths, taikos, braams, a heroic horn melody in E minor, the choir",
    bpm: 96,
    root: 64,
    scale: "minor",
    progressions: {
      a: [
        { deg: 0, kind: "triad" },
        { deg: 5, kind: "triad" },
        { deg: 3, kind: "triad" },
        { deg: 4, kind: "triad" },
      ],
      b: [
        { deg: 5, kind: "add9" },
        { deg: 2, kind: "triad" },
        { deg: 6, kind: "triad" },
        { deg: 4, kind: "sus4" },
      ],
    },
    form: [F("intro", 8, 0.3), F("verse", 8, 0.55), F("build", 8, 0.75), F("drop", 16, 1), F("break", 8, 0.4)],
    loopFrom: 1,
    perc: "taiko",
    bass: "pulse",
    strings: "sustain",
    ostinato: { pattern: "pendulum", sound: "spiccato", register: 67 },
    brass: BRASS(true, true, false),
    melody: {
      sound: "horn",
      oct: -1,
      phrases: { a: "4/1 7/2 9/1 9/1.5 8/0.5 7/2 7/1 8/1 9/1 10/1 11/2 8/2", b: "9/2 12/2 11/3 9/1 10/2 8/2 11/4" },
      double: { sound: "trumpet", oct: 1 },
    },
    keys: null,
    organ: 0.7,
    choir: 0.7,
    vowel: "ah",
    fx: { reverb: "hall", wet: 0.5, delay: 0, feedback: 0 },
  },
  {
    id: "new-worlds",
    name: "New Worlds",
    manner: "williams",
    mood: "On foot on another world, in John Williams's manner: wonder in D Lydian — the flute and the violins, the celesta's sparkles, the harp, strings held",
    bpm: 84,
    root: 62,
    scale: "lydian",
    progressions: {
      a: [
        { deg: 0, kind: "seventh" },
        { deg: 1, kind: "triad" },
        { deg: 4, kind: "triad" },
        { deg: 5, kind: "triad" },
      ],
    },
    form: [F("intro", 4, 0.25), F("verse", 8, 0.45), F("build", 8, 0.65), F("break", 4, 0.3)],
    loopFrom: 1,
    perc: "timpani",
    bass: "drone",
    strings: "sustain",
    ostinato: { pattern: "arpeggio", sound: "harp", register: 66 },
    brass: BRASS(true, false, false),
    melody: {
      sound: "flute",
      oct: 0,
      phrases: { a: "9/1 11/1 13/2 12/1.5 10/0.5 8/2 8/1 9/1 11/2 12/3 9/1" },
      double: { sound: "violins", oct: -1 },
    },
    keys: KEYS(true, true, false),
    organ: 0,
    choir: 0.2,
    vowel: "oo",
    fx: { reverb: "hall", wet: 0.45, delay: 0.75, feedback: 0.2 },
  },
];

export const THEME_BY_ID: Record<string, Theme> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

/** A phrase's notes: `degree/beats` tokens ("r/…": a rest) → their start [beats from the phrase's], length, degree
 *  (null: a rest); its length [beats]. */
export function parsePhrase(p: string): { notes: { at: number; dur: number; deg: number | null }[]; beats: number } {
  let at = 0;
  const notes = p
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const [d, l] = tok.split("/");
      const dur = Number(l);
      const n = { at, dur, deg: d === "r" ? null : Number(d) };
      at += dur;
      return n;
    });
  return { notes, beats: at };
}
