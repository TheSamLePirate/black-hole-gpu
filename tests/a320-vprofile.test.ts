import { expect, test } from "bun:test";
import { PATH_FT_NM, placeAlong, vprofile } from "../src/a320/fmgc/vprofile";
import type { Waypoint } from "../src/game/flightplan";

// The A320's managed vertical profile (docs/PLAN-A320-VOL-AAA.md N3 — src/a320/fmgc/vprofile.ts): the descent path back from the
// destination on 3°, its constraints, the T/C, the T/D, DECEL and the predictions — on a straight plan along the equator (a degree of
// longitude ≈ 60.04 NM there), then the deviation from the path once descending.

const FT = 0.3048;
const east = (name: string, nm: number, extra: Partial<Waypoint> = {}): Waypoint => ({ name, lat: 0, lon: nm / 60.04, ...extra });
const plan = (): Waypoint[] => [
  east("ORIG", 0, { field: { icao: "ORIG", elev: 0 } }),
  east("A", 20),
  east("B", 60, { cstr: [null, 10000 * FT] }),
  east("C", 200),
  east("D", 260, { cstr: [8000 * FT, null] }),
  east("IF", 290, { cstr: [3000 * FT, 3000 * FT], proc: { kind: "arr", approach: "I09", join: true } }),
  east("DEST", 300, { field: { icao: "DEST", elev: 100 * FT } }),
];

test("climbing: T/C after B's « at or below 10 000 », T/D where the path back from DEST meets FL300, DECEL 5 NM before the IF", () => {
  const W = plan();
  const p = vprofile({ wps: W, active: 1, distTo: 10 * 1852, alt: 3000, crz: 30000, gs: 300, vs: 2000, descending: false })!;
  const at = (n: string) => p.pts.find((x) => W[x.i]!.name === n)!;
  // (at 2 000 ft/min and 300 kt: 400 ft a NM — B at 50 NM: 3 000 + 20 000 → held at 10 000)
  expect(at("B").alt).toBe(10000);
  expect(at("B").missed).toBeFalse();
  // (the climb resumed after B: FL300 reached 50 NM + 20 000/400 = 100 NM on)
  expect(p.tc).toBeCloseTo(100, 0);
  // (the IF's « at 3 000 »: 10 NM before DEST at 3° is 3 280 ft — held at 3 000; D's « at or above 8 000 » 40 NM before DEST)
  expect(at("IF").alt).toBe(3000);
  expect(at("D").alt).toBeGreaterThanOrEqual(8000);
  // (the T/D: from the IF's 3 000 back up to 30 000 at 318 ft/NM: 84.9 NM before the IF; the IF at 280 NM from the craft)
  // (and the 5 NM level stretch at FL100 where the speed comes down to 250 kt: the T/D 5 NM earlier)
  // (and 5 NM level at the IF's 3 000 before it — DECEL to the IF, the slowing to green dot)
  const tdWant = 280 - (30000 - 3000) / PATH_FT_NM - 5 - 5;
  expect(Math.abs(p.td! - tdWant)).toBeLessThan(1);
  expect(p.decel).toBeCloseTo(275, 0);
  expect(p.vdev).toBeNull();
  // (the cruise between: FL300 at 150 NM; C, at 200 NM, past the T/D — on the path)
  expect(p.pathAt(150)).toBe(30000);
  expect(at("C").alt).toBe(Math.round(p.pathAt(at("C").along)));
  expect(at("C").alt).toBeLessThan(30000);
});

test("a constraint the climb cannot make: missed (amber on the ND); descending: VDEV, no T/D ahead", () => {
  const W = plan();
  W[2]!.cstr = [12000 * FT, null];
  // (from 3 000 ft at 1 000 ft/min: B, 50 NM on at 300 kt, reached at ~13 000? 200 ft a NM → 13 000 — made; slower 500 ft/min: 2 000 ft → no)
  const slow = vprofile({ wps: W, active: 1, distTo: 10 * 1852, alt: 3000, crz: 30000, gs: 300, vs: 600, descending: false })!;
  expect(slow.pts.find((x) => W[x.i]!.name === "B")!.missed).toBeTrue();
  // (descending 40 NM before D at 15 000 ft: the craft far under the path — VDEV the difference)
  const d = vprofile({ wps: W, active: 4, distTo: 40 * 1852, alt: 15000, crz: 30000, gs: 300, vs: -1500, descending: true })!;
  expect(d.td).toBeNull();
  expect(d.vdev).toBe(Math.round(15000 - d.pathAt(0)));
  // (back from the IF: 5 NM level at 3 000, 22 NM up to FL100, 5 NM level — D, 30 NM back, in it —, then 38 NM of slope to here)
  expect(Math.abs(d.pathAt(0) - (10000 + (40 - 2) * PATH_FT_NM))).toBeLessThan(30);
  expect(d.vdev).toBeLessThan(-5000);
});

test("placeAlong: a place x NM on the legs ahead", () => {
  const W = plan();
  const p = placeAlong(W, 1, { lat: 0, lon: 10 / 60.04 }, 30)!;
  expect(p.lon * 60.04).toBeCloseTo(40, 0);
});
