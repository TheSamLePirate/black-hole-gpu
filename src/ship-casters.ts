// The craft's shadow map's second half (ship.ts — ship.wgsl lightClipB, trace.wgsl shipShadow: their shadows on the ground and the
// sea under them): without a carrier near, the group of casters on or near the ground that the view looks at. Until 24 Nov 2026 only
// the war's ground units (Sam, 6 Nov 2026: « ajoute les ombres »); now also the real traffic's airliners on the ground or low over it
// and the ships at sea (Sam, 24 Nov 2026: their instances had `shadow: false` — parked airliners and ships without a shadow). Its
// cost bounded: only those within `reach` of the camera, in front of it; one group — the caster nearest the view's centre and those
// about it —, its sphere at most `maxR` (a texel of the half's 2048 at most ~0.45 m), drawn each frame it holds any (ship.ts:
// `bound2`). Pure.

/** A craft drawn: its place in the camera's frame [m] (x right, y up, z ahead), its bounding radius [m], what it casts as: a ground
 *  unit (its group tight: 200 m), another caster on or near the ground (an airliner, a ship: its group 300 m), or none. */
export interface Caster {
  t: readonly number[];
  r: number;
  kind: "unit" | "craft" | null;
}

export const SHADOW_GROUP = {
  /** the casters asked about within this of the camera [m] */
  reach: 4000,
  /** about the one looked at: the ground units within this [m], the other casters within this [m] */
  unitSpan: 200,
  craftSpan: 300,
  /** the group's sphere at most this [m] (from the one looked at, out to a member's far edge) */
  maxR: 450,
} as const;

/** The group in the second half: the casters' indices — the one nearest the view's centre (the smallest angle off the camera's
 *  axis, in front, within reach) and those of its kind's span about it, none whose far edge lies beyond maxR of it. Empty: none. */
export function shadowGroup(
  list: readonly Caster[],
  o: { reach: number; unitSpan: number; craftSpan: number; maxR: number } = SHADOW_GROUP,
): Set<number> {
  const out = new Set<number>();
  let near = -1,
    best = Number.POSITIVE_INFINITY;
  list.forEach((c, i) => {
    if (!c.kind) return;
    const d = Math.hypot(c.t[0]!, c.t[1]!, c.t[2]!);
    if (d > o.reach || c.t[2]! <= 0) return;
    const off = Math.acos(Math.min(1, c.t[2]! / Math.max(d, 1e-9)));
    if (off < best) (best = off), (near = i);
  });
  if (near < 0) return out;
  const f = list[near]!;
  const span = f.kind === "unit" ? o.unitSpan : o.craftSpan;
  list.forEach((c, i) => {
    if (!c.kind) return;
    const d = Math.hypot(c.t[0]! - f.t[0]!, c.t[1]! - f.t[1]!, c.t[2]! - f.t[2]!);
    if (i === near || (d < span && d + c.r <= o.maxR)) out.add(i);
  });
  return out;
}
