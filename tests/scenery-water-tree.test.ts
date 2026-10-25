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
