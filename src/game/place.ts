// Where to put the Ranger: in orbit around any body (ours: the solar system; Gargantua's side: Miller,
// Mann, Edmunds, and Gargantua itself on a Kerr circular orbit), on the ground at a latitude and
// longitude, or at a given state. Pure: returns poses (place, nose, top, velocity) in the frame the
// camera settings take (home frame on our side, the hole's map on Gargantua's side).

import type { Vec3 } from "../physics";
import { eclipticOf, poleAxes, solarBody, solarState, spinVector, M_METRES, SOLAR_BODIES } from "../system/solar";
import { soiOf } from "../system/our-side";
import { bodyFixedOf, fromBodyFixed, groundVelocity, solidBody, GEAR } from "../system/our-surface";
import { body as sysBody, GARGANTUA_SYSTEM } from "../system/bodies";
import { circularOrbit } from "../system/kerr-orbits";
import { planetFrame, toGlobal, zamoBeta } from "../landing";
import { sphericalFrame } from "../wormhole";
import { ECLIPTIC, elements, stateFrom, type Axes, type OrbitSpec } from "./orbit";

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const KM = 1e3 / M_METRES;

export interface Pose {
  /** "ours": home frame; "hole": Gargantua's map (Boyer–Lindquist Cartesian) */
  frame: "ours" | "hole";
  X: Vec3;
  /** velocity: home frame d/dt (ours); along the ZAMO axes as a Cartesian vector, β (hole) */
  vel: Vec3;
  fwd: Vec3;
  up: Vec3;
  /** landed on a body: its id and the place in its own (turning) coordinates */
  landed?: { body: string; q: Vec3 };
  /** a line for the log */
  note: string;
}

export interface OrbitPlacement {
  body: string;
  /** a circular orbit's altitude, or the periapsis / apoapsis altitudes [km] */
  altKm?: number;
  peKm?: number;
  apKm?: number;
  /** degrees, relative to the body's equator (Gargantua: its equator; the Sun: the ecliptic) */
  inc?: number;
  raan?: number;
  argPe?: number;
  /** true anomaly [°] (where on the orbit) */
  nu?: number;
  /** turning against the body's spin */
  retrograde?: boolean;
}

/** Our bodies, and Gargantua's side's (planets and the hole) */
export const OUR_IDS = SOLAR_BODIES.map((b) => b.id);
export const THEIR_IDS = ["gargantua", "miller", "mann", "edmunds"];
export const universeOf = (id: string): "ours" | "gargantua" | null => (OUR_IDS.includes(id) ? "ours" : THEIR_IDS.includes(id) ? "gargantua" : null);

/** A body's equatorial axes (not turning with it): x on the ecliptic, z along its pole. */
export function equatorAxes(id: string): Axes {
  const b = solarBody(id);
  if (!b || b.kind === "star") return ECLIPTIC;
  return poleAxes(eclipticOf(b.pole[0], b.pole[1])) as Axes;
}

/** The air's top above a body (where the tracer's air ends: 12 scale heights) [km], 0 without. */
export function airTopKm(id: string) {
  const b = solarBody(id) ?? GARGANTUA_SYSTEM.bodies.find((q) => q.id === id);
  const atm = b && ("atmosphere" in b ? b.atmosphere : (b as { surface?: { atmosphere?: { H: number } } }).surface?.atmosphere);
  return atm ? (12 * atm.H) / 1e3 : 0;
}

/** A sensible default altitude: clear of the air (a tenth of the radius at least, 100 km at most for small airless bodies). */
export function defaultAltKm(id: string) {
  const top = airTopKm(id);
  const b = solarBody(id);
  const Rkm = b ? b.radius / KM : 6000;
  return top > 0 ? Math.ceil(top * 1.25 / 10) * 10 : Math.max(10, Math.min(100, Math.round(0.1 * Rkm)));
}

/** An orbit around one of our bodies at time t (home frame). */
export function ourOrbitPose(p: OrbitPlacement, t: number): Pose {
  const b = solarBody(p.body);
  if (!b) throw new Error(`unknown body ${p.body}`);
  const R = b.radius;
  const alt = p.altKm ?? defaultAltKm(p.body);
  const rp = R + (p.peKm ?? alt) * KM;
  const ra = R + (p.apKm ?? p.peKm ?? alt) * KM;
  const inc = p.retrograde ? 180 - (p.inc ?? 0) : p.inc ?? 0;
  const spec: OrbitSpec = { rp, ra, i: inc, raan: p.raan ?? 0, argPe: p.argPe ?? 0, nu: p.nu ?? 0 };
  const { r, v } = stateFrom(b.mass, spec, equatorAxes(p.body));
  const soi = soiOf(p.body, t);
  if (Math.max(rp, ra) > soi) throw new Error(`${b.name}: that orbit (${Math.round(Math.max(rp, ra) / KM - R / KM)} km) leaves its sphere of influence (${Math.round(soi / KM - R / KM)} km)`);
  const B = solarState(p.body, t);
  const X = add(B.pos, r);
  const el = elements(b.mass, r, v, equatorAxes(p.body));
  const note = `${b.name}: orbit ${Math.round((el.rp - R) / KM)} × ${Math.round((el.ra - R) / KM)} km, i ${((el.i * 180) / Math.PI).toFixed(1)}°`;
  return { frame: "ours", X, vel: add(B.vel, v), fwd: unit(v), up: unit(r), note };
}

