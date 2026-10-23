// The carriers at sea (docs/PLAN-AVIATION-AAA.md, M2): each one's course — set off from a place at a moment, steaming
// on its heading (into the wind) at its speed —, a function of the clock alone: the same on every page of a room;
// its motion in the sea (its heave, its pitch, its roll: game/shiptypes.ts shipMotion, small for its size), its
// deck — its top surface a metre a cell (scripts/build-carriers.ts: DECK) — met by the craft's gear as a moving
// platform (system/our-surface.ts). Its pose on the WGS84 Earth, fixed to it [m]. Pure.

import { geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { shipMotion } from "./shiptypes";
import { geoidN } from "../system/geoid-grid";

export type CarrierId = "ford" | "kiev" | "implacable";

/** Each carrier: its name, length and beam [m], its flight deck's height over its waterline [m], its speed into
 *  the wind [m/s], whether it launches with catapults and recovers on wires (else: vertical landings, short take-offs). */
export const CARRIER: Record<CarrierId, { name: string; len: number; beam: number; deck: number; speed: number; cats: boolean }> = {
  ford: { name: "USS Gerald R. Ford (CVN-78)", len: 333, beam: 78, deck: 18.5, speed: 14.4, cats: true },
  kiev: { name: "Kiev", len: 273, beam: 53, deck: 15, speed: 13.4, cats: false },
  implacable: { name: "HMS Implacable", len: 233.6, beam: 29, deck: 13, speed: 13.9, cats: false },
};

/**
 * A carrier's landing area (its ship frame [m]: x its port, z its bow, y over the waterline): its axis — from its
 * stern ramp, angled to port —, its half width, its arresting wires (where each crosses the axis, from aft
 * forward), the hook's aim (between the second and the third) and the glide path's angle [°], the IFLOLS (its lens
 * — the meatball — on the port side abeam the touchdown).
 */
export interface LandingArea {
  ramp: [number, number];
  /** the axis's way: its angle to port of the bow [°] */
  angle: number;
  half: number;
  wires: [number, number][];
  aim: [number, number];
  glide: number;
  iflols: [number, number, number] | null;
}
/** The Ford's (measured on its model's deck: its centreline's paint, its wires' sheaves — three since 2017). */
export const LANDING: Partial<Record<CarrierId, LandingArea>> = {
  ford: {
    ramp: [-6.3, -160.5],
    angle: 8.8,
    half: 15,
    wires: [
      [2.9, -101],
      [5.1, -87],
      [6.9, -75],
    ],
    aim: [4.0, -94],
    glide: 3.5,
    iflols: [38, 20, -60],
  },
};

/** Where and when a carrier set off: its place [°], its heading [rad, from the north eastwards], its speed [m/s],
 *  the moment [s since 1970 — the room's clock], its motion's seed. */
export interface CarrierSpawn {
  kind: CarrierId;
  lat: number;
  lon: number;
  heading: number;
  speed: number;
  t0: number;
  seed: number;
}

/** A deck map (scripts/build-carriers.ts): heights [m over the waterline] a metre a cell over its ship frame
 *  (x its port, z its bow), NaN where there is none. */
export interface DeckMap {
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  cell: number;
  freeboard: number;
  h: Float32Array;
}

/** A DECK file read. */
export function readDeck(buf: ArrayBuffer): DeckMap {
  if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== "DECK") throw new Error("not a deck map");
  const dv = new DataView(buf);
  const nx = dv.getUint32(4, true),
    nz = dv.getUint32(8, true);
  const hs = new Int16Array(buf.slice(32, 32 + nx * nz * 2));
  const h = new Float32Array(nx * nz);
  for (let i = 0; i < h.length; i++) h[i] = hs[i] === -32768 ? Number.NaN : hs[i]! / 100;
  return {
    nx,
    nz,
    x0: dv.getFloat32(12, true),
    z0: dv.getFloat32(16, true),
    cell: dv.getFloat32(20, true),
    freeboard: dv.getFloat32(24, true),
    h,
  };
}

/** The deck's top under a point of the ship frame [m] (NaN: off it): the highest of the cell and its neighbours
 *  the point's footprint touches — a wheel on an edge stands on the higher side. */
export function deckHeight(D: DeckMap, x: number, z: number): number {
  const fx = (x - D.x0) / D.cell - 0.5,
    fz = (z - D.z0) / D.cell - 0.5;
  const i = Math.round(fx),
    j = Math.round(fz);
  if (i < 0 || j < 0 || i >= D.nx || j >= D.nz) return Number.NaN;
  return D.h[j * D.nx + i]!;
}

/** A carrier's pose at `t` [s since 1970]: its place fixed to the Earth [m], its axes (port, up, bow), its velocity
 *  over the ground [m/s] and its turn [rad/s] (both fixed to the Earth), its heave, pitch and roll; in a sea of
 *  significant height `hs` [m]. */
export interface CarrierPose {
  p: [number, number, number];
  port: [number, number, number];
  up: [number, number, number];
  bow: [number, number, number];
  v: [number, number, number];
  w: [number, number, number];
  lat: number;
  lon: number;
  heading: number;
}

const D2R = Math.PI / 180;
const R_EQ = 6_378_137;

