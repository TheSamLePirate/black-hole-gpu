import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { RecordFlag, readHeader, readRecord } from "../src/system/building-cells";
import { prepareBdtopoCell } from "../src/system/cell-prep";
import {
  encodeMeshCell,
  MESH_HEADER_BYTES,
  MeshFlag,
  meshCacheUrl,
  meshLayout,
  meshViews,
  readMeshBuilding,
  readMeshHeader,
  SKIRT_M,
} from "../src/system/mesh-cells";
import { prepareMeshCell } from "../src/system/mesh-prep";

// PLAN-J8 J8-8 lot (1) — the near buildings' mesh cell (mesh-cells.ts, kerr-mesh-v1), agreed with the render session (17 Nov 2026):
// the J8-2 cell's buildings in its order (rank i here, rank i there), each its packScenery leaves and its parts' triangles, every
// height over its foot, its walls from SKIRT_M below; the identity table by rank; the sections each from a 16-byte boundary.

const FIX = "tests/fixtures/bdtopo/15-16971-12014.pbf";
const [X, Y] = [16971, 12014];

test("the bytes: written and read back — header, identity by rank, vertices, indices offset to the cell's, tags to each part's leaf", () => {
  const leaf = (k: number) => Array.from({ length: 8 }, (_, i) => k * 10 + i);
  const buf = encodeMeshCell({ source: 1, z: 15, x: 7, y: 9, flags: 1, generation: 20260301, originLat: 43.1, originLon: 5.9 }, [
    {
      leaves: [leaf(1), leaf(2), leaf(3)],
      parts: [
        { leaf: 0, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] },
        { leaf: 2, positions: [0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1], triangles: [0, 1, 2, 1, 3, 2] },
      ],
      flags: RecordFlag.GroundKnown,
      foot: 41.5,
    },
    { leaves: [], parts: [], flags: MeshFlag.Unplanned, foot: Number.NaN },
    { leaves: [leaf(4)], parts: [{ leaf: 0, positions: [5, 5, 5, 6, 5, 5, 5, 6, 5], triangles: [2, 1, 0] }], flags: 0, foot: 12 },
  ]);
  const h = readMeshHeader(buf)!;
  expect(h).toMatchObject({ x: 7, y: 9, z: 15, flags: 1, buildings: 3, generation: 20260301, vertices: 10, triangles: 4, records: 8 });
  const L = meshLayout(h);
  for (const at of [L.vertices, L.indices, L.tags, L.records]) expect(at % 16).toBe(0);
  expect(L.identity).toBe(MESH_HEADER_BYTES);
  expect(buf.byteLength).toBe(L.bytes);
  const v = meshViews(buf, h);
  // (the third building's triangle: its vertices after the first's seven, its tag its one leaf — after the first's three: 6 vec4)
  expect([...v.indices.slice(9, 12)]).toEqual([9, 8, 7]);
  expect([...v.tags]).toEqual([0, 4, 4, 6]);
  expect([...v.records.slice(16, 24)]).toEqual(leaf(3));
  expect(readMeshBuilding(buf, 0)).toMatchObject({
    firstRecord: 0,
    records: 3,
    firstTriangle: 0,
    triangles: 3,
    firstVertex: 0,
    foot: 41.5,
  });
  const u = readMeshBuilding(buf, 1);
  expect(u.records).toBe(0);
  expect(u.flags & MeshFlag.Unplanned).toBeTruthy();
  expect(Number.isNaN(u.foot)).toBe(true);
  expect(readMeshBuilding(buf, 2)).toMatchObject({ firstRecord: 6, records: 1, firstTriangle: 3, triangles: 1, firstVertex: 7 });
  // (another format, a cut buffer: not a mesh cell)
  expect(readMeshHeader(buf.slice(0, buf.byteLength - 4))).toBeNull();
  expect(meshCacheUrl("https://x", 7, 9, 20260301, true)).toBe("https://x/__mesh/1/15/7/9.kmc?g=20260301&c=1");
});

test("a real tile (Hyères, 250 buildings): J8-2's buildings in J8-2's order, every one planned, its triangles on its leaves", () => {
  const bytes = new Uint8Array(readFileSync(FIX));
  const geoid = () => 48.5;
  const cell = prepareBdtopoCell(bytes, X, Y, geoid);
  const m = prepareMeshCell(bytes, X, Y, geoid);
  const h = readMeshHeader(m.buf)!;
  const c = readHeader(cell.buf)!;
  expect(h.buildings).toBe(c.count);
  expect(h.generation).toBe(c.generation);
  expect([h.originLat, h.originLon]).toEqual([c.originLat, c.originLon]);
  expect(m.stats.unplanned).toBe(0);
  const v = meshViews(m.buf, h);
  let partsChecked = 0,
    under = 0;
  for (let r = 0; r < h.buildings; r++) {
    const b = readMeshBuilding(m.buf, r);
    const rec = readRecord(cell.buf, r);
    // (the same building: its flags J8-2's, its foot its record's ground)
    expect(b.flags & 0xff).toBe(rec.flags);
    if (rec.flags & RecordFlag.GroundKnown) expect(b.foot).toBeCloseTo(rec.ground, 3);
    else expect(Number.isNaN(b.foot)).toBe(true);
    // (its triangles' vertices within its own, their tags within its leaves; its leaves' first a part: bottom −SKIRT_M)
    expect(b.records).toBeGreaterThan(0);
    expect(v.records[b.firstRecord * 4]).toBeCloseTo(-SKIRT_M, 5);
    const next = r + 1 < h.buildings ? readMeshBuilding(m.buf, r + 1).firstVertex : h.vertices;
    const nextRecord = r + 1 < h.buildings ? readMeshBuilding(m.buf, r + 1).firstRecord : h.records;
    // (its walls from the skirt: its lowest vertex there — a roof's plane may reach lower, roofs.ts's own: counted, not failed)
    let low = Infinity;
    for (let i = b.firstVertex; i < next; i++) {
      low = Math.min(low, v.positions[i * 3 + 2]!);
      if (v.positions[i * 3 + 2]! < -SKIRT_M - 1e-3) under++;
    }
    if (b.triangles) expect(low).toBeLessThanOrEqual(-SKIRT_M + 1e-3);
    for (let t = b.firstTriangle; t < b.firstTriangle + b.triangles; t++) {
      for (let k = 0; k < 3; k++) {
        const i = v.indices[t * 3 + k]!;
        expect(i >= b.firstVertex && i < next).toBe(true);
        // (none far outside the cell — ±1 km, its buffer's buildings at most)
        expect(Math.abs(v.positions[i * 3]!)).toBeLessThan(1000);
      }
      expect(v.tags[t]! >= b.firstRecord && v.tags[t]! < nextRecord).toBe(true);
      // (a tag points at a part's leaf: a building's — its fourth word 1 —, its bottom the skirt)
      expect(v.records[v.tags[t]! * 4 + 3]).toBe(1);
      expect(v.records[v.tags[t]! * 4]).toBeCloseTo(-SKIRT_M, 5);
      partsChecked++;
    }
  }
  expect(partsChecked).toBe(h.triangles);
  expect(under / h.vertices).toBeLessThan(0.01);
  console.log(`  Hyères' tile: ${JSON.stringify({ ...m.stats, bytes: m.buf.byteLength, ms: Math.round(m.stats.ms), underSkirt: under })}`);
});
