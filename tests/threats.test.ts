import { expect, test } from "bun:test";
import { AIR_MISSIONS } from "../src/game/airmissions";
import { completeMission, patchMission } from "../src/game/missionedit";
import { aspectOf, bearingOf, braa, clockOf, newThreatWatch, THREAT, type ThreatFrame, threatStep } from "../src/game/threats";
import { unitsOf } from "../src/ui/unitsys";

// PLAN-AVIATION-AAA I2: TARS the backseater — the clock, the bearing, the aspect, a bandit's BRAA; the watch calling a
// missile launched at us at once with its way to defend (break and flares; a SAM's notch and chaff), again closing in,
// its end; new hostiles gathered into a group's call; the calls that are not a missile's spaced; a SAM site seen. A
// mission modified as TARS would: a SAM moved to Ajaccio, the truck dropped, the weather turned to a storm.

const D = Math.PI / 180;
const u = unitsOf("metric");

test("the clock, the bearing, the aspect, the BRAA", () => {
  // (heading north: east at 3 o'clock; heading east: north at 9)
  expect(clockOf([1000, 0, 0], 0)).toBe(3);
  expect(clockOf([0, -1000, 0], 0)).toBe(6);
  expect(clockOf([0, 1000, 0], 90 * D)).toBe(9);
  expect(clockOf([0, 1000, 0], 0)).toBe(12);
  expect(bearingOf([1000, 1000, 0])).toBe(45);
  expect(bearingOf([-1000, 0, 0])).toBe(270);
  // (north of us flying south: hot; flying north: cold; flying east: beam)
  expect(aspectOf([0, 20_000, 0], [0, -250, 0])).toBe("hot");
  expect(aspectOf([0, 20_000, 0], [0, 250, 0])).toBe("cold");
  expect(aspectOf([0, 20_000, 0], [250, 0, 0])).toBe("beam");
  expect(aspectOf([0, 20_000, 0], [150, -200, 0])).toBe("flanking");
  expect(braa([22_627, 22_627, 1000], [-180, -180, 0], 5000, u)).toBe("045, 32 km, 6000 m, hot");
});

