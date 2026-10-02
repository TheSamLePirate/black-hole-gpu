import { test, expect } from "bun:test";
import { Contrails, contrailThreshold, engineTrail, MAX_SEGMENTS, SEG_FLOATS, tipTrail, trailLook, type V3 } from "../src/contrails";
import { airAt } from "../src/aero";
import { solarBody } from "../src/system/solar";

test("Schmidt–Appleman: trails at cruise altitude on Earth, not at the ground; always on Titan, never on Venus", () => {
  const at = (body: string, km: number) => {
    const a = airAt(solarBody(body)!.atmosphere, km * 1e3);
    return engineTrail(1, a.rho, a.T, a.gas.R);
  };
  expect(at("earth", 0)).toBe(0);
  expect(at("earth", 5)).toBe(0);
  expect(at("earth", 10)).toBeGreaterThan(0.9);
  expect(at("earth", 70)).toBe(0);
  expect(at("titan", 0)).toBeGreaterThan(0.9);
  expect(at("venus", 10)).toBe(0);
  // (the threshold rises with the pressure: −38 °C or so at 250 hPa)
  expect(contrailThreshold(25000)).toBeGreaterThan(232);
  expect(contrailThreshold(25000)).toBeLessThan(242);
  expect(contrailThreshold(100000)).toBeGreaterThan(contrailThreshold(25000));
  expect(engineTrail(0, 0.4, 220, 287)).toBe(0);
});

test("wingtip vortices: pulling hard in warm dense air only", () => {
  expect(tipTrail(1.05, 1.2, 288, 100)).toBeGreaterThan(0.9);
  expect(tipTrail(0.6, 1.2, 288, 100)).toBe(0);
  expect(tipTrail(1.0, 0.3, 288, 100)).toBe(0);
  expect(tipTrail(1.0, 1.2, 240, 100)).toBe(0);
});

test("a trail drawn on, carried with the air, widening and thinning, then gone", () => {
  const C = new Contrails();
  const carry = (p: V3, dt: number): V3 => [p[0] + 10 * dt, p[1], p[2]];
  // a craft flying along y at 250 m/s for 20 s
  for (let t = 0; t <= 20; t += 0.05) C.step(t, "earth", carry, [{ key: "e0", p: [0, 250 * t, 0], kind: 0, str: 1 }]);
  const tr = C.trails[0]!;
  expect(tr.pts.length).toBeGreaterThan(100);
  // (the oldest point drifted with the air: 20 s × 10 m/s)
  expect(tr.pts[0]!.p[0]).toBeGreaterThan(190);
  const young = trailLook(0, 1, 1), old = trailLook(0, 60, 1);
  expect(old.w).toBeGreaterThan(5 * young.w);
  expect(old.tau).toBeLessThan(young.tau);
  // the source off: the trail stays, then sublimates
  for (let t = 20; t <= 200; t += 1) C.step(t, "earth", carry, []);
  expect(C.trails.length).toBe(0);
});

test("segments handed over in the ship's frame, at most MAX_SEGMENTS", () => {
  const C = new Contrails();
  for (let t = 0; t <= 400; t += 0.02) C.step(t, "earth", (p) => p, [{ key: "e0", p: [0, 0, -300 * t], kind: 0, str: 1 }, { key: "e1", p: [5, 0, -300 * t], kind: 0, str: 1 }]);
  const out = new Float32Array(MAX_SEGMENTS * SEG_FLOATS);
  // the ship at the head, nose along −z of the body: its z axis is the body's −z
  const n = C.view(400, [0, 0, -120000], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], out);
  expect(n).toBeGreaterThan(100);
  expect(n).toBeLessThanOrEqual(MAX_SEGMENTS);
  // (the first segment starts at the engine: behind the ship's origin is −z in its frame, here 0)
  expect(Math.abs(out[2]!)).toBeLessThan(1);
  // (the trail behind the ship: negative z)
  expect(out[6]!).toBeLessThan(0);
  // (thinned, not cut: the trail still reaches back ~150 s × 300 m/s)
  const zs = Array.from({ length: n }, (_, i) => out[i * SEG_FLOATS + 6]!);
  expect(Math.min(...zs)).toBeLessThan(-30000);
});
