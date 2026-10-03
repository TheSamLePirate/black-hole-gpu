// Beyond a predicted path in Gargantua's universe (the map's preview): patched conics (patched.ts),
// Newtonian — around Gargantua (GM = 1 M, stopped at its horizon), entering the Hill sphere of a
// planet (Miller, Mann), of Edmunds' star (then Edmunds), of the companion star. Far from the hole a
// fair sketch; near it (r ≲ 20 M) Kerr's orbits precess and plunge where a conic would not: the
// geodesic prediction stays the reference.

import type { Settings } from "../settings";
import type { V3 } from "../game/kepler";
import { GARGANTUA_SYSTEM } from "./bodies";
import { bodyTrack } from "./ephemeris";
import { bodyHill, bodyVelocity, starCentre, type Body } from "../targeting";
import { horizon as horizonR } from "../physics";
import { patchedConics, type Extension, type PatchedBody } from "./patched";

/** Gargantua's side as patched bodies at a time (the hole's flat map, the hole at the origin). */
export function theirBodies(s: Settings, t: number): Map<string, PatchedBody> {
  const out = new Map<string, PatchedBody>();
  out.set("hole", {
    id: "hole",
    parent: null,
    mass: 1,
    radius: horizonR(s.spin),
    soi: Infinity,
    state: () => ({ pos: [0, 0, 0], vel: [0, 0, 0] }),
  });
  if (s.sun && s.sunMass > 0) {
    out.set("star", {
      id: "star",
      parent: "hole",
      mass: s.sunMass,
      radius: s.sunRadius,
      soi: bodyHill(s, "star", t),
      state: (tt) => ({ pos: starCentre(s, tt), vel: bodyVelocity(s, "star", tt) }),
    });
  }
  if (s.system === "gargantua") {
    for (const b of GARGANTUA_SYSTEM.bodies) {
      if (b.universe !== "gargantua" || b.kind === "hole" || b.kind === "mouth" || !(b.mass > 0)) continue;
      const tr = bodyTrack(GARGANTUA_SYSTEM, b.id);
      out.set(b.id, {
        id: b.id,
        parent: b.parent === "gargantua" ? "hole" : b.parent,
        mass: b.mass,
        radius: b.radius,
        soi: bodyHill(s, b.id as Body, t),
        state: (tt) => ({ pos: tr.pos(tt), vel: tr.vel(tt) }),
      });
    }
  }
  return out;
}

/**
 * The conics from a state (the hole's flat map; coordinate velocity) for a while: 1.5 turns of a
 * bound orbit around the hole, else ten times what was predicted (at least 5 000 M).
 */
export function extendTheirs(s: Settings, X: V3, V: V3, t: number, predicted: number): Extension {
  const bodies = theirBodies(s, t);
  const r = Math.hypot(...X),
    v2 = V[0] ** 2 + V[1] ** 2 + V[2] ** 2;
  const eps = v2 / 2 - 1 / r;
  const horizon = eps < 0 ? Math.min(1.5 * 2 * Math.PI * (-1 / (2 * eps)) ** 1.5, 1e6) : Math.min(Math.max(10 * predicted, 5000), 1e6);
  // (the sphere it starts in: the smallest holding it)
  let ref = "hole",
    best = Infinity;
  for (const b of bodies.values()) {
    if (!b.parent) continue;
    const p = b.state(t).pos;
    if (Math.hypot(X[0] - p[0], X[1] - p[1], X[2] - p[2]) < b.soi && b.soi < best) (ref = b.id), (best = b.soi);
  }
  return patchedConics(bodies, X, V, t, ref, horizon, { maxPts: 700, rootApsides: true });
}
