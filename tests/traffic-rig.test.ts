import { expect, test } from "bun:test";
import { trafficMatrices } from "../src/traffic/rig";
const rest = { flap: 0, spoiler: 0, rev: 0, n1: 0, speed: 0, time: 0, roll: 0, pitch: 0 };
for (const id of ["b738", "b744", "b772", "b77w", "crj900"]) {
  test(`${id}: separate rigid gear and flap maps, finite through transitions`, () => {
    const down = trafficMatrices(id, 1, rest)!;
    const up = trafficMatrices(id, 0, rest)!;
    const flaps = trafficMatrices(id, 1, { ...rest, flap: 1 })!;
    expect(down.length).toBeGreaterThan(12);
    expect(up).not.toEqual(down);
    expect(flaps).not.toEqual(down);
    for (const g of [0, 0.25, 0.5, 0.75, 1]) {
      const maps = trafficMatrices(id, g, { ...rest, flap: g, spoiler: g, rev: g, n1: 60, time: 3 })!;
      for (const x of maps) expect(Number.isFinite(x)).toBe(true);
      // Every visible part remains a rigid transform (no shrinking tyres or skewed normals).
      for (let k = 0; k < maps.length; k += 12) {
        expect(Math.hypot(maps[k]!, maps[k + 1]!, maps[k + 2]!)).toBeCloseTo(1, 5);
      }
    }
  });
}

test("CRJ wheels physically rise into their bays: named animation groups retain their parents", async () => {
  const { gunzipSync } = await import("node:zlib");
  const { readTrfc } = await import("../src/traffic/airliner-gear");
  const bytes = gunzipSync(await Bun.file("assets/traffic/crj-fg/crj900.bin").arrayBuffer());
  const mesh = readTrfc(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const down = trafficMatrices("crj900", 1, rest)!,
    up = trafficMatrices("crj900", 0, rest)!;
  const wheels = [];
  for (let k = 0; k < mesh.verts.length; k += 10) if (mesh.verts[k + 1]! < -3.65) wheels.push(k);
  expect(wheels.length).toBeGreaterThan(100);
  for (const k of wheels) {
    const v = mesh.verts,
      j = Math.floor(v[k + 7]!) * 12;
    const y = (a: Float32Array) => a[j + 4]! * v[k]! + a[j + 5]! * v[k + 1]! + a[j + 6]! * v[k + 2]! + a[j + 7]!;
    expect(y(up) - y(down)).toBeGreaterThan(0.5);
  }
});
