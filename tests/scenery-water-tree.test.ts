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
