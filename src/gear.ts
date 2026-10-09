// The landing gear (phase 2, audit: "projection rigide plus frottement de Coulomb … crash à 12 m/s"):
// legs that are springs and dampers along the ground's own normal, tyres that grip by their slip, brakes
// held at the tyres' peak by an anti-skid, a steerable nose wheel; the touchdown judged by the sink rate
// the gear can absorb (a real one: ≈ 3 m/s — 10 ft/s, the certification's —, a hard landing beyond that,
// a collapse past the crash speed), the craft tipping over when it leans past its gear's base.
//
// Pure physics in a world frame, SI units: the flight (controller/motion.ts) gives the craft's pose and
// motion and the ground under each wheel, and gets forces and torques back.

import { add, cross, dot, len, scale, sub } from "./math/vec3";
import type { V3 } from "./mounts";

export interface Leg {
  /** the wheel's contact point at full extension (ship frame: x left, y up, z nose — metres from the
   *  craft's reference point, the gear's height GEAR below it at rest) */
  at: V3;
  /** its stroke [m]; the share of the craft's weight it carries at rest */
  stroke: number;
  share: number;
  /** a wheel (rolls, brakes, steers if it is the nose's) — else a pad (a lander's foot: grips) */
  wheel: boolean;
  steers?: boolean;
  brakes?: boolean;
  /** its own sideways grip (a nose wheel's, smaller: a light, castering tyre) — none: the gear's */
  mu?: number;
}

export interface GearDef {
  /** the reference point (the belly) above the wheels' contact at rest [m]: landing.ts GEAR while flown */
  height: number;
  legs: Leg[];
  /** the static compression at 1 g, as a share of the stroke; the dampers' ratio */
  sag: number;
  zeta: number;
  /** the tyres' (pads') peak friction, the brakes' with the anti-skid, the rolling resistance */
  mu: number;
  muBrake: number;
  roll: number;
}

const G0 = 9.80665;

/** A leg's wheel at full extension: the gear's height below the belly, plus its sag at rest. */
const legY = (height: number, stroke: number, sag: number) => -(height + sag * stroke);

/** The craft's gears: the Ranger's tricycle (a nose wheel that steers, two braked mains), the Lander's
 *  four pads. The legs reach the gear's height below the reference point (the belly), plus their sag. */
export const GEARS: Record<string, GearDef> = {
  ranger: {
    // (1.8 m: the Ranger at its own scale on the runway — its gear 6 m long, invisible, set it floating)
    height: 1.8,
    legs: [
      // (the mains 3.3 m behind the centre of mass — z 1.5 —: the weight holds the nose down on the ground
      // against the air's pitching moment; the nose wheel carries two fifths. Under the wings, 8 m apart: a
      // centre of mass 7.4 m up needs the track — the Shuttle's was 6.9 m, lower)
      { at: [0, legY(1.8, 0.4, 0.3), 6.5], stroke: 0.4, share: 0.4, wheel: true, steers: true, mu: 0.35 },
      { at: [4, legY(1.8, 0.45, 0.3), -1.8], stroke: 0.45, share: 0.3, wheel: true, brakes: true },
      { at: [-4, legY(1.8, 0.45, 0.3), -1.8], stroke: 0.45, share: 0.3, wheel: true, brakes: true },
    ],
    sag: 0.3,
    zeta: 0.6,
    mu: 0.8,
    muBrake: 0.45,
    roll: 0.015,
  },
  lander: {
    height: 6,
    legs: [
      { at: [4.2, -6.15, 4.2], stroke: 0.5, share: 0.25, wheel: false },
      { at: [-4.2, -6.15, 4.2], stroke: 0.5, share: 0.25, wheel: false },
      { at: [4.2, -6.15, -4.2], stroke: 0.5, share: 0.25, wheel: false },
      { at: [-4.2, -6.15, -4.2], stroke: 0.5, share: 0.25, wheel: false },
    ],
    sag: 0.3,
    zeta: 0.7,
    mu: 0.7,
    muBrake: 0.7,
    roll: 0,
  },
};

/** The Ranger's belly, gear up (PLAN-COCKPIT K4b): skids where the hull's underside is lowest — the nose,
 *  the fuselage either side, the tail — that slide on the ground, scraping (pads: they grip as the
 *  hull's metal does, a sliding friction), no spring to speak of. Its height 0: the belly on the ground. */
