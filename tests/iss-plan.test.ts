import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { gameTimeOf, issOrbit, station } from "../src/system/iss";
import { flown, planIssRendezvous, refineIssNode, rendezvousPoint, RENDEZVOUS_M } from "../src/system/iss-plan";
import { nodeDvHome } from "../src/system/our-predict";
import { M_METRES, M_SECONDS, solarState } from "../src/system/solar";
import { C_MPS } from "../src/units";
import { add, cross, dot, len, lin, scale, sub, unit } from "../src/math/vec3";

// The rendezvous with the ISS: from a lower orbit in its plane, a Lambert arc to the point 200 m off
// IDA-2, its burns as the plan carries them; in flight, a node re-aimed from the same state is the same.

const t = gameTimeOf(Date.UTC(2026, 9, 1, 12));
const E = solarState("earth", t);
const iss = issOrbit(t)!;

/** A circular orbit in the station's plane, h below it and `lag` behind (home frame). */
function chaser(dh: number, lag: number): { X: Vec3; V: Vec3 } {
  const r = sub(iss.X, E.pos),
    v = sub(iss.V, E.vel);
  const n = unit(cross(r, v)),
    u = unit(r),
    w = cross(n, u);
  const R = len(r) - dh / M_METRES;
  const p = lin(u, Math.cos(-lag), w, Math.sin(-lag));
  const vt = lin(u, -Math.sin(-lag), w, Math.cos(-lag));
  const vc = Math.sqrt((len(v) ** 2 * len(r)) / R);
  return { X: add(E.pos, scale(p, R)), V: add(E.vel, scale(vt, vc)) };
}

test("the rendezvous point: 200 m out on IDA-2's axis, moving with the station", () => {
  const P = rendezvousPoint(t)!;
  const d = len(sub(P.X, iss.X)) * M_METRES;
  const port = station.ports[0]!;
  expect(d).toBeGreaterThan(RENDEZVOUS_M - 5);
  expect(d).toBeLessThan(RENDEZVOUS_M + len(port.centre as Vec3) + 5);
  expect(len(sub(P.V, iss.V)) * C_MPS).toBeLessThan(1);
});

test("from 50 km below and 20° behind: four nodes in order, tens of m/s, the arrival after the departure", () => {
  const s = chaser(50e3, 20 * (Math.PI / 180));
  const plan = planIssRendezvous(s.X, s.V, t, 600 / M_SECONDS)!;
  expect(plan).not.toBeNull();
  expect(plan.nodes.map((n) => n.role)).toEqual(["depart", "mcc", "mcc", "arrive"]);
  for (let i = 1; i < 4; i++) expect(plan.nodes[i]!.t).toBeGreaterThan(plan.nodes[i - 1]!.t);
  expect(plan.tArrive).toBe(plan.nodes[3]!.t);
  expect(plan.nodes[0]!.t - t).toBeGreaterThanOrEqual(600 / M_SECONDS - 1e-9);
  const dv = plan.dv * C_MPS;
  expect(dv).toBeGreaterThan(10);
  expect(dv).toBeLessThan(250);
  expect(plan.note).toMatch(/rendezvous with the ISS/);
});

test("in flight: the departure re-aimed from the same state is the planned burn", () => {
  const s = chaser(50e3, 20 * (Math.PI / 180));
  const plan = planIssRendezvous(s.X, s.V, t, 600 / M_SECONDS)!;
  const dep = plan.nodes[0]!;
  const again = refineIssNode(s.X, s.V, t, dep, plan.tArrive)!;
  const d = len(sub(again, dep.dv)) / Math.max(len(dep.dv), 1e-30);
  expect(d).toBeLessThan(1e-3);
  expect(dot(again, dep.dv)).toBeGreaterThan(0);
});

test("from 20 km below and 60° behind: a phasing arc of a few turns within the day, its correction nil on course", () => {
  const s = chaser(20e3, 60 * (Math.PI / 180));
  const t0 = performance.now();
  const plan = planIssRendezvous(s.X, s.V, t, 600 / M_SECONDS);
  const ms = performance.now() - t0;
  // (before: none found — sixteen turns' wait drift it 25° nearer at most, a direct arc no further)
  expect(plan).not.toBeNull();
  expect(((plan!.tArrive - t) * M_SECONDS) / 3600).toBeLessThan(48);
  expect(plan!.dv * C_MPS).toBeLessThan(150);
  expect(ms).toBeLessThan(2000);
  // (the departure flown as planned: the first correction, re-aimed on the arc's own turns, is nil)
  const dep = plan!.nodes[0]!;
  const E0 = solarState("earth", t),
    E1 = solarState("earth", dep.t);
  // (the departure reached as the flight flies there — the plan's own physics)
  const k = flown(sub(s.X, E0.pos), sub(s.V, E0.vel), t, dep.t - t);
  const X1 = add(E1.pos, k.r),
    V1 = add(E1.vel, k.v);
  const V2 = add(V1, nodeDvHome(X1, V1, dep.t, dep.dv));
  const fix = refineIssNode(X1, V2, dep.t, plan!.nodes[1]!, plan!.tArrive)!;
  expect(len(fix) * C_MPS).toBeLessThan(0.5);
});
