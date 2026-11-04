import { expect, test } from "bun:test";
import { gpuBending, gpuTableData, REFR_FLOATS, REFR_VEC4S } from "../src/system/refraction-gpu";
import { airProfile, BENNETT_AIR, limbBending, refraction } from "../src/system/refraction-layered";

// R2 — the layered air's tables as the GPU reads them (src/system/refraction-gpu.ts): the shader's reading, replayed on the CPU,
// against the integral (refraction-layered.ts, the independent oracle) — the LUT and interpolation's share of C0-7's budgets: up
// rays, near-horizon rays, rays dipping under the horizon from a height, tangent rays from orbit, all within 3″.

const D = Math.PI / 180;
const AS = (180 * 3600) / Math.PI;
const P = airProfile(BENNETT_AIR);
const f = gpuTableData(BENNETT_AIR, P);
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

test("the packed table: its header, its size", () => {
  expect(f.length).toBe(REFR_VEC4S * 4);
  expect(REFR_FLOATS).toBeLessThanOrEqual(f.length);
  expect(Array.from(f.subarray(0, 4))).toEqual([1, 128, 128, 4096]);
});

test("up from the ground to 30 km, every elevation: within 3″ of the integral (under 2″ near the horizon)", () => {
  let worst = 0,
    worstLow = 0;
  for (let k = 0; k < 300; k++) {
    const h = rnd() ** 3 * 30000,
      e = rnd() ** 2 * 90 * D;
    const d = Math.abs(gpuBending(f, h, e)! - refraction(P, e, h)!) * AS;
    if (e < 2 * D) worstLow = Math.max(worstLow, d);
    worst = Math.max(worst, d);
  }
  expect(worst).toBeLessThan(3);
  expect(worstLow).toBeLessThan(2);
}, 60_000);

test("dipping under the horizon from 200 m to 20 km: down to its tangent and up, within 3″; the sea met: null", () => {
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const h = 200 + rnd() ** 2 * 20000;
    const dip = Math.acos(6371e3 / (6371e3 + h));
    const e = -rnd() * dip * 0.98;
    const g = gpuBending(f, h, e),
      r = refraction(P, e, h);
    if (g === null || r === null) continue;
    worst = Math.max(worst, Math.abs(g - r) * AS);
  }
  expect(worst).toBeLessThan(3);
  expect(gpuBending(f, 0, -0.5 * D)).toBeNull();
}, 60_000);

test("from orbit (400 km): a tangent ray's whole bending, within 3″; looking up, none", () => {
  const R = 6371e3,
    h = 400e3;
  let worst = 0;
  for (let k = 0; k < 150; k++) {
    const ht = rnd() ** 2 * 60000;
    // (the apparent elevation whose ray is tangent at ht: n r = c, the camera's n 1)
    const n = 1 + P.N[Math.round(ht / 10)]!;
    const e = -Math.acos((n * (R + ht)) / (R + h));
    worst = Math.max(worst, Math.abs(gpuBending(f, h, e)! - limbBending(P, ht)) * AS);
  }
  expect(worst).toBeLessThan(3);
  expect(gpuBending(f, h, 10 * D)).toBe(0);
}, 60_000);

test("the shader's constants: the packed table's offsets and grids as trace.wgsl reads them", async () => {
  const wgsl = await Bun.file(`${import.meta.dir}/../src/shaders/trace.wgsl`).text();
  const constU = (name: string) => Number(new RegExp(`const ${name} = (\\d+)u;`).exec(wgsl)![1]);
  const { REFR_OFF_HAUT, REFR_OFF_LIMB, REFR_OFF_N, GH, GE, GL, NN } = await import("../src/system/refraction-gpu");
  expect(constU("REFR_HAUT")).toBe(REFR_OFF_HAUT);
  expect(constU("REFR_LIMB")).toBe(REFR_OFF_LIMB);
  expect(constU("REFR_NN")).toBe(REFR_OFF_N);
  expect(wgsl).toContain(`* ${GE}u + j`);
  expect(wgsl).toContain(`min(u32(x), ${GH - 2}u)`);
  expect(wgsl).toContain(`* ${GL - 1}.0`);
  expect(wgsl).toContain(`min(u32(x), ${NN - 2}u)`);
});

test("the sliced builder: the same table as at once, a slice at a time", async () => {
  const { RefrTableBuilder } = await import("../src/system/refraction-gpu");
  const b = new RefrTableBuilder(BENNETT_AIR);
  let out: Float32Array | null = null,
    slices = 0;
  while (!(out = b.step(20))) slices++;
  expect(slices).toBeGreaterThan(5);
  let diff = 0;
  for (let i = 0; i < f.length; i++) diff = Math.max(diff, Math.abs(out[i]! - f[i]!));
  expect(diff).toBe(0);
}, 60_000);

test("refraction.ts on the drawn air's tables: the CPU's bending the GPU's numbers; another air's its own model", async () => {
  const R = await import("../src/system/refraction");
  const n0 = R.drawnRefractivity();
  R.setRefractionTable(f);
  try {
    expect(R.bending(1 * D, 0, n0)).toBeCloseTo(gpuBending(f, 0, 1 * D)!, 12);
    // (another air asked — a future date's standard one —: not the drawn tables)
    expect(R.bending(1 * D, 0, n0 * 1.05)).not.toBeCloseTo(gpuBending(f, 0, 1 * D)!, 8);
  } finally {
    R.setRefractionTable(null);
  }
});
