import { afterEach, expect, test } from "bun:test";
import { cameraFrame } from "../src/camera";
import { ourGroundPose } from "../src/game/place";
import { add, dot, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The director's view flown frame by frame by the controller itself (no page): the Ranger in plane mode over
// the Atlantic, the view's step (its shot, the mount's easing) run with the flight — the camera moves, the
// craft's flight is the same as from the chase's fixed mount; the shot's pose a real one; left, the lens given back.

afterEach(resetFlights);

function run(mount: string, seconds: number) {
  const g = ourGroundPose("earth", 45, -30, 0);
  const X = add(g.X, scale(g.up, 2000 / M_METRES));
  const r = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, 200 / C_MPS)), landed: undefined }, false);
  const c = r.c;
  c.s.flightMode = "plane";
  // (the scene's own view settled first, as the app's scenes do — then the view asked, eased to from it: the
  // craft's attitude the same whatever view is asked)
  c.settleMount();
  c.s.shipMount = mount;
  c.pilot.throttle = 0.4;
  const poses: { eye: number[]; aim: number[]; fov: number }[] = [];
  const dt = 1 / 30;
  for (let k = 0; k < seconds * 30; k++) {
    // (the view's part of the frame — lens.ts —, then the flight)
    if (c.outsideView() === "director") c.cineStep(dt);
    else c.cineLeave();
    c.stepMount(dt);
    c.flyShip(dt, null as never);
    if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
    const p = c.shipPose();
    poses.push({ eye: [...p.eye], aim: [...p.aim], fov: c.s.fov });
  }
  const nose = c.shipAxesLocal(cameraFrame(c.s))[2];
  return { c, poses, X: c.activePoseNow()!.X as number[], nose };
}

test("the director moves the camera, not the craft: the same flight as from the chase", () => {
  const a = run("chase", 20);
  const b = run("director", 20);
  const d = Math.hypot(...a.X.map((x, i) => x - b.X[i]!)) * M_METRES;
  expect(d).toBeLessThan(0.5);
  // (the nose in the local frame: the same way)
  expect(dot(a.nose, b.nose)).toBeGreaterThan(Math.cos((0.01 * Math.PI) / 180));
}, 120_000);

test("its shot: a pose about the craft that moves smoothly, the lens its own", () => {
  const { poses, c } = run("director", 15);
  expect(c.cineOut).not.toBeNull();
  let jump = 0;
  for (let k = 30; k < poses.length; k++) {
    const p = poses[k]!,
      q = poses[k - 1]!;
    // (a cut — the fly-by's still camera — is a jump by design: skipped)
    const step = Math.hypot(...p.eye.map((x, i) => x - q.eye[i]!));
    if (step < 200) jump = Math.max(jump, step);
  }
  // (a frame's move under 10 m at 200 m/s: the eye eased, not snapped)
  expect(jump).toBeLessThan(10);
  for (const p of poses) {
    expect(p.eye.every(Number.isFinite)).toBe(true);
    expect(p.fov).toBeGreaterThan(0.3);
    expect(p.fov).toBeLessThan(150);
  }
}, 120_000);

test("out of the director's view: its lens given back", () => {
  const { c } = run("director", 3);
  const base = c.cineFovBase!;
  expect(base).toBeGreaterThan(0);
  c.s.shipMount = "chase";
  c.cineLeave();
  expect(c.fovTarget).toBe(base);
  expect(c.cineOut).toBeNull();
}, 120_000);
