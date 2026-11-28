import type { Plane } from "./feed";
const turn = (a: number, b: number, k: number) => (a + (((b - a + 540) % 360) - 180) * k + 360) % 360;
/** Kinematic observations at the SAME epoch as the delayed position. Missing headings stay missing. */
export function reportAt(hist: readonly Plane[], fallback: Plane, t: number): Plane {
  if (!hist.length) return fallback;
  let i = 0;
  while (i + 1 < hist.length && hist[i + 1]!.t <= t) i++;
  const a = hist[i]!;
  const b = hist[i + 1];
  if (t < a.t) return { ...a, hdg: null };
  if (!b || b.t - a.t > 120) return { ...a, hdg: t - a.t <= 15 ? a.hdg : null };
  const k = Math.min(1, (t - a.t) / Math.max(0.001, b.t - a.t));
  return {
    ...a,
    t,
    lat: a.lat + (b.lat - a.lat) * k,
    lon: ((turn(a.lon, b.lon, k) + 540) % 360) - 180,
    alt: a.alt + (b.alt - a.alt) * k,
    trk: turn(a.trk, b.trk, k),
    hdg: a.hdg !== null && b.hdg !== null ? turn(a.hdg, b.hdg, k) : null,
    gs: a.gs + (b.gs - a.gs) * k,
    vs: a.vs + (b.vs - a.vs) * k,
    roll: a.roll !== null && b.roll !== null ? a.roll + (b.roll - a.roll) * k : null,
  };
}
