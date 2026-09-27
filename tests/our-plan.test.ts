import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { earthStart } from "../src/system/our-side";
import { predictOurs } from "../src/system/our-predict";
import { bPlane, keplerProp, lambert, planOurOrbit, planOurTransfer, returnPerigee } from "../src/system/our-plan";
import { M_METRES, M_SECONDS, solarBody, solarState } from "../src/system/solar";

// Flight planning in our universe: two-body tools, then transfers aimed with the n-body predictor —
// an orbit change, the Artemis II free return round the Moon, the way back from the Moon.

const C = 299792458;
const KM = 1e3 / M_METRES;
const DAY = 86400 / M_SECONDS;
const accel = (2 * 9.80665) / (C * C / M_METRES); // the Ranger's Crew engine at 2 g
const o = { lead: 60 / M_SECONDS, mouthR: 0.05, accel };

test("Kepler's and Lambert's problems agree (an orbit and back)", () => {
  const mu = solarBody("earth")!.mass;
  const r0: Vec3 = [7000 * KM, 0, 0];
  const v0: Vec3 = [0, Math.sqrt(mu / r0[0]) * 1.2, 0.1 * Math.sqrt(mu / r0[0])];
  const dt = 3600 / M_SECONDS; // (a quarter turn: not the 180° where Lambert is degenerate)
  const k = keplerProp(mu, r0, v0, dt);
  const L = lambert(mu, r0, k.r, dt, [0, 0, 1])!;
  expect(Math.hypot(...L.v1.map((x, i) => x - v0[i]!)) * C).toBeLessThan(1e-3);
  expect(Math.hypot(...L.v2.map((x, i) => x - k.v[i]!)) * C).toBeLessThan(1e-3);
  // (energy kept by the propagation)
  const e0 = (v0[0] ** 2 + v0[1] ** 2 + v0[2] ** 2) / 2 - mu / 7000 / KM;
  const e1 = Math.hypot(...k.v) ** 2 / 2 - mu / Math.hypot(...k.r);
  expect(Math.abs(e1 - e0) / Math.abs(e0)).toBeLessThan(1e-10);
});

test("a Hohmann transfer from 400 to 1 000 km: the textbook burns", () => {
  const t0 = 109.6;
  const s = earthStart(t0, 400, true);
  const p = planOurOrbit(s.X, s.vel, t0, 1000e3, { ...o, accel: 0 });
  if ("error" in p) throw new Error(p.error);
  const mu = solarBody("earth")!.mass, R = solarBody("earth")!.radius;
  const r1 = R + 400 * KM, r2 = R + 1000 * KM, a = (r1 + r2) / 2;
  const dv1 = Math.sqrt(mu * (2 / r1 - 1 / a)) - Math.sqrt(mu / r1);
  const dv2 = Math.sqrt(mu / r2) - Math.sqrt(mu * (2 / r2 - 1 / a));
  expect(Math.abs(Math.hypot(...p.nodes[0]!.dv) - dv1) * C).toBeLessThan(2);
  expect(Math.abs(p.nodes[1]!.dv[0] - dv2) * C).toBeLessThan(2);
  expect(p.nodes[1]!.then).toBe("circularize");
});

