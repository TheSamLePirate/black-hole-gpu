// PLAN-J8 J8-8b lot (1) — where the data keep a forest cell's trees off (forest-prep.ts): the scene's own rules (scenery-worker.ts — its
// surfaces, `networkExcludedAt` at 7 m; its footprints, `housedAt` at 1.5 m), in the cell's frame (building-cells.ts toCell: east, north
// metres): OpenMapTiles' water, waterway, transportation and aeroway — a tunnel's, an indoor or underground feature's none; an aerodrome's
// or a heliport's outline none (it is not a pavement); a polygon of more than 4 096 vertices none; a line widened by its class
// (scenery-geometry.ts roadWidth, the waterways' widths), a ferry's or an aerialway's none, a bridge's a water's only (a road on a deck
// leaves the ground under it to the trees), each segment its middle's tile's (the tiles' buffers: no double) —; and every building's
// footprint the cell's tile holds (its buffer's neighbours too). The scene's budgets (its surfaces kept nearest first) do not apply: a
// cell keeps all of its own. Pure: the cells' workers give the tiles' bytes.
import { classifyRings, VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { toCell } from "./building-cells";
import type { Vec3 } from "../physics";
import type { Primitive } from "./scenery-data";
import { polygonPrimitive, roadWidth, surfaceContains, surfaceSegment } from "./scenery-geometry";

const D = Math.PI / 180;
/** the margins [m]: a tree's foot this far from a surface — a road, a river — or a building (the scene's) */
export const NETWORK_MARGIN_M = 7;
export const HOUSE_MARGIN_M = 1.5;
/** the index's square [m] */
const SQUARE = 64;

/** An OpenMapTiles z 14 tile's surfaces in a cell's frame (`origin` its centre): the polygons, the widened segments. */
export function omtSurfaces(bytes: ArrayBuffer | Uint8Array, x14: number, y14: number, origin: { lat: number; lon: number }): Primitive[] {
  const out: Primitive[] = [];
  if (!bytes.byteLength) return out;
  const layers = new VectorTile(new PbfReader(bytes)).layers;
  const n = 2 ** 14;
  for (const name of ["water", "waterway", "transportation", "aeroway"]) {
    const l = layers[name];
    if (!l) continue;
    for (let i = 0; i < l.length; i++) {
      const f = l.feature(i),
        props = f.properties;
      if (props.brunnel === "tunnel" || props.indoor === 1 || Number(props.level) < 0) continue;
      const e = f.extent;
      const point = (v: { x: number; y: number }): Vec3 => {
        const lon = ((x14 + v.x / e) / n) * 360 - 180,
          lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y14 + v.y / e)) / n))) / D;
        const m = toCell(origin, lat, lon);
        return [m.east, m.north, 0];
      };
      const cls = String(props.class ?? ""),
        subclass = String(props.subclass ?? "");
      const water = name === "water" || name === "waterway";
      if (name === "aeroway" && (cls === "aerodrome" || cls === "heliport")) continue;
      if (f.type === 3 && (name === "water" || name === "aeroway" || name === "transportation")) {
        for (const rings of classifyRings(f.loadGeometry())) {
          if (rings.reduce((s, r) => s + r.length, 0) > 4096) continue;
          // (a bridge's area — the scene's deck, not its ground —: none)
          if (props.brunnel === "bridge" || cls === "bridge") continue;
          const p = polygonPrimitive(
            rings.map((r) => r.map(point)),
            0,
            0,
            water ? 4 : 5,
            [0, 0, 0],
          );
          if (p) out.push(p);
        }
      } else if (f.type === 2 && (name === "transportation" || name === "waterway")) {
        if (cls === "ferry" || cls === "aerialway") continue;
        const rail =
          cls === "rail" ||
          cls === "transit" ||
          ["tram", "light_rail", "narrow_gauge", "monorail", "funicular", "preserved"].includes(subclass);
        const width = water
          ? cls === "river"
            ? 14
            : cls === "canal"
              ? 8
              : cls === "stream"
                ? 3
                : 1.5
          : roadWidth(rail ? "rail" : cls.replace("_construction", ""), subclass) * (props.ramp === 1 ? 0.65 : 1);
        for (const line of f.loadGeometry()) {
          if (props.brunnel === "bridge" && !water) continue;
          const locals = line.map(point);
          for (let j = 0; j + 1 < locals.length; j++) {
            const aa = line[j]!,
              bb = line[j + 1]!;
            const mx = (aa.x + bb.x) / 2,
              my = (aa.y + bb.y) / 2;
            const a = locals[j]!,
              b = locals[j + 1]!;
            if (mx < 0 || mx >= e || my < 0 || my >= e || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.1) continue;
            out.push(surfaceSegment(a, b, width, water ? 3 : rail ? 2 : 1, [0, 0, 0]));
          }
        }
      }
    }
  }
  return out;
}

/** footprints' rings [east, north] in the cell's frame as primitives */
export function footprintPrimitives(footprints: readonly (readonly (readonly [number, number])[])[][]): Primitive[] {
  const out: Primitive[] = [];
  for (const rings of footprints) {
    const p = polygonPrimitive(
      rings.map((r) => r.map(([x, y]) => [x, y, 0] as Vec3)),
      0,
      1,
      1,
      [0, 0, 0],
    );
    if (p) out.push(p);
  }
  return out;
}

/**
 * The cell's exclusion: (lat, lon) → whether a tree may not stand there — within NETWORK_MARGIN_M of a surface, HOUSE_MARGIN_M of a
 * footprint (each indexed by SQUARE m squares of the cell's frame).
 */
export function forestExcluded(
  origin: { lat: number; lon: number },
  surfaces: readonly Primitive[],
  houses: readonly Primitive[],
): (lat: number, lon: number) => boolean {
  const key = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);
  const index = (list: readonly Primitive[], margin: number) => {
    const m = new Map<number, Primitive[]>();
    for (const v of list)
      for (let y = Math.floor((v.min[1] - margin) / SQUARE); y <= Math.floor((v.max[1] + margin) / SQUARE); y++)
        for (let x = Math.floor((v.min[0] - margin) / SQUARE); x <= Math.floor((v.max[0] + margin) / SQUARE); x++) {
          const k = key(x, y);
          const c = m.get(k) ?? [];
          c.push(v);
          m.set(k, c);
        }
    return m;
  };
  const net = index(surfaces, NETWORK_MARGIN_M),
    home = index(houses, HOUSE_MARGIN_M);
  return (lat, lon) => {
    const c = toCell(origin, lat, lon);
    const p: Vec3 = [c.east, c.north, 0];
    const k = key(Math.floor(c.east / SQUARE), Math.floor(c.north / SQUARE));
    return (
      (net.get(k)?.some((v) => surfaceContains(p, v, NETWORK_MARGIN_M)) ?? false) ||
      (home.get(k)?.some((v) => surfaceContains(p, v, HOUSE_MARGIN_M)) ?? false)
    );
  };
}
