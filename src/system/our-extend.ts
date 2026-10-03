// Beyond a predicted path in our universe (the map's preview): patched conics (patched.ts) through
// the solar system — the spheres a (m/M)^0.4 as elsewhere, taken at the path's end.

import type { V3 } from "../game/kepler";
import { SOLAR_BODIES, solarState } from "./solar";
import type { OurPath } from "./our-predict";
import { patchedConics, type Extension, type PatchedBody } from "./patched";
import { AU_M, M_METRES, M_SECONDS } from "../units";
import { len, sub } from "../math/vec3";

export type { Extension } from "./patched";

const BODY = new Map(SOLAR_BODIES.map((b) => [b.id, b]));

/** The solar system as patched bodies at a time (their spheres then). */
function ourBodies(t: number): Map<string, PatchedBody> {
  const out = new Map<string, PatchedBody>();
  for (const b of SOLAR_BODIES) {
    const p = b.parent ? BODY.get(b.parent)! : null;
    const soi = p ? len(sub(solarState(b.id, t).pos, solarState(p.id, t).pos)) * (b.mass / p.mass) ** 0.4 : Infinity;
    // (a planet: its band of distances from the Sun, a cheap test before its place is computed)
    let band: [number, number] | undefined;
    if (p?.id === "sun" && b.elements) {
      const a = b.elements[0]![0]! * (AU_M / M_METRES), e = b.elements[0]![1]!;
      band = [a * (1 - e) - 1.2 * soi, a * (1 + e) + 1.2 * soi];
    }
    out.set(b.id, { id: b.id, parent: b.parent, mass: b.mass, radius: b.radius, soi, band, state: (tt) => solarState(b.id, tt) });
  }
  return out;
}

/** A path continued after its end; null when it ends on a surface or in the wormhole. */
export function extendOurs(p: OurPath, horizon = extensionHorizon(p.refs[p.refs.length - 1] ?? "sun"), maxPts = 900): Extension | null {
  if (p.fate !== "continues" || p.pts.length < 2) return null;
  const n = p.pts.length - 1;
  return extendFrom(p.pts[n]!, p.vels[n]!, p.times[n]!, p.refs[n] ?? "sun", horizon, maxPts);
}

/** How far to look beyond a path ending in a body's sphere: a moon's 10 days, a planet's 40, the Sun's 2 years. */
export function extensionHorizon(ref: string) {
  const day = 86400 / M_SECONDS;
  const b = BODY.get(ref);
  return (!b?.parent ? 730 : b.parent === "sun" ? 40 : 10) * day;
}

/** The conics from a state (home frame) in a body's sphere of influence, for `horizon` of scene time. */
export function extendFrom(X0: V3, V0: V3, tStart: number, ref0: string, horizon: number, maxPts = 900): Extension {
  return patchedConics(ourBodies(tStart), X0, V0, tStart, ref0, horizon, { maxPts });
}
