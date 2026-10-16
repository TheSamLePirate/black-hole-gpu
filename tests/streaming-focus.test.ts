import { expect, test } from "bun:test";
import { streamingLead } from "../src/system/streaming-focus";
import { len, dot } from "../src/math/vec3";
import { WGS84_A } from "../src/system/ellipsoid";
import { metresPerMapPixel } from "../src/ui/local-ground-map";
test("flight prediction favours horizontal travel, keeps coverage around the craft and ignores rotation/static movement", () => {
  const c: [number, number, number] = [1, 0, 0];
  expect(streamingLead(c, [0, 0, 0])).toEqual([0, 0, 0]);
  expect(streamingLead(c, [100, 0, 0])).toEqual([0, 0, 0]);
  const lead = streamingLead(c, [0, 100, 0]);
  expect(lead[1] * WGS84_A).toBeCloseTo(600, 5);
  expect(dot(c, lead)).toBe(0);
  expect(len(streamingLead(c, [0, 2000, 0])) * WGS84_A).toBeCloseTo(650, 5);
  expect(streamingLead(c, [0, -100, 0])[1]).toBeLessThan(0);
});
test("local map uses zoom 18 scale and halves its ground footprint at each zoom level", () => {
  expect(metresPerMapPixel(0, 18)).toBeCloseTo(0.597164, 5);
  expect(metresPerMapPixel(44, 19)).toBeCloseTo(metresPerMapPixel(44, 18) / 2, 8);
  expect(Number.isFinite(metresPerMapPixel(90, 21))).toBe(true);
});

test("planetary map scale uses the body's own circumference", () => {
  const moon = 1737400,
    mars = 3389500;
  expect(metresPerMapPixel(0, 18, moon) / metresPerMapPixel(0, 18)).toBeCloseTo(moon / WGS84_A, 10);
  expect(metresPerMapPixel(0, 0, mars) * 256).toBeCloseTo(2 * Math.PI * mars, 5);
  expect(metresPerMapPixel(90, 21, moon)).toBeGreaterThan(0);
});

test("the detail led where the view looks: ahead to the ground looked at, at most its reach; none straight down", () => {
  const { gazeLead } = require("../src/system/streaming-focus") as typeof import("../src/system/streaming-focus");
  const c: [number, number, number] = [1, 0, 0];
  // (level, north: the reach)
  expect(len(gazeLead(c, [0, 0, 1], 300, 6000)) * WGS84_A).toBeCloseTo(6000, 3);
  // (10° down from 300 m: the ground 1 701 m ahead)
  const d10: [number, number, number] = [-Math.sin((10 * Math.PI) / 180), 0, Math.cos((10 * Math.PI) / 180)];
  const g = gazeLead(c, d10, 300, 6000);
  expect(g[2] * WGS84_A).toBeCloseTo(300 / Math.tan((10 * Math.PI) / 180), 0);
  expect(Math.abs(dot(c, g))).toBeLessThan(1e-12);
  // (straight down: none; up: the reach)
  expect(gazeLead(c, [-1, 0, 0], 300, 6000)).toEqual([0, 0, 0]);
  expect(len(gazeLead(c, [0.5, 0, Math.sqrt(0.75)], 300, 6000)) * WGS84_A).toBeCloseTo(6000, 3);
});
