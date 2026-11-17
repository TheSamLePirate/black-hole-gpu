import { expect, test } from "bun:test";
import { CAR_SILL_M, CarKind, carKind, carShape, parkedKind } from "../src/system/car-shapes";
import { CAR_BODY, CAR_GLASS_BIT, CAR_HEAD, CAR_TAIL, packScenery, SCENERY_BYTES, SCENERY_GRID } from "../src/system/scenery-data";
import { LANE_M } from "../src/system/traffic";

// PLAN-J8 J8-VB VB3 — the near cars' silhouettes (src/system/car-shapes.ts): five shapes, each a body, a cabin (roof painted,
// windows glazed) and four lamps' quads (each from a vertex ≡ 0 mod 4, its four vertices at one place), in its lane to the right;
// a car's shape from its index; packScenery tags each car's triangles by its shape's counts.

const KINDS = [CarKind.Compact, CarKind.Saloon, CarKind.Suv, CarKind.Van, CarKind.Bus];

test("VB3: each shape — its vertices a multiple of four, its lamps' quads at one place each, its triangles' counts, in its lane", () => {
  for (const k of KINDS) {
    const m = carShape(k);
    const nv = m.positions.length / 3;
    expect(nv % 4).toBe(0);
    expect(m.triangles.length / 3).toBe(m.body + m.glass + m.head + m.tail);
    expect(m.body).toBe(14);
    expect(m.glass).toBe(8);
    // (the lamps: the last sixteen vertices, four quads)
    for (let q = nv - 16; q < nv; q += 4) {
      expect(q % 4).toBe(0);
      for (let i = 1; i < 4; i++) expect(m.positions.slice(3 * (q + i), 3 * (q + i) + 3)).toEqual(m.positions.slice(3 * q, 3 * q + 3));
    }
    // (the lamps' triangles each quad's a, a+1, a+2 / a, a+2, a+3 — meshVs's corner by the index mod 4)
    const lampTris = m.triangles.slice(3 * (m.body + m.glass));
    for (let i = 0; i < lampTris.length; i += 6) {
      const a = lampTris[i]!;
      expect(a % 4).toBe(0);
      expect(lampTris.slice(i, i + 6)).toEqual([a, a + 1, a + 2, a, a + 2, a + 3]);
    }
    // (the lane: the body's middle LANE_M to the right — y negative); on its wheels
    const ys: number[] = [],
      zs: number[] = [];
    for (let i = 0; i < 8; i++) {
      ys.push(m.positions[3 * i + 1]!);
      zs.push(m.positions[3 * i + 2]!);
    }
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(-LANE_M, 6);
    expect(Math.min(...zs)).toBeCloseTo(CAR_SILL_M, 6);
  }
  // (taller and longer as they go: the van over the saloon, the bus longest)
  const top = (k: CarKind) => Math.max(...carShape(k).positions.filter((_, i) => i % 3 === 2));
  const len = (k: CarKind) => {
    const xs = carShape(k).positions.filter((_, i) => i % 3 === 0);
    return Math.max(...xs) - Math.min(...xs);
  };
  expect(top(CarKind.Van)).toBeGreaterThan(top(CarKind.Saloon) + 0.8);
  expect(len(CarKind.Bus)).toBeGreaterThan(10);
});

test("VB3: the faces wound as the scene's meshes are — each triangle's cross product towards its part's middle", () => {
  // (the body's and the cabin's own centres: their triangles' normals inward, as traffic.ts's box had them)
  const m = carShape(CarKind.Saloon);
  const p = (i: number) => [m.positions[3 * i]!, m.positions[3 * i + 1]!, m.positions[3 * i + 2]!];
  const mid = (from: number, to: number) => {
    const c = [0, 0, 0];
    for (let i = from; i < to; i++) for (let a = 0; a < 3; a++) c[a]! += p(i)[a]! / (to - from);
    return c;
  };
  const box = mid(0, 8),
    cabin = mid(8, 16);
  for (let t = 0; t < m.body + m.glass; t++) {
    const [a, b, c] = [m.triangles[3 * t]!, m.triangles[3 * t + 1]!, m.triangles[3 * t + 2]!];
    const [A, B, C] = [p(a), p(b), p(c)];
    const u = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!],
      w = [C[0]! - A[0]!, C[1]! - A[1]!, C[2]! - A[2]!];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const o = a < 8 ? box : cabin;
    const f = [(A[0]! + B[0]! + C[0]!) / 3 - o[0]!, (A[1]! + B[1]! + C[1]!) / 3 - o[1]!, (A[2]! + B[2]! + C[2]!) / 3 - o[2]!];
    expect(n[0]! * f[0]! + n[1]! * f[1]! + n[2]! * f[2]!).toBeLessThan(0);
  }
});

