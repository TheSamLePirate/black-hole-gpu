// An entry's frame, from a description that crosses to the planner's worker (entry.ts EntryEnv): our
// side, a body of the solar system at a time (its home axes centred on it — not turning: the ground
// turns in them); Gargantua's side, one of its worlds at a time (its own turning frame: the ground at
// rest, the primary's tide and the frame's terms in its gravity). SI.

import type { EntryEnv } from "./entry";
import type { V3 } from "./aero";
import { M_METRES, solarBody, spinVector } from "./system/solar";
import { localAccel, planetFrame } from "./landing";
import { C_MPS } from "./units";
import { cross } from "./math/vec3";
import { cartToGeodetic, flatteningOf, geodeticNormal, radiusAtHeight } from "./system/ellipsoid";

export type EnvDesc =
  | { universe: "ours"; body: string; t: number; massSolar: number }
  | { universe: "gargantua"; body: string; t: number; spin: number; massSolar: number };

const C = C_MPS;

/** v turned about a unit axis by an angle. */
function rot(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a),
    s = Math.sin(a),
    d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
}

export function envOf(d: EnvDesc): EntryEnv | null {
  const Msec = 4.925490947e-6 * d.massSolar;
  if (d.universe === "ours") {
    const b = solarBody(d.body);
    if (!b || b.kind === "star") return null;
    const mu = b.mass * M_METRES * C * C;
    const s = spinVector(b, d.t);
    const w: V3 = [s[0] / Msec, s[1] / Msec, s[2] / Msec];
    const wl = Math.hypot(...w);
    const wa: V3 = wl > 0 ? [w[0] / wl, w[1] / wl, w[2] / wl] : [0, 0, 1];
    // (the figure: the Earth's ellipsoid about its pole — the spin's axis —, a sphere's radius)
    const f = flatteningOf(b.id);
    const R = b.radius * M_METRES;
    const coordinates = (x: V3) => {
      const z = x[0] * wa[0] + x[1] * wa[1] + x[2] * wa[2];
      const equatorial = x.map((v, i) => v - z * wa[i]!) as V3;
      return { z, equatorial, rho: Math.hypot(...equatorial) };
    };
    return {
      R,
      alt:
        f > 0
          ? (x) => {
              const { rho, z } = coordinates(x);
              return cartToGeodetic(R, f, [rho, 0, z]).h;
            }
          : undefined,
      normal:
        f > 0
          ? (x) => {
              const { rho, z, equatorial } = coordinates(x);
              const n = geodeticNormal(R, f, [rho, 0, z]);
              return equatorial.map((v, i) => (rho > 1e-20 ? (v / rho) * n[0] : 0) + wa[i]! * n[2]) as V3;
            }
          : undefined,
      radiusAtHeight:
        f > 0
          ? (x, h) => {
              const { rho, z } = coordinates(x);
              return radiusAtHeight(R, f, [rho, 0, z], h);
            }
          : undefined,
      atm: b.atmosphere ?? null,
      gravity: (x) => {
        const r = Math.hypot(...x);
        const k = -mu / (r * r * r);
        return [x[0] * k, x[1] * k, x[2] * k];
      },
      ground: (x) => cross(w, x),
      carry: (p, dt) => rot(p, wa, wl * dt),
    };
  }
  const F = planetFrame(d.body, d.t, d.spin, d.massSolar);
  return {
    R: F.R * F.mPerM,
    atm: F.atm,
    gravity: (x, v) => {
      const a = localAccel(F, [x[0] / F.mPerM, x[1] / F.mPerM, x[2] / F.mPerM], [v[0] / C, v[1] / C, v[2] / C], [0, 0, 0], () => [0, 0, 0]);
      return [a[0] * F.aUnit, a[1] * F.aUnit, a[2] * F.aUnit];
    },
    ground: () => [0, 0, 0],
    carry: (p) => p,
  };
}
