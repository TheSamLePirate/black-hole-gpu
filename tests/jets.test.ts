import { expect, test } from "bun:test";
import { jetLevel, rcsClusters, type ThrustAsked } from "../src/jets";
import { VESSELS } from "../src/vessels";

// PLAN-AUDIO S3: which thrusters fire (the renderer's plumes and the sound's valves, the same) and where the
// attitude thrusters sit, by cluster.

const V = VESSELS.ranger;
const still: ThrustAsked = { throttle: 0, force: [0, 0, 0], torque: [0, 0, 0], air: 0, time: 0 };
const fired = (th: ThrustAsked) => V.jets.map((J, i) => jetLevel(V, J, i, th));

test("the main engines at the throttle, nothing at rest", () => {
  expect(fired(still).every((l) => l === 0)).toBe(true);
  const full = fired({ ...still, throttle: 1 });
  V.jets.forEach((J, i) => expect(full[i]).toBe(J.main ? 1 : 0));
});

test("a yaw fires thrusters on both sides of the axis, in opposite senses; a push up fires the belly's", () => {
  const yaw = fired({ ...still, torque: [0, 1, 0] });
  const on = V.jets.map((J, i) => ({ J, l: yaw[i]! })).filter((x) => x.l > 0 && !x.J.main);
  expect(on.length).toBeGreaterThan(1);
  // (fore and aft of the centre of mass, pushing opposite ways across)
  expect(on.some((x) => x.J.p[2] > V.com[2]) && on.some((x) => x.J.p[2] < V.com[2])).toBe(true);
  const up = fired({ ...still, force: [0, 1, 0] });
  V.jets.forEach((J, i) => {
    if (up[i]! > 0) expect(J.d[1]).toBeLessThan(0);
  });
});

test("the attitude thrusters gathered by where they sit: a few clusters, every RCS jet in one", () => {
  const cl = rcsClusters(V);
  expect(cl.length).toBeGreaterThanOrEqual(4);
  expect(cl.length).toBeLessThanOrEqual(8);
  const n = cl.reduce((s, c) => s + c.jets.length, 0);
  expect(n).toBe(V.jets.filter((J) => !J.main).length);
  // (spread over the hull: some to the left, some to the right)
  expect(cl.some((c) => c.p[0] > 1) && cl.some((c) => c.p[0] < -1)).toBe(true);
});