test("VB3: a car's shape from its index — all five in a town's traffic, the same index the same shape, mostly small cars", () => {
  const n = [0, 0, 0, 0, 0];
  for (let i = 0; i < 1500; i++) n[carKind(i)]!++;
  for (const c of n) expect(c).toBeGreaterThan(30);
  expect(n[CarKind.Compact]! + n[CarKind.Saloon]!).toBeGreaterThan(750);
  expect(n[CarKind.Bus]!).toBeLessThan(140);
  expect(carKind(42)).toBe(carKind(42));
});

test("VB3: packScenery tags each car by its shape — body, glass (its bit), headlights, tail lights — from a vertex ≡ 0 mod 4", () => {
  const cars = Array.from({ length: 7 }, (_, i) => ({
    start: [i * 10, 0, 0] as [number, number, number],
    end: [i * 10 + 200, 0, 0] as [number, number, number],
    speed: 20,
    phase: i / 7,
  }));
  const packed = packScenery(
    [],
    new Uint32Array(SCENERY_GRID ** 2),
    [],
    undefined,
    SCENERY_GRID,
    SCENERY_BYTES,
    undefined,
    [],
    [],
    [],
    cars,
  );
  const f = new Float32Array(packed);
  const u = new Uint32Array(f.buffer);
  // (the header's vec4 3: (meshOffset, …, triangleOffset, building triangles); vec4 2's w the triangle count)
  const triangleOffset = f[3 * 4 + 2]!,
    triangles = f[2 * 4 + 3]!;
  const tags = Array.from(u.subarray(triangleOffset * 4 + triangles * 3, triangleOffset * 4 + triangles * 3 + triangles));
  let at = tags.findIndex((t) => (t & 0xffff0000) >>> 0 === CAR_BODY);
  expect(at).toBeGreaterThanOrEqual(0);
  cars.forEach((_, i) => {
    const s = carShape(carKind(i));
    const want = [
      ...Array(s.body).fill((CAR_BODY | i) >>> 0),
      ...Array(s.glass).fill((CAR_BODY | CAR_GLASS_BIT | i) >>> 0),
      ...Array(s.head).fill((CAR_HEAD | i) >>> 0),
      ...Array(s.tail).fill((CAR_TAIL | i) >>> 0),
    ];
    expect(tags.slice(at, at + want.length)).toEqual(want);
    at += want.length;
  });
});

test("VB4: a parked car — its shape without lamps (nothing lit at night), no bus in a parking lane, tagged without lamps", () => {
  for (const k of [CarKind.Compact, CarKind.Saloon, CarKind.Suv, CarKind.Van]) {
    const m = carShape(k, false);
    expect(m.positions.length / 3).toBe(16);
    expect(m.head + m.tail).toBe(0);
    expect(m.triangles.length / 3).toBe(m.body + m.glass);
  }
  for (let s = 0; s < 2000; s++) expect(parkedKind(s)).not.toBe(CarKind.Bus);
  const cars = [
    {
      start: [0, 0, 0] as [number, number, number],
      end: [1, 0, 0] as [number, number, number],
      speed: 0,
      phase: 0,
      kind: CarKind.Suv,
      lamps: false,
    },
  ];
  const packed = packScenery(
    [],
    new Uint32Array(SCENERY_GRID ** 2),
    [],
    undefined,
    SCENERY_GRID,
    SCENERY_BYTES,
    undefined,
    [],
    [],
    [],
    cars,
  );
  const f = new Float32Array(packed);
  const u = new Uint32Array(f.buffer);
  const triangleOffset = f[3 * 4 + 2]!,
    triangles = f[2 * 4 + 3]!;
  const tags = Array.from(u.subarray(triangleOffset * 4 + triangles * 3, triangleOffset * 4 + triangles * 3 + triangles));
  const s = carShape(CarKind.Suv, false);
  expect(tags.filter((t) => (t & 0xffff0000) >>> 0 === CAR_BODY).length).toBe(s.body + s.glass);
  expect(tags.filter((t) => [CAR_HEAD, CAR_TAIL].includes((t & 0xffff0000) >>> 0)).length).toBe(0);
});
