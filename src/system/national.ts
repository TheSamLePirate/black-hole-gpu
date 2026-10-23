// National sources (docs/ANALYSE-IGN-LIDAR.md I7): a country's own surveys over its land — orthophotos finer than the
// satellite's imagery, a terrain model finer than the radar's — behind one interface, the tiles taking theirs where their
// centre is that country's: the IGN over France (I1, I2: earth-tiles.ts builds it), swisstopo over Switzerland and
// Liechtenstein (here). A source: its box and its land, its orthophotos' URL and their colours' fit to the rest of the Earth,
// the first level its heights take, a Web Mercator tile's heights above the sea (NaN where it has none), its credit. The more
// specific first: a tile in Switzerland is swisstopo's though the IGN's box holds it too.

import { LIECHTENSTEIN, SWITZERLAND } from "./national-borders";
import { decodeQuantizedMesh, drawMeshesSliced, geodeticTileBox, geodeticTilesOver, type QuantizedMesh } from "./quantized-mesh";

const TILE = 256;
const D = Math.PI / 180;

/** an orthophoto's colours into the game's (earth-tiles.ts orthoColour): L′ = tone₀ · L^tone₁, the channels' gains */
export interface OrthoFit {
  tone: readonly [number, number];
  chroma: readonly [number, number, number];
}
export interface NationalSource {
  id: "ign" | "swisstopo";
  box: { west: number; east: number; south: number; north: number };
  /** whether a place [°] is its land */
  holds(lat: number, lon: number): boolean;
  orthoUrl(z: number, x: number, y: number): string;
  fit: OrthoFit;
  /** the first level its heights take (coarser: the global data's) */
  heightsFrom: number;
  /** a tile's heights above the sea [m] (TILE², row 0 the north; NaN where it has none), with the far levels' overground
   *  where it has a surface model (I6) and `hlod`; null: none at all, or refused */
  heights(
    z: number,
    x: number,
    y: number,
    signal: AbortSignal,
    hlod: boolean,
  ): Promise<{ h: Float32Array; over: Float32Array | null } | null>;
  /** every URL `heights` may fetch for a tile, its fallbacks included (the offline zones' — zones.ts) */
  heightUrls(z: number, x: number, y: number, hlod: boolean): string[];
}

/** a point in an outline (longitude, latitude pairs) — even–odd */
export function insideOutline(lat: number, lon: number, ring: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const x1 = ring[i]!,
      y1 = ring[i + 1]!,
      x2 = ring[j]!,
      y2 = ring[j + 1]!;
    if (y1 > lat !== y2 > lat && lon < x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}
const inBox = (b: NationalSource["box"], lat: number, lon: number) => lon > b.west && lon < b.east && lat > b.south && lat < b.north;

/** the source whose land a place is, the more specific first; null: none */
export function sourceAt(sources: readonly NationalSource[], lat: number, lon: number): NationalSource | null {
  for (const s of sources) if (inBox(s.box, lat, lon) && s.holds(lat, lon)) return s;
  return null;
}
/** a Web Mercator tile's source (of a level of n a side): its centre's */
export function tileSource(sources: readonly NationalSource[], n: number, x: number, y: number): NationalSource | null {
  const xw = ((x % n) + n) % n;
  const lon = ((xw + 0.5) / n) * 360 - 180,
    lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) / D;
  return sourceAt(sources, lat, lon);
}
/** the sources' boxes as one (the tracer's: where the relief's levels' imagery is a photograph — earth-tiles.ts orthoParams) */
export function sourcesBox(sources: readonly NationalSource[]): NationalSource["box"] {
  return {
    west: Math.min(...sources.map((s) => s.box.west)),
    east: Math.max(...sources.map((s) => s.box.east)),
    south: Math.min(...sources.map((s) => s.box.south)),
    north: Math.max(...sources.map((s) => s.box.north)),
  };
}

// ---- swisstopo: SWISSIMAGE (10–25 cm) through its WMTS in Web Mercator; swissALTI3D (0.5 m, its heights above the sea,
// LHN95) through the terrain service's quantized meshes (EPSG:4326, TMS) — geo.admin.ch, CORS open, free geodata (OGD)
/** SWISSIMAGE against EOX's colours as the game has them, fitted on twelve places' z 14 tiles (the Seeland's fields, the
 *  Jura's forests, the Jungfrau's rock and ice, Lavaux's vines, Zürich, the Léman's shore, the Emmental, the Valais, the
 *  Engadin, the Ticino, Thurgau's orchards, the Gruyère): the IGN's method (earth-tiles.ts ORTHO_FIT), near its values */
export const SWISS_FIT: OrthoFit = { tone: [0.8672, 1.4726], chroma: [0.7599, 1.1007, 0.3565] };
export const swissimageUrl = (z: number, x: number, y: number) =>
  `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/${z}/${x}/${y}.jpeg`;
export const swissTerrainUrl = (g: number, x: number, y: number) =>
  `https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/20250101/${g}/${x}/${y}.terrain?v=1.43646.0`;
/** the terrain's finest level (its meshes' spacing ~1.9 m in the Alps at 16, 0.7 m at 18) */
export const SWISS_TERRAIN_G1 = 17;
/** a Web Mercator tile's terrain level: one coarser — the geodetic tiles twice its width, one or two of them under it; their
 *  meshes' spacing about twice its texel (a mountain's tile 0.6 MB so, four times that a level finer) */
export const swissTerrainLevel = (z: number) => Math.min(z - 1, SWISS_TERRAIN_G1);

