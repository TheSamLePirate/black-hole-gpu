// The USA's sources' light half (RECHERCHE-DONNEES lot D): what both the tiles (earth-tiles.ts USA) and the scenery's worker
// read — the contiguous states' outline, Mapterhorn's and the National Map's URLs — and the scenery's ground over the USA:
// Mapterhorn's tiles (USGS 3DEP) under its trees and buildings, as swisstopo's over Switzerland (national.ts SwissGround), so
// that their feet stand on the tracer's own ground — not on Terrarium's 10–30 m.

/** Mapterhorn's finest level over the USA (its 512² tiles: our z 17) */
export const MAPTERHORN_Z1 = 16;
export const mapterhornUrl = (z: number, x: number, y: number) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`;
export const usgsImageryUrl = (z: number, x: number, y: number) =>
  `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`;

/** the contiguous states' outline (lon, lat pairs; coarse, its coasts a little out to sea) */
export const USA_OUTLINE = [
  -124.8, 48.5, -123.3, 49.0, -95.15, 49.0, -94.8, 49.4, -89.6, 48.0, -84.8, 46.5, -82.4, 45.3, -82.5, 42.6, -83.1, 42.0, -78.9, 42.9,
  -79.0, 43.3, -76.3, 44.2, -74.7, 45.0, -71.5, 45.0, -70.0, 46.7, -69.2, 47.45, -67.8, 47.1, -67.0, 45.0, -66.6, 44.6, -69.8, 41.2, -75.3,
  35.0, -80.3, 31.8, -79.9, 25.1, -81.8, 24.3, -83.2, 25.3, -82.9, 29.1, -89.2, 28.8, -94.0, 29.2, -97.2, 25.8, -99.2, 26.5, -101.4, 29.8,
  -104.0, 29.3, -104.4, 29.56, -105.0, 30.6, -105.6, 31.1, -106.2, 31.47, -106.5, 31.78, -108.2, 31.33, -111.1, 31.33, -114.8, 32.5, -117.2,
  32.5, -120.6, 34.3, -124.5, 40.3, -124.8, 48.5,
];

const D = Math.PI / 180;
/** whether a place [°] is in the contiguous states (their outline) */
export function inUsa(lat: number, lon: number): boolean {
  let inside = false;
  const r = USA_OUTLINE;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const x1 = r[i]!,
      y1 = r[i + 1]!,
      x2 = r[j]!,
      y2 = r[j + 1]!;
    if (y1 > lat !== y2 > lat && lon < x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}

/** the scenery's ground's level: Mapterhorn's z 14 (512²: ~4.7 m a pixel at 40° N, a tile 2.4 km) */
export const USA_GROUND_Z = 14;
const tileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat: number, z: number) => ((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * 2 ** z;

/** a 512² Terrarium WebP's heights (row 0 the north) */
export async function terrarium512(bytes: ArrayBuffer): Promise<{ side: number; h: Float32Array }> {
  const img = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const side = img.width;
  const cv = new OffscreenCanvas(side, side);
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  img.close();
  const px = ctx.getImageData(0, 0, side, side).data;
  const h = new Float32Array(side * side);
  for (let i = 0; i < h.length; i++) h[i] = px[4 * i]! * 256 + px[4 * i + 1]! + px[4 * i + 2]! / 256 - 32768;
  return { side, h };
}

/** the scenery's ground over the USA (scenery-worker.ts: as SwissGround) — the tiles of USA_GROUND_Z within `reach` metres */
export class MapterhornGround {
  private grids = new Map<string, { side: number; h: Float32Array } | null>();
  requests = 0;
  errors: string[] = [];
  constructor(private fetchBytes: (url: string) => Promise<ArrayBuffer>) {}
  async prepare(lat: number, lon: number, reach: number) {
    const z = USA_GROUND_Z;
    const dLat = reach / 111_195,
      dLon = reach / (111_195 * Math.cos(lat * D));
    const x0 = Math.floor(tileX(lon - dLon, z)),
      x1 = Math.floor(tileX(lon + dLon, z)),
      y0 = Math.floor(tileY(lat + dLat, z)),
      y1 = Math.floor(tileY(lat - dLat, z));
    const tiles: [number, number][] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push([x, y]);
    let next = 0;
    const run = async () => {
      while (next < tiles.length) {
        const [x, y] = tiles[next++]!;
        let g: { side: number; h: Float32Array } | null = null;
        for (let attempt = 0; attempt < 3 && !g; attempt++)
          try {
            this.requests++;
            g = await terrarium512(await this.fetchBytes(mapterhornUrl(z, x, y)));
          } catch (e) {
            if (attempt === 2 && this.errors.length < 4) this.errors.push(String(e).slice(0, 220));
            else await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
          }
        this.grids.set(`${x}/${y}`, g);
      }
    };
    await Promise.all(Array.from({ length: 4 }, run));
  }
  /** the ground at a place [m above the sea] (bilinear; NaN where none) */
  ground(lat: number, lon: number): number {
    const z = USA_GROUND_Z;
    const fx = tileX(lon, z),
      fy = tileY(lat, z);
    const x = Math.floor(fx),
      y = Math.floor(fy);
    const g = this.grids.get(`${x}/${y}`);
    if (!g) return Number.NaN;
    const n = g.side,
      u = (fx - x) * n - 0.5,
      v = (fy - y) * n - 0.5;
    const i = Math.max(0, Math.min(n - 2, Math.floor(u))),
      j = Math.max(0, Math.min(n - 2, Math.floor(v)));
    const tx = Math.max(0, Math.min(1, u - i)),
      ty = Math.max(0, Math.min(1, v - j));
    const at = (a: number, c: number) => g.h[(j + c) * n + i + a]!;
    const h = (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - ty) + (at(0, 1) * (1 - tx) + at(1, 1) * tx) * ty;
    return h < -500 || h > 9000 ? Number.NaN : h;
  }
}
