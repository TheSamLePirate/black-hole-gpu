import { afterEach, expect, test } from "bun:test";
import { cameraFrame, setHomePose } from "../src/camera";
import { CameraController } from "../src/controls";
import { fleet } from "../src/fleet";
import { ourOrbitPose } from "../src/game/place";
import type { Vec3 } from "../src/physics";
import { defaultSettings, presets } from "../src/settings";
import { circularVelocity } from "../src/system/geopotential";
import { solarBody } from "../src/system/solar";
import { C_MPS, M_METRES, M_SECONDS } from "../src/units";
import { setSceneTime } from "../src/wormhole";

// The CIRC autopilot in our universe, flown headless frame by frame (the flight lab's circ-ap-200x600 and
// circ-pe-300x800): it circularizes at the next apsis — found on the path the craft flies, its cost said
// right —, the node flown to the mean circle there (the Earth's J2 in), the engine's run-down anticipated,
// then the trim. It spends what the circle needs where the burn starts, and the circle as flown swings the
// ~2 km the J2 itself makes. Before: the two bodies' plan was 15 % off, its impulse and the engine's tail
// overshot, the trim took it back (+20 m/s), and the point-mass circle it trimmed to swung 10 km.

function flight(o: { peKm: number; apKm: number; inc: number; nu?: number }) {
  setSceneTime(0);
  const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, target: "earth" as const };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const p = ourOrbitPose({ body: "earth", ...o }, c.nowTime());
  setHomePose(s, p.X, p.fwd, p.up, p.vel);
  s.motion = "geodesic";
  c.setPilot(true);
  c.newFlight();
  c.sync();
  const said: string[] = [];
  c.onPilotMessage = (m) => said.push(String(m));
  const nav = () => c.ourNav(cameraFrame(s))!;
  const rel = () => {
    const n = nav();
    return { n, d: [0, 1, 2].map((k) => n.X[k]! - n.refPos[k]!) as Vec3, v: [0, 1, 2].map((k) => n.V[k]! - n.refVel[k]!) as Vec3 };
  };
  /** the height over the mean radius [km] */
  const height = () => ((Math.hypot(...rel().d) - solarBody("earth")!.radius) * M_METRES) / 1e3;
  /** the Δv to the mean circle where the craft is [m/s] */
  const gain = () => {
    const { n, d, v } = rel();
    const g = circularVelocity("earth", solarBody("earth")!.mass, d, v, n.t).v;
    return Math.hypot(...g.map((x, k) => x - v[k]!)) * C_MPS;
  };
  return { s, c, said, height, gain };
}

// (the propellant these flights burn is the fleet's — global: given back for the other tests)
afterEach(() => {
  fleet.tanks = null;
  fleet.spent = {};
});

for (const [name, o, where] of [
  ["200 × 600 km at 51.6°", { peKm: 200, apKm: 600, inc: 51.6 }, "apoapsis"],
  ["300 × 800 km at 28.5°, from its apoapsis", { peKm: 300, apKm: 800, inc: 28.5, nu: 180 }, "periapsis"],
] as const)
  test(`CIRC from ${name}: at the ${where}, the Δv the circle needs, then a circle that swings only the J2's 2 km`, () => {
    const { s, c, said, height, gain } = flight(o);
    const sp0 = c.spent;
    c.pilot.setAuto("circularize");
    let ideal = Number.NaN;
    for (let i = 0; i < 20000 && c.pilot.auto !== "none"; i++) {
      // (the ideal: the impulse to the circle where the burn starts)
      if (c.nodeBurning && Number.isNaN(ideal)) ideal = gain() + (c.spent - sp0) * C_MPS;
      c.flyShip(1 / 30, null as never);
    }
    expect(c.pilot.auto).toBe("none");
    expect(said.some((m) => m.startsWith("Circular:"))).toBe(true);
    expect(said[0]).toContain(where);
    const dv = (c.spent - sp0) * C_MPS;
    expect(dv).toBeLessThan(ideal * 1.01 + 0.3);
    // (the plan said what it would cost: the apsis found on the flight's own path, not the two bodies')
    const planned = Number(/: (\d+) m\/s$/.exec(said.find((m) => m.startsWith("Circularize at")) ?? "")?.[1]);
    expect(Math.abs(planned - ideal)).toBeLessThan(0.01 * ideal + 1);
    // one revolution at ×30: the radius's extremes
    s.timeSpeed = 30 / M_SECONDS;
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < 5900; i++) {
      c.flyShip(1 / 30, null as never);
      const h = height();
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(hi - lo).toBeLessThan(3);
  }, 120_000);

test("CIRC assisted, flown by hand: cut at the cue, the engine's run-down included, the Δv given is the burn's", () => {
  // (the assist-burn e2e: 300 × 420 km at 20°, the pilot lights the burn at its cue, holds prograde and cuts
  // at the cue — the Ranger's engine runs down 7 m/s after its cut: the cue once came that late)
  const { c, height } = flight({ peKm: 300, apKm: 420, inc: 20, nu: 165 });
  c.pilot.assist = true;
  const sp0 = c.spent;
  c.pilot.setAuto("circularize");
  let dv = Number.NaN,
    lit = false,
    cut = false;
  for (let i = 0; i < 20000 && !(cut && c.pilot.engineNow < 1e-3); i++) {
    c.flyShip(1 / 30, null as never);
    c.hubCache = null;
    const cue = c.hubInfo()?.cue;
    if (!cue) continue;
    if (Number.isNaN(dv)) dv = cue.dv;
    if (cue.burning && !lit) (lit = true), (c.pilot.hold = "prograde"), (c.pilot.throttle = 1);
    if (lit && !cut && cue.cut) (cut = true), (c.pilot.throttle = 0);
  }
  expect(cut).toBe(true);
  const given = (c.spent - sp0) * C_MPS;
  expect(Math.abs(given - dv)).toBeLessThan(0.02 * dv);
  // one revolution at ×30, the trim off: the circle asked
  c.pilot.setAuto("circularize");
  c.s.timeSpeed = 30 / M_SECONDS;
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < 5700; i++) {
    c.flyShip(1 / 30, null as never);
    const h = height();
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  expect(hi - lo).toBeLessThan(3);
  expect(Math.abs((hi + lo) / 2 - 420)).toBeLessThan(3);
}, 120_000);
