// The planets' relief on the CPU: the same function as the tracer's (trace.wgsl: relief), so the
// ship stands on the ground that is drawn. Gradient noise on the PCG hash (32-bit integer
// arithmetic, as on the GPU); heights in metres above the sphere at a unit direction on the body's
// own axes (x away from its primary, y along its orbit, z north).

export type V3 = [number, number, number];

/** surface kinds, as the GPU body list numbers them */
export const SURF = { ocean: 0, ice: 1, rock: 2, gas: 3 } as const;

function pcg(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
const hash3u = (x: number, y: number, z: number) => pcg((x ^ pcg((y ^ pcg(z)) >>> 0)) >>> 0);

/** Gradient noise (the tracer's gnoise). */
export function gnoise(p: V3): number {
  const i = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  const f = [p[0] - i[0]!, p[1] - i[1]!, p[2] - i[2]!];
  const u = f.map((x) => x * x * x * (x * (x * 6 - 15) + 10));
  const n: number[] = [];
  for (let c = 0; c < 8; c++) {
    const o = [c & 1, (c >> 1) & 1, (c >> 2) & 1];
    const h = hash3u((i[0]! + o[0]!) >>> 0, (i[1]! + o[1]!) >>> 0, (i[2]! + o[2]!) >>> 0);
    const g = [h & 0x3ff, (h >>> 10) & 0x3ff, (h >>> 20) & 0x3ff].map((k) => (k * 2) / 1023 - 1);
    n.push(g[0]! * (f[0]! - o[0]!) + g[1]! * (f[1]! - o[1]!) + g[2]! * (f[2]! - o[2]!));
  }
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return 1.6 * mix(mix(mix(n[0]!, n[1]!, u[0]!), mix(n[2]!, n[3]!, u[0]!), u[1]!), mix(mix(n[4]!, n[5]!, u[0]!), mix(n[6]!, n[7]!, u[0]!), u[1]!), u[2]!);
}

function tfbm(p0: V3, oct: number): number {
  let p = p0;
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * gnoise(p);
    n += a;
    p = [p[0] * 2.03 + 1.7, p[1] * 2.03 + 9.2, p[2] * 2.03 + 3.1];
    a *= 0.5;
  }
  return s / n;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

const layerOct = (f: number, foot: number, mR: number, most: number) =>
  Math.min(Math.max(Math.trunc(Math.log2(mR / (f * 4 * Math.max(foot, 0.05)))), 0), most);

function ridged(p: V3, oct: number) {
  if (oct <= 0) return 0.5;
  const r = 1 - Math.abs(tfbm(p, oct));
  return r * r;
}

const sc = (q: V3, k: number, o = 0): V3 => [q[0] * k + o, q[1] * k + o, q[2] * k + o];

/**
 * The ground's height [m] at a unit direction on the body's axes, as the tracer draws it at a pixel
 * footprint `foot` [m] (the finest detail: 0.05 m) on a body of `mR` metres per radius. Miller: sea
 * level — its giant waves are drawn, not felt.
 */
export function relief(surf: number, q: V3, mR: number, foot = 0.05): number {
  if (surf === SURF.ice) {
    let h = (0.5 + 0.5 * tfbm(sc(q, 6), Math.max(layerOct(6, foot, mR, 5), 1))) * 1400;
    h += ridged(sc(q, 24, 5), layerOct(24, foot, mR, 4)) * 900;
    const oh = layerOct(300, foot, mR, 3);
    if (oh > 0) h += ridged(sc(q, 300, 2), oh) * 1500;
    const oc = layerOct(3000, foot, mR, 3);
    if (oc > 0) h += ridged(sc(q, 3000, 7), oc) * 300;
    const orc = layerOct(30000, foot, mR, 3);
    if (orc > 0) h += (0.5 + 0.5 * tfbm(sc(q, 30000), orc)) * 40;
    const ou = layerOct(300000, foot, mR, 2);
    if (ou > 0) h += (0.5 + 0.5 * tfbm(sc(q, 300000), ou)) * 4;
    return h;
  }
  if (surf === SURF.rock) {
    const base = 0.5 + 0.5 * tfbm(sc(q, 5), Math.max(layerOct(5, foot, mR, 5), 1));
    let h = base * 1000;
    const om = layerOct(300, foot, mR, 3);
    if (om > 0) h += smooth(0.55, 0.62, 0.5 + 0.5 * tfbm(sc(q, 300), om)) * 380;
    const oh = layerOct(3000, foot, mR, 3);
    if (oh > 0) h += (0.5 + 0.5 * tfbm(sc(q, 3000, 3), oh)) * 200;
    const ou = layerOct(300000, foot, mR, 2);
    if (ou > 0) h += (0.5 + 0.5 * tfbm(sc(q, 300000), ou)) * 3;
    const od = layerOct(30000, foot, mR, 1);
    if (od > 0) {
      const dune = 0.5 + 0.5 * Math.sin((q[0] * 0.6 + q[1] * 0.8) * 30000 + 4 * tfbm(sc(q, 80), 2));
      h += dune * 25 * smooth(0.45, 0.25, base);
    }
    return h;
  }
  return 0;
}
