// PLAN-J8 J8-E — the inland water of the whole view (Sam, 16 Nov 2026: « les fleuves et rivières doivent TOUS être chargés dans la
// vue »): the rivers, canals and lakes of OpenMapTiles' `water` (polygons) and `waterway` (lines) layers, drawn from the same vector
// tile night-roads.ts reads for the street levels (OpenFreeMap's z 13 — ROAD_MVT_Z1 —, a z 14 tile from its parent's quarter) into
// a 256² coverage (0 … 1, anti-aliased): the street levels' layer carries it (earth-tiles.ts IMG_ROADS0, its g), shadeLite reads it
// past the scene's square (inlandWater, the scene's own water nearer). The sea left out — the game's sea is the geoid's (its
// `ocean`/`sea` polygons): a lake, a river's polygon, a canal, a dock kept. A river under a texel keeps its share of the texel (its
// width over the pixel): the tile's mips fade it out, no dotted line. The bridges' decks (PLAN-J8 J8-RP RP7, 17 Nov 2026 — the
// approaches' session, the file lent by the render session): `transportation`'s bridges — their class's width (roadWidth) and
// BRIDGE_SIDES_M of parapets — cut out of the coverage, no water painted over a deck seen from afar. Pure, run in the decode worker
// (tile-decode.ts); tests/water-mask.test.ts.

import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { roadWidth } from "./scenery-geometry";

const TILE = 256;
/** the polygons' supersampling a side (4 × 4 a texel: the coverage in sixteenths) */
const SS = 4;
/** OpenMapTiles' `water` classes left out: the sea's (the game's own) and the pools */
const WATER_SKIP = new Set(["ocean", "sea", "swimming_pool"]);
/** each `waterway` class's width [m] (OpenMapTiles gives none): a river's, a canal's, a stream's, a ditch's */
export const WATERWAY_WIDTH_M: Record<string, number> = { river: 40, canal: 18, stream: 4, drain: 2, ditch: 1.5 };
/** a bridge's deck beyond its class's carriageway: its parapets, both sides [m] (J8-RP RP7) */
export const BRIDGE_SIDES_M = 2;

/**
 * A vector tile's inland water drawn into a 256² coverage (row 0 the north): its `water` polygons (even-odd, 4 × 4 samples a texel)
 * and its `waterway` lines (each class's width, anti-aliased by the distance — a line under a texel its width's share of it), the
 * greater kept; null when the tile has neither layer. `sub`: a coarser tile's square (k levels up, this tile's place in it).
 */
