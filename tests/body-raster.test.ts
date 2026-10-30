import { expect, test } from "bun:test";
import traceWGSL from "../src/shaders/trace.wgsl" with { type: "text" };
import { BODY_GRID_N, BODY_LEVELS_MAX, bodyGridMesh, bodyRasterFrame, bodyRasterShader, reliefMax } from "../src/system/body-raster";
import type { LocalPatch } from "../src/system/local-patch";

test("the body raster's relief reach is the tracer's (trace.wgsl reliefMax)", () => {
  const m = /fn reliefMax\(surf: u32\) -> f32 \{([\s\S]*?)\n\}/.exec(traceWGSL);
  expect(m).not.toBeNull();
  const body = m![1]!;
  for (const [surf, h] of [...body.matchAll(/surf == (\d+)u\) \{ return ([\d.]+); \}/g)].map((x) => [Number(x[1]), Number(x[2])]))
    expect(reliefMax(surf!)).toBe(h!);
  // (the airless worlds and Mars — its craters, P7 —: 500 m; the Earth and the giants, none)
  expect(reliefMax(4 + 1)).toBe(500);
  expect(reliefMax(4 + 2)).toBe(500);
  expect(reliefMax(4 + 0)).toBe(0);
});

test("the vertex shader's library takes the relief and what it calls, with the craters' private globals", () => {
  const src = bodyRasterShader(traceWGSL);
  for (const name of ["fn relief(", "fn reliefBase(", "fn craterRelief(", "fn tfbm(", "fn demH0(", "fn bodyVs(", "fn bodyFs("])
    expect(src).toContain(name);
  expect(src).toContain("var<private> CRATER_GRAD");
  expect(src).toContain("var hdRelief: texture_2d<f32>");
});

test("the grid: the finest level whole, the coarser ones rings about the finer one's square", () => {
  const m = bodyGridMesh();
  const cells = (BODY_GRID_N - 1) ** 2;
  expect(m.vertices.length).toBe(BODY_GRID_N * BODY_GRID_N * 2);
  expect(m.full.length).toBe(cells * 6);
  // (a hole of 60 × 60 cells: the finer level's 64 × 64, a two-cell band drawn by both)
  expect(m.ring.length).toBe((cells - 60 * 60) * 6);
});

test("the frame: the camera's ground point on the tangent plane, the levels to the horizon, the anchor kept", () => {
  const R = 1737e3;
  const mPerM = 1476.625e8;
  const radius = R / mPerM;
  // (3 km over the Moon, the body's axes the camera's)
  const near = {
    centre: [0, 0, -(1 + 3000 / R)],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    radius,
    distance: radius * (1 + 3000 / R),
  } as unknown as LocalPatch;
  const camera = { right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, -1] } as never;
  const view = { near, camera, surf: 5, image: { width: 1600, height: 1000 }, fovDegrees: 60, mPerM, jitter: [0, 0] as [number, number] };
  const f = bodyRasterFrame(view, null)!;
  expect(f).not.toBeNull();
  // (the finest cell 32 m — 3 000 / 100 to a power of two —, the levels reaching ~100 km and more)
  expect(f.uniform[35]).toBe(32);
  expect(f.levels).toBeGreaterThan(5);
  expect(f.levels).toBeLessThanOrEqual(BODY_LEVELS_MAX);
  // (the reference point is the camera's ground point: the origin R r0 − eye straight down, 3 km)
  expect(Math.hypot(f.uniform[0]!, f.uniform[1]!, f.uniform[2]!)).toBeCloseTo(3000, 0);
  // (a frame after: the anchor kept)
  expect(bodyRasterFrame(view, f.anchor)!.anchor).toBe(f.anchor);
  // (too high — half a radius over the ground —: nothing drawn)
  const high = { ...near, centre: [0, 0, -1.6] } as unknown as LocalPatch;
  expect(bodyRasterFrame({ ...view, near: high }, null)).toBeNull();
});
