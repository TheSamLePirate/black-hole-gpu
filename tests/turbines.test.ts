import { expect, test } from "bun:test";
import { turbineMesh, turbineOf } from "../src/system/turbines";

// Q8 D1 — the wind turbines (src/system/turbines.ts): Overture's feature read as a turbine (the Beauce's Nordex N117 as the base
// theme gives it), the fallbacks, and its triangles: the tower to the hub, the blades' tips at the rotor's radius, one upward.
const n117 = {
  subtype: "power",
  class: "generator",
  height: 149.5,
  source_tags: JSON.stringify({ "generator:source": "wind", "height:hub": "91", "rotor:diameter": "117", height: "149.5" }),
};

test("D1: a wind turbine read from the base theme's feature, with its fallbacks", () => {
  expect(turbineOf(n117, 48.24, 1.83)).toEqual({ lat: 48.24, lon: 1.83, hub: 91, rotor: 117 });
  // (its total height alone: the hub 62 % of it, the rotor twice the rest)
  const t = turbineOf({ subtype: "power", class: "generator", height: 150, source_tags: '{"generator:source":"wind"}' }, 0, 0)!;
  expect(t.hub).toBeCloseTo(93, 5);
  expect(t.rotor).toBeCloseTo(114, 5);
  // (not a turbine: a solar plant, a pylon)
  expect(turbineOf({ subtype: "power", class: "generator", source_tags: '{"generator:source":"solar"}' }, 0, 0)).toBeNull();
  expect(turbineOf({ subtype: "power", class: "power_tower" }, 0, 0)).toBeNull();
});

test("D1: a turbine's triangles — the tower to the hub, the rotor's reach, closed boxes", () => {
  const m = turbineMesh(10, 20, 100, { lat: 0, lon: 0, hub: 91, rotor: 117 });
  expect(m.triangles.length % 3).toBe(0);
  const z = (i: number) => m.positions[3 * i + 2]!;
  let top = -Infinity,
    low = Infinity;
  for (let i = 0; i < m.positions.length / 3; i++) {
    top = Math.max(top, z(i));
    low = Math.min(low, z(i));
  }
  // (the upward blade's tip at hub + radius over the foot, the downward ones' tips at hub − radius · sin 30°; the foot sunk 1 m)
  expect(top - 100).toBeCloseTo(91 + 58.5, 0);
  expect(low).toBeCloseTo(99, 5);
  for (const k of m.triangles) expect(k).toBeLessThan(m.positions.length / 3);
});

test("D1: the rotor — its blades the mesh's last 36 triangles, its hub at the hub's height, a plausible turn rate", () => {
  const m = turbineMesh(0, 0, 50, { lat: 0, lon: 0, hub: 91, rotor: 117 });
  expect(m.blades).toBe(36);
  expect(m.hub[2]).toBeCloseTo(141, 5);
  expect(Math.hypot(...m.axis)).toBeCloseTo(1, 6);
  // (~60 m/s at the tips: about 10 turns a minute for a 117 m rotor)
  expect((m.omega * 60) / (2 * Math.PI)).toBeGreaterThan(8);
  expect((m.omega * 60) / (2 * Math.PI)).toBeLessThan(12);
});
