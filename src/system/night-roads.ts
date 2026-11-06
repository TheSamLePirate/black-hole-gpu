// The towns' lights seen from afar (docs/PLAN-NUIT-URBAINE.md NU1; Sam, 6 Nov 2026: « la lumière des routes […] de haut surtout,
// c'est les formes caractéristiques des villes de nuit » — « utilise les lampadaires et le fond de carte assombri »). The night's
// lights come from VIIRS (GIBS, z 8: ~600 m a pixel), enlarged on the finer levels: from an aircraft a town was an orange smudge.
// On the levels ROAD_Z0 … 14, OpenStreetMap's streets — OpenFreeMap's vector tile, its `transportation` layer — are drawn into a
// pattern: the map's streets darkened (a faint glow of the lit roadway, each class its width) and their street lamps (the same
// lamps the scenery sets near — streetlamps.ts lampsAlong: each class's spacing, staggered on the wider streets —, each a point of
// a fixed light). VIIRS's light is spread over that pattern with its mean kept over VIIRS's own footprint (a box of ~600 m: a
// summed-area table): the town as bright as VIIRS says, its light where its lamps are — a floor of FLOOR between (windows, yards).
// Where no street is near, VIIRS's as it was. Pure functions, run in the decode worker (tile-decode.ts); tests/night-roads.test.ts.

import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { LAMP_CLASSES, lampsAlong } from "./streetlamps";

/** the first level whose tiles carry their streets' lights (z 12: ~25 m a pixel at 49°; OpenFreeMap's tiles go to z 14) */
export const ROAD_Z0 = 12;
/** the finest vector tiles asked for them: z 13's — every street there already, 219 kB over Paris against z 14's 644 kB —, a
 *  z 14 tile drawn from its z 13 parent's quarter */
export const ROAD_MVT_Z1 = 13;
/** the street levels' lights' encoding (an 8-bit alpha): logarithmic from L_MIN to L_MAX (VIIRS's scale, a fully lit town's
 *  mean 1) — a lamp's point a hundred times its street's mean, its sparkle, a yard's floor a hundredth: 3.7 % a step */
export const L_MIN = 0.01;
export const L_MAX = 100;
const LOG_SPAN = Math.log2(1 + L_MAX / L_MIN);
/** a town's light off its streets, over its mean */
const FLOOR = 0.03;
/** the mask's mean under which the streets are not used (none near: VIIRS's light as it was) */
const MIN_MEAN = 0.004;
/** VIIRS's footprint [m]: the box the light's mean is kept over */
const FOOTPRINT_M = 600;
const TILE = 256;

/** each class of OpenMapTiles' transportation layer: its lit width [m] and its lamps' brightness (a motorway's lit, its
 *  lanes wide; a service road dim); the others — tracks, paths, railways, ferries — unlit */
export const ROAD_CLASSES: Record<string, readonly [number, number]> = {
  motorway: [30, 1],
  trunk: [24, 0.95],
  primary: [18, 0.9],
  secondary: [14, 0.8],
  tertiary: [11, 0.7],
  minor: [8, 0.55],
  service: [5, 0.3],
};

/** a pixel's ground side [m] on a tile of level z, row y (Web Mercator at its middle's latitude) */
export function tileMetresPerPixel(z: number, y: number): number {
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z)));
  return (40075016.686 * Math.cos(lat)) / 2 ** z / TILE;
}

/**
 * A vector tile's streets drawn into a 256² mask (row 0 the north), each pixel its brightest street's brightness × its
 * cover (anti-aliased by the distance to the segment); null when the tile has no transportation layer.
 */
export function roadMask(
  raw: ArrayBuffer | Uint8Array,
  mpp: number,
  sub: { k: number; x: number; y: number } = { k: 0, x: 0, y: 0 },
): Float32Array | null {
  const layer = new VectorTile(new PbfReader(raw instanceof Uint8Array ? raw : new Uint8Array(raw))).layers.transportation;
  if (!layer) return null;
  const m = new Float32Array(TILE * TILE);
  // (a coarser tile's square — `sub`: k levels up, this tile's place in it —: its streets enlarged to this tile)
  const k = (TILE * 2 ** sub.k) / layer.extent;
  const ox = sub.x * TILE,
    oy = sub.y * TILE;
  // (a lamp's light — LAMP_LIGHT_M2 over the pixel's area —, a Gaussian of LAMP_SIGMA_M at the least a pixel's half)
  const sg = Math.max(LAMP_SIGMA_M / mpp, 0.55);
  const peak = LAMP_LIGHT_M2 / (mpp * mpp) / (2 * Math.PI * sg * sg);
  for (let f = 0; f < layer.length; f++) {
    const ft = layer.feature(f);
    if (ft.type !== 2) continue;
    const name = String(ft.properties.class ?? "");
    const cls = ROAD_CLASSES[name];
    if (!cls) continue;
    // (the darkened map: a street a pixel wide at least, a lane under a pixel lighting its pixel dimmer)
    const half = Math.max((cls[0] / mpp) * 0.5, 0.5);
    const w = GLOW * cls[1] * Math.max(Math.min(cls[0] / mpp, 1), 0.35);
    // (bridges and tunnels: their lamps the road's — a tunnel's none —)
    const tunnel = ft.properties.brunnel === "tunnel";
    for (const line of ft.loadGeometry()) {
      const pts = line.map((p) => [p.x * k - ox, p.y * k - oy] as [number, number]);
      if (!tunnel) for (let i = 1; i < pts.length; i++) segment(m, pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1], half, w);
      if (tunnel || !LAMP_CLASSES[name]) continue;
      // (its lamps, in metres as the scenery's, back to pixels)
      for (const l of lampsAlong(
        pts.map(([x, y]) => [x * mpp, y * mpp] as [number, number]),
        name,
        cls[0],
      ))
        splat(m, l.foot[0] / mpp, l.foot[1] / mpp, sg, peak);
    }
  }
  return m;
}

