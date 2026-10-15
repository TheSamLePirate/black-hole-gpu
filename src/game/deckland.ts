// The F-35B's vertical landing on a carrier's deck (docs/PLAN-AVIATION-AAA.md, M3): the recovery a real one flies
// on a ship — up the port side at a few hundred feet, slowed, the lift fan engaged, to a hover alongside the
// landing spot, across over it, then straight down — as the guidance of its autopilot. Pure: the ship's pose and
// deck map, our place and velocity fixed to the Earth [m, m/s] in, the jet's holds (heading, height, speed) or the
// hover law's velocity over the ground out, and the phase moved on; the touchdown graded.

import { CARRIER, type CarrierId, type CarrierPose, type CarrierSpawn, type DeckMap, deckHeight, fromDeck, toDeck } from "./carrier";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../system/ellipsoid";

type V3 = [number, number, number];

/** Where an F-35B is set down on each deck (its frame: x its port, z its bow [m]): aft of the island, clear of the
 *  landing area's axis on the Ford, on the Kiev's after deck, on the Implacable's centreline aft. */
export const VL_SPOT: Record<CarrierId, [number, number]> = {
  ford: [10, -40],
  kiev: [-4, -95],
  implacable: [0, -55],
};

/** The recovery's figures: the gate astern on its port quarter (out [m] to port, back [m] astern, its height
 *  [m]); alongside, out from the deck's edge and over it [m]; the hover's closing (its deceleration [m/s²], its
 *  speed at most [m/s]); across, the speed at most; the descent's rate [m/s]; how still and how long before the
 *  next step. */
export const DECK = {
  gate: { out: 250, back: 3500, up: 150 },
  inboundFast: 140,
  inboundSlow: 100,
  gateReach: 800,
  decelA: 1.2,
  side: { out: 22, up: 18 },
  closeA: 1.5,
  closeMax: 55,
  over: { up: 12, max: 3 },
  descent: 1.2,
  stillPos: 4,
  stillVel: 1.5,
  stillFor: 2,
  overPos: 1,
  overVel: 0.5,
  overFor: 1.5,
};

export type DeckPhase = "inbound" | "decel" | "alongside" | "cross" | "descend" | "down";

export interface DeckRun {
  kind: CarrierId;
  phase: DeckPhase;
  /** the phase's condition met since [s of flight], or null */
  still: number | null;
  /** the clock of the run [s] */
  t: number;
  /** the touchdown: our place on the deck [m] and the sink rate on it [m/s]; its grade */
  touch?: { dx: number; dz: number; sink: number; grade: DeckGrade };
  /** the last relative sink rate over the deck [m/s] (the touchdown's) */
  sink: number;
}

export type DeckGrade = "OK" | "Fair" | "No grade";

export const newDeckRun = (kind: CarrierId): DeckRun => ({ kind, phase: "inbound", still: null, t: 0, sink: 0 });

