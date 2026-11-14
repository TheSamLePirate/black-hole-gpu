import { expect, test } from "bun:test";
import { TERRAIN_CACHE_N } from "../src/system/terrain-cache-layout";
import { ringCut } from "../src/system/terrain-raster";
import { terrainRasterMesh } from "../src/system/terrain-raster-mesh";

// A far ring's triangles kept (terrain-raster.ts ringCut, 14 Nov 2026: its corners' boxes worked out once a grid, four comparisons a
// triangle) — the very set the corners tested one by one kept before (x = v·ratio + hole in (RING_OVERLAP, last − RING_OVERLAP) at all
// three: cut out), on the rings' real grid, for holes on and off the nodes and both ratios.
const RING_OVERLAP = 4;
function before(mesh: { vertices: Float32Array; indices: Uint32Array }, hole: [number, number], ratio: number) {
  const v = mesh.vertices,
    ix = mesh.indices;
  const last = TERRAIN_CACHE_N - 1;
  const inside = (k: number) => {
    const x = v[3 * k]! * ratio + hole[0],
      y = v[3 * k + 1]! * ratio + hole[1];
    return x > RING_OVERLAP && x < last - RING_OVERLAP && y > RING_OVERLAP && y < last - RING_OVERLAP;
  };
  const out: number[] = [];
  for (let i = 0; i < ix.length; i += 3)
    if (!(inside(ix[i]!) && inside(ix[i + 1]!) && inside(ix[i + 2]!))) out.push(ix[i]!, ix[i + 1]!, ix[i + 2]!);
  return out;
}

test("ringCut keeps the very triangles the corner-by-corner test kept", () => {
  const mesh = terrainRasterMesh({} as never, 12, new Float32Array(4));
  const last = TERRAIN_CACHE_N - 1;
  let checked = 0;
  for (const ratio of [2, 4])
    for (const h of [0, 1, 4, 37.5, -(last / 2), -(last * 0.75), -(last - 8), 2 - last / ratio])
      for (const k of [0, -3, 6, -(last / 3)]) {
        const hole: [number, number] = [h, h + k];
        const { kept, n } = ringCut(mesh, hole, ratio);
        const got = Array.from(kept.subarray(0, n));
        const want = before(mesh, hole, ratio);
        expect(n).toBe(want.length);
        expect(got).toEqual(want);
        checked++;
      }
  expect(checked).toBe(64);
});
