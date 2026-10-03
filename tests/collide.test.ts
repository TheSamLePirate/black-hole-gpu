import { test, expect } from "bun:test";
import { TriBVH } from "../src/system/collide";

// a field of random triangles; segments cast through it: the hierarchy's first hit is the brute force's
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

test("the hierarchy's first crossing is the brute force's", () => {
  const r = rng(7);
  const nt = 3000;
  const pos = new Float32Array(nt * 9);
  const tri = new Uint32Array(nt * 3);
  for (let i = 0; i < nt; i++) {
    const c = [r() * 100 - 50, r() * 100 - 50, r() * 100 - 50];
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) pos[9 * i + 3 * v + k] = c[k]! + (r() - 0.5) * 6;
    tri.set([3 * i, 3 * i + 1, 3 * i + 2], 3 * i);
  }
  const bvh = new TriBVH(pos, tri);
  const brute = (o: number[], e: number[]) => {
    let best = Infinity;
    const d = [e[0]! - o[0]!, e[1]! - o[1]!, e[2]! - o[2]!];
    for (let i = 0; i < nt; i++) {
      const a = [0, 1, 2].map((k) => pos[9 * i + k]!),
        b = [0, 1, 2].map((k) => pos[9 * i + 3 + k]!),
        c = [0, 1, 2].map((k) => pos[9 * i + 6 + k]!);
      const e1 = b.map((x, k) => x - a[k]!),
        e2 = c.map((x, k) => x - a[k]!);
      const h = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!, d[0]! * e2[1]! - d[1]! * e2[0]!];
      const det = e1[0]! * h[0]! + e1[1]! * h[1]! + e1[2]! * h[2]!;
      if (Math.abs(det) < 1e-14) continue;
      const s = o.map((x, k) => x - a[k]!);
      const u = (s[0]! * h[0]! + s[1]! * h[1]! + s[2]! * h[2]!) / det;
      if (u < 0 || u > 1) continue;
      const q = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
      const v = (d[0]! * q[0]! + d[1]! * q[1]! + d[2]! * q[2]!) / det;
      if (v < 0 || u + v > 1) continue;
      const t = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) / det;
      if (t >= 0 && t <= 1 && t < best) best = t;
    }
    return best;
  };
  let hits = 0;
  for (let k = 0; k < 400; k++) {
    const o: [number, number, number] = [r() * 120 - 60, r() * 120 - 60, r() * 120 - 60];
    const e: [number, number, number] = [o[0] + (r() - 0.5) * 60, o[1] + (r() - 0.5) * 60, o[2] + (r() - 0.5) * 60];
    const b = brute(o, e);
    const h = bvh.segment(o, e);
    if (b === Infinity) expect(h).toBeNull();
    else {
      hits++;
      expect(h!.t).toBeCloseTo(b, 5);
    }
  }
  expect(hits).toBeGreaterThan(30);
  // the vertices near a point: every vertex within the sphere is there
  const near = bvh.verticesNear([0, 0, 0], 10);
  for (let i = 0; i < nt * 3; i++) {
    if (Math.hypot(pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!) < 10) expect(near.has(i)).toBe(true);
  }
});
