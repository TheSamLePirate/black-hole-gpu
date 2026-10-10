// The eclipses' geometry (PLAN-CIEL C5): where a body's shadow falls and how two discs overlap, on the
// ephemerides the game flies by (solar.ts: DE440, JUP365, the moons' elements), light-time retarded as the
// tracer draws them (seenFrom). Times are UTC [ms]; lengths km; angles radians. Two primitives:
//  · shadowAt(occluder, receiver, t): the receiver's centre from the occluder's shadow axis (the line from
//    the Sun through it, the light as it left the Sun for it), the umbra's and the penumbra's radii there
//    (cones: the Sun's disc past the occluder's limb), and how far along the axis it is;
//  · discsAt(observer point, near, far, t): their apparent centres' separation and radii as seen there.
// And the search in time: intervals where a function is negative (stepped as fast as it may change,
// refined by bisection), a minimum (golden section).

import { add, cross, dot, len, scale, sub, type Vec3 } from "../math/vec3";
import { bodyAxes, EPOCH_DATE, M_METRES, M_SECONDS, seenFrom, solarBody, solarState } from "../system/solar";

export const KM = M_METRES / 1000;
/** the scene's time t [M] at a UTC time [ms], and back */
export const tOf = (ms: number) => (ms - EPOCH_DATE) / (M_SECONDS * 1e3);
export const msOf = (t: number) => EPOCH_DATE + t * M_SECONDS * 1e3;

/** A body's radius [km] (its equatorial). */
export const radiusKm = (id: string) => solarBody(id)!.radius * KM;

/** A body's place [km, the home frame, the axes the ecliptic's] at a UTC time, geometric. */
export function posKm(id: string, ms: number): Vec3 {
  return scale(solarState(id, tOf(ms)).pos, KM);
}

/** A body as seen from a point [km] at a UTC time: where its light now arriving there left it [km]. */
export function seenKm(id: string, ms: number, obsKm: Vec3): Vec3 {
  return scale(seenFrom(id, tOf(ms), scale(obsKm, 1 / KM)).pos, KM);
}

export interface Shadow {
  /** the receiver's centre from the axis [km], and along it from the occluder (towards the receiver) [km] */
  d: number;
  z: number;
  /** the umbra's radius there [km] (negative: past its tip — the antumbra, an annular eclipse's) */
  umbra: number;
  /** the penumbra's radius there [km] */
  pen: number;
  /** the receiver's radius [km] */
  R: number;
  /** how fast the umbra narrows along the axis (tan of its cone's half-angle) */
  tanU: number;
  /** the axis's unit direction (away from the Sun), the occluder's and the receiver's places [km] */
  axis: Vec3;
  occ: Vec3;
  rec: Vec3;
  /** the receiver's centre in the axis's perpendicular plane, from the axis [km] (its offset vector) */
  off: Vec3;
}

/**
 * The occluder's shadow at the receiver at a UTC time (the receiver's place then; the occluder where the
 * light passing it now left it, the Sun where that light left the Sun). `shrink`, `enlarge`: the occluder's
 * radius taken at that share, then grown by that one (the Earth for the lunar eclipses, Danjon's rule: its
 * radius at 45° of latitude, 0.998340 of the equator's, grown by its air's 1/85).
 */
export function shadowAt(occluder: string, receiver: string, ms: number, enlarge = 0, shrink = 1): Shadow {
  const rec = posKm(receiver, ms);
  const occ = seenKm(occluder, ms, rec);
  const sun = seenKm("sun", ms - (len(sub(rec, occ)) / 299792.458) * 1e3, occ);
  const axis = scale(sub(occ, sun), 1 / len(sub(occ, sun)));
  const Rs = radiusKm("sun");
  const Ro = radiusKm(occluder) * shrink * (1 + enlarge);
  const Ds = len(sub(occ, sun));
  const v = sub(rec, occ);
  const z = dot(v, axis);
  const off = sub(v, scale(axis, z));
  // (the cones' half-angles: the Sun's limb past the occluder's, on the same side (umbra) or across (penumbra))
  const fu = Math.asin((Rs - Ro) / Ds);
  const fp = Math.asin((Rs + Ro) / Ds);
  return {
    d: len(off),
    z,
    umbra: Ro / Math.cos(fu) - z * Math.tan(fu),
    pen: Ro / Math.cos(fp) + z * Math.tan(fp),
    R: radiusKm(receiver),
    tanU: Math.tan(fu),
    axis,
    occ,
    rec,
    off,
  };
}

