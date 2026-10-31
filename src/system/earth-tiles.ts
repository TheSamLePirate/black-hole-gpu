// The Earth's real ground near the camera: elevation tiles streamed in around it — Mapzen's "Terrarium"
// tiles on AWS's open data (SRTM's 30 m and finer national surveys on land, GMTED, ETOPO1; Web Mercator,
// 256² PNGs, height = R·256 + G + B/256 − 32 768 m) — in nested levels, z 6 to 14 (2.4 km down to 9.6 m a
// texel at the equator: the USGS's 3DEP at 10 m in the United States — Monument Valley's walls —, SRTM's 30 m
// upsampled elsewhere), each a window of 4 × 4 tiles kept round the camera.
//
// Every level brings its imagery too: up to z 8 (611 m) from NASA's GIBS (Global Imagery Browse Services;
// public domain, CORS open) — the Blue Marble Next Generation by day, VIIRS's city lights by night —, finer
// (z 9 … 14, down to 10 m) from EOX's Sentinel-2 cloudless 2021 (10 m, CC BY-NC-SA 4.0, CORS open), its
// colours brought into the Blue Marble's (eoxColour: a power law per channel fitted on nine places), its
// nights the z 8 lights' parent tile, enlarged — the same Web Mercator tiles throughout.
//
// A level's window lives in one layer of a 1024² rg32uint array — its heights' float bits, its imagery
// (rgba8: the day's colour in sRGB, the night's lights; 0: none) —, its tiles at their coordinates modulo
// 4 (a toroidal clipmap): the window follows the camera tile by tile, the tiles it leaves overwritten by
// the ones it enters. A level is drawn only where all its tiles are in (its "valid" rectangle): while it
// moves, the part it keeps; once the new tiles are loaded, all of it. Beyond the windows, and while they
// load, the tracer falls back on the global maps (earth-maps.ts: ETOPO 2022, 4.9 km; the day 2.4 km). The
// same heights on the CPU (heightAt): the ground the ship stands on.
//
// Over France, finer still, imagery alone (docs/ANALYSE-IGN-LIDAR.md I1): the IGN's orthophotos (BD ORTHO through the
// Géoplateforme's WMTS — Licence Ouverte 2.0, CORS open, no usage limit), z 15 … 18 (0.8 m down to 0.2 m a texel at
// 48°), each a window of 4 × 4 tiles round the camera, in quadrants of the same texture's extra layers (their imagery
// channel; the tracer's table places them — gpu-tables.ts TABLE_ORTHO, trace.wgsl earthImagery). The relief is
// untouched; a tile the IGN has not (out at sea, abroad: 404) leaves the coarser levels' imagery there. The relief's own
// levels take the IGN's too over France, z 9 … 14 (EOX's 10 m replaced by the survey's 20 cm resampled — sharp out to
// their windows' 6–20 km), EOX's where it has none.

import type { Vec3 } from "../physics";
import { cartToGeodetic, WGS84_A, WGS84_F } from "./ellipsoid";
import { type NationalSource, type OrthoFit, SWISSTOPO, sourceAt, sourcesBox, tileSource } from "./national";

export const TILE = 256;
/** tiles along a level's window (the normal detail's reach; a farther one, EarthTiles.setReach: 8 on the fine levels) */
export const SPAN = 4;
/** the finest levels a farther reach widens (z 11–13: 8 tiles of z 11 span what 4 of z 10 do — the coarser levels' 4
 *  tiles already reach past them; 8 there was four times the tiles loaded for nothing) */
export const FINE_Z = 11;
export const CLIP = TILE * SPAN;
/** By the detail's reach (settings.detailReach): the windows' tiles a side, the tiles kept in memory past them (a
 *  tile 512 KiB: its heights and its imagery), the finest levels whose next ring round the window is loaded ahead. */
export const TILE_REACH = {
  normal: { span: 4, cache: 0, ring: 0 },
  far: { span: 8, cache: 128, ring: 2 },
  veryFar: { span: 8, cache: 256, ring: 3 },
} as const;
export const Z0 = 6;
/** the finest level (z 15 … 17 over France alone: the IGN's relief — I2; the global data's last is z 14) */
export const Z1 = 17;
/** the finest level of the global data (Terrarium; GIBS and EOX's imagery) */
export const ZG1 = 14;
export const LEVELS = Z1 - Z0 + 1;
/** the floats the tracer's params take: 1 + 2 per level vec4s */
export const TILE_PARAM_VEC4S = 1 + 2 * LEVELS;
/** The data's own resolution [m] (SRTM's 1″): no finer, whatever the level's texel. */
export const TILE_RES_MIN = 25;
/** a survey's own resolution [m] (the IGN's RGE ALTI, 1 m; its LiDAR HD 0.5 m — the texels are coarser anyway) */
export const TILE_RES_FINE = 1;
/** the finest level with imagery (EOX's Sentinel-2 cloudless, 10 m: every level) */
export const IMG_Z1 = ZG1;
/** the finest level from GIBS (the Blue Marble's 500 m, VIIRS's lights): EOX's beyond */
export const GIBS_Z1 = 8;

const R = WGS84_A;
const TAU = 2 * Math.PI;
const MAX_INFLIGHT = 8;
const TIMEOUT_MS = 15000;

export const tileUrl = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
export const dayUrl = (z: number, x: number, y: number) =>
  `${GIBS}/BlueMarble_NextGeneration/default/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`;
export const nightUrl = (z: number, x: number, y: number) =>
  `${GIBS}/VIIRS_Night_Lights/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;
// (licence: s2cloudless 2021 is CC BY-NC-SA 4.0 — non-commercial use only, derivatives under the same licence;
// credited in the panel, the Atlas and the setting's help. The plan allows NC sources; a commercial release needs
// another layer — EOX's 2016 mosaic is CC BY 4.0, not checked here, and EOX_FIT would have to be fitted again:
// docs/systemes/03-univers-ephemerides.md)
export const eoxUrl = (z: number, x: number, y: number) =>
  `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/${z}/${y}/${x}.jpg`;

/** the orthophotos' levels (IGN, France): imagery alone, finer than the relief's tiles */
export const ORTHO_Z0 = 15;
export const ORTHO_Z1 = 18;
export const ORTHO_LEVELS = ORTHO_Z1 - ORTHO_Z0 + 1;
/** their windows' tiles a side (always 4: 3.4 km at z 15 down to 425 m at z 18, at 48°) and its texels */
export const ORTHO_SPAN = 4;
const ORTHO_CLIP = TILE * ORTHO_SPAN;
/** the tracer's table for them (gpu-tables.ts TABLE_ORTHO): three vec4s a level, then the IGN's box [rad] and on */
export const ORTHO_PARAM_VEC4S = 3 * ORTHO_LEVELS + 2;
/** their loads at once (the Géoplateforme answers in 0.35–0.8 s), beside the relief's */
const ORTHO_INFLIGHT = 8;
/** where the IGN has them [°]: metropolitan France and Corsica (outside, a tile answers 404) */
export const ORTHO_BOX = { west: -5.6, east: 9.8, south: 41.2, north: 51.2 } as const;
export const orthoUrl = (z: number, x: number, y: number) =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/jpeg`;
/** the IGN's relief over France (I2): from this level on the heights are its own — RGE ALTI (1 m, the whole country),
 *  the LiDAR HD's terrain model from IGN_LIDAR_Z (0.5 m, where flown), through the Géoplateforme's WMS-R in Web
 *  Mercator: one request a tile, its 256² float32 heights above the sea (the IGN's normal heights) */
export const IGN_HZ0 = 11;
export const IGN_LIDAR_Z = 16;
export const ignHeightUrl = (layer: string, z: number, x: number, y: number, size = 256) => {
  const C = Math.PI * R,
    s = (2 * C) / 2 ** z;
  const box = [x * s - C, C - (y + 1) * s, (x + 1) * s - C, C - y * s].join(",");
  return `https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&CRS=EPSG:3857&BBOX=${box}&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/x-bil;bits=32`;
};
export const IGN_RGEALTI = "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES";
/**
 * Requests spaced to a rate: the Géoplateforme's WMS-R takes 40 a second from an address and refuses the rest at once —
 * a 400, "LayerNotDefined" (measured: none at 8 a second, 82 % at 75) —, so each of its users here holds a share of it:
 * the relief's tiles 20 a second (ignGate), the scenery worker's survey 12 (ign-canopy.ts).
 */
export class RateGate {
  private next = 0;
  constructor(private perSecond: number) {}
  /** resolves when the next request may go */
  take(): Promise<void> {
    const now = performance.now(),
      at = Math.max(now, this.next);
    this.next = at + 1000 / this.perSecond;
    return at > now ? new Promise((done) => setTimeout(done, at - now)) : Promise.resolve();
  }
}
const ignGate = new RateGate(20);
export const IGN_LIDAR = "IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G";
/** A height's source, in its float's last bit (the tracer's tiles the same: trace.wgsl tileFine): 1 a survey's (the IGN's —
 *  its resolution its texel's), 0 the global data's (Terrarium: SRTM's 25–30 m under its texel — whose k/256 values never
 *  set that bit). The mark moves a height by one ulp: a tenth of a millimetre at 1 000 m. */
