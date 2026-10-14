import { expect, test } from "bun:test";
import { cameraFrame, setHomePose } from "../src/camera";
import { CameraController, type DockInfo } from "../src/controls";
import { ourOrbitPose } from "../src/game/place";
import { cross, dot, lin, sub } from "../src/math/vec3";
import type { Vec3 } from "../src/physics";
import { defaultSettings, presets } from "../src/settings";
import { circularVelocity } from "../src/system/geopotential";
import { solarBody } from "../src/system/solar";
import { groundVelocity } from "../src/system/our-surface";
import { C_MPS, M_METRES, M_SECONDS } from "../src/units";
import { setSceneTime } from "../src/wormhole";

function controller() {
  setSceneTime(0);
  const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, target: "earth" as const };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const p = ourOrbitPose({ body: "earth", peKm: 400, apKm: 400, inc: 51.6, nu: 45 }, c.nowTime());
  setHomePose(s, p.X, p.fwd, p.up, p.vel);
  c.setPilot(true);
  c.sync();
  return c;
}

test("speed target follows the body's, ground's and wind's velocity frames", () => {
  const c = controller();
  const nav = c.ourNav(cameraFrame(c.s))!;
  c.pilot.auto = "approach";
  c.lastWant = { beta: nav.toRep(nav.V), ff: [0, 0, 0] };
  c.windHome = [100 / C_MPS, -50 / C_MPS, 0];
  const f = c.flightInfo();
  const ground = sub(nav.V, groundVelocity(nav.ref, nav.X, nav.t));
  expect(f.wantSpeed * C_MPS).toBeCloseTo(Math.hypot(...sub(nav.V, nav.refVel)) * C_MPS, 5);
  expect(f.wantGround! * C_MPS).toBeCloseTo(Math.hypot(...ground) * C_MPS, 5);
  expect(f.wantAir! * C_MPS).toBeCloseTo(Math.hypot(...sub(ground, c.windHome)) * C_MPS, 5);
  expect(f.wantTarget! * C_MPS).toBeCloseTo(f.wantSpeed * C_MPS, 5);
  expect(f.wantSpeed * C_MPS).toBeLessThan(9000);
});

test("CIRC card reports zero error on the J2 mean circle, including radial motion", () => {
  const c = controller();
  const nav = c.ourNav(cameraFrame(c.s))!;
  const circle = circularVelocity(nav.ref, solarBody(nav.ref)!.mass, sub(nav.X, nav.refPos), sub(nav.V, nav.refVel), nav.t);
  const pose = ourOrbitPose({ body: "earth", peKm: 400, apKm: 400, inc: 51.6, nu: 45 }, c.nowTime());
  setHomePose(c.s, nav.X, pose.fwd, pose.up, lin(nav.refVel, 1, circle.v, 1));
  c.sync();
  c.pilot.auto = "circularize";
  c.ourCirc = { mode: "trim" };
  const h = c.hubCompute()!;
  expect(h.rows[0]![1]).toBe("0.0 m/s");
});

for (const [along, lateral, angle, axial, rotation] of [
  [8, 0.3, 10, -0.1, 0],
  [10, 0.3, 10, 0, 0],
  [2, 0.08, 1, (0.08 + 0.012 * 2) / 3, 0],
  [8, 0.3, 10, -0.1, 0.2],
] as const) {
  test(`dock display uses the actual axial command at ${along} m / ${lateral} m offset / ${rotation} rad/s`, () => {
    const c = controller();
    const nav = c.ourNav(cameraFrame(c.s))!;
    const axes: [Vec3, Vec3, Vec3] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const expected = axial - rotation * lateral;
    const g: DockInfo = {
      target: "iss",
      kind: "iss",
      title: "ISS",
      port: 0,
      name: "port",
      own: "ranger",
      ownPort: 0,
      range: Math.hypot(along, lateral),
      along,
      lateral,
      angle,
      closing: expected,
      lateralRate: 0,
      spin: 0,
      docked: false,
      ring: lin(nav.X, 1, [along, lateral, 0], 1 / M_METRES),
      c: nav.X,
      a: axes[0],
      ownAxis: [-1, 0, 0],
      X: nav.X,
      sh: axes,
      tgt: { X: nav.X, V: nav.V },
      A: axes,
      om: [0, 0, rotation * M_SECONDS],
      vrel: [0, 0, 0],
    };
    c.dockGeometry = () => g;
    c.ownTurn = () => [0, 0, 0];
    c.pilot.auto = "dock";
    let commanded: Vec3 = [0, 0, 0];
    c.dockWant(
      nav,
      () => null,
      (v, ff = [0, 0, 0]) => {
        commanded = v;
        return { beta: v, ff };
      },
    );
    expect(c.dockAuto!.askedClosing!).toBeCloseTo(expected, 4);
    const vp = lin(g.tgt.V, 1, cross(g.om, sub(g.ring, g.tgt.X)), 1);
    expect(-dot(sub(commanded, vp), g.a) * C_MPS).toBeCloseTo(c.dockAuto!.askedClosing!, 5);
    const h = c.dockCard()!;
    expect(h.say![0]).toBe(`CLOSE ${expected.toFixed(2)} m/s · ASKED ${c.dockAuto!.askedClosing!.toFixed(2)}`);
    expect(h.graph!.now).toEqual([along, expected]);
    expect(h.graph!.levels![0]!.y).toBeCloseTo(expected, 4);
    expect(h.graph!.state).toBe("on");
    if (along >= 8) expect(h.say!.some((s) => s.startsWith("CONTACT IN"))).toBe(false);
  });
}

test("SF director includes translation, the low-altitude sink limit and the wind", () => {
  const c = controller();
  const fr = c.sfFrame(cameraFrame(c.s))!;
  c.sfFrame = () => ({ ...fr, h: 20, up: [0, 0, 1], north: [1, 0, 0], east: [0, 1, 0], wind: [0, 20, 0], toLocal: (v: Vec3) => v });
  c.sfCmd = { speed: 100, gamma: -0.5, heading: 0 };
  c.sfWant(cameraFrame(c.s), { pitch: 0, yaw: 0, roll: 1, tx: 1, ty: -1, tz: 1, throttle: 0 }, 0);
  // The rightward slide and translation are both in, and the descent is capped at 5 m/s.
  const expected: Vec3 = [100 * Math.cos(-0.5) + 15, -35, -5];
  expect(c.sfFlown!.speed).toBeCloseTo(Math.hypot(...expected), 6);
  expect(c.sfFlown!.gamma).toBeCloseTo(Math.atan2(-5, Math.hypot(expected[0], expected[1])), 6);
  const air = sub(expected, [0, 20, 0]);
  // Our mock keeps the vector intact rather than normalizing it, so the wind correction is observable.
  expect(c.sfDirector).toEqual(air);
});

test("climb card reads the effective command's ground path and track", () => {
  const c = controller();
  const cam = cameraFrame(c.s);
  const nav = c.ourNav(cam)!;
  const fr = c.sfFrame(cam)!;
  const wantedGround = lin(fr.up, 30 / C_MPS, fr.north, 40 / C_MPS);
  c.lastWant = { beta: nav.toRep(lin(groundVelocity(nav.ref, nav.X, nav.t), 1, wantedGround, 1)), ff: [0, 0, 0] };
  c.pilot.auto = "takeoff";
  const rows = c.hubCompute()!.rows;
  expect(rows.find((r) => r[0] === "Path angle")![1]).toEndWith("→ 37°");
  expect(rows.find((r) => r[0] === "Track")![1]).toMatch(/→ (000|360)°$/);
});
