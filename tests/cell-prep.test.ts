import { expect, test } from "bun:test";
import { VectorTile, classifyRings } from "@mapbox/vector-tile";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { PbfReader } from "pbf";
import { bdtopoHeight, bdtopoStands } from "../src/system/bdtopo";
import { HEADER_BYTES, RECORD_BYTES, RecordFlag, readHeader, readRecord, sourceKey } from "../src/system/building-cells";
import { prepareBdtopoCell } from "../src/system/cell-prep";
import { regionOf, roofMaterial, wallMaterial } from "../src/system/roofs";

// PLAN-J8 J8-3 — a BD TOPO tile prepared into a building cell (src/system/cell-prep.ts), against the scenery worker's own decoding of
// the same tile (its attributes' rules copied as scenery-worker.ts has them, 16 Nov 2026): every building standing kept once, each with
// the same eave, roof height, storeys, materials, use and light construction; over a block of tiles (the census's, kept on this Mac in
// ~/.kerr-cache/bdtopo — skipped without it), each building in exactly one cell; the time per tile measured.

const FIX = "tests/fixtures/bdtopo/15-16971-12014.pbf";

/** the scenery worker's attributes of a BD TOPO feature (scenery-worker.ts, its BD TOPO tiles: copied as it is) */
function workerAttrs(pr: Record<string, unknown>, lat: number, lon: number) {
  const ridge = pr.altitude_maximale_toit,
    eave = pr.altitude_minimale_toit;
  const region = regionOf(lat, lon);
  return {
    h: bdtopoHeight(pr),
    roof: typeof ridge === "number" && typeof eave === "number" && ridge >= eave ? Math.min(30, ridge - eave) : null,
    storeys: typeof pr.nombre_d_etages === "number" && pr.nombre_d_etages > 0 ? pr.nombre_d_etages : null,
    roofMat: roofMaterial(pr.materiaux_de_la_toiture, region),
    wallMat: wallMaterial(pr.materiaux_des_murs),
    usage: typeof pr.usage_1 === "string" ? pr.usage_1 : undefined,
    light: pr.construction_legere === true,
  };
}

/** the worker's buildings of a tile: each standing feature's polygons (cleabs # place), with its attributes */
function workerBuildings(bytes: Uint8Array, x: number, y: number) {
  const L = new VectorTile(new PbfReader(bytes)).layers.batiment;
  const n = 2 ** 15;
  const lon = ((x + 0.5) / n) * 360 - 180,
    lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  const out = new Map<string, ReturnType<typeof workerAttrs>>();
  for (let i = 0; L && i < L.length; i++) {
    const f = L.feature(i);
    if (f.type !== 3 || !bdtopoStands(f.properties)) continue;
    // (the worker draws each part of a building; the cell holds the building once, its parts together: compared by building)
    const polys = classifyRings(f.loadGeometry());
    if (polys.some((rings) => (rings[0]?.length ?? 0) >= 4)) out.set(String(f.properties.cleabs), workerAttrs(f.properties, lat, lon));
  }
  return out;
}

