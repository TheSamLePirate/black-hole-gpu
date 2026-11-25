import { afterAll, expect, test } from "bun:test";
import { aboveEarthGround } from "../src/camera/subjectcam";
import { SIM_SHIP_LAND_M, simShipOnLand } from "../src/controller/seatraffic";
import { geoidDeg } from "../src/system/geoid-grid";
import { bodyFixedOf, fromBodyFixed, groundRelief, setGroundHeights, toBodyFixed } from "../src/system/our-surface";
import { M_METRES } from "../src/units";

// (25 Nov 2026, the campaign's San Francisco shot: buildings upside down in the sky over Brisbane Lagoon.) A fishing boat of the sea's
// own life sailed over the lagoon's shore — its lanes checked against the oceans' mask, ~8 km a pixel —, and the chase view 76 m
// behind it, 17 m over the sea, stood 19–28 m under the ground there (tiles in or not): the town's ground and houses seen from beneath.
// Two guards: the made-up ships on land are not drawn (the world's ground there over the sea by more than SIM_SHIP_LAND_M); the chase
// view never under the ground (aboveEarthGround). The witness: without them the boat is drawn on land and the view stays under it.

const D = Math.PI / 180;
// (a shore along 37.677° N: land north of it 35 m over the sea, the sea south — the relief over the WGS84 figure, the geoid added)
const relief = (q: number[]) => {
  const lat = Math.asin(q[2]!) / D,
    lon = Math.atan2(q[1]!, q[0]!) / D;
  return (lat > 37.677 ? 35 : 0) + geoidDeg(lat, lon);
};
afterAll(() => setGroundHeights("earth", null));

test("a made-up ship on land is not drawn; one at sea is; none judged without the relief", () => {
  setGroundHeights("earth", null);
  expect(simShipOnLand(37.68, -122.39)).toBe(false);
  setGroundHeights("earth", relief);
  expect(groundRelief("earth", bodyFixedOf("earth", 37.68, -122.39, 0)) - geoidDeg(37.68, -122.39)).toBeGreaterThan(SIM_SHIP_LAND_M);
  expect(simShipOnLand(37.68, -122.39)).toBe(true);
  expect(simShipOnLand(37.67, -122.39)).toBe(false);
});

test("the chase view under the ground is raised to 2.5 m over it; over it, left where it is", () => {
  setGroundHeights("earth", relief);
  const t = 0;
  // (17 m over the sea over the land: 18 m under its ground)
  const N = geoidDeg(37.68, -122.39);
  const under = fromBodyFixed("earth", bodyFixedOf("earth", 37.68, -122.39, 17 + N), t);
  const raised = aboveEarthGround(under, t, 2.5);
  const R = (X: number[]) => Math.hypot(...toBodyFixed("earth", X as [number, number, number], t));
  const ground = Math.hypot(...bodyFixedOf("earth", 37.68, -122.39, 35 + N));
  expect((R(raised) - ground) * M_METRES).toBeCloseTo(2.5, 0);
  // (positive witness: the view as placed stood 18 m under it)
  expect((R(under) - ground) * M_METRES).toBeLessThan(-17);
  // (over the sea at 17 m: untouched)
  const sea = fromBodyFixed("earth", bodyFixedOf("earth", 37.67, -122.39, 17 + geoidDeg(37.67, -122.39)), t);
  expect(aboveEarthGround(sea, t, 2.5)).toEqual(sea);
});
