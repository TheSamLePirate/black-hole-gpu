import type { CameraFrame } from "../camera";
import { zamo } from "../physics";
import { properBodyAxes } from "../system/local-patch";
// Where to put the Ranger: in orbit around any body (ours: the solar system; Gargantua's side: Miller,
// Mann, Edmunds, and Gargantua itself on a Kerr circular orbit), on the ground at a latitude and
// longitude, or at a given state. Pure: returns poses (place, nose, top, velocity) in the frame the
// camera settings take (home frame on our side, the hole's map on Gargantua's side).

import type { Vec3 } from "../physics";
import { eclipticOf, poleAxes, poleOfDate, solarBody, solarState, spinVector, M_METRES, SOLAR_BODIES } from "../system/solar";
import { soiOf } from "../system/our-side";
import { bodyFixedOf, figureUp, fromBodyFixed, groundPointOf, groundVelocity, heightOverGround, solidBody } from "../system/our-surface";
import { body as sysBody, GARGANTUA_SYSTEM } from "../system/bodies";
import { circularOrbit } from "../system/kerr-orbits";
import { GEAR as HOLE_GEAR, groundR, localToZamo, planetFrame, toGlobal, zamoBeta } from "../landing";
import { millerWaves, SURF } from "../terrain";
import { mouth, sphericalFrame } from "../wormhole";
import { ECLIPTIC, elements, stateFrom, type Axes, type OrbitSpec } from "./orbit";
import { add, cross, dot, sub } from "../math/vec3";
import { type Atmosphere, airTop } from "../aero";
import { C_MPS } from "../units";

const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const KM = 1e3 / M_METRES;

