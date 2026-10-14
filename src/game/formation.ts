// Formation flight (the network's wingman): a slot held on a leader's craft — off his wing, behind, above, in
// his own frame (his track, the up there, his right) — by the plane law's bank and flight path and the
// autothrottle's speed. Pure: the two craft's places and velocities in (fixed to the Earth [m], [m/s]), the
// commands out (controller/jet.ts flies them, ui/netsession.ts gives it the leader).
//
// Each axis a critically damped loop on the slot's error with its closing speed capped: the relative velocity
// asked ∝ the error (at most `vMax`), the acceleration ∝ the velocity's error, the leader's own acceleration
// added (his turns, his speed's changes) — far off, a rejoin at the capped speed; near, the slot held to a
// metre. The lateral acceleration flown as a bank (g·tan φ), the one along as the autothrottle's target speed
// (it asks `spdGain` m/s² per m/s), the vertical as a climb angle.

import { JET } from "./jet";

type V3 = readonly [number, number, number] | number[];
const dot = (a: V3, b: V3) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const sub = (a: V3, b: V3): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const scale = (a: V3, k: number): number[] => [a[0]! * k, a[1]! * k, a[2]! * k];
const unit = (a: V3): number[] => scale(a, 1 / (Math.hypot(a[0]!, a[1]!, a[2]!) || 1));
const cross = (a: V3, b: V3): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const G = 9.81;
const D = Math.PI / 180;

/** The slot [m] in the leader's frame: to his right (< 0: his left), behind him, above him. */
export interface FormSlot {
  right: number;
  back: number;
  up: number;
}

/** A craft's state fixed to the Earth: place [m], velocity [m/s]; the leader's acceleration [m/s²] too. */
export interface FormCraft {
  p: V3;
  v: V3;
  a?: V3;
  /** its nose (a slow leader's frame: his nose, not his track) */
  fwd?: V3;
  /** his acceleration across his track [m/s²] (> 0: turning right) — from his bank (formationBank, bankAccel) —
   *  when known: his turn at once as he rolls; else his measured acceleration's */
  aLat?: number;
}

export const FORM = {
  /** the loops' natural frequencies [rad/s] and damping: across, along; up: the height's closing rate [1/s] */
  wC: 0.2,
  wA: 0.6,
  wU: 0.2,
  zeta: 0.9,
  /** the closing speeds at most [m/s]: across, along (each way), up */
  vC: 40,
  vA: 45,
  vU: 15,
  /** the deceleration the closing counts on to stop on the slot [m/s²]: along (the drag at idle), across */
  stopA: 0.6,
  stopC: 2.5,
  /** the bank at most [rad] (a formation's: steeper than the heading hold's) */
  bankMax: 45 * D,
  /** the slowing the engine at idle gives (its drag) [m/s²]; the air brake's, out [m/s²] (aero.ts: +0.04 of the
   *  wing's area in drag — 1.9 m/s² for an F-35 at 220 m/s, 3000 m) */
  idleDecel: 0.8,
  brakeDecel: 1.8,
  /** the keep-out about the leader [m]: across (two F-35s' half spans and a margin), along, up; its push [m/s² per m] */
  keepOut: 14,
  keepAlong: 20,
  keepUp: 8,
  keepGain: 0.6,
  /** crossing to his other side: behind him by this at least [m] */
  crossBack: 35,
  /** under this speed [m/s] the leader's frame is his nose's, not his track's */
  slowV: 20,
} as const;

/** A craft's bank [rad] (> 0: right wing down) from its attitude — its top and right wing — at its place `p` (against
 *  the vertical there). */
export function formationBank(p: V3, top: V3, wing: V3): number {
  const up = unit(p);
  return Math.atan2(-dot(wing, up), dot(top, up));
}

/** The acceleration across its track of a craft in a coordinated turn at a bank φ [m/s²]: g·tan φ. */
export const bankAccel = (phi: number) => G * Math.tan(clamp(phi, -60 * D, 60 * D));

export interface FormOut {
  /** the plane law's bank [rad] (right > 0) and flight path angle [rad] */
  bank: number;
  gamma: number;
  /** the autothrottle's target speed through the air [m/s]; the air brake out 0…1 (a slowing idle cannot give); the
   *  acceleration asked along our track [m/s²] (the afterburner's, past what the dry engine gives) */
  spd: number;
  brake: number;
  acc: number;
  /** the slot's error [m] in the leader's frame: ahead, to the right, above; its length */
  along: number;
  cross: number;
  up: number;
  dist: number;
  /** the closing speed on the slot [m/s] (> 0: closing) */
  closing: number;
}

/**
 * A frame of the formation: our craft `o` (its speed through the air V [m/s]), the leader `L`, the slot.
 */
