// The air-to-air refuelling (docs/F35.md, "Air refuelling"): a hose and its drogue trailed from a pod under the tanker's
// wing (an A330 MRTT's, a Voyager's — the F-35B's and C's way: their probe into a basket), the receiver's probe flown
// into it. The basket hangs at its hose's end, wanders a little in the air, and is pushed up and out by the receiver's
// own bow wave in its last metres; met within its throat's reach at a gentle closing speed, it locks on the probe —
// faster it bounces off, off-centre it is missed. Locked, the probe pushes the hose in (the reel takes up its slack):
// the fuel flows once it is pushed in far enough and while it stays in its range — too far, the hose whips (a
// breakaway); back out, a disconnect. The pod's lights tell it: amber (cleared, ready), green (fuel flowing), red
// (breakaway, stop).
//
// Frames: the tanker's own — `[right, fwd, up]` from its origin [m] —; its meshes' (scripts/build-tanker.ts: x its left,
// y up, z its nose). Pure.

const D = Math.PI / 180;
type V3 = readonly [number, number, number] | number[];
const add = (a: V3, b: V3): number[] => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
const sub = (a: V3, b: V3): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const mul = (a: V3, k: number): number[] => [a[0]! * k, a[1]! * k, a[2]! * k];
const dot = (a: V3, b: V3) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

export const AAR = {
  /** a pod under each wing (the mesh's frame, the left one: x > 0): its centre, its length and radius; the wing's
   *  underside above it [m] */
  pod: { x: 11, y: -0.75, z: -2.4, len: 3, r: 0.36, wingY: -0.08 },
  /** the hose trailed [m]; its droop under the tanker's axis at a refuelling speed [rad] */
  hose: 24,
  trail: 9 * D,
  /** the basket's canopy: its rim's radius, its depth [m]; the coupling's throat behind the hose's end — where the
   *  nozzle locks [m] */
  basket: { r: 0.62, depth: 0.8 },
  throat: 0.25,
  /** the F-35's probe (its mesh's frame — x its left —: the right of the forward fuselage), out: its root, its tip */
  probe: { base: [-0.55, 1.45, 4.7] as [number, number, number], tip: [-0.95, 1.62, 6.9] as [number, number, number] },
  /** its extension's time [s] */
  probeTime: 2.5,
  /** the probe caught within this of the basket's axis [m] (the canopy funnels it in), its rim hit within this */
  capture: 0.42,
  rim: 0.85,
  /** the closing speed at contact [m/s]: under the least the coupling does not lock (a nudge), over the most the
   *  basket bounces off */
  closeMin: 0.25,
  closeMax: 2.6,
  /** the hose pushed in from where it was met [m]: the fuel flows in this range; past the most, a breakaway; pulled
   *  back behind it by the least, the probe out (a disconnect); pulled off its line across by this, out too */
  flow: [0.9, 4.6] as const,
  whip: 6.5,
  out: 0.3,
  side: 3.2,
  /** the basket pushed by the receiver's bow wave within this behind it [m], by this at most (up, out) [m] */
  bow: 5,
  bowPush: 0.32,
  /** the transfer's rate [kg/s] (the F-35's probe's: ~1 200 kg a minute) */
  rate: 20,
  /** the pre-contact (astern) position: the probe this far behind the basket [m]; held within this and slower than
   *  this for the clearance [m], [m/s], that long [s] */
  astern: 5,
  steadyR: 1.6,
  steadyV: 0.6,
  clearAfter: 2,
  /** the breakaway: back this far behind the basket [m] at least this long [s] before cleared again */
  backOff: 15,
  backTime: 6,
  /** a practice's offload when the tanks cannot take it (infinite fuel) [kg] */
  practice: 2000,
} as const;

export type AarSide = "left" | "right";
export type AarPhase = "astern" | "contact" | "breakaway" | "done";
export type AarLights = "off" | "amber" | "green" | "red";

/** The mesh's frame (x left, y up, z nose) to the tanker's (right, fwd, up). */
export const meshToT = (p: V3): number[] => [-p[0]!, p[2]!, p[1]!];

/** The hose's exit (the pod's tail) on a side, in the tanker's frame [m]. */
export function podExit(side: AarSide): number[] {
  const P = AAR.pod;
  return meshToT([(side === "left" ? 1 : -1) * P.x, P.y, P.z - P.len / 2]);
}