test("Artemis II: a free return round the Moon, the pass at 7 000 km, back to a 200 km perigee", () => {
  const t0 = 109.6;
  const s = earthStart(t0, 400, true);
  const p = planOurTransfer(s.X, s.vel, t0, { kind: "transfer", target: "moon", arrival: "freeReturn", altM: 7000e3, returnAltM: 200e3 }, o);
  if ("error" in p) throw new Error(p.error);
  const tli = p.nodes[0]!;
  // (a TLI: ~3.1 km/s along the velocity)
  expect(tli.dv[0] * C).toBeGreaterThan(3000);
  expect(tli.dv[0] * C).toBeLessThan(3200);
  expect(Math.hypot(tli.dv[1], tli.dv[2]) * C).toBeLessThan(30);
  // flown with its finite 2 g burn: the pass and the way home as asked
  const path = predictOurs(s.X, s.vel, t0, [{ t: tli.t, dv: tli.dv }], { tMax: 10 * DAY, maxSteps: 200000, step: 0.02, accel });
  const bp = bPlane(path, "moon")!;
  const pass = (bp.ca.d - solarBody("moon")!.radius) / KM;
  expect(Math.abs(pass - 7000)).toBeLessThan(100);
  // (the perigee home is very sensitive — 0.1 m/s at the burn is ~100 km there: the corrections in
  // flight take the rest)
  const rp = returnPerigee(path, "moon", "earth")!;
  expect(Math.abs(rp.rp / KM - 6371 - 200)).toBeLessThan(300);
  // (the pass after 3–5 days, home after 7–9)
  const tPass = (path.times[bp.ca.i]! - t0) / DAY, tHome = (path.times[rp.pe.i]! - t0) / DAY;
  expect(tPass).toBeGreaterThan(3);
  expect(tPass).toBeLessThan(5);
  expect(tHome).toBeGreaterThan(7);
  expect(tHome).toBeLessThan(9);
  expect(p.nodes.map((n) => n.role)).toEqual(["depart", "mcc", "mccReturn", "captureHome"]);
}, 60000);

test("from a low lunar orbit back to the Earth: a ~0.8 km/s burn, a perigee near the one asked", () => {
  const t0 = 300;
  const M = solarState("moon", t0);
  const mb = solarBody("moon")!;
  const r = mb.radius + 100 * KM;
  const X: Vec3 = [M.pos[0] + r, M.pos[1], M.pos[2]];
  const V: Vec3 = [M.vel[0], M.vel[1] + Math.sqrt(mb.mass / r), M.vel[2]];
  const p = planOurTransfer(X, V, t0, { kind: "transfer", target: "earth", arrival: "orbit", altM: 200e3, returnAltM: 200e3 }, o);
  if ("error" in p) throw new Error(p.error);
  const dv = Math.hypot(...p.nodes[0]!.dv) * C;
  expect(dv).toBeGreaterThan(600);
  expect(dv).toBeLessThan(1100);
  const path = predictOurs(X, V, t0, [{ t: p.nodes[0]!.t, dv: p.nodes[0]!.dv }], { tMax: 7 * DAY, maxSteps: 200000, step: 0.02, accel });
  const rp = returnPerigee(path, "moon", "earth")!;
  // (the correction halfway down takes the rest: here within a few hundred km)
  expect(Math.abs(rp.rp / KM - 6371 - 200)).toBeLessThan(400);
}, 60000);

test("to Mars: a launch window, a ~3.7 km/s escape, a correction of a few m/s, a capture ~2.4 km/s", () => {
  const t0 = 109.6;
  const s = earthStart(t0, 400, true);
  const p = planOurTransfer(s.X, s.vel, t0, { kind: "transfer", target: "mars", arrival: "orbit", altM: 300e3, returnAltM: 200e3 }, o);
  if ("error" in p) throw new Error(p.error);
  expect(p.nodes.map((n) => n.role)).toEqual(["depart", "mcc", "mcc", "capture"]);
  const [tmi, mcc, , cap] = p.nodes as [(typeof p.nodes)[0], (typeof p.nodes)[0], (typeof p.nodes)[0], (typeof p.nodes)[0]];
  // (the window: within a synodic period, ~2.1 years)
  expect((tmi.t - t0) / DAY).toBeGreaterThan(0);
  expect((tmi.t - t0) / DAY).toBeLessThan(800);
  expect(Math.hypot(...tmi.dv) * C).toBeGreaterThan(3400);
  expect(Math.hypot(...tmi.dv) * C).toBeLessThan(4200);
  // (the escape aimed on the n-body way out: little left for the correction)
  expect(Math.hypot(...mcc.dv) * C).toBeLessThan(10);
  expect(Math.abs(cap.dv[0]) * C).toBeGreaterThan(1800);
  expect(Math.abs(cap.dv[0]) * C).toBeLessThan(2800);
  // (the flight: 5 to 9 months)
  const tof = (cap.t - tmi.t) / DAY;
  expect(tof).toBeGreaterThan(140);
  expect(tof).toBeLessThan(280);
}, 60000);
