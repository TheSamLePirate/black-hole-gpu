// The spacecraft's sensors (docs/PLAN-RADAR-AAA.md RD4): what the Ranger, the Lander and the Endurance hold of the
// craft about them — the space station, the fleet's other craft, the room's players in orbit —, in the frame a
// rendezvous is flown in: LVLH (local vertical, local horizontal — the craft's own orbit's: R-bar up from the body's
// centre, V-bar along its way, H-bar along the orbit's normal). Each craft's sensors as its spec says:
//   - a rendezvous radar (all about — its antenna steered —, its range on a 5 m² target, ∝ σ^¼: a station's
//     2 000 m² seen 4.5 times as far),
//   - a docking lidar (its last kilometres, the range and the rate to the centimetre),
//   - the datalink (the fleet's craft and the room's: always known, their own navigation sent — beyond the radar's reach).
// A body between (the Earth, the Moon) hides a craft from the radar and the lidar; never from the datalink. Pure: the
// places in (one inertial frame [m, m/s], the body's centre at the origin), the tracks out — the HUD's space scope,
// the crew's lists the same.

export type V3 = [number, number, number];

export interface SpaceSensorSpec {
  /** the rendezvous radar's range on a 5 m² target [m] (0: none) */
  radar5: number;
  /** the docking lidar's range [m] (0: none) */
  lidar: number;
}

/** The craft's sensors (the Ranger: its rendezvous radar and its lidar; the Lander: a lighter radar and its lidar; the
 *  Endurance: the long watch radar, its docking lidar). */
export const SPACE_SENSORS: Record<string, SpaceSensorSpec> = {
  ranger: { radar5: 120_000, lidar: 5_000 },
  lander: { radar5: 80_000, lidar: 3_000 },
  endurance: { radar5: 300_000, lidar: 5_000 },
};

/** The sensors' bits. */
export const SPACE_SENSOR = { RADAR: 1, LIDAR: 2, DATALINK: 4 } as const;

export interface SpaceObject {
  id: string;
  name: string;
  /** its place, its velocity: the same inertial frame as ours, the body's centre at the origin [m, m/s] */
  p: V3;
  v: V3;
  /** its radar cross-section [m²] */
  rcs: number;
  /** ours or the room's: its own navigation sent (the datalink) */
  datalink?: boolean;
  kind: "station" | "craft" | "player";
}

export interface SpaceTrack {
  id: string;
  name: string;
  kind: SpaceObject["kind"];
  /** its place relative to us on our LVLH axes [m]: V-bar (along our way), H-bar (our orbit's normal), R-bar (up) */
  lvlh: V3;
  /** its velocity relative to us on the same axes [m/s] */
  vlvlh: V3;
  range: number;
  /** the range's rate [m/s] (> 0 opening) */
  rate: number;
  /** the sensors holding it (SPACE_SENSOR bits); hidden by the body (from the radar and the lidar) */
  sensors: number;
  hidden: boolean;
  /** the closest approach on straight lines: its distance [m], in [s] (null: opening) */
  ca: { d: number; t: number } | null;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Our LVLH axes from our place and velocity about the body: V-bar, H-bar, R-bar (unit vectors). */
export function lvlhAxes(p: V3, v: V3): { V: V3; H: V3; R: V3 } {
  const R = unit(p);
  const H = unit(cross(p, v));
  const V = cross(H, R);
  return { V, H, R };
}

/** A segment from a to b passing within the body's radius of its centre (the origin). */
export function bodyBetween(a: V3, b: V3, radius: number): boolean {
  const d = sub(b, a);
  const L2 = dot(d, d);
  if (L2 < 1e-6) return false;
  const k = Math.min(1, Math.max(0, -dot(a, d) / L2));
  const c: V3 = [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k];
  return len(c) < radius;
}

/** The radar's range on a cross-section σ [m²]. */
export const spaceRadarRange = (spec: SpaceSensorSpec, rcs: number) => spec.radar5 * (Math.max(rcs, 1e-4) / 5) ** 0.25;

/**
 * The craft's space picture: each object held by a sensor (or the datalink) as a track on our LVLH axes — the nearest
 * first. `radius` the body's [m] (it hides what is behind it).
 */
export function buildSpacePicture(own: { p: V3; v: V3 }, objects: SpaceObject[], spec: SpaceSensorSpec, radius: number): SpaceTrack[] {
  const A = lvlhAxes(own.p, own.v);
  const out: SpaceTrack[] = [];
  for (const o of objects) {
    const d = sub(o.p, own.p);
    const dv = sub(o.v, own.v);
    const range = len(d);
    const hidden = bodyBetween(own.p, o.p, radius);
    let sensors = 0;
    if (!hidden && spec.radar5 > 0 && range < spaceRadarRange(spec, o.rcs)) sensors |= SPACE_SENSOR.RADAR;
    if (!hidden && spec.lidar > 0 && range < spec.lidar) sensors |= SPACE_SENSOR.LIDAR;
    if (o.datalink) sensors |= SPACE_SENSOR.DATALINK;
    if (!sensors) continue;
    const vv = dot(dv, dv);
    const tc = vv > 1e-9 ? -dot(d, dv) / vv : 0;
    out.push({
      id: o.id,
      name: o.name,
      kind: o.kind,
      lvlh: [dot(d, A.V), dot(d, A.H), dot(d, A.R)],
      vlvlh: [dot(dv, A.V), dot(dv, A.H), dot(dv, A.R)],
      range,
      rate: range > 0 ? dot(d, dv) / range : 0,
      sensors,
      hidden,
      ca: tc > 0 ? { d: len([d[0] + dv[0] * tc, d[1] + dv[1] * tc, d[2] + dv[2] * tc]), t: tc } : null,
    });
  }
  return out.sort((a, b) => a.range - b.range);
}
