// The sky's events from a place and a view (PLAN-MODES-AAA M7): the geometry the sky events panel (ui/skyevents.ts)
// reads — the angle between two directions of the sky, where the celestial pole stands (the circumpolar trails'
// aim; else along the view), a selenelion's moment (a lunar eclipse with the Moon and the Sun both on the horizon),
// the ISS's closest approach to the Sun or the Moon over its passes (a transit when under their radius), the
// exposures' times through an event, the lens for a field. Pure (tests/skyevents.test.ts): the bodies' positions
// are given as functions.

/** A direction of the sky: its azimuth (from the north, eastwards) and its altitude [°]. */
export interface AzAlt {
  az: number;
  alt: number;
}
const D = Math.PI / 180;

/** The angle between two directions of the sky [°]. */
export function angSep(a: AzAlt, b: AzAlt): number {
  const c = Math.sin(a.alt * D) * Math.sin(b.alt * D) + Math.cos(a.alt * D) * Math.cos(b.alt * D) * Math.cos((a.az - b.az) * D);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D;
}

/** Where the celestial pole of the hemisphere stands from a latitude [°]: due north at the latitude's height, or due
 *  south at its depth. */
export function poleView(lat: number): AzAlt {
  return lat >= 0 ? { az: 0, alt: lat } : { az: 180, alt: -lat };
}

/** The star trails' aim from a place and the view: the pole when it stands 10° up at least, else along the view
 *  (raised to 25° at least: the sky, not the ground). */
export function trailsAim(lat: number, view: AzAlt): { aim: AzAlt; toward: "pole" | "north" | "east" | "south" | "west" } {
  const p = poleView(lat);
  if (p.alt >= 10) return { aim: p, toward: "pole" };
  const cardinal = (["north", "east", "south", "west"] as const)[Math.round((((view.az % 360) + 360) % 360) / 90) % 4]!;
  return { aim: { az: view.az, alt: Math.max(25, view.alt) }, toward: cardinal };
}

/** The exposures' times through a span: `n` of them, the first at `from`, the last at `to` [ms]. */
export function shotTimes(from: number, to: number, n: number): number[] {
  if (n <= 1) return [from];
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

/** The 35 mm lens of a vertical field [°] (24 mm high: f = 12 / tan(fov/2)) [mm]. */
export function lensMm(fovDeg: number): number {
  return 12 / Math.tan((fovDeg * D) / 2);
}

/**
 * A selenelion's moment: through the eclipse's umbral phase (U1 … U4, else its penumbral P1 … P4), the first time the
 * eclipsed Moon and the Sun both stand within the horizon's band (−1° … +2°: the refraction lifts them about half a
 * degree), sampled every two minutes. Null: none from there.
 */
export function selenelionAt(
  contacts: { name: string; t: number }[],
  azAlt: (id: "sun" | "moon", ms: number) => AzAlt,
): { t: number; moon: AzAlt; sun: AzAlt } | null {
  const c = (n: string) => contacts.find((k) => k.name === n)?.t;
  const a = c("U1") ?? c("P1"),
    b = c("U4") ?? c("P4");
  if (a === undefined || b === undefined || b <= a) return null;
  const band = (x: number) => x >= -1 && x <= 2;
  for (let t = a; t <= b; t += 120e3) {
    const moon = azAlt("moon", t);
    if (!band(moon.alt)) continue;
    const sun = azAlt("sun", t);
    if (band(sun.alt)) return { t, moon, sun };
  }
  return null;
}

/**
 * The ISS's closest approach to a body over the given times (the passes', a few seconds apart): the time, the
 * angle [°], where the station is — with both above 5°. Null: never both up. Under ~0.26° (the Sun's and the
 * Moon's radius) it crosses the disc: a transit, from there.
 */
export function closestApproach(
  times: number[],
  iss: (ms: number) => AzAlt | null,
  body: (ms: number) => AzAlt,
): { t: number; sep: number; iss: AzAlt; body: AzAlt } | null {
  let best: { t: number; sep: number; iss: AzAlt; body: AzAlt } | null = null;
  for (const t of times) {
    const s = iss(t);
    if (!s || s.alt < 5) continue;
    const b = body(t);
    if (b.alt < 5) continue;
    const sep = angSep(s, b);
    if (!best || sep < best.sep) best = { t, sep, iss: s, body: b };
  }
  return best;
}

/** The disc's radius of the Sun and the Moon seen from the Earth (the mean) [°]: under it, the ISS transits. */
export const DISC_RADIUS = 0.26;