const BITS = new Float32Array(1),
  BITS_U = new Uint32Array(BITS.buffer);
export function markFine(h: Float32Array, fine: boolean) {
  const u = new Uint32Array(h.buffer, h.byteOffset, h.length);
  for (let i = 0; i < u.length; i++) u[i] = fine ? u[i]! | 1 : u[i]! & ~1;
}
export const isFine = (h: number) => ((BITS[0] = h), (BITS_U[0]! & 1) === 1);

/** the extra layers the orthophotos take in a texture of a side (a 1024² quadrant each, as many a layer as fit) */
export const orthoLayers = (clip: number) => Math.ceil(ORTHO_LEVELS / (clip / ORTHO_CLIP) ** 2);

/**
 * The orthophotos' colours (an aerial survey's, graded bright: 2.7 times the ground's on average) into the Blue
 * Marble's, which the tracer's ground and the coarser levels have — a tone curve on the luminance L′ = a·L^b and the
 * colours' gains, fitted on twelve places' z 14 tiles against EOX's own brought there (fields, forests, vineyards,
 * marshes, towns, the Alps; their distributions matched — the surveys' dates and seasons differ, no pixel's twin):
 * means within 4 %, a white kept white. The gains fade out over the bright ground (snow, roofs, roads), as EOX's
 * fit; sRGB 8-bit in and out.
 */
export const ORTHO_FIT = { tone: [0.8112, 1.4753], chroma: [0.8232, 1.0999, 0.3872] } as const;
export function orthoColour(r: number, g: number, b: number, fit: OrthoFit = ORTHO_FIT): [number, number, number] {
  const e = [LIN[r]!, LIN[g]!, LIN[b]!];
  const L = 0.2126 * e[0]! + 0.7152 * e[1]! + 0.0722 * e[2]!;
  if (L <= 0) return [0, 0, 0];
  const Lo = fit.tone[0] * L ** fit.tone[1];
  const x = Math.min(1, Math.max(0, (Lo - 0.06) / 0.29)),
    t = x * x * (3 - 2 * x);
  const out = (c: number) => TO_SRGB[Math.round(4095 * Math.min(1, ((e[c]! * Lo) / L) * (fit.chroma[c]! * (1 - t) + t)))]!;
  return [out(0), out(1), out(2)];
}

/**
 * EOX's colours (a mosaic graded for the eye: hazier, bluer) into the Blue Marble's, whose colours the
 * tracer's ground and the coarser levels have — per channel in linear light, b = g · e^k, fitted on nine
 * places' z 8 tiles (forests, farmland, desert, tundra, cities: R² 0.96, 0.94, 0.86), where it was measured:
 * the darker ground. Bright ground (snow, sand, rock, towns) is left as it is — the fit's extrapolation would
 * tint it cyan —, the two blended by the pixel's luminance (no hue moved by a channel's own weight).
 * sRGB 8-bit in, out.
 */
export const EOX_FIT = { gain: [0.894, 1.548, 3.877], power: [0.959, 1.205, 1.487] } as const;
const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const LIN = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
const FIT = [0, 1, 2].map((c) => Float32Array.from(LIN, (v) => Math.min(1, EOX_FIT.gain[c]! * v ** EOX_FIT.power[c]!)));
const TO_SRGB = Uint8Array.from({ length: 4096 }, (_, i) => Math.round(255 * linearToSrgb(i / 4095)));
export function eoxColour(r: number, g: number, b: number): [number, number, number] {
  const e = [LIN[r]!, LIN[g]!, LIN[b]!];
  const lum = 0.2126 * e[0]! + 0.7152 * e[1]! + 0.0722 * e[2]!;
  const x = Math.min(1, Math.max(0, (lum - 0.06) / 0.29)),
    t = x * x * (3 - 2 * x);
  const out = (c: number, v: number) => TO_SRGB[Math.round(4095 * Math.min(1, FIT[c]![v]! * (1 - t) + e[c]! * t))]!;
  return [out(0, r), out(1, g), out(2, b)];
}

/** Mercator's y [tiles, 0 at the north edge] of a latitude's sine, at a level of n tiles. */
const mercY = (sinLat: number, n: number) => (0.5 - Math.atanh(Math.min(Math.max(sinLat, -0.999999), 0.999999)) / TAU) * n;

/** tiles [x0, x1) × [y0, y1), x unwrapped (the date line: x0 < 0 or x1 > n) */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const same = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1);
const inside = (r: Rect | null, x: number, y: number) => !!r && x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
function intersect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || !b) return null;
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x0 < r.x1 && r.y0 < r.y1 ? r : null;
}

interface Level {
  z: number;
  n: number;
  /** its window's tiles a side (SPAN, or the reach's on the fine levels) */
  span: number;
  want: Rect | null;
  valid: Rect | null;
  /** the tile in each slot (x mod span, y mod span) and its heights */
  key: (string | null)[];
  data: (Float32Array | null)[];
  /** its imagery, held on the finest levels only (the ring's: kept past the window when it leaves it) */
  col: (Uint32Array | null)[];
  /** its tiles drawn from the sources before a switch, taken again — drawn until each is in from the new one */
  stale: boolean;
}

/** An orthophotos' level: its window (4 × 4 tiles), the tile in each slot (none: not in yet) — imagery alone. */
interface OrthoLevel {
  z: number;
  n: number;
  want: Rect | null;
  valid: Rect | null;
  key: (string | null)[];
}

/** A tile's pixels (rgba, row by row), as they are in its file — or a square of it (x, y, side [px]) enlarged. */
export async function pixels(blob: Blob, crop?: [number, number, number]): Promise<Uint8ClampedArray> {
  const o = { colorSpaceConversion: "none", premultiplyAlpha: "none" } as const;
  const img = crop
    ? await createImageBitmap(blob, crop[0], crop[1], crop[2], crop[2], {
        ...o,
        resizeWidth: TILE,
        resizeHeight: TILE,
        resizeQuality: "medium",
      })
    : await createImageBitmap(blob, o);
  const cv = new OffscreenCanvas(TILE, TILE);
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  img.close();
  return ctx.getImageData(0, 0, TILE, TILE).data;
}

