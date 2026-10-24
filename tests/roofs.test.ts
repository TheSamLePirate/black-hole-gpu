import { describe, expect, test } from "bun:test";
import { earcut } from "../src/system/earcut";
import { buildingMesh } from "../src/system/roof-mesh";
import {
  apexDistance,
  convexParts,
  planBuilding,
  ringArea,
  simplifyFootprint,
  stacksOf,
  materialCode,
  orientedBox,
  partyEdges,
  planRoof,
  type Pt,
  RoofMaterial,
  type RoofInput,
  roofAt,
  roofMaterial,
  sidesOf,
  WallMaterial,
  wallMaterial,
} from "../src/system/roofs";

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const rotate = (r: Pt[], deg: number): Pt[] => {
  const c = Math.cos((deg * Math.PI) / 180),
    s = Math.sin((deg * Math.PI) / 180);
  return r.map(([x, y]) => [x * c - y * s, x * s + y * c]);
};
const house = (o: Partial<RoofInput> & { rings: Pt[][] }): RoofInput => ({
  height: 6,
  roof: null,
  storeys: null,
  roofMat: RoofMaterial.Tiles,
  wallMat: WallMaterial.Render,
  region: "france-north",
  seed: 0.9,
  ...o,
});

describe("the registry's materials", () => {
  test("a digit a material, the first known kept", () => {
    expect(materialCode("30")).toBe(3);
    expect(materialCode("04")).toBe(4);
    expect(materialCode("13")).toBe(1);
    expect(materialCode("00")).toBe(0);
    expect(materialCode("")).toBe(0);
    expect(materialCode(undefined)).toBe(0);
    expect(roofMaterial("20")).toBe(RoofMaterial.Slate);
    expect(roofMaterial("90")).toBe(RoofMaterial.Other);
    expect(wallMaterial("40")).toBe(WallMaterial.Brick);
    expect(wallMaterial("05")).toBe(WallMaterial.Render);
  });
});

describe("footprints", () => {
  test("the least box of a turned rectangle is the rectangle", () => {
    const b = orientedBox(rotate(rect(-6, -3, 6, 3), 30));
    expect(b.hu).toBeCloseTo(6, 6);
    expect(b.hv).toBeCloseTo(3, 6);
    expect(Math.abs(b.ux * Math.cos(Math.PI / 6) + b.uy * Math.sin(Math.PI / 6))).toBeCloseTo(1, 6);
  });
  test("a cadastral jog of a few centimetres is not a side; a party flag follows its edge", () => {
    const r: Pt[] = [
      [0, 0],
      [5, 0],
      [5, 0.04],
      [10, 0.04],
      [10, 8],
      [0, 8],
    ];
    const s = sidesOf(r, [false, false, false, true, false, false]);
    expect(s.length).toBe(4);
    const east = s.find((v) => v.nx > 0.9)!;
    expect(east.party).toBe(true);
    // (the bottom side's line at its outermost corner: y = 0)
    const south = s.find((v) => v.ny < -0.9)!;
    expect(south.q).toBeCloseTo(0, 1);
  });
  test("two terraced houses share their party wall, not their free sides", () => {
    const flags = partyEdges([[rect(0, 0, 6, 10)], [rect(6, 0, 12, 10)], [rect(30, 0, 36, 10)]]);
    // (edge 1 of the first is x = 6, edge 3 of the second x = 6)
    expect(flags[0]![0]).toEqual([false, true, false, false]);
    expect(flags[1]![0]).toEqual([false, false, false, true]);
    expect(flags[2]![0]).toEqual([false, false, false, false]);
  });
  test("the apex of a 12 × 6 rectangle is 3 m from its long sides", () => {
    const r = rect(-6, -3, 6, 3);
    const s = sidesOf(r, undefined);
    const long = s.filter((v) => Math.abs(v.ny) > 0.9);
    expect(apexDistance(s, long, orientedBox(r))).toBeCloseTo(3, 3);
    expect(apexDistance(s, s, orientedBox(r))).toBeCloseTo(3, 3);
  });
});

