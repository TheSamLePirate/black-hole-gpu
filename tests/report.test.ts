import { expect, test } from "bun:test";
import { gradeDocking, gradeLanding, type LandingFigures, weatherDifficulty } from "../src/game/report";

// The flight's report (PLAN-HUB HB4): a landing and a docking graded out of 20, each figure judged.

const base: LandingFigures = {
  body: "Earth",
  site: "Edwards",
  verdict: "landed",
  sink: 0.5,
  along: 80,
  runway: { across: 1, along: 450 },
  padM: null,
  gMax: 1.9,
  dv: 103,
  flightS: 3600,
};

test("a soft landing on the axis: A, 20; firmer and off the axis, lower; a hard one, D or worse", () => {
  const a = gradeLanding(base);
  expect(a.score).toBe(20);
  expect(a.letter).toBe("A");
  expect(a.lines.every((l) => l.q === "good")).toBe(true);
  const b = gradeLanding({ ...base, sink: 1.6, runway: { across: 18, along: 900 } });
  expect(b.score).toBeCloseTo(20 - 4 - 3, 6);
  expect(b.letter).toBe("C");
  expect(b.lines.find((l) => l.label.startsWith("Off"))!.q).toBe("bad");
  const c = gradeLanding({ ...base, verdict: "hard", sink: 3.5 });
  expect(c.score).toBeLessThan(6);
  expect(c.lines[0]!.q).toBe("bad");
});

test("a pad's landing: graded on its distance to the site, capped", () => {
  const p = gradeLanding({ ...base, runway: null, padM: 85 });
  expect(p.score).toBeCloseTo(20 - 4, 6);
  const far = gradeLanding({ ...base, runway: null, padM: 50e3 });
  expect(far.score).toBeCloseTo(12, 6);
});

test("a docking: the autopilot's 0.08 m/s, on the axis — A; a fast, skewed one — lower", () => {
  const d = gradeDocking({ target: "ISS", port: "IDA-2", closing: 0.08, lateral: 0.02, angle: 0.5, spin: 0.1, dv: 12, flightS: 300 });
  expect(d.letter).toBe("A");
  const bad = gradeDocking({ target: "ISS", port: "IDA-2", closing: 0.45, lateral: 0.28, angle: 9, spin: 2.6, dv: 12, flightS: 300 });
  expect(bad.score).toBeLessThan(10);
});

test("a landing with no load recorded (a save loaded just before): no load judged, not 0 g", () => {
  const r = gradeLanding({ ...base, gMax: Number.NaN });
  expect(r.score).toBe(20);
  expect(r.lines.find((l) => l.label === "Greatest load")!.value).toBe("—");
});

test("the weather widens a landing's marks (W8): a gusty crosswind's 1.5 m/s and 8 m off, an A; in calm, a B", () => {
  const firm = { ...base, sink: 1.5, runway: { across: 8, along: 500 } };
  const calm = gradeLanding({ ...firm, weather: { cross: 0, head: 5, gust: 0, vis: 30e3 } });
  const gusty = gradeLanding({ ...firm, weather: { cross: 8, head: 3, gust: 5, vis: 30e3 } });
  expect(weatherDifficulty({ cross: 8, head: 3, gust: 5, vis: 30e3 })).toBeCloseTo(0.5 + 5 / 12, 6);
  expect(gusty.score).toBeGreaterThan(calm.score);
  expect(gusty.letter).toBe("A");
  expect(calm.letter).toBe("B");
  // (the weather said: what widened them)
  expect(gusty.lines.find((l) => l.label === "Weather")!.value).toBe("cross 8 m/s · gusts +5");
  // (fog: a short visibility, a tail wind)
  expect(weatherDifficulty({ cross: 0, head: -3, gust: 0, vis: 300 })).toBeCloseTo(0.3 + 0.4, 6);
  expect(weatherDifficulty(null)).toBe(0);
});
