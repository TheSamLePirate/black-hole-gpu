// PLAN-J8 J8-3 — a building cells' worker (one of the pool's — cell-pool.ts, cell-workers.ts): a cell asked {id, x, y}, its BD TOPO
// z 15 tile fetched (through the Service Worker: its tiles' cache and its zones'), decoded into the contract's records (cell-prep.ts:
// no roof planned, no mesh), the bytes put in the prepared cache (Cache Storage, CELL_CACHE — never decoded again) and handed back
// (transferred). {cancel: id}: its fetch aborted. The geoid's grid given once at the start ({geoid}): the buildings' ground over the
// ellipsoid (CLAUDE.md, WGS84 everywhere). PLAN-J8 J8-7: outside the IGN's box, and where the BD TOPO has no building in the cell,
// Overture Maps' (cell-overture.ts: its z 14 tile prepared into its four cells, the asked one handed). PLAN-J8 J8-L: {id, x, y, kind:
// "street"} — the cell « rue » (street-prep.ts): OpenMapTiles' z 14 tile, the four building cells under it (from the prepared cache, or
// prepared now), its four street cells put in their cache (kerr-street-v<format>), the asked one handed. PLAN-J8 J8-8: {…, kind: "mesh"} —
// the near buildings' mesh cell (mesh-prep.ts), kept in kerr-mesh-v<format>.
import { bdtopoDecksUrl, bdtopoUrl, type DeckLine, parseBdtopoDecks } from "./bdtopo";
import { inBdtopoBox, overtureCell, overtureTile } from "./cell-overture";
import { prepareOvertureCells } from "./cell-prep-overture";
import { CellSource, readHeader } from "./building-cells";
import { CELL_CACHE, cellCacheUrl } from "./cell-pool";
import { prepareBdtopoCell } from "./cell-prep";
import { geoidDeg, setGeoid } from "./geoid-grid";
import type { HeightMap } from "./heights-file";
import { ZONE_CACHE } from "../pwa/rules";
import { cellBounds, cellOrigin, toCell as toCellOf } from "./building-cells";
import { ignHeightUrl } from "./earth-tiles";
import { blockSides, blocksWithin, CANOPY_Z, IGN_MNH, IgnLand, inIgnBox } from "./ign-canopy";
import { encodeMeshCell, MESH_CACHE, meshCacheUrl, MeshCellFlag, readMeshHeader } from "./mesh-cells";
import { prepareMeshCell, prepareOvertureMeshCells } from "./mesh-prep";
import { STREET_CACHE, streetCacheUrl, streetRoadsUrl } from "./street-cells";
import { bdtopoHasBridges, prepareStreetCells } from "./street-prep";
import { bdtopoOwned } from "./cell-prep";
import { overtureOwned } from "./cell-prep-overture";
import { FOREST_CACHE, forestCacheUrl } from "./forest-cells";
import { loadCover } from "./forest-cover";
import { footprintPrimitives, forestExcluded, omtSurfaces } from "./forest-exclusions";
import { prepareForestCell } from "./forest-prep";
import { osmUrl } from "./scenery-sources";

type In =
  | { geoid: HeightMap }
  | { id: number; x: number; y: number; kind?: "building" | "street" | "mesh" | "forest" }
  | { cancel: number };
const g = self as unknown as { onmessage: (e: MessageEvent<In>) => void; postMessage: (m: unknown, t?: Transferable[]) => void };
const aborts = new Map<number, AbortController>();