describe("roofs", () => {
  test("a detached house with its measured ridge: two slopes to it, the gables at its ends", () => {
    const p = planRoof(house({ rings: [rect(-6, -4, 6, 4)], roof: 3 }));
    expect(p.shape).toBe("gabled");
    expect(p.wall).toBe(6);
    expect(p.top).toBeCloseTo(9, 6);
    expect(roofAt(p.planes, 0, 0)).toBeCloseTo(9, 4);
    expect(roofAt(p.planes, 3, 4)).toBeCloseTo(6, 4);
    // (along the ridge, at a gable's end: still at the ridge)
    expect(roofAt(p.planes, 6, 0)).toBeCloseTo(9, 4);
    expect(p.pitch).toBeCloseTo((Math.atan(3 / 4) * 180) / Math.PI, 3);
  });
  test("a terraced house deeper than wide: its ridge along the street, between its party walls", () => {
    // (6 m of street front along x, 10 m deep along y; its east and west walls shared)
    const r = rect(0, 0, 6, 10);
    const p = planRoof(house({ rings: [r], party: [false, true, false, true], roof: 2.5 }));
    expect(p.shape).toBe("gabled");
    // (the slopes face the street and the garden: the planes' gradients along y)
    for (const pl of p.planes.slice(0, -1)) expect(Math.abs(pl[0])).toBeLessThan(1e-9);
    expect(roofAt(p.planes, 3, 5)).toBeCloseTo(8.5, 4);
    expect(roofAt(p.planes, 0.01, 5)).toBeCloseTo(8.5, 4);
  });
  test("a Paris block: zinc over seven storeys, a mansard on its free sides", () => {
    const r = rect(0, 0, 20, 14);
    const p = planRoof(
      house({
        rings: [r],
        party: [false, true, false, true],
        height: 17.5,
        storeys: 7,
        roofMat: RoofMaterial.Zinc,
        region: "france-north",
      }),
    );
    expect(p.shape).toBe("mansard");
    expect(p.top - p.wall).toBeGreaterThan(5);
    // (at the street front, the eave; a metre in, the brisis's rise; at the middle, the top)
    expect(roofAt(p.planes, 10, 0)).toBeCloseTo(17.5, 4);
    expect(roofAt(p.planes, 10, 1)).toBeCloseTo(17.5 + Math.tan((72 * Math.PI) / 180), 3);
    expect(roofAt(p.planes, 10, 7)).toBeCloseTo(p.top, 4);
    // (along the party wall: no slope down to it)
    expect(roofAt(p.planes, 0.01, 7)).toBeCloseTo(p.top, 4);
  });
  test("a terrace, a measured flat roof, an OSM height to the top", () => {
    expect(planRoof(house({ rings: [rect(0, 0, 10, 10)], roofMat: RoofMaterial.Concrete })).shape).toBe("flat");
    expect(planRoof(house({ rings: [rect(0, 0, 10, 10)], roof: 0.5 })).shape).toBe("flat");
    const osm = planRoof(house({ rings: [rect(0, 0, 10, 7)], height: 9, top: true, roofMat: RoofMaterial.Unknown }));
    expect(osm.shape).not.toBe("flat");
    expect(osm.top).toBeCloseTo(9, 6);
    expect(osm.wall).toBeLessThan(9);
    expect(osm.wall).toBeGreaterThanOrEqual(2.2);
  });
  test("a courtyard block stays flat (its parts are B4's)", () => {
    const p = planRoof(house({ rings: [rect(0, 0, 30, 30), rect(10, 10, 20, 20)], roof: 4 }));
    expect(p.shape).toBe("flat");
    expect(p.top).toBeCloseTo(8, 6);
  });
});

