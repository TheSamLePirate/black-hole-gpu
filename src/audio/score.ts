// The score (PLAN-TARS T4) — silence by default (the owner's choice): music only at the flight's great
// moments, each its own piece, faded in and out. Pure: which moment it is (the flight's state in), and each
// moment's piece — its chords (MIDI notes), how long each is held, its layers (the additive organ, the pads,
// the deep pedal), its level; Miller's tick (1.25 s, the film's motif: on the game's Miller dτ/dt is 0.85,
// a beat per Earth day would never be heard). The synthesis: audio/music.ts.
//
// The chords are plain progressions in A minor and its relatives (no melody quoted): an organ's sustained
// harmony, the pads under it, the pedal an octave below.

export type Moment = "liftoff" | "entry" | "final" | "wormhole" | "gargantua" | "miller";

export interface ScoreInput {
  /** the wall's clock [s] */
  now: number;
  /** the flight's mode and stage (game/phase.ts) */
  mode: string | null;
  stage: string | null;
  /** which universe, the throat between */
  side: "ours" | "gargantua" | "throat";
  /** the entry's plasma 0…1 */
  plasma: number;
  /** on a runway's final, low: the height over the ground [m] */
  final: boolean;
  agl: number;
  /** on Gargantua's side: the distance from the hole [M]; the body whose sphere it is in */
  r: number;
  body: string | null;
}

export interface Piece {
  /** the chords, held `chordS` each, looped */
  chords: number[][];
  chordS: number;
  /** the layers' levels 0…1: the additive organ, the pads, the pedal an octave below the root */
  organ: number;
  pad: number;
  pedal: number;
  /** the whole piece's level 0…1, its fade in and out [s] */
  level: number;
  fadeIn: number;
  fadeOut: number;
  /** a tick every so many seconds (Miller's), none: 0 */
  tick: number;
}

const A = 57, // A3
  C = 60,
  D = 62,
  E = 64,
  F = 53, // F3
  G = 55,
  B = 59;

export const PIECES: Record<Moment, Piece> = {
  // the lift-off: rising, open fifths and suspended chords, the organ full
  liftoff: {
    chords: [
      [C, G + 12, C + 12, D + 12],
      [G, D, G + 12, A + 12],
      [A, E, A + 12, C + 12],
      [F + 12, C, F + 24, G + 24],
    ],
    chordS: 5,
    organ: 0.9,
    pad: 0.5,
    pedal: 0.6,
    level: 0.85,
    fadeIn: 3,
    fadeOut: 8,
    tick: 0,
  },
  // the entry: dark, low, the pads and the pedal, the organ held back
  entry: {
    chords: [
      [D - 12, A - 12, D, F + 12],
      [F, C, F + 12, A],
      [C - 12, G - 12, C, E],
      [A - 12, E - 12, A, C],
    ],
    chordS: 8,
    organ: 0.35,
    pad: 0.9,
    pedal: 0.9,
    level: 0.75,
    fadeIn: 6,
    fadeOut: 10,
    tick: 0,
  },
  // the final: quiet, open, the pads alone and a little organ
  final: {
    chords: [
      [F, A, C + 12, E + 12],
      [C, E, G + 12, D + 12],
      [D, F + 12, A, C + 12],
      [F, A, D + 12, E + 12],
    ],
    chordS: 7,
    organ: 0.25,
    pad: 0.8,
    pedal: 0.3,
    level: 0.55,
    fadeIn: 5,
    fadeOut: 6,
    tick: 0,
  },
  // the wormhole: the organ wide and high, the pads shimmering
  wormhole: {
    chords: [
      [A, E, A + 12, C + 12, E + 12],
      [F, C, F + 12, A + 12, E + 12],
      [C, G, C + 12, E + 12, G + 12],
      [G, D, G + 12, B, D + 12],
    ],
    chordS: 4,
    organ: 1,
    pad: 0.7,
    pedal: 0.8,
    level: 0.9,
    fadeIn: 2,
    fadeOut: 6,
    tick: 0,
  },
  // Gargantua: the deep organ over an A pedal, slow
  gargantua: {
    chords: [
      [A, E, A + 12, C + 12],
      [F, C, A, C + 12],
      [E, C + 12, G + 12, C + 24],
      [D, F + 12, A, D + 12],
    ],
    chordS: 10,
    organ: 0.8,
    pad: 0.6,
    pedal: 1,
    level: 0.8,
    fadeIn: 8,
    fadeOut: 12,
    tick: 0,
  },
  // Miller: sparse, the organ low and soft — and the tick
  miller: {
    chords: [
      [A - 12, E - 12, A, C + 12],
      [F - 12, C - 12, A, C + 12],
    ],
    chordS: 12,
    organ: 0.4,
    pad: 0.5,
    pedal: 0.5,
    level: 0.6,
    fadeIn: 6,
    fadeOut: 8,
    tick: 1.25,
  },
};

/** How near Gargantua its piece begins [M]. */
export const GARGANTUA_NEAR = 30;
/** How long the lift-off's piece plays after the wheels leave the ground [s]. */
export const LIFTOFF_S = 75;

/** The moment the flight is in (its piece), or none: silence. Remembers the lift-off's time. */
export class ScoreDirector {
  private liftoffAt = -Infinity;
  private prevMode: string | null = null;

  reset() {
    this.liftoffAt = -Infinity;
    this.prevMode = null;
  }

  moment(i: ScoreInput): Moment | null {
    if (this.prevMode === "landed" && i.mode === "flight") this.liftoffAt = i.now;
    if (i.mode === "landed") this.liftoffAt = -Infinity;
    this.prevMode = i.mode;
    if (i.mode !== "flight" && i.mode !== "landed" && i.mode !== "docked") return null;
    // (the gravest first: the throat, the plasma, the final, the lift-off; then the places)
    if (i.side === "throat") return "wormhole";
    if (i.plasma > 0.15) return "entry";
    if (i.final && i.agl < 3000) return "final";
    if (i.now - this.liftoffAt < LIFTOFF_S) return "liftoff";
    if (i.side === "gargantua" && i.body === "miller") return "miller";
    if (i.side === "gargantua" && i.r < GARGANTUA_NEAR) return "gargantua";
    return null;
  }
}

/** A MIDI note's frequency [Hz]. */
export const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);