g.onmessage = async (e) => {
  const m = e.data;
  if ("geoid" in m) {
    setGeoid(m.geoid);
    return;
  }
  if ("cancel" in m) {
    aborts.get(m.cancel)?.abort();
    aborts.delete(m.cancel);
    return;
  }
  const abort = new AbortController();
  aborts.set(m.id, abort);
  const t0 = performance.now();
  try {
    if (m.kind === "forest") {
      const F = await forestCell(m.x, m.y, abort.signal);
      if (abort.signal.aborted) return;
      g.postMessage({ id: m.id, buf: F.buf, ms: performance.now() - t0, prepMs: F.ms, kept: F.candidates }, [F.buf]);
      return;
    }
    if (m.kind === "mesh") {
      const M = await meshCell(m.x, m.y, abort.signal);
      if (abort.signal.aborted) return;
      g.postMessage({ id: m.id, buf: M.buf, ms: performance.now() - t0, prepMs: M.ms, kept: M.buildings }, [M.buf]);
      return;
    }
    if (m.kind === "street") {
      const S = await streetCell(m.x, m.y, abort.signal);
      if (abort.signal.aborted) return;
      g.postMessage({ id: m.id, buf: S.buf, ms: performance.now() - t0, kept: S.kept }, [S.buf]);
      return;
    }
    const P = await buildingCell(m.x, m.y, abort.signal);
    const fetchMs = performance.now() - t0;
    if (abort.signal.aborted) return;
    await keep(CELL_CACHE, cellCacheUrl(self.location.origin, m.x, m.y), P.buf);
    g.postMessage({ id: m.id, buf: P.buf, ms: performance.now() - t0, fetchMs, prepMs: P.stats.ms, kept: P.stats.kept }, [P.buf]);
  } catch (err) {
    if (!abort.signal.aborted) g.postMessage({ id: m.id, error: String(err).slice(0, 300) });
  } finally {
    aborts.delete(m.id);
  }
};

/** a cell's building records prepared: the BD TOPO's within the IGN's box; Overture's beyond it and where the BD TOPO has none */
async function buildingCell(x: number, y: number, signal: AbortSignal) {
  let P: ReturnType<typeof prepareBdtopoCell> | null = null;
  if (inBdtopoBox(x, y)) {
    const r = await fetch(bdtopoUrl(x, y), { signal });
    // (no tile there — the sea, a border —: an empty cell, cached as such)
    const bytes = r.status === 404 || r.status === 204 ? new ArrayBuffer(0) : r.ok ? await r.arrayBuffer() : null;
    if (!bytes) throw new Error(`BD TOPO ${x}/${y}: HTTP ${r.status}`);
    P = prepareBdtopoCell(bytes, x, y, (lat, lon) => geoidDeg(lat, lon));
  }
  // (beyond the box, or none of the BD TOPO's in the cell — Belgium, Catalonia within the box —: Overture's; its archive's reads
  // shared by the cells: not aborted with one — its result dropped by the caller if this cell was)
  if (!P || P.records.length === 0) {
    const o = await overtureCell(x, y);
    if (!P || o.records.length) P = o;
  }
  return P;
}

/** bytes put in a prepared cache (none — a private window —: prepared each time, nothing else lost) */
async function keep(name: string, url: string, buf: ArrayBuffer) {
  try {
    await (await caches.open(name)).put(url, new Response(buf.slice(0)));
  } catch {
    /* no Cache Storage */
  }
}

/** a z 15 cell's building bytes: from the prepared cache, else prepared now and kept */
async function buildingBytes(x: number, y: number, signal: AbortSignal): Promise<ArrayBuffer> {
  try {
    const hit = await (await caches.open(CELL_CACHE)).match(cellCacheUrl(self.location.origin, x, y));
    if (hit) return await hit.arrayBuffer();
  } catch {
    /* no Cache Storage */
  }
  const P = await buildingCell(x, y, signal);
  await keep(CELL_CACHE, cellCacheUrl(self.location.origin, x, y), P.buf);
  return P.buf;
}

/** A mesh cell (PLAN-J8 J8-8, mesh-cells.ts): its building cell first (its generation, its source — the ranks are its), then its
 *  source's tile through the Service Worker (the zone's copy) prepared into it (mesh-prep.ts) and kept in MESH_CACHE — the BD TOPO's
 *  z 15 tile, or Overture's z 14 tile (J8-7's cells: its four made at once). Another source's (OSM's alone): an empty mesh cell flagged
 *  SourceLater, the near scene draws there as before. The tile newer than the building cell: both made again from it (the ranks must
 *  agree). */