describe("meshes", () => {
  const projected = (m: { positions: number[]; triangles: number[] }, roofOnly: boolean) => {
    let s = 0;
    for (let k = 0; k < m.triangles.length; k += 3) {
      const [a, b, c] = [m.triangles[k]!, m.triangles[k + 1]!, m.triangles[k + 2]!].map((i) => m.positions.slice(i * 3, i * 3 + 3));
      const A = ((b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!)) / 2;
      if (!roofOnly || Math.abs(A) > 1e-9) s += Math.abs(A);
    }
    return s;
  };
  test("a square with a square hole: eight triangles, the ring's area", () => {
    const t = earcut([rect(0, 0, 10, 10), rect(3, 3, 7, 7)]);
    let s = 0;
    for (let k = 0; k < t.triangles.length; k += 3) {
      const [a, b, c] = [t.points[t.triangles[k]!]!, t.points[t.triangles[k + 1]!]!, t.points[t.triangles[k + 2]!]!];
      s += ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
    expect(t.triangles.length / 3).toBe(8);
    expect(s).toBeCloseTo(100 - 16, 6);
  });
  test("a gabled house: its roof covers its footprint once, every roof corner on the roof, its gables closed", () => {
    const r = rotate(rect(-6, -4, 6, 4), 20);
    const p = planRoof(house({ rings: [r], roof: 3 }));
    const m = buildingMesh([r], -1, 0, p.planes);
    expect(projected(m, true)).toBeCloseTo(96, 3);
    for (let i = 0; i < m.positions.length; i += 3) {
      const [x, y, h] = [m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!];
      expect(h).toBeLessThanOrEqual(roofAt(p.planes, x, y) + 1e-5);
    }
    // (the ridge's height reached by the walls at the gables)
    expect(Math.max(...m.positions.filter((_, i) => i % 3 === 2))).toBeCloseTo(9, 4);
  });
  test("a mansard block: its faces cover the footprint, its wall tops at the eave on the free sides", () => {
    const r = rect(0, 0, 20, 14);
    const p = planRoof(house({ rings: [r], party: [false, true, false, true], height: 17.5, storeys: 7, roofMat: RoofMaterial.Zinc }));
    const m = buildingMesh([r], 0, 0, p.planes);
    expect(projected(m, true)).toBeCloseTo(280, 2);
  });
});

describe("complex footprints", () => {
  const L: Pt[] = [
    [0, 0],
    [20, 0],
    [20, 8],
    [8, 8],
    [8, 20],
    [0, 20],
  ];
  test("an L is two convex parts, its area whole, its cut flagged", () => {
    const parts = convexParts([L]);
    expect(parts.length).toBe(2);
    expect(parts.reduce((t, p) => t + Math.abs(ringArea(p.ring)), 0)).toBeCloseTo(20 * 8 + 8 * 12, 6);
    // (one cut between them: one flag set in each)
    for (const p of parts) expect(p.flags.filter(Boolean).length).toBe(1);
  });
  test("a courtyard block: convex parts round its yard, the yard left out", () => {
    const parts = convexParts([rect(0, 0, 30, 30), rect(10, 10, 20, 20)]);
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(parts.reduce((t, p) => t + Math.abs(ringArea(p.ring)), 0)).toBeCloseTo(900 - 100, 6);
  });
  test("an L-shaped house: two gabled wings at one pitch, their ridges at the wings' middles", () => {
    const parts = planBuilding(house({ rings: [L], roof: 3 }));
    expect(parts.length).toBe(2);
    expect(new Set(parts.map((p) => p.shape))).toEqual(new Set(["gabled"]));
    expect(parts[0]!.pitch).toBeCloseTo(parts[1]!.pitch, 6);
    expect(Math.max(...parts.map((p) => p.top))).toBeCloseTo(9, 4);
  });
  test("a courtyard block in zinc over seven storeys: mansards on its street and yard sides", () => {
    const parts = planBuilding(
      house({ rings: [rect(0, 0, 30, 30), rect(10, 10, 20, 20)], height: 17.5, storeys: 7, roofMat: RoofMaterial.Zinc }),
    );
    expect(parts.every((p) => p.shape === "mansard")).toBe(true);
  });
  test("a footprint of a thousand corners simplified within 256", () => {
    const circle: Pt[] = Array.from({ length: 1000 }, (_, i) => [
      50 * Math.cos((i * 2 * Math.PI) / 1000),
      50 * Math.sin((i * 2 * Math.PI) / 1000),
    ]);
    const r = simplifyFootprint([circle]).rings;
    expect(r[0]!.length).toBeLessThanOrEqual(256);
    expect(Math.abs(ringArea(r[0]!))).toBeGreaterThan(0.98 * Math.PI * 2500);
  });
});

describe("chimneys", () => {
  test("a house: one stack on its ridge, near an end; a Paris block: two, across its top; a flat roof none", () => {
    const h = planRoof(house({ rings: [rect(-6, -4, 6, 4)], roof: 3 }));
    const one = stacksOf({ ...h, rings: [rect(-6, -4, 6, 4)] }, 0.2, false);
    expect(one.length).toBe(1);
    const c = one[0]!.ring.reduce((t, p) => [t[0] + p[0] / 4, t[1] + p[1] / 4], [0, 0]);
    expect(Math.abs(c[1])).toBeLessThan(0.2);
    expect(Math.abs(c[0])).toBeGreaterThan(4);
    expect(one[0]!.top).toBeCloseTo(h.top + 1.1, 6);
    const r = rect(0, 0, 20, 14);
    const m = planRoof(house({ rings: [r], party: [false, true, false, true], height: 17.5, storeys: 7, roofMat: RoofMaterial.Zinc }));
    expect(stacksOf({ ...m, rings: [r] }, 0.9, true).length).toBe(2);
    const f = planRoof(house({ rings: [r], roofMat: RoofMaterial.Concrete }));
    expect(stacksOf({ ...f, rings: [r] }, 0.1, false)).toEqual([]);
  });
});
