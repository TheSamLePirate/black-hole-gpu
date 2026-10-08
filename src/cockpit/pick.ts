// What the pointer is on in the Ranger's cabin (PLAN-COCKPIT K2): a pixel's ray (ship.ts cabinRay) cast
// against the cabin's triangles (cockpitHull: the BVH the camera walks against) — the point, the face, its
// material, and on a screen (68) which display and where on it (its baked uv: 2 × the display + u, v).

import type { TriBVH } from "../system/collide";

type V3 = [number, number, number];

export interface CabinHit {
  /** the distance from the eye [m], the point and the face's normal (towards the eye) in the ship's frame */
  t: number;
  p: V3;
  n: V3;
  /** the material (scripts/build-cockpit.ts: 60 floor … 68 screens … 72 sticks) */
  mat: number;
  /** on a screen: its display (cockpitscreens.ts's slot) and the point on it, 0…1 */
  screen?: { slot: number; u: number; v: number };
}

/** The first cabin face along the ray (o, unit d), within `far` metres. */
export function cabinHitOf(o: V3, d: V3, bvh: TriBVH, verts: Float32Array, far = 8): CabinHit | null {
  const h = bvh.segment(o, [o[0] + d[0] * far, o[1] + d[1] * far, o[2] + d[2] * far]);
  if (!h) return null;
  const t = h.t * far;
  const a = bvh.tri[3 * h.tri]!,
    b = bvh.tri[3 * h.tri + 1]!,
    c = bvh.tri[3 * h.tri + 2]!;
  const mat = Math.round(verts[10 * a + 6]!);
  const s = h.n[0] * d[0] + h.n[1] * d[1] + h.n[2] * d[2] > 0 ? -1 : 1;
  const out: CabinHit = {
    t,
    p: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t],
    n: [h.n[0] * s, h.n[1] * s, h.n[2] * s],
    mat,
  };
  if (mat === 68) {
    const w0 = 1 - h.u - h.v;
    const x = w0 * verts[10 * a + 8]! + h.u * verts[10 * b + 8]! + h.v * verts[10 * c + 8]!;
    const y = w0 * verts[10 * a + 9]! + h.u * verts[10 * b + 9]! + h.v * verts[10 * c + 9]!;
    const slot = Math.floor(verts[10 * a + 8]! / 2);
    out.screen = { slot, u: Math.min(Math.max(x - 2 * slot, 0), 1), v: Math.min(Math.max(y, 0), 1) };
  }
  return out;
}
