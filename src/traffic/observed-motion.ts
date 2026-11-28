// Delayed observations constrain the animation; no invented route or departure without a future airborne report.
import type { Plane } from "./feed";
import type { GroundPose } from "./ground-path";
import type { RunwayFrame } from "../game/sites";
import { waysOf } from "./landing";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";
const D = Math.PI / 180;
const distance = (a: Plane, b: Plane) => Math.hypot((b.lat - a.lat) * 111132.95, (b.lon - a.lon) * 111319.49 * Math.cos(a.lat * D));
const fixed = (p: Plane) => geodeticToCart(WGS84_A, WGS84_F, p.lat * D, p.lon * D, 0);
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
/** Cubic distance/height with nonnegative endpoint slopes, bounded to the monotone Hermite region. */
export function motionBetween(length: number, seconds: number, speed0: number, speed1: number, elapsed: number) {
  const u = Math.max(0, Math.min(1, elapsed / seconds)),
    cap = (3 * length) / seconds;
  const a = Math.max(0, Math.min(cap, speed0)),
    b = Math.max(0, Math.min(cap, speed1));
  return {
    x: (-2 * u ** 3 + 3 * u * u) * length + (u ** 3 - 2 * u * u + u) * seconds * a + (u ** 3 - u * u) * seconds * b,
    v: ((-6 * u * u + 6 * u) * length + (3 * u * u - 4 * u + 1) * seconds * a + (3 * u * u - 2 * u) * seconds * b) / seconds,
  };
}
/** Reported stops remain stops despite metre-scale positional jitter. Never hold a moving or missing next sample. */
export function observedStop(hist: readonly Plane[], t: number): GroundPose | null {
  let i = 0;
  while (i + 1 < hist.length && hist[i + 1]!.t <= t) i++;
  const a = hist[i],
    b = hist[i + 1];
  if (!a || !b || t < a.t || b.t - a.t > 120 || !a.gnd || !b.gnd || a.gs > 0.2 || b.gs > 0.2 || distance(a, b) > 12) return null;
  let anchor = a;
  for (let j = i - 1; j >= 0; j--) {
    const p = hist[j]!;
    if (!p.gnd || p.gs > 0.2 || anchor.t - p.t > 120 || distance(p, a) > 12) break;
    anchor = p;
  }
  return { lat: anchor.lat, lon: anchor.lon, ve: 0, vn: 0, omega: 0, heading: anchor.hdg ?? anchor.trk };
}
/** A known ground → air interval on one runway. Height and climb at the future observation locate lift-off;
 * the early part remains a roll. Outside conservative gates, retain the ordinary observation fit. */
export function observedDeparture(
  hist: readonly Plane[],
  t: number,
  runways: readonly RunwayFrame[],
  rest: (lat: number, lon: number) => number,
): GroundPose | null {
  let i = 0;
  while (i + 1 < hist.length && hist[i + 1]!.t <= t) i++;
  const a = hist[i],
    b = hist[i + 1];
  if (!a || !b || t < a.t || !a.gnd || b.gnd || b.vs < 1 || b.gs < 40 || a.gs < 15 || b.gs < a.gs) return null;
  const T = b.t - a.t;
  if (T < 5 || T > 90) return null;
  const height = b.alt - rest(b.lat, b.lon);
  if (height < 1 || height > 400) return null;
  const flight = height / b.vs + 1;
  if (flight < 1 || flight > T * 0.8) return null;
  const pa = fixed(a),
    pb = fixed(b);
  for (const R of runways)
    for (const w of waysOf(R)) {
      if (angle(a.trk, w.hdg) > 12 || angle(b.trk, w.hdg) > 15) continue;
      const da = pa.map((x, j) => x - w.o[j]!),
        db = pb.map((x, j) => x - w.o[j]!);
      const aa = dot(da, w.d),
        ab = dot(db, w.d),
        ca = dot(da, w.r),
        cb = dot(db, w.r);
      if (aa < 0 || aa > w.len || ab <= aa || ab > w.len + 2000 || Math.abs(ca) > w.halfWidth + 15 || Math.abs(cb) > 100) continue;
      const acceleration0 = (6 * (ab - aa)) / (T * T) - (4 * a.gs + 2 * b.gs) / T;
      const acceleration1 = (-6 * (ab - aa)) / (T * T) + (2 * a.gs + 4 * b.gs) / T;
      if (Math.max(Math.abs(acceleration0), Math.abs(acceleration1)) > 4) continue;
      const elapsed = t - a.t,
        horizontal = motionBetween(ab - aa, T, a.gs, b.gs, elapsed);
      const lift = T - flight,
        airborne = elapsed > lift;
      const vertical = airborne ? motionBetween(height, flight, 0, b.vs, elapsed - lift) : { x: 0, v: 0 };
      const cross = ca + ((cb - ca) * elapsed) / T;
      const p = w.o.map((x, j) => x + w.d[j]! * (aa + horizontal.x) + w.r[j]! * cross);
      const g = cartToGeodetic(WGS84_A, WGS84_F, p as [number, number, number]);
      const lateral = (cb - ca) / T,
        hdg = w.hdg * D;
      return {
        lat: g.lat / D,
        lon: g.lon / D,
        over: vertical.x,
        airborne,
        vu: vertical.v,
        ve: Math.sin(hdg) * horizontal.v + Math.cos(hdg) * lateral,
        vn: Math.cos(hdg) * horizontal.v - Math.sin(hdg) * lateral,
        omega: 0,
        heading: w.hdg,
      };
    }
  return null;
}
