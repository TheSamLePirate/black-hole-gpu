// The auroras of the other bodies (PLAN-AURORES-MAGNETOSPHERES AM2–AM3): what the shader reads of each, from the fields of AM0
// (system/magnetic-fields.ts) — one source, its WGSL copy held equal by tests/aurora-bodies.test.ts.
//
// Jupiter (AM3): its main oval is the footprint of the field lines from 25 R_J (JRM33 + the CON2020 disc), not a circle about
// a pole — the north one a kidney reaching the spin pole —; tabulated as a closed curve about its own centre: the centre's unit
// vector (body-fixed: x the prime meridian, y 90° east, z north) and the oval's angular radius [°] in 36 bins of the angle about
// it (from e1 = z × centre, towards e2 = centre × e1). Io's footprints north and south [lat, east lon in °] for its System III
// east longitude every 10°: the shader interpolates them at Io's place now (renderer: toBodyFixed).

import { footprint, latLon, MAGNETOSPHERES, ovalTable, type V3 } from "./magnetic-fields";

const D = Math.PI / 180;
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fromLatLon = (la: number, lo: number): V3 => [
  Math.cos(la * D) * Math.cos(lo * D),
  Math.cos(la * D) * Math.sin(lo * D),
  Math.sin(la * D),
];

export const OVAL_BINS = 36;

export interface PolarOval {
  centre: V3;
  /** the oval's angular radius about the centre [°], bin k at angle (k + ½)·10° from e1 */
  radius: number[];
}

/** the frame about a centre: e1 = z × c (or x × c near the pole), e2 = c × e1 */
export function ovalFrame(c: V3): [V3, V3] {
  const ref: V3 = Math.abs(c[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
  const e1 = unit(cross(ref, c));
  return [e1, cross(c, e1)];
}

/** a closed curve of footprints [lat, lon] about its centre, resampled to OVAL_BINS bins of angle */
export function polarOval(points: [number, number][]): PolarOval {
  const v = points.map(([la, lo]) => fromLatLon(la, lo));
  const c = unit(v.reduce<V3>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]));
  const [e1, e2] = ovalFrame(c);
  const polar = v
    .map((p) => ({ a: Math.atan2(dot(p, e2), dot(p, e1)), r: Math.acos(Math.min(1, dot(p, c))) / D }))
    .sort((x, y) => x.a - y.a);
  const radius: number[] = [];
  for (let k = 0; k < OVAL_BINS; k++) {
    const a = -Math.PI + ((k + 0.5) * 2 * Math.PI) / OVAL_BINS;
    // (linear between the two neighbours in angle, across ±π)
    let j = polar.findIndex((p) => p.a > a);
    if (j < 0) j = 0;
    const p1 = polar[j]!,
      p0 = polar[(j - 1 + polar.length) % polar.length]!;
    let a0 = p0.a,
      a1 = p1.a;
    if (a1 < a0) a1 += 2 * Math.PI;
    let aa = a;
    if (aa < a0) aa += 2 * Math.PI;
    const f = a1 > a0 ? (aa - a0) / (a1 - a0) : 0;
    radius.push(p0.r + (p1.r - p0.r) * f);
  }
  return { centre: c, radius };
}

/** Jupiter's main ovals north and south (traced from ovalL = 25 R_J, 72 field lines) */
export function jupiterOvals(): { north: PolarOval; south: PolarOval } {
  const T = ovalTable("jupiter", 72);
  const ok = (a: ([number, number] | null)[]) => a.filter((p): p is [number, number] => !!p);
  return { north: polarOval(ok(T.north)), south: polarOval(ok(T.south)) };
}

/** Io's footprints [lat, lon °] north and south for its System III east longitude 0, 10, … 350° (5.9 R_J) */
export function ioFootprints(): { north: [number, number][]; south: [number, number][] } {
  const J = MAGNETOSPHERES.jupiter;
  const r = J.footprints.find((f) => f.moon === "io")!.r;
  const north: [number, number][] = [],
    south: [number, number][] = [];
  for (let k = 0; k < OVAL_BINS; k++) {
    const L = k * 10 * D;
    const p: V3 = [r * Math.cos(L), r * Math.sin(L), 0];
    const n = footprint(J, p, true)!,
      s = footprint(J, p, false)!;
    north.push([...latLon(n)] as [number, number]);
    south.push([...latLon(s)] as [number, number]);
  }
  return { north, south };
}

