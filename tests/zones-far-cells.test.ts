import { expect, test } from "bun:test";
import { BDTOPO_Z } from "../src/system/bdtopo";
import { FAR_REACH_M } from "../src/system/building-far";
import { zoneCellTiles } from "../src/system/zone-cells";
import { farCellZoneChains, ZONE_FAR_REACH_M, ZONE_PROFILES, zoneChains } from "../src/system/zones";
import { OVERTURE_LIST } from "../src/system/pmtiles";

// PLAN-J8 J8-9 (1) — a zone carries the far buildings' cells round it (src/system/zones.ts farCellZoneChains): every z 15 cell within its
// radius and the far layer's reach (building-far.ts FAR_REACH_M, held equal here) — the BD TOPO's within the IGN's box, Overture's z 14
// tiles beyond, their listing first —; a zone with the scenery holds them, prepared into cells once it is in (zone-cells.ts).

const SRC = {
  ortho: false,
  relief: true,
  hlod: false,
  span: 4,
  scenery: { mode: "balanced" as const, satellite: false, reach: 1, overture: true },
};

test("the far reach: the far layer's own", () => {
  expect(ZONE_FAR_REACH_M).toBe(FAR_REACH_M);
});

test("Paris, a 5 km zone: ~3 150 BD TOPO cells within 25 km, all of the BD TOPO, each once", () => {
  const far = farCellZoneChains(48.8566, 2.3522, 5000);
  const urls = far.map((c) => c[0]!);
  expect(urls.every((u) => u.includes(`/BDTOPO/${BDTOPO_Z}/`))).toBe(true);
  expect(new Set(urls).size).toBe(urls.length);
  expect(far.length).toBeGreaterThan(2800);
  expect(far.length).toBeLessThan(3500);
});

test("Tarifa: Overture's z 14 tiles, the releases' listing first, each tile once", () => {
  const far = farCellZoneChains(36.0143, -5.6044, 2000);
  expect(far[0]).toEqual([OVERTURE_LIST]);
  const tiles = far.slice(1).map((c) => c[0]!);
  expect(tiles.every((u) => u.startsWith("kerr-overture:14/"))).toBe(true);
  expect(new Set(tiles).size).toBe(tiles.length);
});

test("a zone with the scenery holds its far cells; their cells prepared from it", () => {
  const chains = zoneChains(48.8566, 2.3522, 5000, ZONE_PROFILES.overflight, SRC as never);
  const cells = zoneCellTiles(chains);
  expect(cells.length).toBe(farCellZoneChains(48.8566, 2.3522, 5000).length);
  // (without the scenery: none)
  expect(zoneCellTiles(zoneChains(48.8566, 2.3522, 5000, ZONE_PROFILES.overflight, { ...SRC, scenery: null } as never)).length).toBe(0);
});
