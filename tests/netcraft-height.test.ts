import { expect, test } from "bun:test";
import { figureHeight } from "../src/controller/netcraft";
import { bodyFixedOf } from "../src/system/our-surface";
import { solarBody } from "../src/system/solar";
import { M_METRES } from "../src/units";

// A remote craft's height over its body's figure (audit 2026-11-10, NET-28): its plume's air density was read from `|p| − radius` —
// a sphere, kilometres off on the Earth. On Paris's ground and 3 km over it: WGS84's heights (the old sphere's printed beside: its error).

test("on the Earth, WGS84's height — not a sphere's", () => {
  for (const hm of [0, 3000]) {
    const q = bodyFixedOf("earth", 48.85, 2.35, hm);
    const sphere = (Math.hypot(...q) - solarBody("earth")!.radius) * M_METRES;
    const h = figureHeight("earth", q);
    console.log(`  Paris, ${hm} m up: WGS84 ${h.toFixed(1)} m — the old sphere's ${sphere.toFixed(0)} m`);
    expect(Math.abs(h - hm)).toBeLessThan(1);
    expect(Math.abs(sphere - hm)).toBeGreaterThan(1000);
  }
});

test("on a sphere's world, the same as |p| − radius", () => {
  const q = bodyFixedOf("moon", 10, 20, 500);
  expect(figureHeight("moon", q)).toBeCloseTo(500, 3);
});