/** Terrarium's heights for a tile — beyond its z 15, its z 15 parent's square enlarged (bilinear) —, unmarked. */
async function terrarium(z: number, x: number, y: number, signal: AbortSignal): Promise<Float32Array> {
  const k = Math.max(z - 15, 0);
  const res = await fetch(tileUrl(z - k, x >> k, y >> k), { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const h = await res.blob().then(decode);
  markFine(h, false);
  if (!k) return h;
  const side = TILE >> k,
    ox = (x - ((x >> k) << k)) * side,
    oy = (y - ((y >> k) << k)) * side;
  const out = new Float32Array(TILE * TILE);
  for (let j = 0; j < TILE; j++)
    for (let i = 0; i < TILE; i++) {
      const fx = Math.min(Math.max(ox + ((i + 0.5) * side) / TILE - 0.5, 0), TILE - 1),
        fy = Math.min(Math.max(oy + ((j + 0.5) * side) / TILE - 0.5, 0), TILE - 1);
      const x0 = Math.min(Math.floor(fx), TILE - 2),
        y0 = Math.min(Math.floor(fy), TILE - 2);
      const tx = fx - x0,
        ty = fy - y0;
      const a = h[y0 * TILE + x0]! + (h[y0 * TILE + x0 + 1]! - h[y0 * TILE + x0]!) * tx;
      const b = h[(y0 + 1) * TILE + x0]! + (h[(y0 + 1) * TILE + x0 + 1]! - h[(y0 + 1) * TILE + x0]!) * tx;
      out[j * TILE + i] = a + (b - a) * ty;
    }
  markFine(out, false);
  return out;
}

/** One of the IGN's height grids for a tile (null: refused, or none there at all); its no-data — out at sea, abroad,
 *  a gap in a survey — NaN. */
async function ignGrid(layer: string, z: number, x: number, y: number, signal: AbortSignal, size = TILE): Promise<Float32Array | null> {
  // (within the relief's share of the rate, asked again on a refusal — over the rate, or a 502 now and then —, a second, two,
  // four after: a tile left to Terrarium for it would show a seam)
  await ignGate.take();
  let res = await fetch(ignHeightUrl(layer, z, x, y, size), { signal });
  const refused = (r: Response) => r.status === 400 || r.status === 429 || r.status >= 500;
  for (let attempt = 1; refused(res) && attempt < 4; attempt++) {
    await new Promise((done) => setTimeout(done, 1000 * 2 ** (attempt - 1)));
    await ignGate.take();
    res = await fetch(ignHeightUrl(layer, z, x, y, size), { signal });
  }
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== size * size * 4) return null;
  const v = new Float32Array(buf);
  let any = false;
  for (let i = 0; i < v.length; i++) {
    const h = v[i]!;
    // (its no-data, and the values it resamples into it along a coast — hundreds of metres under the sea —: France's land
    // is nowhere 10 m under it)
    if (!Number.isFinite(h) || h < -100 || h > 9000) v[i] = Number.NaN;
    else any = true;
  }
  return any ? v : null;
}

/** the far levels' overground over France (I6): up to this level, the ground the IGN's surface — its buildings and its
 *  trees' tops —, beyond the scenery's reach (its z 14 window and finer keep the bare ground, under its own buildings and trees) */
export const HLOD_Z1 = 13;
/** the surface models: the LiDAR HD's (0.5 m — a tower's lattice in it), RGE ALTI's (photogrammetry) in its holes */
export const IGN_MNS_LIDAR = "IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G";
export const IGN_MNS_RGE = "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.MNS";
/** an overground under this [m]: the two surveys' own noise, a crop, a wall — the ground left bare */
export const HLOD_MIN = 2;
/** the surface's side asked for a tile: twice the texel's below z 13, its top kept — the WMS-R averages its samples (Tour
 *  Montparnasse, 264 m: 156 m at z 11's 50 m, 262 m from 4 × 4 samples' top) */
export const hlodSize = (z: number) => (z < HLOD_Z1 ? 2 * TILE : TILE);
/**
 * The overground over a tile's ground (TILE², 0 where none): the surface's samples (n² over the tile, n = k TILE) less the
 * ground there (`ground`'s TILE² bilinear at each sample — never the surface's own top over a slope), the top of each k × k
 * block, kept where it passes HLOD_MIN. A ground or a surface NaN there: none.
 */
export function overground(ground: Float32Array, surface: Float32Array, n: number): Float32Array {
  const k = n / TILE,
    top = new Float32Array(TILE * TILE).fill(Number.NEGATIVE_INFINITY);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const s = surface[j * n + i]!;
      if (Number.isNaN(s)) continue;
      // (the ground at the sample's centre: ground texels' centres at (t + 0.5) / TILE)
      const fx = Math.min(Math.max((i + 0.5) / k - 0.5, 0), TILE - 1),
        fy = Math.min(Math.max((j + 0.5) / k - 0.5, 0), TILE - 1);
      const x0 = Math.min(Math.floor(fx), TILE - 2),
        y0 = Math.min(Math.floor(fy), TILE - 2),
        tx = fx - x0,
        ty = fy - y0;
      const g00 = ground[y0 * TILE + x0]!,
        g10 = ground[y0 * TILE + x0 + 1]!,
        g01 = ground[(y0 + 1) * TILE + x0]!,
        g11 = ground[(y0 + 1) * TILE + x0 + 1]!;
      const g = (g00 * (1 - tx) + g10 * tx) * (1 - ty) + (g01 * (1 - tx) + g11 * tx) * ty;
      if (Number.isNaN(g)) continue;
      const o = Math.floor(j / k) * TILE + Math.floor(i / k);
      if (s - g > top[o]!) top[o] = s - g;
    }
  const over = new Float32Array(TILE * TILE);
  for (let i = 0; i < over.length; i++) if (top[i]! > HLOD_MIN && !Number.isNaN(ground[i]!)) over[i] = top[i]!;
  return over;
}
/** the overground added on the ground, in place (the tests' and the tools' view of the drawn surface) */
export function addOverground(ground: Float32Array, surface: Float32Array, n: number) {
  const over = overground(ground, surface, n);
  for (let i = 0; i < over.length; i++) ground[i] = ground[i]! + over[i]!;
}
/** a tile's heights drawn: its ground, and its overground where it has one — the second half of its array (the CPU's
 *  contacts, the Auto-GCAS's terrain, the heights over the ground read the first alone: the bare ground) */
export const drawnHeight = (h: Float32Array, i: number) => (h.length > TILE * TILE ? h[i]! + h[TILE * TILE + i]! : h[i]!);

/**
 * A tile's ground over France (I2): the LiDAR HD's terrain from IGN_LIDAR_Z on, RGE ALTI under it and where the LiDAR has
 * none (NaN where the IGN has none at all — the sea, the countries round); up to HLOD_Z1 with `hlod`, its overground (I6:
 * overground). The IGN's NationalSource's heights.
 */
async function ignGround(
  z: number,
  x: number,
  y: number,
  signal: AbortSignal,
  hlod: boolean,
): Promise<{ h: Float32Array; over: Float32Array | null } | null> {
  let h = z >= IGN_LIDAR_Z ? await ignGrid(IGN_LIDAR, z, x, y, signal) : null;
  const holes = (v: Float32Array | null) => !v || v.some((e) => Number.isNaN(e));
  if (holes(h)) {
    const r = await ignGrid(IGN_RGEALTI, z, x, y, signal);
    if (!h) h = r;
    else if (r) for (let i = 0; i < h.length; i++) if (Number.isNaN(h[i]!)) h[i] = r[i]!;
  }
  if (!h) return null;
  let over: Float32Array | null = null;
  if (hlod && z <= HLOD_Z1) {
    const n = hlodSize(z);
    let s = await ignGrid(IGN_MNS_LIDAR, z, x, y, signal, n);
    let holes = 0;
    if (s) for (const v of s) if (Number.isNaN(v)) holes++;
    if (!s || holes > 0.02 * s.length) {
      const r = await ignGrid(IGN_MNS_RGE, z, x, y, signal, n);
      if (!s) s = r;
      else if (r) for (let i = 0; i < s.length; i++) if (Number.isNaN(s[i]!)) s[i] = r[i]!;
    }
    if (s) over = overground(h, s, n);
  }
  return { h, over };
}

/** the IGN over France (I1, I2, I6): its box alone its land — it answers nothing beyond (NaN, 404) */
export const IGN: NationalSource = {
  id: "ign",
  box: ORTHO_BOX,
  holds: () => true,
  orthoUrl,
  fit: ORTHO_FIT,
  heightsFrom: IGN_HZ0,
  heights: ignGround,
  heightUrls: (z, x, y, hlod) => [
    ...(z >= IGN_LIDAR_Z ? [ignHeightUrl(IGN_LIDAR, z, x, y)] : []),
    ignHeightUrl(IGN_RGEALTI, z, x, y),
    ...(hlod && z <= HLOD_Z1 ? [ignHeightUrl(IGN_MNS_LIDAR, z, x, y, hlodSize(z)), ignHeightUrl(IGN_MNS_RGE, z, x, y, hlodSize(z))] : []),
  ],
};
/** the national sources, the more specific first (national.ts): swisstopo, then the IGN */
export const NATIONAL: readonly NationalSource[] = [SWISSTOPO, IGN];
/** their boxes as one */
export const NATIONAL_BOX = sourcesBox(NATIONAL);

/**
 * A tile's heights from its national source (I2, I7): its ground marked as a survey's (markFine), the global data's
 * (Terrarium) where it has none; its overground, when it has one, after them — one array (drawnHeight).
 */
async function nationalHeights(
  src: NationalSource,
  z: number,
  x: number,
  y: number,
  signal: AbortSignal,
  hlod = false,
): Promise<Float32Array> {
  const r = await src.heights(z, x, y, signal, hlod);
  if (!r) return terrarium(z, x, y, signal);
  const { h, over } = r;
  markFine(h, true);
  if (h.some((e) => Number.isNaN(e))) {
    const t = await terrarium(z, x, y, signal);
    for (let i = 0; i < h.length; i++) if (Number.isNaN(h[i]!)) h[i] = t[i]!;
  }
  if (!over) return h;
  // (the ground, then its overground: one array through the loads, the memory's cache and the texture's writes)
  const both = new Float32Array(2 * TILE * TILE);
  both.set(h);
  both.set(over, TILE * TILE);
  return both;
}

/** The heights of a tile from its PNG (Terrarium's encoding). */
async function decode(blob: Blob): Promise<Float32Array> {
  const px = await pixels(blob);
  const h = new Float32Array(TILE * TILE);
  for (let i = 0; i < h.length; i++) h[i] = px[4 * i]! * 256 + px[4 * i + 1]! + px[4 * i + 2]! / 256 - 32768;
  return h;
}

export interface TileSample {
  /** the levels' height, weighted [m] */
  h: number;
  /** their resolution, weighted [m] */
  res: number;
  /** the weight left to the global map (0: the tiles alone) */
  rem: number;
}

