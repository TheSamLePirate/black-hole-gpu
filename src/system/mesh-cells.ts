// PLAN-J8 J8-8 lot (1) — the near buildings' mesh cell, kerr-mesh-v1 (docs/PLAN-J8-BATIMENTS.md §8 J8-8): a building cell of J8-2
// (building-cells.ts — the same z 15 tile, the same buildings in the same order: rank i here is rank i there) with what the near
// material draws — each building's leaves as packScenery writes them (building-mesh-prep.ts buildingLeaves: one a convex part, one a
// chimney) and its parts' triangles. Prepared once in the cells' workers (cell-worker.ts, kind "mesh"), kept in Cache Storage
// (MESH_CACHE), counted in the zones and in `flightReady({ track })` within MESH_NEAR_M of the track; drawn from a GPU reserve by the
// render session (lots 2–4). Pure: no DOM, no WebGPU — the page, the workers and the tests share it. Common to the two sessions.
//
// The format, agreed with the render session (17 Nov 2026):
//  - the frame: the J8-2 cell's (east, north [m] on the tangent plane at its origin); every height — the vertices' and the records' —
//    over the building's foot (z 0 there): the draw sets each building on the relief it draws (the lowest under its footprint, sampled
//    once when the cell becomes resident: a z offset a building, taken off before the record is read); the foot's height over the
//    ellipsoid from the J8-2 cell's ground (the BD TOPO's altitude_minimale_sol + N) when known, NaN when not — a fallback and the
//    contacts' check (lot 3);
//  - the walls from SKIRT_M below the foot (a skirt: the relief drawn may differ from the source's by metres);
//  - a roof without a measured ridge: guessed (RoofGuessed) unless the IGN's canopy was read for it (Measured — the cell's flag
//    Canopy: in the key, a cell made again when its canopy arrives: the same building the same roof wherever it was prepared);
//  - the identity: (cell, rank) — J8-2's; a building's leaves and triangles found by its rank in the identity table;
//  - bridges, turbines, pylons, cars, lamps stay the near scene's.
//
// The bytes (little-endian):
//   header  0 u32 magic "KMC1"   4 u16 format (MESH_FORMAT)   6 u16 source (CellSource)   8 u8 z   9 u8 flags (MeshCellFlag)
//          10 u16 reserved   12 u32 x   16 u32 y   20 u32 buildings   24 u32 generation (the J8-2 cell's: a newer replaces it)
//          28 u32 vertices   32 u32 triangles   36 u32 records [vec4]   40 f64 origin latitude [°]   48 f64 origin longitude [°]
//          56..63 reserved (0)
//   then, each section from a 16-byte boundary (meshLayout):
//   identity  `buildings` × 24 B, by rank: 0 u32 first record [vec4, from the records' start]   4 u16 records (its leaves: parts,
//             then chimneys)   6 u16 flags (RecordFlag's J8-2 bits | MeshFlag)   8 u32 first triangle   12 u32 triangles
//             16 u32 first vertex   20 f32 foot [m over the ellipsoid] (NaN: unknown)
//   vertices  `vertices` × f32 × 3 (east, north, up over the foot [m])
//   indices   `triangles` × u32 × 3 (into the cell's vertices)
//   tags      `triangles` × u32: its leaf's record [vec4, from the records' start] — scenery-raster.ts meshTag's meaning
//   records   `records` × 16 B: the leaves, packScenery's geometry records as they are (f32 words, its packed and marked ones too)
import { CELL_Z, type CellSource } from "./building-cells";

export const MESH_FORMAT = 1;
export const MESH_MAGIC = 0x31434d4b; // "KMC1"
export const MESH_HEADER_BYTES = 64;
export const MESH_IDENTITY_BYTES = 24;
/** the walls' skirt below the foot [m] */
export const SKIRT_M = 3;
/** a mesh cell's bytes before it is prepared — an estimate for a zone's size (17 Nov 2026, from the BD TOPO tiles on the disk, 25 cells
 *  each: Paris's centre 2.5 MB a cell, Toulon's 0.9 MB; the tile's own size does not tell them apart — 138 against 110 kB): the zone's
 *  record keeps the real bytes once they are prepared */
