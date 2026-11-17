import { expect, test } from "bun:test";
import { IGN_LIDAR, IGN_RGEALTI } from "../src/system/earth-tiles";
import { ZONE_PROFILES, zoneChains, zoneTouchesSea } from "../src/system/zones";

// PLAN-J8 J8-A — the offline relief's rule (17 Nov 2026, agreed between the sessions): offline over Paris tiles waited on RGE ALTI — the
// game checks the LiDAR's ground against it (earth-tiles.ts ignGround: the Calanques', Giens's interpolated sea) and the zone held it
// only where the LiDAR fell short. A zone on the coast holds both at the LiDAR's levels; elsewhere the Service Worker answers a RGE ALTI
// it lacks with a 404 at once (sw.ts, pwa/rules.ts lidarTwinOf).

const SOURCES = { ortho: false, relief: true, hlod: false, span: 4 };

test("a zone on the coast: the LiDAR's ground and RGE ALTI each a chain of their own at the LiDAR's levels; inland, one chain", () => {
  const inland = zoneChains(43.124, 5.93, 1_000, ZONE_PROFILES.airport, SOURCES);
  const coast = zoneChains(43.124, 5.93, 1_000, ZONE_PROFILES.airport, { ...SOURCES, seaCheck: true });
  const pair = (c: string[]) => c[0]!.includes(IGN_LIDAR) && c.length > 1 && c[1]!.includes(IGN_RGEALTI);
  const pairs = inland.filter(pair).length;
  expect(pairs).toBeGreaterThan(10);
  // (on the coast: no such pair left at the LiDAR's levels — each its own chain —, so as many more chains as there were pairs at z ≥ 16)
  const alone = (cs: string[][]) => cs.filter((c) => c.length === 1 && c[0]!.includes(IGN_RGEALTI)).length;
  const split = alone(coast) - alone(inland);
  expect(split).toBeGreaterThan(0);
  expect(coast.length - inland.length).toBe(split);
  expect(coast.filter(pair).length).toBe(pairs - split);
});

test("whether a zone touches the sea: any point of its disc at sea or unknown", () => {
  // (the sea west of 5.9° E)
  const seaWest = (_lat: number, lon: number) => lon < 5.9;
  expect(zoneTouchesSea(43.124, 5.93, 1_000, seaWest)).toBe(false);
  expect(zoneTouchesSea(43.124, 5.93, 5_000, seaWest)).toBe(true);
  expect(zoneTouchesSea(48.86, 2.34, 12_000, () => false)).toBe(false);
  // (unknown: the safe side)
  expect(zoneTouchesSea(48.86, 2.34, 12_000, () => null)).toBe(true);
});
