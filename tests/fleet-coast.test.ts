import { afterEach, expect, test } from "bun:test";
import { cameraFrame } from "../src/camera";
import { CameraController } from "../src/controls";
import { fleet, fleetStart } from "../src/fleet";
import type { Vec3 } from "../src/physics";
import { defaultSettings, presets } from "../src/settings";
import { coastHome } from "../src/system/our-coast";
import { M_METRES, M_SECONDS } from "../src/system/solar";
import { setSceneTime } from "../src/wormhole";

// The fleet's craft not flown fall as the flown one does (our-coast.ts coastHome, fleet.stepFree each
// frame): the Ranger let go 150 m off the Endurance's port, both coasting an orbit, keep the relative
// motion the flight's own gravity gives them — the oblateness's short terms, the Moon's and the Sun's
// pulls, the thermosphere — not the analytic coast's: the Endurance once wandered 23–51 km from where
// the flown craft's physics would have it in an orbit, and no rendezvous with it could be exact.

afterEach(() => {
  fleet.tanks = null;
  fleet.spent = {};
});

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

for (const warp of [20, 5000])
  test(`the Ranger and the Endurance coasting an orbit side by side at ×${warp}: their separation the flight's own`, () => {
    setSceneTime(0);
    const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, vessel: "ranger" as const };
    const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
    s.motion = "geodesic";
    c.setPilot(true);
    c.newFlight();
    c.sync();
    const starts = fleetStart(c.nowTime(), "ranger");
    c.flyFrom(starts.ranger);
    expect(c.placeNearPort("endurance", 150)).toBeNull();
    c.pilot.auto = "none";
    const ship = () => c.ourNav(cameraFrame(s))!;
    // (both from here, the frames' own steps, by the same fall — what the flight's gravity makes of them)
    const n0 = ship();
    const e0 = fleet.pose("endurance", n0.t)!;
    let R = { X: n0.X, V: n0.V },
      E = { X: e0.X, V: e0.V };
    s.timeSpeed = warp / M_SECONDS;
    const frames = Math.ceil((6000 / warp) * 30);
    for (let i = 0; i < frames; i++) {
      const t0 = c.nowTime();
      c.flyShip(1 / 30, null as never);
      const dt = c.nowTime() - t0;
      R = coastHome(R.X, R.V, t0, dt);
      E = coastHome(E.X, E.V, t0, dt);
    }
    // (the Endurance's next frame caught up: as at a frame's start)
    fleet.stepFree(c.nowTime());
    const n1 = ship();
    const e1 = fleet.pose("endurance", n1.t)!;
    // (the Endurance: the fall itself, to the millimetre)
    expect(Math.hypot(...sub(e1.X, E.X)) * M_METRES).toBeLessThan(1e-3);
    // (the Ranger flown: its own air — the Ranger's shape in the thermosphere, not a ballistic craft's —
    // a few metres over the orbit; their separation so too, where it once was 23–27 km off)
    const flown = sub(n1.X, e1.X),
      want = sub(R.X, E.X);
    expect(Math.hypot(...sub(flown, want)) * M_METRES).toBeLessThan(10);
  }, 120_000);
