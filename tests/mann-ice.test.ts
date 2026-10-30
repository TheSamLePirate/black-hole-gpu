import { expect, test } from "bun:test";
import traceWGSL from "../src/shaders/trace.wgsl" with { type: "text" };
import { planetFrame, stepLocal, type LocalState } from "../src/landing";
import { MANN_CREVASSE_DEPTH, mannCloud, mannCrevasse, relief, SURF } from "../src/terrain";

type V3 = [number, number, number];
const unit = (v: V3): V3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const F = planetFrame("mann", 5000, 0.998, 1e8);
const mR = F.R * F.mPerM;

test("the crevasses' and clouds' constants are the tracer's (trace.wgsl)", () => {
  expect(Number(/const MANN_CREVASSE_DEPTH = ([\d.]+);/.exec(traceWGSL)![1])).toBe(MANN_CREVASSE_DEPTH);
  // (their noises' scales and offsets, the same)
  for (const k of ["q * 50000.0 + vec3f(11.0)", "q * 120.0 + vec3f(31.0)", "q * 900.0 + vec3f(7.0)", "q * 3000.0 + vec3f(5.0)"])
    expect(traceWGSL).toContain(k);
});

test("Mann's glaciers are cracked: crevasses a few metres wide, ~14 m deep, felt on foot", () => {
  // (along a line on the ground: the cracks met, their width and depth, as the walker's relief has them)
  let cracked = 0;
  let deepest = 0;
  let n = 0;
  for (let a = 0; a < 0.02; a += 2e-7) {
    const q = unit([Math.cos(a), Math.sin(a), 0.1]);
    const c = mannCrevasse(q, 0.3, 0.05, mR);
    if (c > 0.5) cracked++;
    deepest = Math.max(deepest, c);
    n++;
  }
  // (a few per cent of the line in cracks)
  expect(cracked / n).toBeGreaterThan(0.005);
  expect(cracked / n).toBeLessThan(0.15);
  expect(deepest).toBeGreaterThan(0.95);
  // (far — a footprint of a kilometre —: none drawn)
  expect(mannCrevasse(unit([1, 0.01, 0.1]), 0.3, 1000, mR)).toBe(0);
  // (the relief has them where the glaciers are: some point of the line lower than its neighbour 8 m on — or the line out of the
  // glaciers: a flat 0)
  let drop = 0;
  for (let a = 0; a < 0.002; a += 2e-7) {
    const q = unit([Math.cos(a), Math.sin(a), 0.1]);
    const q2 = unit([Math.cos(a + 1e-5), Math.sin(a + 1e-5), 0.1]);
    drop = Math.max(drop, relief(SURF.ice, q2, mR) - relief(SURF.ice, q, mR));
  }
  expect(drop).toBeGreaterThan(0);
});

test("Mann's frozen clouds: slabs ~2 km up, and a craft flown into one is struck", () => {
  let q: V3 | null = null;
  for (let a = 0; a < 3 && !q; a += 1e-3)
    for (let b = -1; b < 1 && !q; b += 0.05) {
      const p = unit([Math.cos(a), Math.sin(a), b]);
      if (mannCloud(p).mask > 0.9) q = p;
    }
  expect(q).not.toBeNull();
  const c = mannCloud(q!);
  expect(c.bottom).toBeGreaterThan(1300);
  expect(c.top).toBeLessThan(2600);
  expect(c.top - c.bottom).toBeGreaterThan(40);
  // (a craft in the slab's middle, moving at 100 m/s: struck)
  const r = F.R + (0.5 * (c.bottom + c.top)) / F.mPerM;
  const L: LocalState = { xi: [q![0] * r, q![1] * r, q![2] * r], w: [100 / 299792458, 0, 0], landed: false };
  const out = stepLocal(F, L, 1e-12, [0, 0, 0]);
  expect(out.cloud).toBe(true);
  expect(out.impact!).toBeGreaterThan(50);
});
