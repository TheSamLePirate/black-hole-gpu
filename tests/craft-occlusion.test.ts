import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// (25 Nov 2026, PROBLEMES « … mont Faron »: the F-35 drawn over a tree's crown 5–6 m from the « around » view's eye.) The craft passes
// hide an instance where the scene's occlusion depth holds something nearer (ship.wgsl, bit 0 of its flags — « far »); the flown craft
// had it only when a spectator placed it in the view. Now whenever the eye is outside it; in the cockpit, the cabin, never.

const ship = readFileSync(`${import.meta.dir}/../src/ship.ts`, "utf8");
const wgsl = readFileSync(`${import.meta.dir}/../src/shaders/ship.wgsl`, "utf8");

/** the flown craft's « far » bit as ship.ts sets it (old: a spectator's placement alone) */
const farOld = (place: boolean, _inside: boolean) => place;
const farNew = (place: boolean, inside: boolean) => place || !inside;

test("the flown craft is hidden by a nearer scene whenever the eye is outside it", () => {
  // (the « around » view, no spectator: the old rule never hid it — the positive witness)
  expect(farOld(false, false)).toBe(false);
  expect(farNew(false, false)).toBe(true);
  // (the cockpit, the cabin: never — the scene's depth there is the world's beyond the canopy)
  expect(farNew(false, true)).toBe(false);
  // (a spectator's placement: as before)
  expect(farNew(true, true)).toBe(true);
  expect(ship).toContain("far: !!v.place || !v.inside");
  // (the test itself, in the hull's fragment: hidden where the occlusion depth is nearer)
  expect(wgsl).toContain("if (sceneDepth[q.y * u32(S.img.x) + q.x] * S.img.z < length(in.p) * 0.999) { discard; }");
});
