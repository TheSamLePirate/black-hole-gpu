import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { gameTimeOf, issOrbit, station } from "../src/system/iss";
import { planIssRendezvous, refineIssNode, rendezvousPoint, RENDEZVOUS_M } from "../src/system/iss-plan";
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
  const r = sub(iss.X, E.pos), v = sub(iss.V, E.vel);
  const n = unit(cross(r, v)), u = unit(r), w = cross(n, u);
  const R = len(r) - dh / M_METRES;
  const p = lin(u, Math.cos(-lag), w, Math.sin(-lag));
  const vt = lin(u, -Math.sin(-lag), w, Math.cos(-lag));
  const vc = Math.sqrt(len(v) ** 2 * len(r) / R);
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