/** The hose's way out of the pod (unit, the tanker's frame): back and drooping. */
export const hoseDir = (): number[] => [0, -Math.cos(AAR.trail), -Math.sin(AAR.trail)];

/** Where the basket's throat hangs at rest, on a side (the tanker's frame). */
export const trailPoint = (side: AarSide): number[] => add(podExit(side), mul(hoseDir(), AAR.hose + AAR.throat));

/** The basket's own wander in the air about where it hangs [m] (calm air: a few centimetres, a few seconds). */
export function wander(t: number, side: AarSide): number[] {
  const f = side === "left" ? 1.7 : 0.4;
  return [
    0.09 * Math.sin(0.61 * t + f) + 0.04 * Math.sin(1.73 * t + 2 * f),
    0,
    0.07 * Math.sin(0.47 * t + 3 * f) + 0.03 * Math.sin(1.31 * t + f),
  ];
}

/**
 * The free basket (the tanker's frame): its trail point, its wander, the receiver's bow wave — its probe `tip` within
 * `AAR.bow` behind it and near its line: the basket pushed up and outboard (the side's way), more the nearer.
 */
export function basketFree(side: AarSide, t: number, tip: V3 | null): number[] {
  const T = trailPoint(side);
  let b = add(T, wander(t, side));
  if (tip) {
    const a = mul(hoseDir(), -1);
    const behind = dot(sub(b, tip), a);
    const off = Math.hypot(...sub(sub(b, tip), mul(a, behind)));
    // (kept on as the tip goes through its throat — the basket on the nose, not dropped back as it passes)
    if (behind > -1.5 && behind < AAR.bow && off < 3) {
      const k = (1 - Math.max(behind, 0) / AAR.bow) * (1 - off / 3);
      b = add(b, [(side === "left" ? -1 : 1) * 0.45 * AAR.bowPush * k, 0, AAR.bowPush * k]);
    }
  }
  return b;
}

/** The probe tip relative to the basket, along the hose's axis (> 0: still behind it) and off it [m]. */
export function gapOf(tip: V3, basket: V3): { along: number; off: number; v: number[] } {
  const a = mul(hoseDir(), -1);
  const d = sub(basket, tip);
  const along = dot(d, a);
  const lat = sub(d, mul(a, along));
  return { along, off: Math.hypot(...lat), v: d };
}

/** The refuelling's state: the phase, its time, the basket now, locked or not, the hose pushed in, the fuel given. */
export interface AarState {
  side: AarSide;
  phase: AarPhase;
  /** in the phase [s]; held steady astern [s] */
  t: number;
  steady: number;
  cleared: boolean;
  /** the basket's throat (the tanker's frame); where it was met (locked: the hose's push measured from there) */
  basket: number[];
  ref: number[];
  /** the hose pushed in [m] (locked), the fuel flowing */
  takeup: number;
  flowing: boolean;
  /** the flow told (once a contact) */
  flowSaid: boolean;
  /** given so far [kg]; to give [kg]; the tanks full (the offload asked done) */
  given: number;
  want: number;
  full: boolean;
  /** the last frame's gap along the axis (its closing speed's) */
  lastAlong: number | null;
  closure: number;
  /** the contacts made, the misses (bounced, off-centre) */
  contacts: number;
  misses: number;
  /** the probe's tip now (the tanker's frame) */
  tip: number[];
}

export function aarNew(side: AarSide, want: number): AarState {
  return {
    side,
    phase: "astern",
    t: 0,
    steady: 0,
    cleared: false,
    basket: trailPoint(side),
    ref: trailPoint(side),
    takeup: 0,
    flowing: false,
    flowSaid: false,
    given: 0,
    want,
    full: false,
    lastAlong: null,
    closure: 0,
    contacts: 0,
    misses: 0,
    tip: [0, 0, 0],
  };
}

export type AarEvent =
  | "cleared"
  | "contact"
  | "flow"
  | "toofast"
  | "rim"
  | "missed"
  | "disconnect"
  | "pulledout"
  | "full"
  | "breakaway"
  | "recleared"
  | "depart";

/** A closing speed eased over 0.3 s (a frame's own, at 60 frames a second, jitters by tenths of a metre a second). */
const ease = (was: number, now: number, dt: number) => was + (now - was) * Math.min(1, dt / 0.3);

/** The pod's lights now. */
export function lightsOf(s: AarState): AarLights {
  if (s.phase === "breakaway") return "red";
  if (s.phase === "done") return "off";
  return s.flowing ? "green" : "amber";
}

