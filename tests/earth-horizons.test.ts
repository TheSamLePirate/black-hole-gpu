import { expect, test } from "bun:test";
import { EARTH_HORIZON_VEC4S, TABLE_EARTH_HORIZON, TABLE_HORIZON, TABLE_VEC4S } from "../src/gpu-tables";
import { earthHorizonReader, earthHorizonShader, ehDecode, ehElevationSin, ehEncode } from "../src/system/earth-horizons";
import { WGS84_A } from "../src/system/ellipsoid";
import { EH_SIN_MAX, TERRAIN_CACHE_N } from "../src/system/terrain-cache-layout";

// H5 — the Earth's horizons (system/earth-horizons.ts): their encoding, their geometry, their place in the tracer's table.

test("H5: a sine's byte — H1's signed root — round-trips within its step, finer near the horizontal", () => {
  for (const s of [-0.7, -0.2, -0.01, 0, 0.004, 0.02, 0.1, 0.4, 0.74]) {
    const back = ehDecode(ehEncode(s));
    // (the step of the root's code: 2·√(|s|/max)·max/127 — at 0.02, 0.0013, ~0.07°)
    const step = (2 * Math.sqrt(Math.abs(s) / EH_SIN_MAX) * EH_SIN_MAX) / 127 + 1e-4;
    expect(Math.abs(back - s)).toBeLessThanOrEqual(step);
  }
  expect(ehEncode(1)).toBe(255);
  expect(ehEncode(-1)).toBe(0);
});

test("H5: the elevation over the local sphere — a bare ground dips by d/2N, a 2 km ridge 50 km off stands 1.9° up", () => {
  const lat = (46 * Math.PI) / 180;
  const N = WGS84_A / Math.sqrt(1 - 0.00669438 * Math.sin(lat) ** 2);
  for (const d of [1_000, 20_000, 150_000]) {
    const s = ehElevationSin(lat, 0, 0, d / N);
    expect(s).toBeCloseTo(-d / (2 * N), 6);
  }
  const e = (Math.asin(ehElevationSin(lat, 500, 2500, 50_000 / N)) * 180) / Math.PI;
  // (atan(2000 / 50 000) = 2.29°, less the curvature's 50 000 / 2N = 0.22°)
  expect(e).toBeGreaterThan(2.0);
  expect(e).toBeLessThan(2.1);
});

test("H5: the record's packing — two sines a float, three steps a float — reads back as the tracer unpacks it", () => {
  const sines = [0, 17, 128, 200, 255, 3, 99, 254];
  const steps = [0, 39, 5, 63, 12, 1, 38, 7];
  // (the bake's packing, trace's reading — earthHorizonNode — written out)
  const S = [0, 1, 2, 3].map((i) => sines[2 * i]! * 256 + sines[2 * i + 1]!);
  const T = [steps[0]! * 4096 + steps[1]! * 64 + steps[2]!, steps[3]! * 4096 + steps[4]! * 64 + steps[5]!, steps[6]! * 64 + steps[7]!];
  for (let k = 0; k < 8; k++) {
    const pair = Math.fround(S[Math.floor(k / 2)]!);
    const hi = Math.floor(pair / 256);
    expect(k & 1 ? pair - 256 * hi : hi).toBe(sines[k]!);
    const w = Math.fround(T[Math.min(Math.floor(k / 3), 2)]!);
    const p = k >= 6 ? k - 5 : k % 3;
    const d64 = Math.floor(w / 64);
    const st = p === 0 ? Math.floor(w / 4096) : p === 1 ? d64 - 64 * Math.floor(w / 4096) : w - 64 * d64;
    expect(st).toBe(steps[k]!);
  }
});

test("H5: in the tracer's table after the near body's maps; the bake and the reader written for the cache's lattice", () => {
  expect(TABLE_EARTH_HORIZON).toBeGreaterThan(TABLE_HORIZON);
  expect(TABLE_VEC4S).toBe(TABLE_EARTH_HORIZON + EARTH_HORIZON_VEC4S);
  // (3 levels of 257² nodes, two vec4s each: 6.3 MB — under the storage binding's 128 MB with the rest)
  expect(EARTH_HORIZON_VEC4S * 16).toBeLessThan(8 * 2 ** 20);
  expect(TABLE_VEC4S * 16).toBeLessThan(128 * 2 ** 20);
  const bake = earthHorizonShader();
  expect(bake).toContain(`const TC_N = ${TERRAIN_CACHE_N}u;`);
  expect(bake).toContain("fn bake(");
  const reader = earthHorizonReader();
  expect(reader).toContain(`const EH_OFF = ${TABLE_EARTH_HORIZON}u;`);
  expect(reader).toContain("fn earthHorizonSin(gq: vec3f, h: f32, L: vec3f) -> vec2f");
});