export interface Pose {
  /** "ours": home frame; "hole": Gargantua's map (Boyer–Lindquist Cartesian); "mouth": by the far mouth
   *  on Gargantua's side, its rest frame's axes (x at the hole, z towards its spin axis), X from its centre */
  frame: "ours" | "hole" | "mouth";
  X: Vec3;
  /** velocity: home frame d/dt (ours); along the ZAMO axes as a Cartesian vector, β (hole) */
  vel: Vec3;
  fwd: Vec3;
  up: Vec3;
  /** landed on a body: its id and the place in its own (turning) coordinates */
  /** set down: on its body's axes [M]; `h` its origin's height over the ground there [m] (none: the gear's) */
  landed?: { body: string; q: Vec3; h?: number };
  /** Landed proper local coordinates on a Gargantua world. */
  localLanded?: { body: string; xi: Vec3 };
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
export const universeOf = (id: string): "ours" | "gargantua" | null =>
  OUR_IDS.includes(id) ? "ours" : THEIR_IDS.includes(id) ? "gargantua" : null;

/** A body's equatorial axes (not turning with it): x on the ecliptic, z along its pole. */
/** A body's equator's axes — at a date `t` [M] its pole of the date's (the sites', the take-off's: PLAN-VAISSEAUX
 *  X1f), without one its catalogue pole's. */
export function equatorAxes(id: string, t?: number): Axes {
  const b = solarBody(id);
  if (!b || b.kind === "star") return ECLIPTIC;
  return poleAxes(t === undefined ? eclipticOf(b.pole[0], b.pole[1]) : poleOfDate(b, t)) as Axes;
}

/** The air's top above a body (where the tracer's air ends: 12 scale heights) [km], 0 without. */
export function airTopKm(id: string) {
  const b = solarBody(id) ?? GARGANTUA_SYSTEM.bodies.find((q) => q.id === id);
  const atm = b && ("atmosphere" in b ? b.atmosphere : (b as { surface?: { atmosphere?: { H: number } } }).surface?.atmosphere);
  // (a giant's measured air reaches far above its 12 scale heights at 1 bar — its warm thermosphere: where it thins away)
  if (atm && "model" in atm && (atm.model === "jupiter" || atm.model === "saturn")) return airTop(atm as Atmosphere) / 1e3;
  return atm ? (12 * atm.H) / 1e3 : 0;
}

/** A sensible default altitude: clear of the air (a tenth of the radius at least, 100 km at most for small airless bodies). */
export function defaultAltKm(id: string) {
  const top = airTopKm(id);
  const b = solarBody(id);
  const Rkm = b ? b.radius / KM : 6000;
  return top > 0 ? Math.ceil((top * 1.25) / 10) * 10 : Math.max(10, Math.min(100, Math.round(0.1 * Rkm)));
}

/** An orbit around one of our bodies at time t (home frame). */
export function ourOrbitPose(p: OrbitPlacement, t: number): Pose {
  const b = solarBody(p.body);
  if (!b) throw new Error(`unknown body ${p.body}`);
  const R = b.radius;
  const alt = p.altKm ?? defaultAltKm(p.body);
  const rp = R + (p.peKm ?? alt) * KM;
  const ra = R + (p.apKm ?? p.peKm ?? alt) * KM;
  const inc = p.retrograde ? 180 - (p.inc ?? 0) : (p.inc ?? 0);
  const spec: OrbitSpec = { rp, ra, i: inc, raan: p.raan ?? 0, argPe: p.argPe ?? 0, nu: p.nu ?? 0 };
  const { r, v } = stateFrom(b.mass, spec, equatorAxes(p.body, t));
  const soi = soiOf(p.body, t);
  if (Math.max(rp, ra) > soi)
    throw new Error(
      `${b.name}: that orbit (${Math.round(Math.max(rp, ra) / KM - R / KM)} km) leaves its sphere of influence (${Math.round(soi / KM - R / KM)} km)`,
    );
  const B = solarState(p.body, t);
  const X = add(B.pos, r);
  const el = elements(b.mass, r, v, equatorAxes(p.body, t));
  const note = `${b.name}: orbit ${Math.round((el.rp - R) / KM)} × ${Math.round((el.ra - R) / KM)} km, i ${((el.i * 180) / Math.PI).toFixed(1)}°`;
  return { frame: "ours", X, vel: add(B.vel, v), fwd: unit(v), up: unit(r), note };
}

/** On the ground of one of our solid bodies at a latitude, east longitude [°] (the ship on its gear, nose east). */
export function ourGroundPose(id: string, lat: number, lon: number, t: number): Pose {
  const b = solarBody(id);
  if (!b || !solidBody(id)) throw new Error(`${b?.name ?? id}: no ground to land on`);
  const q = groundPointOf(id, lat, lon);
  const X = fromBodyFixed(id, q, t);
  // (the figure's normal: the Earth's geodetic up)
  const up = figureUp(id, X, t);
  let east = cross(spinVector(b, t), up);
  if (Math.hypot(...east) < 1e-12) east = cross([1, 0, 0], up);
  return {
    frame: "ours",
    X,
    vel: groundVelocity(id, X, t),
    fwd: unit(east),
    up,
    landed: { body: id, q },
    note: `${b.name}: landed at ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
  };
}

/** Over a giant's 1 bar level — its figure, no ground — at latitude / east longitude [°]: the pose ourGroundPose would give
 *  there, not landed (PLAN-PLANETES-AAA P11 D5: hovering in its clouds, game/tools.ts hoverOver). */
export function ourLevelPose(id: string, lat: number, lon: number, t: number): Pose {
  const b = solarBody(id);
  if (!b || b.surface !== "gas") throw new Error(`${b?.name ?? id}: not a giant`);
  const X = fromBodyFixed(id, bodyFixedOf(id, lat, lon, 0), t);
  const up = figureUp(id, X, t);
  let east = cross(spinVector(b, t), up);
  if (Math.hypot(...east) < 1e-12) east = cross([1, 0, 0], up);
  return {
    frame: "ours",
    X,
    vel: groundVelocity(id, X, t),
    fwd: unit(east),
    up,
    note: `${b.name}: over ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
  };
}

/**
 * Set down on the ground where its gear stands (our solid worlds): the relief sampled under each leg — the
 * craft's footprints, `legs` on its own axes (x left, z the nose) —, a plane through them (least squares), the
 * craft on it: its top that plane's normal, its gear's height over it at its centre, its nose `headingDeg`
 * (from the north) laid along it. A runway graded flat: level; a hillside: tilted as its wheels or feet sit.
 * No legs: the figure's normal (as ourGroundPose).
 */
export function ourGroundPoseOn(
  id: string,
  lat: number,
  lon: number,
  t: number,
  legs: { at: Vec3 }[] | null,
  headingDeg = 90,
  gear = 0,
): Pose {
  const base = ourGroundPose(id, lat, lon, t);
  const D = Math.PI / 180;
  // (the frame at the place, on the body's axes: geodetic up, north, east)
  const la = lat * D,
    lo = lon * D;
  const n0: Vec3 = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const north: Vec3 = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const east: Vec3 = [-Math.sin(lo), Math.cos(lo), 0];
  const h = headingDeg * D;
  const f0: Vec3 = [0, 1, 2].map((i) => north[i]! * Math.cos(h) + east[i]! * Math.sin(h)) as Vec3;
  const l0 = cross(n0, f0);
  const g0 = groundPointOf(id, lat, lon, 0);
  const R = (solarBody(id)?.radius ?? 1) * M_METRES;
  // (each footprint's ground: its height over the place's plane, where it stands on the craft's axes)
  const pts = (legs ?? []).map((L) => {
    const off: Vec3 = [0, 1, 2].map((i) => l0[i]! * L.at[0]! + f0[i]! * L.at[2]!) as Vec3;
    const dn = dot(off, north),
      de = dot(off, east);
    const q = groundPointOf(id, lat + dn / R / D, lon + de / (R * Math.cos(la)) / D, 0);
    const d = sub(q, g0).map((x) => x * M_METRES) as Vec3;
    return { x: L.at[0]!, y: L.at[2]!, z: dot(d, n0) };
  });
  let n = n0,
    a = 0;
  if (pts.length >= 3) {
    // (z = a + b x + c y by least squares: the normal n0 − b l0 − c f0)
    const N = pts.length;
    let sx = 0,
      sy = 0,
      sz = 0,
      sxx = 0,
      syy = 0,
      sxy = 0,
      sxz = 0,
      syz = 0;
    for (const p of pts) {
      sx += p.x;
      sy += p.y;
      sz += p.z;
      sxx += p.x * p.x;
      syy += p.y * p.y;
      sxy += p.x * p.y;
      sxz += p.x * p.z;
      syz += p.y * p.z;
    }
    // (centred: the normal equations of b, c; a the mean height less their part)
    const mx = sx / N,
      my = sy / N,
      mz = sz / N;
    const Cxx = sxx / N - mx * mx,
      Cyy = syy / N - my * my,
      Cxy = sxy / N - mx * my;
    const Cxz = sxz / N - mx * mz,
      Cyz = syz / N - my * mz;
    const det = Cxx * Cyy - Cxy * Cxy;
    if (Math.abs(det) > 1e-9) {
      const b = (Cxz * Cyy - Cyz * Cxy) / det,
        c = (Cyz * Cxx - Cxz * Cxy) / det;
      a = mz - b * mx - c * my;
      const m = [0, 1, 2].map((i) => n0[i]! - b * l0[i]! - c * f0[i]!) as Vec3;
      const lm = Math.hypot(...m);
      n = [m[0] / lm, m[1] / lm, m[2] / lm];
    }
  }
  // (the craft's centre: on the plane over the place, its gear's height along the plane's normal)
  const qc: Vec3 = [0, 1, 2].map((i) => g0[i]! + (n0[i]! * a + n[i]! * gear) / M_METRES) as Vec3;
  const X = fromBodyFixed(id, qc, t);
  const dir = (v: Vec3): Vec3 => {
    const e = 1e-9;
    const P = fromBodyFixed(id, [qc[0] + v[0] * e, qc[1] + v[1] * e, qc[2] + v[2] * e], t);
    const d = sub(P, X);
    const l = Math.hypot(...d) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  };
  // (the nose along the plane)
  const fp = sub(f0, [n[0] * dot(f0, n), n[1] * dot(f0, n), n[2] * dot(f0, n)]);
  // (its height over the ground at its centre kept: on a slope more than the gear's — each wheel on the ground)
  return { ...base, X, vel: groundVelocity(id, X, t), fwd: dir(fp), up: dir(n), landed: { body: id, q: qc, h: heightOverGround(id, qc) } };
}

/**
 * The direction over a place (latitude, east longitude [°]) at a distance from the body's centre [the body's
 * radius + `hKm`, as an orbit's heights are counted], as orbitOver() takes it: on our worlds the point that far
 * out on the place's normal — the Earth's geodetic one (WGS84: the latitudes an address, a map, a GPS give), so
 * the ship's nadir is the place, not a point 0.19° off it —; on Gargantua's, the direction on its frame's sphere.
 */
export function overPlace(id: string, lat: number, lon: number, hKm: number): Vec3 {
  const D = Math.PI / 180;
  if (universeOf(id) !== "ours") return [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
  const r = solarBody(id)!.radius + hKm * KM;
  let hM = hKm * 1e3;
  let q = bodyFixedOf(id, lat, lon, hM);
  // (the height on the normal that puts it at that radius: a few metres off after the first, nothing after three)
  for (let k = 0; k < 3; k++) {
    hM += (r - Math.hypot(...q)) * M_METRES;
    q = bodyFixedOf(id, lat, lon, hM);
  }
  return q;
}

/**
 * An orbit passing over a place now: its node Ω and true anomaly ν [°] (the periapsis' argument ω
 * kept), going up — northwards — over it; the inclination raised to the place's latitude when lower (no
 * orbit reaches past it). The place: a unit direction on the body's own axes (ours: fixed on its
 * ground, turning with it; Gargantua's worlds: their frame's ξ). `inc` as the placement takes it (a
 * retrograde orbit: 180° − inc).
 */
export function orbitOver(id: string, q: Vec3, t: number, o: { inc: number; argPe: number; retrograde: boolean }) {
  const D = Math.PI / 180;
  let e = unit(q);
  if (universeOf(id) === "ours") {
    const d = unit(sub(fromBodyFixed(id, q, t), solarState(id, t).pos));
    const A = equatorAxes(id, t);
    e = [dot(d, A[0]), dot(d, A[1]), dot(d, A[2])];
  }
  const lat = Math.asin(Math.min(Math.max(e[2], -1), 1)),
    lam = Math.atan2(e[1], e[0]);
  let inc = Math.min(Math.max(o.inc, 0), 90);
  // (the orbit's highest latitude is its inclination — retrograde: 180° − it, the same reach)
  if (Math.abs(lat) / D > inc) inc = Math.min(90, Math.ceil((Math.abs(lat) / D) * 10 + 1e-9) / 10);
  const I = (o.retrograde ? 180 - inc : inc) * D;
  let raan: number, u: number;
  if (Math.abs(Math.sin(I)) < 1e-9) (raan = 0), (u = o.retrograde ? -lam : lam);
  else {
    const su = Math.min(Math.max(Math.sin(lat) / Math.sin(I), -1), 1);
    u = Math.asin(su);
    raan = lam - Math.atan2(su * Math.cos(I), Math.cos(u));
  }
  const wrap = (x: number) => ((((x / D) % 360) + 540) % 360) - 180;
  return { inc, raan: wrap(raan), nu: wrap(u - o.argPe * D) };
}

/**
 * On the ground of one of Gargantua's worlds at a place (a unit direction on its frame's ξ): Gargantua
 * where it stands in that place's sky (theirGroundPose's elevation and azimuth).
 */
export function theirGroundAt(body: string, q: Vec3, t: number, spin: number, massSolar: number): Pose {
  const F = planetFrame(body, t, spin, massSolar);
  const S = F.S;
  const cr: Vec3 = [F.C[0] - F.H[0], F.C[1] - F.H[1], 0];
  const ex = unit(cr),
    ey: Vec3 = [-ex[1], ex[0], 0],
    ez: Vec3 = [0, 0, 1];
  const g0 = unit([-F.C[0], -F.C[1], -F.C[2]]);
  const g = unit([dot(g0, ex) * S[0], dot(g0, ey) * S[1], dot(g0, ez) * S[2]]);
  let north = sub([0, 0, 1], g.map((c) => c * g[2]) as Vec3);
  if (Math.hypot(...north) < 1e-6) north = [0, 1, 0];
  north = unit(north);
  const east = cross(g, north);
  const p = unit(q);
  const z = Math.acos(Math.min(Math.max(dot(p, g), -1), 1));
  const tilt = sub(p, g.map((c) => c * Math.cos(z)) as Vec3);
  const A = Math.hypot(...tilt) < 1e-9 ? 0 : Math.atan2(-dot(tilt, east), -dot(tilt, north));
  return theirGroundPose(body, 90 - (z * 180) / Math.PI, (A * 180) / Math.PI, t, spin, massSolar);
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
    return {
      frame: "hole",
      X,
      vel,
      fwd: p.retrograde ? (f.ep.map((c) => -c) as Vec3) : f.ep,
      up: f.er,
      note: `Gargantua: circular orbit at ${r.toFixed(2)} M (${o.vZamo.toFixed(3)} c)`,
    };
  }
  const def = sysBody(GARGANTUA_SYSTEM, p.body);
  const F = planetFrame(p.body, t, spin, massSolar);
  const alt = p.altKm ?? 100;
  const rp = F.R + ((p.peKm ?? alt) * 1e3) / mPerM;
  const ra = F.R + ((p.apKm ?? p.peKm ?? alt) * 1e3) / mPerM;
  const inc = p.retrograde ? 180 - (p.inc ?? 0) : (p.inc ?? 0);
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
  return {
    frame: "hole",
    X: g.X,
    vel: cart(b),
    fwd: unit(rel),
    up,
    note: `${def.name}: orbit ${Math.round(((rp - F.R) * mPerM) / 1e3)} × ${Math.round(((ra - F.R) * mPerM) / 1e3)} km`,
  };
}

/**
 * In level flight over one of Gargantua's worlds, within its air: where its orbit at that height would
 * be (`nu`, `inc`), the craft flying `speed` [m/s] through the air along that orbit's way, nose on the
 * motion, wings level — not an orbit's kilometres a second in the air (a scene of its low views flown
 * by the ship broke it up at once, at hundreds of g). Null for a world without air there.
 */
export function theirFlightPose(p: OrbitPlacement, t: number, spin: number, massSolar: number, speed = 250): Pose | null {
  const F = planetFrame(p.body, t, spin, massSolar);
  const alt = (p.altKm ?? 100) * 1e3;
  if (!F.atm || !(alt < airTop(F.atm))) return null;
  const mPerM = 1476.625 * massSolar;
  const rp = F.R + alt / mPerM;
  const { r, v } = stateFrom(F.m, {
    rp,
    ra: rp,
    i: p.retrograde ? 180 - (p.inc ?? 0) : (p.inc ?? 0),
    raan: p.raan ?? 0,
    argPe: p.argPe ?? 0,
    nu: p.nu ?? 0,
  });
  // (the air turns with the world — tidally locked, its frame's: at rest in the local axes; the flight
  // along the orbit's horizontal way)
  const rl = Math.hypot(...r);
  const ru: Vec3 = [r[0] / rl, r[1] / rl, r[2] / rl];
  const hv = sub(v, ru.map((c) => c * dot(v, ru)) as Vec3);
  const hl = Math.hypot(...hv);
  const w: Vec3 = [(hv[0] / hl) * (speed / C_MPS), (hv[1] / hl) * (speed / C_MPS), (hv[2] / hl) * (speed / C_MPS)];
  const g = toGlobal(F, { xi: r, w, landed: false });
  const b = zamoBeta(g.X, g.V, spin);
  const f = sphericalFrame(g.X);
  const cart = (q: Vec3): Vec3 => [0, 1, 2].map((i) => q[0] * f.er[i]! + q[1] * f.et[i]! + q[2] * f.ep[i]!) as Vec3;
  // (the attitude as the local flight reads it: its axes on the ZAMO's by localToZamo — the nose on the
  // motion through the air, the top away from the world's centre)
  const fwd = cart(localToZamo(unit(w)));
  const up = cart(localToZamo(ru));
  return {
    frame: "hole",
    X: g.X,
    vel: cart(b),
    fwd,
    up,
    note: `${sysBody(GARGANTUA_SYSTEM, p.body).name}: flying ${Math.round(alt / 1e3)} km up at ${speed} m/s`,
  };
}

/**
 * On the ground of one of Gargantua's worlds, the ship at rest on it (turning with it: tidally locked),
 * at the place where Gargantua stands `el` [°] above the horizon, `az` [°] round from its north (east
 * positive); the nose level towards Gargantua.
 */
export function theirGroundPose(body: string, el: number, az: number, t: number, spin: number, massSolar: number): Pose {
  const F = planetFrame(body, t, spin, massSolar);
  const def = sysBody(GARGANTUA_SYSTEM, body);
  // (the local axes: x away from its primary, y along its orbit, z north — on the map)
  const cr: Vec3 = [F.C[0] - F.H[0], F.C[1] - F.H[1], 0];
  const ex = unit(cr),
    ey: Vec3 = [-ex[1], ex[0], 0],
    ez: Vec3 = [0, 0, 1];
  // (its axes are proper lengths: S of the map's per unit)
  const S = F.S;
  // Gargantua's direction from the world, on its axes; the place: from the point under it, 90° − el
  // away, towards the azimuth
  const g0 = unit([-F.C[0], -F.C[1], -F.C[2]]);
  const g = unit([dot(g0, ex) * S[0], dot(g0, ey) * S[1], dot(g0, ez) * S[2]]);
  let north = sub([0, 0, 1], g.map((c) => c * g[2]) as Vec3);
  if (Math.hypot(...north) < 1e-6) north = [0, 1, 0];
  north = unit(north);
  const east = cross(g, north);
  const z = ((90 - el) * Math.PI) / 180;
  const placeAt = (azDeg: number) => {
    const A = (azDeg * Math.PI) / 180;
    // (seen from the place, Gargantua lies towards −(the tilt): the tilt away from it is the azimuth's opposite)
    const tilt: Vec3 = [0, 1, 2].map((i) => -(Math.cos(A) * north[i]! + Math.sin(A) * east[i]!)) as Vec3;
    return unit([0, 1, 2].map((i) => g[i]! * Math.cos(z) + tilt[i]! * Math.sin(z)) as Vec3);
  };
  let q = placeAt(az);
  if (F.surf === SURF.ocean) {
    // Miller: between its giant waves (drawn, not felt: the ship in a trough, not inside a wall of water)
    const tSec = t * 4.925490947e-6 * massSolar,
      mR = F.R * F.mPerM;
    for (let k = 0; k < 1440; k++) {
      const qk = placeAt(az + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25);
      const h = millerWaves(qk, tSec, mR);
      if (h < 1) {
        q = qk;
        break;
      }
    }
  }
  // (on the ground the gear feels — the waves are drawn, not felt: set on the drawn water the ship fell
  // a metre onto the sea, 5 m/s, a crash for a real gear)
  const rG = groundR(F, [q[0] * F.R, q[1] * F.R, q[2] * F.R]) + HOLE_GEAR / F.mPerM;
  const xi: Vec3 = [q[0] * rG, q[1] * rG, q[2] * rG];
  const glob = toGlobal(F, { xi, w: [0, 0, 0], landed: true });
  const b = zamoBeta(glob.X, glob.V, spin);
  const f = sphericalFrame(glob.X);
  const cart = (v: Vec3): Vec3 => [0, 1, 2].map((i) => v[0] * f.er[i]! + v[1] * f.et[i]! + v[2] * f.ep[i]!) as Vec3;
  const axes = properBodyAxes(F, { r: f.r, theta: f.th, phi: f.ph, zamo: zamo(f.r, f.th, spin), beta: b } as CameraFrame);
  const direction = (v: Vec3): Vec3 => cart([0, 1, 2].map((i) => axes.reduce((sum, a, j) => sum + a[i]! * v[j]!, 0)) as Vec3);
  let heading = sub(g, q.map((c) => c * dot(g, q)) as Vec3);
  // At the sub-primary point (or its antipode), the projected primary direction vanishes.
  // Keep a real tangent heading instead of handing a zero nose vector to the ship attitude.
  if (Math.hypot(...heading) < 1e-6) {
    const pole: Vec3 = Math.abs(q[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    heading = sub(pole, q.map((c) => c * dot(pole, q)) as Vec3);
  }
  const h = unit(heading);
  return {
    frame: "hole",
    X: glob.X,
    vel: cart(b),
    fwd: direction(h),
    up: direction(q),
    localLanded: { body, xi },
    note: `${def.name}: on the ground, Gargantua ${el}° up`,
  };
}

/**
 * Beside one of our bodies, at rest against it (the hover autopilot then holds it there): `altKm`
 * above its surface (by default two radii: three from its centre, the approach's stand-off), on its
 * sunlit side a little round towards its evening, nose on it; within its sphere of influence. The Sun:
 * on the Earth's side.
 */
export function ourNearPose(id: string, t: number, altKm?: number): Pose {
  const b = solarBody(id);
  if (!b) throw new Error(`unknown body ${id}`);
  const B = solarState(id, t);
  const soi = soiOf(id, t);
  const r = Math.min(b.radius + (altKm ?? (2 * b.radius) / KM) * KM, 0.7 * soi);
  const toward = id === "sun" ? solarState("earth", t).pos : solarState("sun", t).pos;
  const s = unit(sub(toward, B.pos));
  // (35° round the ecliptic's pole from the light: the body three-quarters lit)
  const c = Math.cos((35 * Math.PI) / 180),
    k = Math.sin((35 * Math.PI) / 180);
  const dir = unit([s[0] * c - s[1] * k, s[0] * k + s[1] * c, s[2]]);
  const fwd: Vec3 = [-dir[0], -dir[1], -dir[2]];
  const up = unit(sub([0, 0, 1], fwd.map((q) => q * fwd[2]) as Vec3));
  return {
    frame: "ours",
    X: add(B.pos, dir.map((q) => q * r) as Vec3),
    vel: B.vel,
    fwd,
    up,
    note: `${b.name}: ${Math.round((r - b.radius) / KM)} km above it, at rest`,
  };
}

/**
 * Before our mouth of the wormhole (the home frame's origin), at rest against it, on its sunlit side,
 * nose on it: `d` [M] from its centre (by default four of its throat's radii: the sphere 30° across).
 */
export function ourMouthPose(s: Parameters<typeof mouth>[0], t: number, d?: number): Pose {
  const m = mouth(s, t);
  const r = d ?? 4 * m.w.rho;
  const dir = unit(solarState("sun", t).pos);
  const fwd: Vec3 = [-dir[0], -dir[1], -dir[2]];
  const up = unit(sub([0, 0, 1], fwd.map((q) => q * fwd[2]) as Vec3));
  return { frame: "ours", X: dir.map((q) => q * r) as Vec3, vel: [0, 0, 0], fwd, up, note: "Before the wormhole (our side), at rest" };
}

/**
 * Before the wormhole's far mouth (Gargantua's side), at rest against it: on its side away from the
 * hole, `d` [M] from its centre (by default four of its throat's radii), nose on it — Gargantua beyond
 * it. In the mouth's own frame (the camera there in the wormhole's coordinates, ℓ > 0).
 */
export function theirMouthPose(s: Parameters<typeof mouth>[0], t: number, d?: number): Pose {
  const r = d ?? 4 * mouth(s, t).w.rho;
  return {
    frame: "mouth",
    X: [-r, 0, 0],
    vel: [0, 0, 0],
    fwd: [1, 0, 0],
    up: [0, 0, 1],
    note: "Before the wormhole (Gargantua's side), at rest",
  };
}

/**
 * Beside one of Gargantua's worlds, at rest in its frame (turning with it, tidally locked): `altKm`
 * above it (by default two of its radii), between it and Gargantua and round along its orbit, nose on
 * it. Gargantua itself: a static observer `rM` [M] from its centre on its equator (the hover autopilot
 * holds it there against the fall).
 */
export function theirNearPose(body: string, t: number, spin: number, massSolar: number, altKm?: number, rM = 12): Pose {
  if (body === "gargantua") {
    const X: Vec3 = [rM, 0, 0];
    return { frame: "hole", X, vel: [0, 0, 0], fwd: [-1, 0, 0], up: [0, 0, 1], note: `Gargantua: ${rM} M from it, static` };
  }
  const F = planetFrame(body, t, spin, massSolar);
  const def = sysBody(GARGANTUA_SYSTEM, body);
  const ex = unit([F.C[0] - F.H[0], F.C[1] - F.H[1], 0]),
    ey: Vec3 = [-ex[1], ex[0], 0],
    ez: Vec3 = [0, 0, 1];
  const S = F.S;
  const toMap = (v: Vec3): Vec3 => [0, 1, 2].map((i) => (v[0] / S[0]) * ex[i]! + (v[1] / S[1]) * ey[i]! + (v[2] / S[2]) * ez[i]!) as Vec3;
  const r = F.R + ((altKm ?? (2 * F.R * F.mPerM) / 1e3) * 1e3) / F.mPerM;
  // (on its axes — x away from its primary —: towards Gargantua and along its orbit, a little above)
  const dir = unit([-0.6, 0.75, 0.25]);
  const glob = toGlobal(F, { xi: dir.map((q) => q * r) as Vec3, w: [0, 0, 0], landed: false });
  const b = zamoBeta(glob.X, glob.V, spin);
  const f = sphericalFrame(glob.X);
  const cart = (v: Vec3): Vec3 => [0, 1, 2].map((i) => v[0] * f.er[i]! + v[1] * f.et[i]! + v[2] * f.ep[i]!) as Vec3;
  const fwd = unit(toMap(dir.map((q) => -q) as Vec3));
  const up = unit(sub(ez, fwd.map((q) => q * fwd[2]) as Vec3));
  return {
    frame: "hole",
    X: glob.X,
    vel: cart(b),
    fwd,
    up,
    note: `${def.name}: ${Math.round(((r - F.R) * F.mPerM) / 1e3)} km above it, at rest`,
  };
}
