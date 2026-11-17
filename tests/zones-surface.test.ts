import { expect, test } from "bun:test";
import { SURFACE_PATH, surfaceZoneChains, ZONE_PROFILES, zoneChains, zoneEstimate } from "../src/system/zones";

// PLAN-J8 J8-9 — a zone holds the regional surface packs it reaches (earth-surface.ts: Le Bourget, the Cévennes): offline over Paris the
// Service Worker asked Le Bourget's pages of the network, no zone holding them (j8-zone-paris, kerr-mini, 17 Nov 2026).

test("Paris reaches Le Bourget's pack: its 16 pages, colour and classes; Toulon none", () => {
  const paris = surfaceZoneChains(48.8665, 2.2425, 12_356);
  expect(paris.length).toBe(32);
  expect(paris.every((c) => c.length === 1 && c[0]!.startsWith(`${SURFACE_PATH}bourget/`))).toBe(true);
  expect(paris.filter((c) => c[0]!.endsWith(".ktx2")).length).toBe(16);
  expect(surfaceZoneChains(43.124, 5.93, 5_000)).toEqual([]);
  // (a disc just short of the box — 2.3° E less its margin — none; reaching it, the region)
  expect(surfaceZoneChains(49.0, 2.2, 1_000)).toEqual([]);
  expect(surfaceZoneChains(49.0, 2.27, 1_000).length).toBe(32);
});

test("in the zone's chains, and in its size (~16 MB)", () => {
  const sources = { ortho: false, relief: true, hlod: false, span: 4 };
  const chains = zoneChains(48.95, 2.45, 1_000, ZONE_PROFILES.overflight, sources);
  const surf = chains.filter((c) => c[0]!.startsWith(SURFACE_PATH));
  expect(surf.length).toBe(32);
  expect(zoneEstimate(surf)).toBeCloseTo(16 * (966_000 + 52_000), -3);
});
