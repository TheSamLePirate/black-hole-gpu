import { afterEach, expect, test } from "bun:test";
import { cameraFrame, setHomePose } from "../src/camera";
import { CameraController } from "../src/controls";
import { fleet } from "../src/fleet";
import { ourOrbitPose } from "../src/game/place";
import { defaultSettings, presets } from "../src/settings";
import { solarBody, solarState } from "../src/system/solar";
import { C_MPS, M_METRES, M_SECONDS } from "../src/units";
import { setSceneTime } from "../src/wormhole";

// The orbit autopilot engaged in a clear orbit holds it where it is (flight lab orbit-hold-moon-100km):
// it once raised every orbit to its approach's stand-off, 10 % of the radius — the Moon's 100 km to 174,
// 334 m/s spent in two hours; the Earth's 400 km to 637.

afterEach(() => {
  fleet.tanks = null;
  fleet.spent = {};
});

for (const [body, km] of [
  ["moon", 100],
  ["earth", 400],
] as const)
  test(`ORBIT engaged ${km} km over the ${body}: held there two hours, a few m/s`, () => {
    setSceneTime(0);
    const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, target: body };
    const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
    const p = ourOrbitPose({ body, altKm: km, inc: 30 }, c.nowTime());
    setHomePose(s, p.X, p.fwd, p.up, p.vel);
    s.motion = "geodesic";
    c.setPilot(true);
    c.newFlight();
    c.sync();
    const h = () => {
      const n = c.ourNav(cameraFrame(s))!;
      const B = solarState(body, n.t).pos;
      return ((Math.hypot(...[0, 1, 2].map((k) => n.X[k]! - B[k]!)) - solarBody(body)!.radius) * M_METRES) / 1e3;
    };
    c.pilot.setAuto("orbit");
    s.timeSpeed = 20 / M_SECONDS;
    const sp0 = c.spent;
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < (7200 / 20) * 30; i++) {
      c.flyShip(1 / 30, null as never);
      lo = Math.min(lo, h());
      hi = Math.max(hi, h());
    }
    expect(c.pilot.auto).toBe("orbit");
    expect(Math.abs((lo + hi) / 2 - km)).toBeLessThan(3);
    expect((c.spent - sp0) * C_MPS).toBeLessThan(6);
  }, 120_000);
