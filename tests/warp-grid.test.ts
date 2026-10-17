import { expect, test } from "bun:test";
import { earthWarp } from "../src/terrain";
import { WARP_LAT_MAX, WARP_N, WARP_RECENTRE, WARP_ROUND, warpShader, warpWindows } from "../src/system/warp-grid";

// The mountains' warp precomputed round the camera (system/warp-grid.ts; trace.wgsl earthWarp): its windows follow
// the camera on nodes fixed on the Earth, and the field read bilinearly from them is the field — 3 cm of the crests
// near the camera, 0.4 m at 20 km, 6 m at 78 km.

const D = Math.PI / 180;
const EARTH_RM = 6371008.8;
const dir = (lon: number, lat: number): [number, number, number] => [
  Math.cos(lat) * Math.cos(lon),
  Math.cos(lat) * Math.sin(lon),
  Math.sin(lat),
];

test("the windows: kept while the camera stays within 64 nodes of their centre, else centred again; none near the poles", () => {
  const a = warpWindows([null, null, null], 6.86 * D, 45.83 * D);
  expect(a.dirty).toEqual([0, 1, 2]);
  for (let k = 0; k < 3; k++) {
    const per = WARP_ROUND[k]! / (2 * Math.PI);
    // (the camera near its window's centre; the params its place on it, nodes a radian, on)
    expect(Math.abs(a.params[4 + 4 * k]! - WARP_N / 2)).toBeLessThan(1);
    expect(a.params[6 + 4 * k]).toBeCloseTo(per, 0);
    expect(a.params[7 + 4 * k]).toBe(1);
  }
  // (40 nodes east on the finest — 760 m —: none worked out again; 70: the finest only)
  const step = (2 * Math.PI) / WARP_ROUND[0]!;
  const b = warpWindows(a.windows, 6.86 * D + 40 * step, 45.83 * D);
  expect(b.dirty).toEqual([]);
  expect(b.windows).toEqual(a.windows);
  const c = warpWindows(a.windows, 6.86 * D + (WARP_RECENTRE + 6) * step, 45.83 * D);
  expect(c.dirty).toEqual([0]);
  // (the nodes fixed on the Earth: a window's first node a whole number of steps)
  expect(Number.isInteger(c.windows[0]!.i0)).toBe(true);
  const p = warpWindows([null, null, null], 0, WARP_LAT_MAX + 0.01);
  expect(p.dirty).toEqual([]);
  expect([...p.params.subarray(4)].every((x) => x === 0)).toBe(true);
});

test("the field read from the nodes is the field: 3 cm of crest at 19 m nodes, 0.4 m at 76 m, 6 m at 306 m", () => {
  // (the shader's lookup, in float64: the four nodes round a point, bilinear)
  const lookup = (k: number, lon: number, lat: number) => {
    const per = WARP_ROUND[k]! / (2 * Math.PI);
    const x = lon * per;
    const y = lat * per;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const n = (a: number, b: number) => earthWarp(dir(a / per, b / per));
    const [a, b, c, d] = [n(i, j), n(i + 1, j), n(i, j + 1), n(i + 1, j + 1)];
    return [0, 1, 2].map((m) => (a[m]! * (1 - fx) + b[m]! * fx) * (1 - fy) + (c[m]! * (1 - fx) + d[m]! * fx) * fy);
  };
  const worst = [0, 0, 0];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let s = 0; s < 400; s++) {
    // (the Alps, the Andes, the Himalaya, Yosemite)
    const [lon0, lat0] = [
      [6.86, 45.83],
      [-70, -33],
      [86.9, 28],
      [-119.6, 37.7],
    ][s % 4]!;
    const lon = (lon0! + (rnd() - 0.5) * 0.4) * D;
    const lat = (lat0! + (rnd() - 0.5) * 0.4) * D;
    const ex = earthWarp(dir(lon, lat));
    for (let k = 0; k < 3; k++) {
      const v = lookup(k, lon, lat);
      worst[k] = Math.max(worst[k]!, ...v.map((x, m) => Math.abs(x - ex[m]!)));
    }
  }
  const lattice = EARTH_RM / 1500;
  console.log(
    `  the field from the nodes, off by at most: ${worst.map((w, k) => `${w.toExponential(1)} (${(w * lattice).toFixed(2)} m) at level ${k}`).join(", ")}`,
  );
  expect(worst[0]).toBeLessThan(2e-5);
  expect(worst[1]).toBeLessThan(3e-4);
  expect(worst[2]).toBeLessThan(4e-3);
});

test("the grid's pass takes the tracer's own noise from its source", async () => {
  const trace = await Bun.file(`${import.meta.dir}/../src/shaders/trace.wgsl`).text();
  const src = warpShader(trace);
  for (const f of ["fn pcg(", "fn gGrad(", "fn gnoise(", "fn tfbm(", "fn earthWarpExact("]) {
    expect(src).toContain(f);
    // (the same text as the tracer's)
    const at = trace.indexOf(f);
    expect(src).toContain(trace.slice(at, trace.indexOf("\n}", at) + 2));
  }
  expect(src).toContain("@compute @workgroup_size(8, 8)");
});