test("the watch: a missile at us called at once, closing in, defeated; bandits as a group; a SAM site; the gaps", () => {
  const W = newThreatWatch();
  const F = (t: number, o: Partial<ThreatFrame> = {}): ThreatFrame => ({
    t,
    hdg: 0,
    v: [0, 250, 0],
    tracks: [],
    missiles: [],
    events: [],
    ...o,
  });
  // a missile from 4 o'clock, 9 km: launch, break right
  const m = { id: 7, kind: "r73" as const, r: [7800, -4500, 0], v: [-600, 300, 0] };
  let c = threatStep(W, F(0, { missiles: [m] }), 5000, u);
  expect(c).toEqual([{ kind: "launch", priority: 1, text: "Missile launch, 4 o'clock, 9 km — break right, flares" }]);
  expect(threatStep(W, F(0.1, { missiles: [m] }), 5000, u)).toEqual([]);
  // closing in under 3 km: again, once
  const near = { ...m, r: [2400, -1300, 0] };
  c = threatStep(W, F(5, { missiles: [near] }), 5000, u);
  expect(c.map((x) => x.text)).toEqual(["Missile 4 o'clock, close — break now!"]);
  // decoyed: said in turn
  c = threatStep(W, F(6, { events: [{ kind: "decoyed", missile: 7 }] }), 5000, u);
  expect(c.map((x) => x.text)).toEqual(["Missile decoyed"]);
  expect(W.missiles.size).toBe(0);
  // a SAM from 10 o'clock: the notch
  c = threatStep(W, F(7, { missiles: [{ id: 8, kind: "sam", r: [-12_000, 7000, -4000], v: [800, -400, 300] }] }), 5000, u);
  expect(c[0]!.text).toBe("SAM launch, 10 o'clock, 14 km — notch it, chaff");
  // three bandits within the group's moment: one call, the nearest's BRAA
  const b = (id: string, r: number[], v = [0, -250, 0]) => ({ id, name: id, iff: "hostile" as const, kind: "air" as const, r, v });
  const tr = [b("cmb:1", [0, 40_000, 1000]), b("cmb:2", [2000, 41_000, 1000])];
  expect(threatStep(W, F(20, { tracks: tr }), 5000, u)).toEqual([]);
  tr.push(b("cmb:3", [-1000, 30_000, 0]));
  threatStep(W, F(20.5, { tracks: tr }), 5000, u);
  c = threatStep(W, F(20 + THREAT.group, { tracks: tr }), 5000, u);
  expect(c.map((x) => x.text)).toEqual(["3 bandits, nearest 358, 30 km, 5000 m, hot"]);
  // a friend or a neutral: never called; a SAM site: by its name and clock — after the gap
  const site = { id: "cmb:9", name: "SA-6", iff: "hostile" as const, kind: "ground" as const, r: [20_000, 0, -5000], v: [0, 0, 0] };
  const friend = { ...b("cmb:4", [0, 5000, 0]), iff: "friend" as const };
  expect(threatStep(W, F(22, { tracks: [...tr, site, friend] }), 5000, u)).toEqual([]);
  c = threatStep(W, F(20 + THREAT.group + THREAT.gap, { tracks: [...tr, site, friend] }), 5000, u);
  expect(c.map((x) => x.text)).toEqual(["SA-6, 3 o'clock, 21 km"]);
  // the nearest coming within 10 km hot: called close
  tr[2] = b("cmb:3", [500, 9000, 0]);
  c = threatStep(W, F(30, { tracks: tr }), 5000, u);
  expect(c.map((x) => x.text)).toEqual(["Bandit close, 12 o'clock, 9.0 km, hot"]);
  // a hit at once; a kill in turn
  c = threatStep(W, F(31, { events: [{ kind: "hit", on: "player", by: "r73", damage: 35 }] }), 5000, u);
  expect(c.map((x) => x.text)).toEqual(["We're hit — damage 35 %"]);
  c = threatStep(W, F(34, { events: [{ kind: "kill", target: 3, name: "Bandit 3", by: "aim120" }] }), 5000, u);
  expect(c.map((x) => x.text)).toEqual(["Splash one — Bandit 3"]);
  expect(W.log.length).toBeGreaterThan(5);
});

test("a mission modified as TARS would: the SAM moved to Ajaccio, the truck dropped, a storm", async () => {
  const base = AIR_MISSIONS.find((m) => m.id === "corsica-strike")!.make();
  const AJACCIO = { lat: 41.9236, lon: 8.8029, name: "LFKJ" };
  const sk = patchMission(
    base,
    {
      weather: { preset: "storm" },
      units: [{ id: "sam", kind: "sam", at: { place: "Ajaccio" } }],
      remove: ["truck"],
    },
    "corsica-strike-x",
  );
  const { spec, errors } = await completeMission(sk, { resolve: (n) => (/ajaccio/i.test(n) ? AJACCIO : null) });
  expect(errors).toEqual([]);
  const s = spec!;
  expect(s.id).toBe("corsica-strike-x");
  expect(s.weather?.preset).toBe("storm");
  expect(s.units.find((x) => x.id === "sam")).toMatchObject({ at: { lat: AJACCIO.lat, lon: AJACCIO.lon }, name: "SA-6" });
  expect(s.units.some((x) => x.id === "truck")).toBe(false);
  expect(s.objectives.some((o) => o.id === "truck")).toBe(false);
  // (the truck's objective gone with it: the landing, after it, now after the one before it — the SAM's —, its words
  // its own)
  const home = s.objectives.find((o) => o.id === "home")!;
  expect(home.after).toBe(base.objectives.find((o) => o.id === "truck")!.after);
  expect(home.text).toEqual(base.objectives.find((o) => o.id === "home")!.text);
  expect(s.objectives.find((o) => o.id === "sam")!.text).toEqual(base.objectives.find((o) => o.id === "sam")!.text);
  // (the places moved: the time allowed made again; the start where it was)
  expect(s.start.lat).toBe(base.start.lat);
  expect(s.title).toBe(base.title);
});
