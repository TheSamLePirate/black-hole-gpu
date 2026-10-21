// The tactical picture (docs/PLAN-RADAR-AAA.md RD2): one list of tracks per pilot, built once a frame after the radar's
// step, the only thing the screens, the tools and the network read — the pilot's HUD scope, the panoramic display's
// pages, the crew's console. Each track carries the truth of what it is (its side, where it truly is) and what our
// sensors know of it (their bits, the IFF as answered, the radar's own estimate, how fresh): the crew's « Partagé »
// view draws the truth, its « Capteur » view and the pilot's screens what the sensors know — two filters of one list,
// never two lists. The missiles and the decoys are tracks too (msl:, cm:). Places exact: each one's Earth-fixed point
// from the craft's fix, its latitude, longitude and height over the WGS84 ellipsoid. Pure: no import of the simulator
// (the crew's bundle may take it).

import { cartToGeodetic, WGS84_A, WGS84_F } from "../system/ellipsoid";

export type V3 = [number, number, number];
export type Iff = "friend" | "neutral" | "unknown" | "hostile";

/** What our sensors know a track by (bits). */
export const SENSOR = {
  /** the F-35's radar (game/radar.ts) */
  RADAR: 1,
  /** the datalink (a friend's craft, our own missile's guidance link) */
  DATALINK: 2,
  /** a transponder heard (the TCAS, ADS-B) */
  TCAS: 4,
  /** a ship's AIS */
  AIS: 8,
  /** the DAS's infrared all round (a missile's motor, a flare) */
  DAS: 16,
  /** the EOTS's pod */
  EOTS: 32,
  /** briefed (a mission's or a fight's known units) */
  BRIEF: 64,
} as const;

export type PicKind = "air" | "sea" | "ground" | "missile" | "flare" | "chaff";
/** The truth of a track: a friend, a foe, a neutral, the civil traffic, a carrier, another player, a wreck. */
export type PicSide = "friend" | "hostile" | "neutral" | "traffic" | "carrier" | "player" | "dead";
/** How the sensors hold it: measured lately, carried on since, the datalink's alone, known to the game only. */
export type PicState = "firm" | "coast" | "datalink" | "truth";

export interface PicTrack {
  /** stable, prefixed by its source (trf:, ais:, cv:, cmb:, wng:, rwg:, net:, msl:, cm:) */
  id: string;
  name: string;
  /** what it is (A320, frigate, AIM-120, flare…) */
  type: string;
  kind: PicKind;
  side: PicSide;
  /** the IFF as our sensors know it */
  iff: Iff;
  sensors: number;
  state: PicState;
  /** the last measure by our sensors [the radar's s] (null: none) */
  seenAt: number | null;
  locked: boolean;
  selected: boolean;
  /** where the sensors put it (the truth when none): from the craft, local east, north, up [m]; its velocity [m/s] */
  r: V3;
  v: V3;
  /** where it truly is, from the craft [m] (the crew's « Partagé ») */
  rt: V3;
  /** its true place: latitude, longitude [°], height over the WGS84 ellipsoid [m] */
  lat: number;
  lon: number;
  h: number;
  /** a player's own colour */
  colour?: string;
  /** a missile: its seeker, its target's id (a track, a decoy, us: "own"), its time to go [s], ours, drawn off */
  msl?: { seeker: "ir" | "radar"; target: string | null; tti: number | null; ours: boolean; decoyed: boolean; motor: boolean };
  /** a decoy: its life left [s] */
  cm?: { life: number };
}

/** The craft's fix: its Earth-fixed place [m] and the local frame's axes there, its geodetic place, its heading [rad]. */
export interface PicFix {
  p: V3;
  E: V3;
  N: V3;
  U: V3;
  lat: number;
  lon: number;
  alt: number;
  heading: number;
}

/** A thing the game knows (a radar source's object — game/radar.ts RadarObject's fields the picture needs). */
export interface PicObject {
  id: string;
  r: V3;
  v: V3;
  kind: "air" | "ground" | "sea";
  iff: "friend" | "neutral" | "unknown" | "hostile";
  name: string;
  squawk: boolean;
  known?: boolean;
  offboard?: boolean;
  colour?: string;
  type?: string;
  dead?: boolean;
}

/** A radar track (game/radar.ts Track's fields). */
export interface PicRadarTrack {
  id: string;
  r: V3;
  v: V3;
  iff: Iff;
  seenAt: number;
  datalink: boolean;
}