export const MESH_CELL_BYTES_EST = 1.5e6;
/** a mesh cell's preparation time on one worker [s] — an estimate (Paris's centre 0.35 s, Toulon's 0.17 s: scripts/j8-8-mesh-measure.ts) */
export const MESH_CELL_SECONDS_EST = 0.3;
/** the prepared cache */
export const MESH_CACHE = `kerr-mesh-v${MESH_FORMAT}`;
/** a mesh cell's key in it (a URL: Cache Storage's keys are requests; never fetched) — its J8-2 cell's generation and whether the
 *  canopy served its roofs in it: either changed, another key, the cell made again */
export const meshCacheUrl = (origin: string, x: number, y: number, generation: number, canopy: boolean) =>
  `${origin}/__mesh/${MESH_FORMAT}/${CELL_Z}/${x}/${y}.kmc?g=${generation}&c=${canopy ? 1 : 0}`;

export enum MeshCellFlag {
  /** the IGN's canopy read for its roofs without a ridge (I4/B6) */
  Canopy = 1,
  /** its building cell's source has no meshes yet (OSM's alone: neither the BD TOPO's nor Overture's), the cell empty — the near scene
   *  draws there */
  SourceLater = 2,
}
/** a building's flags past J8-2's RecordFlag bits (its low byte) */
export enum MeshFlag {
  /** its roof's height guessed (no ridge in the source, no canopy read) */
  RoofGuessed = 0x100,
  /** its plan failed: no leaf, no triangle (its J8-2 record alone draws it) */
  Unplanned = 0x200,
}

export interface MeshBuilding {
  /** its leaves: packScenery's records, each a multiple of four words */
  leaves: number[][];
  /** its parts' triangles, each part's leaf's index in `leaves` */
  parts: { leaf: number; positions: number[]; triangles: number[] }[];
  flags: number;
  /** its foot over the ellipsoid [m], NaN when unknown */
  foot: number;
}
export interface MeshCellHeader {
  format: number;
  source: CellSource;
  z: number;
  x: number;
  y: number;
  flags: number;
  buildings: number;
  generation: number;
  vertices: number;
  triangles: number;
  records: number;
  originLat: number;
  originLon: number;
}

const up16 = (n: number) => Math.ceil(n / 16) * 16;
/** the sections' byte offsets (each from a 16-byte boundary) and the whole's length */
export function meshLayout(h: Pick<MeshCellHeader, "buildings" | "vertices" | "triangles" | "records">) {
  const identity = MESH_HEADER_BYTES;
  const vertices = up16(identity + h.buildings * MESH_IDENTITY_BYTES);
  const indices = up16(vertices + h.vertices * 12);
  const tags = up16(indices + h.triangles * 12);
  const records = up16(tags + h.triangles * 4);
  return { identity, vertices, indices, tags, records, bytes: records + h.records * 16 };
}

