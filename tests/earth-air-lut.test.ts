import { expect, test } from "bun:test";
import { TABLE_TLUT } from "../src/gpu-tables";
import { lutThrough, opticalDepthExact, setTransmittanceLut, sunThrough, TLUT_H, TLUT_W, transmittanceLut } from "../src/system/earth-air";
import { EARTH_RM } from "../src/terrain";

// Q5 C1 — the Earth's air's transmittance table (system/earth-air.ts): read as the shader reads it, against the integral
const f = transmittanceLut();
const exact = (h: number, mu: number) => opticalDepthExact(EARTH_RM + h, mu, 4000).map((t) => Math.exp(-t));

test("the table within 1 % of the integral where T > 1 % (under 40 km), 15 % on the darkest rays (T 0.1–1 %: their depth ~2 % off)", () => {
  let bright = 0,
    dark = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let k = 0; k < 3000; k++) {
    const h = rnd() ** 2 * (k < 2000 ? 40e3 : 250e3);
    const r = EARTH_RM + h;
    const muH = -Math.sqrt(Math.max(1 - (EARTH_RM / r) ** 2, 0));
    const mu = muH + 1e-4 + rnd() * (1 - muH - 1e-4);
    const e = exact(h, mu)[1]!;
    if (e < 1e-3) continue;
    const err = Math.abs(lutThrough(f, h, mu)[1]! / e - 1);
    if (e > 1e-2 && k < 2000) bright = Math.max(bright, err);
    else dark = Math.max(dark, err);
  }
  console.log(`  worst: ${(100 * bright).toFixed(2)} % (T > 1 %, under 40 km), ${(100 * dark).toFixed(2)} % (darker, or higher)`);
  expect(bright).toBeLessThan(0.01);
  expect(dark).toBeLessThan(0.15);
});

test("Chapman's column replaced: the low Sun's light no longer 10–35 % too bright", () => {
  const D = Math.PI / 180;
  for (const el of [1, 2, 5, 10]) {
    const chapman = sunThrough(0, Math.sin(el * D))[1]!;
    const e = exact(0, Math.sin(el * D))[1]!;
    expect(chapman / e - 1).toBeGreaterThan(0.08);
    expect(Math.abs(lutThrough(f, 0, Math.sin(el * D))[1]! / e - 1)).toBeLessThan(0.01);
  }
  // (the drawn table: earth-air.ts's sunThrough — the light meter's — its numbers)
  setTransmittanceLut(f);
  try {
    expect(sunThrough(500, 0.03)[1]!).toBeCloseTo(lutThrough(f, 500, 0.03)[1]!, 12);
  } finally {
    setTransmittanceLut(null);
  }
});

test("under the geometric horizon the ground's shade takes the Sun down; over the air's top nothing is lost", () => {
  const D = Math.PI / 180;
  expect(lutThrough(f, 0, Math.sin(-2 * D))[1]!).toBe(0);
  expect(lutThrough(f, 400e3, 0.5)[1]!).toBeCloseTo(1, 4);
  expect(f[0]).toBe(1);
  expect(f[1]).toBe(TLUT_W);
  expect(f[2]).toBe(TLUT_H);
});

test("the shader reads the same table: its offset and its grid's sizes", async () => {
  const wgsl = await Bun.file(new URL("../src/shaders/trace.wgsl", import.meta.url)).text();
  expect(wgsl).toContain(`const TLUT_OFF = ${TABLE_TLUT}u;`);
  expect(wgsl).toContain(`vec2f(${TLUT_W - 1}.0, ${TLUT_H - 1}.0)`);
  expect(wgsl).toContain(`vec2u(${TLUT_W - 2}u, ${TLUT_H - 2}u)`);
  expect(wgsl).toContain(`(ij.y + o.y) * ${TLUT_W}u + ij.x + o.x`);
});

test("the multiple scattering's table: lit past the terminator, falling with the Sun, read where the shader reads it", async () => {
  const { msThrough, multipleScattering, MSLUT_OFF, MSLUT_N } = await import("../src/system/earth-air");
  const D = Math.PI / 180;
  const at = (el: number, h = 0) => msThrough(f, h, Math.sin(el * D))[1]!;
  // (falling with the Sun, still lit past the terminator — the twilight's sky —, not at night)
  expect(at(90)).toBeGreaterThan(at(20));
  expect(at(20)).toBeGreaterThan(at(0));
  expect(at(0)).toBeGreaterThan(at(-6));
  expect(at(-6)).toBeGreaterThan(0);
  expect(at(-30)).toBeLessThan(at(-6) * 1e-2);
  // (the table's texel against the function itself, at its centre)
  const h = (0.5 / MSLUT_N) * 300e3;
  expect(msThrough(f, h, 2 * (16.5 / MSLUT_N) - 1)[1]!).toBeCloseTo(multipleScattering(f, h, 2 * (16.5 / MSLUT_N) - 1)[1]!, 8);
  const wgsl = await Bun.file(new URL("../src/shaders/trace.wgsl", import.meta.url)).text();
  expect(wgsl).toContain(`const MSLUT_OFF = ${MSLUT_OFF}u;`);
  expect(wgsl).toContain(`* ${MSLUT_N}.0 - 0.5, vec2f(0.0), vec2f(${MSLUT_N - 1}.0))`);
  expect(wgsl).toContain(`(ij.y + q.y) * ${MSLUT_N}u + ij.x + q.x`);
});
