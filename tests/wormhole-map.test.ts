import { expect, test } from "bun:test";
import { cameraFrame, setRepPose } from "../src/camera";
import { defaultSettings, presets } from "../src/settings";
import { mouth, projectedRepVelocity, setSceneTime, tunnelState } from "../src/wormhole";
import { wormholeMapPose } from "../src/system/wormhole-map";
import { predictWormhole, wormholeSampleAt } from "../src/system/wormhole-predict";
import { ourScene, theirScene } from "../src/ui/map3d/scene";
import { advanceToMouth, driftToGlue } from "../src/system/wormhole-flight";
import { fromZamo } from "../src/geodesic";
import { CameraController } from "../src/controls";
import { lensesOf } from "../src/lenses";
import type { Vec3 } from "../src/physics";

const scene = () => ({ ...defaultSettings(), ...presets["Earth: the Blue Marble"], motion: "geodesic" as const });

test("the physical tunnel scales with its length, not the lensing envelope", () => {
  for (const length of [0.001, 0.01, 1, 10, 20]) {
    const s = { ...scene(), whLength: length },
      m = mouth(s, 0),
      a = (length * s.whRho) / 2;
    expect(tunnelState(m.w, -a).inside).toBe(true);
    expect(tunnelState(m.w, a).inside).toBe(true);
    expect(tunnelState(m.w, a * (1 + 1e-8)).inside).toBe(false);
    expect(tunnelState(m.w, -a * (1 + 1e-8)).universe).toBe("ours");
    expect(tunnelState(m.w, 0).progress).toBe(0.5);
    expect(tunnelState(m.w, 0).length).toBe(length * s.whRho);
    expect(m.lGlue).toBeGreaterThan(a);
  }
});

test("both map mouths use the throat radius, including non-default radii", () => {
  for (const rho of [0.01, 0.05, 1.5, 20]) {
    const s = { ...scene(), whRho: rho };
    expect(ourScene(0, rho).byId.get("wormhole")!.radius).toBe(rho);
    expect(theirScene(s, 0, false).byId.get("wormhole")!.radius).toBe(rho);
  }
});

test("map positions stay finite across the cylinder and Dneg exit, without changing flight frames", () => {
  setSceneTime(0);
  const s = scene(),
    m = mouth(s, 0);
  for (const ell of [-0.01, -m.w.a, 0, m.w.a, 0.01, m.lGlue, m.lGlue + 1e-6]) {
    setRepPose(s, { l: ell, n: [1, 0, 0], fwd: [1, 0, 0], vel: [0.01, 0, 0] });
    const cam = cameraFrame(s, 0),
      map = wormholeMapPose(s, cam, 0, cam.fwd, "ours")!;
    expect([...map.X, ...map.V, ...map.nose].every(Number.isFinite)).toBe(true);
    expect(map.tunnel.inside).toBe(Math.abs(ell) <= m.w.a);
    expect(map.universe).toBe(ell <= m.w.a ? "ours" : "gargantua");
    expect(cam.region).toBe(ell <= m.lGlue ? "throat" : "hole");
  }
  expect(projectedRepVelocity(m.w, 0, [1, 0, 0], [0.1, 0.2, 0])).toEqual([0, 0.2, 0]);
});

test("prediction records entry, centre and exit at their physical times in both directions", () => {
  setSceneTime(0);
  for (const dir of [-1, 1]) {
    const s = { ...scene(), system: "none" as const, whOrbit: false };
    setRepPose(s, { l: -dir * 0.001, n: [1, 0, 0], fwd: [1, 0, 0], vel: [dir * 0.01, 0, 0] });
    const path = predictWormhole(s, 0, dir > 0 ? "ours" : "gargantua", { horizon: 1 });
    expect(path.reason).toBe("horizon");
    expect(path.events.map((e) => e.kind)).toEqual(["entry", "centre", "exit"]);
    for (const [i, time] of [0.075, 0.1, 0.125].entries()) expect(path.events[i]!.t).toBeCloseTo(time, 7);
    expect(path.samples.at(-1)!.universe).toBe(dir > 0 ? "gargantua" : "ours");
    expect(wormholeSampleAt(path, 0.5, dir > 0 ? "ours" : "gargantua")).toBeNull();
    const sample = wormholeSampleAt(path, 0.5, dir > 0 ? "gargantua" : "ours")!;
    expect(sample.ell).toBeCloseTo(dir * 0.004, 7);
    expect(path.samples.every((q, j, a) => j === 0 || q.t > a[j - 1]!.t)).toBe(true);
  }
});

