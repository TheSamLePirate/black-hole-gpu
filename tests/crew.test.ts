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

test("crew build stays independent: one small JS, no shaders, workers, images or simulator engine", async () => {
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
  expect(scripts[0]!.size).toBeLessThan(200_000);
  expect(await scripts[0]!.text()).not.toMatch(/createShaderModule|requestAdapter|audio-worklet|basis_transcoder|\.wgsl/);
});