const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const add = (a: readonly number[], b: readonly number[]): V3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
const scale = (a: readonly number[], k: number): V3 => [a[0]! * k, a[1]! * k, a[2]! * k];
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const len = (a: readonly number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** The geodetic frame at a place fixed to the Earth (WGS84): its east, north and up. */
export function enuOf(p: readonly number[]): { E: V3; N: V3; U: V3; h: number } {
  const g = cartToGeodetic(WGS84_A, WGS84_F, p as V3);
  const sl = Math.sin(g.lat),
    cl = Math.cos(g.lat),
    so = Math.sin(g.lon),
    co = Math.cos(g.lon);
  return { E: [-so, co, 0], N: [-sl * co, -sl * so, cl], U: [cl * co, cl * so, sl], h: g.h };
}

/** The deck's port edge at z [m of its frame]: the farthest x to port still on the flight deck. */
export function portEdge(D: DeckMap, z: number): number {
  let x = 0;
  for (let k = 0; k < 80; k++) {
    const h = deckHeight(D, k, z);
    if (Number.isFinite(h) && Math.abs(h - D.freeboard) < 1.5) x = k;
  }
  return x;
}

/** The deck's run clear ahead of z along x [m of its frame]: the last z with the deck still level under the wheels
 *  and nothing standing within `half` [m] either side (the wings' half span — an island, a mast); its end. */
export function bowEnd(D: DeckMap, x: number, z0 = D.z0, half = 6): number {
  let z = Number.NaN;
  for (let k = Math.ceil(z0); k < D.z0 + D.nz * D.cell; k++) {
    const h = deckHeight(D, x, k);
    if (!(Number.isFinite(h) && Math.abs(h - D.freeboard) < 1.5)) {
      if (Number.isFinite(z)) break;
      continue;
    }
    let clear = true;
    for (let dx = -half; dx <= half && clear; dx += 1) {
      const s = deckHeight(D, x + dx, k);
      if (Number.isFinite(s) && s > D.freeboard + 1.5) clear = false;
    }
    if (!clear) break;
    z = k;
  }
  return z;
}

/** Where a short take-off starts on each deck (x its port, z its bow [m]): a lane clear of the island to the
 *  bow — on the Kiev, port of its island, along its after deck; on the Implacable, a little to port. */
export const STO_LANE: Record<CarrierId, [number, number]> = {
  ford: [10, -60],
  kiev: [4, -105],
  implacable: [3, -90],
};

/** The F-35B's short take-off from a deck (STO): the lift fan's conversion braked; the run, the nozzle aft (all
 *  its thrust along — the fan unloading the wheels); the rotation, at its speed or the bow near, the nozzle
 *  down and the stick back; once off, the nozzle back aft as it speeds up; past the conversion's end, conventional. */
export const STO = {
  /** the deck's run its weight needs [m] (at 20.9 t, full tanks: some 150 m with the wind over the deck; as the
   *  square of the mass) */
  run: (mass: number) => 150 * (mass / 20_900) ** 2,
  /** a vertical take-off: up at, to [m over the deck]; then forward, its acceleration [m/s²] */
  liftRate: 3,
  liftTo: 25,
  accel: 2.5,
  vRotate: 52,
  bowMargin: 45,
  rotateSwivel: 0.62,
  rotatePitch: 0.6,
  vClean: 100,
  climb: 150,
};
export type StoPhase = "convert" | "roll" | "rotate" | "lift" | "accel" | "climb";
export interface StoRun {
  kind: CarrierId;
  phase: StoPhase;
  t: number;
  /** the deck's run left before the bow [m], where it lifted off (deck z) */
  bow: number;
  off?: number;
  /** a vertical take-off (the deck's run too short for the weight, light enough to hover): up, then away */
  vto?: boolean;
  /** the accel's start [s of the run] */
  t0?: number;
}

/** A deck point's velocity fixed to the Earth [m/s] (the ship's, its turn's: its heave, pitch, roll). */
export function deckVelocity(P: CarrierPose, q: readonly number[]): V3 {
  const r = sub(q, P.p);
  const w = P.w;
  return add(P.v, [w[1] * r[2] - w[2] * r[1], w[2] * r[0] - w[0] * r[2], w[0] * r[1] - w[1] * r[0]]);
}

/** The hover's closing on a point: the velocity over it asked [m/s] — towards it, as fast as a stop at `a` within
 *  the distance allows, `max` at most, eased in its last metres. */
function closing(e: V3, a: number, max: number): V3 {
  const d = len(e);
  if (d < 1e-6) return [0, 0, 0];
  return scale(e, Math.min(Math.sqrt(2 * a * d), max, 0.6 * d) / d);
}

/** A frame of the guidance. */
export type DeckOut =
  | { kind: "plane"; hdg: number; alt: number; spd: number; stovl: boolean }
  | { kind: "hover"; want: V3; heading: number; target: V3 };

/**
 * A frame of the recovery: our place and velocity (fixed to the Earth), our airspeed [m/s], whether the hover law
 * flies (the lift fan's, under 65 m/s), touched down on the deck; the ship's spawn, pose and deck map now; dt [s].
 * Its phase moved on; what the jet or the hover law is to fly.
 */
export function deckStep(
  R: DeckRun,
  own: { p: readonly number[]; v: readonly number[]; V: number; hover: boolean; down: boolean },
  sp: CarrierSpawn,
  P: CarrierPose,
  D: DeckMap,
  dt: number,
): DeckOut | null {
  R.t += dt;
  const deckY = CARRIER[R.kind].deck;
  const [sx, sz] = VL_SPOT[R.kind];
  const l = toDeck(P, own.p);
  const { E, N, U } = enuOf(own.p);
  const bearing = (w: readonly number[]) => Math.atan2(dot(w, E), dot(w, N));
  const shipV = P.v;
  // (touched down: the grade — where on the spot, how hard —, the run done)
  if (own.down && R.phase !== "down" && Math.abs(l[1] - deckY) < 4) {
    const sink = R.sink;
    const dx = l[0] - sx,
      dz = l[2] - sz;
    const off = Math.hypot(dx, dz);
    const grade: DeckGrade = off < 2.5 && sink < 2.5 ? "OK" : off < 5 && sink < 3.5 ? "Fair" : "No grade";
    R.touch = { dx, dz, sink, grade };
    R.phase = "down";
    return null;
  }
  if (R.phase === "down") return null;
  // the jet's holds: the gate, then slowing up the port side
  if (R.phase === "inbound" || R.phase === "decel") {
    if (own.hover) {
      R.phase = "alongside";
      R.still = null;
    } else {
      const edge = portEdge(D, sz);
      const target =
        R.phase === "inbound"
          ? fromDeck(P, [DECK.gate.out, DECK.gate.up, -DECK.gate.back])
          : fromDeck(P, [edge + DECK.side.out + 20, deckY + 30, sz]);
      const e = sub(target, own.p);
      const eh = sub(e, scale(U, dot(e, U)));
      const dist = len(eh);
      const vh = sub(own.v, scale(U, dot(own.v, U)));
      const closingV = Math.max(len(vh) - dot(shipV, scale(vh, 1 / (len(vh) || 1))), 20);
      // (led: where it will be when we get there)
      const aim = add(target, scale(shipV, dist / closingV));
      const hdg = bearing(sub(aim, own.p));
      if (R.phase === "inbound") {
        if (dist < DECK.gateReach) R.phase = "decel";
        const spd = dist > 5000 ? DECK.inboundFast : DECK.inboundSlow + ((DECK.inboundFast - DECK.inboundSlow) * dist) / 5000;
        return { kind: "plane", hdg, alt: DECK.gate.up, spd, stovl: false };
      }
      // (slowing: the speed over the ship as a stop within the distance left along its axis asks, the airspeed
      // moved by the ground speed's error — the wind over the deck its own)
      const along = Math.max(0, sz - l[2]);
      const gsWant = len(sub(shipV, scale(U, dot(shipV, U)))) + Math.min(Math.sqrt(2 * DECK.decelA * along), 90);
      const spd = clamp(own.V + (gsWant - len(vh)), 50, DECK.inboundSlow);
      // (its heading the ship's, turned to close the gap across its axis: out to port of where it should be, to
      // starboard — x is its port —, and against our drift across it)
      const xT = edge + DECK.side.out + 20;
      const vx = dot(sub(own.v, shipV), P.port);
      const dh = clamp(0.003 * (l[0] - xT) + 0.03 * vx, -0.6, 0.6);
      return { kind: "plane", hdg: sp.heading + dh, alt: deckY + 30, spd, stovl: own.V < 120 };
    }
  }
  // the hover: alongside, across, down
  const edge = portEdge(D, sz);
  const local: V3 =
    R.phase === "alongside"
      ? [edge + DECK.side.out, deckY + DECK.side.up, sz]
      : R.phase === "cross"
        ? [sx, deckY + DECK.over.up, sz]
        : [sx, deckY, sz];
  const target = fromDeck(P, local);
  const vT = deckVelocity(P, target);
  const vRel = sub(own.v, vT);
  const e = sub(target, own.p);
  R.sink = -dot(vRel, U);
  let rel: V3;
  if (R.phase === "descend") {
    const eh = sub(e, scale(U, dot(e, U)));
    rel = add(closing(eh, DECK.closeA, DECK.over.max), scale(U, -DECK.descent));
  } else rel = closing(e, DECK.closeA, R.phase === "alongside" ? DECK.closeMax : DECK.over.max);
  // the next step once still enough, long enough
  const eh = sub(e, scale(U, dot(e, U)));
  const ok =
    R.phase === "alongside"
      ? len(e) < DECK.stillPos && len(vRel) < DECK.stillVel
      : R.phase === "cross"
        ? len(eh) < DECK.overPos && len(sub(vRel, scale(U, dot(vRel, U)))) < DECK.overVel && Math.abs(dot(e, U)) < 3
        : false;
  if (!ok) R.still = null;
  else {
    R.still ??= R.t;
    if (R.t - R.still >= (R.phase === "alongside" ? DECK.stillFor : DECK.overFor)) {
      R.phase = R.phase === "alongside" ? "cross" : "descend";
      R.still = null;
    }
  }
  return { kind: "hover", want: add(vT, rel), heading: sp.heading, target };
}
