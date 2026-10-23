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
