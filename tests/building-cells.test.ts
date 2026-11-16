import { expect, test } from "bun:test";
import {
  buildingId,
  CELL_Z,
  type CellRecord,
  CellSource,
  cellBounds,
  cellKey,
  cellOf,
  cellOrigin,
  encodeCell,
  fromCell,
  HEADER_BYTES,
  RECORD_BYTES,
  RECORD_WORDS,
  readHeader,
  readRecord,
  recordWords,
  sourceKey,
  toCell,
} from "../src/system/building-cells";
import { RoofMaterial, WallMaterial } from "../src/system/roofs";

// PLAN-J8 J8-2: the building cell's contract — its grid, its frame, its bytes read back as written.

const HYERES = { lat: 43.1, lon: 6.15 };
const rec = (over: Partial<CellRecord> = {}): CellRecord => ({
  east: 123.25,
  north: -87.5,
  ground: 61.75,
  eave: 9.5,
  roof: 3.25,
  halfLength: 12.3,
  halfWidth: 6.1,
  heading: 0.75,
  roofShape: "hipped",
  flags: 1,
  roofMaterial: RoofMaterial.Tiles,
  wallMaterial: WallMaterial.Render,
  usage: "Résidentiel",
  storeys: 3,
  rank: 7,
  sourceKey: sourceKey("BATIMENT0000000012345678"),
  roofColour: 0xb04a2f,
  ...over,
});

test("the grid: a place's cell holds it, its origin inside its bounds; the keys and the ids", () => {
  const c = cellOf(HYERES.lat, HYERES.lon);
  const b = cellBounds(c.x, c.y);
  expect(HYERES.lon).toBeGreaterThanOrEqual(b.west);
  expect(HYERES.lon).toBeLessThan(b.east);
  expect(HYERES.lat).toBeGreaterThanOrEqual(b.south);
  expect(HYERES.lat).toBeLessThan(b.north);
  const o = cellOrigin(c.x, c.y);
  expect(o.lon).toBeCloseTo((b.west + b.east) / 2, 10);
  expect(o.lat).toBeGreaterThan(b.south);
  expect(o.lat).toBeLessThan(b.north);
  // (≈ 0.9 km a side at 43° N)
  const side = toCell(o, o.lat, b.east).east - toCell(o, o.lat, b.west).east;
  expect(side).toBeGreaterThan(850);
  expect(side).toBeLessThan(950);
  expect(cellKey(c.x, c.y)).toBe(`${CELL_Z}/${c.x}/${c.y}`);
  expect(buildingId(c.x, c.y, 42)).toBe(`${CELL_Z}/${c.x}/${c.y}#42`);
});

test("the frame: a place there and back within a millimetre across a cell", () => {
  const c = cellOf(HYERES.lat, HYERES.lon);
  const o = cellOrigin(c.x, c.y);
  const b = cellBounds(c.x, c.y);
  for (const [lat, lon] of [
    [b.north, b.west],
    [b.south, b.east],
    [HYERES.lat, HYERES.lon],
  ] as const) {
    const p = toCell(o, lat, lon);
    const q = fromCell(o, p.east, p.north);
    // (1 mm ≈ 9e-9 ° of latitude)
    expect(Math.abs(q.lat - lat)).toBeLessThan(1e-8);
    expect(Math.abs(q.lon - lon)).toBeLessThan(1.3e-8);
  }
});

test("the bytes: a cell read back as written — its header, its records to their steps", () => {
  const c = cellOf(HYERES.lat, HYERES.lon);
  const o = cellOrigin(c.x, c.y);
  const records = [rec(), rec({ rank: 8, roofShape: "flat", roof: 0, usage: "", flags: 0, roofColour: 0 })];
  const buf = encodeCell(
    { source: CellSource.BdTopo, z: CELL_Z, x: c.x, y: c.y, generation: 3, originLat: o.lat, originLon: o.lon },
    records,
  );
  expect(buf.byteLength).toBe(HEADER_BYTES + 2 * RECORD_BYTES);
  const h = readHeader(buf)!;
  expect(h).toEqual({
    format: 1,
    source: CellSource.BdTopo,
    z: CELL_Z,
    x: c.x,
    y: c.y,
    count: 2,
    generation: 3,
    originLat: o.lat,
    originLon: o.lon,
  });
  const r = readRecord(buf, 0);
  expect(r.east).toBe(123.25);
  expect(r.north).toBe(-87.5);
  expect(r.ground).toBe(61.75);
  expect(r.eave).toBe(9.5);
  expect(r.roof).toBe(3.25);
  expect(r.halfLength).toBeCloseTo(12.3, 5);
  expect(r.halfWidth).toBeCloseTo(6.1, 5);
  expect(Math.abs(r.heading - 0.75)).toBeLessThan(Math.PI / 65535);
  expect({ ...r, east: 0, north: 0, ground: 0, eave: 0, roof: 0, halfLength: 0, halfWidth: 0, heading: 0 }).toEqual({
    ...rec(),
    east: 0,
    north: 0,
    ground: 0,
    eave: 0,
    roof: 0,
    halfLength: 0,
    halfWidth: 0,
    heading: 0,
  });
  expect(readRecord(buf, 1).roofShape).toBe("flat");
  expect(readRecord(buf, 1).rank).toBe(8);
  // (the GPU's view: 12 words a building, no copy)
  const w = recordWords(buf);
  expect(w.length).toBe(2 * RECORD_WORDS);
  expect(w.buffer).toBe(buf);
});

test("a footprint wider than long turned a quarter; the heading folded into [0, π)", () => {
  const buf = encodeCell({ source: CellSource.Osm, z: CELL_Z, x: 1, y: 2, generation: 0, originLat: 0, originLon: 0 }, [
    rec({ halfLength: 4, halfWidth: 10, heading: 0.2 }),
    rec({ heading: -0.5 }),
  ]);
  const a = readRecord(buf, 0);
  expect(a.halfLength).toBe(10);
  expect(a.halfWidth).toBe(4);
  expect(a.heading).toBeCloseTo(0.2 + Math.PI / 2, 4);
  expect(readRecord(buf, 1).heading).toBeCloseTo(Math.PI - 0.5, 4);
});

test("not a cell of this format: refused — another magic, another format, a truncated download", () => {
  const good = encodeCell({ source: CellSource.BdTopo, z: CELL_Z, x: 1, y: 2, generation: 0, originLat: 0, originLon: 0 }, [rec()]);
  expect(readHeader(good)).not.toBeNull();
  const other = good.slice(0);
  new DataView(other).setUint16(4, 2, true);
  expect(readHeader(other)).toBeNull();
  const magic = good.slice(0);
  new DataView(magic).setUint32(0, 0, true);
  expect(readHeader(magic)).toBeNull();
  expect(readHeader(good.slice(0, good.byteLength - 4))).toBeNull();
  expect(readHeader(new ArrayBuffer(10))).toBeNull();
  expect(() => recordWords(other)).toThrow();
});

test("the source key: the same identity the same key, another another", () => {
  expect(sourceKey("BATIMENT0000000012345678")).toBe(sourceKey("BATIMENT0000000012345678"));
  expect(sourceKey("BATIMENT0000000012345678")).not.toBe(sourceKey("BATIMENT0000000012345679"));
  expect(sourceKey("")).toBe(0x811c9dc5);
});