export class EarthTiles {
  texture: GPUTexture;
  /** the fine levels' windows' tiles a side (TILE_REACH: 4, 8 — FINE_Z), the texture's side in texels its CLIP */
  private span = SPAN;
  /** the most the device holds (a farther reach's 256 MiB texture refused: back to SPAN, not asked again) */
  private spanMax = 8;
  private get clip() {
    return TILE * this.span;
  }
  private levelSpan(z: number) {
    // (the IGN's finest relief, z 15 … 17: windows of 4 tiles whatever the reach — 3.4 km down to 850 m at 46°)
    if (z > ZG1) return SPAN;
    return z >= FINE_Z ? this.span : SPAN;
  }
  /** the tiles kept past the windows — most recently used last — and how many (0: none) */
  private cache = new Map<string, { h: Float32Array; col: Uint32Array | null }>();
  private cacheTiles = 0;
  /** the finest levels whose next ring round the window is loaded ahead into the cache (0: none) */
  private ring = 0;
  /** the texture made again for another window (the bind groups holding it rebuilt: the renderer) */
  onResize: (() => void) | null = null;
  private levels: Level[] = [];
  private inflight = new Map<string, AbortController>();
  private failures = new Map<string, { n: number; at: number }>();
  /** bumped at a switch of the sources: a load begun before it is dropped */
  private gen = 0;
  /** the reference (the camera's place) [rad]: the levels' coordinates measured from it */
  private lon = 0;
  private sinLat = 0;
  /** bumped when what the tracer draws changes (a level's valid rectangle) */
  stamp = 0;
  /** heights of the global map (for a tile that will not load: terrain.ts, tileFallbackSampler) */
  fallback: ((q: Vec3) => number) | null = null;
  onChange: (() => void) | null = null;
  /** bumped when a tile already drawn gets its imagery (its heights unchanged: not the stamp — the ground built
   *  from them stays; the renderer redraws a still view for it, at most once in a while) */
  imagery = 0;
  /** tiles loaded, failed (for the readouts) */
  loaded = 0;
  failed = 0;
  /** the orthophotos (IGN, France — I1): wanted (settings.earthOrtho), their levels, their loads, the tiles they have
   *  not (404: out at sea, abroad — not asked again), loaded */
  orthoOn = true;
  private orthoWas = true;
  /** the IGN's relief over France (I2, settings.earthIgnRelief): its heights on the levels from IGN_HZ0, and the levels
   *  finer than the global data's (z 15 … 17); switched: every tile taken again */
  reliefOn = true;
  private reliefWas = true;
  /** with the relief, its far levels' overground (I6, settings.earthIgnSilhouettes): up to HLOD_Z1 the IGN's surface —
   *  Paris's towers, the forests' tops — on the ground; switched: every tile taken again */
  hlodOn = true;
  private hlodWas = true;
  /** the national source under the camera (I7: "ign", "swisstopo"; null none) — its credit shown while its tiles are */
  nationalAt: NationalSource["id"] | null = null;
  /** the finest levels the offline zones hold with the camera at a place [°] (main.ts: offline only — system/zones.ts
   *  zoneLevelsAt —; null: online, or out of every zone, the automatic cache's chance): none finer asked there, each
   *  request would fail */
  held: ((latDeg: number, lonDeg: number) => { reliefZ1: number; orthoZ1: number } | null) | null = null;
  private ortho: OrthoLevel[] = [];
  private orthoInflight = new Map<string, AbortController>();
  private orthoNone = new Set<string>();
  orthoLoaded = 0;

  constructor(private device: GPUDevice) {
    this.texture = this.makeTexture();
    for (let k = 0; k < ORTHO_LEVELS; k++)
      this.ortho.push({ z: ORTHO_Z0 + k, n: 2 ** (ORTHO_Z0 + k), want: null, valid: null, key: new Array(ORTHO_SPAN ** 2).fill(null) });
    for (let l = 0; l < LEVELS; l++) {
      const z = Z0 + l;
      const n = this.levelSpan(z);
      this.levels.push({
        z,
        n: 2 ** z,
        span: n,
        want: null,
        valid: null,
        key: new Array(n * n).fill(null),
        data: new Array(n * n).fill(null),
        col: new Array(n * n).fill(null),
        stale: false,
      });
    }
  }

  private makeTexture() {
    return this.device.createTexture({
      // (the relief's levels, then the orthophotos' quadrants)
      size: [this.clip, this.clip, LEVELS + orthoLayers(this.clip)],
      format: "rg32uint",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: "earth tiles",
    });
  }

  /**
   * The detail's reach (TILE_REACH): the fine levels' windows' tiles a side — another one, the texture made again (the
   * old one destroyed once the work submitted with it is done) and every level drawn anew, its tiles from the cache or
   * loaded again —, the tiles kept past them, the ring loaded ahead. A texture the device cannot hold (out of memory:
   * an iPad's 256 MiB) falls back to 4 tiles, and stays there.
   */
  setReach(r: { span: number; cache: number; ring: number }) {
    this.cacheTiles = r.cache;
    this.ring = r.ring;
    while (this.cache.size > this.cacheTiles) this.cache.delete(this.cache.keys().next().value!);
    const span = Math.min(r.span, this.spanMax);
    if (span === this.span) return;
    this.clear();
    this.span = span;
    const old = this.texture;
    this.device.pushErrorScope?.("out-of-memory");
    this.texture = this.makeTexture();
    void this.device.popErrorScope?.().then((e) => {
      if (!e || this.span === SPAN) return;
      console.warn(`Terrain tiles: the ${this.clip}² texture refused (${e.message}) — the detail's reach kept at ${SPAN} tiles`);
      this.spanMax = SPAN;
      this.setReach({ span: SPAN, cache: this.cacheTiles, ring: this.ring });
    });
    void this.device.queue.onSubmittedWorkDone().then(() => old.destroy());
    for (const O of this.ortho) {
      O.key.fill(null);
      O.valid = null;
    }
    for (const L of this.levels) {
      L.span = this.levelSpan(L.z);
      L.key = new Array(L.span * L.span).fill(null);
      L.data = new Array(L.span * L.span).fill(null);
      L.col = new Array(L.span * L.span).fill(null);
    }
    this.stamp++;
    this.onResize?.();
  }

  /** a tile's slot in its level's window (x mod span, y mod span) */
  private slotOf(L: Level, x: number, y: number) {
    const n = L.span;
    return (((y % n) + n) % n) * n + (((x % n) + n) % n);
  }

  /** one of the finest levels wanted, whose ring is loaded ahead and kept */
  private ringLevel(L: Level) {
    if (!this.ring || !L.want) return false;
    let finest = Z0;
    for (const M of this.levels) if (M.want) finest = M.z;
    return L.z > finest - this.ring;
  }

