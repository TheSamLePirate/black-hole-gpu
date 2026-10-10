// The shadows our bodies cast on one another, for the tracer (PLAN-CIEL C6: trace.wgsl bodyShadow): the
// Earth's on the Moon (a lunar eclipse — its air's red light in the umbra), a planet's on its moons (Io
// going dark in Jupiter's), a moon's on its planet (their black dots on Jupiter, Titan's on Saturn). Found
// each frame among the bodies drawn (their places as drawn — light-time retarded alike), the shadow
// falling on the receiver now; the nearest-looking first, SHADE_PAIRS at most. Each pair in the receiver's
// own turning axes (the tracer's spunAxes: its maps'), in its radii — the point shaded is its unit normal
// there: the occluder and the Sun from its centre, their radii; the receiver's index (+1) and whether the
// occluder has air that bends the Sun's light into its shadow (the Earth).
// The Moon's shadow on the Earth is the tracer's own (P.eclipse): not here.

import { solarBody } from "../system/solar";
import type { GpuBody } from "../system/scene-bodies";
import type { Vec3 } from "../physics";

export const SHADE_PAIRS = 3;
/** vec4s per pair: the occluder (centre, radius), the Sun (centre, radius), (receiver + 1, air, 0, 0) */
export const SHADE_VEC4S = 3 * SHADE_PAIRS;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** A body's turning axes (rows: x, y, its pole), as the tracer builds them (poleAxes, spunAxes). */
export function spunAxes(pole: Vec3, spin: number): [Vec3, Vec3, Vec3] {
  let ex: Vec3 = [pole[1], -pole[0], 0];
  const l = Math.hypot(ex[0], ex[1]);
  ex = l < 1e-4 ? [1, 0, 0] : [ex[0] / l, ex[1] / l, 0];
  const ey: Vec3 = [pole[1] * ex[2] - pole[2] * ex[1], pole[2] * ex[0] - pole[0] * ex[2], pole[0] * ex[1] - pole[1] * ex[0]];
  const c = Math.cos(spin),
    s = Math.sin(spin);
  return [
    [c * ex[0] + s * ey[0], c * ex[1] + s * ey[1], c * ex[2] + s * ey[2]],
    [-s * ex[0] + c * ey[0], -s * ex[1] + c * ey[1], -s * ex[2] + c * ey[2]],
    pole,
  ];
}

/** The pairs (receiver k, occluder j) whose shadow falls on the receiver now, nearest-looking first. */
export function activeShadows(list: GpuBody[], start: number, camera: Vec3, minAngle = 0): { r: number; o: number }[] {
  const sun = list.findIndex((b, k) => k >= start && b.id === "sun");
  if (sun < 0) return [];
  const S = list[sun]!.pos,
    Rs = list[sun]!.radius;
  const index = new Map<string, number>();
  list.forEach((b, k) => k >= start && index.set(b.id, k));
  const pairs: { r: number; o: number; score: number }[] = [];
  list.forEach((rb, r) => {
    if (r < start || rb.kind === 0 || rb.id === "earth" || rb.id === "sun") return;
    const parent = solarBody(rb.id)?.parent;
    const occ: number[] = [];
    if (parent && parent !== "sun" && index.has(parent)) occ.push(index.get(parent)!);
    for (const [id, k] of index) if (solarBody(id)?.parent === rb.id) occ.push(k);
    for (const o of occ) {
      const ob = list[o]!;
      const ax = sub(ob.pos, S);
      const D = len(ax);
      const u: Vec3 = [ax[0] / D, ax[1] / D, ax[2] / D];
      const v = sub(rb.pos, ob.pos);
      const z = dot(v, u);
      if (z <= 0) continue;
      const d = Math.hypot(v[0] - z * u[0], v[1] - z * u[1], v[2] - z * u[2]);
      // (the penumbra's radius there: the occluder's, grown by the Sun's disc past its limb)
      const pen = ob.radius + (z * (Rs + ob.radius)) / D;
      if (d >= pen + rb.radius) continue;
      // (a receiver too small to see from here left out: a pair kept turns the shadows' code on in the kernel)
      const score = rb.radius / Math.max(len(sub(rb.pos, camera)), 1e-30);
      if (score < minAngle) continue;
      pairs.push({ r, o, score });
    }
  });
  return pairs.sort((a, b) => b.score - a.score).slice(0, SHADE_PAIRS);
}

/** The pairs packed for the tracer (P.shade). */
export function shadowParams(list: GpuBody[], start: number, camera: Vec3, minAngle = 0): Float32Array {
  const out = new Float32Array(SHADE_VEC4S * 4);
  const sun = list.findIndex((b, k) => k >= start && b.id === "sun");
  activeShadows(list, start, camera, minAngle).forEach(({ r, o }, i) => {
    const rb = list[r]!,
      ob = list[o]!,
      sb = list[sun]!;
    const A = spunAxes(rb.pole ?? [0, 0, 1], rb.spin ?? 0);
    const local = (p: Vec3): Vec3 => {
      const v = sub(p, rb.pos);
      return [dot(A[0], v) / rb.radius, dot(A[1], v) / rb.radius, dot(A[2], v) / rb.radius];
    };
    // (the Earth's shadow as Danjon's rule draws it — its radius at 45° of latitude, grown by its air: NASA's)
    const Ro = ob.id === "earth" ? ob.radius * 0.99834 * (1 + 1 / 85) : ob.radius;
    out.set([...local(ob.pos), Ro / rb.radius], 12 * i);
    out.set([...local(sb.pos), sb.radius / rb.radius], 12 * i + 4);
    out.set([r + 1, ob.id === "earth" ? 1 : 0, 0, 0], 12 * i + 8);
  });
  return out;
}

