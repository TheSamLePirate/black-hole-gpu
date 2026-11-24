// PLAN-PONT-ROUTES-AAA B1 (24 Nov 2026) — a road's surface material, its « revêtement »: what the data say of it, and where they say
// nothing the rule below. The raster material draws it (trace.wgsl roadPavement: asphalt's aggregate and wheel paths, concrete's slabs
// and joints, setts, gravel's and earth's ruts — each wet in the rain as its pores and hollows make it).
//
// The sources: the BD TOPO's troncon_de_route has no surface field — its `nature` says « Route empierrée » (a gravel road), « Chemin »
// (an earth track), « Sentier » (a path), « Escalier » (steps); OpenMapTiles' transportation has `surface` reduced to paved / unpaved
// (OSM's surface=* folded by OpenMapTiles), its `subclass` pedestrian (a pedestrian street or square). Nothing in either names setts or
// concrete. The rule, in order (each step inferred unless it names the data):
//   1. data: BD TOPO « Route empierrée » → gravel; « Chemin », « Sentier » → earth; OMT surface=unpaved → gravel (a path's: earth);
//      OMT surface=paved → asphalt (a pedestrian way's: setts);
//   2. class: a track → gravel, a path → earth (unpaved unless the data say paved); steps → concrete (stone or concrete treads);
//   3. place: a pedestrian street in a town (OMT subclass pedestrian) → setts — the old centres' pavés, the most common finish of a
//      European pedestrian street; a motorway or trunk in North America (15–72° N, 170–50° W) → concrete — jointed concrete pavement
//      is a common surface of the US and Canadian freeways (Europe's are mostly asphalt); an inference, not a survey;
//   4. else asphalt.
// What it does not do: guess setts in an old town's ordinary streets (no field says which are), concrete in Europe, a surface per lane.

/** the material's code — the scene's road word's bits 16–18 (trace.wgsl roadPavement) */
export enum RoadSurface {
  Asphalt = 0,
  Concrete = 1,
  Setts = 2,
  Gravel = 3,
  Earth = 4,
}
/** the material's place in the scene's road word (data[6]): × this */
export const ROAD_SURFACE_UNIT = 65536;
/** a street cell's surface record's flags: the material + 1 in bits 5–7 (0: not written — a cell before B1: inferred at the reading) */
export const CELL_SURFACE_SHIFT = 5;

export interface RoadSurfaceInput {
  /** the class (OpenMapTiles' names; the BD TOPO's mapped onto them) */
  cls: string;
  /** OpenMapTiles' subclass (pedestrian, footway, …) */
  subclass?: string;
  /** OpenMapTiles' surface (paved, unpaved) */
  surface?: string;
  /** the BD TOPO's nature */
  nature?: string;
  urban?: boolean;
  /** the place [°] (the concrete rule) */
  lat?: number;
  lon?: number;
}

/** a road's material by the rule above */
export function inferRoadSurface(r: RoadSurfaceInput): RoadSurface {
  if (r.nature === "Route empierrée") return RoadSurface.Gravel;
  if (r.nature === "Chemin" || r.nature === "Sentier") return RoadSurface.Earth;
  const path = r.cls === "path";
  if (r.surface === "unpaved") return path ? RoadSurface.Earth : RoadSurface.Gravel;
  if (r.subclass === "pedestrian") return RoadSurface.Setts;
  if (r.surface === "paved") return RoadSurface.Asphalt;
  if (r.cls === "track") return RoadSurface.Gravel;
  if (path) return RoadSurface.Earth;
  if (r.cls === "steps") return RoadSurface.Concrete;
  if (
    (r.cls === "motorway" || r.cls === "trunk") &&
    r.lat !== undefined &&
    r.lon !== undefined &&
    r.lat > 15 &&
    r.lat < 72 &&
    r.lon > -170 &&
    r.lon < -50
  )
    return RoadSurface.Concrete;
  return RoadSurface.Asphalt;
}

/** a material's colour (linear albedo) — the walk's road colour, roadPavement's detail over it */
export function roadSurfaceColour(m: RoadSurface): number[] {
  switch (m) {
    case RoadSurface.Concrete:
      return [0.27, 0.265, 0.25];
    case RoadSurface.Setts:
      return [0.17, 0.155, 0.14];
    case RoadSurface.Gravel:
      return [0.26, 0.23, 0.19];
    case RoadSurface.Earth:
      return [0.19, 0.145, 0.095];
    default:
      return [0.095, 0.098, 0.1];
  }
}

/** a street cell's surface flags with the material written (its bits 5–7: the material + 1) */
export const withCellSurface = (flags: number, m: RoadSurface) => (flags & 31) | ((m + 1) << CELL_SURFACE_SHIFT);
/** the material a street cell's surface flags name, or null (a cell before B1) */
export const cellSurfaceOf = (flags: number): RoadSurface | null => {
  const m = (flags >> CELL_SURFACE_SHIFT) & 7;
  return m > 0 && m <= 5 ? ((m - 1) as RoadSurface) : null;
};
