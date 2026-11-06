// The magnetospheres drawn as a diagram (PLAN-AURORES-MAGNETOSPHERES AM7, § 7.7): field lines on L-shells traced in the
// real field (system/magnetic-fields.ts, AM0: IGRF-14, JRM33 + CON2020, Cassini 11…), the magnetopause (Shue et al. 1998)
// and the bow shock (a conic, eccentricity 0.81 — Farris 1991) about the Sun's direction. A diagram, labelled as such: the
// lines are the field's, their shells chosen to show it, the boundaries the typical ones (no solar-wind deformation yet).
//
// Field lines: in the body's own axes (x its prime meridian, y 90° east, z north), in its radii; each shell L started at its
// dipole's equator, 8 longitudes (the odd shells half a step off), traced both ways to the figure (or out to 4 L + 4),
// resampled to 160 points evenly along it (Catmull–Rom), with log |B| at each (its colour). Traced once per body, the first
// time it is asked (a worker later).

import { MAGNETOSPHERES, type MagBody, magnetopause, trace, type V3 } from "./magnetic-fields";

/** the shells drawn [radii] (Alex's § 7.7 choices) */
export const SHELLS: Partial<Record<MagBody, number[]>> = {
  earth: [1.5, 2.2, 3, 4, 5.5, 7, 9],
  jupiter: [1.8, 3, 5.9, 9.4, 15, 26, 40],
  saturn: [1.5, 2.5, 4, 6, 9, 14, 20],
  uranus: [1.5, 2.5, 4, 6, 9],
  neptune: [1.5, 2.5, 4, 6, 9],
  mercury: [1.1, 1.3, 1.6],
  ganymede: [1.2, 1.5, 1.8],
};

/** the glowing layers' volumes per body (overlay.wgsl fsMagVol): the radiation belts' L — inner (protons), outer (electrons)
 *  — and strengths [per radius of path], a plasma torus's radius and strength (Io's, at Jupiter). A diagram's choices from the
 *  belts' known places (the Earth's Van Allen belts at L ~1.5 and ~4.5; Jupiter's synchrotron belt inside 2 R_J, Io's torus at
 *  5.9), not measured intensities */
export const VOLUMES: Partial<Record<MagBody, { inner: number; outer: number; si: number; so: number; torus: number; st: number }>> = {
  earth: { inner: 1.6, outer: 4.5, si: 0.35, so: 0.16, torus: 0, st: 0 },
  jupiter: { inner: 1.6, outer: 0, si: 0.3, so: 0, torus: 5.9, st: 0.55 },
  saturn: { inner: 2.6, outer: 6, si: 0.25, so: 0.15, torus: 4.0, st: 0.25 },
  uranus: { inner: 2.2, outer: 5, si: 0.3, so: 0.2, torus: 0, st: 0 },
  neptune: { inner: 2.2, outer: 5, si: 0.3, so: 0.2, torus: 0, st: 0 },
  mercury: { inner: 0, outer: 0, si: 0, so: 0, torus: 0, st: 0 },
  ganymede: { inner: 0, outer: 0, si: 0, so: 0, torus: 0, st: 0 },
};

export interface FieldLine {
  L: number;
  points: V3[];
  /** log10 |B| [nT] at each point (the colour: the field's strength along the line) */
  logB: number[];
  /** the normal of its meridian plane (the dipole's axis × its start): a loop seen edge-on fades */
  normal: V3;
}

