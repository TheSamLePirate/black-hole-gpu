import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EARTH_RUNWAYS, runwayWeight } from "../src/game/sites";

// The runways' grading is computed twice — on the CPU for the gear (sites.ts: runwayWeight) and in the
// tracer for the eye (trace.wgsl: runwayGrade) —: the same strip, or the wheels roll on a ground not
// drawn. Their figures checked against each other, the CPU's shape against its definition.

const wgsl = readFileSync(new URL("../src/shaders/trace.wgsl", import.meta.url), "utf8");
const grade = wgsl.slice(wgsl.indexOf("fn runwayGrade"), wgsl.indexOf("fn bandCover"));

test("the tracer's runwayGrade holds the CPU's figures: 3 km before, 4.5 km past, 60 m across, its fades, 6 371 km", () => {
  for (const s of [
    "a < -3000.0",
    "a > 4500.0",
    "(a - 4500.0) / 300.0",
    "(a + 3000.0) / 300.0",
    "c < 60.0",
    "(c - 60.0) / 60.0",
    "6371e3",
    "dot(d, d) > 1e-6",
  ])
    expect(grade).toContain(s);
});

test("runwayWeight: graded on the strip, faded off it, nothing far away", () => {
  const r = EARTH_RUNWAYS.find((x) => x.site.name.startsWith("Edwards"))!;
  const at = (a: number, c: number): [number, number, number] => {
    const k = 1 / 6371e3;
    const v = [0, 1, 2].map((i) => r.p[i]! + (a * r.along[i]! + c * r.across[i]!) * k);
    const l = Math.hypot(...v);
    return [v[0]! / l, v[1]! / l, v[2]! / l];
  };
  expect(runwayWeight(at(1000, 0))).toBeCloseTo(1, 6);
  expect(runwayWeight(at(-2500, 40))).toBeCloseTo(1, 6);
  expect(runwayWeight(at(1000, 90))).toBeCloseTo(0.5, 2);
  expect(runwayWeight(at(4650, 0))).toBeCloseTo(0.5, 2);
  expect(runwayWeight(at(1000, 200))).toBe(0);
  expect(runwayWeight(at(20000, 0))).toBe(0);
});
