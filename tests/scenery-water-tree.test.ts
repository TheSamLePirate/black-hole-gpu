import { expect, test } from "bun:test";
import { packScenery } from "../src/system/scenery-data";
import { polygonPrimitive, surfaceSegment } from "../src/system/scenery-geometry";

// The water's own tree (packScenery: scenery[2].y its nodes, .z their count): its leaves the surfaces' own records — the
// lake's polygon and the river's line found there, the road left out
test("the water's tree points at the surfaces' records of the water alone", () => {
  const lake = polygonPrimitive(
    [
      [
        [0, 0, 0],
        [50, 0, 0],
        [50, 50, 0],
        [0, 50, 0],
        [0, 0, 0],
      ],
    ],
    0,
    0,
    4,
    [0.018, 0.052, 0.055],
  )!;
  const river = surfaceSegment([100, 0, 0], [200, 0, 0], 20, 3, [0.02, 0.05, 0.04]);
  const road = surfaceSegment([0, 100, 0], [200, 100, 0], 9, 1, [0.3, 0.3, 0.3]);
  const f = new Float32Array(packScenery([], new Uint32Array(16), [road, lake, river], undefined, 4));
  const [surfAt, , surfGeom] = [f[4]!, f[5]!, f[6]!];
  const [waterAt, waterNodes] = [f[9]!, f[10]!];
  expect(surfAt).toBeGreaterThan(0);
  // (a root and its two leaves)
  expect(waterNodes).toBe(3);
  const leaves: number[] = [];
  for (let i = 0; i < waterNodes; i++) {
    const hiW = f[(waterAt + i * 2 + 1) * 4 + 3]!;
    if (hiW >= 0) leaves.push(hiW);
  }
  const kinds = leaves
    .map((o) => (surfGeom + o) * 4)
    .map((b) => (f[b + 11]! > 0.5 ? `polygon ${f[b + 3]}` : `line ${f[b + 5]}`))
    .sort();
  expect(kinds).toEqual(["line 3", "polygon 4"]);
});

// trace.wgsl sceneryPolygon: the crossings of a ray along +x from p, over a record's first `count` edges
function inside(d: number[], p: [number, number], count: number) {
  let c = false;
  for (let i = 0; i < count; i++) {
    const [ax, ay, bx, by] = d.slice(12 + 4 * i, 16 + 4 * i) as [number, number, number, number];
    if (ay > p[1] !== by > p[1] && p[0] < ax + ((p[1] - ay) * (bx - ax)) / (by - ay)) c = !c;
  }
  return c;
}
test("a large water polygon cut into bands answers as the whole one — its water and its island", async () => {
  const { waterBands } = await import("../src/system/scenery-data");
  // (a ragged river 2 km long, 300 edges a bank, an island in it)
  const ring: [number, number, number][] = [];
  for (let i = 0; i <= 300; i++) ring.push([i * 7, 40 * Math.sin(i * 0.37) + 13 * Math.sin(i * 1.9), 0]);
  for (let i = 300; i >= 0; i--) ring.push([i * 7, 160 + 30 * Math.sin(i * 0.23) + 11 * Math.cos(i * 2.3), 0]);
  ring.push(ring[0]!);
  const island: [number, number, number][] = [
    [900, 80, 0],
    [1000, 80, 0],
    [1000, 110, 0],
    [900, 110, 0],
    [900, 80, 0],
  ];
  const river = polygonPrimitive([ring, island], 0, 0, 4, [0.02, 0.05, 0.04])!;
  const bands = waterBands(river);
  expect(bands.length).toBeGreaterThan(10);
  let r = 1;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 4000; k++) {
    const p: [number, number] = [-50 + rnd() * 2200, -80 + rnd() * 340];
    const whole = inside(river.data, p, river.data[2]!);
    const wholeOuter = inside(river.data, p, river.data[11]!);
    // (the band holding p — its box —; outside every band's box: outside)
    const b = bands.find((x) => p[0] >= x.min[0] && p[0] <= x.max[0] && p[1] >= x.min[1] && p[1] <= x.max[1]);
    expect(b ? inside(b.data, p, b.data[2]!) : false).toBe(whole);
    expect(b ? inside(b.data, p, Math.floor(b.data[11]!)) : false).toBe(wholeOuter);
  }
});