export function waterMask(
  raw: ArrayBuffer | Uint8Array,
  mpp: number,
  sub: { k: number; x: number; y: number } = { k: 0, x: 0, y: 0 },
  /** (25 Nov 2026) the bridges' decks cut out (the water seen from afar); false: the bed under them the river's (water-flatten.ts) */
  cutBridges = true,
): Float32Array | null {
  const layers = new VectorTile(new PbfReader(raw instanceof Uint8Array ? raw : new Uint8Array(raw))).layers;
  const water = layers.water,
    ways = layers.waterway;
  if (!water && !ways) return null;
  const m = new Float32Array(TILE * TILE);
  if (water) {
    const k = (TILE * 2 ** sub.k) / water.extent;
    const ox = sub.x * TILE,
      oy = sub.y * TILE;
    const S = TILE * SS;
    const hits = new Uint16Array(TILE * TILE);
    for (let f = 0; f < water.length; f++) {
      const ft = water.feature(f);
      if (ft.type !== 3 || WATER_SKIP.has(String(ft.properties.class ?? ""))) continue;
      // (its rings — the outer and its holes: even-odd —, in samples)
      const rings = ft.loadGeometry().map((r) => r.map((p) => [(p.x * k - ox) * SS, (p.y * k - oy) * SS] as [number, number]));
      let y0 = S,
        y1 = -1;
      for (const r of rings)
        for (const [, y] of r) {
          y0 = Math.min(y0, Math.floor(y));
          y1 = Math.max(y1, Math.ceil(y));
        }
      y0 = Math.max(y0, 0);
      y1 = Math.min(y1, S - 1);
      const xs: number[] = [];
      for (let sy = y0; sy <= y1; sy++) {
        const cy = sy + 0.5;
        xs.length = 0;
        for (const r of rings)
          for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
            const [ax, ay] = r[j]!,
              [bx, by] = r[i]!;
            if (ay > cy !== by > cy) xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
          }
        if (xs.length < 2) continue;
        xs.sort((a, b) => a - b);
        const row = Math.floor(sy / SS) * TILE;
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const sa = Math.max(Math.ceil(xs[i]! - 0.5), 0),
            sb = Math.min(Math.floor(xs[i + 1]! - 0.5), S - 1);
          for (let sx = sa; sx <= sb; sx++) hits[row + (sx >> 2)]!++;
        }
      }
    }
    for (let i = 0; i < m.length; i++) m[i] = Math.min(hits[i]! / (SS * SS), 1);
  }
  if (ways) {
    const k = (TILE * 2 ** sub.k) / ways.extent;
    const ox = sub.x * TILE,
      oy = sub.y * TILE;
    for (let f = 0; f < ways.length; f++) {
      const ft = ways.feature(f);
      if (ft.type !== 2) continue;
      const w = WATERWAY_WIDTH_M[String(ft.properties.class ?? "")];
      // (a tunnel's — a culvert, an underground channel —: not seen)
      if (!w || ft.properties.brunnel === "tunnel") continue;
      // (its width over the pixel: under a texel, its share of it — the coverage a line that thin leaves)
      const half = Math.max(w / mpp / 2, 0.5),
        share = Math.min(w / mpp, 1);
      for (const line of ft.loadGeometry()) {
        const pts = line.map((p) => [p.x * k - ox, p.y * k - oy] as [number, number]);
        for (let i = 1; i < pts.length; i++) stroke(m, pts[i - 1]!, pts[i]!, half, share);
      }
    }
  }
  // (J8-RP RP7: the bridges' decks cut out — a road's, a railway's, a footbridge's —, each its class's width and its parapets, their
  // share of a texel as a line's)
  const roads = cutBridges ? layers.transportation : undefined;
  if (roads) {
    const k = (TILE * 2 ** sub.k) / roads.extent;
    const ox = sub.x * TILE,
      oy = sub.y * TILE;
    for (let f = 0; f < roads.length; f++) {
      const ft = roads.feature(f);
      if (ft.type !== 2 || ft.properties.brunnel !== "bridge") continue;
      const cls = String(ft.properties.class ?? "");
      if (cls === "ferry" || cls === "aerialway") continue;
      const w =
        roadWidth(cls === "transit" ? "rail" : cls.replace("_construction", ""), String(ft.properties.subclass ?? "")) + BRIDGE_SIDES_M;
      const half = Math.max(w / mpp / 2, 0.5),
        share = Math.min(w / mpp, 1);
      for (const line of ft.loadGeometry()) {
        const pts = line.map((p) => [p.x * k - ox, p.y * k - oy] as [number, number]);
        for (let i = 1; i < pts.length; i++) stroke(m, pts[i - 1]!, pts[i]!, half, share, true);
      }
    }
  }
  return m;
}

/** a segment drawn into the coverage: each texel within half + 1 of it, its cover by the distance × share, the greater kept — or, `cut`,
 *  taken out of it (a deck over the water: the coverage scaled by what the deck leaves) */
function stroke(m: Float32Array, a: [number, number], b: [number, number], half: number, share: number, cut = false) {
  const r = half + 1;
  const x0 = Math.max(Math.floor(Math.min(a[0], b[0]) - r), 0),
    x1 = Math.min(Math.ceil(Math.max(a[0], b[0]) + r), TILE - 1),
    y0 = Math.max(Math.floor(Math.min(a[1], b[1]) - r), 0),
    y1 = Math.min(Math.ceil(Math.max(a[1], b[1]) + r), TILE - 1);
  if (x0 > x1 || y0 > y1) return;
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l2 = dx * dx + dy * dy;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - a[0],
        py = y + 0.5 - a[1];
      const t = l2 > 0 ? Math.min(Math.max((px * dx + py * dy) / l2, 0), 1) : 0;
      const ex = px - t * dx,
        ey = py - t * dy;
      const c = Math.min(Math.max(half + 0.5 - Math.sqrt(ex * ex + ey * ey), 0), 1) * share;
      if (cut) m[y * TILE + x]! *= 1 - c;
      else if (c > m[y * TILE + x]!) m[y * TILE + x] = c;
    }
}
