// Paths on mapped taxiways. Local metres are used only for distances; heights stay with the WGS84 ground owner.
import { geoOf, headingOf, local, nearestOnEdges, route, type AirportNet } from "../game/airportnet";
import type { Plane } from "./feed";
export interface GroundPoint {
  x: number;
  y: number;
}
export interface GroundPose {
  over?: number;
  airborne?: boolean;
  vu?: number;
  lat: number;
  lon: number;
  ve: number;
  vn: number;
  omega: number;
  heading: number;
}
export interface GroundPath {
  points: GroundPoint[];
  distances: number[];
  length: number;
}
export function groundPath(points: GroundPoint[], radius = 12): GroundPath {
  const out: GroundPoint[] = [];
  if (points.length) out.push(points[0]!);
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!,
      b = points[i]!,
      c = points[i + 1]!;
    const l0 = Math.hypot(b.x - a.x, b.y - a.y),
      l1 = Math.hypot(c.x - b.x, c.y - b.y);
    if (l0 < 0.1 || l1 < 0.1) continue;
    const r = Math.min(radius, l0 / 3, l1 / 3);
    const p = { x: b.x + ((a.x - b.x) * r) / l0, y: b.y + ((a.y - b.y) * r) / l0 };
    const q = { x: b.x + ((c.x - b.x) * r) / l1, y: b.y + ((c.y - b.y) * r) / l1 };
    out.push(p);
    for (let k = 1; k <= 12; k++) {
      const u = k / 12;
      out.push({
        x: (1 - u) ** 2 * p.x + 2 * u * (1 - u) * b.x + u * u * q.x,
        y: (1 - u) ** 2 * p.y + 2 * u * (1 - u) * b.y + u * u * q.y,
      });
    }
  }
  if (points.length > 1) out.push(points.at(-1)!);
  const distances = [0];
  for (let i = 1; i < out.length; i++) distances.push(distances[i - 1]! + Math.hypot(out[i]!.x - out[i - 1]!.x, out[i]!.y - out[i - 1]!.y));
  return { points: out, distances, length: distances.at(-1) ?? 0 };
}
export function pathPoint(path: GroundPath, distance: number): GroundPoint {
  if (!path.points.length) return { x: 0, y: 0 };
  const d = Math.max(0, Math.min(path.length, distance));
  let i = 0;
  while (i < path.points.length - 2 && path.distances[i + 1]! < d) i++;
  const a = path.points[i]!,
    b = path.points[i + 1] ?? a;
  const u = (d - path.distances[i]!) / Math.max(0.001, (path.distances[i + 1] ?? d) - path.distances[i]!);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}
export function pathPose(net: AirportNet, path: GroundPath, distance: number, speed: number): GroundPose {
  const p = pathPoint(path, distance),
    a = pathPoint(path, distance - 1),
    b = pathPoint(path, distance + 1);
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const before = pathPoint(path, distance - 4),
    after = pathPoint(path, distance + 4);
  const h0 = headingOf(p.x - before.x, p.y - before.y),
    h1 = headingOf(after.x - p.x, after.y - p.y);
  const omega = ((((((h1 - h0 + 540) % 360) - 180) * Math.PI) / 180) * speed) / 4;
  return {
    ...geoOf(net.origin, p.x, p.y),
    ve: ((b.x - a.x) / length) * speed,
    vn: ((b.y - a.y) / length) * speed,
    omega,
    heading: headingOf(b.x - a.x, b.y - a.y),
  };
}
const routes = new WeakMap<AirportNet, Map<string, GroundPath | null>>();
/** Fill only a feasible, short ground gap. Disconnected data or an implausibly fast path stays unmodified. */
export function observedGround(net: AirportNet, hist: readonly Plane[], t: number): GroundPose | null {
  let i = 0;
  while (i + 1 < hist.length && hist[i + 1]!.t <= t) i++;
  const a = hist[i],
    b = hist[i + 1];
  if (!a || !b || !a.gnd || !b.gnd || t < a.t || b.t - a.t < 3 || b.t - a.t > 120 || Math.max(a.gs, b.gs) > 18) return null;
  const key = `${a.id}:${a.t}:${b.t}`;
  const cache = routes.get(net) ?? routes.set(net, new Map()).get(net)!;
  let path = cache.get(key);
  if (path === undefined) {
    const [ax, ay] = local(net.origin, a.lat, a.lon),
      [bx, by] = local(net.origin, b.lat, b.lon);
    const A = nearestOnEdges(net, ax, ay, 25),
      B = nearestOnEdges(net, bx, by, 25);
    path = null;
    if (A && B) {
      const same = A.e === B.e;
      const r = same ? null : route(net, A.d2a < A.d2b ? A.e.a : A.e.b, B.d2a < B.d2b ? B.e.a : B.e.b);
      if (same || (r && !r.crosses.length)) {
        const pts = same
          ? []
          : r!.pts.map((p) => {
              const [x, y] = local(net.origin, p.lat, p.lon);
              return { x, y };
            });
        const candidate = groundPath([{ x: ax, y: ay }, ...pts, { x: bx, y: by }], 6);
        if (candidate.length / (b.t - a.t) < 15 && candidate.length < 3000) path = candidate;
      }
    }
    if (cache.size > 200) cache.clear();
    cache.set(key, path);
  }
  if (!path) return null;
  const u = (t - a.t) / (b.t - a.t);
  // Cubic Hermite distance: endpoint speeds respected, constrained to a monotone path.
  const T = b.t - a.t,
    L = path.length;
  const v0 = Math.min(a.gs, (3 * L) / T),
    v1 = Math.min(b.gs, (3 * L) / T);
  const d = (-2 * u ** 3 + 3 * u * u) * L + (u ** 3 - 2 * u * u + u) * T * v0 + (u ** 3 - u * u) * T * v1;
  const v = ((-6 * u * u + 6 * u) * L + (3 * u * u - 4 * u + 1) * T * v0 + (3 * u * u - 2 * u) * T * v1) / T;
  return pathPose(net, path, d, Math.max(0, v));
}

/** Geometric runway exclusion, also for OSM ways that cross without sharing a graph node. */
export function crossesRunway(net: AirportNet, path: GroundPath, except?: AirportNet["runways"][number]): boolean {
  for (const r of net.runways) {
    if (r === except) continue;
    const dx = r.b.x - r.a.x,
      dy = r.b.y - r.a.y,
      L = Math.hypot(dx, dy);
    if (L < 1) continue;
    const ux = dx / L,
      uy = dy / L,
      width = r.width / 2 + 20;
    const project = (p: GroundPoint) => [(p.x - r.a.x) * ux + (p.y - r.a.y) * uy, (p.x - r.a.x) * uy - (p.y - r.a.y) * ux];
    for (let i = 1; i < path.points.length; i++) {
      const a = project(path.points[i - 1]!),
        b = project(path.points[i]!);
      let lo = 0,
        hi = 1;
      for (let k = 0; k < 2; k++) {
        const min = k === 0 ? -10 : -width,
          max = k === 0 ? L + 10 : width,
          d = b[k]! - a[k]!;
        if (Math.abs(d) < 1e-9) {
          if (a[k]! < min || a[k]! > max) {
            lo = 2;
            break;
          }
        } else {
          const x = (min - a[k]!) / d,
            y = (max - a[k]!) / d;
          lo = Math.max(lo, Math.min(x, y));
          hi = Math.min(hi, Math.max(x, y));
        }
      }
      if (lo <= hi && lo <= 1 && hi >= 0) return true;
    }
  }
  return false;
}