  /** a tile kept past the windows (the least recently used dropped past cacheTiles) */
  private keep(key: string, h: Float32Array, col: Uint32Array | null) {
    if (!this.cacheTiles) return;
    const was = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, { h, col: col ?? was?.col ?? null });
    while (this.cache.size > this.cacheTiles) this.cache.delete(this.cache.keys().next().value!);
  }

  /** the tiles kept in memory past the windows (the detail's reach: the left ones, the ring loaded ahead) */
  get kept() {
    return this.cache.size;
  }

  /** the tiles wanted and not yet in */
  get pending() {
    let k = 0;
    for (const L of this.levels) {
      if (!L.want) continue;
      for (let y = L.want.y0; y < L.want.y1; y++)
        for (let x = L.want.x0; x < L.want.x1; x++) if (L.key[this.slotOf(L, x, y)] !== this.keyOf(L, x, y)) k++;
    }
    return k;
  }
  /** the orthophotos' tiles wanted and not yet in */
  get orthoPending() {
    let k = 0;
    for (const O of this.ortho) {
      if (!O.want) continue;
      for (let y = O.want.y0; y < O.want.y1; y++)
        for (let x = O.want.x0; x < O.want.x1; x++) if (O.key[orthoSlot(x, y)] !== this.orthoKey(O, x, y)) k++;
    }
    return k;
  }
  /** the finest orthophotos' level drawn (0: none) */
  get orthoFinest() {
    let z = 0;
    for (const O of this.ortho) if (O.valid) z = O.z;
    return z;
  }
  /** the finest level drawn */
  get finest() {
    let z = 0;
    for (const L of this.levels) if (L.valid) z = L.z;
    return z;
  }

  private keyOf(L: Level, x: number, y: number) {
    return `${L.z}/${((x % L.n) + L.n) % L.n}/${y}`;
  }

  private setValid(L: Level, r: Rect | null) {
    if (same(L.valid, r)) return;
    L.valid = r;
    this.stamp++;
    this.onChange?.();
  }

  /** Drops every level (the Earth far, or the tiles switched off). */
  clear() {
    for (const c of this.inflight.values()) c.abort();
    this.inflight.clear();
    for (const L of this.levels) {
      L.want = null;
      this.setValid(L, null);
    }
    this.clearOrtho();
  }

  private clearOrtho() {
    for (const c of this.orthoInflight.values()) c.abort();
    this.orthoInflight.clear();
    for (const O of this.ortho) {
      O.want = null;
      O.valid = null;
    }
  }

  /**
   * Follows the camera: c, on the Earth's axes [its equatorial radii] (float64); pixAngle, a pixel's angle [rad] —
   * the levels wanted, those finer than the ground's footprint under the camera left as they are.
   */
  private priorityLon = 0;
  private prioritySinLat = 0;
  update(c: Vec3 | null, pixAngle: number, lead: Vec3 = [0, 0, 0], gaze: Vec3 = [0, 0, 0], agl?: number) {
    // (the orthophotos switched: the relief's tiles' imagery taken again — over France the IGN's or EOX's —, the tiles
    // kept past the windows dropped. The tiles drawn stay drawn until each is in again: dropped at once, the ground fell
    // back to the global map's — at Chamonix the valley filled, a jet flying 450 m over its floor hundreds of metres in
    // the ground, flung out by its gear at Mach 40 and burnt)
    if (this.orthoOn !== this.orthoWas || this.reliefOn !== this.reliefWas || this.hlodOn !== this.hlodWas) {
      this.orthoWas = this.orthoOn;
      this.reliefWas = this.reliefOn;
      this.hlodWas = this.hlodOn;
      this.gen++;
      for (const c of this.inflight.values()) c.abort();
      this.inflight.clear();
      this.cache.clear();
      for (const L of this.levels) {
        L.key.fill(null);
        L.stale = !!L.valid;
      }
      this.clearOrtho();
    }
    if (!c) return this.clear();
    // (the camera's geodetic place: the tracer reads the tiles at the geodetic latitude)
    const g = cartToGeodetic(1, WGS84_F, c);
    this.lon = g.lon;
    this.sinLat = Math.sin(g.lat);
    const cosLat = Math.sqrt(Math.max(1 - this.sinLat * this.sinLat, 1e-6));
    const alt = Math.max(g.h * R, 1);
    // (the finest level the nearest ground needs: its texel within the pixel's footprint there)
    const zNeed = Math.min(Math.ceil(Math.log2((TAU * R * cosLat) / (TILE * Math.max(alt * pixAngle, 0.5)))), ZG1);
    if (zNeed < Z0) return this.clear();
    // (finer, the IGN's relief alone — in France, on: by the height over the ground, as the orthophotos —; else none)
    const latD = (g.lat * 180) / Math.PI,
      lonD = (g.lon * 180) / Math.PI,
      B = NATIONAL_BOX;
    const inNational = latD > B.south - 0.1 && latD < B.north + 0.1 && lonD > B.west - 0.1 && lonD < B.east + 0.1;
    // (the source under the camera: its credit on screen — main.ts)
    this.nationalAt = sourceAt(NATIONAL, latD, lonD)?.id ?? null;
    // (offline within a zone, its levels there at most)
    const held = this.held?.(latD, lonD) ?? null;
    const zFine =
      this.reliefOn && inNational
        ? Math.min(Math.ceil(Math.log2((TAU * R * cosLat) / (TILE * Math.max((agl ?? alt) * pixAngle, 0.5)))), Z1, held?.reliefZ1 ?? Z1)
        : ZG1;
    // (each window centred ahead where the view looks — gaze: its offset, Earth-fixed —, by up to a tile and a quarter
    // of its own level: what is seen ahead gets the finest heights and imagery, the ground behind the view less)
    const gc = cartToGeodetic(1, WGS84_F, c.map((v, i) => v + gaze[i]!) as Vec3);
    const gLonT = gc.lon / TAU + 0.5,
      gSinLat = Math.sin(gc.lat);
    for (const L of this.levels) {
      if (L.z > ZG1 && L.z > zFine) {
        if (L.want) {
          L.want = null;
          this.setValid(L, null);
        }
        continue;
      }
      if (L.z <= ZG1 && L.z > zNeed) continue;
      const cx0 = (this.lon / TAU + 0.5) * L.n,
        cy0 = mercY(this.sinLat, L.n);
      const gx = gLonT * L.n - cx0,
        gy = mercY(gSinLat, L.n) - cy0;
      const gl = Math.hypot(gx, gy);
      // (by up to a tile and a quarter of a 4-tile window — half the window less three quarters of a tile)
      const most = L.span / 2 - 0.75;
      const k = gl > most ? most / gl : 1;
      const cx = cx0 + gx * k,
        cy = cy0 + gy * k;
      // (the window recentred once the camera is more than 0.8 of a tile off its middle — or across the
      // date line; at the poles' edges it stays clamped)
      const mid = L.span / 2;
      const x0 = Math.round(cx) - mid;
      const y0 = Math.min(Math.max(Math.round(cy) - mid, 0), L.n - L.span);
      let want = L.want;
      if (!want || Math.abs(cx - (want.x0 + mid)) > 0.8 || (y0 !== want.y0 && Math.abs(cy - (want.y0 + mid)) > 0.8)) {
        want = { x0, y0, x1: x0 + L.span, y1: y0 + L.span };
      }
      if (!same(want, L.want)) {
        L.want = want;
        // (the part kept drawn; the slots the window leaves are about to be overwritten)
        this.setValid(L, intersect(L.valid, want));
        this.complete(L);
      }
    }
    // (the orthophotos by the height over the ground — in the Alps a camera 150 m up is 1 400 m over the ellipsoid)
    this.updateOrtho(agl ?? alt, pixAngle, cosLat, gLonT, gSinLat, held?.orthoZ1 ?? ORTHO_Z1);
    const ahead = cartToGeodetic(1, WGS84_F, c.map((v, i) => v + lead[i]!) as Vec3);
    this.priorityLon = ahead.lon;
    this.prioritySinLat = Math.sin(ahead.lat);
    this.request(cx0(this.priorityLon), this.prioritySinLat);
  }

  /** Starts the loads: the coarse levels first, each from the camera outwards. */
  private request(lonT: number, sinLat: number) {
    const now = performance.now();
    let pending = 0;
    for (const L of this.levels) {
      // (a window drawn whole: nothing to look for — not its tiles' keys made again each frame —, unless taken again)
      if (!L.want || (same(L.valid, L.want) && !L.stale)) continue;
      const cx = lonT * L.n,
        cy = mercY(sinLat, L.n);
      const todo: [number, number, number][] = [];
      for (let y = L.want.y0; y < L.want.y1; y++) {
        for (let x = L.want.x0; x < L.want.x1; x++) {
          const key = this.keyOf(L, x, y);
          if (L.key[this.slotOf(L, x, y)] === key || this.inflight.has(key)) continue;
          // (kept past the window — walked back to, or loaded ahead —: drawn at once)
          const kept = this.cache.get(key);
          if (kept) {
            this.cache.delete(key);
            this.put(L.z, x, y, kept.h, kept.col);
            continue;
          }
          const f = this.failures.get(key);
          if (f && now < f.at) continue;
          todo.push([x, y, (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2]);
        }
      }
      pending += todo.length;
      todo.sort((a, b) => a[2] - b[2]);
      // (the loads limited, not what memory holds: every level's kept tiles drawn at once)
      for (const [x, y] of todo) {
        if (this.inflight.size >= MAX_INFLIGHT) break;
        void this.load(L, x, y);
      }
    }
    this.requestOrtho(lonT, sinLat);
    // (the windows whole: the next ring round the finest levels' loaded ahead into memory — nearest the lead (the
    // motion's, the gaze's) first, in metres —, half the loads at most: the tiles the windows enter as the craft goes
    // on, drawn at once)
    if (pending || !this.ring || this.inflight.size >= MAX_INFLIGHT / 2) return;
    const ahead: [Level, number, number, number][] = [];
    for (const L of this.levels) {
      const w = L.want;
      if (!w || !this.ringLevel(L)) continue;
      const cx = lonT * L.n,
        cy = mercY(sinLat, L.n);
      for (let y = Math.max(w.y0 - 1, 0); y <= Math.min(w.y1, L.n - 1); y++)
        for (let x = w.x0 - 1; x <= w.x1; x++) {
          if (inside(w, x, y)) continue;
          const key = this.keyOf(L, x, y);
          if (this.cache.has(key) || this.inflight.has(key)) continue;
          const f = this.failures.get(key);
          if (f && now < f.at) continue;
          ahead.push([L, x, y, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / L.n]);
        }
    }
    ahead.sort((a, b) => a[3] - b[3]);
    for (const [L, x, y] of ahead) {
      if (this.inflight.size >= MAX_INFLIGHT / 2) return;
      void this.load(L, x, y, true);
    }
  }

  /** A tile loaded — into its window, or (ahead) into memory past it, drawn if its window has come to it meanwhile. */
  private async load(L: Level, x: number, y: number, ahead = false) {
    const key = this.keyOf(L, x, y);
    const gen = this.gen;
    const ctl = new AbortController();
    this.inflight.set(key, ctl);
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let h: Float32Array | null = null;
    // (its imagery alongside, on the levels that have some: none if it will not come — the coarser level's
    // there. Never waited for: the heights drawn as they come, the tile written again with its imagery — under
    // its own time limit, given up with the tile)
    const xw = ((x % L.n) + L.n) % L.n;
    const imgCtl = new AbortController();
    const imgTimer = setTimeout(() => imgCtl.abort(), TIMEOUT_MS);
    const relay = () => imgCtl.abort();
    ctl.signal.addEventListener("abort", relay, { once: true });
    // (the tile's national source — its centre's: swisstopo's, the IGN's — or none)
    const src = tileSource(NATIONAL, L.n, xw, y);
    // (the relay removed once the imagery is in or given up: none left on the tile's signal)
    const img = (L.z <= IMG_Z1 ? imagery(L.z, xw, y, imgCtl.signal, this.orthoOn ? src : null) : Promise.resolve(null)).finally(() => {
      clearTimeout(imgTimer);
      ctl.signal.removeEventListener("abort", relay);
    });
    try {
      // (over France the IGN's heights — the global data's where it has none —; elsewhere Terrarium's)
      const heights =
        this.reliefOn && src && L.z >= src.heightsFrom
          ? await nationalHeights(src, L.z, xw, y, ctl.signal, this.hlodOn)
          : await terrarium(L.z, xw, y, ctl.signal);
      // (begun before a switch of the sources: the old source's — the slot waits for the new one's)
      if (gen !== this.gen) return;
      h = heights;
      this.loaded++;
      if (ahead) {
        // (into memory at once — its heights: drawn from there if its window comes to it —, its imagery when it comes:
        // onto the tile if drawn meanwhile)
        this.keep(key, heights, null);
        void img.then((col) => {
          if (!col || gen !== this.gen) return;
          if (L.key[this.slotOf(L, x, y)] === key) this.put(L.z, x, y, heights, col);
          else if (this.cache.has(key)) this.keep(key, heights, col);
        });
        h = null;
      } else
        void img.then((col) => {
          if (col && gen === this.gen && L.key[this.slotOf(L, x, y)] === key) this.put(L.z, x, y, heights, col);
        });
    } catch (e) {
      if (gen !== this.gen || !this.inflight.has(key)) return; // (cleared, or the sources switched)
      const f = this.failures.get(key) ?? { n: 0, at: 0 };
      f.n++;
      f.at = performance.now() + 3000 * f.n;
      this.failures.set(key, f);
      // (asked again once it may be: the image converged, no frame asks — the tile would wait for a move)
      if (f.n < 2) setTimeout(() => this.request(cx0(this.priorityLon), this.prioritySinLat), 3000 * f.n + 10);
      // (twice failed: the global map's heights there, the level not held back)
      if (f.n >= 2) {
        h = this.fromFallback(L, x, y);
        this.failed++;
        if (f.n === 2) console.warn(`Terrain tile ${key} unavailable (${(e as Error).message}): the global map there`);
      }
    } finally {
      clearTimeout(timer);
      if (this.inflight.get(key) === ctl) this.inflight.delete(key);
    }
    if (h) this.put(L.z, x, y, h);
    this.request(cx0(this.priorityLon), this.prioritySinLat);
  }

  /** each tile's highest height (worked out once) */
  private tops = new WeakMap<Float32Array, number>();
  /** The highest height of the tiles held, every level's [m] (−∞: none) — the relief's ceiling (relief-ceiling.ts). */
  top(): number {
    let m = -Infinity;
    for (const L of this.levels)
      for (const d of L.data) {
        if (!d) continue;
        let t = this.tops.get(d);
        if (t === undefined) {
          t = -Infinity;
          for (let i = 0; i < d.length; i++) if (d[i]! > t) t = d[i]!;
          this.tops.set(d, t);
        }
        if (t > m) m = t;
      }
    return m;
  }

  /** A tile's heights in (z, x — unwrapped as its level's window has it —, y; 256² row by row [m]), with
   *  its imagery (rgba8 packed; none: 0): kept and sent to the GPU while its window wants it. */
  put(z: number, x: number, y: number, h: Float32Array, col: Uint32Array | null = null) {
    const L = this.levels[z - Z0];
    if (!L || !inside(L.want, x, y)) return;
    const s = this.slotOf(L, x, y);
    // (the ring's levels: the tile the window leaves kept past it — walked back to, drawn from memory —, this one's
    // imagery held for when it leaves in turn)
    const ringLevel = this.ringLevel(L);
    const old = L.key[s];
    if (ringLevel && old && old !== this.keyOf(L, x, y) && L.data[s]) this.keep(old, L.data[s]!, L.col[s] ?? null);
    L.col[s] = ringLevel ? (col ?? (old === this.keyOf(L, x, y) ? (L.col[s] ?? null) : null)) : null;
    if (col && inside(L.valid, x, y) && L.key[s] === this.keyOf(L, x, y)) this.imagery++;
    L.key[s] = this.keyOf(L, x, y);
    L.data[s] = h;
    const hb = new Uint32Array(h.buffer, h.byteOffset, TILE * TILE);
    const texels = new Uint32Array(2 * TILE * TILE);
    // (an overground drawn on its ground — I6 —, the ground's source mark kept in the sum's last bit)
    const over = h.length > TILE * TILE ? h.subarray(TILE * TILE) : null;
    for (let i = 0; i < hb.length; i++) {
      if (over && over[i]! > 0) {
        BITS[0] = h[i]! + over[i]!;
        texels[2 * i] = (BITS_U[0]! & ~1) | (hb[i]! & 1);
      } else texels[2 * i] = hb[i]!;
      texels[2 * i + 1] = col ? col[i]! : 0;
    }
    this.device.queue.writeTexture(
      { texture: this.texture, origin: [(s % L.span) * TILE, Math.floor(s / L.span) * TILE, L.z - Z0] },
      texels,
      { bytesPerRow: TILE * 8 },
      [TILE, TILE, 1],
    );
    this.complete(L);
  }

  /** The tiles each orthophotos' level's window wants (z, x, y). */
  orthoWanted(): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (const O of this.ortho) {
      if (!O.want) continue;
      for (let y = O.want.y0; y < O.want.y1; y++) for (let x = O.want.x0; x < O.want.x1; x++) out.push([O.z, ((x % O.n) + O.n) % O.n, y]);
    }
    return out;
  }

  /** The tiles each level's window wants (z, x, y): what the loads fetch. */
  wanted(): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (const L of this.levels) {
      if (!L.want) continue;
      for (let y = L.want.y0; y < L.want.y1; y++) for (let x = L.want.x0; x < L.want.x1; x++) out.push([L.z, x, y]);
    }
    return out;
  }

  /** The level drawn whole once all its window's tiles are in. */
  private complete(L: Level) {
    const w = L.want;
    if (!w) return;
    for (let y = w.y0; y < w.y1; y++) for (let x = w.x0; x < w.x1; x++) if (L.key[this.slotOf(L, x, y)] !== this.keyOf(L, x, y)) return;
    // (taken again whole after a switch: its rectangle the same, its heights not — the ground built from them redone)
    if (L.stale && same(L.valid, w)) {
      L.stale = false;
      this.stamp++;
      this.onChange?.();
      return;
    }
    L.stale = false;
    this.setValid(L, w);
  }

  private fromFallback(L: Level, x: number, y: number) {
    const h = new Float32Array(TILE * TILE);
    if (!this.fallback) return h;
    for (let j = 0; j < TILE; j++) {
      const m = (0.5 - (y + (j + 0.5) / TILE) / L.n) * TAU;
      const lat = Math.atan(Math.sinh(m));
      for (let i = 0; i < TILE; i++) {
        const lon = ((x + (i + 0.5) / TILE) / L.n - 0.5) * TAU;
        h[j * TILE + i] = this.fallback([Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]);
      }
    }
    markFine(h, false);
    return h;
  }

  /**
   * The tracer's params (trace.wgsl: P.tiles, P.tileL): the reference (cos, sin of its longitude, the sine
   * of its latitude, on), then per level the reference's place in its valid rectangle [px], the
   * rectangle's corner in its layer [px], its size [px], its pixels per radian, its window's side in its layer [px]
   * (a power of two, the tracer's wrap: 0 off).
   */
  params(): Float32Array {
    const f = new Float32Array(TILE_PARAM_VEC4S * 4);
    let on = 0;
    for (let l = 0; l < LEVELS; l++) {
      const L = this.levels[l]!;
      const v = L.valid;
      if (!v) continue;
      on = 1;
      const S = L.n * TILE;
      let ax = (this.lon / TAU + 0.5) * S - v.x0 * TILE;
      if (ax > S / 2) ax -= S;
      else if (ax < -S / 2) ax += S;
      const ay = mercY(this.sinLat, L.n) * TILE - v.y0 * TILE;
      const o = 4 + 8 * l;
      const C = TILE * L.span;
      f.set([ax, ay, (((v.x0 * TILE) % C) + C) % C, (v.y0 * TILE) % C], o);
      f.set([(v.x1 - v.x0) * TILE, (v.y1 - v.y0) * TILE, S / TAU, C], o + 4);
    }
    f.set([Math.cos(this.lon), Math.sin(this.lon), this.sinLat, on], 0);
    return f;
  }

  /**
   * The orthophotos' windows (I1): over France, the levels finer than the relief's the ground under the camera needs
   * (its texel within the pixel's footprint there), to `zMax` (offline, the zones' there), each led ahead as the relief's;
   * elsewhere, or off, none.
   */
  private updateOrtho(alt: number, pixAngle: number, cosLat: number, gLonT: number, gSinLat: number, zMax: number) {
    const lat = (Math.asin(this.sinLat) * 180) / Math.PI,
      lon = (this.lon * 180) / Math.PI;
    const B = NATIONAL_BOX;
    if (!this.orthoOn || lat < B.south - 0.1 || lat > B.north + 0.1 || lon < B.west - 0.1 || lon > B.east + 0.1) {
      if (this.ortho.some((O) => O.want)) this.clearOrtho();
      return;
    }
    const zNeed = Math.min(Math.ceil(Math.log2((TAU * R * cosLat) / (TILE * Math.max(alt * pixAngle, 0.1)))), zMax);
    for (const O of this.ortho) {
      if (O.z > zNeed) {
        if (O.want) {
          O.want = null;
          O.valid = null;
        }
        continue;
      }
      const cx0 = (this.lon / TAU + 0.5) * O.n,
        cy0 = mercY(this.sinLat, O.n);
      const gx = gLonT * O.n - cx0,
        gy = mercY(gSinLat, O.n) - cy0;
      const gl = Math.hypot(gx, gy);
      const most = ORTHO_SPAN / 2 - 0.75;
      const k = gl > most ? most / gl : 1;
      const cx = cx0 + gx * k,
        cy = cy0 + gy * k;
      const mid = ORTHO_SPAN / 2;
      let want = O.want;
      if (!want || Math.abs(cx - (want.x0 + mid)) > 0.8 || Math.abs(cy - (want.y0 + mid)) > 0.8) {
        const x0 = Math.round(cx) - mid,
          y0 = Math.min(Math.max(Math.round(cy) - mid, 0), O.n - ORTHO_SPAN);
        want = { x0, y0, x1: x0 + ORTHO_SPAN, y1: y0 + ORTHO_SPAN };
      }
      if (!same(want, O.want)) {
        O.want = want;
        O.valid = intersect(O.valid, want);
        this.orthoComplete(O);
      }
    }
  }

  private orthoKey(O: OrthoLevel, x: number, y: number) {
    return `o${O.z}/${((x % O.n) + O.n) % O.n}/${y}`;
  }

  /** The orthophotos' loads: the coarse levels first, each from the camera outwards, after the relief's. */
  private requestOrtho(lonT: number, sinLat: number) {
    for (const O of this.ortho) {
      if (!O.want || same(O.valid, O.want)) continue;
      const cx = lonT * O.n,
        cy = mercY(sinLat, O.n);
      const todo: [number, number, number][] = [];
      for (let y = O.want.y0; y < O.want.y1; y++)
        for (let x = O.want.x0; x < O.want.x1; x++) {
          const key = this.orthoKey(O, x, y);
          if (O.key[orthoSlot(x, y)] === key || this.orthoInflight.has(key)) continue;
          // (one its source has not, or no national source's: none there at once — the coarser levels' imagery)
          if (this.orthoNone.has(key) || !tileSource(NATIONAL, O.n, x, y)) {
            this.putOrtho(O.z, x, y, null);
            continue;
          }
          todo.push([x, y, (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2]);
        }
      todo.sort((a, b) => a[2] - b[2]);
      for (const [x, y] of todo) {
        if (this.orthoInflight.size >= ORTHO_INFLIGHT) return;
        void this.loadOrtho(O, x, y);
      }
    }
  }

  private async loadOrtho(O: OrthoLevel, x: number, y: number) {
    const key = this.orthoKey(O, x, y);
    const ctl = new AbortController();
    this.orthoInflight.set(key, ctl);
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const xw = ((x % O.n) + O.n) % O.n;
    const src = tileSource(NATIONAL, O.n, xw, y);
    let col: Uint32Array | null = null;
    let none = !src;
    try {
      const res = src ? await fetch(src.orthoUrl(O.z, xw, y), { signal: ctl.signal }) : null;
      if (!res) {
        // (no source: none)
      } else if (res.status === 404) none = true;
      else if (!res.ok) throw new Error(`HTTP ${res.status}`);
      else {
        const px = await pixels(await res.blob());
        col = new Uint32Array(TILE * TILE);
        for (let i = 0; i < col.length; i++) {
          const [r, g, b] = orthoColour(px[4 * i]!, px[4 * i + 1]!, px[4 * i + 2]!, src!.fit);
          col[i] = (Math.max(r, 1) | (g << 8) | (b << 16) | (255 << 24)) >>> 0;
        }
      }
    } catch {
      // (refused, timed out — offline —: none there this time, asked again once the window comes back to it)
    } finally {
      clearTimeout(timer);
    }
    if (this.orthoInflight.get(key) !== ctl) return; // (cleared meanwhile)
    this.orthoInflight.delete(key);
    if (col) this.orthoLoaded++;
    // (the IGN has none there: not asked again)
    if (none) this.orthoNone.add(key);
    if (this.orthoNone.size > 4096) this.orthoNone.clear();
    this.putOrtho(O.z, x, y, col);
    this.requestOrtho(cx0(this.priorityLon), this.prioritySinLat);
  }

  /** An orthophoto's tile into its window's slot (its imagery; null: none there — the coarser levels'). */
  private putOrtho(z: number, x: number, y: number, col: Uint32Array | null) {
    const k = z - ORTHO_Z0;
    const O = this.ortho[k];
    if (!O || !inside(O.want, x, y)) return;
    const s = orthoSlot(x, y);
    O.key[s] = this.orthoKey(O, x, y);
    const texels = new Uint32Array(2 * TILE * TILE);
    if (col) for (let i = 0; i < col.length; i++) texels[2 * i + 1] = col[i]!;
    const q = orthoQuadrant(k, this.clip);
    this.device.queue.writeTexture(
      { texture: this.texture, origin: [q.x + (s % ORTHO_SPAN) * TILE, q.y + Math.floor(s / ORTHO_SPAN) * TILE, q.layer] },
      texels,
      { bytesPerRow: TILE * 8 },
      [TILE, TILE, 1],
    );
    if (col) this.imagery++;
    this.orthoComplete(O);
  }

  private orthoComplete(O: OrthoLevel) {
    const w = O.want;
    if (!w) return;
    for (let y = w.y0; y < w.y1; y++) for (let x = w.x0; x < w.x1; x++) if (O.key[orthoSlot(x, y)] !== this.orthoKey(O, x, y)) return;
    if (!same(O.valid, w)) {
      O.valid = w;
      this.imagery++;
    }
  }

  /**
   * The orthophotos' params (the tracer's table: gpu-tables.ts TABLE_ORTHO, trace.wgsl earthImagery), three vec4s a
   * level: the reference in its valid rectangle [px] and the rectangle's corner in its window [px]; the rectangle's
   * size [px], the level's pixels per radian, on (1); its layer, its quadrant's corner in it [px], its z.
   */
  orthoParams(): Float32Array<ArrayBuffer> {
    const f = new Float32Array(ORTHO_PARAM_VEC4S * 4);
    for (let k = 0; k < ORTHO_LEVELS; k++) {
      const O = this.ortho[k]!;
      const v = O.valid;
      const q = orthoQuadrant(k, this.clip);
      f.set([q.layer, q.x, q.y, O.z], 12 * k + 8);
      if (!v) continue;
      const S = O.n * TILE;
      let ax = (this.lon / TAU + 0.5) * S - v.x0 * TILE;
      if (ax > S / 2) ax -= S;
      else if (ax < -S / 2) ax += S;
      const ay = mercY(this.sinLat, O.n) * TILE - v.y0 * TILE;
      f.set([ax, ay, (((v.x0 * TILE) % ORTHO_CLIP) + ORTHO_CLIP) % ORTHO_CLIP, (v.y0 * TILE) % ORTHO_CLIP], 12 * k);
      f.set([(v.x1 - v.x0) * TILE, (v.y1 - v.y0) * TILE, S / TAU, 1], 12 * k + 4);
    }
    // (the box the relief's levels take the IGN's imagery in — z 9 … 14: theirs a photograph there too —, and whether)
    const B = NATIONAL_BOX,
      rad = Math.PI / 180;
    f.set([B.west * rad, B.south * rad, B.east * rad, B.north * rad], 12 * ORTHO_LEVELS);
    f.set([this.orthoOn ? 1 : 0, 0, 0, 0], 12 * ORTHO_LEVELS + 4);
    return f;
  }

  /**
   * The levels' heights at q (unit, the Earth's axes) for a footprint foot [m], as the tracer weighs them
   * (trace.wgsl: earthTiles): the finest level within the footprint and the next coarser, blended by the
   * footprint and towards the windows' edges; what is left to the global map in rem.
   */
  /** the ground under q at a footprint [m]: the bare ground (`drawn`: with the far levels' overground, as the tracer draws it) */
  heightAt(q: Vec3, foot: number, drawn = false): TileSample {
    let h = 0,
      res = 0,
      rem = 1;
    const cosLat = Math.sqrt(Math.max(1 - q[2] * q[2], 1e-12));
    // (from the reference, as the tracer measures it)
    const c = Math.cos(this.lon),
      s = Math.sin(this.lon);
    const dlon = Math.atan2(-q[0] * s + q[1] * c, q[0] * c + q[1] * s);
    const sz = Math.min(Math.max(q[2], -0.999999), 0.999999);
    const dM = Math.atanh((sz - this.sinLat) / (1 - sz * this.sinLat));
    const zf = Math.log2((TAU * R * cosLat) / (TILE * Math.max(foot, 0.5)));
    for (let l = LEVELS - 1; l >= 0 && rem > 1e-4; l--) {
      const L = this.levels[l]!;
      const v = L.valid;
      if (!v) continue;
      const wz = Math.min(Math.max(zf - L.z + 1, 0), 1);
      if (wz <= 0) continue;
      const S = L.n * TILE;
      let ax = (this.lon / TAU + 0.5) * S - v.x0 * TILE;
      if (ax > S / 2) ax -= S;
      else if (ax < -S / 2) ax += S;
      const ay = mercY(this.sinLat, L.n) * TILE - v.y0 * TILE;
      const px = ax + (dlon * S) / TAU,
        py = ay - (dM * S) / TAU;
      const w = wz * edge(px, py, (v.x1 - v.x0) * TILE, (v.y1 - v.y0) * TILE);
      if (w <= 0) continue;
      const texel = (TAU * R * cosLat) / S;
      const at = (i: number, j: number) => {
        const gx = v.x0 * TILE + i,
          gy = v.y0 * TILE + j;
        const tx = Math.floor(gx / TILE),
          ty = Math.floor(gy / TILE);
        const d = L.data[this.slotOf(L, tx, ty)]!,
          k = (gy - ty * TILE) * TILE + (gx - tx * TILE);
        return drawn ? drawnHeight(d, k) : d[k]!;
      };
      const hz = sampleLevel(at, px, py, zf - L.z);
      h += rem * w * hz;
      // (the data's own resolution: a survey's its texel, the global data's no finer than SRTM's — the nearest texel's mark)
      const fine = isFine(at(Math.floor(px), Math.floor(py)));
      res += rem * w * Math.max(texel, fine ? TILE_RES_FINE : TILE_RES_MIN);
      rem *= 1 - w;
    }
    return { h, res, rem };
  }
}