/** A missile or a decoy in the air, from the craft (local east, north, up [m]). */
export interface PicWeapon {
  id: string;
  name: string;
  kind: "missile" | "flare" | "chaff";
  r: V3;
  v: V3;
  ours: boolean;
  /** a missile's */
  seeker?: "ir" | "radar";
  target?: string | null;
  motor?: boolean;
  decoyed?: boolean;
  /** a decoy's life left [s] */
  life?: number;
}

export interface PictureInput {
  /** the radar's clock [s] */
  t: number;
  fix: PicFix;
  objects: PicObject[];
  tracks: PicRadarTrack[];
  lock: string | null;
  selected: string | null;
  weapons: PicWeapon[];
  /** the radar's mode and beam (off the nose [rad]) — none off the F-35 */
  mode: string | null;
  beam: number | null;
}

export interface Picture {
  t: number;
  fix: PicFix;
  mode: string | null;
  beam: number | null;
  lock: string | null;
  selected: string | null;
  tracks: PicTrack[];
  byId: Map<string, PicTrack>;
}

/** The TCAS's reach: a transponder within 74 km and ±3 000 m. */
export const TCAS_RANGE = 74_000;
export const TCAS_HEIGHT = 3_000;
/** The DAS: a missile's motor within 20 km (after it burns out: 3 km), a flare within 10 km. */
export const DAS_MOTOR = 20_000;
export const DAS_COLD = 3_000;
export const DAS_FLARE = 10_000;
/** The radar's chaff: a strong echo within ±60° off the nose and 47 km (σ ≈ 50 m², its bloom). */
export const RADAR_CHAFF = 47_000;
/** A radar track fresh this long after its last measure [s] (a sweep and a little); then carried on (coast). */
export const FIRM = 2.5;

/** The side a source's thing truly is (by its source's prefix, then its truth). */
export function sideOf(o: PicObject): PicSide {
  if (o.dead) return "dead";
  const src = o.id.slice(0, o.id.indexOf(":"));
  if (src === "trf") return "traffic";
  if (src === "cv") return "carrier";
  if (src === "net") return o.iff === "hostile" ? "hostile" : "player";
  if (src === "wng" || src === "rwg") return "friend";
  if (src === "ais") return "neutral";
  return o.iff === "friend" ? "friend" : o.iff === "neutral" ? "neutral" : "hostile";
}

/** The geodetic place of a point from the craft (local east, north, up [m]): exact, over the ellipsoid. */
export function geoOf(fix: PicFix, r: V3): { lat: number; lon: number; h: number } {
  const q: V3 = [
    fix.p[0] + fix.E[0] * r[0] + fix.N[0] * r[1] + fix.U[0] * r[2],
    fix.p[1] + fix.E[1] * r[0] + fix.N[1] * r[1] + fix.U[1] * r[2],
    fix.p[2] + fix.E[2] * r[0] + fix.N[2] * r[1] + fix.U[2] * r[2],
  ];
  const g = cartToGeodetic(WGS84_A, WGS84_F, q);
  return { lat: (g.lat * 180) / Math.PI, lon: (g.lon * 180) / Math.PI, h: g.h };
}

