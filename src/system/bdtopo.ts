// The IGN's buildings over France (docs/ANALYSE-IGN-LIDAR.md I5): the BD TOPO's footprints and measured heights in the
// scenery instead of OpenStreetMap's — its `hauteur` from the ground to the roof (photogrammetry, the LiDAR), set for 92 %
// of Paris's buildings, where OSM's are often a guess from the levels or none at all. Against the LiDAR's surface less its
// ground (MNS − MNT, the median over each footprint), measured 2026-10-23: 0.9–2.0 m median off for the BD TOPO, 2.7–5.6 m
// for OSM (Nantes, Saint-Lô, Paris's Front de Seine). The roads, the water, the airfields stay OSM's.
//
// The Géoplateforme's vector tiles (TMS, XYZ rows despite the name, z 15 the buildings' first level; CORS open, kept 21 days by
// the browser): a z 15 tile is 0.8 km at 49°, ~300 KB and ~1 000 buildings in Paris, a few dozen KB in the country. A
// building across two tiles comes in both, cut with a margin: each copy clipped to its own tile's square, the two prisms meet
// at the edge.

/** a vector tile's point (tile units) */
export interface Point {
  x: number;
  y: number;
}
type Properties = Record<string, unknown>;

/** the buildings' tiles' level */
export const BDTOPO_Z = 15;
/** the IGN's box (earth-tiles.ts ORTHO_BOX — copied: that module is the renderer's, too heavy for a worker or the zones; tests/
 *  cell-overture.test.ts holds the two equal). A rectangle: Belgium, Luxembourg, Catalonia and Cornwall are in it, the BD TOPO empty
 *  there (PLAN-J8 J8-7: the cells fall back on Overture's) */
export const BDTOPO_BOX = { west: -5.6, east: 9.8, south: 41.2, north: 51.2 } as const;
/** whether a z 15 cell's centre is in the IGN's box (the BD TOPO asked first) */
export function inBdtopoBox(x: number, y: number, z = BDTOPO_Z): boolean {
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) / (Math.PI / 180);
  return lon > BDTOPO_BOX.west && lon < BDTOPO_BOX.east && lat > BDTOPO_BOX.south && lat < BDTOPO_BOX.north;
}
export const bdtopoUrl = (x: number, y: number) => `https://data.geopf.fr/tms/1.0.0/BDTOPO/${BDTOPO_Z}/${x}/${y}.pbf`;
/** a storey [m] (a building whose height is missing: its storeys' count, else OSM's default) */
const STOREY = 3;
const DEFAULT_HEIGHT = 6;

/** whether a building stands (not destroyed, nor a ruin, nor a project) */
export function bdtopoStands(p: Properties): boolean {
  const s = String(p.etat_de_l_objet ?? "En service");
  return s !== "Détruit" && s !== "En ruine" && s !== "En projet";
}
/** a building's height [m]: its measured `hauteur`, else its storeys', else OSM's default — clamped as OSM's */
export function bdtopoHeight(p: Properties): number {
  const h = typeof p.hauteur === "number" && Number.isFinite(p.hauteur) && p.hauteur > 0 ? p.hauteur : null;
  const levels = typeof p.nombre_d_etages === "number" && p.nombre_d_etages > 0 ? p.nombre_d_etages * STOREY + 1 : null;
  return Math.min(500, Math.max(2, h ?? levels ?? DEFAULT_HEIGHT));
}

/** a ring (tile units, closed) clipped to the tile's square [0, e]² (Sutherland–Hodgman: the square convex — a concave ring
 *  may keep a sliver along an edge, its area none); fewer than 3 corners left: [] */
export function clipRing(ring: Point[], e: number): Point[] {
  let pts = ring.length > 1 && ring[0]!.x === ring.at(-1)!.x && ring[0]!.y === ring.at(-1)!.y ? ring.slice(0, -1) : ring.slice();
  const edges: [(p: Point) => number][] = [[(p) => p.x], [(p) => e - p.x], [(p) => p.y], [(p) => e - p.y]];
  for (const [side] of edges) {
    if (pts.length < 3) return [];
    const out: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!,
        b = pts[(i + 1) % pts.length]!;
      const da = side(a),
        db = side(b);
      if (da >= 0) out.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      }
    }
    pts = out;
  }
  if (pts.length < 3) return [];
  return [...pts, pts[0]!];
}