/** On the ground of one of our solid bodies at a latitude, east longitude [°] (the ship on its gear, nose east). */
export function ourGroundPose(id: string, lat: number, lon: number, t: number): Pose {
  const b = solarBody(id);
  if (!b || !solidBody(id)) throw new Error(`${b?.name ?? id}: no ground to land on`);
  const q = bodyFixedOf(id, lat, lon, GEAR);
  const X = fromBodyFixed(id, q, t);
  const up = unit(sub(X, solarState(id, t).pos));
  let east = cross(spinVector(b), up);
  if (Math.hypot(...east) < 1e-12) east = cross([1, 0, 0], up);
  return { frame: "ours", X, vel: groundVelocity(id, X, t), fwd: unit(east), up, landed: { body: id, q }, note: `${b.name}: landed at ${lat.toFixed(2)}°, ${lon.toFixed(2)}°` };
}

/**
 * How fast a planet's frame turns, in its proper time: half the mean of its Coriolis coefficients
 * (Hill's equations: n; about Gargantua, n dt/dτ and the metric's stretch).
 */
export function frameRate(F: { A: number[][] }) {
  return (F.A[3]![4]! - F.A[4]![3]!) / 4;
}

/**
 * An orbit on Gargantua's side: around Gargantua (Kerr circular, equatorial, at altKm·km from the
 * centre read as radius [M] when `rM` is given), or around a planet (its frame: proper lengths,
 * turning with its orbit; the orbit's plane its equator — the orbit's plane — tilted by inc).
 */
export function theirOrbitPose(p: OrbitPlacement & { rM?: number }, t: number, spin: number, massSolar: number): Pose {
  const mPerM = 1476.625 * massSolar;
  if (p.body === "gargantua") {
    const r = p.rM ?? 12;
    const ph = ((p.nu ?? 0) * Math.PI) / 180;
    const X: Vec3 = [r * Math.cos(ph), r * Math.sin(ph), 0];
    const o = circularOrbit(r, p.retrograde ? -spin : spin);
    const f = sphericalFrame(X);
    const vel: Vec3 = f.ep.map((c) => c * o.vZamo * (p.retrograde ? -1 : 1)) as Vec3;
    return { frame: "hole", X, vel, fwd: p.retrograde ? f.ep.map((c) => -c) as Vec3 : f.ep, up: f.er, note: `Gargantua: circular orbit at ${r.toFixed(2)} M (${o.vZamo.toFixed(3)} c)` };
  }
  const def = sysBody(GARGANTUA_SYSTEM, p.body);
  const F = planetFrame(p.body, t, spin, massSolar);
  const alt = p.altKm ?? 100;
  const rp = F.R + (p.peKm ?? alt) * 1e3 / mPerM;
  const ra = F.R + (p.apKm ?? p.peKm ?? alt) * 1e3 / mPerM;
  const inc = p.retrograde ? 180 - (p.inc ?? 0) : p.inc ?? 0;
  // (local axes: x away from the primary, y along the orbit, z north)
  const { r, v } = stateFrom(F.m, { rp, ra, i: inc, raan: p.raan ?? 0, argPe: p.argPe ?? 0, nu: p.nu ?? 0 });
  // the frame turns about z: w = v − Ω ẑ × ξ (Ω in proper time: from its Coriolis terms)
  const W = frameRate(F);
  const w: Vec3 = [v[0] + W * r[1], v[1] - W * r[0], v[2]];
  const g = toGlobal(F, { xi: r, w, landed: false });
  const b = zamoBeta(g.X, g.V, spin);
  const f = sphericalFrame(g.X);
  const cart = (q: Vec3): Vec3 => [0, 1, 2].map((i) => q[0] * f.er[i]! + q[1] * f.et[i]! + q[2] * f.ep[i]!) as Vec3;
  const up = unit(sub(g.X, F.C));
  const rel = sub(g.V, F.V);
  return { frame: "hole", X: g.X, vel: cart(b), fwd: unit(rel), up, note: `${def.name}: orbit ${Math.round((rp - F.R) * mPerM / 1e3)} × ${Math.round((ra - F.R) * mPerM / 1e3)} km` };
}