/** The tracer's discShare: the share of a disc of angular radius rs left by one of radius ro, d apart. */
function discShare(rs: number, ro: number, d: number): number {
  if (d >= rs + ro) return 1;
  if (d <= Math.abs(ro - rs)) return ro >= rs ? 0 : 1 - (ro * ro) / (rs * rs);
  const k1 = Math.min(Math.max((d * d + rs * rs - ro * ro) / (2 * d * rs), -1), 1);
  const k2 = Math.min(Math.max((d * d + ro * ro - rs * rs) / (2 * d * ro), -1), 1);
  const k3 = Math.max((-d + rs + ro) * (d + rs - ro) * (d - rs + ro) * (d + rs + ro), 0);
  return Math.min(Math.max(1 - (rs * rs * Math.acos(k1) + ro * ro * Math.acos(k2) - 0.5 * Math.sqrt(k3)) / (Math.PI * rs * rs), 0), 1);
}

/** The tracer's earthRingLight (its five points of the Sun's disc), its luminance: the Sun's light the
 *  Earth's air bends into its shadow. */
function earthRingY(d: number, rs: number, ro: number): number {
  const H = 8.4,
    R = 6371,
    A0 = 0.0205;
  const tauR = [0.065, 0.099, 0.197],
    tauO = [0.042, 0.027, 0.005],
    Y = [0.2126, 0.7152, 0.0722];
  let L = 0;
  for (const [a, b] of [
    [0, 0],
    [0.7, 0],
    [-0.7, 0],
    [0, 0.7],
    [0, -0.7],
  ] as const) {
    const dj = Math.hypot(d + a * rs, b * rs);
    for (const sg of [1, -1]) {
      const need0 = ro - sg * dj;
      if (need0 >= A0 || need0 <= 0) continue;
      let h = H * Math.log(A0 / need0);
      for (let i = 0; i < 3; i++) {
        const f = ro * (1 + h / R) - sg * dj - A0 * Math.exp(-h / H);
        const df = ro / R + (A0 / H) * Math.exp(-h / H);
        h = Math.min(Math.max(h - f / df, 0), 80);
      }
      const alpha = A0 * Math.exp(-h / H);
      const phi = (0.5 * (ro / Math.max(dj, rs))) / (1 + (alpha * (R / H)) / ro);
      const x = Math.min(Math.max((h - 22) / 18, 0), 1);
      const oz = 1 - x * x * (3 - 2 * x);
      for (let c = 0; c < 3; c++)
        L += 0.2 * Y[c]! * phi * Math.exp(-(tauR[c]! * 70.7 * Math.exp(-h / H) + 0.03 * 183 * Math.exp(-h / 1.2) + tauO[c]! * 25 * oz));
    }
  }
  return L;
}

/**
 * The Moon's sunlight left by the Earth's shadow (a lunar eclipse), over its disc (nine points): 1 outside
 * it, ~10⁻⁴ in the umbra's heart — the moonlight the Earth's night receives dimmed alike (the sky darkening
 * at the totality, its stars out). Places [any unit, the same], radii in it.
 */
export function moonLightShare(E: Vec3, M: Vec3, S: Vec3, RE: number, RM: number, RS: number): number {
  const ax = sub(M, S);
  const u: Vec3 = [ax[0] / len(ax), ax[1] / len(ax), ax[2] / len(ax)];
  // (two directions across the line of the light at the Moon)
  let a: Vec3 = [u[1], -u[0], 0];
  if (len(a) < 1e-6) a = [1, 0, 0];
  a = [a[0] / len(a), a[1] / len(a), a[2] / len(a)];
  const b: Vec3 = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]];
  let sum = 0,
    n = 0;
  for (const [i, j] of [
    [0, 0],
    [0.7, 0],
    [-0.7, 0],
    [0, 0.7],
    [0, -0.7],
    [0.5, 0.5],
    [-0.5, 0.5],
    [0.5, -0.5],
    [-0.5, -0.5],
  ] as const) {
    const p: Vec3 = [M[0] + RM * (i * a[0] + j * b[0]), M[1] + RM * (i * a[1] + j * b[1]), M[2] + RM * (i * a[2] + j * b[2])];
    const o = sub(E, p),
      s = sub(S, p);
    const dO = len(o),
      dS = len(s);
    const c = Math.min(Math.max(dot(o, s) / (dO * dS), -1), 1);
    const d = Math.acos(c);
    const rs = Math.asin(Math.min(RS / dS, 1)),
      ro = Math.asin(Math.min(RE / dO, 1));
    sum += d >= rs + ro || dO >= dS ? 1 : Math.min(discShare(rs, ro, d) + earthRingY(d, rs, ro), 1);
    n++;
  }
  return sum / n;
}