async function meshCell(x: number, y: number, signal: AbortSignal) {
  const cell = await buildingBytes(x, y, signal);
  let h = readHeader(cell)!;
  const key = (gen: number, canopy: boolean) => meshCacheUrl(self.location.origin, x, y, gen, canopy);
  // (Overture's buildings — abroad, or where the BD TOPO has none —: its z 14 tile's four mesh cells made and kept, the asked one
  // handed; a newer release than the building cells': those made again from it too — the ranks must agree)
  if (h.source === CellSource.Overture) {
    const x14 = Math.floor(x / 2),
      y14 = Math.floor(y / 2);
    const { raw, release } = await overtureTile(x14, y14);
    if (signal.aborted) throw new Error("cancelled");
    const meshes = prepareOvertureMeshCells(raw, x14, y14, release);
    if (meshes[0]!.generation !== h.generation)
      for (const c of prepareOvertureCells(raw, x14, y14, release)) {
        const ch = readHeader(c.buf)!;
        await keep(CELL_CACHE, cellCacheUrl(self.location.origin, ch.x, ch.y), c.buf);
      }
    let mine: (typeof meshes)[number] | null = null;
    for (const m of meshes) {
      const mh = readMeshHeader(m.buf)!;
      await keep(MESH_CACHE, meshCacheUrl(self.location.origin, mh.x, mh.y, m.generation, false), m.buf);
      if (mh.x === x && mh.y === y) mine = m;
    }
    return { buf: mine!.buf, ms: mine!.stats.ms, buildings: mine!.stats.buildings };
  }
  if (h.source !== CellSource.BdTopo || !inBdtopoBox(x, y)) {
    const buf = encodeMeshCell(
      {
        source: h.source,
        z: h.z,
        x,
        y,
        flags: MeshCellFlag.SourceLater,
        generation: h.generation,
        originLat: h.originLat,
        originLon: h.originLon,
      },
      [],
    );
    await keep(MESH_CACHE, key(h.generation, false), buf);
    return { buf, ms: 0, buildings: 0 };
  }
  const r = await fetch(bdtopoUrl(x, y), { signal });
  const bytes = r.status === 404 || r.status === 204 ? new ArrayBuffer(0) : r.ok ? await r.arrayBuffer() : null;
  if (!bytes) throw new Error(`BD TOPO ${x}/${y}: HTTP ${r.status}`);
  const land = await zoneCanopy(x, y, signal);
  const M = prepareMeshCell(bytes, x, y, (lat, lon) => geoidDeg(lat, lon), land ? (lat, lon) => land.canopy(lat, lon) : undefined);
  if (M.generation !== h.generation) {
    const P = prepareBdtopoCell(bytes, x, y, (lat, lon) => geoidDeg(lat, lon));
    await keep(CELL_CACHE, cellCacheUrl(self.location.origin, x, y), P.buf);
    h = readHeader(P.buf)!;
  }
  await keep(MESH_CACHE, key(M.generation, !!land), M.buf);
  return { buf: M.buf, ms: M.stats.ms, buildings: M.stats.buildings };
}

/** The IGN's canopy over a mesh cell — its ridgeless roofs measured (B6) — where an offline zone holds it (the render session's rule,
 *  17 Nov 2026: the corridor's; elsewhere guessed — no IGN load from the meshes' pool): every canopy block its buildings may reach, at the
 *  near scene's resolution, in the zones' cache; then read through the Service Worker (the zone's copy). Null: not all held, or a block
 *  failed. */
