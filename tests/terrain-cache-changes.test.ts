import { expect, test } from "bun:test";
import type { TileChange } from "../src/system/earth-tiles";
import { changeInRing } from "../src/system/terrain-cache";
import { TERRAIN_CACHE_LEVELS, TERRAIN_CACHE_ROUNDS, type TerrainWindow, terrainWindow } from "../src/system/terrain-cache-layout";

// T4 — where a change of the tiles falls for each level of the relief cache (terrain-cache.ts changeInRing): in the ring the
// level draws (baked again at once), hidden under the finer levels (coalesced), or outside its window.
const deg = Math.PI / 180;
const lat = 45.9 * deg,
  lon = 6.85 * deg;
const windows: (TerrainWindow | null)[] = TERRAIN_CACHE_ROUNDS.map((r) => terrainWindow(null, lon, lat, r));
const ready = Array(TERRAIN_CACHE_LEVELS).fill(true);
/** a change of a box of half-sizes [m] round a point [rad] */
const change = (la: number, lo: number, half: number, z = 15): TileChange => {
  const dl = half / 6.371e6;
  return { z, lon0: lo - dl / Math.cos(la), lon1: lo + dl / Math.cos(la), lat0: la - dl, lat1: la + dl, seq: 1 };
};

test("a tile's change at the camera: visible in the finest levels, hidden under them for the coarse ones", () => {
  // (a z 17 tile's box, 300 m round the camera)
  const c = change(lat, lon, 300, 17);
  const w = windows.map((_, k) => changeInRing(k, c, windows, ready));
  console.log(`  300 m round the camera: ${w.join(", ")}`);
  expect(w[0]).toBe("visible");
  // (level 3's inner band — the 9.5 m level's window less 17 nodes: ±47 × 6.6 m ≈ ±310 m east–west at 46° — holds the
  // 300 m box: hidden from level 3 on, visible in the finer levels' rings)
  for (let k = 3; k < TERRAIN_CACHE_LEVELS; k++) expect(w[k]).toBe("hidden");
});

test("a change 25 km out: outside the fine windows, visible in the ring that holds it", () => {
  // (25 km east: past the 153 m level's window, inside the 611 m level's — ±27 km east–west at 46°: the lattice's longitudes
  // shrink with cos(lat) —, in its ring; the 2.4 km level's ring too — its inner band, the 611 m window less 17 nodes, ±20 km
  // —; hidden under them for the 9.8 km level)
  const c = change(lat, lon + 25_000 / (6.371e6 * Math.cos(lat)), 1000, 11);
  const w = windows.map((_, k) => changeInRing(k, c, windows, ready));
  console.log(`  25 km east: ${w.join(", ")}`);
  for (let k = 0; k <= 4; k++) expect(w[k]).toBe("none");
  expect(w[5]).toBe("visible");
  expect(w[6]).toBe("visible");
  expect(w[7]).toBe("hidden");
});

test("a change across the inner window's edge, a finer level not ready, every level (z −1), the antimeridian: visible", () => {
  // (a box straddling the 38 m level's window edge: visible in the 153 m level's ring)
  const per = TERRAIN_CACHE_ROUNDS[3] / (2 * Math.PI);
  const edgeLon = (windows[3]!.i + 128) / per;
  expect(changeInRing(4, change(lat, edgeLon, 500, 13), windows, ready)).toBe("visible");
  const notReady = [...ready];
  notReady[3] = false;
  expect(changeInRing(4, change(lat, lon, 300, 17), windows, notReady)).toBe("visible");
  expect(changeInRing(5, { z: -1, lon0: -Infinity, lon1: Infinity, lat0: -Math.PI / 2, lat1: Math.PI / 2, seq: 1 }, windows, ready)).toBe(
    "visible",
  );
  // (near the antimeridian, a change logged a turn away — longitudes unwrapped — still found)
  const w2 = TERRAIN_CACHE_ROUNDS.map((r) => terrainWindow(null, 179.99 * deg, 10 * deg, r));
  const c = change(10 * deg, 179.99 * deg - 2 * Math.PI, 300, 17);
  expect(changeInRing(0, c, w2, ready)).toBe("visible");
  expect(changeInRing(6, c, w2, ready)).toBe("hidden");
});

test("a window placed ahead along the motion: the camera crosses 56 nodes before it moves again, not 32", () => {
  const round = TERRAIN_CACHE_ROUNDS[0];
  const node = (2 * Math.PI) / round;
  const travel = (dir: [number, number] | null) => {
    let w = terrainWindow(null, lon, lat, round, dir)!;
    // (moved once: from there, the nodes flown east before the next move)
    let x = lon;
    for (let n = 1; n < 400; n++) {
      x += node * 0.5;
      const w2 = terrainWindow(w, x, lat, round, dir)!;
      if (w2 !== w) {
        w = w2;
        const start = x;
        for (let m = 1; m < 400; m++) {
          x += node * 0.5;
          if (terrainWindow(w, x, lat, round, dir) !== w) return (x - start) / node;
        }
      }
    }
    return -1;
  };
  const centred = travel(null),
    ahead = travel([1, 0]);
  console.log(`  nodes crossed between two moves: centred ${centred}, ahead ${ahead}`);
  expect(centred).toBeCloseTo(32, 0);
  expect(ahead).toBeCloseTo(56, 0);
});