export const BELLY: Record<string, GearDef> = {
  ranger: {
    height: 0,
    legs: [
      { at: [0, 0.1, 7.5], stroke: 0.08, share: 0.25, wheel: false },
      { at: [1.4, 0.05, 1], stroke: 0.08, share: 0.25, wheel: false },
      { at: [-1.4, 0.05, 1], stroke: 0.08, share: 0.25, wheel: false },
      { at: [0, 0.2, -4.5], stroke: 0.08, share: 0.25, wheel: false },
    ],
    sag: 0.3,
    zeta: 0.9,
    mu: 0.45,
    muBrake: 0.45,
    roll: 0,
  },
};

/** The gear's travel, down or up [s]. */
export const GEAR_TRAVEL_S = 8;

/** The gear moved over `dt` seconds towards down (1) or up (0): its extension 0…1. */
export function stepGear(ext: number, down: boolean, dt: number): number {
  const k = dt / GEAR_TRAVEL_S;
  return down ? Math.min(ext + k, 1) : Math.max(ext - k, 0);
}

/** The gear lowered by itself (the setting, an autopilot flying the approach or the take-off): on the
 *  wheels, or below 600 m over the ground under 250 m/s — the final's whole length: at 160 m/s, as it was
 *  (for the drag alone), an approach flown at 170 met the runway with its gear half out. */
export const gearByItself = (onGround: boolean, h: number | undefined, speed: number | undefined) =>
  onGround || (h !== undefined && h < 600 && (speed === undefined || speed < 250));

/** The touchdown's limits [m/s down]: up to `limit` a landing, to `crash` a hard one, beyond a crash. */
export function touchdownVerdict(sink: number, crash: number, forgiving = false): "landed" | "hard" | "crashed" {
  const k = forgiving ? 3 : 1;
  const limit = (2 / 3) * crash * k;
  if (sink <= limit) return "landed";
  return sink <= crash * k ? "hard" : "crashed";
}

/** The tyre's grip at a slip [rad or ratio]: a simplified magic formula, its peak μ near 8–10°. */
export const tyreGrip = (slip: number, mu: number) => mu * Math.sin(1.3 * Math.atan(17 * slip));

export interface Ground {
  /** the height of a point above the ground along its normal [m], the normal there (unit, up), the
   *  ground's velocity there [m/s] */
  at(p: V3): { h: number; n: V3; v: V3 };
}

export interface GearInput {
  /** the craft's mass [kg], the local gravity [m/s²] the springs are sized for (1 g: their own) */
  mass: number;
  /** its reference point and its velocity [m, m/s], its axes in the world (x left, y up, z nose) */
  X: V3;
  V: V3;
  axes: [V3, V3, V3];
  /** its angular velocity in the world [rad/s] */
  w: V3;
  /** its centre of mass from the reference point, in the world [m] — the torque's centre (none: X) */
  com?: V3;
  /** the brakes 0…1, the nose wheel's steering [rad] (+: to the left) */
  brake: number;
  steer: number;
}

export interface GearOut {
  /** the force on the craft [N] and its torque about its centre of mass [N m], world */
  F: V3;
  M: V3;
  /** the legs touching; the most compressed one's compression over its stroke; a leg at its stop */
  contact: number;
  squash: number;
  bottomed: boolean;
  /** the normal loads [N] and the slips (the side's angle, the brake's ratio) per leg */
  legs: { load: number; comp: number; slip: number }[];
}

/**
 * The gear's forces now: per leg, its compression along the ground's normal (the spring k x and the
 * damper c ẋ — never pulling —, a stiff stop past its stroke), its tyre's grip across its rolling
 * direction by the slip angle, the brakes along it held by the anti-skid at the braked peak, the rolling
 * resistance; a pad grips both ways at its friction. k is sized for the leg's share of the weight at 1 g
 * to sag `sag` of its stroke, c for the damping ratio on that share.
 */
