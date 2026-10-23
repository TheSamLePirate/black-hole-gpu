// The CameraController — the craft's own way over the Earth for the maps (docs/PLAN-RADAR-AAA.md RD15): its trace (a
// point a second, the last 15 minutes, its altitude with it — a jump of the place, a new trace) and the prediction of
// its path (the turn it flies now carried on: its track's rate, its ground speed, its climb; timed points) — the F-35's
// right panel's map, its full-screen map, the TSD, the crew's. Places over the WGS84 ellipsoid (its direct problem).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { wgs84Inverse, wgs84Offset } from "../system/ellipsoid";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    ownTrackStep: typeof ownTrackStep;
    ownPrediction: typeof ownPrediction;
  }
}

export interface TrackPoint {
  lat: number;
  lon: number;
  /** its altitude [m over the ellipsoid] */
  alt: number;
  /** its time [s of the flight's clock; a prediction's: from now] */
  t: number;
}

/** The trace's span [s] and spacing [s]; a jump between two points (a place set) that starts it afresh [m]. */
const SPAN = 900;
const EVERY = 1;
const JUMP = 5_000;

/** A frame of the trace: a point a second while over the Earth; the track's rate measured (smoothed). */
function ownTrackStep(this: CameraController, dt: number) {
  const g = this.geoNow();
  if (!g || !(dt > 0)) return;
  const T = this.ownTrack;
  T.clock += dt;
  // (the track's rate: from the last frame's, eased over a second — the turn carried on by the prediction)
  if (T.lastTrack !== null) {
    const d = Math.atan2(Math.sin(g.track - T.lastTrack), Math.cos(g.track - T.lastTrack));
    const r = g.gs > 20 ? d / dt : 0;
    T.rate += (r - T.rate) * Math.min(1, dt / 1);
  }
  T.lastTrack = g.track;
  const last = T.pts[T.pts.length - 1];
  if (last && T.clock - last.t < EVERY) return;
  if (last && wgs84Inverse(last.lat, last.lon, g.lat, g.lon).d > JUMP + g.gs * (T.clock - last.t)) T.pts.length = 0;
  T.pts.push({ lat: g.lat, lon: g.lon, alt: g.alt, t: T.clock });
  while (T.pts.length && T.clock - T.pts[0]!.t > SPAN) T.pts.shift();
}

/** The path ahead over `seconds` [s], a point each `step` [s] (from now: t 0 the craft): its turn carried on. */
function ownPrediction(this: CameraController, seconds: number, step: number): TrackPoint[] {
  const g = this.geoNow();
  if (!g) return [];
  const out: TrackPoint[] = [{ lat: g.lat, lon: g.lon, alt: g.alt, t: 0 }];
  // (a turn's rate at most 30°/s: a jink is not a path)
  const w = Math.max(-0.52, Math.min(0.52, this.ownTrack.rate));
  let lat = g.lat,
    lon = g.lon,
    trk = g.track;
  const n = Math.min(600, Math.ceil(seconds / step));
  for (let k = 1; k <= n; k++) {
    // (each step along the track at its middle — the arc's chord —, a few km at most: the ellipsoid's radii there)
    const mid = trk + (w * step) / 2;
    const d = g.gs * step;
    const q = wgs84Offset(lat, lon, Math.sin(mid) * d, Math.cos(mid) * d);
    lat = q.lat;
    lon = q.lon;
    trk += w * step;
    out.push({ lat, lon, alt: g.alt + g.vs * k * step, t: k * step });
  }
  return out;
}

export function installOwnTrack(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { ownTrackStep, ownPrediction });
}