const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** The off-nose azimuth of r [rad] (the heading's frame: local east, north). */
function offHeading(fix: PicFix, r: V3): number {
  const a = Math.atan2(r[0], r[1]) - fix.heading;
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * The picture now: each thing the game knows merged with what the sensors know of it — one track by id —, the
 * missiles and the decoys among them, their places exact. Ordered as the screens list them: the lock, the selected,
 * the missiles at us, the hostiles, then by range.
 */
export function buildPicture(inp: PictureInput): Picture {
  const { fix, t } = inp;
  const byId = new Map<string, PicTrack>();
  const radar = new Map(inp.tracks.map((T) => [T.id, T]));
  for (const o of inp.objects) {
    const T = radar.get(o.id);
    let sensors = 0;
    if (T) sensors |= T.datalink ? SENSOR.DATALINK : SENSOR.RADAR;
    if (o.offboard) sensors |= SENSOR.DATALINK;
    if (o.known) sensors |= SENSOR.BRIEF;
    const d = len(o.r);
    if (o.squawk && o.kind === "air" && d < TCAS_RANGE && Math.abs(o.r[2]) < TCAS_HEIGHT) sensors |= SENSOR.TCAS;
    if (o.id.startsWith("ais:") || o.id.startsWith("cv:")) sensors |= SENSOR.AIS;
    const g = geoOf(fix, o.r);
    const state: PicState = T
      ? T.datalink
        ? "datalink"
        : t - T.seenAt < FIRM
          ? "firm"
          : "coast"
      : sensors & (SENSOR.DATALINK | SENSOR.TCAS | SENSOR.AIS)
        ? "datalink"
        : "truth";
    byId.set(o.id, {
      id: o.id,
      name: o.name,
      type: o.type ?? "",
      kind: o.kind,
      side: sideOf(o),
      // (the IFF as known: the radar's answer; a transponder's or the datalink's, its truth; else unknown)
      iff: T ? T.iff : sensors & (SENSOR.DATALINK | SENSOR.TCAS | SENSOR.AIS | SENSOR.BRIEF) ? o.iff : "unknown",
      sensors,
      state,
      seenAt: T ? T.seenAt : null,
      locked: o.id === inp.lock,
      selected: o.id === inp.selected,
      r: T ? [...T.r] : [...o.r],
      v: T ? [...T.v] : [...o.v],
      rt: [...o.r],
      ...g,
      colour: o.colour,
    });
  }
  // (a radar track whose thing is gone from the sources — a wreck, a player left —: kept as the radar holds it)
  for (const T of inp.tracks) {
    if (byId.has(T.id)) continue;
    const g = geoOf(fix, T.r);
    byId.set(T.id, {
      id: T.id,
      name: T.id,
      type: "",
      kind: "air",
      side: "dead",
      iff: T.iff,
      sensors: T.datalink ? SENSOR.DATALINK : SENSOR.RADAR,
      state: t - T.seenAt < FIRM ? "firm" : "coast",
      seenAt: T.seenAt,
      locked: T.id === inp.lock,
      selected: T.id === inp.selected,
      r: [...T.r],
      v: [...T.v],
      rt: [...T.r],
      ...g,
    });
  }
  for (const w of inp.weapons) {
    const d = len(w.r);
    let sensors = 0;
    if (w.kind === "missile") {
      if (w.ours) sensors |= SENSOR.DATALINK;
      if (d < (w.motor ? DAS_MOTOR : DAS_COLD)) sensors |= SENSOR.DAS;
    } else if (w.kind === "flare") {
      if (d < DAS_FLARE) sensors |= SENSOR.DAS;
    } else if (d < RADAR_CHAFF && Math.abs(offHeading(fix, w.r)) < Math.PI / 3) sensors |= SENSOR.RADAR;
    const g = geoOf(fix, w.r);
    // (the time to go: the range over the closing speed on the line, when closing)
    const tgt = w.target ? (w.target === "own" ? null : byId.get(w.target)) : undefined;
    const rel: V3 | null =
      w.target === "own" ? [-w.r[0], -w.r[1], -w.r[2]] : tgt ? [tgt.rt[0] - w.r[0], tgt.rt[1] - w.r[1], tgt.rt[2] - w.r[2]] : null;
    const tv: V3 = w.target === "own" ? [0, 0, 0] : tgt ? tgt.v : [0, 0, 0];
    let tti: number | null = null;
    if (rel) {
      const rl = len(rel) || 1;
      const closing = ((w.v[0] - tv[0]) * rel[0] + (w.v[1] - tv[1]) * rel[1] + (w.v[2] - tv[2]) * rel[2]) / rl;
      tti = closing > 1 ? rl / closing : null;
    }
    byId.set(w.id, {
      id: w.id,
      name: w.name,
      type: w.kind === "missile" ? w.name : w.kind,
      kind: w.kind,
      side: w.ours ? "friend" : "hostile",
      iff: w.ours ? "friend" : sensors ? "hostile" : "unknown",
      sensors,
      state: sensors ? "firm" : "truth",
      seenAt: sensors ? t : null,
      locked: false,
      selected: w.id === inp.selected,
      r: [...w.r],
      v: [...w.v],
      rt: [...w.r],
      ...g,
      ...(w.kind === "missile"
        ? { msl: { seeker: w.seeker ?? "radar", target: w.target ?? null, tti, ours: w.ours, decoyed: !!w.decoyed, motor: !!w.motor } }
        : { cm: { life: w.life ?? 0 } }),
    });
  }
  const rank = (T: PicTrack) =>
    T.locked
      ? 0
      : T.selected
        ? 1
        : T.kind === "missile" && T.msl?.target === "own"
          ? 2
          : T.side === "hostile" && T.kind !== "flare" && T.kind !== "chaff"
            ? 3
            : 4;
  const tracks = [...byId.values()].sort((a, b) => rank(a) - rank(b) || len(a.rt) - len(b.rt));
  return { t, fix, mode: inp.mode, beam: inp.beam, lock: inp.lock, selected: inp.selected, tracks, byId };
}

/** What the pilot's own screens show: the tracks a sensor of ours holds. */
export const sensed = (T: PicTrack) => T.sensors !== 0 && T.state !== "truth";
