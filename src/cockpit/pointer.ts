// What the pointer is on in the Ranger's cabin (PLAN-COCKPIT K2): a pixel's ray against the controls' boxes
// (cockpit/controls.ts) and the cabin's faces (cockpit/pick.ts) — the nearest: a control, a screen (its
// display and the point on it), the cabin's walls, or nothing (the view out through the glass).

import type { TriBVH } from "../system/collide";
import { CONTROLS, controlBox, rayBox } from "./controls";
import { cabinHitOf } from "./pick";

type V3 = [number, number, number];

export type CockpitTarget =
  | { kind: "control"; id: string; t: number }
  | { kind: "screen"; slot: number; u: number; v: number; t: number }
  | { kind: "cabin"; t: number };

/** The first thing along the ray (o, unit d) in the cabin; null through the glass (or nothing loaded). */
export function cockpitTarget(o: V3, d: V3, hull: { bvh: TriBVH; verts: Float32Array } | null): CockpitTarget | null {
  let best: { id: string; t: number } | null = null;
  for (const c of CONTROLS) {
    const t = rayBox(o, d, controlBox(c));
    if (t !== null && (!best || t < best.t)) best = { id: c.id, t };
  }
  const h = hull ? cabinHitOf(o, d, hull.bvh, hull.verts) : null;
  // (a control before the cabin's face — its box stands out of the panel; the glass, 71, is seen through)
  if (best && (!h || best.t <= h.t + 0.005)) return { kind: "control", id: best.id, t: best.t };
  if (!h || h.mat === 71) return null;
  if (h.screen) return { kind: "screen", ...h.screen, t: h.t };
  return { kind: "cabin", t: h.t };
}
