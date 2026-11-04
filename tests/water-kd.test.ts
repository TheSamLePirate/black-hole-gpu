import { expect, test } from "bun:test";
import { KD_MAX, KD_MIN, kdOfByte, WATER_H, WATER_W, waterCell, waterTable } from "../src/system/water-kd-grid";

// T7 — the sea's water by region (system/water-kd-grid.ts; trace.wgsl seaKd490): the bytes packed three a float, every one read
// back the same; the map's own values where the waters are known.

test("the table: three bytes a float, exact, every cell read back the same (as waterCell reads it in the tracer)", () => {
  const bytes = new Uint8Array(WATER_W * WATER_H);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 2654435761) >>> 24;
  const t = waterTable(bytes);
  expect(t[0]).toBe(1);
  for (const n of [0, 1, 2, 3, 11, 12, 13, 4321, bytes.length - 1, bytes.length - 2]) expect(waterCell(t, n)).toBe(bytes[n]!);
  // (never a float the GPU would mangle: integers under 2²⁴)
  let most = 0;
  for (let i = 4; i < t.length; i++) most = Math.max(most, t[i]!);
  expect(most).toBeLessThan(2 ** 24);
  expect(kdOfByte(0)).toBeCloseTo(KD_MIN, 6);
  expect(kdOfByte(255)).toBeCloseTo(KD_MAX, 4);
});

test("the map: the open ocean clear, the Channel and a river's plume turbid (ESA's Ocean Colour CCI)", async () => {
  const f = Bun.file(`${import.meta.dir}/../assets/earth/water-kd490.png`);
  // (decoded to a file: bun test leaves a spawned process's stdout empty)
  const tmp = `/tmp/water-kd-test-${process.pid}.gray`;
  Bun.spawnSync(["magick", f.name!, "-depth", "8", `gray:${tmp}`]);
  const raw = new Uint8Array(await Bun.file(tmp).arrayBuffer());
  expect(raw.length).toBe(WATER_W * WATER_H);
  const kd = (lat: number, lon: number) => {
    const x = Math.floor(((lon + 180) / 360) * WATER_W),
      y = Math.floor(((90 - lat) / 180) * WATER_H);
    return kdOfByte(raw[y * WATER_W + x]!);
  };
  // (the South Pacific's gyre: among the clearest waters of the world)
  expect(kd(-25, -120)).toBeLessThan(0.03);
  // (the Sargasso Sea)
  expect(kd(28, -60)).toBeLessThan(0.04);
  // (the Channel off Étretat, the Mont-Saint-Michel's bay, the Gironde's mouth: coastal, turbid)
  expect(kd(49.9, 0.0)).toBeGreaterThan(0.1);
  expect(kd(48.75, -1.65)).toBeGreaterThan(0.2);
  expect(kd(45.6, -1.15)).toBeGreaterThan(0.3);
  // (the Rio de la Plata)
  expect(kd(-35.2, -56.5)).toBeGreaterThan(0.8);
});
