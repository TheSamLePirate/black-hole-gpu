import { afterEach, expect, test } from "bun:test";
import { CameraController } from "../src/controls";
import { fleet } from "../src/fleet";
import { ourOrbitPose } from "../src/game/place";
import { defaultSettings, presets } from "../src/settings";
import { M_SECONDS } from "../src/units";
import { setHomePose, setRepPose } from "../src/camera";
import { mouth, setSceneTime } from "../src/wormhole";

// The warp under the hub's authority (WARP: HUB) or the pilot's (WARP: YOU): the autopilots' ceilings
// and the rails' combine; the pilot's own wish is asked for explicitly (requestWarp), kept across the
// ceilings and given back once none holds it. The frames are flown by flyShip, in its own order.

const real = 1 / M_SECONDS;

/** A frame's ceilings without a flight: a controller with only the warp's state. */
function bare(autoWarp: boolean, speed: number, railsCap = Infinity) {
  return Object.assign(Object.create(CameraController.prototype), {
    s: { autoWarp, timeSpeed: speed },
    hubWarpWant: null,
    hubWarpLimit: null,
    railsCap,
    warpWant: null,
    warpSet: speed,
    nodeWarpWant: null,
    nodeWarpSet: Number.NaN,
  }) as CameraController;
}

/** A ship in low Earth orbit, flown frame by frame; its approach autopilot (to the Moon) sets a ceiling. */
function flight(autoWarp: boolean) {
  setSceneTime(0);
  const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, target: "moon" as const };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  c.setPilot(true);
  c.setWarpAuthority(autoWarp);
  const fly = (n = 3) => {
    for (let i = 0; i < n; i++) c.flyShip(1 / 30, null as never);
  };
  const approach = () => {
    c.pilot.setAuto("approach");
    fly();
  };
  return { s, c, fly, approach };
}

test("every ceiling of a frame combines in any order, the rails' included", () => {
  for (const order of [
    [4, 1000],
    [1000, 4],
  ]) {
    const hub = bare(true, 1, 2);
    for (const x of order) hub.setHubWarp(x);
    expect(hub.hubWarpLimit).toBe(4);
    expect(hub.s.timeSpeed).toBe(2);
    const you = bare(false, 50, 2);
    for (const x of order) you.setHubWarp(x);
    expect(you.s.timeSpeed).toBe(2);
    expect(you.hubWarpWant).toBe(50);
  }
  // (a manoeuvre's warp under another ceiling of the same frame — the air's: the lower)
  const c = bare(true, 1);
  c.hubWarpLimit = 3;
  c.setNodeWarp(40);
  expect(c.hubWarpLimit).toBe(3);
  expect(c.s.timeSpeed).toBe(3);
});

test("WARP: YOU — the wish asked for is kept across the ceiling and given back when the autopilot stops", () => {
  const { s, c, fly, approach } = flight(false);
  c.requestWarp(1e6 * real);
  fly();
  expect(s.timeSpeed).toBe(1e6 * real);
  approach();
  const ceiling = c.hubWarpLimit!;
  expect(ceiling).toBeLessThan(1e6 * real);
  expect(s.timeSpeed).toBeCloseTo(ceiling, 6);
  expect(c.hubWarpWant).toBe(1e6 * real);
  // (slower than the ceiling: the scene runs at it; faster: held, kept)
  c.requestWarp(40 * real);
  fly();
  expect(s.timeSpeed).toBe(40 * real);
  c.requestWarp(5e5 * real);
  fly();
  expect(s.timeSpeed).toBeLessThan(5e5 * real);
  expect(c.hubWarpWant).toBe(5e5 * real);
  // (a video recorded at a fixed rate writes the scene's warp: not a wish of the pilot's)
  s.timeSpeed = 7 * real;
  fly();
  expect(c.hubWarpWant).toBe(5e5 * real);
  c.pilot.setAuto("approach");
  fly(1);
  expect(c.pilot.auto).toBe("none");
  expect(s.timeSpeed).toBe(5e5 * real);
  expect(c.hubWarpWant).toBeNull();
});

