// A world's surface, as a walker, a map and TARS read it: the local north and east at a point of a body's own
// axes (z the pole), an azimuth from the north, the great circle between two places (its length and its first
// bearing), a place written in degrees. Pure (tests/geo.test.ts).

type V3 = readonly [number, number, number];

const unit = (v: V3): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The local east and north at a point whose up is `up` (a body's own axes, z its pole); at a pole, x stands for
 *  the north. */
export function localAxes(up: V3): { east: [number, number, number]; north: [number, number, number] } {
  let e = cross([0, 0, 1], up);
  if (Math.hypot(...e) < 1e-9) e = cross(up, [1, 0, 0]);
  const east = unit(e);
  return { east, north: cross(up, east) };
}

/** A direction's azimuth at a point (from the north through the east) [0, 360) °. */
export function azimuthDeg(up: V3, v: V3): number {
  const { east, north } = localAxes(up);
  const a = (Math.atan2(dot(v, east), dot(v, north)) * 180) / Math.PI;
  return (a + 360) % 360;
}

/** The great circle from a place to another on a sphere of radius `R`: its length [the unit of R] and its bearing
 *  from the first place [0, 360) ° (haversine). */
export function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number, R: number): { dist: number; bearingDeg: number } {
  const r = Math.PI / 180;
  const p1 = lat1 * r,
    p2 = lat2 * r,
    dl = (lon2 - lon1) * r;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return { dist, bearingDeg: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 };
}

/** A latitude and a longitude written with their hemispheres ("48.8566° N 2.3522° E"); `words`: the letters of
 *  the language (N S E W). */
export function fmtLatLon(lat: number, lon: number, digits = 4, words: [string, string, string, string] = ["N", "S", "E", "W"]): string {
  const lo = ((((lon + 180) % 360) + 360) % 360) - 180;
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? words[0] : words[1]} ${Math.abs(lo).toFixed(digits)}° ${lo >= 0 ? words[2] : words[3]}`;
}

/** The eight points' letters, north first (the English; the interface translates them). */
export const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** The compass point of an azimuth (8 points). */
export function compassPoint(deg: number, points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]): string {
  return points[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}
