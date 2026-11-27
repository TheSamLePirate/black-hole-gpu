import { expect, test } from "bun:test";
import { trafficWind, windCrab, crabStep } from "../src/traffic/attitude";
import { reportAt } from "../src/traffic/timeline";
import { profileOf } from "../src/traffic/profile";
import { trafficContact } from "../src/traffic/contact";
import { trafficLightVisibility } from "../src/traffic/lights";
import { parseMetar } from "../src/metar";
import { fromAdsbLol, type Plane } from "../server/traffic";
import { buildNet, geoOf, type OsmEl } from "../src/game/airportnet";
import { groundPath, pathPose, observedGround } from "../src/traffic/ground-path";
import { AirportActivity } from "../src/traffic/airport-activity";
const p = (t: number, hdg: number | null): Plane => ({
  id: "aabbcc",
  cs: "TEST",
  reg: "",
  type: "A320",
  cat: "A3",
  lat: 48,
  lon: 2,
  alt: 300,
  gs: 70,
  trk: 0,
  hdg,
  roll: null,
  rate: null,
  vs: -3,
  gnd: false,
  t,
  src: "adsb.lol",
});
test("delayed heading uses its epoch and crosses north the short way; null is never north", () => {
  const hist = [p(0, 350), p(10, 10), p(20, 120)];
  expect(reportAt(hist, hist[2]!, 5).hdg).toBeCloseTo(0, 6);
  expect(reportAt(hist, hist[2]!, 5).hdg).not.toBe(120);
  expect(reportAt([p(0, null), p(10, 10)], p(10, 10), 5).hdg).toBeNull();
  const parsed = fromAdsbLol({ hex: "aabbcc", lat: 48, lon: 2, true_heading: null, roll: null, track_rate: null }, 100)!;
  expect(parsed.hdg).toBeNull();
  expect(parsed.roll).toBeNull();
  expect(parsed.rate).toBeNull();
});
test("real wind sets crab direction, headwind adds no crab, and the observed ground velocity is not drifted twice", () => {
  const east = trafficWind(parseMetar("LFPG 261200Z 09020KT 9999 SCT020 15/10 Q1013"), 10)!;
  expect(east[0]).toBeLessThan(0);
  expect(windCrab(0, 70, east)).toBeGreaterThan(0);
  expect(windCrab(0, 70, [0, -10])).toBeCloseTo(0, 8);
  let a = (20 * Math.PI) / 180;
  for (let i = 0; i < 300; i++) a = crabStep(a, 20, 15 - (i / 60) * 3, false, 1 / 60, 3);
  expect((Math.abs(a) * 180) / Math.PI).toBeLessThan(0.2);
});
test("family profiles differ and independent contacts preserve the raised nose and one main", () => {
  expect(profileOf("C172", 8).vr).toBeLessThan(profileOf("A388", 73).vr);
  expect(profileOf("CRJ9", 36).rollRate).toBeGreaterThan(profileOf("B744", 71).rollRate);
  const c = trafficContact(true, 0.08, 0.04, 13, 4, 0, 3);
  expect(c.comp[0]).toBe(0);
  expect(c.comp[1]).toBe(0);
  expect(c.comp[2]).toBeGreaterThan(0);
  expect(trafficContact(false, 0, 0, 13, 4, 0, 3).comp).toEqual([0, 0, 0]);
});
test("lights use their sectors; the lower beacon is masked when looking from above", () => {
  expect(trafficLightVisibility(-90, 0.2)).toMatchObject({ port: true, starboard: false, upper: true, lower: false, landing: false });
  expect(trafficLightVisibility(180, 0)).toMatchObject({ port: false, starboard: false, tail: true });
});
const origin = { lat: 48, lon: 2 };
function fixture() {
  const nodes = [
    [1, 100, 0],
    [2, 100, 300],
    [3, 100, 600],
    [4, 0, 600],
    [5, 0, 3600],
  ].map(([id, x, y]) => ({
    type: "node",
    id,
    ...geoOf(origin, x!, y!),
    tags: id === 3 ? { aeroway: "holding_position" } : undefined,
  })) as OsmEl[];
  const net = buildNet(
    [
      ...nodes,
      { type: "way", id: 10, nodes: [1, 2, 3, 4], tags: { aeroway: "taxiway", ref: "A" } },
      { type: "way", id: 11, nodes: [4, 5], tags: { aeroway: "runway", ref: "36/18", width: "45" } },
    ],
    origin,
  );
  net.stands.push({ ...geoOf(origin, 100, 15), hdg: 0, node: 1, ref: "1", gate: false });
  return net;
}
test("ground gaps follow the mapped L path instead of cutting the corner; impossible gaps are rejected", () => {
  const net = fixture();
  const a = { ...p(0, 0), ...geoOf(origin, 100, 100), gnd: true, gs: 5 };
  const b = { ...p(100, 0), ...geoOf(origin, 100, 550), gnd: true, gs: 5 };
  const pose = observedGround(net, [a, b], 50)!;
  expect(pose).not.toBeNull();
  expect(pose.lon).toBeCloseTo(a.lon, 5);
  expect(observedGround(net, [a, { ...b, t: 4 }], 2)).toBeNull();
  const curve = groundPath(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    12,
  );
  const c = pathPose(net, curve, 100, 5);
  expect(Number.isFinite(c.omega)).toBe(true);
});
test("supplemental traffic is labelled, yields to observations and waits with an occupied runway", () => {
  const net = fixture(),
    end = { ...geoOf(origin, 0, 600), hdg: 0 };
  const activity = new AirportActivity(net, "TEST");
  let sample = activity.step(0, [], end);
  expect(sample[0]?.origin).toBe("synthetic");
  expect(sample[0]?.p.cs).toStartWith("SIM");
  const onRunway = { ...p(0, 0), ...geoOf(origin, 0, 1000), gnd: true, gs: 0 };
  for (let i = 1; i < 4000; i++) sample = activity.step(i / 10, [onRunway], end);
  expect(sample[0]!.p.gnd).toBe(true);
  expect(sample[0]!.p.lon).toBeGreaterThan(origin.lon + 0.0005);
  const occupiedStart = new AirportActivity(net, "TEST2");
  expect(occupiedStart.step(0, [{ ...p(0, 0), ...geoOf(origin, 100, 0), gnd: true }], end)).toEqual([]);
});