/**
 * A step of the refuelling: the probe's tip `tip` (the tanker's frame) at the time `t` [s], `dt` [s]; what happened.
 * The fuel given is the caller's to put in the tanks (`given`'s growth).
 */
export function aarStep(s: AarState, tip: V3, t: number, dt: number): AarEvent[] {
  const ev: AarEvent[] = [];
  s.t += dt;
  s.tip = [...tip];
  const a = mul(hoseDir(), -1);
  if (s.phase === "contact") {
    // (locked: the basket on the probe, the hose pushed in by how far it is ahead of where it was met)
    s.basket = [...tip];
    const d = sub(tip, s.ref);
    s.takeup = dot(d, a);
    const side = Math.hypot(...sub(d, mul(a, s.takeup)));
    s.closure = ease(s.closure, s.lastAlong === null || !(dt > 0) ? 0 : (s.takeup - s.lastAlong) / dt, dt);
    s.lastAlong = s.takeup;
    if (s.takeup > AAR.whip) {
      s.phase = "breakaway";
      s.t = 0;
      s.flowing = false;
      s.lastAlong = null;
      ev.push("breakaway");
      return ev;
    }
    if (s.takeup < -AAR.out || side > AAR.side) {
      s.phase = "astern";
      s.t = s.steady = 0;
      s.flowing = false;
      s.lastAlong = null;
      ev.push(side > AAR.side ? "pulledout" : "disconnect");
      return ev;
    }
    const inRange = s.takeup >= AAR.flow[0] && s.takeup <= AAR.flow[1];
    if (inRange && !s.full) {
      if (!s.flowSaid) ev.push("flow");
      s.flowSaid = true;
      s.flowing = true;
      s.given = Math.min(s.want, s.given + AAR.rate * dt);
      if (s.given >= s.want - 1e-6) {
        s.full = true;
        s.flowing = false;
        ev.push("full");
      }
    } else s.flowing = false;
    return ev;
  }
  // (free: the basket where it hangs, pushed by our bow wave)
  s.basket = basketFree(s.side, t, tip);
  const g = gapOf(tip, s.basket);
  const prev = s.lastAlong;
  s.closure = ease(s.closure, prev === null || !(dt > 0) ? s.closure : (prev - g.along) / dt, dt);
  s.lastAlong = g.along;
  if (s.phase === "breakaway") {
    // (back far enough, long enough: cleared to try again)
    if (g.along > AAR.backOff && s.t > AAR.backTime) {
      s.phase = "astern";
      s.t = s.steady = 0;
      s.cleared = false;
      ev.push("recleared");
    }
    return ev;
  }
  if (s.phase === "done") return ev;
  // astern: held steady behind it — cleared to contact (once; again after a miss or a disconnect, the clearance
  // stands); then the probe crossing the throat's plane
  const steady = g.along > 1.5 && g.along < AAR.astern + 4 && g.off < AAR.steadyR && Math.abs(s.closure) < AAR.steadyV;
  s.steady = steady ? s.steady + dt : 0;
  if (!s.cleared && s.steady > AAR.clearAfter && !s.full) {
    s.cleared = true;
    ev.push("cleared");
  }
  // (the tanks full, back astern: cleared to leave)
  if (s.full && g.along > AAR.astern - 1 && s.t > 2) {
    s.phase = "done";
    ev.push("depart");
    return ev;
  }
  if (prev !== null && prev > 0 && g.along <= 0) {
    if (g.off <= AAR.capture && !s.full) {
      if (s.closure > AAR.closeMax) {
        s.misses++;
        ev.push("toofast");
      } else if (s.closure >= AAR.closeMin) {
        s.phase = "contact";
        s.t = 0;
        s.ref = [...s.basket];
        s.flowSaid = false;
        s.contacts++;
        s.lastAlong = null;
        s.takeup = 0;
        ev.push("contact");
      }
    } else if (g.off <= AAR.rim) {
      s.misses++;
      ev.push("rim");
    } else if (g.off < 3) {
      s.misses++;
      ev.push("missed");
    }
  }
  return ev;
}

/** The probe's tip on the receiver (its mesh's frame) as the probe comes out: 0 in, 1 out. */
export function probeTipAt(ext: number): number[] {
  const { base, tip } = AAR.probe;
  return add(tip, mul(sub(base, tip), 1.1 * (1 - clamp(ext, 0, 1))));
}
