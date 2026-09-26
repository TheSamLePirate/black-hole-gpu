import { test, expect } from "bun:test";
import { fromZamo } from "../src/geodesic";
import { zamo, type Vec3 } from "../src/physics";
import { applyDv, apsides, circularBeta, pathFrom, planAlign, planCircular, planeOffset, planIntercept, planPath, planRendezvous, position, type World } from "../src/maneuver";

const a = 0.6;
const w: World = { a };
const circular = (r: number) => {
  const st = fromZamo(r, Math.PI / 2, 0, [0, 0, 0.1], a);
  return fromZamo(r, Math.PI / 2, 0, circularBeta(st, w)!, a);
};

test("circular speed from the geodesic keeps r constant", () => {
  const p = pathFrom(circular(20), w, 2 * Math.PI * 20 ** 1.5, 300);
  const ap = apsides(p);
  expect(ap.rMax - ap.rMin).toBeLessThan(0.02);
});

test("a prograde impulse raises the apoapsis, a retrograde one lowers the periapsis", () => {
  const st = circular(20);
  const up = apsides(pathFrom(applyDv(st, [0.02, 0, 0], a), w, 3000, 400));
  const down = apsides(pathFrom(applyDv(st, [-0.02, 0, 0], a), w, 3000, 400));
  expect(up.rMax).toBeGreaterThan(21);
  expect(down.rMin).toBeLessThan(19);
});

test("transfer 20 M → 40 M: two burns end on a circular orbit at 40 M", () => {
  const st = circular(20);
  const plan = planCircular(st, 40, w)!;
  expect(plan.nodes.length).toBe(2);
  const res = planPath(st, plan.nodes, w, 2 * Math.PI * 40 ** 1.5)!;
  const last = res.states[res.states.length - 1]!;
  const after = apsides(pathFrom(last, w, 2 * Math.PI * 40 ** 1.5, 400));
  expect(after.rMin).toBeGreaterThan(38.5);
  expect(after.rMax).toBeLessThan(41.5);
});

test("intercept: the path passes through a fixed point", () => {
  const st = circular(30);
  const target: Vec3 = [-18, 12, 6];
  const plan = planIntercept(st, target, w, 0.2)!;
  expect(plan).not.toBeNull();
  expect(plan.miss).toBeLessThan(0.8);
});

test("rendezvous with a body on a circular orbit", () => {
  const st = circular(25);
  const D = 50;
  const om = 1 / (D ** 1.5 + a);
  const body = {
    centre: (t: number): Vec3 => [D * Math.cos(1 + om * t), D * Math.sin(1 + om * t), 0],
    velocity: (t: number): Vec3 => [-D * om * Math.sin(1 + om * t), D * om * Math.cos(1 + om * t), 0],
    radius: 2.5, standoff: 10,
  };
  const plan = planRendezvous(st, w, body)!;
  expect(plan).not.toBeNull();
  expect(plan.miss).toBeLessThan(8);
  expect(zamo(D, Math.PI / 2, a).alpha).toBeGreaterThan(0);
  expect(position(st)[0]).toBeCloseTo(25, 6);
});

test("plane change: an inclined orbit is turned into the equatorial plane at a node", () => {
  // a circular orbit tilted by ~10°
  const st0 = circular(25);
  const st = applyDv(st0, [0, 0.03, 0], a);
  expect(planeOffset(st, a, [0, 0, 1])).toBeGreaterThan(0.1);
  const plan = planAlign(st, w, [0, 0, 1], "the equator")!;
  expect(plan.nodes.length).toBe(1);
  const after = planPath(st, plan.nodes, w, 10)!.states[0]!;
  expect(planeOffset(after, a, [0, 0, 1])).toBeLessThan(1e-3);
  // and it stays there: the path keeps z ≈ 0
  const p = pathFrom(after, w, 1500, 200);
  expect(Math.max(...p.pts.map((q) => Math.abs(q[2])))).toBeLessThan(0.05);
});

test("orbit insertion around a massive star: the free orbit after the last burn circles the star", () => {
  const D = 70, m = 0.1, R = 2.5;
  const om = 1 / (D ** 1.5 / Math.sqrt(1 + m) + a);
  const centre = (t: number): Vec3 => [D * Math.cos(om * t), D * Math.sin(om * t), 0];
  const velocity = (t: number): Vec3 => [-D * om * Math.sin(om * t), D * om * Math.cos(om * t), 0];
  const wS: World = { a, lens: { m, R, centre, velocity } };
  const st0 = fromZamo(23, Math.PI / 2, 2, [0, 0, 0.1], a, 500);
  const st = fromZamo(23, Math.PI / 2, 2, circularBeta(st0, wS)!, a, 500);
  const plan = planRendezvous(st, wS, { centre, velocity, radius: R, standoff: 3.2 * R, orbit: { mass: m, n: [0, 0, 1] } })!;
  expect(plan.nodes[plan.nodes.length - 1]!.then).toBe("orbit");
  const after = planPath(st, plan.nodes, wS, 1)!.states.at(-1)!;
  const p = pathFrom(after, wS, 300, 120);
  const ds = p.pts.map((q, j) => {
    const c = centre(p.times[j]!);
    return Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]);
  });
  expect(p.fate).toBe("continues");
  expect(Math.min(...ds)).toBeGreaterThan(1.5 * R);
  expect(Math.max(...ds)).toBeLessThan(20);
}, 30000);
