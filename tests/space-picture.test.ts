import { expect, test } from "bun:test";
import {
  bodyBetween,
  buildSpacePicture,
  lvlhAxes,
  SPACE_SENSOR,
  SPACE_SENSORS,
  scopeRadius,
  scopeXY,
  type SpaceObject,
  type V3,
} from "../src/radar/space";

// The spacecraft's sensors (PLAN-RADAR-AAA RD4): LVLH, the rendezvous radar's reach, the lidar, the datalink, the body
// between.

const RE = 6_371_000;
const MU = 3.986004418e14;
/** a circular orbit's place and velocity at height h [m], an angle along it [rad] */
const orbit = (h: number, a: number): { p: V3; v: V3 } => {
  const r = RE + h,
    s = Math.sqrt(MU / r);
  return { p: [r * Math.cos(a), r * Math.sin(a), 0], v: [-s * Math.sin(a), s * Math.cos(a), 0] };
};
const station = (o: { p: V3; v: V3 }, extra: Partial<SpaceObject> = {}): SpaceObject => ({
  id: "iss",
  name: "ISS",
  p: o.p,
  v: o.v,
  rcs: 2000,
  kind: "station",
  ...extra,
});

test("LVLH: V-bar along our way, R-bar up, H-bar the orbit's normal", () => {
  const o = orbit(400_000, 0);
  const A = lvlhAxes(o.p, o.v);
  expect(A.R[0]).toBeCloseTo(1, 6);
  expect(A.V[1]).toBeCloseTo(1, 6);
  expect(A.H[2]).toBeCloseTo(1, 6);
});

test("the Ranger's radar: the station 300 km ahead on its orbit — on the V-bar, closing on a lower orbit", () => {
  const us = orbit(380_000, 0);
  const iss = orbit(420_000, 300_000 / (RE + 420_000));
  const [T] = buildSpacePicture(us, [station(iss)], SPACE_SENSORS.ranger!, RE);
  expect(T).toBeDefined();
  expect(T!.sensors & SPACE_SENSOR.RADAR).toBeTruthy();
  expect(T!.sensors & SPACE_SENSOR.LIDAR).toBe(0);
  expect(T!.range).toBeGreaterThan(290_000);
  expect(T!.lvlh[0]).toBeGreaterThan(280_000); // (ahead)
  expect(Math.abs(T!.lvlh[1])).toBeLessThan(1); // (in our plane)
});

test("out of reach, a small craft: not held; the datalink's always; the lidar close", () => {
  const us = orbit(400_000, 0);
  const far = orbit(400_000, 600_000 / (RE + 400_000));
  const small: SpaceObject = { id: "lander", name: "Lander", p: far.p, v: far.v, rcs: 20, kind: "craft" };
  expect(buildSpacePicture(us, [small], SPACE_SENSORS.ranger!, RE)).toEqual([]);
  const [dl] = buildSpacePicture(us, [{ ...small, datalink: true }], SPACE_SENSORS.ranger!, RE);
  expect(dl!.sensors).toBe(SPACE_SENSOR.DATALINK);
  const near = orbit(400_000, 2_000 / (RE + 400_000));
  const [L] = buildSpacePicture(us, [station(near)], SPACE_SENSORS.ranger!, RE);
  expect(L!.sensors & SPACE_SENSOR.LIDAR).toBeTruthy();
});

test("the body between: hidden from the radar, the datalink kept", () => {
  const us = orbit(400_000, 0);
  const opposite = orbit(400_000, Math.PI);
  expect(bodyBetween(us.p, opposite.p, RE)).toBe(true);
  expect(buildSpacePicture(us, [station(opposite)], SPACE_SENSORS.endurance!, RE)).toEqual([]);
  const [T] = buildSpacePicture(us, [station(opposite, { datalink: true })], SPACE_SENSORS.endurance!, RE);
  expect(T!.hidden).toBe(true);
  expect(T!.sensors).toBe(SPACE_SENSOR.DATALINK);
});

test("the Lander about the Moon: the Endurance 150 km ahead in lunar orbit held by its radar", () => {
  const RM = 1_737_400,
    MUM = 4.9048695e12;
  const o = (h: number, a: number): { p: V3; v: V3 } => {
    const r = RM + h,
      s = Math.sqrt(MUM / r);
    return { p: [r * Math.cos(a), r * Math.sin(a), 0], v: [-s * Math.sin(a), s * Math.cos(a), 0] };
  };
  const us = o(100_000, 0);
  const end = o(110_000, 150_000 / (RM + 110_000));
  const [T] = buildSpacePicture(us, [{ id: "endurance", name: "Endurance", ...end, rcs: 800, kind: "craft" }], SPACE_SENSORS.lander!, RM);
  expect(T!.sensors & SPACE_SENSOR.RADAR).toBeTruthy();
  expect(T!.rate).toBeLessThan(5);
});

test("the space scope's places (the HUD's and the crew's): the V-bar up, the H-bar right, the range by its logarithm", () => {
  expect(scopeRadius(100)).toBe(0);
  expect(scopeRadius(10_000)).toBeCloseTo(0.5, 9);
  expect(scopeRadius(5e6)).toBe(1);
  const [x1, y1] = scopeXY([1000, 0, 0], 1000);
  expect(x1).toBeCloseTo(0, 9);
  expect(y1).toBeCloseTo(0.25, 9);
  const [x2, y2] = scopeXY([0, 100_000, 0], 100_000);
  expect(x2).toBeCloseTo(0.75, 9);
  expect(y2).toBeCloseTo(0, 9);
  // (straight above us: at the top)
  expect(scopeXY([0, 0, 1000], 1000)).toEqual([0, 0.25]);
});
