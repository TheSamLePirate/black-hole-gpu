import { expect, test } from "bun:test";
import { cameraFrame } from "../src/camera";
import { CameraController } from "../src/controls";
import { fleetStart } from "../src/fleet";
import type { Vec3 } from "../src/physics";
import { defaultSettings, presets } from "../src/settings";
import { fromEquinoctial, toEquinoctial } from "../src/system/mean-orbit";
import { coastHome, railsCoast, stableOrbitOf } from "../src/system/our-coast";
import { M_METRES, M_SECONDS } from "../src/system/solar";
import { setSceneTime } from "../src/wormhole";

// A craft on rails at high warp (our-coast.ts railsCoast, mean-orbit.ts) flies the orbit the flight's own
// integrator flies: a Kepler orbit from the osculating state, turned by the J2's secular drift, once ran
// 49 km a turn off it in a low Earth orbit — no rendezvous exact at high warp. Now within the integrator's
// own consistency (it differs from itself by ~10 m a turn with its step).

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * M_METRES;

test("equinoctial elements: a state and back, to the rounding", () => {
  for (const [r, v] of [
    [
      [7000, 100, 50],
      [0.5, 7.4, 1.1],
    ],
    [
      [-6500, 2000, 3000],
      [-3, -5, 4],
    ],
  ] as [Vec3, Vec3][]) {
    const s = fromEquinoctial(398600, toEquinoctial(398600, r, v));
    expect(Math.hypot(...s.r.map((x, i) => x - r[i]!))).toBeLessThan(1e-8);
    expect(Math.hypot(...s.v.map((x, i) => x - v[i]!))).toBeLessThan(1e-11);
  }
});

test("on rails at ×100 000 a low orbit keeps to the integrator's: tens of metres in 20 turns, not 49 km a turn", () => {
  setSceneTime(0);
  const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, vessel: "ranger" as const };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  s.motion = "geodesic";
  c.setPilot(true);
  c.newFlight();
  c.sync();
  c.flyFrom(fleetStart(c.nowTime(), "ranger").ranger);
  const n0 = c.ourNav(cameraFrame(s))!;
  const P = stableOrbitOf(n0.X, n0.V, n0.t)!.period;
  for (const turns of [3, 20]) {
    const T = turns * P;
    // (the integrator: steps of a minute)
    let R = { X: n0.X, V: n0.V },
      t = n0.t;
    while (t < n0.t + T - 1e-12) {
      const dt = Math.min(60 / M_SECONDS, n0.t + T - t);
      R = coastHome(R.X, R.V, t, dt);
      t += dt;
    }
    // (on rails: frames of 1/30 s at ×100 000 — its model rebuilt on the way, past 15 turns)
    let K = { X: n0.X, V: n0.V };
    t = n0.t;
    while (t < n0.t + T - 1e-12) {
      const dt = Math.min(3333 / M_SECONDS, n0.t + T - t);
      const r = stableOrbitOf(K.X, K.V, t)!;
      K = railsCoast(r, K.X, K.V, t, dt);
      t += dt;
    }
    expect(dist(K.X, R.X)).toBeLessThan(turns * 25);
  }
}, 120_000);
