// The system map's camera and projection (PLAN-VAISSEAUX K3): an orbit about the focus (yaw, pitch, a zoom), the true
// scale or a logarithmic one (the inner planets and the outer ones on one screen: distances from the focus
// compressed, f(r) = E·log₁₀(1 + 9r/E)), perspective. The scene's primitives projected to the screen — the lines'
// points, the spheres' discs (a few pixels at least), their depth (logarithmic: a solar system's range) and their light
// — for either renderer.

import type { V3 } from "../orbitmath";
import type { SystemScene } from "./scene";

export interface MapCamera {
  yaw: number;
  pitch: number;
  /** 1: the scene's extent fills the view; more: closer */
  zoom: number;
  log: boolean;
}
export const defaultCamera = (): MapCamera => ({ yaw: -0.6, pitch: 0.55, zoom: 1, log: false });

export interface ProjLine {
  /** screen points [px] and their depth (0 near … 1 far); null: a break (behind the eye) */
  pts: ([number, number, number] | null)[];
  colour: [number, number, number, number];
  width: number;
  dashed: boolean;
}
export interface ProjDisc {
  x: number;
  y: number;
  z: number;
  r: number;
  colour: [number, number, number];
  shade: "lit" | "star" | "hole" | "mouth";
  /** the light's direction on the screen (x right, y down, z toward the eye), unit */
  light: [number, number, number];
  id: string;
  name: string;
}
export interface ProjMark {
  x: number;
  y: number;
  z: number;
  label: string;
  colour: string;
  kind: string;
}
export interface Projected {
  lines: ProjLine[];
  discs: ProjDisc[];
  marks: ProjMark[];
  /** px per unit at the focus (true scale) — the scale bar's */
  k: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** The projection of a scene on a W×H view. */
export function project(sc: SystemScene, cam: MapCamera, W: number, H: number): Projected {
  const E = sc.extent;
  const f = sc.focus;
  // the scale: true, or each distance from the focus compressed
  const warp = (p: V3): V3 => {
    const d = sub(p, f);
    if (!cam.log) return d;
    const r = len(d);
    if (r < 1e-9) return d;
    const k = (E * Math.log10(1 + (9 * r) / E)) / r;
    return [d[0] * k, d[1] * k, d[2] * k];
  };
  // the eye: on a sphere about the focus (z up), looking at it
  const cy = Math.cos(cam.yaw),
    sy = Math.sin(cam.yaw),
    cp = Math.cos(cam.pitch),
    sp = Math.sin(cam.pitch);
  const fwd: V3 = [-cp * cy, -cp * sy, -sp];
  const right: V3 = [sy, -cy, 0];
  const up: V3 = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const dist = (E * 2.4) / cam.zoom;
  const eye: V3 = [-fwd[0] * dist, -fwd[1] * dist, -fwd[2] * dist];
  const fl = (0.5 * Math.min(W, H)) / Math.tan((40 * Math.PI) / 360);
  const near = dist * 1e-4,
    far = dist * 1e3;
  const lnRange = Math.log(far / near);
  const view = (q: V3): V3 => {
    const d = sub(q, eye);
    return [
      d[0] * right[0] + d[1] * right[1] + d[2] * right[2],
      d[0] * up[0] + d[1] * up[1] + d[2] * up[2],
      d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2],
    ];
  };
  const toScreen = (v: V3): [number, number, number] | null => {
    if (v[2] <= near) return null;
    return [W / 2 + (v[0] / v[2]) * fl, H / 2 - (v[1] / v[2]) * fl, Math.min(1, Math.max(0, Math.log(v[2] / near) / lnRange))];
  };
  const P = (p: V3) => toScreen(view(warp(p)));
  const lines: ProjLine[] = sc.lines.map((l) => ({ pts: l.pts.map(P), colour: l.colour, width: l.width, dashed: !!l.dashed }));
  // the light: from the star (our Sun, Gargantua's K2 — or the hole's own accretion: from above)
  const star = sc.spheres.find((s) => s.shade === "star");
  const discs: ProjDisc[] = [];
  for (const s of sc.spheres) {
    const c = view(warp(s.pos));
    const q = toScreen(c);
    if (!q) continue;
    // its screen radius: true, or under the log scale its own radius's stretch there
    let R = s.radius;
    if (cam.log) {
      const r = len(sub(s.pos, f));
      R = r > 1e-9 ? E * (Math.log10(1 + (9 * (r + s.radius)) / E) - Math.log10(1 + (9 * r) / E)) : s.radius;
    }
    const rpx = (R / c[2]) * fl;
    const min = s.shade === "star" ? 6 : s.shade === "hole" ? 5 : 3;
    let light: [number, number, number] = [0.4, -0.5, 0.75];
    if (star && star !== s) {
      const L = sub(view(warp(star.pos)), c);
      const n = len(L) || 1;
      light = [L[0] / n, -L[1] / n, -L[2] / n];
    }
    discs.push({ x: q[0], y: q[1], z: q[2], r: Math.max(rpx, min), colour: s.colour, shade: s.shade, light, id: s.id, name: s.name });
  }
  const marks: ProjMark[] = [];
  for (const m of sc.marks) {
    const q = P(m.pos);
    if (q) marks.push({ x: q[0], y: q[1], z: q[2], label: m.label, colour: m.colour, kind: m.kind });
  }
  return { lines, discs, marks, k: fl / dist };
}