function frameAt(sp: CarrierSpawn, t: number, hs: number) {
  const s = sp.speed * (t - sp.t0);
  // (its course a straight line on the local plane of its start — a few tens of kilometres)
  const n = s * Math.cos(sp.heading),
    e = s * Math.sin(sp.heading);
  const lat = sp.lat + n / (D2R * R_EQ),
    lon = sp.lon + e / (D2R * R_EQ * Math.cos(sp.lat * D2R));
  const spec = CARRIER[sp.kind];
  const m = shipMotion(spec.len, spec.beam, hs, t, sp.seed);
  const la = lat * D2R,
    lo = lon * D2R;
  const E = [-Math.sin(lo), Math.cos(lo), 0];
  const N = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const U = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const h = [0, 1, 2].map((i) => E[i]! * Math.sin(sp.heading) + N[i]! * Math.cos(sp.heading));
  const stb = [0, 1, 2].map((i) => E[i]! * Math.cos(sp.heading) - N[i]! * Math.sin(sp.heading));
  // (its pitch — its bow up + —, then its roll — to starboard +)
  const cp = Math.cos(m.pitch),
    spp = Math.sin(m.pitch);
  const bow = [0, 1, 2].map((i) => h[i]! * cp + U[i]! * spp);
  const up1 = [0, 1, 2].map((i) => U[i]! * cp - h[i]! * spp);
  const cr = Math.cos(m.roll),
    sr = Math.sin(m.roll);
  const right = [0, 1, 2].map((i) => stb[i]! * cr - up1[i]! * sr);
  const up = [0, 1, 2].map((i) => up1[i]! * cr + stb[i]! * sr);
  // (afloat on the sea: its surface at the geoid)
  const p = geodeticToCart(WGS84_A, WGS84_F, la, lo, m.heave + geoidN(la, lo)) as number[];
  return { p, bow, up, port: right.map((x) => -x), lat, lon };
}

export function carrierPose(sp: CarrierSpawn, t: number, hs: number): CarrierPose {
  const a = frameAt(sp, t, hs);
  // (its velocity and turn: from its poses a tenth of a second either side)
  const dt = 0.05;
  const b = frameAt(sp, t + dt, hs),
    c = frameAt(sp, t - dt, hs);
  const v = [0, 1, 2].map((i) => (b.p[i]! - c.p[i]!) / (2 * dt));
  // (ω from the axes' change: ½ Σ eᵢ × ėᵢ)
  const d = (x: number[], y: number[]) => x.map((q, i) => (q - y[i]!) / (2 * dt));
  const cr = (x: number[], y: number[]) => [x[1]! * y[2]! - x[2]! * y[1]!, x[2]! * y[0]! - x[0]! * y[2]!, x[0]! * y[1]! - x[1]! * y[0]!];
  const w = [0, 0, 0];
  for (const [e, de] of [
    [a.port, d(b.port, c.port)],
    [a.up, d(b.up, c.up)],
    [a.bow, d(b.bow, c.bow)],
  ] as const) {
    const x = cr(e, de);
    for (let i = 0; i < 3; i++) w[i]! += 0.5 * x[i]!;
  }
  return {
    p: a.p as [number, number, number],
    port: a.port as [number, number, number],
    up: a.up as [number, number, number],
    bow: a.bow as [number, number, number],
    v: v as [number, number, number],
    w: w as [number, number, number],
    lat: a.lat,
    lon: a.lon,
    heading: sp.heading,
  };
}

/** A point fixed to the Earth into the carrier's frame (port, up, bow [m]), and back. */
export function toDeck(P: CarrierPose, q: readonly number[]): [number, number, number] {
  const d = [q[0]! - P.p[0], q[1]! - P.p[1], q[2]! - P.p[2]];
  const dot = (a: readonly number[]) => d[0]! * a[0]! + d[1]! * a[1]! + d[2]! * a[2]!;
  return [dot(P.port), dot(P.up), dot(P.bow)];
}
export function fromDeck(P: CarrierPose, l: readonly number[]): [number, number, number] {
  return [0, 1, 2].map((i) => P.p[i]! + P.port[i]! * l[0]! + P.up[i]! * l[1]! + P.bow[i]! * l[2]!) as [number, number, number];
}

/** The deck under a point fixed to the Earth [m] (null: not over it, or more than 3 m under its top — beside the
 *  hull, in the sea): the point's height over it [m], its normal and its velocity there (fixed to the Earth). */
export function deckUnder(
  P: CarrierPose,
  D: DeckMap,
  q: readonly number[],
): { h: number; n: [number, number, number]; v: [number, number, number] } | null {
  const l = toDeck(P, q);
  const top = deckHeight(D, l[0], l[2]);
  if (!Number.isFinite(top) || l[1] < top - 3) return null;
  const r = [q[0]! - P.p[0], q[1]! - P.p[1], q[2]! - P.p[2]];
  const wr = [P.w[1] * r[2]! - P.w[2] * r[1]!, P.w[2] * r[0]! - P.w[0] * r[2]!, P.w[0] * r[1]! - P.w[1] * r[0]!];
  return { h: l[1] - top, n: P.up, v: [P.v[0] + wr[0]!, P.v[1] + wr[1]!, P.v[2] + wr[2]!] };
}
