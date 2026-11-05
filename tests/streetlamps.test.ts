import { expect, test } from "bun:test";
import { packScenery, LAMP_HEAD, LAMP_POLE } from "../src/system/scenery-data";
import { makeDecals } from "../src/system/scenery-geometry";
import { builtUp, LAMP_CLASSES, LAMP_GRID, LAMP_LIGHT_RANGE, lampLight, lampMesh, lampsAlong } from "../src/system/streetlamps";

test("lamps along a street: its class's spacing, off its axis, the head over the road", () => {
  const pts: [number, number][] = [
    [0, 0],
    [200, 0],
  ];
  const ls = lampsAlong(pts, "minor", 6);
  const c = LAMP_CLASSES.minor!;
  expect(ls.length).toBeGreaterThanOrEqual(Math.floor(200 / c.spacing));
  expect(ls.length).toBeLessThanOrEqual(Math.ceil(200 / c.spacing));
  for (let i = 1; i < ls.length; i++) expect(ls[i]!.foot[0] - ls[i - 1]!.foot[0]).toBeCloseTo(c.spacing, 6);
  // (one side — the right of +x: y < 0 —, 3.6 m off the axis, the head 1.2 m back over the road, at the pole's height)
  for (const l of ls) {
    expect(l.foot[1]).toBeCloseTo(-3.6, 6);
    expect(l.head[1]).toBeCloseTo(-2.4, 6);
    expect(l.head[2]).toBe(c.height);
  }
  expect(lampsAlong(pts, "motorway", 20)).toEqual([]);
});

test("a wider road's lamps alternate sides; the segment and share point back to the street", () => {
  const ls = lampsAlong(
    [
      [0, 0],
      [100, 0],
      [100, 100],
    ],
    "primary",
    10,
  );
  const firstSeg = ls.filter((l) => l.seg === 0);
  expect(firstSeg.some((l) => l.foot[1] > 0) && firstSeg.some((l) => l.foot[1] < 0)).toBe(true);
  for (const l of ls) {
    expect(l.frac).toBeGreaterThanOrEqual(0);
    expect(l.frac).toBeLessThanOrEqual(1);
  }
});

test("the light's pool: brightest under the head, a third or so between two lamps, none far off", () => {
  const lamps = lampsAlong(
    [
      [-100, 0],
      [100, 0],
    ],
    "minor",
    6,
  );
  const g = lampLight(lamps);
  const N = Math.round((2 * LAMP_GRID.half) / LAMP_GRID.texel);
  expect(g.length).toBe(N * N);
  const at = (x: number, y: number) =>
    (g[Math.floor((y + LAMP_GRID.half) / LAMP_GRID.texel) * N + Math.floor((x + LAMP_GRID.half) / LAMP_GRID.texel)]! / 255) *
    LAMP_LIGHT_RANGE;
  const h = lamps[2]!.head;
  const mid = [(lamps[2]!.head[0] + lamps[3]!.head[0]) / 2, h[1]] as const;
  expect(at(h[0], h[1])).toBeGreaterThan(0.85);
  expect(at(mid[0], mid[1]) / at(h[0], h[1])).toBeGreaterThan(0.25);
  expect(at(mid[0], mid[1]) / at(h[0], h[1])).toBeLessThan(0.9);
  expect(at(h[0], 200)).toBe(0);
  // (thrown along the street, little across it: 10 m into the gardens a fraction of the street's middle)
  expect(at(h[0], h[1] - 10)).toBeLessThan(0.2 * at(h[0], h[1]));
});

test("the built-up test wants buildings about the point", () => {
  const town = builtUp([
    [10, 10],
    [20, 30],
    [60, 10],
    [-30, 5],
  ]);
  expect(town(0, 0)).toBe(true);
  expect(town(1000, 1000)).toBe(false);
});

test("packed: the lamps' tags after the cars', from a vertex index ≡ 0 mod 4, their grid flagged in the palette's entry 0", () => {
  const lamps = lampsAlong(
    [
      [0, 0],
      [100, 0],
    ],
    "minor",
    6,
  );
  const meshes = lamps.map(lampMesh);
  const grid = lampLight(lamps);
  const decals = makeDecals([]);
  const buf = packScenery([], new Uint32Array(64), [], undefined, 8, 64 * 1024 * 1024, decals, [], [], [], [], meshes, grid);
  const f = new Float32Array(buf),
    u = new Uint32Array(buf);
  const [meshOffset, vertexCount, triangleOffset] = [f[12]!, f[13]!, f[14]!];
  const triangleCount = f[11]!;
  expect(triangleCount).toBe(lamps.length * 4);
  expect(vertexCount).toBe(lamps.length * 8);
  const tags = u.subarray(triangleOffset * 4 + triangleCount * 3, triangleOffset * 4 + triangleCount * 4);
  expect(tags[0]).toBe(LAMP_POLE >>> 0);
  expect(tags[2]).toBe(LAMP_HEAD >>> 0);
  expect(tags[4]).toBe((LAMP_POLE | 1) >>> 0);
  // (the header's fourth: the lamps' count)
  expect(f[(triangleOffset + triangleCount) * 4 + 3]).toBe(lamps.length);
  // (the first lamp's vertices: from an index ≡ 0 mod 4)
  expect(u[triangleOffset * 4]! % 4).toBe(0);
  expect(meshOffset).toBeGreaterThan(0);
  // (the grid's side and texel in the palette's entry 0)
  const decalAt = f[2]! + (f[3]! * f[3]!) / 4;
  expect(f[(decalAt + 1) * 4]).toBe(Math.round((2 * LAMP_GRID.half) / LAMP_GRID.texel));
  expect(f[(decalAt + 1) * 4 + 1]).toBe(LAMP_GRID.texel);
});

test("the shader's pool scale is LAMP_LIGHT_RANGE", async () => {
  const src = await Bun.file(new URL("../src/shaders/trace.wgsl", import.meta.url)).text();
  const line = src.split("\n").find((l) => l.includes("mix(mix(c.x, c.y, f.x), mix(c.z, c.w, f.x), f.y) *"))!;
  expect(Number(line.split("*").pop()!.replace(";", "").trim())).toBe(LAMP_LIGHT_RANGE);
});
