import { expect, test } from "bun:test";
import { TalkGate } from "../src/crew/ptt";
import { readInstruments } from "../src/net/instruments";
import { sampleGeo, relative, type CrewCraft } from "../src/crew/model";
import { emptyVisual, type CraftSample } from "../src/net/proto";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";

test("PTT: permission arriving after release never transmits; reconnect also requires a fresh press", () => {
  const changes: boolean[] = [];
  const gate = new TalkGate((v) => changes.push(v));
  gate.press("finger");
  gate.release("finger");
  gate.availability(true, true);
  expect(gate.active).toBe(false);
  gate.press("finger");
  expect(gate.active).toBe(true);
  gate.availability(true, false);
  expect(gate.active).toBe(false);
  gate.availability(true, true);
  expect(gate.active).toBe(false);
  expect(changes).toEqual([true, false]);
});

test("PTT: independent pointers, accessible toggle and interrupted gestures close correctly", () => {
  const gate = new TalkGate(() => {});
  gate.availability(true, true);
  gate.press("finger1");
  gate.press("finger2");
  gate.release("finger1");
  expect(gate.active).toBe(true);
  gate.cancel();
  expect(gate.active).toBe(false);
  gate.toggle();
  expect(gate.active).toBe(true);
  gate.availability(false, true);
  expect(gate.active).toBe(false);
  gate.availability(true, true);
  expect(gate.active).toBe(false);
  gate.toggle();
  gate.toggle();
  expect(gate.active).toBe(false);
});

test("untrusted instruments: invalid versions, non-finite readings, geographic bounds and collection limits", () => {
  expect(readInstruments({ v: 2, t: 1, metrics: {} })).toBeNull();
  expect(readInstruments({ v: 1, t: NaN, metrics: {} })).toBeNull();
  const data = readInstruments({
    v: 1,
    t: 42,
    body: "earth",
    metrics: { alt: 123, heat: Infinity, invented: 5 },
    geo: { lat: 100, lon: 0, heading: 0 },
    route: Array.from({ length: 100 }, () => ({ lat: 48, lon: 2, name: "test" })),
    ahead: [],
    radar: {
      mode: "TWS",
      contacts: [
        { e: NaN, n: 3, dz: 4 },
        { id: "one", name: "contact", e: 20, n: 100, dz: 5, locked: true },
      ],
    },
  });
  expect(data?.metrics).toEqual({ alt: 123 });
  expect(data?.geo).toBeNull();
  expect(data?.route).toHaveLength(64);
  expect(data?.radar?.contacts).toHaveLength(1);
  expect(data?.radar?.contacts[0]?.locked).toBe(true);
});

const sample = (lat: number, lon: number): CraftSample => ({
  slot: 0,
  seq: 0,
  t: 0,
  frame: 0,
  body: 0,
  kind: 3,
  flags: 0,
  p: geodeticToCart(WGS84_A, WGS84_F, (lat * Math.PI) / 180, (lon * Math.PI) / 180, 1500),
  v: [0, 0, 0],
  q: [0, 0, 0, 1],
  w: [0, 0, 0],
  a: [0, 0, 0],
  vis: emptyVisual(),
});
const craft = (s: CraftSample): CrewCraft => ({
  member: { slot: 0, name: "Pilot", colour: "#ffffff", role: "pilot", device: "p" },
  kind: "f35",
  sample: s,
  geo: sampleGeo(s),
  body: "earth",
  age: 0,
  snapshot: null,
  metrics: {},
});
test("geographic fallback respects WGS84 at Paris and the poles and rejects inertial/Gargantua frames", () => {
  for (const [lat, lon] of [
    [48.85, 2.35],
    [89.99, -70],
    [-89.99, 150],
  ]) {
    const s = sample(lat!, lon!);
    const g = sampleGeo(s)!;
    expect(g.lat).toBeCloseTo(lat!, 7);
    expect(g.lon).toBeCloseTo(lon!, 7);
    expect(sampleGeo({ ...s, frame: 1 })).toBeNull();
    expect(sampleGeo({ ...s, frame: 2 })).toBeNull();
  }
  const a = craft(sample(48, 2)),
    b = craft(sample(48, 2.01));
  expect(relative(a, b)?.e).toBeGreaterThan(700);
  expect(relative(a, b)?.distance).toBeLessThan(800);
  expect(relative(a, craft({ ...b.sample, body: 1 }))).toBeNull();
});

test("crew build stays independent: one small JS, no shader files, workers, images or simulator engine (the globe's WebGPU inline)", async () => {
  const build = await Bun.build({
    entrypoints: ["./crew/index.html"],
    outdir: "/tmp/kerr-crew-build-test",
    target: "browser",
    minify: true,
  });
  expect(build.success).toBe(true);
  expect(build.outputs.every((o) => /\.(html|js|css)$/.test(o.path))).toBe(true);
  const scripts = build.outputs.filter((o) => o.path.endsWith(".js"));
  expect(scripts).toHaveLength(1);
  // (its budget: the instruments, the actions, the globe's renderer, the coasts — 197 KB minified; the spacecraft
  // console, its 3D map, its views and stations (PLAN-VAISSEAUX K2–K5) — 257 KB on 2026-10-18, ~70 KB gzipped)
  expect(scripts[0]!.size).toBeLessThan(320_000);
  // (WebGPU only for the globe's photographed Earth, its shader inline — asked once the globe is shown: the e2e counts it)
  expect(await scripts[0]!.text()).not.toMatch(/audio-worklet|basis_transcoder|\.wgsl|ktx2|scenery-worker|plan-worker/);
});