test("prediction at an explicit time does not mutate the render clock or caller settings", () => {
  setSceneTime(123);
  const s = scene();
  setRepPose(s, { l: 0, n: [1, 0, 0], fwd: [1, 0, 0], vel: [0.01, 0, 0] });
  const before = structuredClone(s),
    C = mouth(s).C;
  const path = predictWormhole(s, 800, "ours", { horizon: 0.1 });
  expect(path.samples[0]!.t).toBe(800);
  expect(s).toEqual(before);
  expect(mouth(s).C).toEqual(C);
});

test("Dneg exits stop at the gluing event and thrust only consumes the elapsed time", () => {
  const m = mouth(scene(), 0);
  const pose = {
    l: m.lGlue - 0.01,
    n: [1, 0, 0] as [number, number, number],
    fwd: [1, 0, 0] as [number, number, number],
    up: [0, 0, 1] as [number, number, number],
    vel: [0.01, 0, 0] as [number, number, number],
  };
  const velocityAt = (dt: number): [number, number, number] => [0.01 + 0.001 * dt, 0, 0];
  const out = driftToGlue(m.w, pose, 0, 20, 1, false, m.lGlue, velocityAt);
  expect(out.elapsed).toBeLessThan(1);
  expect(out.vel[0]).toBeCloseTo(velocityAt(out.elapsed)[0], 10);
  expect(out.l).toBeGreaterThan(m.lGlue);
  expect(out.l - m.lGlue).toBeLessThan(1e-12);
});

test("a large Kerr step stops at the mouth instead of jumping through the Dneg domain", () => {
  const s = { ...scene(), whOrbit: false },
    m = mouth(s, 0);
  setSceneTime(0);
  setRepPose(s, { l: m.lGlue + 0.01, n: [1, 0, 0], fwd: [-1, 0, 0], vel: [-0.01, 0, 0] });
  const c = cameraFrame(s, 0),
    st = fromZamo(c.r, c.theta, c.phi, c.beta, s.spin, 0);
  const out = advanceToMouth(s, st, 100, 0, [0, 0, 0], lensesOf(s));
  expect(out.st.t).toBeGreaterThan(0);
  expect(out.st.t).toBeLessThan(2);
  expect(out.stopped).toBe(false);
});

test("the segmented prediction agrees with actual controller flight through Dneg and Kerr", () => {
  const s = { ...scene(), whOrbit: false, gyroscopes: false };
  setSceneTime(0);
  setRepPose(s, { l: -0.001, n: [1, 0, 0], fwd: [1, 0, 0], up: [0, 0, 1], vel: [0.01, 0, 0] });
  const path = predictWormhole(s, 0, "ours", { horizon: 80 });
  let t = 0;
  const c = Object.assign(Object.create(CameraController.prototype), {
    s,
    properTime: 0,
    subCap: 400,
    nowTime: () => t,
    sync: () => {},
    localFlight: () => null,
    lens: () => lensesOf(s),
  }) as CameraController;
  for (let j = 0; j < 4000 && t < 80 - 1e-8; j++) {
    setSceneTime(t);
    t = c.fallStep(Math.min(0.025, 80 - t), [0, 0, 0], false)!;
  }
  expect(t).toBeCloseTo(80, 7);
  const live = cameraFrame(s, t),
    map = wormholeMapPose(s, live, t, live.fwd, "ours")!;
  expect(live.region).toBe("hole");
  const predicted = path.samples.at(-1)!;
  const error = Math.hypot(...map.X.map((v, j) => v - predicted.X[j]!));
  expect(error).toBeLessThan(1e-6);
});

