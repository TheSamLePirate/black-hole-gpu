import { expect, test } from "bun:test";
import { GEARS } from "../src/gear";
import { gearMat, gearMesh, gearPartOf, ROLE, WHEEL } from "../src/gear-mesh";

// PLAN-COCKPIT K4a: the Ranger's landing gear, drawn — its parts' codes (the material's fraction: the leg,
// the role), the wheels touching where the physics' legs touch, the mesh well formed.

test("the parts' codes: each leg and role read back; the hull's own materials are not the gear's", () => {
  for (const m of [0, 5, 6, 7])
    for (let leg = 0; leg < 3; leg++)
      for (const role of [ROLE.still, ROLE.oleo, ROLE.door]) expect(gearPartOf(gearMat(m, leg, role))).toEqual({ mat: m, leg, role });
  expect(gearPartOf(0)).toBeNull();
  expect(gearPartOf(3)).toBeNull();
  // (the shader's rounding of the material: the part's own)
  expect(Math.round(gearMat(6, 2, ROLE.door))).toBe(6);
});

test("the wheels touch where the physics' legs do; under the hull; the mesh well formed", () => {
  const { verts, idx, lo, hi } = gearMesh();
  const legs = GEARS.ranger!.legs;
  // (the lowest point: the wheels' bottoms, at the legs' contact at full extension)
  expect(lo[1]).toBeCloseTo(Math.min(...legs.map((l) => l.at[1])), 2);
  expect(hi[1]).toBeLessThan(0.3);
  for (const i of idx) expect(i).toBeLessThan(verts.length / 10);
  // (each leg's tyres reach its contact: the lowest tyre vertex of each)
  legs.forEach((L, k) => {
    let low = Infinity;
    for (let v = 0; v < verts.length / 10; v++) {
      const p = gearPartOf(verts[10 * v + 6]!);
      if (p?.leg === k && p.mat === 6) low = Math.min(low, verts[10 * v + 1]!);
    }
    expect(low).toBeCloseTo(L.at[1], 2);
  });
  expect(WHEEL.main).toBeGreaterThan(WHEEL.nose);
});