/** an angular radius on an oval at a unit direction q (the shader's jupOvalX): its centre's distance minus q's [°] */
export function ovalInside(o: PolarOval, q: V3): number {
  const [e1, e2] = ovalFrame(o.centre);
  const a = Math.atan2(dot(q, e2), dot(q, e1));
  const u = ((a + Math.PI) / (2 * Math.PI)) * OVAL_BINS - 0.5;
  const i = Math.floor(u),
    f = u - i;
  const r0 = o.radius[(i + OVAL_BINS) % OVAL_BINS]!,
    r1 = o.radius[(i + 1) % OVAL_BINS]!;
  return r0 + (r1 - r0) * f - Math.acos(Math.min(1, dot(q, o.centre))) / D;
}

/** an oval's radius as a Fourier series in the angle about its centre: a0, then (a_k, b_k) for k = 1…8 — the shader's form (no
 *  table indexed in its loop: a dynamically indexed constant array went to private memory, the Apple compile never ended) */
export const OVAL_HARMONICS = 8;
export function ovalFourier(o: PolarOval): { a0: number; a: number[]; b: number[] } {
  const n = o.radius.length;
  const th = (k: number) => -Math.PI + ((k + 0.5) * 2 * Math.PI) / n;
  const a0 = o.radius.reduce((x, y) => x + y, 0) / n;
  const a: number[] = [],
    b: number[] = [];
  for (let k = 1; k <= OVAL_HARMONICS; k++) {
    let sa = 0,
      sb = 0;
    for (let i = 0; i < n; i++) {
      sa += o.radius[i]! * Math.cos(k * th(i));
      sb += o.radius[i]! * Math.sin(k * th(i));
    }
    a.push((2 * sa) / n);
    b.push((2 * sb) / n);
  }
  return { a0, a, b };
}
export function fourierRadius(f: { a0: number; a: number[]; b: number[] }, theta: number) {
  let r = f.a0;
  for (let k = 1; k <= f.a.length; k++) r += f.a[k - 1]! * Math.cos(k * theta) + f.b[k - 1]! * Math.sin(k * theta);
  return r;
}

let ioCache: ReturnType<typeof ioFootprints> | null = null;
/** Io's footprints now, for its System III east longitude [rad]: [north lat, north lon, south lat, south lon] [rad]
 *  (interpolated in the table, traced once on first use) */
export function ioFeet(lonRad: number): [number, number, number, number] {
  ioCache ??= ioFootprints();
  const u = ((((lonRad / D) % 360) + 360) % 360) / 10;
  const i0 = Math.floor(u) % OVAL_BINS,
    i1 = (i0 + 1) % OVAL_BINS,
    f = u - Math.floor(u);
  const at = (t: [number, number][]) => {
    const a = t[i0]!,
      b = [...t[i1]!] as [number, number];
    if (b[1] - a[1] > 180) b[1] -= 360;
    else if (a[1] - b[1] > 180) b[1] += 360;
    return [(a[0] + (b[0] - a[0]) * f) * D, (a[1] + (b[1] - a[1]) * f) * D];
  };
  const n = at(ioCache.north),
    s = at(ioCache.south);
  return [n[0]!, n[1]!, s[0]!, s[1]!];
}

/** the giants whose auroras the shader draws (AM3–AM4), their WGSL prefixes */
export const GIANTS = [
  ["jupiter", "JUP"],
  ["saturn", "SAT"],
  ["uranus", "URA"],
  ["neptune", "NEP"],
] as const;

/** a giant's main ovals north and south (traced from its ovalL, 72 field lines) */
export function giantOvals(body: (typeof GIANTS)[number][0]): { north: PolarOval; south: PolarOval } {
  if (body === "jupiter") return jupiterOvals();
  const T = ovalTable(body, 72);
  const ok = (a: ([number, number] | null)[]) => a.filter((p): p is [number, number] => !!p);
  return { north: polarOval(ok(T.north)), south: polarOval(ok(T.south)) };
}

/** the WGSL constants (trace.wgsl <PREFIX>_OVAL: GiantOval), for the source and its test */
export function giantsWgsl(): string {
  const v = (a: number[]) => `vec3f(${a.map((x) => x.toFixed(5)).join(", ")})`;
  const v4 = (a: number[]) => `vec4f(${a.map((x) => x.toFixed(4)).join(", ")})`;
  return GIANTS.map(([body, pre]) => {
    const o = giantOvals(body);
    const n = ovalFourier(o.north),
      s = ovalFourier(o.south);
    const half = (f: typeof n) =>
      `${f.a0.toFixed(4)}, ${v4(f.a.slice(0, 4))}, ${v4(f.a.slice(4, 8))}, ${v4(f.b.slice(0, 4))}, ${v4(f.b.slice(4, 8))}`;
    return `const ${pre}_OVAL = GiantOval(${v(o.north.centre)}, ${v(o.south.centre)}, ${half(n)}, ${half(s)});`;
  }).join("\n");
}