export interface Discs {
  /** the centres' separation, the near's and the far's angular radii [rad] */
  sep: number;
  rNear: number;
  rFar: number;
  /** the near body nearer than the far (it is in front) */
  front: boolean;
  /** the directions to them (unit) */
  uNear: Vec3;
  uFar: Vec3;
}

/** Two bodies' discs as seen from a point [km] at a UTC time (each where its light now arriving left it). */
export function discsAt(obs: Vec3, near: string, far: string, ms: number): Discs {
  const a = sub(seenKm(near, ms, obs), obs);
  const b = sub(seenKm(far, ms, obs), obs);
  const la = len(a),
    lb = len(b);
  const ua = scale(a, 1 / la),
    ub = scale(b, 1 / lb);
  const sep = Math.atan2(len(cross(ua, ub)), dot(ua, ub));
  return {
    sep,
    rNear: Math.asin(Math.min(radiusKm(near) / la, 1)),
    rFar: Math.asin(Math.min(radiusKm(far) / lb, 1)),
    front: la < lb,
    uNear: ua,
    uFar: ub,
  };
}

/** A body's centre [km] — its place at a UTC time, geometric (the observer's own). */
export const centreKm = posKm;

/** A point of the Earth's surface (geodetic lat, lon [rad], height [m]) in the home frame [km] at a UTC time. */
export function earthPointKm(lat: number, lon: number, hM: number, ms: number): Vec3 {
  const a = 6378.137,
    f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const s = Math.sin(lat),
    c = Math.cos(lat);
  const N = a / Math.sqrt(1 - e2 * s * s);
  const h = hM / 1000;
  const p: Vec3 = [(N + h) * c * Math.cos(lon), (N + h) * c * Math.sin(lon), (N * (1 - e2) + h) * s];
  const A = bodyAxes(solarBody("earth")!, tOf(ms));
  return add(posKm("earth", ms), add(add(scale(A[0], p[0]), scale(A[1], p[1])), scale(A[2], p[2])));
}

/** A body-fixed point's geodetic latitude, longitude [rad] from a home-frame point [km] of the Earth at a UTC time. */
export function earthLatLon(pKm: Vec3, ms: number): { lat: number; lon: number } {
  const A = bodyAxes(solarBody("earth")!, tOf(ms));
  const q = sub(pKm, posKm("earth", ms));
  const x = dot(q, A[0]),
    y = dot(q, A[1]),
    z = dot(q, A[2]);
  const a = 6378.137,
    f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const lon = Math.atan2(y, x);
  const rho = Math.hypot(x, y);
  let lat = Math.atan2(z, rho * (1 - e2));
  for (let i = 0; i < 4; i++) {
    const s = Math.sin(lat);
    const N = a / Math.sqrt(1 - e2 * s * s);
    lat = Math.atan2(z + e2 * N * s, rho);
  }
  return { lat, lon };
}

// ------------------------------------------------------------------------------------ the search in time

/**
 * The intervals of [a, b] where g < 0: stepped by step(t, g) (no more than the time g needs to cross zero at
 * its fastest — the caller knows), each edge refined by bisection to tol [ms].
 */
export function intervals(
  g: (ms: number) => number,
  a: number,
  b: number,
  step: (ms: number, v: number) => number,
  tol = 500,
): [number, number][] {
  const out: [number, number][] = [];
  let t = a,
    v = g(t);
  let start = v < 0 ? a : Number.NaN;
  while (t < b) {
    const dt = Math.max(step(t, v), 1000);
    const t2 = Math.min(t + dt, b);
    const v2 = g(t2);
    if (v < 0 !== v2 < 0) {
      let lo = t,
        hi = t2;
      while (hi - lo > tol) {
        const m = (lo + hi) / 2;
        if (g(m) < 0 === v < 0) lo = m;
        else hi = m;
      }
      const edge = (lo + hi) / 2;
      if (v2 < 0) start = edge;
      else {
        out.push([start, edge]);
        start = Number.NaN;
      }
    }
    t = t2;
    v = v2;
  }
  if (!Number.isNaN(start)) out.push([start, b]);
  return out;
}

/** The minimum of f on [a, b] (golden section, to tol [ms]). */
export function minimum(f: (ms: number) => number, a: number, b: number, tol = 200): { t: number; v: number } {
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a),
    x2 = a + g * (b - a);
  let f1 = f(x1),
    f2 = f(x2);
  while (b - a > tol) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - g * (b - a);
      f1 = f(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (b - a);
      f2 = f(x2);
    }
  }
  const t = (a + b) / 2;
  return { t, v: f(t) };
}

/** The share of a disc of angular radius rs left uncovered by one of radius rm, their centres d apart. */
export { diskShare } from "../system/solar";