const cache = new Map<MagBody, FieldLine[]>();
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** resampled to n points evenly along its length, Catmull–Rom between the traced ones (no polygonal kinks) */
function smooth(p: V3[], n: number): V3[] {
  if (p.length < 3) return p;
  const cum = [0];
  for (let i = 1; i < p.length; i++)
    cum.push(cum[i - 1]! + Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1], p[i]![2] - p[i - 1]![2]));
  const total = cum[cum.length - 1]!;
  const out: V3[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const d = (k / (n - 1)) * total;
    while (j < p.length - 2 && cum[j + 1]! < d) j++;
    const t = (d - cum[j]!) / Math.max(cum[j + 1]! - cum[j]!, 1e-12);
    const p0 = p[Math.max(j - 1, 0)]!,
      p1 = p[j]!,
      p2 = p[j + 1]!,
      p3 = p[Math.min(j + 2, p.length - 1)]!;
    const t2 = t * t,
      t3 = t2 * t;
    out.push(
      [0, 1, 2].map(
        (i) =>
          0.5 *
          (2 * p1[i]! +
            (-p0[i]! + p2[i]!) * t +
            (2 * p0[i]! - 5 * p1[i]! + 4 * p2[i]! - p3[i]!) * t2 +
            (-p0[i]! + 3 * p1[i]! - 3 * p2[i]! + p3[i]!) * t3),
      ) as V3,
    );
  }
  return out;
}

/** the field lines of a body's shells (cached) */
export function fieldLines(body: MagBody): FieldLine[] {
  const hit = cache.get(body);
  if (hit) return hit;
  const M = MAGNETOSPHERES[body];
  const z = M.model.dipoleNorth;
  const ref: V3 = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = unit(cross(ref, z));
  const e2 = cross(z, e1);
  const out: FieldLine[] = [];
  (SHELLS[body] ?? []).forEach((L, s) => {
    for (let k = 0; k < 8; k++) {
      const a = ((k + (s % 2 ? 0.5 : 0)) * 2 * Math.PI) / 8;
      const start: V3 = [
        L * (Math.cos(a) * e1[0] + Math.sin(a) * e2[0]),
        L * (Math.cos(a) * e1[1] + Math.sin(a) * e2[1]),
        L * (Math.cos(a) * e1[2] + Math.sin(a) * e2[2]),
      ];
      const o = { step: 0.01, maxSteps: 1600 };
      const up = trace(M, start, 1, o).points,
        down = trace(M, start, -1, o).points;
      const points = smooth([...down.reverse(), ...up.slice(1)], 160);
      const logB = points.map((q) => Math.log10(Math.max(Math.hypot(...M.model.field(q)), 1e-3)));
      out.push({ L, points, logB, normal: unit(cross(z, start)) });
    }
  });
  cache.set(body, out);
  return out;
}

/** the magnetopause's and the bow shock's outlines seen from `view` (the direction from the camera to the body, unit), about the
 *  Sun's direction `sun` (unit, the same frame), in the body's radii: each surface's silhouette — its profile in the plane
 *  holding the Sun's direction, across the line of sight (exact for a surface of revolution seen from afar) — the textbook
 *  outline, not a wireframe */
export function boundaries(body: MagBody, sun: V3, view: V3): { magnetopause: V3[]; shock: V3[] } {
  const M = MAGNETOSPHERES[body];
  const s = unit(sun);
  // (across the line of sight, in the Sun's plane: the view's part perpendicular to the Sun's direction × the Sun's)
  let w = cross(s, view);
  if (Math.hypot(...w) < 1e-6) w = cross(s, Math.abs(s[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
  const u = unit(w);
  const profile = (r: (th: number) => number, thMax: number) => {
    const line: V3[] = [];
    for (let i = -60; i <= 60; i++) {
      const th = (i / 60) * thMax;
      const rr = r(Math.abs(th));
      line.push([0, 1, 2].map((k) => rr * (Math.cos(th) * s[k]! + Math.sin(th) * u[k]!)) as V3);
    }
    return line;
  };
  const mp = (th: number) => magnetopause(M.standoff, M.flaring, Math.cos(th));
  // (the shock: r = R(1 + e)/(1 + e cos θ), e = 0.81 — out to 125°, before it opens)
  const sh = (th: number) => (M.shock * 1.81) / (1 + 0.81 * Math.cos(th));
  return { magnetopause: profile(mp, 2.5), shock: profile(sh, 2.18) };
}