// trace.wgsl surfaceRecord, read from the packed buffer as the GPU reads it (float32): the record a surface's polygon is tested from
function surfaceRecord(f: Float32Array, p: [number, number], base: number): number {
  const v = (i: number) => f[i * 4]!;
  if (v(base) > -1e6) return base;
  const n = Math.round(-v(base) - 1e6);
  const y0 = f[(base + 1) * 4 + 1]!,
    y1 = f[(base + 1) * 4 + 3]!;
  if (p[1] < y0 || p[1] > y1) return -1;
  const h = Math.fround(Math.max((y1 - y0) / n, 1));
  let b = Math.min(Math.floor(Math.max((p[1] - y0) / h, 0)), n - 1);
  const root = f[6]!,
    table = root + f[base * 4 + 1]!;
  for (let k = 0; k < 3; k++) {
    const rb = root + f[table * 4 + b]!;
    const lo = f[(rb + 1) * 4 + 1]!,
      hi = f[(rb + 1) * 4 + 3]!;
    if (p[1] >= lo && p[1] <= hi) return rb;
    if (p[1] < lo && b > 0) b--;
    else if (p[1] > hi && b + 1 < n) b++;
    else break;
  }
  return base;
}
test("the surfaces' walk reads a large water polygon's band — its record's bands, the same answer as the whole (perf 24 Nov 2026)", () => {
  // (the ragged river of the test above, an island in it, packed beside a road and a small lake)
  const ring: [number, number, number][] = [];
  for (let i = 0; i <= 300; i++) ring.push([i * 7, 40 * Math.sin(i * 0.37) + 13 * Math.sin(i * 1.9), 0]);
  for (let i = 300; i >= 0; i--) ring.push([i * 7, 160 + 30 * Math.sin(i * 0.23) + 11 * Math.cos(i * 2.3), 0]);
  ring.push(ring[0]!);
  const island: [number, number, number][] = [
    [900, 80, 0],
    [1000, 80, 0],
    [1000, 110, 0],
    [900, 110, 0],
    [900, 80, 0],
  ];
  const river = polygonPrimitive([ring, island], 0, 0, 4, [0.02, 0.05, 0.04])!;
  const lake = polygonPrimitive(
    [
      [
        [0, 300, 0],
        [50, 300, 0],
        [50, 350, 0],
        [0, 300, 0],
      ],
    ],
    0,
    0,
    4,
    [0.018, 0.052, 0.055],
  )!;
  const road = surfaceSegment([0, -100, 0], [200, -100, 0], 9, 1, [0.3, 0.3, 0.3]);
  const f = new Float32Array(packScenery([], new Uint32Array(16), [road, river, lake], undefined, 4));
  const [surfAt, surfNodes, surfGeom] = [f[4]!, f[5]!, f[6]!];
  // (the surfaces' tree's polygon leaves: the river's whole record — banded — and the lake's — not)
  const polys: number[] = [];
  for (let i = 0; i < surfNodes; i++) {
    const leaf = f[(surfAt + i * 2 + 1) * 4 + 3]!;
    if (leaf >= 0 && f[(surfGeom + leaf) * 4 + 11]! > 0.5) polys.push(surfGeom + leaf);
  }
  const big = polys.find((b) => f[b * 4 + 2]! > 100)!;
  const small = polys.find((b) => b !== big)!;
  expect(f[big * 4]!).toBeLessThan(-1e6);
  expect(surfaceRecord(f, [10, 310], small)).toBe(small);
  const rec = (b: number) => Array.from(f.subarray(b * 4, b * 4 + 12 + 4 * f[b * 4 + 2]!));
  let r = 7;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  let banded = 0;
  for (let k = 0; k < 6000; k++) {
    // (over the river's box and beyond it, above and below)
    const p: [number, number] = [Math.fround(-50 + rnd() * 2200), Math.fround(-120 + rnd() * 420)];
    const whole = inside(river.data, p, river.data[2]!);
    const wholeOuter = inside(river.data, p, river.data[11]!);
    const rb = surfaceRecord(f, p, big);
    if (rb !== big && rb >= 0) banded++;
    const d = rb < 0 ? null : rec(rb);
    expect(d ? inside(d, p, d[2]!) : false).toBe(whole);
    // (the dry island's test: the record's outer ring — its colour's w)
    expect(d ? inside(d, p, Math.floor(d[11]!)) : false).toBe(wholeOuter);
  }
  // (nearly every point inside the river's height read from a band)
  expect(banded).toBeGreaterThan(3000);
});