export function formationStep(o: FormCraft, V: number, L: FormCraft, slot: FormSlot): FormOut {
  // (the leader's frame: the up at his place, his track flat — his nose when slow —, his right)
  const up = unit(L.p);
  const along = (w: V3) => sub(w, scale(up, dot(w, up)));
  const vh = along(L.v);
  const fwd = Math.hypot(vh[0]!, vh[1]!, vh[2]!) > FORM.slowV || !L.fwd ? unit(vh) : unit(along(L.fwd));
  const right = cross(fwd, up);
  // (not clear of his wings on the slot's side — on his other side, cutting in, his turn's roll-in —: the slot
  // taken farther back by degrees, all the way once within his reach; and until that far back, kept out on the side
  // we are: crossed behind him)
  const d = sub(o.p, L.p);
  const side = Math.sign(slot.right) || 1;
  const lat = dot(d, right);
  const here = Math.sign(lat) || side;
  const wide = Math.abs(slot.right) >= FORM.keepOut;
  const g = wide ? clamp((FORM.keepOut + 6 - side * lat) / 10, 0, 1) : 0;
  const back = slot.back + (Math.max(slot.back, FORM.crossBack) - slot.back) * g;
  const across = g >= 1 && -dot(d, fwd) < FORM.crossBack - 8 ? here * Math.max(FORM.keepOut + 6, here * lat) : slot.right;
  // (the slot, the error to it, the velocity relative to the leader's)
  const S = [0, 1, 2].map((k) => L.p[k]! + right[k]! * across - fwd[k]! * back + up[k]! * slot.up);
  const e = sub(S, o.p);
  const aL = L.a ?? [0, 0, 0];
  // (the slot turns with him: its velocity his plus ω × r — in his right turn, the slot on his right slower, a
  // slot behind him swung to his left; his turn's rate from his acceleration across)
  // (his acceleration across: from his bank when given, else as measured)
  const vhL = Math.hypot(vh[0]!, vh[1]!, vh[2]!);
  const aLat = L.aLat ?? dot(aL, right);
  const rate = vhL > FORM.slowV ? aLat / vhL : 0;
  const vS = [0, 1, 2].map((k) => L.v[k]! - rate * (across * fwd[k]! + back * right[k]!));
  const vr = sub(o.v, vS);
  // (the closing speed asked: ∝ the error near, capped, and slow enough to stop on the slot — a jet slows by
  // its drag alone, `aStop` at idle)
  const loop = (err: number, vRel: number, w: number, vMax: number, aStop: number, ff: number) => {
    const want = Math.sign(err) * Math.min((w / (2 * FORM.zeta)) * Math.abs(err), vMax, Math.sqrt(2 * aStop * Math.abs(err)));
    return 2 * FORM.zeta * w * (want - vRel) + ff;
  };
  const eA = dot(e, fwd),
    eC = dot(e, right),
    eU = dot(e, up);
  const aA = loop(eA, dot(vr, fwd), FORM.wA, FORM.vA, FORM.stopA, dot(aL, fwd));
  let aC = loop(eC, dot(vr, right), FORM.wC, FORM.vC, FORM.stopC, aLat);
  // (the keep-out: abreast of him within reach of his wings — pushed out on the side we are, whatever the slot
  // asks: his turn's roll-in, a gust, a rejoin cutting in)
  const sep = here * lat;
  if (sep < FORM.keepOut && Math.abs(dot(d, fwd)) < FORM.keepAlong && Math.abs(dot(d, up)) < FORM.keepUp)
    aC += here * FORM.keepGain * (FORM.keepOut - sep);
  // (the acceleration asked, flat, on our own axes: across our track a bank, along it the speed)
  const A = [0, 1, 2].map((k) => fwd[k]! * aA + right[k]! * aC);
  const oh = along(o.v);
  const of = Math.hypot(oh[0]!, oh[1]!, oh[2]!) > 1 ? unit(oh) : fwd;
  const orr = cross(of, up);
  const bank = clamp(Math.atan2(dot(A, orr), G), -FORM.bankMax, FORM.bankMax);
  const aRaw = dot(A, of);
  const aOwn = clamp(aRaw, -JET.accMax, JET.accMax);
  const brake = clamp((-aRaw - FORM.idleDecel) / FORM.brakeDecel, 0, 1);
  // (the climb: the leader's own vertical speed and the slot's height closed at wU — the plane law holds a
  // flight path, a vertical speed: one order less)
  const Vs = Math.max(V, 30);
  const vs = dot(L.v, up) + clamp(FORM.wU * eU, -FORM.vU, FORM.vU);
  const gamma = clamp(Math.asin(clamp(vs / Vs, -1, 1)), -JET.gammaMax, JET.gammaMax);
  const dist = Math.hypot(eA, eC, eU);
  return {
    bank,
    gamma,
    spd: Math.max(60, V + aOwn / JET.spdGain),
    brake,
    acc: aRaw,
    along: eA,
    cross: eC,
    up: eU,
    dist,
    closing: dist > 1e-6 ? dot(vr, e) / dist : 0,
  };
}