test("WARP: YOU — the first ceiling keeps the wish the rails held, not the warp they lowered", () => {
  const { s, c, fly, approach } = flight(false);
  c.requestWarp(1e8 * real);
  fly();
  const rails = s.timeSpeed;
  expect(rails).toBeLessThan(1e8 * real);
  expect(c.warpWant).toBe(1e8 * real);
  approach();
  expect(c.hubWarpWant).toBe(1e8 * real);
  c.pilot.setAuto("approach");
  fly();
  expect(s.timeSpeed).toBe(rails);
  expect(c.warpWant).toBe(1e8 * real);
});

test("WARP: HUB — the autopilot sets the warp and gives back the one it found", () => {
  const { s, c, fly, approach } = flight(true);
  c.requestWarp(1000 * real);
  fly();
  approach();
  expect(s.timeSpeed).toBeCloseTo(c.hubWarpLimit!, 6);
  expect(c.hubWarpWant).toBeNull();
  c.pilot.setAuto("approach");
  fly(1);
  expect(s.timeSpeed).toBe(1000 * real);
});

test("a new flight (a scene, a saved game) carries no wish held by the last one", () => {
  const { s, c, fly, approach } = flight(false);
  c.requestWarp(1e6 * real);
  approach();
  expect(c.hubWarpWant).not.toBeNull();
  c.newFlight();
  c.pilot.auto = "none";
  s.timeSpeed = 3 * real;
  fly();
  expect(s.timeSpeed).toBe(3 * real);
});

test("a manual glide holds real time, and gives the pilot's warp back once climbed out", () => {
  const { s, c, fly } = flight(false);
  c.requestWarp(50 * real);
  fly();
  const run = { alpha: 0.1 } as NonNullable<CameraController["entryRun"]>;
  c.glideAlpha(run, 0, 0, 0, 100, 0, 1000, 1 / 30, 0.3, 1.3);
  expect(s.timeSpeed).toBeCloseTo(real, 12);
  fly(1);
  expect(s.timeSpeed).toBe(50 * real);
});

test("out of the throat after a crossing: real time, unless the pilot asked for a warp on the way", () => {
  for (const asked of [false, true]) {
    setSceneTime(0);
    const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, whOrbit: false };
    const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
    c.setPilot(true);
    setRepPose(s, { l: mouth(s, 0).lGlue + 5, n: [1, 0, 0], fwd: [1, 0, 0], up: [0, 0, 1], vel: [0.01, 0, 0] });
    s.timeSpeed = 0.2;
    c.traversing = c.crossingWarp = true;
    if (asked) c.requestWarp(0.1);
    c.flyShip(1 / 30, null as never);
    expect(c.traversing).toBe(false);
    expect(s.timeSpeed).toBeCloseTo(asked ? 0.1 : 1 / (4.925490947e-6 * s.massSolar), 12);
  }
});

// (the propellant a flight here burns is the fleet's — global: given back for the other tests)
afterEach(() => {
  fleet.tanks = null;
  fleet.spent = {};
});

test("WARP: YOU — a CIRC's coast and burn never above the pilot's ×200, given back after", () => {
  setSceneTime(0);
  const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, target: "earth" as const };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const p = ourOrbitPose({ body: "earth", peKm: 250, apKm: 700, inc: 51.6 }, c.nowTime());
  setHomePose(s, p.X, p.fwd, p.up, p.vel);
  s.motion = "geodesic";
  c.setPilot(true);
  c.newFlight();
  c.sync();
  c.setWarpAuthority(false);
  c.pilot.setAuto("circularize");
  c.requestWarp(200 * real);
  let most = 0;
  for (let i = 0; i < 40000 && c.pilot.auto !== "none"; i++) {
    c.flyShip(1 / 30, null as never);
    most = Math.max(most, s.timeSpeed);
  }
  expect(c.pilot.auto).toBe("none");
  // (the node's coast ran faster than ×200 under its own: the wish replaced by the autopilot's)
  expect(most).toBeLessThanOrEqual(200 * real * (1 + 1e-9));
  expect(s.timeSpeed).toBeCloseTo(200 * real, 9);
}, 60_000);
