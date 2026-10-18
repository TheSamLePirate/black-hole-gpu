import { afterEach, expect, test } from "bun:test";
import { CameraController } from "../src/controls";
import { fleet, fleetStart } from "../src/fleet";
import { rangerStatus } from "../src/game/status";
import { readInstruments } from "../src/net/instruments";
import { SPACE_BOUNDS } from "../src/net/instruments-space";
import { defaultSettings, presets } from "../src/settings";
import { crewSnapshot } from "../src/ui/crew-feed";
import { trajSegments } from "../src/ui/crew-space";
import { M_SECONDS } from "../src/units";
import { setSceneTime } from "../src/wormhole";
import { resetFlights } from "./helpers/flight";

// PLAN-VAISSEAUX K1: the instruments' space blocks — built in flight (the Endurance 800 km over the Earth, the Ranger
// docked), sent as JSON, read back bounded: the craft, its state about the Earth, the paths in their spheres, the
// bodies, the systems, the clocks, the light's time, the ring and the ports; the orbit's radius the Earth's; the
// heavy tick under the room's 16 KB; an untrusted event's blocks bounded, its garbage dropped.

afterEach(() => resetFlights());

test("in flight: the Endurance's space blocks, read back from JSON; the heavy tick under 16 KB", () => {
  setSceneTime(0);
  const starts = fleetStart(0, "endurance");
  const s = {
    ...defaultSettings(),
    ...presets["Earth: the Endurance, 800 km up"]!,
    vessel: "endurance" as const,
    timeSpeed: 1 / M_SECONDS,
    animate: true,
  };
  const e = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  fleet.activePose = () => e.activePoseNow();
  e.time = 0;
  e.setPilot(true);
  e.newFlight();
  e.flyFrom(starts.endurance);
  e.settleMount();
  e.sync();
  for (let k = 0; k < 3; k++) e.flyShip(1 / 30, null as never);
  e.predictPath();
  const info = e.flightInfo();
  const status = rangerStatus(s, e, info, 0);
  const json = JSON.stringify(crewSnapshot(e, info, status, 0, true));
  console.log(`  the heavy snapshot: ${(json.length / 1024).toFixed(1)} KB, free path ${info.ourFree?.pts.length ?? "none"}`);
  expect(json.length).toBeLessThan(16 * 1024);
  const r = readInstruments(JSON.parse(json))!;
  expect(r.craft).toEqual({ id: "endurance", kind: "spacecraft", name: "Endurance", lands: false, ring: true });
  // (its state about the Earth: 800 km up, ~7.45 km/s; GM 398 600 km³/s²)
  expect(r.state!.body).toBe("earth");
  const rr = Math.hypot(...r.state!.r);
  expect(rr - 6371).toBeGreaterThan(700);
  expect(rr - 6371).toBeLessThan(900);
  expect(Math.hypot(...r.state!.v)).toBeGreaterThan(7.2);
  expect(Math.hypot(...r.state!.v)).toBeLessThan(7.7);
  expect(Math.abs(r.state!.mu - 398600) / 398600).toBeLessThan(1e-3);
  expect(r.orbit!.radius).toBeGreaterThan(6370);
  expect(r.orbit!.radius).toBeLessThan(6380);
  // (the free path: its pieces about the Earth, their points at its distance)
  const seg = r.traj!.free[0]!;
  expect(seg.body).toBe("earth");
  expect(seg.pts.length).toBeLessThanOrEqual(SPACE_BOUNDS.pts);
  expect(Math.abs(Math.hypot(...seg.pts[0]!) - rr)).toBeLessThan(200);
  expect(r.bodies!.map((b) => b.id)).toEqual(expect.arrayContaining(["sun", "earth", "moon", "mars", "jupiter"]));
  expect(r.sysx!.crew).toBe(12);
  expect(r.time!.room).toBe(0);
  // (the light to the Earth from 800 km up: a few milliseconds)
  expect(r.link!.cut).toBe(false);
  expect(r.link!.light).toBeLessThan(0.1);
  expect(r.ring).not.toBeNull();
  expect(r.ports!.find((p) => p.docked === "Ranger")).toBeTruthy();
  // (the light tick: no paths, no bodies)
  const light = readInstruments(JSON.parse(JSON.stringify(crewSnapshot(e, info, status, 0, false))))!;
  expect(light.traj).toBeUndefined();
  expect(light.bodies).toBeUndefined();
  expect(light.state).toBeTruthy();
}, 60_000);

test("an untrusted event: the space blocks bounded, their garbage dropped; an older pilot's snapshot without them", () => {
  const pts = Array.from({ length: 500 }, (_, k) => [k, k, k]);
  const r = readInstruments({
    v: 1,
    t: 0,
    metrics: {},
    craft: { id: "x".repeat(99), kind: "rocket" },
    state: { body: "earth", r: [1, 2, "3"], v: [0, 0, 0], mu: 1 },
    traj: { free: Array.from({ length: 20 }, () => ({ body: "earth", pts, t: pts.map((_, k) => k) })), plan: "no" },
    nodes: [
      { in: 5, dv: [1, 2, 3], role: "depart" },
      { in: "soon", dv: [1, 2, 3] },
    ],
    sysx: { battery: 7, crew: 1e9, failures: [{ kind: "engine", fixing: 1 }] },
    link: { light: -5 },
  })!;
  expect(r.craft!.id.length).toBe(16);
  expect(r.craft!.kind).toBe("spacecraft");
  expect(r.state).toBeUndefined();
  expect(r.traj!.free.length).toBe(SPACE_BOUNDS.segs);
  expect(r.traj!.free[0]!.pts.length).toBe(SPACE_BOUNDS.pts);
  expect(r.traj!.plan).toEqual([]);
  expect(r.nodes).toEqual([{ in: 5, dv: [1, 2, 3], role: "depart" }]);
  expect(r.sysx!.battery).toBe(1);
  expect(r.sysx!.crew).toBe(99);
  expect(r.sysx!.failures).toEqual([{ kind: "engine", fixing: false }]);
  expect(r.link!.light).toBe(0);
  const old = readInstruments({ v: 1, t: 0, metrics: { alt: 1 } })!;
  expect(old.craft).toBeUndefined();
  expect(old.traj).toBeUndefined();
});

test("a path through six spheres: its points shared by the pieces, within the budget", () => {
  const n = 1200;
  const refs = Array.from({ length: n }, (_, k) => ["earth", "moon", "earth", "sun", "mars", "phobos"][Math.floor((k * 6) / n)]!);
  const p = {
    pts: Array.from({ length: n }, (_, k) => [k, 0, 0] as [number, number, number]),
    vels: [],
    times: Array.from({ length: n }, (_, k) => k),
    refs,
    fate: "continues" as const,
    nodeAt: [],
  };
  const segs = trajSegments(p, 0, 96);
  expect(segs.map((x) => x.body)).toEqual(["earth", "moon", "earth", "sun", "mars", "phobos"]);
  const total = segs.reduce((a, x) => a + x.pts.length, 0);
  expect(total).toBeLessThanOrEqual(96 + segs.length);
  expect(Math.min(...segs.map((x) => x.pts.length))).toBeGreaterThanOrEqual(2);
});
