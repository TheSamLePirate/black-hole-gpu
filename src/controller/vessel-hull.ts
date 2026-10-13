// The landed vessel as an obstacle for the astronaut: its mesh's box (ship frame), placed on the body in
// metres — the walk, the camera and the exits keep out of it. Pure, so the tests hold it to its metres.
import type { Vec3 } from "../physics";
import { add, dot, scale, sub } from "../math/vec3";

/** The vessel's box on the body: its centre [m, the walk's frame], its axes there (unit), its half sizes [m]. */
export interface VesselHull {
  centre: Vec3;
  axes: [Vec3, Vec3, Vec3];
  half: Vec3;
}

/** The box [lo, hi] of the ship frame, placed by its origin and axes (in the walk's frame, metres). */
export function placeHull(origin: Vec3, axes: [Vec3, Vec3, Vec3], lo: Vec3, hi: Vec3): VesselHull {
  const mid: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const centre = add(add(add(origin, axes[0], mid[0]), axes[1], mid[1]), axes[2], mid[2]);
  return { centre, axes, half: [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2] };
}

/** How far the point p is outside the box [m] (0 inside). */
export function hullDistance(h: VesselHull, p: Vec3): number {
  const d = sub(p, h.centre);
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const o = Math.max(0, Math.abs(dot(d, h.axes[i]!)) - h.half[i]!);
    s += o * o;
  }
  return Math.sqrt(s);
}

/**
 * Does a standing capsule (feet at q, along up, radius r, height) meet the box? Its axis sampled every
 * quarter of its radius at most: an exact enough test for a box metres across against a 0.3 m capsule.
 */
export function capsuleInHull(h: VesselHull, q: Vec3, up: Vec3, radius = 0.3, height = 1.8): boolean {
  const n = Math.max(2, Math.ceil(height / (radius * 0.5)));
  for (let i = 0; i <= n; i++) {
    const y = radius + ((height - 2 * radius) * i) / n;
    if (hullDistance(h, add(q, up, Math.min(height - radius, y))) < radius) return true;
  }
  return false;
}

/** The point p pushed out of the box along the direction dir (unit) to `margin` outside it (p itself when outside). */
export function outOfHull(h: VesselHull, p: Vec3, dir: Vec3, margin = 0.6): Vec3 {
  if (hullDistance(h, p) >= margin) return p;
  // (the box's extent along dir bounds the push: a few steps of a quarter metre, then exact enough)
  const reach = h.half.reduce((a, half, i) => a + half * Math.abs(dot(dir, h.axes[i]!)), 0) * 2 + 2 * margin;
  for (let s = 0.25; s <= reach; s += 0.25) {
    const q = add(p, dir, s);
    if (hullDistance(h, q) >= margin) return q;
  }
  return add(p, scale(dir, reach), 1);
}