test("synthetic departure waits at a holding point then rolls and climbs on a clear mapped runway", () => {
  const net = fixture(),
    activity = new AirportActivity(net, "DEPT"),
    end = { ...geoOf(origin, 0, 600), hdg: 0 };
  let air = false,
    rolling = false;
  for (let i = 0; i < 18000; i++) {
    const list = activity.step(i / 20, [], end),
      a = list[0];
    if (!a) continue;
    if (a.p.gs > 30 && a.p.gnd) rolling = true;
    if (!a.p.gnd && (a.groundPose?.over ?? 0) > 0.1) {
      air = true;
      expect(a.groundPose!.over).toBeGreaterThanOrEqual(0);
      expect(a.p.vs).toBeGreaterThan(0);
      break;
    }
  }
  expect(rolling).toBe(true);
  expect(air).toBe(true);
});

test("every model's attachments follow its scaled and rotated instance, including the rig's shifted origin", async () => {
  const { attachmentOffset, attachmentScale, ATTACHMENTS } = await import("../src/traffic/attachments");
  for (const mesh of ["a320t", "crj900"] as const)
    for (const rig of [false, true])
      for (const len of [20, 37.57, 74]) {
        const a = attachmentScale(mesh, len, rig);
        const point = ATTACHMENTS[a.model].exhaust;
        const front = attachmentOffset(a, point, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
        const turned = attachmentOffset(a, point, [0, 0, -1], [0, 1, 0], [1, 0, 0]);
        expect(turned[0]).toBeCloseTo(front[2], 6);
        expect(turned[1]).toBeCloseTo(front[1], 6);
        expect(turned[2]).toBeCloseTo(-front[0], 6);
        const mirrored = attachmentOffset(a, [-point[0], point[1], point[2]], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
        expect(mirrored[0]).toBeCloseTo(-front[0], 6);
        expect(mirrored[1]).toBeCloseTo(front[1], 6);
      }
});

test("exact airport METAR keeps live-weather ownership when leaving the airport view", async () => {
  const { RealWeather } = await import("../src/realweather");
  const { MetarFeed } = await import("../src/metar");
  const feed = new MetarFeed(async () => "LFPB 270200Z 09020KT 9999 SCT020 15/10 Q1013");
  const weather = new RealWeather(feed);
  const state = await weather.stationWeather("LFPB");
  expect(state?.source).toBe("metar");
  expect(weather.owns(state)).toBe(true);
});

test("a late observed aircraft has priority over a supplemental ground actor", () => {
  const net = fixture(),
    activity = new AirportActivity(net, "LATE"),
    end = { ...geoOf(origin, 0, 600), hdg: 0 };
  const actor = activity.step(0, [], end)[0]!;
  expect(actor).toBeDefined();
  const real = { ...p(0, 0), lat: actor.p.lat, lon: actor.p.lon, gnd: true, gs: 0 };
  expect(activity.step(0.1, [real], end)).toEqual([]);
});

test("supplemental lift-off responds to real headwind rather than a fixed ground speed", () => {
  const takeoff = (wind: boolean) => {
    const net = fixture(),
      a = new AirportActivity(net, "WIND"),
      end = { ...geoOf(origin, 0, 600), hdg: 0 };
    const weather = wind ? parseMetar("TEST 270200Z 36020KT 9999 SKC 15/10 Q1013") : null;
    for (let i = 0; i < 18000; i++) {
      const p = a.step(i / 20, [], end, weather)[0]?.p;
      if (p && !p.gnd) return p.gs;
    }
    throw Error("no takeoff");
  };
  expect(takeoff(true)).toBeLessThan(takeoff(false));
});

test("a mapped taxiway crossing a runway geometrically is excluded even without a shared graph node", async () => {
  const { crossesRunway } = await import("../src/traffic/ground-path");
  const net = fixture();
  expect(
    crossesRunway(
      net,
      groundPath([
        { x: -100, y: 1000 },
        { x: 100, y: 1000 },
      ]),
    ),
  ).toBe(true);
  expect(
    crossesRunway(
      net,
      groundPath([
        { x: 100, y: 1000 },
        { x: 100, y: 2000 },
      ]),
    ),
  ).toBe(false);
});
