// PLAN-J8 J8-L — the streets' cells prepared (street-cells.ts): an OpenMapTiles z 14 tile (OpenFreeMap's — scenery-sources.ts osmUrl —,
// its `transportation` layer) into its four z 15 street cells, with the same rules as the scenery worker's own lamps and traffic
// (scenery-worker.ts: streetlamps.ts lampsAlong on the town streets' runs, not on a bridge nor in a tunnel, where buildings stand about
// them — builtUp, from the building cells' records —; traffic.ts the main roads cut into pieces of PIECE_M at most). Each lamp kept in
// the cell of its foot, each piece in the cell of its middle; only those within this z 14 tile (its neighbours keep theirs). No ground:
// the far layer sets them on the relief as drawn. Pure: the cell workers run it, the tests too.
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { cellOrigin, fromCell, readHeader, readRecord, toCell } from "./building-cells";
import { roadWidth } from "./scenery-geometry";
import { builtUp, LAMP_CLASSES, lampsAlong } from "./streetlamps";
import {
  encodeStreetCell,
  StreetFlag,
  type StreetLampRecord,
  type StreetPieceRecord,
  type LAMP_CODES,
  type TRAFFIC_CODES,
} from "./street-cells";
import { PIECE_M, ROAD_TRAFFIC } from "./traffic";

const D = Math.PI / 180;
const OSM_Z = 14;

export interface PreparedStreetCell {
  x: number;
  y: number;
  buf: ArrayBuffer;
  lamps: StreetLampRecord[];
  pieces: StreetPieceRecord[];
}

/** a deterministic u32 from a cell and an index (the cars' phase) */
function seedOf(x: number, y: number, i: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (i * 83492791);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * An OpenMapTiles z 14 tile's four z 15 street cells (north-west, north-east, south-west, south-east, as cell-prep-overture.ts orders
 * them). `buildings(x, y)`: the building cell of a z 15 cell (its bytes, or null) — the town's test for the lamps; `generation`: the
 * roads' revision (YYYYMMDD).
 */
export function prepareStreetCells(
  bytes: ArrayBuffer | Uint8Array,
  x14: number,
  y14: number,
  buildings: (x: number, y: number) => ArrayBuffer | null,
  generation = 0,
): PreparedStreetCell[] {
  const n = 2 ** OSM_Z;
  const tileOrigin = cellOrigin(x14, y14, OSM_Z);
  const cells = [0, 1, 2, 3].map((k) => {
    const x = x14 * 2 + (k % 2),
      y = y14 * 2 + Math.floor(k / 2);
    return { x, y, origin: cellOrigin(x, y, OSM_Z + 1), lamps: [] as StreetLampRecord[], pieces: [] as StreetPieceRecord[] };
  });
  // (which of the four a place falls in — null: outside this tile)
  const cellAt = (lat: number, lon: number) => {
    const fx = ((lon + 180) / 360) * n * 2 - x14 * 2,
      fy = ((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * n * 2 - y14 * 2;
    if (fx < 0 || fx >= 2 || fy < 0 || fy >= 2) return null;
    return cells[Math.floor(fy) * 2 + Math.floor(fx)]!;
  };
  // (the town: the four building cells' records, their centres in the tile's frame)
  const centres: [number, number][] = [];
  for (const c of cells) {
    const buf = buildings(c.x, c.y);
    const h = buf ? readHeader(buf) : null;
    if (!buf || !h) continue;
    for (let i = 0; i < h.count; i++) {
      const r = readRecord(buf, i);
      const g = fromCell(c.origin, r.east, r.north);
      const m = toCell(tileOrigin, g.lat, g.lon);
      centres.push([m.east, m.north]);
    }
  }
  const town = builtUp(centres);
  const layer = bytes.byteLength ? new VectorTile(new PbfReader(bytes)).layers.transportation : undefined;
  let pieceIndex = 0;
  for (let i = 0; layer && i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 2) continue;
    const pr = f.properties;
    const cls = String(pr.class ?? "");
    const brunnel = !!pr.brunnel;
    const lamp = LAMP_CLASSES[cls] && !brunnel;
    const traffic = ROAD_TRAFFIC[cls] && !brunnel;
    if (!lamp && !traffic) continue;
    const e = f.extent;
    for (const line of f.loadGeometry()) {
      const geo = line.map((v) => ({
        lon: ((x14 + v.x / e) / n) * 360 - 180,
        lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y14 + v.y / e)) / n))) / D,
      }));
      const xy = geo.map((g) => {
        const m = toCell(tileOrigin, g.lat, g.lon);
        return [m.east, m.north] as [number, number];
      });
      if (lamp) {
        const width = roadWidth(cls, String(pr.subclass ?? ""));
        for (const l of lampsAlong(xy, cls, width)) {
          if (!town(l.foot[0], l.foot[1])) continue;
          const g = fromCell(tileOrigin, l.foot[0], l.foot[1]);
          const c = cellAt(g.lat, g.lon);
          if (!c) continue;
          const m = toCell(c.origin, g.lat, g.lon);
          // (left of the direction: the foot on the side of (−dy, dx))
          const left = (l.foot[0] - xy[l.seg]![0]) * -l.dir[1] + (l.foot[1] - xy[l.seg]![1]) * l.dir[0] > 0;
          c.lamps.push({
            east: m.east,
            north: m.north,
            height: l.head[2],
            cls: cls as (typeof LAMP_CODES)[number],
            flags: left ? StreetFlag.Left : 0,
          });
        }
      }
      if (traffic) {
        const one = Number(pr.oneway) || 0;
        const flags = one > 0 ? StreetFlag.OnewayAlong : one < 0 ? StreetFlag.OnewayAgainst : 0;
        for (let j = 0; j + 1 < xy.length; j++) {
          const [ax, ay] = xy[j]!,
            [bx, by] = xy[j + 1]!;
          const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / PIECE_M));
          for (let s = 0; s < k; s++) {
            const pa: [number, number] = [ax + ((bx - ax) * s) / k, ay + ((by - ay) * s) / k],
              pb: [number, number] = [ax + ((bx - ax) * (s + 1)) / k, ay + ((by - ay) * (s + 1)) / k];
            const mid = fromCell(tileOrigin, (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2);
            const c = cellAt(mid.lat, mid.lon);
            if (!c) continue;
            const ga = fromCell(tileOrigin, pa[0], pa[1]),
              gb = fromCell(tileOrigin, pb[0], pb[1]);
            const ma = toCell(c.origin, ga.lat, ga.lon),
              mb = toCell(c.origin, gb.lat, gb.lon);
            c.pieces.push({
              a: [ma.east, ma.north],
              b: [mb.east, mb.north],
              cls: cls as (typeof TRAFFIC_CODES)[number],
              flags,
              speed: ROAD_TRAFFIC[cls]!.speed,
              seed: seedOf(c.x, c.y, pieceIndex++),
            });
          }
        }
      }
    }
  }
  return cells.map((c) => ({
    x: c.x,
    y: c.y,
    lamps: c.lamps,
    pieces: c.pieces,
    buf: encodeStreetCell(
      { z: OSM_Z + 1, x: c.x, y: c.y, generation, originLat: c.origin.lat, originLon: c.origin.lon },
      c.lamps,
      c.pieces,
    ),
  }));
}
