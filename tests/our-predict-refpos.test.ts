import { expect, test } from "bun:test";
import { earthStart } from "../src/system/our-side";
import { ourApsides, ourClosest, predictOurs } from "../src/system/our-predict";
import { solarState } from "../src/system/solar";

// The predicted path carries its reference body's place at each point (OurPath.refPos — audit AR-05, 13 Nov 2026): the map's
// apsides and closest approach read it instead of asking the ephemeris again on the main thread. Same answers either way.

test("refPos is the reference body's place at each point's time", () => {
  const t0 = 109.6;
  const s = earthStart(t0, 400, true);
  const p = predictOurs(s.X, s.vel, t0);
  expect(p.refPos!.length).toBe(p.pts.length);
  for (const i of [0, 1, Math.floor(p.pts.length / 2), p.pts.length - 1]) {
    const q = solarState(p.refs[i]!, p.times[i]!).pos;
    expect(p.refPos![i]!).toEqual(q);
  }
});

test("the apsides and the closest approach: the same with the places carried as without", () => {
  const t0 = 109.6;
  const s = earthStart(t0, 400, true);
  const p = predictOurs(s.X, s.vel, t0);
  const bare = { ...p, refPos: undefined };
  expect(ourApsides(p, p.refs[0]!)).toEqual(ourApsides(bare, p.refs[0]!));
  expect(ourClosest(p, "earth")).toEqual(ourClosest(bare, "earth"));
  expect(ourClosest(p, "moon")).toEqual(ourClosest(bare, "moon"));
});