// (PLAN-PONT-ROUTES-AAA, the bridges' real decks — 25 Nov 2026) The BD TOPO's sections carry a 3D geometry — each vertex's altitude
// over the IGN69 levelling (the sea's, mean sea level: the geoid's N to add for the ellipsoid) —, but its vector tiles (the TMS above)
// are 2D: their properties name the altimetric method (« Z corrigé ») and precision, never the heights. The Géoplateforme's WFS hands
// the same sections with their Z (GeoJSON [lon, lat, z]; -1000 where the survey has none). One request a z 14 tile — the street
// cells' preparation unit — for the sections over the ground (bridges: position_par_rapport_au_sol > 0), roads and railways together,
// their cleabs and geometry alone: ~10–35 kB in a city (Nantes 13 kB, central Paris 35 kB for 88 sections), none in the country.
// Read on 24 Nov 2026: Pont de Cheviré's three sections rise 10 → 60.7 → 10 m over 1.5 km, continuous from one section to the next.

/** the BD TOPO's bridge sections with their heights over a z 14 tile (the WFS: GeoJSON, both typenames in one query) */
export function bdtopoDecksUrl(x14: number, y14: number): string {
  const n = 2 ** 14;
  const lat = (t: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) / (Math.PI / 180);
  const w = ((x14 / n) * 360 - 180).toFixed(6),
    e = (((x14 + 1) / n) * 360 - 180).toFixed(6),
    no = lat(y14).toFixed(6),
    s = lat(y14 + 1).toFixed(6);
  // (CQL's BBOX in EPSG:4326's own axis order: latitude first)
  const f = encodeURIComponent(`position_par_rapport_au_sol>'0' AND BBOX(geometrie,${s},${w},${no},${e})`);
  return (
    "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature" +
    "&TYPENAMES=(BDTOPO_V3:troncon_de_route)(BDTOPO_V3:troncon_de_voie_ferree)&OUTPUTFORMAT=application/json" +
    `&PROPERTYNAME=(cleabs,geometrie)(cleabs,geometrie)&CQL_FILTER=${f};${f}`
  );
}

/** a section's vertices: longitude, latitude [°], its altitude over the sea [m] (NaN: none surveyed) */
export type DeckLine = [number, number, number][];

/**
 * The WFS's answer as each section's 3D lines by its cleabs (the vector tiles' own identity): the survey's -1000 (and any absurd
 * value: under -50 m or over 9 000 m) taken as none (NaN). A section with no height at all is left out. Malformed: an empty map.
 */
export function parseBdtopoDecks(json: unknown): Map<string, DeckLine[]> {
  const out = new Map<string, DeckLine[]>();
  const feats = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(feats)) return out;
  for (const f of feats as { properties?: { cleabs?: unknown }; geometry?: { type?: string; coordinates?: unknown } }[]) {
    const id = typeof f?.properties?.cleabs === "string" ? f.properties.cleabs : null;
    const g = f?.geometry;
    if (!id || !g) continue;
    const lines = (
      g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? (g.coordinates as unknown[]) : []
    ) as unknown[];
    for (const line of lines) {
      if (!Array.isArray(line)) continue;
      const pts: DeckLine = [];
      for (const c of line as unknown[]) {
        if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
        const z = typeof c[2] === "number" && c[2] > -50 && c[2] < 9000 ? c[2] : Number.NaN;
        pts.push([c[0], c[1], z]);
      }
      if (pts.length < 2 || !pts.some((p) => Number.isFinite(p[2]))) continue;
      (out.get(id) ?? out.set(id, []).get(id)!).push(pts);
    }
  }
  return out;
}
