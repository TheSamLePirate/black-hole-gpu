// The taxi's guidance (docs/PLAN-A320.md, A14): where the aircraft is on its route (game/airportnet.ts) — the leg
// it rolls on (never going back), its distance off the line —, the next turn (its side, its angle, the taxiway it
// leads onto, how far), the speed to roll at (30 kt straight, 10 kt into a turn, 5 kt the last metres to a stand or a
// holding point), the route done. Pure.

import { type TaxiRoute, headingOf, local } from "./airportnet";

export interface TaxiCue {
  /** the leg rolled on (the route's point it started from) */
  i: number;
  /** off the line [m, right > 0], what is left of the route [m] */
  xtrack: number;
  toEnd: number;
  /** the next turn: its side, its angle [°], the taxiway after it (none: the route's end), its distance [m] */
  next: { turn: "left" | "right"; deg: number; name: string | null; dist: number } | null;
  /** the speed to roll at [kt] */
  adviseKt: number;
  /** at the route's end (within 12 m) */
  done: boolean;
}

/** The cue at a place: from the leg `prevI` on (the next ones searched within 60 m of the line). */
export function taxiCue(r: TaxiRoute, at: { lat: number; lon: number }, prevI = 0): TaxiCue {
  const O = r.pts[0]!;
  const P = r.pts.map((p) => local(O, p.lat, p.lon));
  const [x, y] = local(O, at.lat, at.lon);
  const n = P.length;
  // (the leg: the nearest from the last one on, forwards)
  let i = Math.min(Math.max(prevI, 0), Math.max(n - 2, 0)),
    best = Infinity,
    bu = 0,
    bx = 0;
  for (let k = i; k < n - 1; k++) {
    const [ax, ay] = P[k]!,
      [cx, cy] = P[k + 1]!;
    const vx = cx - ax,
      vy = cy - ay;
    const L2 = vx * vx + vy * vy || 1;
    const u = Math.min(Math.max(((x - ax) * vx + (y - ay) * vy) / L2, 0), 1);
    const d = Math.hypot(ax + vx * u - x, ay + vy * u - y);
    if (d < best - 0.5) {
      best = d;
      i = k;
      bu = u;
      bx = ((x - ax) * vy - (y - ay) * vx) / Math.sqrt(L2);
    }
    if (d > best + 60) break;
  }
  const seg = (k: number) => Math.hypot(P[k + 1]![0] - P[k]![0], P[k + 1]![1] - P[k]![1]);
  const left = n > 1 ? seg(i) * (1 - bu) : 0;
  let toEnd = left;
  for (let k = i + 1; k < n - 1; k++) toEnd += seg(k);
  // (the next turn: the first vertex ahead where the track turns by 25° or more — the short legs of a curve summed)
  let next: TaxiCue["next"] = null;
  let dist = left;
  for (let k = i + 1; k < n - 1 && dist < 1500; k++) {
    const h0 = headingOf(P[k]![0] - P[k - 1]![0], P[k]![1] - P[k - 1]![1]);
    // (the turn over the next 40 m of track)
    let j = k,
      run = 0;
    while (j < n - 1 && run < 40) run += seg(j++);
    const h1 = headingOf(P[j]![0] - P[j - 1]![0], P[j]![1] - P[j - 1]![1]);
    const deg = ((h1 - h0 + 540) % 360) - 180;
    if (Math.abs(deg) >= 25) {
      next = { turn: deg > 0 ? "right" : "left", deg: Math.abs(deg), name: r.names[k] ?? null, dist };
      break;
    }
    dist += seg(k);
  }
  const done = toEnd < 12;
  const adviseKt = done ? 0 : toEnd < 60 ? 5 : next && next.deg >= 30 && next.dist < 80 ? 10 : 30;
  return { i, xtrack: bx, toEnd, next, adviseKt, done };
}