/**
 * A tile's imagery (GIBS: the day's colour, the night's lights), packed rgba8 — the day's sRGB, the
 * lights' level —, never 0 (the tracer's mark of none); null if either will not come. The lights on the
 * global night map's scale (its Black Marble: a ground of 0.07 under them, cities bloomed to 1): VIIRS's
 * sharper, darker levels v as 0.07 + 0.93 · min(1.06 √v, 1) — its 99.5th percentile over the cities of
 * Japan, Europe and the United States at 1, as the map's.
 */
// (the z 8 lights' tiles the finer levels share — a z 13 window's sixteen tiles under one or four of them:
// fetched once, kept for the last few, never cancelled by one tile's abort)
const parents = new Map<string, Promise<Blob>>();
function parentBlob(url: string): Promise<Blob> {
  let p = parents.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.blob();
    });
    p.catch(() => parents.delete(url));
    parents.set(url, p);
    if (parents.size > 24) parents.delete(parents.keys().next().value!);
  }
  return p;
}
async function imagery(
  z: number,
  x: number,
  y: number,
  signal: AbortSignal,
  ortho: NationalSource | null = null,
): Promise<Uint32Array | null> {
  try {
    const get = async (url: string, crop?: [number, number, number]) => {
      // (the shared parent raced against this tile's own abort: a stalled request never holds the tile — nor its
      // slot, nor the heights waiting on it)
      if (crop) {
        if (signal.aborted) throw new Error("aborted");
        let stop = () => {};
        const aborted = new Promise<never>((_, no) => {
          stop = () => no(new Error("aborted"));
          signal.addEventListener("abort", stop, { once: true });
        });
        // (its listener removed when the race is over, the parent's blob in or the tile given up)
        try {
          return pixels(await Promise.race([parentBlob(url), aborted]), crop);
        } finally {
          signal.removeEventListener("abort", stop);
        }
      }
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return pixels(await res.blob());
    };
    // (finer than GIBS: EOX's day — over a national source's land its orthophotos instead (the IGN's, swisstopo's), the same
    // grid, EOX's where it has none; the lights' z 8 parent, the tile's square of it enlarged)
    const fine = z > GIBS_Z1;
    const night = nightOf(z, x, y);
    const day = async (): Promise<[Uint8ClampedArray, NationalSource | null]> => {
      if (fine && ortho)
        try {
          return [await get(ortho.orthoUrl(z, x, y)), ortho];
        } catch {
          if (signal.aborted) throw new Error("aborted");
        }
      return [await get(fine ? eoxUrl(z, x, y) : dayUrl(z, x, y)), null];
    };
    const [[d, photo], n] = await Promise.all([day(), get(nightUrl(night.z, night.x, night.y), night.crop ?? undefined)]);
    const out = new Uint32Array(TILE * TILE);
    for (let i = 0; i < out.length; i++) {
      const v = (n[4 * i]! * n[4 * i + 3]!) / (255 * 255);
      const lights = v > 0 ? Math.round(255 * (0.07 + 0.93 * Math.min(1.06 * Math.sqrt(v), 1))) : 0;
      const [r, g, b] = photo
        ? orthoColour(d[4 * i]!, d[4 * i + 1]!, d[4 * i + 2]!, photo.fit)
        : fine
          ? eoxColour(d[4 * i]!, d[4 * i + 1]!, d[4 * i + 2]!)
          : [d[4 * i]!, d[4 * i + 1]!, d[4 * i + 2]!];
      out[i] = (Math.max(r, 1) | (g << 8) | (b << 16) | (lights << 24)) >>> 0;
    }
    return out;
  } catch {
    return null;
  }
}

