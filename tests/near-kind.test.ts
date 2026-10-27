import { expect, test } from "bun:test";
import traceWGSL from "../src/shaders/trace.wgsl" with { type: "text" };
import { AIR_SURFACES, bodyHasAir } from "../src/system/scene-bodies";
import { NEAR_KIND_SHIFT, tracerConstants } from "../src/system/tracer-kernels";

test("the renderer's 'has air' is the tracer's (airOf's list)", () => {
  const m = /fn airOf\(m: u32\) -> bool \{ return ([^;]+); \}/.exec(traceWGSL);
  expect(m).not.toBeNull();
  const list = [...m![1]!.matchAll(/m == (\d+)u/g)].map((x) => Number(x[1]));
  expect([...list].sort((a, b) => a - b)).toEqual([...AIR_SURFACES].sort((a, b) => a - b));
  expect(bodyHasAir(1, 4)).toBe(true);
  expect(bodyHasAir(1, 5)).toBe(false);
  expect(bodyHasAir(0, 4)).toBe(false);
});

test("NEAR_KIND from the key, for the camera's kernels only", () => {
  const key = 128 | (3 << NEAR_KIND_SHIFT);
  expect(tracerConstants(key, "main").NEAR_KIND).toBe(3);
  expect(tracerConstants(key, "discs").NEAR_KIND).toBe(3);
  expect(tracerConstants(key, "env").NEAR_KIND).toBe(0);
  expect(tracerConstants(128, "main").NEAR_KIND).toBe(0);
});
