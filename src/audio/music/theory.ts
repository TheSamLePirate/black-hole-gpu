// The score's theory: scales, chords on a scale's degrees, their voicings led smoothly from one to the next, a
// seeded random (the same theme, the same variation: the same music). Pure.

/** The modes, as semitones above the root. */
export const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
} as const;
export type ScaleName = keyof typeof SCALES;

/** A chord's shape on the scale: thirds stacked (triad, seventh, ninth), suspended, added ninth, a power fifth. */
export type ChordKind = "triad" | "seventh" | "ninth" | "sus2" | "sus4" | "add9" | "power";

/** A degree of the scale (0 = the root; past 6 the next octave, below 0 the one under) → a MIDI note. */
export function degreeNote(root: number, scale: ScaleName, deg: number): number {
  const S = SCALES[scale];
  const o = Math.floor(deg / 7);
  const i = deg - o * 7;
  return root + 12 * o + S[i]!;
}

/** Whether a note belongs to the scale on that root. */
export function inScale(root: number, scale: ScaleName, note: number): boolean {
  return (SCALES[scale] as readonly number[]).includes((((note - root) % 12) + 12) % 12);
}

/** A chord on a degree: its notes from its root up (MIDI), diatonic to the scale. */
export function chordOn(root: number, scale: ScaleName, deg: number, kind: ChordKind = "triad"): number[] {
  const d = (k: number) => degreeNote(root, scale, deg + k);
  switch (kind) {
    case "power":
      return [d(0), d(4), d(7)];
    case "sus2":
      return [d(0), d(1), d(4)];
    case "sus4":
      return [d(0), d(3), d(4)];
    case "add9":
      return [d(0), d(2), d(4), d(8)];
    case "seventh":
      return [d(0), d(2), d(4), d(6)];
    case "ninth":
      return [d(0), d(2), d(4), d(6), d(8)];
    default:
      return [d(0), d(2), d(4)];
  }
}

/**
 * A voicing of the chord near the last one (each pitch class moved to the octave nearest the previous voicing's
 * centre — the inner voices moving by steps, as a pad's or a choir's), within [lo, hi].
 */
export function voiceLead(prev: number[] | null, chord: number[], lo = 48, hi = 79): number[] {
  const centre = prev && prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : (lo + hi) / 2 - 4;
  const out = chord.map((n) => {
    let m = n;
    while (m < centre - 6) m += 12;
    while (m > centre + 6) m -= 12;
    while (m < lo) m += 12;
    while (m > hi) m -= 12;
    return m;
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

/** A seeded random (mulberry32): the same seed, the same draws. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** an integer in [a, b] */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** A seed from words (a theme's id, a bar's number). */
export function seedOf(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const c of parts.join("|")) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A MIDI note's frequency [Hz]. */
export const midiHz = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** A chord's qualities, as semitones above its root. */
export const QUALITIES: Record<string, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  "7": [0, 4, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "7sus4": [0, 5, 7, 10],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  "5": [0, 7, 12],
  // (stacked fourths: the fanfare's open, modern sound)
  q: [0, 5, 10, 15],
};
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * A chord from its symbol ("Fmaj7", "Em/G", "Ebm", "F7sus4", "Bbq": stacked fourths on B♭), voiced on the octave
 * at or above `low` (MIDI): its notes from its root up, its bass (the slash's, else the root), its root's pitch
 * class.
 */
export function parseChord(sym: string, low = 48): { notes: number[]; bass: number; root: number } {
  const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(sym.trim());
  if (!m) throw new Error(`not a chord: ${sym}`);
  const acc = (a: string) => (a === "#" ? 1 : a === "b" ? -1 : 0);
  const rootPc = (PC[m[1]!]! + acc(m[2]!) + 12) % 12;
  const shape = QUALITIES[m[3]!];
  if (!shape) throw new Error(`unknown chord quality "${m[3]}" in ${sym}`);
  let r = low + ((((rootPc - low) % 12) + 12) % 12);
  const notes = shape.map((s) => r + s);
  const bassPc = m[4] ? (PC[m[4]]! + acc(m[5]!) + 12) % 12 : rootPc;
  let bass = low + ((((bassPc - low) % 12) + 12) % 12);
  if (bass > r) bass -= 12;
  r = rootPc;
  return { notes, bass, root: r };
}
