import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { airlessRocks, craterRelief } from "../src/terrain";

// The airless worlds' rocks (trace.wgsl airlessRocks, terrain.ts the same in float64 — the walker and the gear on them):
// boulders and cobbles on lattices of 8 and 2 m cells on the face of the cube the point is on, pebbles of 0.5 m cells for the
// shading; each rock wholly inside its cell (no seam), none by a face's edge, more where a fresh crater threw its ejecta.

const mR = 1.7374e6;
const unit = (a: number[]): [number, number, number] => {
  const l = Math.hypot(...a);
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};
/** a point dx, dy metres east and north of a reference direction (small offsets on the tangent plane) */
const at = (q0: [number, number, number], dx: number, dy: number) => {
  const e = unit([-q0[1], q0[0], 0]);
  const n = [q0[1] * e[2] - q0[2] * e[1], q0[2] * e[0] - q0[0] * e[2], q0[0] * e[1] - q0[1] * e[0]];
  return unit([0, 1, 2].map((i) => q0[i]! + (dx * e[i]! + dy * n[i]!) / mR));
};

test("rocks: blocks up to ~2 m, cobbles, the ground continuous across the cells — no seam, no cut rock", () => {
  const q0 = unit([0.3, 0.2, 0.93]);
  let hi = 0,
    rocks = 0,
    jump = 0;
  for (let row = 0; row < 40; row++) {
    let last = Number.NaN;
    for (let i = 0; i <= 4000; i++) {
      const h = airlessRocks(at(q0, i * 0.05, row * 5.3), mR, 0.05, 0, 1, 2).h;
      expect(Number.isFinite(h)).toBe(true);
      hi = Math.max(hi, h);
      if (h > 0.05 && !(last > 0.05)) rocks++;
      // (5 cm apart: a block's flank — 63° at its foot — rises a few centimetres, never a cliff of a cell's edge)
      if (Number.isFinite(last)) jump = Math.max(jump, Math.abs(h - last));
      last = h;
    }
  }
  console.log(`  ${rocks} rocks crossed on 40 lines of 200 m, the highest ${hi.toFixed(2)} m, the largest step ${jump.toFixed(3)} m`);
  expect(hi).toBeGreaterThan(0.4);
  expect(hi).toBeLessThan(2.2);
  expect(rocks).toBeGreaterThan(40);
  expect(jump).toBeLessThan(0.25);
});

test("rocks: more where a fresh crater threw its ejecta; none within two cells of a face's edge; the pebbles the shading's", () => {
  const q0 = unit([0.3, 0.2, 0.93]);
  const count = (ej: number) => {
    let n = 0;
    for (let i = 0; i < 20000; i++)
      if (airlessRocks(at(q0, (i % 200) * 1.01, Math.floor(i / 200) * 1.01), mR, 0.05, ej, 1, 2).h > 0.02) n++;
    return n;
  };
  const bare = count(0),
    ejecta = count(1);
  console.log(
    `  ground covered by rocks: ${((bare / 20000) * 100).toFixed(1)} % on the plain, ${((ejecta / 20000) * 100).toFixed(1)} % in fresh ejecta`,
  );
  expect(ejecta).toBeGreaterThan(3 * bare);
  // (within 40 cm of a face's edge — |x| = |z| —: none, the pebbles' two cells)
  const edge = unit([0.7, 0.1, 0.7]);
  for (let i = 0; i < 2000; i++) expect(airlessRocks(at(edge, i * 0.0002, i * 0.0001), mR, 0.05, 1, 1, 3).h).toBe(0);
  // (the pebbles — the third lattice — only when asked: the geometry has the two first)
  let extra = 0;
  for (let i = 0; i < 4000; i++) {
    const q = at(q0, i * 0.05, 1.7);
    if (airlessRocks(q, mR, 0.01, 0, 1, 3).h > airlessRocks(q, mR, 0.01, 0, 1, 2).h) extra++;
  }
  expect(extra).toBeGreaterThan(0);
});

test("rocks in the ground the gear stands on (craterRelief), and the tracer's constants the same", () => {
  const q0 = unit([0.3, 0.2, 0.93]);
  let found = false;
  for (let i = 0; i < 4000 && !found; i++) {
    const q = at(q0, i * 0.25, 0);
    const r = airlessRocks(q, mR, 0.05, 0, 1, 2).h;
    if (r > 0.2) {
      // (the Moon's ground there: its craters' and the rock's — the rock's height over the ground at its foot)
      const near = at(q0, i * 0.25 + 3, 3);
      found = craterRelief(1, q, mR) - craterRelief(1, near, mR) > 0.1;
    }
  }
  expect(found).toBe(true);
  const wgsl = readFileSync(new URL("../src/shaders/trace.wgsl", import.meta.url).pathname, "utf8");
  const ts = readFileSync(new URL("../src/terrain.ts", import.meta.url).pathname, "utf8");
  for (const c of [
    "array<f32, 3>(8.0, 2.0, 0.5)",
    "array<f32, 3>(0.06, 0.08, 0.10)",
    "array<f32, 3>(0.6, 0.5, 0.4)",
    "0.06 + 0.14 * r2.x * r2.x",
    "0x2545f491u",
    "0x85ebca6bu",
    "vec3f(0.16, 0.11, 0.06)",
    "0.45 + 0.4 * fract(r2.y * 7.31)",
    "smoothstep(0.75, 1.3, rho)",
  ])
    expect(wgsl).toContain(c);
  for (const c of [
    "[8, 2, 0.5]",
    "[0.06, 0.08, 0.1]",
    "[0.6, 0.5, 0.4]",
    "0.06 + 0.14 * r2[0] * r2[0]",
    "0x2545f491",
    "0x85ebca6b",
    "[0.16, 0.11, 0.06]",
    "0.45 + 0.4 * fract(r2[1] * 7.31)",
    "smooth(0.75, 1.3, rho)",
  ])
    expect(ts).toContain(c);
});
