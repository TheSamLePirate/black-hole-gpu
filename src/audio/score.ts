// The score's direction (PLAN-TARS T4; music/themes.ts its themes): which of the flight's moments it is in —
// the lift-off, the entry's plasma, the final, the wormhole's throat, Gargantua, Miller, a docking, a low and
// fast pass —, the gravest first; and, in the adaptive mode, the flight's context between them (in orbit, far
// out, in the air, landed, on foot). Its intensity: how hard the flight is going (the engine, the plasma, the
// speed through the air, the ground near, the load, an alarm). Pure.

export type Moment = "liftoff" | "entry" | "final" | "wormhole" | "gargantua" | "miller" | "docking" | "lowpass";
export const MOMENTS: Moment[] = ["liftoff", "entry", "final", "wormhole", "gargantua", "miller", "docking", "lowpass"];
/** The flight's contexts between its moments (the adaptive mode). */
export type Context = "orbit" | "deep" | "air" | "ground" | "onFoot";
export const CONTEXTS: Context[] = ["orbit", "deep", "air", "ground", "onFoot"];

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
  /** docking (its autopilot, or a port within 300 m) */
  docking?: boolean;
  /** in the air: the speed through it [m/s] */
  inAir?: boolean;
  airspeed?: number;
  /** walking on a world */
  onFoot?: boolean;
  /** near a world (within a few of its radii: an orbit) */
  nearWorld?: boolean;
}

/** How near Gargantua its theme begins [M]. */
export const GARGANTUA_NEAR = 30;
/** How long the lift-off's theme plays after the wheels leave the ground [s]. */
export const LIFTOFF_S = 75;

/** The moment the flight is in, or none. Remembers the lift-off's time. */
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
    // (the gravest first: the throat, the plasma, the final, the lift-off, the docking; then the places)
    if (i.side === "throat") return "wormhole";
    if (i.plasma > 0.15) return "entry";
    if (i.final && i.agl < 3000) return "final";
    if (i.now - this.liftoffAt < LIFTOFF_S) return "liftoff";
    if (i.docking) return "docking";
    if (i.side === "gargantua" && i.body === "miller") return "miller";
    if (i.side === "gargantua" && i.r < GARGANTUA_NEAR) return "gargantua";
    if (i.inAir && i.agl < 400 && (i.airspeed ?? 0) > 140) return "lowpass";
    return null;
  }

  /** The context between the moments (the adaptive mode's): on foot, landed, in the air, in orbit, far out. */
  context(i: ScoreInput): Context | null {
    if (i.onFoot) return "onFoot";
    if (i.mode === "landed" || i.mode === "docked") return i.mode === "docked" ? "orbit" : "ground";
    if (i.mode !== "flight") return null;
    if (i.inAir) return "air";
    return i.nearWorld ? "orbit" : "deep";
  }
}

/** The flight's intensity 0 … 1 (0.5: a flight as written): the engine, the plasma, Mach, the ground near, the load,
 *  an alarm. */
export function flightIntensity(o: { throttle: number; plasma: number; mach: number; agl: number; g: number; alarm: boolean }): number {
  const sm = (a: number, b: number, x: number) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  const low = Number.isFinite(o.agl) ? 1 - sm(150, 2000, o.agl) : 0;
  return Math.min(
    1,
    0.32 +
      0.28 * Math.min(1, Math.max(0, o.throttle)) +
      0.35 * o.plasma +
      0.25 * sm(0.4, 1.4, o.mach) +
      0.15 * low * sm(0.2, 0.8, o.mach) +
      0.15 * sm(2, 6, o.g) +
      (o.alarm ? 0.15 : 0),
  );
}

/** A MIDI note's frequency [Hz]. */
export const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);