/** the meshes decoded, the last few kept (a level's neighbouring tiles share them) */
const meshes = new Map<string, Promise<QuantizedMesh | null>>();
const MESHES_KEPT = 48;
function swissMesh(g: number, x: number, y: number, signal: AbortSignal): Promise<QuantizedMesh | null> {
  const key = `${g}/${x}/${y}`;
  let p = meshes.get(key);
  if (p) {
    meshes.delete(key);
    meshes.set(key, p);
    return p;
  }
  p = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(swissTerrainUrl(g, x, y), { signal });
        if (r.status === 404) return null;
        if (r.ok) return decodeQuantizedMesh(await r.arrayBuffer(), geodeticTileBox(g, x, y));
      } catch (e) {
        if (signal.aborted) throw e;
      }
      await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
    }
    return null;
  })();
  // (a failure not kept: asked again next time)
  p.then(
    (m) => void (m || meshes.delete(key)),
    () => meshes.delete(key),
  );
  meshes.set(key, p);
  while (meshes.size > MESHES_KEPT) meshes.delete(meshes.keys().next().value!);
  return p;
}

export const SWISSTOPO: NationalSource = {
  id: "swisstopo",
  box: { west: 5.95, east: 10.5, south: 45.81, north: 47.82 },
  holds: (lat, lon) => insideOutline(lat, lon, SWITZERLAND) || insideOutline(lat, lon, LIECHTENSTEIN),
  orthoUrl: swissimageUrl,
  fit: SWISS_FIT,
  heightsFrom: 11,
  heightUrls(z, x, y) {
    const n = 2 ** z;
    const lat = (t: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) / D;
    const g = swissTerrainLevel(z);
    return geodeticTilesOver(g, (x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)).map(([gx, gy]) =>
      swissTerrainUrl(g, gx, gy),
    );
  },
  async heights(z, x, y, signal) {
    const n = 2 ** z;
    const lat = (t: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) / D;
    const west = (x / n) * 360 - 180,
      east = ((x + 1) / n) * 360 - 180,
      north = lat(y),
      south = lat(y + 1);
    const g = swissTerrainLevel(z);
    const tiles = geodeticTilesOver(g, west, south, east, north);
    const got = await Promise.all(tiles.map(([gx, gy]) => swissMesh(g, gx, gy, signal)));
    const ms = got.filter((m): m is QuantizedMesh => !!m);
    if (!ms.length) return null;
    // (a vertex's cell: its longitude across, its Mercator y down)
    const cell = (lon: number, la: number): [number, number] => [
      ((lon - west) / (east - west)) * TILE,
      (((1 - Math.asinh(Math.tan(la * D)) / Math.PI) / 2) * n - y) * TILE,
    ];
    return { h: await drawMeshesSliced(ms, TILE, cell), over: null };
  },
};

/** the scenery's ground over Switzerland (scenery-worker.ts: its trees' and buildings' feet on the tracer's ground — I7): the
 *  terrain's meshes of SWISS_GROUND_G (~14 m between vertices in the Alps, a mesh 2.4 × 1.7 km) over the scene's box, each
 *  drawn into a grid of GROUND_CELLS² over its own box, read bilinear */
export const SWISS_GROUND_G = 13;
const GROUND_CELLS = 256;
export class SwissGround {
  private grids = new Map<string, { box: [number, number, number, number]; v: Float32Array } | null>();
  requests = 0;
  errors: string[] = [];
  constructor(private fetchBytes: (url: string) => Promise<ArrayBuffer>) {}
  /** the meshes within `reach` metres of a place [°] */
  async prepare(lat: number, lon: number, reach: number) {
    const dLat = reach / 111_195,
      dLon = reach / (111_195 * Math.cos(lat * D));
    const tiles = geodeticTilesOver(SWISS_GROUND_G, lon - dLon, lat - dLat, lon + dLon, lat + dLat);
    let next = 0;
    const run = async () => {
      while (next < tiles.length) {
        const [x, y] = tiles[next++]!;
        const box = geodeticTileBox(SWISS_GROUND_G, x, y);
        let grid: Float32Array | null = null;
        for (let attempt = 0; attempt < 3 && !grid; attempt++)
          try {
            this.requests++;
            const m = decodeQuantizedMesh(await this.fetchBytes(swissTerrainUrl(SWISS_GROUND_G, x, y)), box);
            grid = await drawMeshesSliced([m], GROUND_CELLS, (lo, la) => [
              ((lo - box[0]) / (box[2] - box[0])) * GROUND_CELLS,
              ((box[3] - la) / (box[3] - box[1])) * GROUND_CELLS,
            ]);
          } catch (e) {
            if (attempt === 2 && this.errors.length < 4) this.errors.push(String(e).slice(0, 220));
            else await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
          }
        this.grids.set(`${x}/${y}`, grid && { box, v: grid });
      }
    };
    await Promise.all(Array.from({ length: 4 }, run));
  }
  /** the ground at a place [m above the sea] (bilinear; NaN where none) */
  ground(lat: number, lon: number): number {
    const s = 180 / 2 ** SWISS_GROUND_G;
    const g = this.grids.get(`${Math.floor((lon + 180) / s)}/${Math.floor((lat + 90) / s)}`);
    if (!g) return Number.NaN;
    const n = GROUND_CELLS,
      u = ((lon - g.box[0]) / (g.box[2] - g.box[0])) * n - 0.5,
      v = ((g.box[3] - lat) / (g.box[3] - g.box[1])) * n - 0.5;
    const i = Math.max(0, Math.min(n - 2, Math.floor(u))),
      j = Math.max(0, Math.min(n - 2, Math.floor(v)));
    const fx = Math.max(0, Math.min(1, u - i)),
      fy = Math.max(0, Math.min(1, v - j));
    const at = (a: number, c: number) => g.v[(j + c) * n + i + a]!;
    return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
  }
}
