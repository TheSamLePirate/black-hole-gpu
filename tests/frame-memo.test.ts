import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { defaultSettings, presets } from "../src/settings";
import { gravityHome, ourState } from "../src/system/our-side";
import { sceneBodies } from "../src/system/scene-bodies";
import { mouthAccel } from "../src/system/solar";
import { mouth } from "../src/wormhole";

// T8d: answers kept for the same arguments (the craft's frame asks the pull, the mouth and the frame's own
// acceleration a dozen times a frame at the same point and instant) — the same numbers as computed afresh.

const s = Object.assign(defaultSettings(), presets["Gargantua system (10⁸ M☉, a* = 0.998)"]);

test("gravityHome kept without V: the pull with V (never kept) gives the same acceleration", () => {
  const E = ourState("earth", 1000).pos;
  const pts: Vec3[] = [
    [E[0] + 5e-5, E[1], E[2]],
    [E[0], E[1] + 4.4e-5, E[2] - 1e-6],
    [E[0] - 3e-4, E[1] + 2e-4, E[2]],
  ];
  const V: Vec3 = [1e-5, 0, 0];
  for (const t of [1000, 1000.5, 1000]) {
    for (const X of pts) {
      const kept = gravityHome(X, t);
      const again = gravityHome(X, t);
      const fresh = gravityHome(X, t, V);
      expect(again.acc).toEqual(kept.acc);
      expect(kept.acc).toEqual(fresh.acc);
      expect(kept.inside).toBe(fresh.inside);
      expect(kept.tDyn).toBe(fresh.tDyn);
      expect(kept.tDot).toBe(0);
      // (a caller's change to its copy does not reach the next one)
      kept.acc[0] = 42;
      expect(gravityHome(X, t).acc[0]).toBe(fresh.acc[0]);
    }
  }
});

test("mouthAccel kept for the last instant: the same numbers after another instant", () => {
  const a = mouthAccel(2000);
  mouthAccel(2001);
  const b = mouthAccel(2000);
  expect(b).toEqual(a);
  b[0] = 1;
  expect(mouthAccel(2000)[0]).toBe(a[0]);
});

test("mouth kept per settings and instant: a setting changed gives the new mouth; the kept one is frozen", () => {
  const m0 = mouth(s, 10);
  expect(mouth(s, 10)).toBe(m0);
  expect(Object.isFrozen(m0) && Object.isFrozen(m0.C) && Object.isFrozen(m0.w)).toBe(true);
  const s2 = { ...s, whDist: s.whDist * 1.1 };
  const m1 = mouth(s2, 10);
  expect(m1.C).not.toEqual(m0.C);
  // (back: the same numbers as the first time)
  expect(mouth(s, 10)).toEqual(m0);
  if (s.whOrbit) expect(mouth(s, 20).C).not.toEqual(m0.C);
});

test("sceneBodies without our side: the same first entries", () => {
  const all = sceneBodies(s, 0);
  const garg = sceneBodies(s, 0, null, false);
  expect(garg.length).toBeLessThan(all.length);
  expect(all.slice(0, garg.length)).toEqual(garg);
  // (ours are never where 0: escapeRadius's bodies all within the first ones)
  expect(all.slice(garg.length).every((b) => b.where !== 0)).toBe(true);
});
