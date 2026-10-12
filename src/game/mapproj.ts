// The Atlas's projections (PLAN-MODES-AAA M6): the Earth on Web Mercator (its imagery's tiles — GIBS, EOX — are
// cut so), the Moon and Mars on the plate carrée (their maps are). The world's square: x 0 … 1 west to east from
// the antimeridian, y 0 … 1 (Mercator) or 0 … ½ (plate carrée) north to south. The terminator, the line of the
// day and the night, from the subsolar point. Pure (tests/mapproj.test.ts).

export type ProjKind = "mercator" | "equirect";

/** Web Mercator's last latitude (the square's edge) [°]. */
export const MERC_MAX = 85.05112878;
const D = Math.PI / 180;

/** The world's height (its width is 1). */
export const worldHeight = (k: ProjKind) => (k === "mercator" ? 1 : 0.5);

/** A place on the world's square. */
export function project(k: ProjKind, lat: number, lon: number): [number, number] {
  const x = (lon + 180) / 360;
  if (k === "equirect") return [x, (90 - lat) / 360];
  const l = Math.max(-MERC_MAX, Math.min(MERC_MAX, lat)) * D;
  return [x, (1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2];
}

/** The place at a point of the world's square (x wrapped into 0 … 1). */
export function unproject(k: ProjKind, x: number, y: number): [number, number] {
  const lon = (((x % 1) + 1) % 1) * 360 - 180;
  if (k === "equirect") return [Math.max(-90, Math.min(90, 90 - y * 360)), lon];
  const n = Math.PI * (1 - 2 * y);
  return [Math.atan(Math.sinh(n)) / D, lon];
}

/** The latitude of the terminator at a longitude, the subsolar point given [°] (the Sun on the horizon there). */
export function terminatorLat(lon: number, sunLat: number, sunLon: number): number {
  const t = Math.tan(sunLat * D);
  // (the Sun over the equator: the terminator a meridian pair — ±90 where it is)
  if (Math.abs(t) < 1e-9) return Math.cos((lon - sunLon) * D) >= 0 ? -90 : 90;
  return Math.atan(-Math.cos((lon - sunLon) * D) / t) / D;
}

/** Whether a place is in the night (the Sun below its horizon). */
export function isNight(lat: number, lon: number, sunLat: number, sunLon: number): boolean {
  const c = Math.sin(lat * D) * Math.sin(sunLat * D) + Math.cos(lat * D) * Math.cos(sunLat * D) * Math.cos((lon - sunLon) * D);
  return c < 0;
}

/** The tiles (z, x, y; x wrapped) covering a view of the Mercator square: its centre [world], its scale [px per world
 *  unit], its size [px]; z the level whose 256 px tiles are nearest the scale, within 0 … maxZ. */
export function tilesFor(cx: number, cy: number, scale: number, W: number, H: number, maxZ: number) {
  const z = Math.max(0, Math.min(maxZ, Math.round(Math.log2(scale / 256))));
  const n = 2 ** z;
  const x0 = Math.floor((cx - W / 2 / scale) * n),
    x1 = Math.floor((cx + W / 2 / scale) * n);
  const y0 = Math.max(0, Math.floor((cy - H / 2 / scale) * n)),
    y1 = Math.min(n - 1, Math.floor((cy + H / 2 / scale) * n));
  const out: { z: number; x: number; y: number; tx: number }[] = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push({ z, x: ((tx % n) + n) % n, y: ty, tx });
  return { z, n, tiles: out };
}