/** The night's lights for a tile: its own (to z 8), else its z 8 parent and the square of it the tile covers
 *  (x, y, side [px]: enlarged to the tile). */
export function nightOf(z: number, x: number, y: number): { z: number; x: number; y: number; crop: [number, number, number] | null } {
  if (z <= GIBS_Z1) return { z, x, y, crop: null };
  const k = z - GIBS_Z1,
    side = TILE >> k;
  return { z: GIBS_Z1, x: x >> k, y: y >> k, crop: [(x - ((x >> k) << k)) * side, (y - ((y >> k) << k)) * side, side] };
}

/** the reference's longitude in turns from −½ (Mercator's x over the level's width) */
const cx0 = (lon: number) => lon / TAU + 0.5;

/** an orthophotos' tile's slot in its 4 × 4 window */
const orthoSlot = (x: number, y: number) =>
  (((y % ORTHO_SPAN) + ORTHO_SPAN) % ORTHO_SPAN) * ORTHO_SPAN + (((x % ORTHO_SPAN) + ORTHO_SPAN) % ORTHO_SPAN);
/** an orthophotos' level's place in the texture: its layer (after the relief's), its 1024² quadrant's corner [px] */
export function orthoQuadrant(k: number, clip: number): { layer: number; x: number; y: number } {
  const side = clip / ORTHO_CLIP,
    per = side * side;
  const q = k % per;
  return { layer: LEVELS + Math.floor(k / per), x: (q % side) * ORTHO_CLIP, y: Math.floor(q / side) * ORTHO_CLIP };
}
/** A level's weight towards its window's edges [px]: none within 2 px of it, full 48 px in. */
export function edge(px: number, py: number, w: number, h: number) {
  const d = Math.min(px, py, w - px, h - py);
  const t = Math.min(Math.max((d - 2) / 46, 0), 1);
  return t * t * (3 - 2 * t);
}