/** The mesh cell's bytes: its buildings by rank (J8-2's order). */
export function encodeMeshCell(
  h: Omit<MeshCellHeader, "format" | "buildings" | "vertices" | "triangles" | "records">,
  buildings: readonly MeshBuilding[],
): ArrayBuffer {
  let vertices = 0,
    triangles = 0,
    records = 0;
  for (const b of buildings) {
    for (const l of b.leaves) {
      if (l.length % 4) throw new Error("a leaf's words not a multiple of four");
      records += l.length / 4;
    }
    for (const p of b.parts) {
      vertices += p.positions.length / 3;
      triangles += p.triangles.length / 3;
    }
  }
  const L = meshLayout({ buildings: buildings.length, vertices, triangles, records });
  const buf = new ArrayBuffer(L.bytes);
  const dv = new DataView(buf);
  dv.setUint32(0, MESH_MAGIC, true);
  dv.setUint16(4, MESH_FORMAT, true);
  dv.setUint16(6, h.source, true);
  dv.setUint8(8, h.z);
  dv.setUint8(9, h.flags);
  dv.setUint32(12, h.x, true);
  dv.setUint32(16, h.y, true);
  dv.setUint32(20, buildings.length, true);
  dv.setUint32(24, h.generation >>> 0, true);
  dv.setUint32(28, vertices, true);
  dv.setUint32(32, triangles, true);
  dv.setUint32(36, records, true);
  dv.setFloat64(40, h.originLat, true);
  dv.setFloat64(48, h.originLon, true);
  const pos = new Float32Array(buf, L.vertices, vertices * 3);
  const idx = new Uint32Array(buf, L.indices, triangles * 3);
  const tag = new Uint32Array(buf, L.tags, triangles);
  const rec = new Float32Array(buf, L.records, records * 4);
  let v = 0,
    t = 0,
    r = 0;
  for (const [i, b] of buildings.entries()) {
    const at = L.identity + i * MESH_IDENTITY_BYTES;
    const firstRecord = r,
      firstTriangle = t,
      firstVertex = v;
    const leafAt: number[] = [];
    for (const l of b.leaves) {
      leafAt.push(r);
      rec.set(l, r * 4);
      r += l.length / 4;
    }
    for (const p of b.parts) {
      pos.set(p.positions, v * 3);
      const n = p.triangles.length / 3;
      for (let k = 0; k < p.triangles.length; k++) idx[t * 3 + k] = p.triangles[k]! + v;
      tag.fill(leafAt[p.leaf]!, t, t + n);
      v += p.positions.length / 3;
      t += n;
    }
    dv.setUint32(at, firstRecord, true);
    dv.setUint16(at + 4, b.leaves.length, true);
    dv.setUint16(at + 6, b.flags, true);
    dv.setUint32(at + 8, firstTriangle, true);
    dv.setUint32(at + 12, t - firstTriangle, true);
    dv.setUint32(at + 16, firstVertex, true);
    dv.setFloat32(at + 20, b.foot, true);
  }
  return buf;
}

/** the header, or null when the bytes are not a mesh cell of this format */
export function readMeshHeader(buf: ArrayBuffer): MeshCellHeader | null {
  if (buf.byteLength < MESH_HEADER_BYTES) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MESH_MAGIC || dv.getUint16(4, true) !== MESH_FORMAT) return null;
  const h: MeshCellHeader = {
    format: MESH_FORMAT,
    source: dv.getUint16(6, true),
    z: dv.getUint8(8),
    flags: dv.getUint8(9),
    x: dv.getUint32(12, true),
    y: dv.getUint32(16, true),
    buildings: dv.getUint32(20, true),
    generation: dv.getUint32(24, true),
    vertices: dv.getUint32(28, true),
    triangles: dv.getUint32(32, true),
    records: dv.getUint32(36, true),
    originLat: dv.getFloat64(40, true),
    originLon: dv.getFloat64(48, true),
  };
  return meshLayout(h).bytes === buf.byteLength ? h : null;
}

/** a building's entry in the identity table, by its rank */
export function readMeshBuilding(buf: ArrayBuffer, rank: number) {
  const dv = new DataView(buf, MESH_HEADER_BYTES + rank * MESH_IDENTITY_BYTES, MESH_IDENTITY_BYTES);
  return {
    firstRecord: dv.getUint32(0, true),
    records: dv.getUint16(4, true),
    flags: dv.getUint16(6, true),
    firstTriangle: dv.getUint32(8, true),
    triangles: dv.getUint32(12, true),
    firstVertex: dv.getUint32(16, true),
    foot: dv.getFloat32(20, true),
  };
}

/** the sections as typed views over the bytes (no copy) */
export function meshViews(buf: ArrayBuffer, h: MeshCellHeader) {
  const L = meshLayout(h);
  return {
    positions: new Float32Array(buf, L.vertices, h.vertices * 3),
    indices: new Uint32Array(buf, L.indices, h.triangles * 3),
    tags: new Uint32Array(buf, L.tags, h.triangles),
    records: new Float32Array(buf, L.records, h.records * 4),
  };
}
