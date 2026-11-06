import { afterAll, expect, test } from "bun:test";
import { setSeaFloor, simShips } from "../src/game/seasim";

// The sea's own life (src/game/seasim.ts): over a coast — land east of 6° E, the bed sloping down westwards —, the made-up
// ships lie over water deep enough for each, move smoothly (no jump, their speed theirs), the same for every caller, and none
// ever reaches the land.

const floor = (lat: number, lon: number) => (lon > 6 ? 50 : -Math.min(2000, (6 - lon) * 600));
setSeaFloor(floor);
afterAll(() => setSeaFloor(null));

const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * 111_320, (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

test("ships over the water only, the deep-water ones offshore", () => {
  const list = simShips(43, 5.8, 1_800_000_000, 30_000);
  expect(list.length).toBeGreaterThan(3);
  for (const s of list) {
    expect(floor(s.lat, s.lon)).toBeLessThan(-2);
    // (a cargo ship or a tanker under way: over 60 m of water)
    if ((s.type === 70 || s.type === 80) && s.sog > 0) expect(floor(s.lat, s.lon)).toBeLessThanOrEqual(-60);
  }
});

test("each made-up ship its own MMSI about a place", () => {
  const list = simShips(43, 5.8, 1_800_000_000, 60_000);
  expect(new Set(list.map((s) => s.mmsi)).size).toBe(list.length);
});

test("each ship moves smoothly at its speed; the same sea for every caller; never onto the land", () => {
  const t0 = 1_800_000_000;
  const a = simShips(43, 5.8, t0, 30_000);
  const again = simShips(43, 5.8, t0, 30_000);
  expect(again.map((s) => [s.mmsi, s.lat, s.lon])).toEqual(a.map((s) => [s.mmsi, s.lat, s.lon]));
  // (over an hour, second by second for some, every ship's step its speed at most — no teleport — and over the water)
  for (let k = 1; k <= 3600; k += k < 60 ? 1 : 37) {
    const b = simShips(43, 5.8, t0 + k, 60_000);
    const prev = simShips(43, 5.8, t0 + k - 1, 60_000);
    for (const s of b) {
      expect(floor(s.lat, s.lon)).toBeLessThan(-2);
      const p = prev.find((q) => q.mmsi === s.mmsi);
      if (p) expect(dist(p, s)).toBeLessThanOrEqual(s.sog * 1.02 + 0.01);
    }
  }
});

test("the shelf from the oceans' mask: the land +10, the sea deeper the farther from it", async () => {
  const { shelfFloor } = await import("../src/game/seasim");
  const f = shelfFloor((_lat, lon) => lon < 6);
  expect(f(43, 6.1)).toBe(10);
  const near = f(43, 5.99),
    off = f(43, 5.9),
    far = f(43, 5.0);
  expect(near).toBeLessThan(0);
  expect(off).toBeLessThan(near);
  expect(far).toBeCloseTo(-240, 0);
});
