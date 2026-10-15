// The aerobatic figures (docs/PLAN-AVIATION-AAA.md, V4): each a pilot's program — what an aerobatic pilot does,
// frame by frame, to fly it (the stick asking loads and rolls through the F-35's law, the throttle, the
// afterburner) — and its judge — the trace flown against the ideal figure: round, in its plane, its heading and
// its height at the exit, its wings level, its time. The autopilot flies a figure by its program ("demo"); the
// player flies it, judged the same way. Pure: the craft's state in, the stick out; the trace in, the marks out.
//
// The state is read in a local frame fixed at the figure's start (east, north, up from its first point); the
// craft's axes in it, not its Euler angles — a loop passes the vertical, where a bank means nothing, but its
// wings are still level when its right wing is horizontal.

import { stickForAlpha } from "../pilot";

type V3 = [number, number, number];
const D = Math.PI / 180;
const G = 9.80665;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The craft as a figure reads it, in its local frame (east, north, up [m] from the figure's start). */
export interface AeroState {
  t: number;
  /** place [m], velocity over the ground [m/s]; the place in the air's frame [m] (the wind's drift taken out: the
   *  figure's shape, as judges see it) */
  p: V3;
  v: V3;
  pa: V3;
  /** the craft's axes: its nose, its top, its right wing */
  fwd: V3;
  up: V3;
  right: V3;
  /** its speed through the air [m/s], its incidence [rad], its normal load [g], its height over the ground [m] */
  V: number;
  alpha: number;
  nz: number;
  agl: number;
  /** its body rates [rad/s]: roll (right +), pitch (up +), yaw (right +) */
  p_: number;
  q: number;
  r: number;
  /** its law's load limits [g] */
  gMax: number;
  gMin: number;
  /** the figure's phase it was flown in (its program's — followed for the player's), for the judge */
  phase?: number;
}

/** What the program asks: the stick (pitch, roll, yaw: −1…1), the throttle (0…1), the afterburner, the law. */
export interface AeroCmd {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  ab: boolean;
  law?: "normal" | "direct";
  /** the air brake out (0…1) */
  brake?: number;
}

export type FigureId =
  | "loop"
  | "immelmann"
  | "splitS"
  | "aileronRoll"
  | "barrelRoll"
  | "cuban8"
  | "inverted"
  | "highAlpha"
  | "reversal"
  | "spin";

/** A figure's entry: the speed through the air [m/s], the least height over the ground [m], its law. */
export interface FigureEntry {
  v: number;
  vTol: number;
  agl: number;
  law: "normal" | "direct";
}

/** A figure's marks: out of 20, each part's (0…1) and what to say of it. */
export interface FigureMarks {
  score: number;
  parts: Record<string, number>;
  notes: string[];
}

export interface FigureDef {
  id: FigureId;
  /** its name, what it is, how it is flown (the cues said as it is flown) — English, translated by t() */
  name: string;
  brief: string;
  cues: string[];
  entry: FigureEntry;
  /** its par [s]: past twice it, the figure lapses */
  par: number;
}

/** A mark from a deviation: full under `good`, none past `bad`, linear between. */
export const markOf = (dev: number, good: number, bad: number) => clamp(1 - (dev - good) / (bad - good), 0, 1);

// ------------------------------------------------------------------------------------------------- the stick

/** The stick that asks a load n [g] of the F-35's law (1 g at rest, its limits at the ends). */
export function stickForLoad(n: number, s: AeroState): number {
  const k = n >= 1 ? (n - 1) / (s.gMax - 1) : -(n - 1) / (s.gMin - 1);
  // (a stick exactly at rest is a hold of the path, not a load asked: a hair off it)
  return clamp(Math.abs(k) < 1e-4 ? 1e-4 * Math.sign(k || 1) : k, -1, 1);
}

/** The roll that keeps the wings level — the right wing horizontal —, upright, inverted or through the vertical. */
export function wingsLevel(s: AeroState, k = 2.5): number {
  // (upright, the right wing up: banked left — rolled right; inverted, a roll right lifts the right wing: the other
  // way; through the vertical the roll turns the wings about it, level whatever — its share faded there)
  return clamp(k * s.right[2] * clamp(3 * s.up[2], -1, 1), -1, 1);
}

/** The roll towards a bank `phi` [rad] (right +) about the nose. */
export function rollTo(s: AeroState, phi: number, k = 2): number {
  const bank = Math.atan2(-s.right[2], s.up[2]);
  return clamp(k * wrapPi(phi - bank), -1, 1);
}

/** The bank [rad] (right +) of the craft — its right wing below the horizon: banked right. */
export const bankOf = (s: AeroState) => Math.atan2(-s.right[2], s.up[2]);
/** The flight path's angle over the horizon [rad]. */
export const gammaOf = (s: AeroState) => Math.atan2(s.v[2], Math.hypot(s.v[0], s.v[1]));
/** The ground track's heading [rad] (clockwise from north). */
export const trackOf = (s: AeroState) => Math.atan2(s.v[0], s.v[1]);

// ------------------------------------------------------------------------------------------------- figures

export const FIGURES: Record<FigureId, FigureDef> = {
  loop: {
    id: "loop",
    name: "Loop",
    brief: "A whole circle in the vertical plane, wings level all the way round, back at the entry's height and heading.",
    cues: [
      "Full power, 450 kt, wings level",
      "Pull 4–5 g",
      "Over the top: lighter, keep the circle round",
      "Back to level: same height, same heading",
    ],
    entry: { v: 235, vTol: 25, agl: 2500, law: "normal" },
    par: 40,
  },
  immelmann: {
    id: "immelmann",
    name: "Immelmann",
    brief: "Half a loop up, then half a roll on top: higher, the heading reversed, upright.",
    cues: ["Full power, 450 kt", "Pull 4–5 g, wings level", "Inverted on top, horizon level: half a roll", "Upright, the heading reversed"],
    entry: { v: 240, vTol: 25, agl: 1500, law: "normal" },
    par: 25,
  },
  splitS: {
    id: "splitS",
    name: "Split-S",
    brief: "Half a roll to inverted, then half a loop down: lower, the heading reversed, upright.",
    cues: ["300 kt, high enough", "Half a roll to inverted", "Pull 4 g through the vertical", "Level, the heading reversed"],
    entry: { v: 160, vTol: 20, agl: 3000, law: "normal" },
    par: 25,
  },
  aileronRoll: {
    id: "aileronRoll",
    name: "Aileron roll",
    brief: "A whole roll about the nose, on its heading and its height.",
    cues: ["Nose a little up", "Full roll", "Wings level, same heading, same height"],
    entry: { v: 220, vTol: 40, agl: 1000, law: "normal" },
    par: 8,
  },
  barrelRoll: {
    id: "barrelRoll",
    name: "Barrel roll",
    brief: "A roll around a line ahead — a corkscrew — back on the entry's heading and height.",
    cues: [
      "Level, 400 kt",
      "Roll steadily and pull: hard upright, light inverted",
      "Keep the roll going round",
      "Back level, same heading",
    ],
    entry: { v: 210, vTol: 30, agl: 1500, law: "normal" },
    par: 16,
  },
  cuban8: {
    id: "cuban8",
    name: "Cuban eight",
    brief: "Two five-eighths loops joined by half rolls on 45° lines down: a figure eight on its side.",
    cues: [
      "Full power, 450 kt",
      "Pull through 5/8 of a loop",
      "Inverted 45° down: half a roll",
      "Again, the other way",
      "Level, same height",
    ],
    entry: { v: 240, vTol: 25, agl: 2500, law: "normal" },
    par: 110,
  },
  inverted: {
    id: "inverted",
    name: "Inverted flight",
    brief: "Ten seconds level on its back, then upright again.",
    cues: ["Half a roll", "Push: −1 g, the nose a little up", "Ten seconds", "Half a roll back"],
    entry: { v: 200, vTol: 40, agl: 1000, law: "normal" },
    par: 20,
  },
  highAlpha: {
    id: "highAlpha",
    name: "High-alpha pass",
    brief: "The F-35's own: slow, level, its nose 40° above its path, held on the throttle.",
    cues: ["Throttle back, hold the height", "The nose up to 35–45°", "Hold it with the throttle — the afterburner", "Ten seconds level"],
    entry: { v: 120, vTol: 25, agl: 800, law: "normal" },
    par: 30,
  },
  reversal: {
    id: "reversal",
    name: "7 g reversal",
    brief: "The heading reversed as fast as the F-35 turns: at its corner speed, 7 g, banked 82°, its height kept.",
    cues: ["450 kt, full power", "Roll to 82° and pull 7 g", "Hold the height, the nose on the horizon", "Heading reversed: roll out"],
    entry: { v: 230, vTol: 20, agl: 1500, law: "normal" },
    par: 11,
  },
  spin: {
    id: "spin",
    name: "Spin and recovery",
    brief: "Without the flight control computer: two turns of a spin, then the controls let go and the dive pulled out.",
    cues: [
      "Direct law, idle",
      "Full aft stick",
      "Full rudder: the spin",
      "Two turns: let go of everything",
      "Rotation stopped: pull out of the dive",
    ],
    entry: { v: 110, vTol: 25, agl: 4500, law: "direct" },
    par: 45,
  },
};

export const FIGURE_ORDER: FigureId[] = [
  "loop",
  "immelmann",
  "splitS",
  "aileronRoll",
  "barrelRoll",
  "cuban8",
  "inverted",
  "highAlpha",
  "reversal",
  "spin",
];

// ------------------------------------------------------------------------------------------------- the programs

/** A program's memory across its frames. */
export interface PilotMem {
  phase: number;
  /** the figure's first state (its entry) and the phase's */
  s0: AeroState | null;
  ph0: AeroState | null;
  /** the loop's angle unwrapped [rad], the last one, its radius and centre */
  loopAng: number;
  lastAng: number;
  R: number;
  centre: V3 | null;
  /** the roll turned [rad], the yaw turned [rad], the last state's time [s] */
  rolled: number;
  yawed: number;
  t1: number;
  /** the plane of the loop: its horizontal heading's unit (east, north) */
  h0: [number, number];
  /** the last bank seen [rad] (the roll's turn unwrapped) */
  lastBank: number;
}

export const newMem = (): PilotMem => ({
  phase: 0,
  s0: null,
  ph0: null,
  loopAng: 0,
  lastAng: 0,
  R: 0,
  centre: null,
  rolled: 0,
  yawed: 0,
  t1: Number.NaN,
  h0: [0, 1],
  lastBank: 0,
});

/** The loop's angle of the path in the plane of the entry's heading [rad]: 0 level, π/2 straight up, π inverted. */
function loopAngle(s: AeroState, m: PilotMem): number {
  const a = Math.atan2(s.v[2], s.v[0] * m.h0[0] + s.v[1] * m.h0[1]);
  const d = wrapPi(a - m.lastAng);
  m.lastAng = a;
  m.loopAng += d;
  return m.loopAng;
}

/** Starts a loop from this state: its radius from the load asked at its bottom, its centre over the entry. */
function startLoop(s: AeroState, m: PilotMem, n0: number) {
  const hl = Math.hypot(s.v[0], s.v[1]) || 1;
  m.h0 = [s.v[0] / hl, s.v[1] / hl];
  m.R = (s.V * s.V) / (G * (n0 - 1));
  // (the centre: up the craft's top from where it is — over it, a loop entered level)
  m.centre = [s.p[0] + s.up[0] * m.R, s.p[1] + s.up[1] * m.R, s.p[2] + s.up[2] * m.R];
  m.loopAng = Math.atan2(s.v[2], s.v[0] * m.h0[0] + s.v[1] * m.h0[1]);
  m.lastAng = m.loopAng;
}

/** The load a round loop of radius R asks at this point (its speed, gravity's share), corrected to its circle. */
function loopLoad(s: AeroState, m: PilotMem): number {
  const ang = m.loopAng;
  let n = (s.V * s.V) / (G * m.R) + Math.cos(ang);
  if (m.centre) {
    // (drifted outside its circle: pulled harder; inside: lighter)
    const d = Math.hypot(s.p[0] - m.centre[0], s.p[1] - m.centre[1], s.p[2] - m.centre[2]);
    n += 3 * ((d - m.R) / m.R);
  }
  return clamp(n, s.gMin + 0.5, s.gMax - 0.2);
}

const full = (s: AeroState, pitch: number, roll: number, extra?: Partial<AeroCmd>): AeroCmd => ({
  pitch,
  roll,
  yaw: 0,
  throttle: 1,
  ab: true,
  ...extra,
});

/** The pitch that holds the flight path level (a vertical speed of nil, the height kept) — upright or inverted. */
function levelLoad(s: AeroState, h0: number, upright: boolean): number {
  // (the vertical acceleration asked: the height's error and the climb's, over the craft's top's share up)
  const az = 0.15 * (h0 - s.p[2]) - 0.8 * s.v[2];
  const share = s.up[2] || (upright ? 1 : -1);
  return clamp((1 + az / G) / share, s.gMin + 0.3, s.gMax - 0.3);
}

/** The load that holds a straight path at the angle γt [rad], upright (its weight's share across it, the error). */
function lineLoad(s: AeroState, gT: number): number {
  const g = gammaOf(s);
  return clamp(Math.cos(g) * Math.sign(s.up[2] || 1) + (2 * s.V * (gT - g)) / G, s.gMin + 0.3, s.gMax - 0.3);
}

/**
 * A frame of a figure's program: the command, or null once the figure is flown. `m` its memory (newMem() at its
 * start — the state then its entry).
 */
export function figureStep(id: FigureId, s: AeroState, m: PilotMem): AeroCmd | null {
  if (!m.s0) {
    m.s0 = s;
    m.ph0 = s;
  }
  const s0 = m.s0;
  const next = () => {
    m.phase++;
    m.ph0 = s;
    m.rolled = 0;
  };
  const dt = Number.isFinite(m.t1) ? Math.max(s.t - m.t1, 0) : 0;
  m.t1 = s.t;
  // (the roll turned: the bank itself unwrapped — in a figure pulled, the body's roll rate is not the bank's)
  const rollTurned = () => {
    const b = bankOf(s);
    if (Number.isFinite(m.lastAng) && m.rolled !== 0) m.rolled += wrapPi(b - m.lastBank);
    else m.rolled = 1e-9;
    m.lastBank = b;
    return m.rolled;
  };
  switch (id) {
    case "loop": {
      if (m.phase === 0) {
        startLoop(s, m, 4.5);
        next();
      }
      if (m.phase === 1) {
        const ang = loopAngle(s, m);
        if (ang >= 2 * Math.PI - 0.06) next();
        else return full(s, stickForLoad(loopLoad(s, m), s), wingsLevel(s));
      }
      if (m.phase === 2) {
        if (s.t - m.ph0!.t > 1.5) return null;
        return full(s, stickForLoad(levelLoad(s, s0.p[2], true), s), wingsLevel(s));
      }
      return null;
    }
    case "immelmann": {
      if (m.phase === 0) {
        startLoop(s, m, 4.5);
        next();
      }
      if (m.phase === 1) {
        const ang = loopAngle(s, m);
        if (ang >= Math.PI - 0.04) next();
        else return full(s, stickForLoad(loopLoad(s, m), s), wingsLevel(s));
      }
      if (m.phase === 2) {
        // (half a roll on top: the path level as it rolls — the load its top's share up asks)
        if (s.up[2] > 0.97 && Math.abs(s.right[2]) < 0.08) next();
        else return full(s, stickForLoad(levelLoad(s, s.p[2], s.up[2] >= 0), s), 1);
      }
      if (m.phase === 3) {
        if (s.t - m.ph0!.t > 1.5) return null;
        return full(s, stickForLoad(levelLoad(s, m.ph0!.p[2], true), s), wingsLevel(s));
      }
      return null;
    }
    case "splitS": {
      if (m.phase === 0) {
        if (s.up[2] < -0.97 && Math.abs(s.right[2]) < 0.1) next();
        else return full(s, stickForLoad(levelLoad(s, s0.p[2], s.up[2] >= 0), s), 1, { throttle: 0.3, ab: false });
      }
      if (m.phase === 1) {
        // (inverted: pull through half a loop down — 4 g, wings level —, the heading reversed at its end)
        const g = gammaOf(s);
        const rev = Math.abs(wrapPi(trackOf(s) - trackOf(s0))) > Math.PI / 2;
        if (rev && g > -0.03) next();
        // (4 g, but never past the lift's peak: slow, the pull eased to keep 32° — a pilot's own)
        else return full(s, stickForLoad(s.alpha > 32 * D ? Math.max(1.5, s.nz - 0.4) : 4, s), wingsLevel(s), { throttle: 0.8, ab: false });
      }
      if (m.phase === 2) {
        if (s.t - m.ph0!.t > 1.5) return null;
        return full(s, stickForLoad(levelLoad(s, m.ph0!.p[2], true), s), wingsLevel(s), { throttle: 0.8, ab: false });
      }
      return null;
    }
    case "aileronRoll": {
      if (m.phase === 0) {
        // (the nose a little up first: 5° of climb)
        if (gammaOf(s) > 5 * D) next();
        else return full(s, stickForLoad(1.8, s), wingsLevel(s), { throttle: 0.9, ab: false });
      }
      if (m.phase === 1) {
        if (Math.abs(rollTurned()) >= 2 * Math.PI - 0.15) next();
        else return full(s, stickForLoad(levelLoad(s, m.ph0!.p[2] + 20, s.up[2] >= 0), s), 1, { throttle: 0.9, ab: false });
      }
      if (m.phase === 2) {
        if (s.t - m.ph0!.t > 1.2) return null;
        return full(s, stickForLoad(levelLoad(s, s0.p[2], true), s), wingsLevel(s), { throttle: 0.9, ab: false });
      }
      return null;
    }
    case "barrelRoll": {
      // (a steady roll, ~45°/s, with a pull that follows it — 4.5 g upright, 0.5 g inverted: the lift's share up
      // kept to the weight's on average, n = 2.5 + 2 cos φ —: the nose draws a ring round the horizon, the craft a
      // corkscrew, back on its height and heading)
      if (m.phase === 0) next();
      if (m.phase === 1) {
        if (Math.abs(rollTurned()) >= 2 * Math.PI - 0.08) next();
        else {
          // (and the height brought back where the lift points it: more pull upright when low, less when high)
          const c = Math.cos(bankOf(s));
          const fix = clamp(0.012 * (s0.p[2] - s.p[2]) - 0.06 * s.v[2], -1.5, 1.5);
          return full(s, stickForLoad(2.5 + 2 * c + fix * c, s), 0.24);
        }
      }
      if (m.phase === 2) {
        if (s.t - m.ph0!.t > 2) return null;
        return full(s, stickForLoad(levelLoad(s, s0.p[2], true), s), wingsLevel(s));
      }
      return null;
    }
    case "cuban8": {
      // (two five-eighths loops, each ended inverted 45° down; half a roll there, the 45° line held down to the
      // entry's speed again; the second loop the other way; pulled out of the last line)
      const lobe = m.phase >= 4 ? 1 : 0;
      const b = lobe * 4;
      if (m.phase === b) {
        startLoop(s, m, 4.5);
        next();
      }
      if (m.phase === b + 1) {
        const ang = loopAngle(s, m);
        if (ang >= (5 * Math.PI) / 4 - 0.03) next();
        else return full(s, stickForLoad(loopLoad(s, m), s), wingsLevel(s));
      }
      if (m.phase === b + 2) {
        if (s.up[2] > 0.6 && Math.abs(s.right[2]) < 0.08) next();
        else return full(s, stickForLoad(lineLoad(s, -Math.PI / 4), s), 1, { throttle: 0.4, ab: false });
      }
      if (m.phase === b + 3) {
        // (down the line to where a loop pulled from 45° bottoms at the entry's height: R (1 − cos 45°) over it)
        if (s.p[2] <= m.s0!.p[2] + (1 - Math.SQRT1_2) * m.R) {
          next();
          m.centre = null;
          return figureStep(id, s, m);
        } else {
          // (the entry's speed kept down the line: idle, the air brake past it)
          const over = s.V - m.s0!.V;
          return full(s, stickForLoad(lineLoad(s, -Math.PI / 4), s), wingsLevel(s), {
            throttle: clamp(0.5 - 0.05 * over, 0, 1),
            ab: false,
            brake: clamp(0.08 * over, 0, 1),
          });
        }
      }
      if (m.phase === 8) {
        // (the last pull: a quarter of a loop's arc from the 45° line to level)
        if (!m.centre || m.t1 === m.ph0!.t) startLoop(s, m, 4.5);
        const ang = loopAngle(s, m);
        if (ang > -0.02) next();
        else return full(s, stickForLoad(loopLoad(s, m), s), wingsLevel(s));
      }
      if (m.phase === 9) {
        if (s.t - m.ph0!.t > 1.5) return null;
        return full(s, stickForLoad(levelLoad(s, m.ph0!.p[2], true), s), wingsLevel(s));
      }
      return null;
    }
    case "inverted": {
      if (m.phase === 0) {
        if (s.up[2] < -0.98 && Math.abs(s.right[2]) < 0.06) next();
        else return full(s, stickForLoad(levelLoad(s, s0.p[2], s.up[2] >= 0), s), 1, { throttle: 0.85, ab: false });
      }
      if (m.phase === 1) {
        if (s.t - m.ph0!.t > 10) next();
        else return full(s, stickForLoad(levelLoad(s, s0.p[2], false), s), wingsLevel(s), { throttle: 0.85, ab: false });
      }
      if (m.phase === 2) {
        if (s.up[2] > 0.98 && Math.abs(s.right[2]) < 0.06) next();
        else return full(s, stickForLoad(levelLoad(s, s0.p[2], s.up[2] >= 0), s), 1, { throttle: 0.85, ab: false });
      }
      if (m.phase === 3) {
        if (s.t - m.ph0!.t > 1.2) return null;
        return full(s, stickForLoad(levelLoad(s, s0.p[2], true), s), wingsLevel(s), { throttle: 0.85, ab: false });
      }
      return null;
    }
    case "highAlpha": {
      // (as its demonstration pilots fly it: the incidence on the stick — the law holds the incidence asked —,
      // the height on the throttle; slowed level first — idle, the air brake — until 38° holds; twelve seconds;
      // then the nose lowered, accelerated out)
      const aT = 40 * D;
      const sA = stickForAlpha(aT, 50 * D);
      // (at 40° its drag asks some 150 kN: the afterburner — the throttle's top 5 % —, the height on it)
      const thrust = (h0: number) => clamp(0.93 + 0.004 * (h0 - s.p[2]) - 0.06 * s.v[2], 0, 1);
      if (m.phase === 0) {
        if (s.alpha > aT - 2 * D) {
          if (!(m.R > 0)) m.R = s.t;
          if (s.t - m.R > 1) next();
        } else m.R = 0;
        if (m.phase === 0) {
          // (slowed at 1 g, level: the incidence rises as the speed falls — the law's incidence taken at 38°)
          const slow = s.alpha < aT - 2 * D;
          return full(s, slow ? stickForLoad(levelLoad(s, s0.p[2], true), s) : sA, wingsLevel(s), {
            throttle: slow ? 0 : thrust(s0.p[2]),
            ab: !slow,
            brake: slow && s.alpha < aT - 6 * D ? 1 : 0,
          });
        }
      }
      if (m.phase === 1) {
        if (s.t - m.ph0!.t > 12) next();
        else {
          const thr = thrust(s0.p[2]);
          return full(s, sA, wingsLevel(s), { throttle: thr, ab: thr > 0.85 });
        }
      }
      if (m.phase === 2) {
        if (s.alpha < 12 * D) return null;
        return full(s, stickForLoad(levelLoad(s, s0.p[2] - 30, true), s), wingsLevel(s));
      }
      return null;
    }
    case "reversal": {
      // (rolled to the bank whose 7 g holds the height — cos φ = 1/n —, pulled to the limit, the height held by the
      // bank; the heading reversed, rolled out)
      const n = s.gMax;
      if (m.phase === 0) {
        if (Math.abs(wrapPi(trackOf(s) - trackOf(s0))) > Math.PI - 0.1) next();
        else {
          const phi = Math.acos(clamp(1 / n, 0, 1)) + clamp(0.004 * (s.p[2] - s0.p[2]) + 0.03 * s.v[2], -0.15, 0.15);
          return full(s, stickForLoad(Math.abs(bankOf(s)) > 0.6 * phi ? n : 1.5, s), rollTo(s, phi, 3));
        }
      }
      if (m.phase === 1) {
        if (Math.abs(s.right[2]) < 0.06 && s.t - m.ph0!.t > 1) return null;
        return full(s, stickForLoad(levelLoad(s, s0.p[2], true), s), rollTo(s, 0, 3));
      }
      return null;
    }
    case "spin": {
      if (m.phase === 0) {
        if (s.alpha > 45 * D) next();
        else return full(s, 1, 0, { throttle: 0, ab: false, law: "direct" });
      }
      if (m.phase === 1) {
        // (two turns counted by the yaw)
        m.yawed += Math.abs(s.r) * dt;
        if (m.yawed >= 4 * Math.PI) next();
        else return { pitch: 1, roll: 0, yaw: 1, throttle: 0, ab: false, law: "direct" };
      }
      if (m.phase === 2) {
        // (let go of everything: the rotation stops)
        if (Math.hypot(s.p_, s.r) < 6 * D && s.alpha < 20 * D) next();
        else return { pitch: 0, roll: 0, yaw: 0, throttle: 0, ab: false, law: "direct" };
      }
      if (m.phase === 3) {
        // (its law back, the dive pulled out at 5 g)
        if (gammaOf(s) > -3 * D) return null;
        return full(s, stickForLoad(5, s), wingsLevel(s), { throttle: 1, ab: false, law: "normal" });
      }
      return null;
    }
  }
}

/** The cue to say at this point of the figure (FigureDef.cues' index): its phase's, finer within a loop. */
export function cueIndex(id: FigureId, m: PilotMem): number {
  const ph = m.phase;
  switch (id) {
    case "loop":
      return ph < 1 ? 0 : ph === 1 ? (m.loopAng > 2.2 && m.loopAng < 4.2 ? 2 : 1) : 3;
    case "cuban8":
      return ph <= 1 ? 1 : ph <= 3 ? 2 : ph <= 5 ? 3 : 4;
    default:
      return Math.min(ph, FIGURES[id].cues.length - 1);
  }
}

// ------------------------------------------------------------------------------------------------- the judge

/** The least-squares circle through points of a plane (2D): its centre and radius. */
export function fitCircle(pts: [number, number][]): { c: [number, number]; r: number } {
  // (Kåsa's algebraic fit: x² + y² + D x + E y + F = 0)
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0,
    sxz = 0,
    syz = 0,
    sz = 0;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  const n = pts.length;
  // [sxx sxy sx; sxy syy sy; sx sy n] [D E F] = −[sxz syz sz]
  const A = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const b = [-sxz, -syz, -sz];
  const det = (M: number[][]) =>
    M[0]![0]! * (M[1]![1]! * M[2]![2]! - M[1]![2]! * M[2]![1]!) -
    M[0]![1]! * (M[1]![0]! * M[2]![2]! - M[1]![2]! * M[2]![0]!) +
    M[0]![2]! * (M[1]![0]! * M[2]![1]! - M[1]![1]! * M[2]![0]!);
  const d0 = det(A);
  const col = (k: number) => A.map((row, i) => row.map((x, j) => (j === k ? b[i]! : x)));
  const Dd = det(col(0)) / d0,
    Ee = det(col(1)) / d0,
    Ff = det(col(2)) / d0;
  const c: [number, number] = [-Dd / 2, -Ee / 2];
  return { c, r: Math.sqrt(Math.max(c[0] * c[0] + c[1] * c[1] - Ff, 0)) };
}

/** The roundness of points about a circle fitted through them: the radii's spread over their mean. */
function roundness(pts: [number, number][]): { r: number; spread: number } {
  const { c, r } = fitCircle(pts);
  const rs = pts.map(([x, y]) => Math.hypot(x - c[0], y - c[1]));
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
  return { r, spread: sd / Math.max(mean, 1) };
}

/** The marks: the parts weighed, out of 20, the notes of those short of full. */
function marks(parts: Record<string, [number, number, string]>): FigureMarks {
  let sum = 0,
    w = 0;
  const out: Record<string, number> = {};
  const notes: string[] = [];
  for (const [k, [m, weight, note]] of Object.entries(parts)) {
    out[k] = m;
    sum += m * weight;
    w += weight;
    if (m < 0.75) notes.push(note);
  }
  return { score: Math.round(((20 * sum) / Math.max(w, 1e-9)) * 10) / 10, parts: out, notes };
}

/** The deviation [rad] between two headings, its sign dropped. */
const headingDev = (a: number, b: number) => Math.abs(wrapPi(a - b));

/** Judges a figure from its trace (the states from its entry to its end, its program's or the player's). */
export function judgeFigure(id: FigureId, tr: AeroState[]): FigureMarks {
  const a = tr[0]!;
  const z = tr.at(-1)!;
  const dur = z.t - a.t;
  const h0 = trackOf(a);
  const hx: [number, number] = [Math.sin(h0), Math.cos(h0)];
  // (in the entry's vertical plane: along its heading, up; across it: the drift)
  const along = (s: AeroState) => s.pa[0] * hx[0] + s.pa[1] * hx[1];
  const across = (s: AeroState) => s.pa[0] * hx[1] - s.pa[1] * hx[0];
  const drift = Math.max(...tr.map((s) => Math.abs(across(s))));
  const wingsLevelDev = (ss: AeroState[]) => Math.max(...ss.map((s) => Math.asin(clamp(Math.abs(s.right[2]), 0, 1))));
  const timeMark = markOf(dur, FIGURES[id].par, 2 * FIGURES[id].par);
  switch (id) {
    case "loop": {
      const inLoop = tr.filter((s) => s.phase === 1);
      const r = roundness(inLoop.map((s) => [along(s), s.pa[2]]));
      return marks({
        round: [markOf(r.spread, 0.04, 0.2), 3, "not round: keep the circle — lighter over the top"],
        height: [markOf(Math.abs(z.p[2] - a.p[2]), 30, 300), 2, "the exit's height off the entry's"],
        heading: [markOf(headingDev(trackOf(z), h0) / D, 2, 15), 2, "the exit's heading off the entry's"],
        plane: [markOf(drift, 40, 400), 2, "out of its plane: the wings were not level"],
        wings: [markOf(wingsLevelDev(inLoop) / D, 5, 30), 1, "the wings rolled off level"],
      });
    }
    case "immelmann": {
      // (its half loop: from the entry to the top)
      const top = tr.reduce((k, s, i) => (s.p[2] > tr[k]!.p[2] ? i : k), 0);
      const r = roundness(tr.slice(Math.min(15, top), top).map((s) => [along(s), s.p[2]]));
      return marks({
        round: [markOf(r.spread, 0.05, 0.25), 2, "the half loop not round"],
        reversed: [markOf(Math.abs(headingDev(trackOf(z), h0) - Math.PI) / D, 3, 20), 2, "the heading not reversed"],
        level: [markOf(Math.abs(gammaOf(z)) / D, 3, 15), 2, "not level at the exit"],
        upright: [markOf(Math.abs(bankOf(z)) / D, 5, 30), 2, "the wings not level at the exit"],
        plane: [markOf(drift, 60, 500), 1, "out of its plane"],
      });
    }
    case "splitS":
      return marks({
        reversed: [markOf(Math.abs(headingDev(trackOf(z), h0) - Math.PI) / D, 3, 20), 2, "the heading not reversed"],
        level: [markOf(Math.abs(gammaOf(z)) / D, 3, 15), 2, "not level at the exit"],
        upright: [markOf(Math.abs(bankOf(z)) / D, 5, 30), 2, "the wings not level at the exit"],
        plane: [markOf(drift, 60, 500), 2, "out of its plane: the wings not level in the pull"],
        time: [timeMark, 1, "slow"],
      });
    case "aileronRoll": {
      const hs = tr.map((s) => s.p[2] - a.p[2]);
      return marks({
        heading: [markOf(headingDev(trackOf(z), h0) / D, 3, 20), 2, "the heading wandered"],
        height: [markOf(Math.max(...hs.map(Math.abs)), 40, 300), 2, "the height wandered"],
        upright: [markOf(Math.abs(bankOf(z)) / D, 5, 30), 1, "the wings not level at the exit"],
        time: [timeMark, 1, "slow"],
      });
    }
    case "barrelRoll":
      return marks({
        heading: [markOf(headingDev(trackOf(z), h0) / D, 5, 30), 2, "the exit's heading off the entry's"],
        height: [markOf(Math.abs(z.p[2] - a.p[2]), 60, 500), 2, "the exit's height off the entry's"],
        upright: [markOf(Math.abs(bankOf(z)) / D, 5, 30), 1, "the wings not level at the exit"],
        time: [timeMark, 1, "slow"],
      });
    case "cuban8": {
      // (its two lobes: the halves of the trace before and after its middle, each fitted)
      // (its two loops: the states flown in their phases — the first and the fifth)
      const lobe = (ph: number) => roundness(tr.filter((s) => s.phase === ph).map((s) => [along(s), s.pa[2]]));
      const l1 = lobe(1),
        l2 = lobe(5);
      return marks({
        round: [markOf((l1.spread + l2.spread) / 2, 0.06, 0.3), 2, "the loops not round"],
        symmetric: [markOf(Math.abs(l1.r - l2.r) / Math.max(l1.r, l2.r, 1), 0.08, 0.4), 2, "the two loops not alike"],
        heading: [markOf(headingDev(trackOf(z), h0) / D, 3, 20), 2, "the exit's heading off the entry's"],
        height: [markOf(Math.abs(z.p[2] - a.p[2]), 80, 600), 1, "the exit's height off the entry's"],
        plane: [markOf(drift, 80, 600), 1, "out of its plane"],
      });
    }
    case "inverted": {
      const inv = tr.filter((s) => s.up[2] < -0.9);
      const span = inv.length ? inv.at(-1)!.t - inv[0]!.t : 0;
      const hs = inv.map((s) => Math.abs(s.p[2] - a.p[2]));
      return marks({
        held: [markOf(Math.max(0, 10 - span), 0.5, 5), 2, "not ten seconds inverted"],
        height: [markOf(hs.length ? Math.max(...hs) : 999, 30, 250), 2, "the height wandered on its back"],
        heading: [markOf(headingDev(trackOf(z), h0) / D, 3, 20), 1, "the heading wandered"],
        upright: [markOf(Math.abs(bankOf(z)) / D, 5, 30), 1, "the wings not level at the exit"],
      });
    }
    case "highAlpha": {
      const hold = tr.filter((s) => s.alpha > 33 * D);
      const span = hold.length ? hold.at(-1)!.t - hold[0]!.t : 0;
      const hs = hold.map((s) => Math.abs(s.p[2] - a.p[2]));
      const am = hold.length ? hold.reduce((x, s) => x + s.alpha, 0) / hold.length : 0;
      const asd = hold.length ? Math.sqrt(hold.reduce((x, q) => x + (q.alpha - am) ** 2, 0) / hold.length) : 1;
      return marks({
        held: [markOf(Math.max(0, 10 - span), 0.5, 6), 2, "not ten seconds at high incidence"],
        alpha: [markOf(Math.abs(am / D - 40), 4, 15), 2, "the incidence off 40°"],
        steady: [markOf(asd / D, 2, 8), 2, "the incidence not steady: hold the stick, fly the height on the throttle"],
        height: [markOf(hs.length ? Math.max(...hs) : 999, 40, 300), 2, "the height wandered"],
        heading: [markOf(headingDev(trackOf(z), h0) / D, 5, 30), 1, "the heading wandered"],
      });
    }
    case "reversal": {
      const rev = tr.find((s) => headingDev(trackOf(s), h0) > Math.PI - 0.15);
      const tRev = rev ? rev.t - a.t : 99;
      const hs = tr.filter((s) => !rev || s.t <= rev.t).map((s) => Math.abs(s.p[2] - a.p[2]));
      return marks({
        time: [markOf(tRev, 12, 22), 3, "slow to reverse: pull to the limit, at the corner speed"],
        height: [markOf(Math.max(...hs), 60, 400), 2, "the height not held: the bank too steep or too shallow"],
        out: [markOf(Math.abs(bankOf(z)) / D, 6, 30), 1, "the wings not level at the exit"],
      });
    }
    case "spin": {
      // (the turns, the recovery's time from letting go, the height it cost to level)
      let yaw = 0;
      let letGo: AeroState | null = null;
      let stopped: AeroState | null = null;
      for (let i = 1; i < tr.length; i++) {
        const s = tr[i]!;
        if (!letGo) yaw += Math.abs(s.r) * (s.t - tr[i - 1]!.t);
        if (!letGo && yaw >= 4 * Math.PI - 0.3) letGo = s;
        if (letGo && !stopped && Math.hypot(s.p_, s.r) < 6 * D && s.alpha < 20 * D) stopped = s;
      }
      return marks({
        turns: [markOf(Math.max(0, 4 * Math.PI - yaw) / D, 20, 360), 2, "less than two turns"],
        recovery: [markOf(stopped && letGo ? stopped.t - letGo.t : 30, 8, 25), 3, "slow to recover: let go of everything"],
        height: [markOf(letGo ? letGo.p[2] - z.p[2] : 9999, 1800, 4500), 2, "a lot of height to pull out"],
      });
    }
  }
}
