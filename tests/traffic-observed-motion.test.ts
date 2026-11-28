import { expect, test } from "bun:test";
import { motionBetween, observedDeparture, observedStop } from "../src/traffic/observed-motion";
import { reportAt } from "../src/traffic/timeline";
import { fitFlight, flightAt } from "../src/game/flightpath";
import { runwayFrame } from "../src/game/sites";
import observations from "../docs/progress/airport-motion/observations.json";
import type { Plane } from "../src/traffic/feed";
const history = observations.tracks["4b1806"] as Plane[];
const i = history.findIndex((p, i) => i > 0 && !p.gnd && history[i - 1]!.gnd);
const a = history[i - 1]!,
  b = history[i]!;
const runway = runwayFrame(
  { body: "earth", name: "EGLL 09R observation", lat: 51.4648, lon: -0.49, runway: true, rwy: 90, elev: 0 },
  3900,
  30,
  0,
);
test("observed SWR46K: a 23-second ground/air gap retains its acceleration on the runway, then climbs continuously", () => {
  expect(b.t - a.t).toBe(23);
  const early = observedDeparture([a, b], a.t + 5, [runway], () => 70)!;
  expect(early).not.toBeNull();
  expect(early.airborne).toBe(false);
  expect(early.over).toBe(0);
  expect(early.vu).toBe(0);
  let last = 0,
    flight = false;
  for (let t = a.t; t < b.t; t += 0.1) {
    const p = observedDeparture([a, b], t, [runway], () => 70)!;
    expect(p.over!).toBeGreaterThanOrEqual(last - 1e-6);
    expect(p.vu!).toBeGreaterThanOrEqual(0);
    if (p.airborne) flight = true;
    last = p.over!;
  }
  expect(flight).toBe(true);
  expect(last).toBeCloseTo(b.alt - 70, 0);
  expect(observedDeparture([a, { ...b, gnd: true }], a.t + 10, [runway], () => 70)).toBeNull();
  expect(observedDeparture([a, b], a.t + 10, [], () => 70)).toBeNull();
  expect(observedDeparture([a, { ...b, trk: 180 }], a.t + 10, [runway], () => 70)).toBeNull();
});
test("parked SHT18F: report noise does not turn a zero-speed observation into taxiing", () => {
  const h = observations.tracks["408400"] as Plane[];
  const j = h.findIndex((p, j) => j + 1 < h.length && p.gs === 0 && h[j + 1]!.gs === 0 && h[j + 1]!.t - p.t <= 120);
  expect(j).toBeGreaterThanOrEqual(0);
  const t = (h[j]!.t + h[j + 1]!.t) / 2,
    p = observedStop(h, t)!;
  expect(p).not.toBeNull();
  expect(Math.hypot(p.ve, p.vn)).toBe(0);
  expect(observedStop([{ ...h[j]!, gs: 5 }, h[j + 1]!], t)).toBeNull();
});
test("forty-second source updates interpolate the delayed flight's kinematics, including north crossing", () => {
  const x = { ...a, t: 0, trk: 350, gs: 40, hdg: 350 },
    y = { ...b, t: 40, trk: 10, gs: 80, hdg: 10 };
  const p = reportAt([x, y], y, 20);
  expect(p.gs).toBe(60);
  expect(p.trk).toBeCloseTo(0);
  expect(p.hdg).toBeCloseTo(0);
});
test("ground distance remains monotone and its reported speed is its position's derivative", () => {
  for (let t = 0.1; t < 30; t += 0.1) {
    const p = motionBetween(100, 30, 100, 100, t),
      q = motionBetween(100, 30, 100, 100, t + 0.001);
    expect(p.v).toBeGreaterThanOrEqual(-1e-9);
    expect((q.x - p.x) / 0.001).toBeCloseTo(p.v, 2);
  }
});
test("a corrected turn banks even when the source's reported track remains stale", () => {
  const F = fitFlight(
    [0, 15, 30, 45].map((t) => ({ t, x: [1000 * (1 - Math.cos(t / 60)), 1000 * Math.sin(t / 60), 500], gs: 16.67, trk: 0, vs: 0 })),
  );
  const f = flightAt(F, 25)!;
  const p = flightAt(F, 24.99)!,
    q = flightAt(F, 25.01)!;
  const angle = (Math.atan2(q.v[0]!, q.v[1]!) - Math.atan2(p.v[0]!, p.v[1]!)) / 0.02;
  expect(Math.abs(f.omega)).toBeGreaterThan(0.0005);
  expect(f.omega).toBeCloseTo(angle, 3);
});
