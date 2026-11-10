import { expect, test } from "bun:test";
import { PARAMS_LAYOUT_FILE, paramsLayoutSource } from "../scripts/gen-layouts";
import { SHADE_VEC4S } from "../src/eclipse/shadows-gpu";
import { PARAMS, PARAMS_FLOATS, PARAMS_SIZE, PARAMS_V4 } from "../src/gen/params-layout";
import { SURFACE_VEC4S } from "../src/system/earth-surface";
import { TILE_PARAM_VEC4S } from "../src/system/earth-tiles";
import { SCENERY_VEC4S } from "../src/system/scenery-data";

// PLAN-J1 J1-0: the parameters' layout generated from trace.wgsl's struct Params (scripts/gen-layouts.ts, webgpu-utils) — up to
// date with the WGSL, and the blocks other modules fill sized as the WGSL has them.

test("src/gen/params-layout.ts is up to date with trace.wgsl (bun scripts/gen-layouts.ts)", async () => {
  expect(await Bun.file(PARAMS_LAYOUT_FILE).text()).toBe(await paramsLayoutSource());
});

test("the blocks other modules write span what the WGSL declares", () => {
  expect(PARAMS_SIZE.shade).toBe(SHADE_VEC4S * 4);
  expect(PARAMS_SIZE.surface).toBe(SURFACE_VEC4S * 4);
  expect(PARAMS_SIZE.scenery).toBe(SCENERY_VEC4S * 4);
  expect(PARAMS.runways - PARAMS.tiles).toBe(TILE_PARAM_VEC4S * 4);
});

test("the struct is whole vec4s, each field on one", () => {
  expect(PARAMS_FLOATS % 4).toBe(0);
  for (const [k, v] of Object.entries(PARAMS)) {
    expect(v % 4, k).toBe(0);
    expect(PARAMS_V4[k as keyof typeof PARAMS_V4] as number).toBe(v / 4);
  }
});
