// The score's themes: each a piece in its own key, mode and tempo — its form (intro, verse, build, drop, break,
// outro: each a few bars and an energy), its progressions, its band (the drums' style, the sub bass, the pads,
// the arpeggio, the lead, the ethereal guitar, the organ, the choir) and its space (the reverb, the delay).
// The composer (music/composer.ts) plays them bar by bar; the energy — the section's, raised or lowered by the
// flight's intensity — decides which of the band play. Data only.

import type { ChordKind, ScaleName } from "./theory";

/** The band's sections, each its own bus in the mixer (music/engine.ts). */
export type Layer = "drums" | "bass" | "pad" | "arp" | "lead" | "guitar" | "organ" | "choir";
export const LAYERS: Layer[] = ["drums", "bass", "pad", "arp", "lead", "guitar", "organ", "choir"];

export type SectionName = "intro" | "verse" | "build" | "drop" | "break" | "outro";
export interface Section {
  name: SectionName;
  bars: number;
  /** its energy 0 … 1 (the band's layers enter by it) */
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

export type DrumStyle = "four" | "half" | "break" | "epic" | "pulse" | "tribal" | "booms";
export type BassStyle = "sub" | "pulse" | "octave" | "synco" | "drone" | "growl";
export type PadSound = "supersaw" | "warm" | "glass";
export interface ArpStyle {
  pattern: "up" | "updown" | "cascade" | "random";
  /** notes per beat (2: eighths, 3: triplets, 4: sixteenths) */
  rate: 2 | 3 | 4;
  octaves: 1 | 2;
  sound: "pluck" | "bell" | "glass";
}
export interface LeadStyle {
  sound: "saw" | "soft" | "bell";
  /** its register's centre (MIDI), notes per bar about */
  register: number;
  density: number;
}
export interface GuitarStyle {
  style: "arp" | "swell" | "harmonics";
}

export interface Theme {
  id: string;
  name: string;
  mood: string;
  bpm: number;
  /** the tonic (MIDI, the octave of the chords: ~A3) and its mode */
  root: number;
  scale: ScaleName;
  progressions: Record<string, ChordStep[]>;
  form: Section[];
  /** the section the form loops back to once played through (the intro not again) */
  loopFrom: number;
  drums: DrumStyle | null;
  bass: BassStyle | null;
  pad: PadSound | null;
  arp: ArpStyle | null;
  lead: LeadStyle | null;
  guitar: GuitarStyle | null;
  /** the Interstellar organ's and the choir's levels (0: none) */
  organ: number;
  choir: number;
  fx: { reverb: "hall" | "plate" | "cathedral"; wet: number; delay: number; feedback: number };
  /** a tick every so many seconds (Miller's: 1.25 s), its beat */
  tick?: number;
  /** the swing of the off sixteenths (0 … 0.3) */
  swing?: number;
}

const F = (name: SectionName, bars: number, energy: number, prog?: string): Section => ({ name, bars, energy, ...(prog ? { prog } : {}) });

export const THEMES: Theme[] = [
  {
    id: "event-horizon",
    name: "Event Horizon",
    mood: "Gargantua: the organ over a sub drone, the ethereal guitar's swells, distant booms",
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
    form: [F("intro", 8, 0.2), F("verse", 16, 0.45), F("build", 8, 0.65), F("drop", 16, 0.9), F("break", 8, 0.3)],
    loopFrom: 1,
    drums: "booms",
    bass: "drone",
    pad: "warm",
    arp: { pattern: "updown", rate: 2, octaves: 2, sound: "glass" },
    lead: null,
    guitar: { style: "swell" },
    organ: 1,
    choir: 0.5,
    fx: { reverb: "cathedral", wet: 0.6, delay: 0.75, feedback: 0.45 },
  },
  {
    id: "ascent",
    name: "Ascent",
    mood: "The lift-off: four on the floor building, supersaws, a bright arpeggio, a lead climbing",
    bpm: 124,
    root: 62,
    scale: "lydian",
    progressions: {
      a: [
        { deg: 0, kind: "add9" },
        { deg: 4, kind: "sus2" },
        { deg: 5, kind: "seventh" },
        { deg: 1, kind: "add9" },
      ],
      b: [
        { deg: 5, kind: "add9" },
        { deg: 3, kind: "seventh" },
        { deg: 0, kind: "add9" },
        { deg: 4, kind: "sus4" },
      ],
    },
    form: [F("intro", 8, 0.3), F("verse", 16, 0.55), F("build", 8, 0.75), F("drop", 16, 1), F("break", 8, 0.4), F("drop", 16, 1)],
    loopFrom: 1,
    drums: "four",
    bass: "octave",
    pad: "supersaw",
    arp: { pattern: "up", rate: 4, octaves: 2, sound: "pluck" },
    lead: { sound: "saw", register: 76, density: 5 },
    guitar: { style: "arp" },
    organ: 0,
    choir: 0,
    fx: { reverb: "hall", wet: 0.35, delay: 0.75, feedback: 0.35 },
  },
  {
    id: "reentry",
    name: "Re-entry Fire",
    mood: "The plasma: taikos and toms, a growling bass, the choir, dark pads in Phrygian",
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
        { deg: 4, kind: "power" },
      ],
    },
    form: [F("intro", 4, 0.35), F("verse", 8, 0.6), F("build", 4, 0.8), F("drop", 16, 1), F("break", 4, 0.45)],
    loopFrom: 1,
    drums: "tribal",
    bass: "growl",
    pad: "warm",
    arp: { pattern: "cascade", rate: 3, octaves: 1, sound: "bell" },
    lead: null,
    guitar: { style: "harmonics" },
    organ: 0,
    choir: 0.8,
    fx: { reverb: "hall", wet: 0.45, delay: 0.5, feedback: 0.3 },
  },
  {
    id: "final-approach",
    name: "Final Approach",
    mood: "The final: a soft pulse, the ethereal guitar's arpeggio, glass pads, a quiet sub",
    bpm: 100,
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
    form: [F("intro", 4, 0.25), F("verse", 16, 0.45), F("build", 8, 0.6), F("break", 8, 0.3)],
    loopFrom: 1,
    drums: "pulse",
    bass: "sub",
    pad: "glass",
    arp: { pattern: "updown", rate: 2, octaves: 1, sound: "glass" },
    lead: { sound: "soft", register: 74, density: 3 },
    guitar: { style: "arp" },
    organ: 0,
    choir: 0.25,
    fx: { reverb: "plate", wet: 0.45, delay: 0.75, feedback: 0.5 },
  },
  {
    id: "wormhole",
    name: "Through the Throat",
    mood: "The wormhole: half-time breaks, cascading arpeggios, supersaws and the choir, the guitar's harmonics",
    bpm: 140,
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
    drums: "half",
    bass: "synco",
    pad: "supersaw",
    arp: { pattern: "cascade", rate: 4, octaves: 2, sound: "pluck" },
    lead: { sound: "saw", register: 79, density: 4 },
    guitar: { style: "harmonics" },
    organ: 0.4,
    choir: 0.6,
    fx: { reverb: "cathedral", wet: 0.5, delay: 0.75, feedback: 0.45 },
  },
  {
    id: "millers-tide",
    name: "Miller's Tide",
    mood: "Miller: the 1.25 s tick, the organ low, the sub's slow swell, the guitar like a wave",
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
    form: [F("intro", 4, 0.25), F("verse", 8, 0.45), F("build", 4, 0.6), F("drop", 8, 0.75), F("break", 4, 0.3)],
    loopFrom: 1,
    drums: "booms",
    bass: "drone",
    pad: "warm",
    arp: null,
    lead: null,
    guitar: { style: "swell" },
    organ: 0.7,
    choir: 0.4,
    fx: { reverb: "cathedral", wet: 0.55, delay: 1, feedback: 0.4 },
    tick: 1.25,
  },
  {
    id: "orbit-drift",
    name: "Orbit Drift",
    mood: "Coasting in orbit: glass pads, bells, the guitar's arpeggio, a light pulse, a few notes of a soft lead",
    bpm: 76,
    root: 59,
    scale: "dorian",
    progressions: {
      a: [
        { deg: 0, kind: "seventh" },
        { deg: 3, kind: "add9" },
        { deg: 6, kind: "add9" },
        { deg: 2, kind: "seventh" },
      ],
    },
    form: [F("intro", 8, 0.2), F("verse", 16, 0.4), F("build", 8, 0.55), F("break", 8, 0.25)],
    loopFrom: 1,
    drums: "pulse",
    bass: "sub",
    pad: "glass",
    arp: { pattern: "random", rate: 2, octaves: 2, sound: "bell" },
    lead: { sound: "soft", register: 72, density: 2 },
    guitar: { style: "arp" },
    organ: 0,
    choir: 0.2,
    fx: { reverb: "hall", wet: 0.5, delay: 0.75, feedback: 0.5 },
  },
  {
    id: "low-pass",
    name: "Low Pass",
    mood: "Flying low and fast: synthwave drums, an octave bass, supersaws, a saw lead",
    bpm: 118,
    root: 57,
    scale: "minor",
    progressions: {
      a: [
        { deg: 0, kind: "triad" },
        { deg: 5, kind: "triad" },
        { deg: 2, kind: "triad" },
        { deg: 6, kind: "triad" },
      ],
      b: [
        { deg: 5, kind: "seventh" },
        { deg: 6, kind: "triad" },
        { deg: 0, kind: "add9" },
        { deg: 0, kind: "sus4" },
      ],
    },
    form: [F("intro", 4, 0.4), F("verse", 16, 0.65), F("build", 4, 0.8), F("drop", 16, 1), F("break", 8, 0.5)],
    loopFrom: 1,
    drums: "four",
    bass: "octave",
    pad: "supersaw",
    arp: { pattern: "updown", rate: 4, octaves: 1, sound: "pluck" },
    lead: { sound: "saw", register: 74, density: 6 },
    guitar: null,
    organ: 0,
    choir: 0,
    fx: { reverb: "plate", wet: 0.3, delay: 0.75, feedback: 0.35 },
  },
  {
    id: "docking",
    name: "Soft Capture",
    mood: "Docking: ticking hats, a syncopated sub, slow bells, the guitar's harmonics, glass pads — tension held",
    bpm: 84,
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
    form: [F("intro", 4, 0.3), F("verse", 16, 0.5), F("build", 8, 0.65), F("break", 8, 0.35)],
    loopFrom: 1,
    drums: "pulse",
    bass: "synco",
    pad: "glass",
    arp: { pattern: "up", rate: 2, octaves: 2, sound: "bell" },
    lead: null,
    guitar: { style: "harmonics" },
    organ: 0,
    choir: 0,
    fx: { reverb: "plate", wet: 0.4, delay: 0.5, feedback: 0.45 },
  },
  {
    id: "deep-space",
    name: "Deep Space",
    mood: "Between the worlds: the choir and warm pads, a drone, the guitar's swells, booms far away",
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
    drums: "booms",
    bass: "drone",
    pad: "warm",
    arp: { pattern: "updown", rate: 2, octaves: 2, sound: "glass" },
    lead: null,
    guitar: { style: "swell" },
    organ: 0.3,
    choir: 0.7,
    fx: { reverb: "cathedral", wet: 0.65, delay: 1, feedback: 0.5 },
  },
  {
    id: "endurance",
    name: "Endurance",
    mood: "The ship's theme: epic drums, the organ and supersaws, a heroic lead, the choir",
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
    drums: "epic",
    bass: "octave",
    pad: "supersaw",
    arp: { pattern: "up", rate: 3, octaves: 1, sound: "pluck" },
    lead: { sound: "saw", register: 76, density: 4 },
    guitar: { style: "swell" },
    organ: 0.7,
    choir: 0.7,
    fx: { reverb: "hall", wet: 0.45, delay: 0.75, feedback: 0.35 },
  },
  {
    id: "new-worlds",
    name: "New Worlds",
    mood: "On foot on another world: a light break, the guitar's arpeggio, glass pads, a gentle lead in Mixolydian",
    bpm: 90,
    root: 62,
    scale: "mixolydian",
    progressions: {
      a: [
        { deg: 0, kind: "add9" },
        { deg: 6, kind: "add9" },
        { deg: 3, kind: "add9" },
        { deg: 0, kind: "sus4" },
      ],
    },
    form: [F("intro", 4, 0.25), F("verse", 16, 0.5), F("build", 8, 0.65), F("break", 8, 0.3)],
    loopFrom: 1,
    drums: "break",
    bass: "pulse",
    pad: "glass",
    arp: null,
    lead: { sound: "soft", register: 74, density: 3 },
    guitar: { style: "arp" },
    organ: 0,
    choir: 0.15,
    fx: { reverb: "hall", wet: 0.4, delay: 0.75, feedback: 0.45 },
    swing: 0.12,
  },
];

export const THEME_BY_ID: Record<string, Theme> = Object.fromEntries(THEMES.map((t) => [t.id, t]));