export function gearForces(def: GearDef, i: GearInput, ground: Ground): GearOut {
  let F: V3 = [0, 0, 0],
    M: V3 = [0, 0, 0];
  let contact = 0,
    squash = 0,
    bottomed = false;
  const legs: GearOut["legs"] = [];
  const [ax, ay, az] = i.axes;
  for (const L of def.legs) {
    const r: V3 = add(add(scale(ax, L.at[0]), scale(ay, L.at[1])), scale(az, L.at[2]));
    const p = add(i.X, r);
    const gr = ground.at(p);
    const comp = -gr.h;
    if (comp <= 0) {
      legs.push({ load: 0, comp: 0, slip: 0 });
      continue;
    }
    contact++;
    const n = gr.n;
    // (the wheel's velocity over the ground: the craft turning about its centre of mass)
    const vp = sub(add(i.V, cross(i.w, i.com ? sub(r, i.com) : r)), gr.v);
    const closing = -dot(vp, n);
    const m = L.share * i.mass;
    const k = (m * G0) / (def.sag * L.stroke);
    const c = 2 * def.zeta * Math.sqrt(k * m);
    // (an oleo strut: its gas stiffening towards the end of the stroke — three times at its stop —, its
    // orifice damping the rebound twice as hard as the stroke: no bounce)
    const x = Math.min(comp, L.stroke);
    let N = k * x * (1 + 2 * (x / L.stroke) ** 2) + c * closing;
    if (comp > L.stroke) {
      // (the stop: a stiff one, fifty times the spring, and a hard damper)
      bottomed = true;
      N += 50 * k * (comp - L.stroke) + 4 * c * Math.max(closing, 0);
    }
    N = Math.max(N, 0);
    squash = Math.max(squash, comp / L.stroke);
    // the tyre: its rolling direction in the ground's plane (the nose wheel turned by the steering)
    const vt = sub(vp, scale(n, dot(vp, n)));
    let fwd = sub(az, scale(n, dot(az, n)));
    const fl = len(fwd);
    fwd = fl > 1e-6 ? scale(fwd, 1 / fl) : fwd;
    if (L.steers && i.steer !== 0) {
      const c0 = Math.cos(i.steer),
        s0 = Math.sin(i.steer);
      fwd = add(scale(fwd, c0), scale(cross(n, fwd), s0));
    }
    const side = cross(n, fwd);
    const vl = dot(vt, fwd),
      vs = dot(vt, side);
    let ft: V3;
    let slip = 0;
    if (!L.wheel) {
      // (a pad: friction against its slide, viscous when barely moving — no stick-slip chatter)
      const sp = len(vt);
      const f = def.mu * N * Math.min(sp / 0.05, 1);
      ft = sp > 0 ? scale(vt, -f / sp) : [0, 0, 0];
    } else {
      // across: the slip angle's grip (at a crawl, as a damper: the angle undefined)
      slip = Math.atan2(vs, Math.max(Math.abs(vl), 1));
      const lat = -tyreGrip(slip, L.mu ?? def.mu) * N;
      // along: rolling, and the brakes at the anti-skid's peak (none backwards past a crawl)
      // (the brakes' band of a crawl 5 cm/s: parked on a slope they hold — over 30 cm/s, a 9° crater's rim
      // let the Ranger creep down it at 18 cm/s for ever, never standing)
      const brake = L.brakes ? i.brake * def.muBrake : 0;
      const resist = (def.roll * Math.min(Math.abs(vl) / 0.3, 1) + brake * Math.min(Math.abs(vl) / 0.05, 1)) * N;
      ft = add(scale(side, lat), scale(fwd, -Math.sign(vl) * resist));
    }
    const f = add(scale(n, N), ft);
    F = add(F, f);
    M = add(M, cross(i.com ? sub(r, i.com) : r, f));
    legs.push({ load: N, comp, slip });
  }
  return { F, M, contact, squash, bottomed, legs };
}

/**
 * Tipped over: the craft's up more than its gear's base allows from the ground's normal — the centre of
 * mass past the line of the outer wheels (the base's half-width over the height of the centre).
 */
export function tippedOver(def: GearDef, up: V3, n: V3, comY = 0): boolean {
  const half = Math.min(...def.legs.map((l) => Math.hypot(l.at[0], l.at[2]) || Infinity).filter((x) => x > 0.5));
  const height = Math.abs(def.legs[0]!.at[1]) + comY;
  const limit = Math.atan2(half, height);
  return Math.acos(Math.min(1, Math.max(-1, dot(up, n)))) > Math.max(limit, 0.35);
}

/** A body-frame tensor turned into the world: A I Aᵀ (A's columns: the craft's axes there). */
export function worldTensor(I: [V3, V3, V3], axes: [V3, V3, V3]): [V3, V3, V3] {
  const out: [V3, V3, V3] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let x = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) x += axes[a]![i]! * I[a]![b]! * axes[b]![j]!;
      out[i]![j] = x;
    }
  return out;
}

/** A 3 × 3 matrix times a vector. */
export const mulM3 = (m: [V3, V3, V3], v: V3): V3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
