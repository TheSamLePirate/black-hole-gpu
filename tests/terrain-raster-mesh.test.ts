import { describe, expect, test } from "bun:test";
import { EARTH_RUNWAYS, RUNWAY_HALF_WIDTH, RUNWAY_LENGTH } from "../src/game/sites";
import { TERRAIN_CACHE_N, TERRAIN_CACHE_ROUNDS, terrainWindow } from "../src/system/terrain-cache-layout";
import { RASTER_MESH_EXTRA_TRIANGLES, runwayOutlines, terrainRasterMesh } from "../src/system/terrain-raster-mesh";

const N1 = TERRAIN_CACHE_N - 1;

function runwayVector(frames: typeof EARTH_RUNWAYS): Float32Array {
  const out = new Float32Array(68);
  out[0] = frames.length;
  frames.forEach((r, k) => out.set([...r.p, RUNWAY_LENGTH, ...r.along, RUNWAY_HALF_WIDTH, ...r.across], 4 + 16 * k));
  return out;
}

function windowAt(frame: (typeof EARTH_RUNWAYS)[number], level: number) {
  const lat = Math.asin(frame.p[2]);
  const lon = Math.atan2(frame.p[1], frame.p[0]);
  return terrainWindow(null, lon, lat, TERRAIN_CACHE_ROUNDS[level]!)!;
}

function check(frames: typeof EARTH_RUNWAYS, level: number) {
  const window = windowAt(frames[0]!, level);
  const runways = runwayVector(frames);
  const mesh = terrainRasterMesh(window, level, runways);
  const at = (id: number): [number, number] => [mesh.vertices[3 * id]!, mesh.vertices[3 * id + 1]!];
  // Watertight: every side is used once each way, except the patch's own boundary.
  const directed = new Map<string, number>();
  let area = 0;
  let flat = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
    const [pa, pb, pc] = [at(a), at(b), at(c)];
    const twice = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
    // (a sliver can collapse or flip within float32's resolution — a ten-thousandth of a cell² — and is rare)
    expect(twice).toBeGreaterThan(-1e-4);
    if (twice < 1e-4) flat++;
    area += twice / 2;
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const)
      directed.set(`${p}>${q}`, (directed.get(`${p}>${q}`) ?? 0) + 1);
  }
  expect(flat).toBeLessThanOrEqual(mesh.indices.length / 3 / 200);
  expect(area).toBeCloseTo(N1 * N1, 1);
  let boundary = 0;
  for (const [key, count] of directed) {
    expect(count).toBe(1);
    const [p, q] = key.split(">").map(Number) as [number, number];
    if (directed.has(`${q}>${p}`)) continue;
    const [u0, v0] = at(p),
      [u1, v1] = at(q);
    // (outlines through one point — here four runways sharing a threshold — may leave two ids a float32 step apart)
    if (Math.hypot(u1 - u0, v1 - v0) < 1e-4) continue;
    const onEdge = (u0 === 0 && u1 === 0) || (v0 === 0 && v1 === 0) || (u0 === N1 && u1 === N1) || (v0 === N1 && v1 === N1);
    expect(onEdge).toBe(true);
    boundary++;
  }
  expect(boundary).toBeGreaterThanOrEqual(4 * N1);
  return { mesh, window, runways };
}

/** Samples along a runway outline side must lie on mesh edges: no triangle straddles them. */
function straddles(mesh: ReturnType<typeof terrainRasterMesh>, a: [number, number], b: [number, number]): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const side = (p: [number, number]) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len;
  let bad = 0;
  for (let k = 1; k < 40; k++) {
    const s: [number, number] = [a[0] + ((b[0] - a[0]) * k) / 40, a[1] + ((b[1] - a[1]) * k) / 40];
    if (s[0] < 0 || s[0] > N1 || s[1] < 0 || s[1] > N1) continue;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const p = [0, 1, 2].map(
        (i) => [mesh.vertices[3 * mesh.indices[t + i]!]!, mesh.vertices[3 * mesh.indices[t + i]! + 1]!] as [number, number],
      );
      const d = p.map(side);
      if (!(Math.min(...d) < -2.5e-3 && Math.max(...d) > 2.5e-3)) continue;
      const sign = (q: [number, number], r: [number, number]) => (r[0] - q[0]) * (s[1] - q[1]) - (r[1] - q[1]) * (s[0] - q[0]);
      const e = [sign(p[0]!, p[1]!), sign(p[1]!, p[2]!), sign(p[2]!, p[0]!)];
      if (e.every((v) => v > 1e-9)) bad++;
    }
  }
  return bad;
}

describe("conforming raster terrain mesh", () => {
  const oblique = EARTH_RUNWAYS.filter((r) => {
    const h = (((r.site.rwy ?? 0) % 90) + 90) % 90;
    return h > 8 && h < 82;
  });

  test("the sites include obliquely oriented runways", () => {
    expect(oblique.length).toBeGreaterThan(0);
  });

  for (const level of [0, 1, 2, 3]) {
    test(`oblique runway, level ${level}: watertight, outlines are mesh edges, budget respected`, () => {
      const frame = oblique[0]!;
      const { mesh, window, runways } = check([frame], level);
      expect(mesh.conforming).toBe(true);
      expect(mesh.cutTriangles).toBeLessThanOrEqual(RASTER_MESH_EXTRA_TRIANGLES);
      for (const quad of runwayOutlines(window, level, runways))
        for (let i = 0; i < 4; i++) expect(straddles(mesh, quad[i]!, quad[(i + 1) % 4]!)).toBe(0);
    });
  }

  test("every runway, several levels: watertight", () => {
    for (const frame of EARTH_RUNWAYS) for (const level of [0, 2, 4]) check([frame], level);
  });

  test("several runways in one patch (neighbours, crossing outlines) stay watertight", () => {
    const first = oblique[0]!;
    const clone = (rot: number) => {
      const c = Math.cos(rot),
        s = Math.sin(rot);
      const along = first.along.map((v, i) => v * c + first.across[i]! * s) as [number, number, number];
      const across = first.along.map((v, i) => -v * s + first.across[i]! * c) as [number, number, number];
      return { ...first, along, across };
    };
    const frames = [first, clone(0.7), clone(-1.1), clone(2.0)];
    for (const level of [0, 1, 2]) {
      const { mesh } = check(frames, level);
      expect(mesh.cutVertices).toBeGreaterThan(0);
    }
  });

  test("without runways the grid is untouched", () => {
    const window = windowAt(EARTH_RUNWAYS[0]!, 2);
    const mesh = terrainRasterMesh(window, 2, new Float32Array(68));
    expect(mesh.conforming).toBe(false);
    expect(mesh.columns).toBe(TERRAIN_CACHE_N);
    expect(mesh.indices.length).toBe(N1 * N1 * 6);
  });
});
