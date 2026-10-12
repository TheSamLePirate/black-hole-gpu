// The Earth's exceptional landscapes, each rebuilt from a real photograph (Wikimedia Commons): the camera
// where the photographer stood, turned the way they looked, at the hour they pressed the shutter, through
// the same lens. The photograph is the reference the scene is judged against (tests/e2e/landscapes:
// side by side on the Mac); the scene gallery lists them under "Landscapes".
//
// A view stands on the ground (the camera on its tripod, as Yosemite's Tunnel View): `heading` is the
// photo's view direction when its page gives it, else the bearing to `subject`; `pitch` raises the look
// above the level (the subject's elevation angle from the real relief — Terrarium tiles, z13 —, less a
// little: photographers frame a summit in the upper third).

/** A photograph on Wikimedia Commons: its page, author and licence (shown with the reference). */
export interface PhotoReference {
  /** the file's page, https://commons.wikimedia.org/wiki/File:… */
  page: string;
  author: string;
  licence: string;
  /** when it was taken, as its EXIF has it (local time) — and the place's offset from UTC then [h] */
  taken: string;
  utcOffset: number;
  /** the lens' focal length, 35 mm equivalent [mm] */
  focal35: number;
}

export interface Landscape {
  /** the scene's name (presets' key): "Earth: …" */
  scene: string;
  title: string;
  description: string;
  icon: string;
  /** where the camera stands: latitude, east longitude [°] */
  at: [number, number];
  /** what the view is about: latitude, east longitude [°] (the photo's subject) */
  subject: [number, number];
  /** the view's direction [° from the north, eastwards]: the photo's heading; else the bearing to `subject` */
  heading?: number;
  /** the look above the level [°] */
  pitch: number;
  /** the scene's clouds (0: none — the photo's sky clear) */
  clouds?: number;
  photo: PhotoReference;
}

/** The vertical field of view [°] of a 35 mm equivalent focal length on a 3 : 2 frame (24 mm high). */
export function fovOf35mm(focal: number): number {
  return (2 * Math.atan(12 / focal) * 180) / Math.PI;
}

/** The photo's moment as a UTC timestamp [ms]: its local EXIF time less the place's offset. */
export function photoUtc(p: PhotoReference): number {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(p.taken);
  if (!m) throw new Error(`landscapes: bad time “${p.taken}”`);
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  return Date.UTC(y!, mo! - 1, d!, h!, mi!, s || 0) - p.utcOffset * 3600e3;
}

/** The great circle's initial bearing from a to b [° from the north, eastwards, 0 … 360). */
export function bearing(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const [p1, p2, dl] = [a[0] * r, b[0] * r, (b[1] - a[1]) * r];
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (((Math.atan2(y, x) / r) % 360) + 360) % 360;
}

/** The direction the view looks [°]. */
export const viewHeading = (l: Landscape) => l.heading ?? bearing(l.at, l.subject);

export const LANDSCAPES: Landscape[] = [];
