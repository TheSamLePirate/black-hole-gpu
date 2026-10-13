import { afterEach, expect, test } from "bun:test";
import { cameraFrame, setHomePose } from "../src/camera";
import { ourGroundPose } from "../src/game/place";
import { add, dot, scale } from "../src/math/vec3";
import { qConj, qLog, qMul } from "../src/cine/follow";
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
    // (the flight, then the view's part of the frame — lens.ts's late update)
    c.flyShip(dt, null as never);
    if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
    if (c.outsideView() === "director") c.cineStep(dt);
    else c.cineLeave();
    c.stepMount(dt);
    c.lensApply(c.outsideView() === "director" ? c.cineFov : null);
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
  const base = c.lensBase!;
  expect(base).toBeGreaterThan(0);
  c.s.shipMount = "chase";
  c.cineLeave();
  c.lensApply(null);
  expect(c.fovTarget).toBe(base);
  expect(c.cineOut).toBeNull();
}, 120_000);

test("the chase softened (the rig): the same flight, the view's jolts on a hard roll smoothed", () => {
  const roll = (soft: "off" | "chase") => {
    const g = ourGroundPose("earth", 45, -30, 0);
    const X = add(g.X, scale(g.up, 2000 / M_METRES));
    const r = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, 200 / C_MPS)), landed: undefined }, false);
    const c = r.c;
    c.s.flightMode = "plane";
    c.s.camSoft = soft;
    c.settleMount();
    c.s.shipMount = "chase";
    c.pilot.throttle = 0.4;
    const input = c.pilotInput.bind(c);
    const dt = 1 / 30;
    let prevQ = c.viewWorld().q,
      prevW: number[] | null = null,
      jerk = 0;
    for (let k = 0; k < 6 * 30; k++) {
      // (a full roll input from 2 s to 3 s: the roll's rate on and off at once)
      c.pilotInput = k >= 60 && k < 90 ? (pad) => ({ ...input(pad), roll: 1 }) : input;
      c.flyShip(dt, null as never);
      if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
      c.stepMount(dt);
      const q = c.viewWorld().q;
      const w = qLog(qMul(q, qConj(prevQ))).map((x) => x / dt);
      if (prevW && k > 45) jerk = Math.max(jerk, Math.hypot(...w.map((x, i) => x - prevW![i]!)));
      prevW = w;
      prevQ = q;
    }
    return { jerk, X: c.activePoseNow()!.X as number[], nose: c.shipAxesLocal(cameraFrame(c.s))[2] };
  };
  const rigid = roll("off"),
    soft = roll("chase");
  if (process.env.TRACE) console.log({ rigid: rigid.jerk, soft: soft.jerk });
  expect(Math.hypot(...rigid.X.map((x, i) => x - soft.X[i]!)) * M_METRES).toBeLessThan(0.5);
  expect(dot(rigid.nose, soft.nose)).toBeGreaterThan(Math.cos((0.01 * Math.PI) / 180));
  expect(soft.jerk).toBeLessThan(0.5 * rigid.jerk);
}, 120_000);

test("placed or reloaded in the director's view: the craft as asked, not turned by the last shot", () => {
  // (a craft placed with the director's view on, its shot never stepped: the fixed default's relation)
  const fresh = run("director", 0);
  const g = ourGroundPose("earth", 45, -30, 0);
  const X = add(g.X, scale(g.up, 2000 / M_METRES));
  const pose = { ...g, X, vel: add(g.vel, scale(g.fwd, 200 / C_MPS)), landed: undefined };
  const placed = () => {
    setHomePose(fresh.c.s, pose.X, pose.fwd, pose.up, pose.vel);
    fresh.c.s.anchor = "wormhole";
    fresh.c.newFlight();
    return fresh.c.shipAxesLocal(cameraFrame(fresh.c.s))[2];
  };
  const first = placed();
  // (twenty seconds of shots, then placed again at the same pose: the same attitude)
  const { c } = run("director", 20);
  expect(c.cineOut).not.toBeNull();
  setHomePose(c.s, pose.X, pose.fwd, pose.up, pose.vel);
  c.s.anchor = "wormhole";
  c.newFlight();
  expect(c.cineOut).toBeNull();
  const again = c.shipAxesLocal(cameraFrame(c.s))[2];
  expect(dot(first, again)).toBeGreaterThan(Math.cos((0.01 * Math.PI) / 180));
}, 120_000);

test("a save in the director's view: the camera's pose on the craft kept, the craft reloaded as it pointed", () => {
  const { c } = run("director", 12);
  const nose = c.shipAxesLocal(cameraFrame(c.s))[2];
  const view = structuredClone(c.lastPose!);
  const cam = { yaw: c.s.yaw, pitch: c.s.pitch, roll: c.s.roll };
  // (as load does: a new flight, the scene's mount settled, the camera's settings as saved, the view held)
  c.newFlight();
  c.settleMount();
  Object.assign(c.s, cam);
  c.holdMount(view);
  const loaded = c.shipAxesLocal(cameraFrame(c.s))[2];
  expect(dot(nose, loaded)).toBeGreaterThan(Math.cos((0.01 * Math.PI) / 180));
  // (the director's next shot moves the camera, not the craft)
  c.cineStep(1 / 30);
  c.stepMount(1 / 30);
  expect(dot(nose, c.shipAxesLocal(cameraFrame(c.s))[2])).toBeGreaterThan(Math.cos((0.05 * Math.PI) / 180));
}, 120_000);

test("taking the controls drops a camera travel under way", () => {
  const { c } = run("chase", 0);
  c.setPilot(false);
  (c as unknown as { travel: unknown }).travel = { t: 0, T: 3 };
  c.setPilot(true);
  expect(c.travel).toBeNull();
}, 120_000);