async function zoneCanopy(x: number, y: number, signal: AbortSignal): Promise<IgnLand | null> {
  const o = cellOrigin(x, y);
  if (!inIgnBox(o.lat, o.lon)) return null;
  const b = cellBounds(x, y);
  const half = 0.5 * Math.hypot((b.north - b.south) * 111_320, (b.east - b.west) * 111_320 * Math.cos((o.lat * Math.PI) / 180));
  const reach = half + 100;
  try {
    const zones = await caches.open(ZONE_CACHE);
    for (const k of blocksWithin(o.lat, o.lon, reach))
      if (!(await zones.match(ignHeightUrl(IGN_MNH, CANOPY_Z, k.x, k.y, blockSides(k.d).canopy)))) return null;
  } catch {
    return null;
  }
  const land = new IgnLand(async (url) => {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  });
  await land.prepare(o.lat, o.lon, reach, { ground: false });
  for (const k of blocksWithin(o.lat, o.lon, reach)) {
    const n = 2 ** CANOPY_Z;
    const lon = ((k.x + 0.5) / n) * 360 - 180,
      lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (k.y + 0.5)) / n))) * 180) / Math.PI;
    if (!land.hasCanopy(lat, lon)) return null;
  }
  return land;
}

/** A forest cell (PLAN-J8 J8-8b, forest-cells.ts): its candidates decided (forest-prep.ts) from the land cover's cells, the canopy where an
 *  offline zone holds it (J8-8's rule — zoneCanopy), the data's exclusions (forest-exclusions.ts): the footprints its building cell's
 *  source holds — the BD TOPO's tile, or Overture's z 14 —, the roads and waters of its OpenMapTiles z 14 tile and of the three across its
 *  outer edges (a segment is its middle's tile's); every source through the Service Worker (the zone's copy); kept in FOREST_CACHE under
 *  their newest generation. */
async function forestCell(x: number, y: number, signal: AbortSignal) {
  const origin = cellOrigin(x, y);
  const b = cellBounds(x, y);
  const pad = 0.0003;
  const fetchOk = async (url: string) => {
    const r = await fetch(url, { signal });
    if (r.status === 404 || r.status === 204) return new ArrayBuffer(0);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
    return r.arrayBuffer();
  };
  // (the footprints: its building cell's source — the BD TOPO's tile within the box, else Overture's z 14 —, every one the tile holds)
  const cell = await buildingBytes(x, y, signal);
  const h = readHeader(cell)!;
  const rings: [number, number][][][] = [];
  const toRing = (r: { x: number; y: number }[], e: number, tx: number, ty: number, z: number) => {
    const n = 2 ** z;
    return r.map((v) => {
      const lon = ((tx + v.x / e) / n) * 360 - 180,
        lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + v.y / e)) / n))) * 180) / Math.PI;
      const m = toCellPoint(lat, lon);
      return [m.east, m.north] as [number, number];
    });
  };
  const toCellPoint = (lat: number, lon: number) => toCellOf(origin, lat, lon);
  if (h.source === CellSource.BdTopo && inBdtopoBox(x, y)) {
    const d = bdtopoOwned(await fetchOk(bdtopoUrl(x, y)));
    for (const o of [...d.owned, ...d.others])
      for (const p of o.polys) rings.push(p.filter((r) => r.length >= 4).map((r) => toRing(r, o.extent, x, y, 15)));
  } else if (h.source === CellSource.Overture) {
    const { raw } = await overtureTile(x >> 1, y >> 1);
    const d = overtureOwned(raw, x >> 1, y >> 1);
    for (const o of d.outlines)
      for (const p of o.polys) rings.push(p.filter((r) => r.length >= 4).map((r) => toRing(r, o.extent, x >> 1, y >> 1, 14)));
  }
  // (the roads and waters: its z 14 tile, and the three across its outer edges)
  const x14 = x >> 1,
    y14 = y >> 1,
    dx = x & 1 ? 1 : -1,
    dy = y & 1 ? 1 : -1;
  const surfaces = [];
  for (const [tx, ty] of [
    [x14, y14],
    [x14 + dx, y14],
    [x14, y14 + dy],
    [x14 + dx, y14 + dy],
  ] as const) {
    try {
      surfaces.push(...omtSurfaces(await fetchOk(osmUrl(tx, ty)), tx, ty, origin));
    } catch {
      /* a tile not there: its roads none (said in the stats: fewer exclusions) */
    }
  }
  const excluded = forestExcluded(origin, surfaces, footprintPrimitives(rings.filter((r) => r.length)));
  const cover = await loadCover([b.west - pad, b.south - pad, b.east + pad, b.north + pad], fetchOk);
  const land = await zoneCanopy(x, y, signal);
  // (its generation: its building cell's — the newest of its sources this format can date)
  const generation = h.generation;
  const F = prepareForestCell(
    x,
    y,
    { cover: cover.at, canopy: land ? (lat, lon, r) => land.canopyNear(lat, lon, r) : undefined, excluded },
    generation,
    !!land,
  );
  await keep(FOREST_CACHE, forestCacheUrl(self.location.origin, x, y, generation, !!land), F.buf);
  return { buf: F.buf, ms: F.stats.ms, candidates: F.stats.candidates };
}

