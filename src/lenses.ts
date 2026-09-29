// The weak-field lenses added to Kerr along a massive body's path: the companion star (Gargantua's
// frame falling towards it) and Gargantua's planets — built from the settings alone, so that the page
// and the planner's worker (the free-fall path, off the frame loop) share them.

import type { Lens } from "./geodesic";
import type { Vec3 } from "./physics";
import type { Settings } from "./settings";
import { GARGANTUA_SYSTEM } from "./system/bodies";
import { bodyTrack } from "./system/ephemeris";
import { holeAcceleration, starCentre, starOrbitRadius, starVelocity } from "./targeting";

const lin = (a: Vec3, ka: number, b: Vec3, kb: number): Vec3 => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];

export function lensesOf(s: Settings): Lens | Lens[] | undefined {
  const list: Lens[] = [];
  if (s.sun && s.sunMass > 0) {
    const D3 = starOrbitRadius(s) ** 3;
    list.push({
      m: s.sunMass, R: s.sunRadius, centre: (t) => starCentre(s, t), velocity: (t) => starVelocity(s, t),
      // Gargantua orbits the centre of mass: its frame falls towards the star
      accel: (t) => holeAcceleration(s, t),
      accelRate: (t) => lin(starVelocity(s, t), s.sunMass / D3, [0, 0, 0], 0),
    });
  }
  if (s.system === "gargantua") {
    for (const b of GARGANTUA_SYSTEM.bodies) {
      if (b.universe !== "gargantua" || !(b.mass > 0) || b.kind === "hole") continue;
      const tr = bodyTrack(GARGANTUA_SYSTEM, b.id);
      list.push({ m: b.mass, R: b.radius, centre: tr.pos, velocity: tr.vel });
    }
  }
  if (!list.length) return undefined;
  return list.length === 1 ? list[0] : list;
}
