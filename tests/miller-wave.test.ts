import { expect, test } from "bun:test";
import traceWGSL from "../src/shaders/trace.wgsl" with { type: "text" };
import { groundR, planetFrame, stepLocal, type LocalState } from "../src/landing";
import { MW_BACK, MW_FRONT, MW_HEIGHT, MW_LIP, millerWave, relief, SURF } from "../src/terrain";

type V3 = [number, number, number];
const unit = (v: V3): V3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const F = planetFrame("miller", 5000, 0.998, 1e8);
const mR = F.R * F.mPerM;
// (the first train's way — terrain.ts millerWave's d for i = 0 —, a direction about it, and its tangent across the crests)
const d0 = unit([Math.cos(0.3), Math.sin(0.3), -0.3]);
const side = unit([-d0[1], d0[0], 0]);
/** a point at an angle a [rad] from `side` towards the first train's way */
const along = (a: number): V3 => unit([0, 1, 2].map((i) => side[i]! * Math.cos(a) + d0[i]! * Math.sin(a)) as V3);

test("the wave's constants are the tracer's (trace.wgsl MW_*)", () => {
  for (const [name, v] of [
    ["MW_HEIGHT", MW_HEIGHT],
    ["MW_FRONT", MW_FRONT],
    ["MW_BACK", MW_BACK],
    ["MW_LIP", MW_LIP],
  ] as const) {
    const m = new RegExp(`const ${name} = ([\\d.]+);`).exec(traceWGSL);
    expect(m, name).not.toBeNull();
    expect(Number(m![1])).toBe(v);
  }
});

test("a wall: its crest at its height, its steep face ahead, its long back behind", () => {
  // (the first train's crest found along its way: the highest point within ±0.3 rad of the side)
  let best = { a: 0, h: -1 };
  for (let a = -0.3; a < 0.3; a += 2e-5) {
    const w = millerWave(along(a), F.tSec, mR);
    if (w.h > best.h) best = { a, h: w.h };
  }
  const c = millerWave(along(best.a), F.tSec, mR);
  expect(c.h).toBeGreaterThan(0.6 * MW_HEIGHT);
  // (the search's step ~170 m, the crest's height varying along: the highest point a few steps off the crest)
  expect(Math.abs(c.front)).toBeLessThan(600);
  // (2.5 km ahead: the sea; 2.5 km behind: still most of the wall)
  const da = MW_FRONT / mR;
  const ahead = millerWave(along(best.a + da), F.tSec, mR);
  const behind = millerWave(along(best.a - da), F.tSec, mR);
  expect(ahead.h).toBeLessThan(0.15 * c.h);
  expect(behind.h).toBeGreaterThan(0.9 * c.h);
  // (felt: the ground under a craft is the wave)
  const q = along(best.a);
  expect((groundR(F, [q[0] * F.R, q[1] * F.R, q[2] * F.R]) - F.R) * F.mPerM).toBeCloseTo(c.h, 0);
  expect(relief(SURF.ocean, q, mR)).toBe(0);
});

test("afloat: the craft rides the wave up, and the breaking lip sweeps it away", () => {
  // (a point the lip is over — just ahead of a tall crest —, and one on the long back)
  let lip: V3 | null = null;
  let back: V3 | null = null;
  for (let a = -0.3; a < 0.3 && (!lip || !back); a += 2e-5) {
    const q = along(a);
    const w = millerWave(q, F.tSec, mR);
    if (!lip && w.crest > 0.6 * MW_HEIGHT && w.front > 0 && w.front < 0.5 * MW_LIP) lip = q;
    if (!back && w.crest > 0.6 * MW_HEIGHT && w.front < -0.3 * MW_BACK && w.front > -0.5 * MW_BACK) back = q;
  }
  expect(lip).not.toBeNull();
  expect(back).not.toBeNull();
  const at = (q: V3): LocalState => ({ xi: [q[0] * F.R, q[1] * F.R, q[2] * F.R], w: [0, 0, 0], landed: true });
  // (on the back: lifted onto the water — its height the wave's —, not lost)
  const L = at(back!);
  const r = stepLocal(F, L, 1e-9, [0, 0, 0]);
  expect(r.wave).toBeUndefined();
  expect((Math.hypot(...L.xi) - F.R) * F.mPerM).toBeGreaterThan(200);
  // (under the lip: swept away)
  expect(stepLocal(F, at(lip!), 1e-9, [0, 0, 0]).wave).toBe(true);
});