/** the darkened map's streets over a lamp's point: their glow's share of a lit street's light */
const GLOW = 0.25;
/** a lamp's light [m² of a street's full glow]: three times a minor street's own glow over its lamps' spacing */
const LAMP_LIGHT_M2 = 3 * GLOW * 8 * 28;
/** a lamp's pool seen from afar [m] (its Gaussian's σ) */
const LAMP_SIGMA_M = 2;

/** a lamp's point added to the pattern: a Gaussian of σ sg [px] and of that peak */
function splat(m: Float32Array, cx: number, cy: number, sg: number, peak: number) {
  const r = Math.ceil(3 * sg);
  const x0 = Math.max(Math.floor(cx - r), 0),
    x1 = Math.min(Math.ceil(cx + r), TILE - 1),
    y0 = Math.max(Math.floor(cy - r), 0),
    y1 = Math.min(Math.ceil(cy + r), TILE - 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx,
        dy = y + 0.5 - cy;
      m[y * TILE + x] = m[y * TILE + x]! + peak * Math.exp(-(dx * dx + dy * dy) / (2 * sg * sg));
    }
}

/** a segment drawn into the mask: each pixel within half + 1 of it, its cover by the distance, the brightest kept */
function segment(m: Float32Array, ax: number, ay: number, bx: number, by: number, half: number, w: number) {
  const r = half + 1;
  const x0 = Math.max(Math.floor(Math.min(ax, bx) - r), 0),
    x1 = Math.min(Math.ceil(Math.max(ax, bx) + r), TILE - 1),
    y0 = Math.max(Math.floor(Math.min(ay, by) - r), 0),
    y1 = Math.min(Math.ceil(Math.max(ay, by) + r), TILE - 1);
  if (x0 > x1 || y0 > y1) return;
  const dx = bx - ax,
    dy = by - ay,
    l2 = dx * dx + dy * dy;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - ax,
        py = y + 0.5 - ay;
      const t = l2 > 0 ? Math.min(Math.max((px * dx + py * dy) / l2, 0), 1) : 0;
      const ex = px - t * dx,
        ey = py - t * dy;
      const c = Math.min(Math.max(half + 0.5 - Math.sqrt(ex * ex + ey * ey), 0), 1);
      if (c > 0) {
        const v = w * c;
        if (v > m[y * TILE + x]!) m[y * TILE + x] = v;
      }
    }
}

/**
 * VIIRS's light v (a pixel's, 0 … 1: the decode's luminance × alpha) spread over the streets' mask: L = v · (FLOOR + (1 −
 * FLOOR) · mask / mean), its mean over the box of VIIRS's footprint kept; where the mask's mean is under MIN_MEAN, faded back to
 * v. Clipped at L_MAX (the encoding's ceiling).
 */
export function spreadLights(v: Float32Array, mask: Float32Array, mpp: number): Float32Array {
  const rad = Math.min(Math.max(Math.round(FOOTPRINT_M / 2 / mpp), 2), 64);
  // (the mask's summed-area table, a row and a column of zeros before)
  const S = new Float64Array((TILE + 1) * (TILE + 1));
  for (let y = 0; y < TILE; y++) {
    let row = 0;
    for (let x = 0; x < TILE; x++) {
      row += mask[y * TILE + x]!;
      S[(y + 1) * (TILE + 1) + x + 1] = S[y * (TILE + 1) + x + 1]! + row;
    }
  }
  const top = L_MAX;
  const out = new Float32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    const ya = Math.max(y - rad, 0),
      yb = Math.min(y + rad + 1, TILE);
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      const vi = v[i]!;
      if (vi <= 0) continue;
      const xa = Math.max(x - rad, 0),
        xb = Math.min(x + rad + 1, TILE);
      const sum = S[yb * (TILE + 1) + xb]! - S[ya * (TILE + 1) + xb]! - S[yb * (TILE + 1) + xa]! + S[ya * (TILE + 1) + xa]!;
      const mean = sum / ((yb - ya) * (xb - xa));
      const k = Math.min(Math.max((mean - MIN_MEAN) / (3 * MIN_MEAN), 0), 1);
      const spread = vi * (FLOOR + ((1 - FLOOR) * mask[i]!) / Math.max(mean, MIN_MEAN));
      out[i] = vi + k * (spread - vi);
    }
  }
  // (the tile's light kept exactly: the boxes' means differ pixel to pixel — near its edges, round sparse streets —, their sum
  // not VIIRS's by a fifth at worst; brought back to it, then clipped at the encoding's ceiling)
  let sv = 0,
    sl = 0;
  for (let i = 0; i < out.length; i++) {
    sv += v[i]!;
    sl += out[i]!;
  }
  const g = sl > 0 ? sv / sl : 1;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(out[i]! * g, top);
  return out;
}

/** a light L (VIIRS's scale, a lamp's far above 1) as the fine levels' alpha: 0.07 + 0.93 · log2(1 + L / L_MIN) / LOG_SPAN
 *  (0: none) — trace.wgsl tileLightsAt reads it back (roadLightFromByte the same) */
export function roadLightByte(L: number): number {
  if (L <= 0) return 0;
  return Math.max(1, Math.round(255 * (0.07 + 0.93 * Math.min(Math.log2(1 + L / L_MIN) / LOG_SPAN, 1))));
}
/** the alpha back to its light L (the shader's reading) */
export function roadLightFromByte(b: number): number {
  if (b <= 0) return 0;
  const t = Math.max(b / 255 - 0.07, 0) / 0.93;
  return L_MIN * (2 ** (t * LOG_SPAN) - 1);
}
