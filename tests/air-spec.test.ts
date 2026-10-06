import { expect, test } from "bun:test";

// A world's air in the tracer (trace.wgsl: AirSpec) is built whole, by its constructor — WGSL then refuses
// to compile one with a field missing. Declared bare and filled field by field, a field added later was
// left at zero in one place: Gargantua's worlds' air, its z scale 0, flattened onto the ground (audit H2;
// the GPU check: tests/e2e/near-air.e2e.test.ts).

const trace = await Bun.file(new URL("../src/shaders/trace.wgsl", import.meta.url)).text();

test("every air spec in the tracer is built by its constructor, no field left at zero", () => {
  expect(trace.match(/\bvar\s+\w+\s*:\s*AirSpec\s*;/g)).toBeNull();
  expect(trace.match(/\bAirSpec\(/g)?.length).toBeGreaterThanOrEqual(2);
});
