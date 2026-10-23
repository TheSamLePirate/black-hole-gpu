import { expect, test } from "bun:test";
import { TCAS, tcasAdvise } from "../src/radar/tcas";

// The TCAS (PLAN-RADAR-AAA RD4): TCAS II's grading at its sensitivity level 5.

const own: [number, number, number] = [0, 200, 0];

test("head-on at the same height: proximate, then a TA at 40 s, an RA at 25 s", () => {
  const at = (km: number) => tcasAdvise(own, 3000, [{ id: "a", r: [0, km * 1000, 30], v: [0, -200, 0] }])[0]!;
  expect(at(25).level).toBe("other");
  expect(at(17).level).toBe("other");
  const ta = at(15);
  expect(ta.level).toBe("TA");
  expect(ta.tau).toBeCloseTo(37.5, 0);
  // (5 km off, going away: proximate only)
  expect(tcasAdvise(own, 3000, [{ id: "x", r: [0, -5000, 50], v: [0, -100, 0] }])[0]!.level).toBe("proximate");
  const ra = at(9);
  expect(ra.level).toBe("RA");
  // (it passes 30 m above: we descend)
  expect(ra.sense).toBe("descend");
});

test("an RA's sense: away from where the intruder will be, the intruder's own RA heeded", () => {
  const below = tcasAdvise(own, 3000, [{ id: "b", r: [0, 8000, -60], v: [0, -200, 0] }])[0]!;
  expect(below.sense).toBe("climb");
  const coord = tcasAdvise(own, 3000, [{ id: "b", r: [0, 8000, -60], v: [0, -200, 0] }], new Map([["b", "climb"]]))[0]!;
  expect(coord.sense).toBe("descend");
});

test("no threat: flying alongside, passing well apart, far above; the RAs inhibited near the ground", () => {
  const [apart, side, above] = tcasAdvise(own, 3000, [
    { id: "s", r: [500, 0, 0], v: [0, 200, 0] },
    { id: "p", r: [5000, 8000, 0], v: [0, -200, 0] },
    { id: "u", r: [0, 8000, 1500], v: [0, -200, 0] },
  ]).sort((a, b) => a.id.localeCompare(b.id));
  expect(apart!.level).not.toMatch(/TA|RA/);
  expect(side!.level).toBe("TA"); // (within its protected volume: 500 m, the same height)
  expect(above!.level).toBe("other");
  const low = tcasAdvise(own, 200, [{ id: "a", r: [0, 9000, 30], v: [0, -200, 0] }])[0]!;
  expect(low.level).toBe("TA");
  expect(low.sense).toBeUndefined();
});

test("out of its reach: none", () => {
  expect(tcasAdvise(own, 3000, [{ id: "far", r: [0, TCAS.range + 100, 0], v: [0, 0, 0] }])).toEqual([]);
  expect(tcasAdvise(own, 3000, [{ id: "hi", r: [0, 1000, TCAS.height + 100], v: [0, 0, 0] }])).toEqual([]);
});