test("instruments v1 grows by optional blocks: flight, autopilot, plan, systems, alerts, traffic and zones bounded", () => {
  const data = readInstruments({
    v: 1,
    t: 3,
    body: "earth",
    metrics: {},
    flight: { pitch: 0.1, bank: -0.2, hdg: 1, tas: 200, agl: NaN, wind: { spd: 5, from: 4 } },
    auto: { mode: "plane", assist: "realistic", alt: 9000, hdg: null, spd: "x", lnav: true, vnav: 1, hub: { title: "T", bar: 0.5 } },
    nav: { active: 400, dist: 1000, brg: 0.5, ete: Infinity },
    sys: { engine: "F135", fuelKg: 5000, gear: 1, gearDown: true },
    warn: Array.from({ length: 40 }, () => "STALL"),
    traffic: Array.from({ length: 300 }, (_, i) => ({
      id: `t${i}`,
      name: "AFR1",
      kind: "boat",
      side: "traffic",
      lat: 48,
      lon: 2,
      alt: 3000,
      hdg: 1,
      spd: 200,
    })),
    zones: [
      { lat: 45, lon: 5, r: 32_000, name: "SA-6", kind: "threat" },
      { lat: 95, lon: 0, r: 1 },
    ],
  })!;
  expect(data.flight?.tas).toBe(200);
  expect(data.flight?.agl).toBeUndefined();
  expect(data.flight?.wind).toEqual({ spd: 5, from: 4 });
  expect(data.auto?.spd).toBeNull();
  expect(data.auto?.vnav).toBe(false);
  expect(data.auto?.hub?.bar).toBe(0.5);
  expect(data.nav?.active).toBe(63);
  expect(data.nav?.ete).toBeNull();
  expect(data.sys?.gearDown).toBe(true);
  expect(data.warn).toHaveLength(12);
  expect(data.traffic).toHaveLength(128);
  expect(data.traffic![0]!.kind).toBe("air");
  expect(data.zones).toEqual([{ lat: 45, lon: 5, r: 32_000, name: "SA-6", kind: "threat", waiting: false }]);
  // an older pilot's snapshot: the blocks absent, nothing invented
  const old = readInstruments({ v: 1, t: 1, metrics: {}, route: [], ahead: [] })!;
  expect(old.flight).toBeNull();
  expect(old.traffic).toBeUndefined();
});

test("WGS84 geodesy for the crew's displays: distances and azimuths on the ellipsoid, offsets by its radii", async () => {
  const { wgs84Inverse, wgs84Offset } = await import("../src/system/ellipsoid");
  // Paris–Lyon (the geodesic on WGS84: 391.5 km), a degree of latitude at the equator (110 574 m) and at the pole (111 694 m)
  const pl = wgs84Inverse(48.8566, 2.3522, 45.764, 4.8357);
  expect(Math.abs(pl.d - 391_500)).toBeLessThan(600);
  expect(Math.abs(wgs84Inverse(-0.5, 0, 0.5, 0).d - 110_574)).toBeLessThan(5);
  expect(Math.abs(wgs84Inverse(88.5, 0, 89.5, 0).d - 111_694)).toBeLessThan(5);
  expect(Math.abs(wgs84Inverse(48, 2, 48.1, 2).az)).toBeLessThan(1e-9);
  expect(Math.abs(wgs84Inverse(0, 2, 0, 3).az - Math.PI / 2)).toBeLessThan(1e-9);
  // 10 km east then measured back
  const q = wgs84Offset(48.85, 2.35, 10_000, 0);
  expect(Math.abs(wgs84Inverse(48.85, 2.35, q.lat, q.lon).d - 10_000)).toBeLessThan(2);
  const n = wgs84Offset(48.85, 2.35, 0, 10_000);
  expect(Math.abs(wgs84Inverse(48.85, 2.35, n.lat, n.lon).d - 10_000)).toBeLessThan(1);
});

test("the map: Web Mercator round trips, the land's rings closed and Antarctica through its pole", async () => {
  const { mercX, mercY, unMercX, unMercY, metresPerPx } = await import("../src/crew/draw/tiles");
  expect(unMercX(mercX(2.35))).toBeCloseTo(2.35, 9);
  expect(unMercY(mercY(48.85))).toBeCloseTo(48.85, 9);
  expect(metresPerPx(0, 0)).toBeCloseTo(156_543.03, 1);
  const { LAND } = await import("../src/crew/draw/land");
  expect(LAND.length).toBeGreaterThan(100);
  const south = LAND.find((r) => r.pts.some((p) => p[1] === -90))!;
  expect(south.hi - south.lo).toBeGreaterThan(355);
  // (the longitudes continuous along every ring, but for the closure along the pole itself)
  for (const r of LAND)
    for (let k = 1; k < r.pts.length; k++)
      if (Math.abs(r.pts[k]![1]) !== 90) expect(Math.abs(r.pts[k]![0] - r.pts[k - 1]![0])).toBeLessThanOrEqual(180);
});
