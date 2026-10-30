import { expect, test } from "bun:test";
import trace from "../src/shaders/trace.wgsl" with { type: "text" };
import { NOISE_DEPTH, TILE_FRAMES, TILE_Z0 } from "../src/noise3d";
import { GIANT_TILE } from "../src/system/giant-tile";

// The noise texture's two halves (PLAN-PLANETES-AAA P9 G8): the tracer reads them where noise3d.ts and giant-tile.ts write
// them — the noises in slices 1–128 between their guards, the giants' tile from TILE_Z0, its frames in time.

const constOf = (name: string) => Number(trace.match(new RegExp(`^const ${name} = ([\\d.]+);`, "m"))?.[1]);

test("the tracer's noise and tile slices are the textures'", () => {
  expect(constOf("NOISE_DZ")).toBe(NOISE_DEPTH);
  expect(constOf("GTILE_Z0")).toBe(TILE_Z0);
  expect(constOf("GTILE_FRAMES")).toBe(TILE_FRAMES);
  // (the noises and their guards, then the tile's guard: its first frame just after)
  expect(TILE_Z0).toBe(128 + 2 + 1);
  expect(TILE_Z0 + TILE_FRAMES + 1).toBe(NOISE_DEPTH);
});

test("the tile's flow is unstable where it should be: its jets roll up (U0 n² > β), its steps within the CFL", () => {
  const { jetU, jetN, beta, dt } = GIANT_TILE;
  expect(jetU * jetN * jetN).toBeGreaterThan(beta);
  // (the jets' speed over a cell of the 128² square, a step: under half a cell)
  expect((jetU * dt) / ((2 * Math.PI) / 128)).toBeLessThan(0.5);
});
