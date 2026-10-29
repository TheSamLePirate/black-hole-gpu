import { expect, test } from "bun:test";
import traceWGSL from "../src/shaders/trace.wgsl" with { type: "text" };
import { AIR_SURFACES, bodyHasAir } from "../src/system/scene-bodies";
import { NEAR_KIND_SHIFT, strippedBits, tracerConstants } from "../src/system/tracer-kernels";

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

test("the Earth near compiles the other universe's hole out — and says so (strippedBits)", () => {
  // (the Earth flight's key: the wormhole's world, Gargantua's metric and thick disk in the key, the Earth near)
  const earth = 32 | 64 | 128 | 512 | (1 << NEAR_KIND_SHIFT);
  // (Miller near, the same bits: its probe needs the hole)
  const miller = 32 | 64 | 128 | 512 | (3 << NEAR_KIND_SHIFT);
  expect(strippedBits(earth)).toBe(64 | 512);
  expect(tracerConstants(earth, "env").HAS_KERR).toBe(0);
  expect(strippedBits(earth, { otherUniverse: true })).toBe(0);
  expect(strippedBits(earth, { quality: true })).toBe(0);
  expect(strippedBits(miller)).toBe(0);
  expect(tracerConstants(miller, "env").HAS_KERR).toBe(1);
  // (so the Earth's kernel does not cover Miller's need: the renderer's test, coveringVariant)
  expect(strippedBits(earth) & (miller & ~strippedBits(miller))).not.toBe(0);
});
