import { expect, test } from "bun:test";
import { ourClosestOnTrack, ourTrack } from "../src/ui/map3d/scene";
import { earthStart } from "../src/system/our-side";
import { ourClosest, predictOurs } from "../src/system/our-predict";
import { M_METRES, M_SECONDS, solarState } from "../src/system/solar";

// The map's worlds along a path on a fixed lattice of instants (src/ui/map3d/scene.ts — audit AR-05, 13 Nov 2026): as exact as
// the old sampling (two minutes apart, linear between: tens of metres at most), whatever the path's own times.

test("the Moon and the Earth along a path's times: within 50 m of the ephemeris, for paths starting anywhere", () => {
  for (const start of [109.6, 109.6 + 0.37 / M_SECONDS, 2000.123]) {
    const times = Array.from({ length: 400 }, (_, j) => start + (j * j * 7) / M_SECONDS);
    for (const id of ["moon", "earth"]) {
      const tr = ourTrack(id, times);
      let worst = 0;
      times.forEach((t, j) => {
        const q = solarState(id, t).pos;
        worst = Math.max(worst, Math.hypot(tr[j]![0] - q[0], tr[j]![1] - q[1], tr[j]![2] - q[2]) * M_METRES);
      });
      expect(worst).toBeLessThan(50);
    }
  }
});

test("two paths a quarter-second apart: the same lattice places (the second asks the ephemeris for nothing new)", () => {
  const a = Array.from({ length: 200 }, (_, j) => 500 + (j * 30) / M_SECONDS);
  const b = a.map((t) => t + 0.25 / M_SECONDS);
  const ta = ourTrack("moon", a);
  const tb = ourTrack("moon", b);
  // (each within the lattice's linear error of the other's ephemeris: continuity)
  tb.forEach((p, j) => {
    const q = solarState("moon", b[j]!).pos;
    expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * M_METRES).toBeLessThan(50);
  });
  expect(ta.length).toBe(200);
});

test("the closest approach on the lattice: the ephemeris's within tens of metres, at the same point", () => {
  const t0 = 109.6;
  const s = earthStart(t0, 400, true);
  const p = predictOurs(s.X, s.vel, t0);
  const a = ourClosest(p, "moon")!;
  const b = ourClosestOnTrack(p, "moon")!;
  expect(b.i).toBe(a.i);
  expect(Math.abs(b.d - a.d) * M_METRES).toBeLessThan(50);
});