/** A monotone cubic through four samples, at f between the middle two (trace.wgsl monoCubic: Fritsch–Butland's slopes). */
const monoCubic = (p0: number, p1: number, p2: number, p3: number, f: number) => {
  const d0 = p1 - p0,
    d1 = p2 - p1,
    d2 = p3 - p2;
  const m1 = d0 * d1 > 0 ? (2 * d0 * d1) / (d0 + d1) : 0;
  const m2 = d1 * d2 > 0 ? (2 * d1 * d2) / (d1 + d2) : 0;
  const f2 = f * f,
    f3 = f2 * f;
  return (2 * f3 - 3 * f2 + 1) * p1 + (f3 - 2 * f2 + f) * m1 + (-2 * f3 + 3 * f2) * p2 + (f3 - f2) * m2;
};

/**
 * A level's height at (px, py) [its pixels, from its rectangle's corner]: bilinear, or — its texel more
 * than twice the footprint (mag: by how many octaves larger) — a monotone cubic through its texels (a cliff kept a
 * cliff: the B-spline before rounded Monument Valley's buttes into domes), the two blended over an octave (trace.wgsl:
 * tileSample).
 */
export function sampleLevel(at: (i: number, j: number) => number, px: number, py: number, mag: number) {
  const x = px - 0.5,
    y = py - 0.5;
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = x - x0,
    fy = y - y0;
  const k = Math.min(Math.max(mag - 1, 0), 1);
  let lin = 0;
  if (k < 1) lin = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  if (k <= 0) return lin;
  const rows = [0, 1, 2, 3].map((j) =>
    monoCubic(at(x0 - 1, y0 + j - 1), at(x0, y0 + j - 1), at(x0 + 1, y0 + j - 1), at(x0 + 2, y0 + j - 1), fx),
  );
  const b = monoCubic(rows[0]!, rows[1]!, rows[2]!, rows[3]!, fy);
  return lin + (b - lin) * k;
}

/**
 * The tiles' coordinates (trace.wgsl tileCoord: longitude from the reference [rad], Mercator's y from it) of the camera's
 * anchor A — on the Earth's squashed axes [radii], float32 values (renderer params 67) —, in float64, from the reference as
 * the tracer has it (cos, sin of its longitude, sine of its latitude: float32): the raster's ground near the camera is read
 * from there plus its small offset (trace.wgsl tileAnchor) — a unit-sphere point in float32 is good to ~0.4 m only.
 */
export function anchorTileCoord(A: readonly number[], cosRef: number, sinRef: number, sinLatRef: number): [number, number] {
  // (geodetic: the squashed z stretched again — trace.wgsl geoQ, EARTH_AB as float32)
  const ab = Math.fround(1.0033640898209764);
  const gz = A[2]! * ab;
  const s = gz / Math.hypot(A[0]!, A[1]!, gz);
  let dl = Math.atan2(A[1]!, A[0]!) - Math.atan2(sinRef, cosRef);
  dl -= TAU * Math.round(dl / TAU);
  return [dl, Math.atanh(s) - Math.atanh(sinLatRef)];
}