test("a late prediction cannot restore the previous geometry's path", async () => {
  const s = { ...scene(), whOrbit: false };
  setRepPose(s, { l: 0, n: [1, 0, 0], fwd: [1, 0, 0], vel: [0.01, 0, 0] });
  const c = Object.assign(Object.create(CameraController.prototype), {
    s,
    gravity: true,
    tunnelEntry: "ours",
    predictionGeneration: 0,
    predictionContext: "",
    nowTime: () => 0,
  }) as CameraController;
  c.predictPath();
  s.whLength = 1;
  c.predictPath();
  await Promise.resolve();
  await Promise.resolve();
  expect(c.wormholePath!.events.find((e) => e.kind === "exit")!.ell).toBe(0.025);
});

test("moving-mouth predictions converge with live flight in both directions", () => {
  for (const direction of [-1, 1]) {
    const initial = { ...scene(), whOrbit: true, gyroscopes: false, system: "none" as const };
    const t0 = 800,
      end = t0 + 80;
    setSceneTime(t0);
    const m = mouth(initial, t0);
    setRepPose(initial, {
      l: direction > 0 ? -0.001 : m.lGlue + 0.01,
      n: [1, 0, 0],
      fwd: [1, 0, 0],
      up: [0, 0, 1],
      vel: [direction * 0.01, 0, 0],
    });
    const entry = direction > 0 ? "ours" : "gargantua";
    const path = predictWormhole(initial, t0, entry, { horizon: 80, maxSteps: 4096 });
    expect(path.events.some((e) => e.kind === "centre")).toBe(true);
    const positions: Vec3[] = [];
    for (const step of [0.025, 0.2]) {
      const s = { ...initial };
      let t = t0;
      const c = Object.assign(Object.create(CameraController.prototype), {
        s,
        properTime: 0,
        subCap: 400,
        nowTime: () => t,
        sync: () => {},
        localFlight: () => null,
        lens: () => lensesOf(s),
      }) as CameraController;
      for (let j = 0; j < 5000 && t < end - 1e-8; j++) {
        setSceneTime(t);
        t = c.fallStep(Math.min(step, end - t), [0, 0, 0], false)!;
      }
      expect(t).toBeCloseTo(end, 7);
      const cam = cameraFrame(s, t),
        map = wormholeMapPose(s, cam, t, cam.fwd, entry)!;
      expect(map.universe).toBe(direction > 0 ? "gargantua" : "ours");
      positions.push(map.X);
      expect(Math.hypot(...map.X.map((v, j) => v - path.samples.at(-1)!.X[j]!))).toBeLessThan(1e-5);
    }
    expect(Math.hypot(...positions[0]!.map((v, j) => v - positions[1]![j]!))).toBeLessThan(1e-5);
  }
});

test("an oblique trajectory that misses the gorge never claims a traversal", () => {
  const s = { ...scene(), whOrbit: false, system: "none" as const };
  setSceneTime(0);
  setRepPose(s, { l: -0.1, n: [1, 0, 0], fwd: [1, 0, 0], vel: [0.01, 0.02, 0] });
  const path = predictWormhole(s, 0, "ours", { horizon: 100 });
  expect(path.samples.every((q) => q.universe === "ours" && !q.tunnel)).toBe(true);
  expect(path.events.some((e) => e.kind === "centre" || e.kind === "exit")).toBe(false);
  expect(path.samples.every((q) => [...q.X, ...q.V].every(Number.isFinite))).toBe(true);
});

test("unsupported manoeuvres suspend without destroying or reinterpreting their nodes", () => {
  const s = { ...scene(), whOrbit: false };
  const node = { t: 100, dv: [0.01, 0, 0] as Vec3 };
  let message = "",
    restored = false;
  const c = Object.assign(Object.create(CameraController.prototype), {
    s,
    plan: { nodes: [node], universe: "ours" },
    nowTime: () => 0,
    pilot: { setAuto: () => {} },
    restoreWarp: () => {
      restored = true;
    },
    onPilotMessage: (m: string) => {
      message = m;
    },
  }) as CameraController;
  for (const l of [-0.0001, 0.01]) {
    setRepPose(s, { l, n: [1, 0, 0], fwd: [1, 0, 0], vel: [0.01, 0, 0] });
    expect(c.nodeBurn(cameraFrame(s, 0), 0.1, 0.1)).toBeNull();
    expect(c.plan.nodes[0]).toBe(node);
    expect(restored).toBe(true);
    expect(message).toContain(l < 0 ? "inside the tunnel" : "other universe");
  }
});