test("a tile prepared: the worker's buildings, each with the worker's attributes; the cell's bytes read back", () => {
  const bytes = new Uint8Array(readFileSync(FIX));
  const P = prepareBdtopoCell(bytes, 16971, 12014, () => 50);
  const ref = workerBuildings(bytes, 16971, 12014);
  console.log(
    `  ${FIX}: ${P.stats.features} buildings, ${P.stats.polygons} polygons, ${P.stats.kept} kept here (the first of the tiles they touch), ${P.stats.partial} partial, ${P.stats.ms.toFixed(1)} ms`,
  );
  expect(P.stats.kept).toBeGreaterThan(50);
  // (every record one of the worker's, its attributes the same)
  const h = readHeader(P.buf)!;
  expect(h.count).toBe(P.records.length);
  expect(P.buf.byteLength).toBe(HEADER_BYTES + h.count * RECORD_BYTES);
  let bad = 0;
  const byKey = new Map<number, string>();
  for (const id of ref.keys()) byKey.set(sourceKey(id), id);
  for (let i = 0; i < h.count; i++) {
    const r = readRecord(P.buf, i);
    const id = byKey.get(r.sourceKey);
    if (!id) {
      bad++;
      continue;
    }
    const w = ref.get(id)!;
    const same =
      Math.abs(r.eave - w.h) < 1e-3 &&
      Math.abs(r.roof - (w.roof ?? 0)) < 1e-3 &&
      r.storeys === (w.storeys ?? 0) &&
      r.roofMaterial === w.roofMat &&
      r.wallMaterial === w.wallMat &&
      (r.usage || undefined) ===
        (w.usage &&
        ["Résidentiel", "Commercial et services", "Industriel", "Agricole", "Religieux", "Sportif", "Annexe", "Indifférencié"].includes(
          w.usage,
        )
          ? w.usage
          : undefined) &&
      ((r.flags & 1) === 1) === w.light;
    if (!same) bad++;
    // (the ground over the ellipsoid: the registry's over the sea plus the N given, 50 m here)
    if (r.flags & RecordFlag.GroundKnown) expect(r.ground).toBeGreaterThan(45);
  }
  expect(bad).toBe(0);
  // (the rank: the identity's order, stable whatever the tile's own)
  expect([...P.records].map((r) => r.rank)).toEqual(P.records.map((_, i) => i));
});

const CACHE = `${homedir()}/.kerr-cache/bdtopo/15`;
test.skipIf(!existsSync(`${CACHE}/16941`))("a block of 5 × 5 tiles (Toulon): each building in exactly one cell; the time per tile", () => {
  const all = new Map<string, number>();
  // (the buildings seen in the block's inner tiles: their cell — the first of the tiles they touch, a neighbour at most — inside it;
  // one seen only on the border may belong to a tile beyond: a footprint wholly in a border tile's buffer is the next tile's)
  const inner = new Set<string>();
  const kept = new Map<string, number>();
  const ms: number[] = [];
  for (let x = 16939; x <= 16943; x++)
    for (let y = 12023; y <= 12027; y++) {
      const p = `${CACHE}/${x}/${y}.pbf`;
      if (!existsSync(p)) continue;
      const bytes = new Uint8Array(readFileSync(p));
      if (!bytes.length) continue;
      const ref = workerBuildings(bytes, x, y);
      for (const id of ref.keys()) {
        all.set(id, (all.get(id) ?? 0) + 1);
        if (x > 16939 && x < 16943 && y > 12023 && y < 12027) inner.add(id);
      }
      const P = prepareBdtopoCell(bytes, x, y, () => 50);
      ms.push(P.stats.ms);
      const inv = new Map([...ref.keys()].map((id) => [sourceKey(id), id]));
      for (const r of P.records) {
        const id = inv.get(r.sourceKey) ?? `?${r.sourceKey}`;
        kept.set(id, (kept.get(id) ?? 0) + 1);
      }
    }
  // (each building in one cell at most; none of the inner tiles' lost)
  const twice = [...kept.values()].filter((v) => v > 1).length;
  const unknown = [...kept.keys()].filter((k) => k.startsWith("?")).length;
  const lost = [...inner].filter((id) => !kept.has(id)).length;
  ms.sort((a, b) => a - b);
  console.log(
    `  ${ms.length} tiles: ${all.size} buildings in the tiles, ${kept.size} kept — twice ${twice}, not the worker's ${unknown}, lost across a seam ${lost}; per tile median ${ms[ms.length >> 1]?.toFixed(1)} ms, worst ${ms.at(-1)?.toFixed(1)} ms`,
  );
  expect(twice).toBe(0);
  expect(unknown).toBe(0);
  expect(lost).toBe(0);
});