/** a street cell: its z 14 roads' tile, the four building cells under it, its four street cells prepared and kept, the asked one */
async function streetCell(x: number, y: number, signal: AbortSignal): Promise<{ buf: ArrayBuffer; kept: number }> {
  const x14 = x >> 1,
    y14 = y >> 1;
  const r = await fetch(streetRoadsUrl(x, y), { signal });
  const roads = r.status === 404 || r.status === 204 ? new ArrayBuffer(0) : r.ok ? await r.arrayBuffer() : null;
  if (!roads) throw new Error(`roads ${x14}/${y14}: HTTP ${r.status}`);
  const quads = [0, 1, 2, 3].map((k) => [x14 * 2 + (k % 2), y14 * 2 + Math.floor(k / 2)] as const);
  const built = new Map<string, ArrayBuffer>();
  for (const [cx, cy] of quads) built.set(`${cx}/${cy}`, await buildingBytes(cx, cy, signal));
  // (in France, each cell's BD TOPO tile — its troncon_de_route: the roads' widths, lanes, ways, bridges — through the Service Worker's
  // cache, the tile the building cell was prepared from; a tile that does not come: that cell's roads OpenMapTiles')
  // (25 Nov 2026: the four asked together — one round trip, not four, before the bridges' heights' own)
  const bd = new Map<string, ArrayBuffer>();
  await Promise.all(
    quads.map(async ([cx, cy]) => {
      if (!inBdtopoBox(cx, cy)) return;
      try {
        const t = await fetch(bdtopoUrl(cx, cy), { signal });
        if (t.ok) bd.set(`${cx}/${cy}`, await t.arrayBuffer());
      } catch {
        /* its roads OpenMapTiles' */
      }
    }),
  );
  // (format 6, 25 Nov 2026: where those tiles hold a bridge's section, their surveyed heights — the WFS's 3D lines over the z 14
  // tile, one request, through the Service Worker's cache as a tile; none, or a failure: the bridges' profiles by their clearance)
  let decks: Map<string, DeckLine[]> | null = null;
  if ([...bd.values()].some(bdtopoHasBridges))
    try {
      const t = await fetch(bdtopoDecksUrl(x14, y14), { signal });
      if (t.ok) decks = parseBdtopoDecks(await t.json());
    } catch {
      /* none: by their clearance */
    }
  // (the roads' revision: the response's Last-Modified day, else none)
  const lm = Date.parse(r.headers.get("last-modified") ?? "");
  const day = Number.isFinite(lm) ? Number(new Date(lm).toISOString().slice(0, 10).replaceAll("-", "")) : 0;
  const cells = prepareStreetCells(
    roads,
    x14,
    y14,
    (cx, cy) => built.get(`${cx}/${cy}`) ?? null,
    day,
    (cx, cy) => bd.get(`${cx}/${cy}`) ?? null,
    false,
    decks,
  );
  for (const c of cells) await keep(STREET_CACHE, streetCacheUrl(self.location.origin, c.x, c.y), c.buf);
  const mine = cells.find((c) => c.x === x && c.y === y)!;
  return { buf: mine.buf, kept: mine.lamps.length + mine.segments.length };
}
