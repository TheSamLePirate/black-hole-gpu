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
// A level's window lives in an rg32uint array — its heights' float bits, its imagery (rgba8: the day's colour in sRGB,
// the night's lights; 0: none) —, a layer of its own, or a 1024² quadrant of one for a 4-tile window in a 2048² texture
// (tileLayout — T10), its tiles at their coordinates modulo its span (a toroidal clipmap): the window follows the camera tile by tile, the tiles it leaves overwritten by
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
import { cartToGeodetic, geodeticDirAt, squashedScale, WGS84_A, WGS84_F } from "./ellipsoid";
import { IGN_GATE_SW } from "./scenery-data";
import { type NationalSource, SWISSTOPO, sourceAt, sourcesBox, tileSource } from "./national";
import { type DecodeReply, type DecodeRequest, decodeTile, ORTHO_FIT, pixels as decodePixels } from "./tile-decode";
export { EOX_FIT, eoxColour, ORTHO_FIT, orthoColour } from "./tile-decode";

export const TILE = 256;
/** tiles along a level's window (the normal detail's reach; a farther one, EarthTiles.setReach: 8 on the fine levels) */
export const SPAN = 4;
/** the finest levels a farther reach widens (z 11–14: 8 tiles of z 11 span what 4 of z 10 do — the coarser levels' 4
 *  tiles already reach past them) */
export const FINE_Z = 11;
export const CLIP = TILE * SPAN;
/** By the detail's reach (settings.detailReach): the windows' tiles a side, the tiles kept in memory past them (a
 *  tile 512 KiB: its heights and its imagery), the rings round every level's window loaded ahead into them — the halo,
 *  never idle while it has room: nearest first in each level's own tiles, led along the motion (EarthTiles.cost) — so the
 *  coarse levels' far relief comes as early as the fine levels' near detail (2 Nov 2026, T8: "the very far reach is not
 *  far enough") */
export const TILE_REACH = {
  normal: { span: 4, cache: 0, ring: 0 },
  far: { span: 8, cache: 320, ring: 3 },
  veryFar: { span: 8, cache: 640, ring: 6 },
} as const;
/** how much the halo leads along the motion: a tile ahead counted (1 − HALO_LEAD) as far, one behind (1 + HALO_LEAD) */
export const HALO_LEAD = 0.6;
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
/** the national sources' heights fetched at once (their own queue — EarthTiles.refine —: never the global data's slots) */
const MAX_NATIONAL = 14;
/** a national tile's time limit, its turn come [ms]: its two or three grids through the rate's gate */
const NATIONAL_TIMEOUT_MS = 30000;

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
/** their windows' tiles a side (4: 3.4 km at z 15 down to 425 m at z 18, at 48°) and its texels */
export const ORTHO_SPAN = 4;
export const ORTHO_CLIP = TILE * ORTHO_SPAN;
/** T8e (plan T8, contract C0-4): the coarsest orthophotos' levels whose window is 8 tiles a side at a far reach (the 2048²
 *  imagery texture made — setReach) — 2: z 15 and z 16, 6.5 km and 3.3 km at 48° —, in that texture's last layers. **0: off.**
 *  Measured with them (3 Nov 2026, ortho-filter, warm cache, the exposure settled): no visible change at Paris 450 m ahead nor
 *  2 000 m plunging — beyond 1.6 km a pixel's footprint is coarser than z 15's texel there, the IGN's z ≤ 14 imagery drawing it
 *  —, for 45 MB of GPU memory and 128 more requests a window: off until a view shows their worth (Sam's call) */
export const ORTHO_BIG_LEVELS = 0;
export const ORTHO_SPAN_BIG = 8;
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
  /** its rate changed (a second's requests) */
  rate(perSecond: number) {
    this.perSecond = perSecond;
  }
  /** resolves when the next request may go */
  take(): Promise<void> {
    const now = performance.now(),
      at = Math.max(now, this.next);
    this.next = at + 1000 / this.perSecond;
    return at > now ? new Promise((done) => setTimeout(done, at - now)) : Promise.resolve();
  }
}
const ignGate = new RateGate(20);
/** the page's own gate on the IGN's grids opened once the Service Worker controls it (IGN_GATE_SW, scenery-data.ts) */
let swGateOpen = false;
export function swControls(): boolean {
  return typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller;
}
function swGateCheck() {
  if (swGateOpen || !swControls()) return;
  swGateOpen = true;
  ignGate.rate(IGN_GATE_SW);
}
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

/** a place in the tiles' texture: its layer, its corner [px] */
export type TileSlot = { layer: number; x: number; y: number };
/**
 * Where each level's window lives in a texture of a side (T10, the plan's §3.6): a window as wide as the texture its own layer
 * (z 11 … 14 at the farther reaches), the 4-tile ones (1024², z 6 … 10 and z 15 … 17 whatever the reach — 8 of the 12 levels)
 * by quadrants of the layers after. At the very far reach 6 layers of 2048² where each level took one (13: 436 MB, the
 * 4-tile ones a quarter of theirs); at the normal one (1024²) one a level. The tracer reads them through tileAt
 * (trace.wgsl): the quadrant's corner in the bits of P.tileL[2l].zw above its window's mask, its layer in P.tileL[2l + 1].w's
 * high bits. (The orthophotos have their own filtered texture since T9a: EarthTiles.orthoTexture.)
 */
export function tileLayout(clip: number, sides: readonly number[]): { levels: TileSlot[]; layers: number } {
  const side = clip / ORTHO_CLIP,
    per = side * side;
  let layer = 0,
    q = 0;
  const levels: TileSlot[] = sides.map(() => ({ layer: 0, x: 0, y: 0 }));
  sides.forEach((C, l) => {
    if (C >= clip) levels[l] = { layer: layer++, x: 0, y: 0 };
  });
  const quad = (): TileSlot => {
    const k = q % per,
      at = { layer: layer + Math.floor(q / per), x: (k % side) * ORTHO_CLIP, y: Math.floor(k / side) * ORTHO_CLIP };
    q++;
    return at;
  };
  sides.forEach((C, l) => {
    if (C >= clip) return;
    if (C !== ORTHO_CLIP) throw new Error(`tileLayout: a ${C}² window in a ${clip}² texture`);
    levels[l] = quad();
  });
  return { levels, layers: layer + Math.ceil(q / per) };
}

/** T9a–T9b (contract C0-4): the imagery's own textures — rgba8 (an sRGB view: the hardware decodes, then filters in linear
 *  light), a window a layer (the addressing's repeat wraps the torus), per-tile mips down to 16² (a tile's mips never read its
 *  neighbour), alpha the coverage (0: no image there — the filtering premultiplied). The 1024² one: the orthophotos' four
 *  levels (layers 0–3), then the relief's levels z 6 … 14 whose window is 1024² (layer IMG_LAYER0 + their index); the 2048²
 *  one: z 11 … 14 when their window is 2048² (the farther reaches; layer z − FINE_Z). The night's lights stay in the relief's
 *  texture's imagery alpha (rg32uint; GIBS's, z ≤ 8), read as before */
export const ORTHO_MIPS = 5;
/** the imagery levels' first layer in the 1024² texture (after the orthophotos') */
export const IMG_LAYER0 = ORTHO_LEVELS;
/** the night's lights' first layer in the 1024² texture (T9c: GIBS's, z 6 … 8 — the finer levels' their parent's): alpha the
 *  lights, rgb the coverage (white where a tile came) */
export const IMG_LIGHT0 = IMG_LAYER0 + (IMG_Z1 - Z0 + 1);
/** the 1024² texture's layers: the orthophotos', every imagery level's (z 6 … 14), the lights' (z 6 … 8) */
export const IMG_1K_LAYERS = IMG_LIGHT0 + (GIBS_Z1 - Z0 + 1);
/** the 2048² texture's layers: z FINE_Z … 14, then the orthophotos' z 15 and z 16 at a far reach (T8e: from ORTHO_2K_LAYER0) */
export const ORTHO_2K_LAYER0 = IMG_Z1 - FINE_Z + 1;
export const IMG_2K_LAYERS = ORTHO_2K_LAYER0 + ORTHO_BIG_LEVELS;
const mipBytes = (side: number, layers: number) =>
  Array.from({ length: ORTHO_MIPS }, (_, m) => (side >> m) ** 2 * layers * 4).reduce((a, b) => a + b, 0);
/** their bytes, their mips in: the 1024² (89 MB) and the 2048² (89 MB; 134 MB with the orthophotos' z 15–16 — T8e, ORTHO_BIG_LEVELS 2 —; at the farther reaches only) */
export const ORTHO_BYTES = mipBytes(ORTHO_CLIP, IMG_1K_LAYERS);
export const IMG_2K_BYTES = mipBytes(2 * ORTHO_CLIP, IMG_2K_LAYERS);
/** sampled textures per stage with the imagery's two (the horizon maps' 29 and two); the 1024² texture's, the sampler's, the
 *  2048² texture's bindings */
export const ORTHO_TEXTURE_LIMIT = 31;
export const ORTHO_BINDINGS = [44, 45, 46] as const;
/**
 * The tracer's reader of the imagery's textures (T9a, T9b): `orthoAt(k, uv, lod)`, `orthoGrad(k, uv, gx, gy)` — an
 * orthophotos' level's window at uv (its texels over its side, wrapped) —, and `tileImgAt(l, p, lod)`, `tileImgGrad(l, p, gx,
 * gy)` — a relief level's imagery at p (its texels from its valid rectangle's corner; the gradients in those texels): at a mip
 * or by the pixel's gradients (anisotropic, 16 at most), the linear colour premultiplied by the coverage, the coverage in a.
 * Where the device takes the two more textures; the stub otherwise (no orthophotos; the relief levels' imagery by hand, one
 * bilinear tap, as before T9b).
 */
export function withOrthoImagery(trace: string, supported: boolean): string {
  const marker = /\/\/ BEGIN_ORTHO_IMAGERY[\s\S]*?\/\/ END_ORTHO_IMAGERY/;
  if (!marker.test(trace)) throw new Error("earth-tiles: missing orthophotos stub");
  if (!supported) return trace;
  return trace.replace(
    marker,
    `
@group(0) @binding(${ORTHO_BINDINGS[0]}) var orthoTex: texture_2d_array<f32>;
@group(0) @binding(${ORTHO_BINDINGS[1]}) var orthoSamp: sampler;
@group(0) @binding(${ORTHO_BINDINGS[2]}) var imgTex2k: texture_2d_array<f32>;
fn orthoAt(k: u32, side: f32, uv: vec2f, lod: f32) -> vec4f {
  // (an 8-tile window — T8e, z 15–16 at a far reach —: the 2048² texture's last layers)
  if (side > ${ORTHO_CLIP}.5) { return textureSampleLevel(imgTex2k, orthoSamp, uv, ${ORTHO_2K_LAYER0}u + k, min(lod, ${ORTHO_MIPS - 1}.0)); }
  return textureSampleLevel(orthoTex, orthoSamp, uv, k, min(lod, ${ORTHO_MIPS - 1}.0));
}
fn orthoGrad(k: u32, side: f32, uv: vec2f, gx: vec2f, gy: vec2f) -> vec4f {
  if (side > ${ORTHO_CLIP}.5) { return textureSampleGrad(imgTex2k, orthoSamp, uv, ${ORTHO_2K_LAYER0}u + k, gx, gy); }
  return textureSampleGrad(orthoTex, orthoSamp, uv, k, gx, gy);
}
// (a relief level's window: its side — P.tileL[2l + 1].w's low bits —, its corner within it — P.tileL[2l].zw under the mask)
fn tileImgUv(l: u32, p: vec2f) -> vec3f {
  let w = f32(u32(P.tileL[2u * l + 1u].w) & 0xffffu);
  let c = vec2f(vec2u(P.tileL[2u * l].zw) & vec2u(u32(w) - 1u));
  return vec3f((c + p) / w, w);
}
fn tileImgAt(l: u32, p: vec2f, lod: f32) -> vec4f {
  let u = tileImgUv(l, p);
  let m = min(lod, ${ORTHO_MIPS - 1}.0);
  if (u.z > ${ORTHO_CLIP}.5) { return textureSampleLevel(imgTex2k, orthoSamp, u.xy, l - ${FINE_Z - Z0}u, m); }
  return textureSampleLevel(orthoTex, orthoSamp, u.xy, ${IMG_LAYER0}u + l, m);
}
// (T9c: the night's lights at uv — the tiles' place from their anchor, earthImagery's (dlon, −dM) —: the finest of z 6 … 8 there,
// filtered from their layers)
fn tileLightsAt(uv: vec2f) -> f32 {
  for (var k = 0u; k < ${GIBS_Z1 - Z0 + 1}u; k++) {
    let l = ${GIBS_Z1 - Z0}u - k;
    let a = P.tileL[2u * l];
    let b = P.tileL[2u * l + 1u];
    if (b.w < 0.5) { continue; }
    let p = a.xy + uv * b.z;
    if (min(min(p.x, p.y), min(b.x - p.x, b.y - p.y)) <= 2.0) { continue; }
    let s = textureSampleLevel(orthoTex, orthoSamp, tileImgUv(l, p).xy, ${IMG_LIGHT0}u + l, 0.0);
    if (s.r > 0.5) { return s.a; }
  }
  return 0.0;
}
fn tileImgGrad(l: u32, p: vec2f, gx: vec2f, gy: vec2f) -> vec4f {
  let u = tileImgUv(l, p);
  if (u.z > ${ORTHO_CLIP}.5) { return textureSampleGrad(imgTex2k, orthoSamp, u.xy, l - ${FINE_Z - Z0}u, gx / u.z, gy / u.z); }
  return textureSampleGrad(orthoTex, orthoSamp, u.xy, ${IMG_LAYER0}u + l, gx / u.z, gy / u.z);
}
`,
  );
}
/** the mips' pass: a tile's region of a mip drawn from the one above — the sRGB decoded, the coverage-premultiplied colour and
 *  the coverage averaged in linear light, encoded again. A render pass, not a compute one: a texture with storage usage
 *  takes no sRGB view (WebGPU), the view the tracer filters through */
export const ORTHO_MIP_WGSL = /* wgsl */ `
@group(0) @binding(0) var<uniform> layer: vec4u;
@group(0) @binding(1) var src: texture_2d_array<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32(i & 1u) * 4.0 - 1.0, f32(i >> 1u) * 4.0 - 1.0, 0.0, 1.0);
}
fn lin(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
fn srgb(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let d = vec2u(p.xy);
  var c = vec4f(0.0);
  for (var j = 0u; j < 4u; j++) {
    let t = textureLoad(src, vec2i(2u * d + vec2u(j & 1u, j >> 1u)), i32(layer.x), 0);
    c += vec4f(lin(t.rgb), t.a);
  }
  c *= 0.25;
  return vec4f(srgb(c.rgb), c.a);
}`;

/** Mercator's y [tiles, 0 at the north edge] of a latitude's sine, at a level of n tiles. */
const mercY = (sinLat: number, n: number) => (0.5 - Math.atanh(Math.min(Math.max(sinLat, -0.999999), 0.999999)) / TAU) * n;

/** tiles [x0, x1) × [y0, y1), x unwrapped (the date line: x0 < 0 or x1 > n) */
/** (T4) a change of what a level draws: its z (−1: every level), the box it touched — the old rectangle and the new — in
 *  longitude (unwrapped) and latitude [rad], its order */
export interface TileChange {
  z: number;
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
  seq: number;
}
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
  /** its window's tiles a side: ORTHO_SPAN, or ORTHO_SPAN_BIG (z 15–16 at a far reach — T8e) */
  span: number;
  want: Rect | null;
  valid: Rect | null;
  key: (string | null)[];
}

/**
 * The tiles' work on the page's thread (T8 — the plan's "no long task of the main thread due to the tiles"): each kind's
 * total and its longest piece [ms], the pieces counted — the decoding (a bitmap drawn and read back, Terrarium's heights),
 * the colours (EOX's and the orthophotos' fits, the lights), the writes (put: the texels packed and sent). EarthTiles.cpu.
 */
export const TILE_CPU = {
  decode: { ms: 0, max: 0, n: 0 },
  colour: { ms: 0, max: 0, n: 0 },
  put: { ms: 0, max: 0, n: 0 },
  worker: { ms: 0, max: 0, n: 0 },
};
/** (the decode worker's own time: off the page's thread — TILE_CPU.worker) */
function cpuOf(kind: keyof typeof TILE_CPU, t0: number) {
  const ms = performance.now() - t0,
    c = TILE_CPU[kind];
  c.ms += ms;
  c.n++;
  if (ms > c.max) c.max = ms;
}

/**
 * The decode worker (T8a, tile-decode-worker.js): the tiles' bitmaps read back, Terrarium's heights, the imagery's colours — off
 * the page's thread (they took 1.6 s of it in 25 s of a low flight over Paris, a tile's colours up to 9 ms). One for the page,
 * its replies by id; none (the tests, a worker refused or failed): the same work in the page.
 */
let decoder: Worker | null | undefined;
const decodeWaiting = new Map<number, { ok: (r: DecodeReply) => void; no: (e: Error) => void }>();
let decodeId = 1;
function decodeWorker(): Worker | null {
  if (decoder !== undefined) return decoder;
  decoder = null;
  if (typeof Worker === "undefined" || typeof location === "undefined") return null;
  try {
    const w = new Worker(new URL("tile-decode-worker.js", location.href), { type: "module" });
    w.onmessage = (e: MessageEvent<DecodeReply>) => decodeWaiting.get(e.data.id)?.ok(e.data);
    w.onerror = (e) => {
      // (failed: the waiting ones refused — their tiles asked again —, the work in the page from now)
      console.warn("Tile decode worker failed — decoding in the page:", e.message);
      decoder = null;
      for (const [, q] of decodeWaiting) q.no(new Error("decode worker failed"));
      decodeWaiting.clear();
    };
    decoder = w;
  } catch {
    decoder = null;
  }
  return decoder;
}
type DecodeAsk = DecodeRequest extends infer Q ? (Q extends { id: number } ? Omit<Q, "id"> : never) : never;
async function decodeOff(q: DecodeAsk): Promise<{ heights?: Float32Array; words?: Uint32Array }> {
  const w = decodeWorker();
  if (!w) {
    const t0 = performance.now();
    const r = await decodeTile({ ...q, id: 0 } as DecodeRequest);
    cpuOf(q.op === "terrarium" ? "decode" : "colour", t0);
    return r;
  }
  const id = decodeId++;
  const r = await new Promise<DecodeReply>((ok, no) => {
    decodeWaiting.set(id, { ok, no });
    w.postMessage({ ...q, id });
  });
  decodeWaiting.delete(id);
  const c = TILE_CPU.worker;
  c.ms += r.ms;
  c.n++;
  if (r.ms > c.max) c.max = r.ms;
  if (r.error) throw new Error(r.error);
  return r;
}

/** A tile's pixels (rgba, row by row), as they are in its file — or a square of it (x, y, side [px]) enlarged (tile-decode.ts;
 *  timed: the page's thread draws the bitmap and reads it back) */
export async function pixels(blob: Blob, crop?: [number, number, number]): Promise<Uint8ClampedArray> {
  const t0 = performance.now();
  const px = await decodePixels(blob, crop);
  cpuOf("decode", t0);
  return px;
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
  known?: Float32Array,
): Promise<{ h: Float32Array; over: Float32Array | null } | null> {
  // (the ground and — far levels, I6 — the surface over it asked together: each its own chain, one after the other a tile
  // took two to four of the gate's turns in a row; the ground known — a first pass's —: the surface alone)
  const ground = async () => {
    if (known) return known;
    let h = z >= IGN_LIDAR_Z ? await ignGrid(IGN_LIDAR, z, x, y, signal) : null;
    if (!h || h.some((e) => Number.isNaN(e))) {
      const r = await ignGrid(IGN_RGEALTI, z, x, y, signal);
      if (!h) h = r;
      else if (r) for (let i = 0; i < h.length; i++) if (Number.isNaN(h[i]!)) h[i] = r[i]!;
    }
    return h;
  };
  const n = hlodSize(z);
  const surface = async () => {
    if (!hlod || z > HLOD_Z1) return null;
    let s = await ignGrid(IGN_MNS_LIDAR, z, x, y, signal, n);
    let holes = 0;
    if (s) for (const v of s) if (Number.isNaN(v)) holes++;
    if (!s || holes > 0.02 * s.length) {
      const r = await ignGrid(IGN_MNS_RGE, z, x, y, signal, n);
      if (!s) s = r;
      else if (r) for (let i = 0; i < s.length; i++) if (Number.isNaN(s[i]!)) s[i] = r[i]!;
    }
    return s;
  };
  const [h, s] = await Promise.all([ground(), surface()]);
  if (!h) return null;
  return { h, over: s ? overground(h, s, n) : null };
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
 * (Terrarium) where it has none; its overground, when it has one, after them — one array (drawnHeight). `ground`: the
 * tile's ground already in (refine's first pass) — its surface alone asked.
 */
async function nationalHeights(
  src: NationalSource,
  z: number,
  x: number,
  y: number,
  signal: AbortSignal,
  hlod = false,
  ground?: Float32Array,
): Promise<Float32Array> {
  if (ground) {
    const r = await src.heights(z, x, y, signal, hlod, ground.subarray(0, TILE * TILE));
    if (!r?.over) return ground;
    const both = new Float32Array(2 * TILE * TILE);
    both.set(ground.subarray(0, TILE * TILE));
    both.set(r.over, TILE * TILE);
    return both;
  }
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
  return (await decodeOff({ op: "terrarium", blob })).heights!;
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
  /** the tiles' work on the page's thread (TILE_CPU): each kind's total and longest piece [ms], their count */
  get cpu() {
    return TILE_CPU;
  }
  /** T9a–T9b: the imagery's filtered textures — the 1024² one (the orthophotos, the relief levels' 1024² windows), the 2048²
   *  one (their 2048² windows; a 1 × 1 stand-in at the normal reach) — and their mips' pass */
  readonly orthoTexture: GPUTexture;
  imagery2k: GPUTexture;
  private orthoMip: { pipeline: GPURenderPipeline; uniform: GPUBuffer } | null = null;
  /** the levels' windows' tiles a side up to z 14 (TILE_REACH: 4, 8), the texture's side in texels its CLIP */
  private span = SPAN;
  /** the most the device holds (a farther reach's 256 MiB texture refused: back to SPAN, not asked again) */
  private spanMax = 8;
  private get clip() {
    return TILE * this.span;
  }
  private levelSpan(z: number) {
    // (the IGN's finest relief, z 15 … 17: windows of 4 tiles whatever the reach — 3.4 km down to 850 m at 46°; z 11 … 14 the
    // reach's; the coarser ones 4: z 9's 4 tiles reach as far as z 10's 8 would — 312 km —, a pixel there over 100 m of ground;
    // 8 at z 6 … 10 were 240 tiles more for nothing seen, every window's completion twice as long (kerr-mini, 2 Nov 2026))
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
  /** the tiles drawn from the global data while their national source's heights come (refine) */
  private refining = new Map<string, { ctl: AbortController; L: Level; x: number; y: number; surface: boolean }>();
  private nationalActive = 0;
  private nationalQueue: { p: number; go: () => void }[] = [];
  private failures = new Map<string, { n: number; at: number }>();
  /** bumped at a switch of the sources: a load begun before it is dropped */
  private gen = 0;
  /** the reference (the camera's place) [rad]: the levels' coordinates measured from it */
  private lon = 0;
  private sinLat = 0;
  /** bumped when what the tracer draws changes (a level's valid rectangle) */
  stamp = 0;
  /** (T4) the changes behind the stamps, the last ones kept (the relief cache reads those it has not seen: a level baked
   *  again at once only where the change shows in the ring it draws) */
  changes: TileChange[] = [];
  private changeSeq = 0;
  /** logs a change of a level's drawn rectangle(s), its box from both (z −1: everything) */
  private logChange(z: number, a: Rect | null, b: Rect | null) {
    this.changeSeq++;
    const n = 2 ** z;
    const box = (r: Rect) => ({
      lon0: (r.x0 / n) * TAU - Math.PI,
      lon1: (r.x1 / n) * TAU - Math.PI,
      lat0: Math.atan(Math.sinh(Math.PI * (1 - (2 * r.y1) / n))),
      lat1: Math.atan(Math.sinh(Math.PI * (1 - (2 * r.y0) / n))),
    });
    const rs = [a, b].filter((r): r is Rect => !!r).map(box);
    const c: TileChange =
      z < 0 || !rs.length
        ? { z: -1, lon0: -Infinity, lon1: Infinity, lat0: -Math.PI / 2, lat1: Math.PI / 2, seq: this.changeSeq }
        : {
            z,
            lon0: Math.min(...rs.map((r) => r.lon0)),
            lon1: Math.max(...rs.map((r) => r.lon1)),
            lat0: Math.min(...rs.map((r) => r.lat0)),
            lat1: Math.max(...rs.map((r) => r.lat1)),
            seq: this.changeSeq,
          };
    this.changes.push(c);
    if (this.changes.length > 256) this.changes.splice(0, this.changes.length - 256);
  }
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

  /** where each level and orthophotos' level lives in the texture (tileLayout) */
  private layout: ReturnType<typeof tileLayout> = { levels: [], layers: 0 };
  /** the texture's bytes; those of the textures alive (an old one kept until the work submitted with it is done — setReach);
   *  the most they reached (T10: the peak budget beside the resident one) */
  textureBytes = 0;
  private liveBytes = 0;
  peakBytes = 0;

  /**
   * filtered: the tracer reads the imagery's filtered textures (the device takes them — ORTHO_TEXTURE_LIMIT): the relief's
   * texture then its heights alone (r32uint — T9c: half the bytes), the night's lights in the 1024² texture; else as before T9
   * (rg32uint, heights and packed imagery), the filtered textures 1 × 1 stand-ins
   */
  constructor(
    private device: GPUDevice,
    readonly filtered = false,
  ) {
    this.texture = this.makeTexture();
    this.imagery2k = this.makeImagery2k(1);
    this.orthoTexture = device.createTexture({
      size: filtered ? [ORTHO_CLIP, ORTHO_CLIP, IMG_1K_LAYERS] : [1, 1, IMG_1K_LAYERS],
      format: "rgba8unorm",
      viewFormats: ["rgba8unorm-srgb"],
      mipLevelCount: filtered ? ORTHO_MIPS : 1,
      // (no storage usage: it would forbid the sRGB view the tracer filters through — the mips drawn by a render pass)
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      label: "orthophotos",
    });
    if (filtered) this.liveBytes += ORTHO_BYTES;
    this.peakBytes = Math.max(this.peakBytes, this.liveBytes);
    for (let k = 0; k < ORTHO_LEVELS; k++)
      this.ortho.push({
        z: ORTHO_Z0 + k,
        n: 2 ** (ORTHO_Z0 + k),
        span: ORTHO_SPAN,
        want: null,
        valid: null,
        key: new Array(ORTHO_SPAN ** 2).fill(null),
      });
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

  /** the 2048² imagery texture (its layers z FINE_Z … 14), or a 1 × 1 stand-in (side 1: the normal reach's) */
  private makeImagery2k(side: number) {
    return this.device.createTexture({
      size: [side, side, IMG_2K_LAYERS],
      format: "rgba8unorm",
      viewFormats: ["rgba8unorm-srgb"],
      mipLevelCount: side > 1 ? ORTHO_MIPS : 1,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      label: "imagery 2048",
    });
  }

  private makeTexture() {
    // (the relief's levels — tileLayout)
    this.layout = tileLayout(
      this.clip,
      Array.from({ length: LEVELS }, (_, l) => TILE * this.levelSpan(Z0 + l)),
    );
    const t = this.device.createTexture({
      size: [this.clip, this.clip, this.layout.layers],
      format: this.filtered ? "r32uint" : "rg32uint",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: "earth tiles",
    });
    this.textureBytes = this.clip * this.clip * this.layout.layers * (this.filtered ? 4 : 8);
    this.liveBytes += this.textureBytes;
    this.peakBytes = Math.max(this.peakBytes, this.liveBytes);
    return t;
  }

  /**
   * The detail's reach (TILE_REACH): the fine levels' windows' tiles a side — another one, the texture made again (the
   * old one destroyed once the work submitted with it is done) and every level drawn anew, its tiles from the cache or
   * loaded again —, the tiles kept past them, the ring loaded ahead. A texture the device cannot hold (out of memory:
   * an iPad's 256 MiB — the 2048² texture 224 MiB since T10, 416 MiB before) falls back to 4 tiles, and stays there.
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
    const old2k = this.imagery2k;
    // (the old texture's own bytes — not the orthophotos' texture's, alive throughout)
    const oldBytes = this.textureBytes;
    this.device.pushErrorScope?.("out-of-memory");
    this.texture = this.makeTexture();
    // (the 2048² imagery for the fine levels' 8-tile windows — T9b —, a stand-in at the normal reach)
    const big = span > SPAN && this.filtered;
    this.imagery2k = this.makeImagery2k(big ? 2 * ORTHO_CLIP : 1);
    const imgBytes = big ? IMG_2K_BYTES : 0;
    this.liveBytes += imgBytes;
    this.peakBytes = Math.max(this.peakBytes, this.liveBytes);
    void this.device.popErrorScope?.().then((e) => {
      if (!e || this.span === SPAN) return;
      console.warn(`Terrain tiles: the ${this.clip}² texture refused (${e.message}) — the detail's reach kept at ${SPAN} tiles`);
      this.spanMax = SPAN;
      this.setReach({ span: SPAN, cache: this.cacheTiles, ring: this.ring });
    });
    const old2kBytes = old2k.width > 1 ? IMG_2K_BYTES : 0;
    void this.device.queue.onSubmittedWorkDone().then(() => {
      old.destroy();
      old2k.destroy();
      this.liveBytes -= oldBytes + old2kBytes;
    });
    // (the orthophotos' z 15–16 in 8-tile windows of the 2048² texture at a far reach — T8e —, 4-tile ones of the 1024² else)
    for (const [k, O] of this.ortho.entries()) {
      O.span = big && k < ORTHO_BIG_LEVELS ? ORTHO_SPAN_BIG : ORTHO_SPAN;
      O.key = new Array(O.span ** 2).fill(null);
      O.valid = null;
      O.want = null;
    }
    for (const L of this.levels) {
      L.span = this.levelSpan(L.z);
      L.key = new Array(L.span * L.span).fill(null);
      L.data = new Array(L.span * L.span).fill(null);
      L.col = new Array(L.span * L.span).fill(null);
    }
    this.stamp++;
    this.logChange(-1, null, null);
    this.onResize?.();
  }

  /** a tile's slot in its level's window (x mod span, y mod span) */
  private slotOf(L: Level, x: number, y: number) {
    const n = L.span;
    return (((y % n) + n) % n) * n + (((x % n) + n) % n);
  }

  /** a level wanted whose halo is loaded ahead and whose tiles are kept as its window leaves them */
  private ringLevel(L: Level) {
    return !!this.ring && !!L.want;
  }

  /** when the halo is looked over next [ms] (request) */
  private haloAt = 0;
  /** the motion's direction on the tiles' plane (unit; null still): the halo led along it (update) */
  private leadDir: [number, number] | null = null;
  /**
   * A tile's distance from the lead point (the camera led along its motion), in its own level's tiles — so every level's
   * rings come in turn, the coarse levels' far relief as early as the fine ones' near detail —, counted (1 − HALO_LEAD) as far
   * ahead, (1 + HALO_LEAD) behind.
   */
  private cost(L: Level, x: number, y: number, cx: number, cy: number) {
    let dx = x + 0.5 - cx;
    dx -= Math.round(dx / L.n) * L.n;
    const dy = y + 0.5 - cy;
    const d = Math.hypot(dx, dy);
    const u = this.leadDir;
    return u && d > 1e-9 ? d * (1 - (HALO_LEAD * (dx * u[0] + dy * u[1])) / d) : d;
  }

  /** a tile kept past the windows (past cacheTiles, the farthest behind dropped — cost) */
  private keep(key: string, h: Float32Array, col: Uint32Array | null) {
    if (!this.cacheTiles) return;
    const was = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, { h, col: col ?? was?.col ?? null });
    if (this.cache.size <= this.cacheTiles) return;
    const lonT = cx0(this.priorityLon);
    while (this.cache.size > this.cacheTiles) {
      let worst = "",
        most = -1;
      for (const k of this.cache.keys()) {
        const [z, x, y] = k.split("/").map(Number) as [number, number, number];
        const L = this.levels[z - Z0];
        const c = L ? this.cost(L, x, y, lonT * L.n, mercY(this.prioritySinLat, L.n)) : Infinity;
        if (c > most) {
          most = c;
          worst = k;
        }
      }
      this.cache.delete(worst);
    }
  }

  /** the tiles kept in memory past the windows (the detail's reach: the left ones, the ring loaded ahead) */
  get kept() {
    return this.cache.size;
  }

  /** the tiles wanted and not yet in — their national source's heights included (refine) */
  get pending() {
    let k = 0;
    // (the far silhouettes' second pass not counted: the tile's IGN ground is in — the waits for the ground, the e2e's too, not
    // held for an enrichment that comes last on purpose)
    for (const [key, r] of this.refining) if (!r.surface && r.L.key[this.slotOf(r.L, r.x, r.y)] === key) k++;
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
        for (let x = O.want.x0; x < O.want.x1; x++) if (O.key[orthoSlot(O.span, x, y)] !== this.orthoKey(O, x, y)) k++;
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
    this.logChange(L.z, L.valid, r);
    L.valid = r;
    this.stamp++;
    this.onChange?.();
  }

  /** Drops every level (the Earth far, or the tiles switched off). */
  clear() {
    for (const c of this.inflight.values()) c.abort();
    this.inflight.clear();
    for (const r of this.refining.values()) r.ctl.abort();
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
    swGateCheck();
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
      for (const r of this.refining.values()) r.ctl.abort();
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
    // (the motion's direction on the tiles' plane — Mercator's: conformal, the same at every level)
    let ux = (ahead.lon - g.lon) / TAU;
    ux -= Math.round(ux);
    const uy = mercY(this.prioritySinLat, 1) - mercY(this.sinLat, 1);
    const ul = Math.hypot(ux, uy);
    this.leadDir = ul > 1e-12 ? [ux / ul, uy / ul] : null;
    this.request(cx0(this.priorityLon), this.prioritySinLat);
  }

  /**
   * Starts the loads: the level with the fewest tiles still missing from its window first (T8h: a level is drawn only whole —
   * the levels then drawn one after the other), ties to the finer, the nearest of its tiles first (cost: led along the
   * motion); the windows whole, the
   * halo round them into memory (ringLevel, TILE_REACH ring), while it has room.
   */
  private request(lonT: number, sinLat: number) {
    const now = performance.now();
    const todo: [Level, number, number, number][] = [];
    // (T8h: each level's tiles still missing from its window — in flight included: a level is drawn only once its whole window
    // is in (complete), so the one nearest to it goes first — the levels drawn one after the other, not all at the end)
    const missing = new Map<Level, number>();
    for (const L of this.levels) {
      // (a window drawn whole: nothing to look for — not its tiles' keys made again each frame —, unless taken again)
      if (!L.want || (same(L.valid, L.want) && !L.stale)) continue;
      const cx = lonT * L.n,
        cy = mercY(sinLat, L.n);
      let m = 0;
      for (let y = L.want.y0; y < L.want.y1; y++) {
        for (let x = L.want.x0; x < L.want.x1; x++) {
          const key = this.keyOf(L, x, y);
          if (L.key[this.slotOf(L, x, y)] === key) continue;
          m++;
          if (this.inflight.has(key)) continue;
          // (kept past the window — walked back to, or loaded ahead —: drawn at once)
          const kept = this.cache.get(key);
          if (kept) {
            this.cache.delete(key);
            this.put(L.z, x, y, kept.h, kept.col);
            continue;
          }
          const f = this.failures.get(key);
          if (f && now < f.at) continue;
          todo.push([L, x, y, this.cost(L, x, y, cx, cy)]);
        }
      }
      missing.set(L, m);
    }
    // (the loads limited, not what memory holds: every level's kept tiles drawn at once; the level nearest to whole first —
    // ties to the finer: the ground near the eye fills most of the view, the coarsest levels a strip at the horizon —, the
    // nearest of its tiles first)
    todo.sort((a, b) => missing.get(a[0])! - missing.get(b[0])! || b[0].z - a[0].z || a[3] - b[3]);
    for (const [L, x, y] of todo) {
      if (this.inflight.size >= MAX_INFLIGHT) break;
      void this.load(L, x, y);
    }
    this.requestOrtho(lonT, sinLat);
    // (the windows whole: the halo — every level's rings round its window, out to TILE_REACH's ring — loaded ahead into
    // memory, half the loads at most, while the memory has room: the tiles the windows enter as the craft goes on drawn at
    // once, and kept by the Service Worker for the next flight)
    if (todo.length || !this.ring || this.inflight.size >= MAX_INFLIGHT / 2 || this.cache.size >= this.cacheTiles) return;
    // (nor while the windows' national heights are still coming: the halo's loads took their bandwidth — kerr-mini cold, the
    // IGN's far levels 118 s against 68 before it)
    for (const [key, r] of this.refining) if (r.L.key[this.slotOf(r.L, r.x, r.y)] === key) return;
    // (its thousands of candidates looked over four times a second at most — up to sixteen loads a second, every frame else)
    if (now < this.haloAt) return;
    this.haloAt = now + 250;
    const halo: [Level, number, number, number][] = [];
    const R = this.ring;
    for (const L of this.levels) {
      const w = L.want;
      if (!w || !this.ringLevel(L)) continue;
      const cx = lonT * L.n,
        cy = mercY(sinLat, L.n);
      for (let y = Math.max(w.y0 - R, 0); y <= Math.min(w.y1 - 1 + R, L.n - 1); y++)
        for (let x = w.x0 - R; x <= w.x1 - 1 + R; x++) {
          if (inside(w, x, y)) continue;
          const key = this.keyOf(L, x, y);
          if (this.cache.has(key) || this.inflight.has(key)) continue;
          const f = this.failures.get(key);
          if (f && now < f.at) continue;
          halo.push([L, x, y, this.cost(L, x, y, cx, cy)]);
        }
    }
    halo.sort((a, b) => a[3] - b[3] || a[0].z - b[0].z);
    for (const [L, x, y] of halo) {
      if (this.inflight.size >= MAX_INFLIGHT / 2 || this.cache.size + this.inflight.size >= this.cacheTiles) return;
      void this.load(L, x, y, true);
    }
  }

  /**
   * A tile's national heights (the IGN's, swisstopo's) over the global data's drawn — in its window, or kept past it —,
   * MAX_NATIONAL at once, the nearest and finest first (p: its distance in the level's tiles, plus one, over their count);
   * none if it is no longer wanted when its turn comes, the global data's kept if they will not come.
   */
  private async refine(
    L: Level,
    x: number,
    y: number,
    key: string,
    src: NationalSource,
    img: Promise<Uint32Array | null>,
    p: number,
    ground?: Float32Array,
  ): Promise<void> {
    const gen = this.gen;
    const ctl = new AbortController();
    this.refining.get(key)?.ctl.abort();
    this.refining.set(key, { ctl, L, x, y, surface: !!ground });
    const wanted = () => gen === this.gen && !ctl.signal.aborted && (L.key[this.slotOf(L, x, y)] === key || this.cache.has(key));
    let nextPass: Float32Array | null = null;
    if (this.nationalActive < MAX_NATIONAL) this.nationalActive++;
    else await new Promise<void>((go) => this.nationalQueue.push({ p, go }));
    try {
      if (!wanted()) return;
      const timer = setTimeout(() => ctl.abort(), NATIONAL_TIMEOUT_MS);
      // (two passes: every tile's ground first, its far silhouettes' surface — I6, z 11 … 13, two or three 512² grids — after
      // every ground, over it: the near relief no longer queued behind the far one's; kerr-mini cold, 2 Nov 2026)
      const surface = this.hlodOn && L.z <= HLOD_Z1;
      let h: Float32Array;
      try {
        h = await nationalHeights(src, L.z, ((x % L.n) + L.n) % L.n, y, ctl.signal, !!ground, ground);
      } finally {
        clearTimeout(timer);
      }
      const col = await img.catch(() => null);
      if (gen !== this.gen) return;
      if (L.key[this.slotOf(L, x, y)] === key) this.put(L.z, x, y, h, col);
      else if (this.cache.has(key)) this.keep(key, h, col);
      if (!ground && surface && src.id === "ign") nextPass = h;
    } catch {
      // (refused, timed out, dropped: the global data's stay)
    } finally {
      // (the slot handed to the nearest waiting)
      const q = this.nationalQueue;
      if (q.length) {
        let k = 0;
        for (let i = 1; i < q.length; i++) if (q[i]!.p < q[k]!.p) k = i;
        q.splice(k, 1)[0]!.go();
      } else this.nationalActive--;
      if (this.refining.get(key)?.ctl === ctl) this.refining.delete(key);
    }
    if (nextPass && gen === this.gen) await this.refine(L, x, y, key, src, img, 1 + p, nextPass);
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
    // (over France the IGN's heights — the global data's where it has none —: Terrarium's drawn first, at once, the IGN's
    // over them as they come — their own queue, its rate's gate: before, every French tile from z 11 waited for two or three
    // of its grids in the global data's eight slots, the ground stuck at z 10 for 12 s and whole after 75 s (2 Nov 2026,
    // PLAN-REFRACTION-HORIZONS T8))
    const national = this.reliefOn && src && L.z >= src.heightsFrom ? src : null;
    let refineAfter: NationalSource | null = null;
    try {
      const heights = await terrarium(L.z, xw, y, ctl.signal);
      // (begun before a switch of the sources: the old source's — the slot waits for the new one's)
      if (gen !== this.gen) return;
      h = heights;
      this.loaded++;
      // (the national heights asked once the global data's are drawn — or kept —: refine finds the tile wanted)
      if (national) refineAfter = national;
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
    if (refineAfter) {
      const cx = cx0(this.priorityLon) * L.n,
        cy = mercY(this.prioritySinLat, L.n);
      void this.refine(L, x, y, key, refineAfter, img, (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 1) / L.n);
    }
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
    const t0 = performance.now();
    try {
      this.putTile(L, z, x, y, h, col);
    } finally {
      cpuOf("put", t0);
    }
  }
  private putTile(L: Level, z: number, x: number, y: number, h: Float32Array, col: Uint32Array | null) {
    const s = this.slotOf(L, x, y);
    // (the ring's levels: the tile the window leaves kept past it — walked back to, drawn from memory —, this one's
    // imagery held for when it leaves in turn)
    const ringLevel = this.ringLevel(L);
    const old = L.key[s];
    if (ringLevel && old && old !== this.keyOf(L, x, y) && L.data[s]) this.keep(old, L.data[s]!, L.col[s] ?? null);
    L.col[s] = ringLevel ? (col ?? (old === this.keyOf(L, x, y) ? (L.col[s] ?? null) : null)) : null;
    if (col && inside(L.valid, x, y) && L.key[s] === this.keyOf(L, x, y)) this.imagery++;
    // (the same tile's heights again, drawn already — the IGN's over the Terrarium's, the far silhouettes' overground on its
    // ground —: logged, the relief cache's rings over it baked again; only the rectangle's changes were, the cache kept the
    // first heights — a city's SRTM, its blocks' tops — until a window moved)
    if (old === this.keyOf(L, x, y) && inside(L.valid, x, y)) this.logChange(L.z, { x0: x, x1: x + 1, y0: y, y1: y + 1 }, null);
    L.key[s] = this.keyOf(L, x, y);
    L.data[s] = h;
    const hb = new Uint32Array(h.buffer, h.byteOffset, TILE * TILE);
    // (the heights alone where the imagery is filtered — T9c, r32uint —, with the packed imagery else)
    const per = this.filtered ? 1 : 2;
    const texels = new Uint32Array(per * TILE * TILE);
    // (an overground drawn on its ground — I6 —, the ground's source mark kept in the sum's last bit)
    const over = h.length > TILE * TILE ? h.subarray(TILE * TILE) : null;
    for (let i = 0; i < hb.length; i++) {
      if (over && over[i]! > 0) {
        BITS[0] = h[i]! + over[i]!;
        texels[per * i] = (BITS_U[0]! & ~1) | (hb[i]! & 1);
      } else texels[per * i] = hb[i]!;
      if (per === 2) texels[2 * i + 1] = col ? col[i]! : 0;
    }
    this.putImagery(L, s, col);
    const slot = this.layout.levels[L.z - Z0]!;
    this.device.queue.writeTexture(
      {
        texture: this.texture,
        origin: [slot.x + (s % L.span) * TILE, slot.y + Math.floor(s / L.span) * TILE, slot.layer],
      },
      texels,
      { bytesPerRow: TILE * 4 * per },
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
    let whole = true;
    for (let y = w.y0; y < w.y1 && whole; y++)
      for (let x = w.x0; x < w.x1; x++)
        if (L.key[this.slotOf(L, x, y)] !== this.keyOf(L, x, y)) {
          whole = false;
          break;
        }
    if (!whole) {
      // (T8i: the window not whole yet — drawn already over the largest rectangle of its tiles in round the camera's, when it
      // covers more than what is drawn: the levels come out from the eye as their tiles come, not all at once at the end; the
      // tracer reads a rectangle smaller than its window as after a move — its edges faded —, the CPU the same)
      if (!L.stale) {
        const r = this.loadedRect(L, w);
        const area = (q: Rect | null) => (q ? (q.x1 - q.x0) * (q.y1 - q.y0) : 0);
        if (r && area(r) > area(L.valid)) this.setValid(L, r);
      }
      return;
    }
    // (taken again whole after a switch: its rectangle the same, its heights not — the ground built from them redone)
    if (L.stale && same(L.valid, w)) {
      L.stale = false;
      this.logChange(L.z, w, null);
      this.stamp++;
      this.onChange?.();
      return;
    }
    L.stale = false;
    this.setValid(L, w);
  }

  /** The largest rectangle of a window's tiles all in that holds the camera's tile (null: that tile not in). */
  private loadedRect(L: Level, w: Rect): Rect | null {
    const nx = w.x1 - w.x0,
      ny = w.y1 - w.y0;
    const fx = Math.min(Math.max(Math.floor((this.lon / TAU + 0.5) * L.n) - w.x0, 0), nx - 1);
    const fy = Math.min(Math.max(Math.floor(mercY(this.sinLat, L.n)) - w.y0, 0), ny - 1);
    const ok = (i: number, j: number) => L.key[this.slotOf(L, w.x0 + i, w.y0 + j)] === this.keyOf(L, w.x0 + i, w.y0 + j);
    if (!ok(fx, fy)) return null;
    // (every rectangle round the camera's tile — 8 × 8 tiles at most: a few thousand looks, at a tile's arrival)
    let best: Rect | null = null,
      most = 0;
    for (let j0 = fy; j0 >= 0 && ok(fx, j0); j0--)
      for (let j1 = fy; j1 < ny && ok(fx, j1); j1++)
        for (let i0 = fx; i0 >= 0; i0--) {
          let colOk = true;
          for (let j = j0; j <= j1 && colOk; j++) colOk = ok(i0, j);
          if (!colOk) break;
          for (let i1 = fx; i1 < nx; i1++) {
            let c = true;
            for (let j = j0; j <= j1 && c; j++) c = ok(i1, j);
            if (!c) break;
            const a = (i1 - i0 + 1) * (j1 - j0 + 1);
            if (a > most) {
              most = a;
              best = { x0: w.x0 + i0, y0: w.y0 + j0, x1: w.x0 + i1 + 1, y1: w.y0 + j1 + 1 };
            }
          }
        }
    return best;
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
      // (its quadrant's corner above the window's mask, its layer above 2¹⁶ — tileLayout, trace.wgsl tileAt)
      const at = this.layout.levels[l]!;
      f.set([ax, ay, at.x + ((((v.x0 * TILE) % C) + C) % C), at.y + ((((v.y0 * TILE) % C) + C) % C)], o);
      f.set([(v.x1 - v.x0) * TILE, (v.y1 - v.y0) * TILE, S / TAU, C + 65536 * at.layer], o + 4);
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
      const span = O.span;
      const most = span / 2 - 0.75;
      const k = gl > most ? most / gl : 1;
      const cx = cx0 + gx * k,
        cy = cy0 + gy * k;
      const mid = span / 2;
      let want = O.want;
      if (!want || Math.abs(cx - (want.x0 + mid)) > 0.8 || Math.abs(cy - (want.y0 + mid)) > 0.8) {
        const x0 = Math.round(cx) - mid,
          y0 = Math.min(Math.max(Math.round(cy) - mid, 0), O.n - span);
        want = { x0, y0, x1: x0 + span, y1: y0 + span };
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
          if (O.key[orthoSlot(O.span, x, y)] === key || this.orthoInflight.has(key)) continue;
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
        // (decoded and brought into the Blue Marble's colours off the page's thread — tile-decode.ts orthoWords)
        col = (await decodeOff({ op: "ortho", blob: await res.blob(), fit: src!.fit })).words ?? null;
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

  /** An orthophoto's tile into its window's slot (its imagery; null: none there — the coarser levels'): its level's layer of
   *  the orthophotos' texture, its mips made from it alone (T9a) */
  private putOrtho(z: number, x: number, y: number, col: Uint32Array | null) {
    const k = z - ORTHO_Z0;
    const O = this.ortho[k];
    if (!O || !inside(O.want, x, y)) return;
    const s = orthoSlot(O.span, x, y);
    O.key[s] = this.orthoKey(O, x, y);
    const ox = (s % O.span) * TILE,
      oy = Math.floor(s / O.span) * TILE;
    // (an 8-tile window — T8e —: the 2048² texture's layer, after the relief levels')
    const big = O.span > ORTHO_SPAN;
    const tex = big ? this.imagery2k : this.orthoTexture;
    const layer = big ? ORTHO_2K_LAYER0 + k : k;
    if (this.filtered && tex.width > 1) {
      this.device.queue.writeTexture(
        { texture: tex, origin: [ox, oy, layer] },
        (col ?? new Uint32Array(TILE * TILE)) as Uint32Array<ArrayBuffer>,
        { bytesPerRow: TILE * 4 },
        [TILE, TILE, 1],
      );
      this.orthoMips(ox, oy, layer, tex);
    }
    if (col) this.imagery++;
    this.orthoComplete(O);
  }

  /** A tile's mips in the orthophotos' texture (its region at each level, from the level above: never its neighbour's). */
  /** A tile's mips in an imagery texture (its region at each level, from the level above: never its neighbour's). */
  private orthoMips(ox: number, oy: number, layer: number, tex: GPUTexture = this.orthoTexture) {
    const d = this.device;
    if (!this.orthoMip) {
      const module = d.createShaderModule({ code: ORTHO_MIP_WGSL, label: "imagery mips" });
      const pipeline = d.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list" },
        label: "imagery mips",
      });
      // (a 256-byte slot a layer: its index — the source's layer)
      const n = Math.max(IMG_1K_LAYERS, IMG_2K_LAYERS);
      const uniform = d.createBuffer({ size: 256 * n, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const u = new Uint32Array(64 * n);
      for (let k = 0; k < n; k++) u[64 * k] = k;
      d.queue.writeBuffer(uniform, 0, u);
      this.orthoMip = { pipeline, uniform };
    }
    const m = this.orthoMip;
    const enc = d.createCommandEncoder({ label: "imagery mips" });
    for (let i = 1; i < ORTHO_MIPS; i++) {
      const n = TILE >> i;
      const group = d.createBindGroup({
        layout: m.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: m.uniform, offset: 256 * layer, size: 16 } },
          { binding: 1, resource: tex.createView({ dimension: "2d-array", baseMipLevel: i - 1, mipLevelCount: 1 }) },
        ],
      });
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: tex.createView({ dimension: "2d", baseMipLevel: i, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 }),
            loadOp: "load",
            storeOp: "store",
          },
        ],
        label: "imagery mips",
      });
      pass.setPipeline(m.pipeline);
      pass.setBindGroup(0, group);
      pass.setViewport(ox >> i, oy >> i, n, n, 0, 1);
      pass.setScissorRect(ox >> i, oy >> i, n, n);
      pass.draw(3);
      pass.end();
    }
    d.queue.submit([enc.finish()]);
  }

  /** A relief level's tile's imagery into its filtered texture (T9b): its window's layer — the 1024² texture's or the 2048²
   *  one's —, alpha its coverage (the night's lights stay in the relief texture's alpha), its mips; none: cleared */
  private putImagery(L: Level, s: number, col: Uint32Array | null) {
    if (L.z > IMG_Z1 || !this.filtered) return;
    const big = L.span * TILE > ORTHO_CLIP;
    const tex = big ? this.imagery2k : this.orthoTexture;
    if (big && tex.width <= 1) return;
    const layer = big ? L.z - FINE_Z : IMG_LAYER0 + (L.z - Z0);
    const ox = (s % L.span) * TILE,
      oy = Math.floor(s / L.span) * TILE;
    const px = new Uint32Array(TILE * TILE);
    if (col) for (let i = 0; i < px.length; i++) px[i] = col[i] ? (col[i]! | 0xff000000) >>> 0 : 0;
    this.device.queue.writeTexture({ texture: tex, origin: [ox, oy, layer] }, px, { bytesPerRow: TILE * 4 }, [TILE, TILE, 1]);
    this.orthoMips(ox, oy, layer, tex);
    // (T9c: the night's lights — GIBS's, z ≤ 8: their imagery's alpha — in their own layer, rgb the coverage; the relief's texture
    // holds the heights alone)
    if (L.z <= GIBS_Z1 && !big) {
      const lights = new Uint32Array(TILE * TILE);
      if (col) for (let i = 0; i < lights.length; i++) lights[i] = col[i] ? ((col[i]! & 0xff000000) | 0xffffff) >>> 0 : 0;
      const ll = IMG_LIGHT0 + (L.z - Z0);
      this.device.queue.writeTexture({ texture: tex, origin: [ox, oy, ll] }, lights, { bytesPerRow: TILE * 4 }, [TILE, TILE, 1]);
      this.orthoMips(ox, oy, ll, tex);
    }
  }

  private orthoComplete(O: OrthoLevel) {
    const w = O.want;
    if (!w) return;
    for (let y = w.y0; y < w.y1; y++)
      for (let x = w.x0; x < w.x1; x++) if (O.key[orthoSlot(O.span, x, y)] !== this.orthoKey(O, x, y)) return;
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
      // (its window's side [texels] — 1024 or, T8e, 2048: the tracer's texture and its coordinates' scale)
      const side = O.span * TILE;
      f.set([k, side, 0, O.z], 12 * k + 8);
      if (!v) continue;
      const S = O.n * TILE;
      let ax = (this.lon / TAU + 0.5) * S - v.x0 * TILE;
      if (ax > S / 2) ax -= S;
      else if (ax < -S / 2) ax += S;
      const ay = mercY(this.sinLat, O.n) * TILE - v.y0 * TILE;
      f.set([ax, ay, (((v.x0 * TILE) % side) + side) % side, (v.y0 * TILE) % side], 12 * k);
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
      const hz = sampleLevel(at, px, py, zf - L.z, texel);
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
    // (a file's bytes — the decoding the worker's —, a square of it to enlarge)
    type Got = { blob: Blob; crop: [number, number, number] | null };
    const get = async (url: string, crop?: [number, number, number]): Promise<Got> => {
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
          return { blob: await Promise.race([parentBlob(url), aborted]), crop };
        } finally {
          signal.removeEventListener("abort", stop);
        }
      }
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { blob: await res.blob(), crop: null };
    };
    // (finer than GIBS: EOX's day — over a national source's land its orthophotos instead (the IGN's, swisstopo's), the same
    // grid, EOX's where it has none; the lights' z 8 parent, the tile's square of it enlarged)
    const fine = z > GIBS_Z1;
    const night = nightOf(z, x, y);
    const day = async (): Promise<[Got, NationalSource | null]> => {
      if (fine && ortho)
        try {
          return [await get(ortho.orthoUrl(z, x, y)), ortho];
        } catch {
          if (signal.aborted) throw new Error("aborted");
        }
      return [await get(fine ? eoxUrl(z, x, y) : dayUrl(z, x, y)), null];
    };
    const [[d, photo], n] = await Promise.all([day(), get(nightUrl(night.z, night.x, night.y), night.crop ?? undefined)]);
    // (decoded and brought into the Blue Marble's colours off the page's thread — tile-decode.ts imageryWords)
    const r = await decodeOff({
      op: "imagery",
      day: d.blob,
      dayCrop: d.crop,
      night: n.blob,
      nightCrop: n.crop,
      fit: photo?.fit ?? null,
      fine,
    });
    return r.words ?? null;
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

/** an orthophotos' tile's slot in its window (span × span: 4, or 8 — T8e) */
export const orthoSlot = (span: number, x: number, y: number) => (((y % span) + span) % span) * span + (((x % span) + span) % span);
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

/** The relief's steepness [m/m] from which the tiles' cubic turns from the B-spline to the monotone one (trace.wgsl TILE_STEEP). */
export const TILE_STEEP = [0.3, 0.8] as const;
/** T1's pre-filter (trace.wgsl TUNE_TILE_PRE): the B-spline's nodes the texels' 3 × 3 binomial */
export const TILE_PRE = true;
const bspline4 = (t: number) => {
  const u = 1 - t;
  return [(u * u * u) / 6, (4 - 6 * t * t + 3 * t * t * t) / 6, (1 + 3 * t + 3 * t * t - 3 * t * t * t) / 6, (t * t * t) / 6];
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * A level's height at (px, py) [its pixels, from its rectangle's corner; texel its size, m]: bilinear, or — its texel more
 * than twice the footprint (mag: by how many octaves larger) — a cubic through its texels, the two blended over an octave
 * (trace.wgsl tileSample, the same): a B-spline where the relief is gentle — smooth over the global data's whole metres
 * (Terrarium's z ≤ 13, SRTM's rounding: its flats drawn as 1 m stairs by the monotone cubic alone — PLAN-REFRACTION-HORIZONS
 * T1) —, the monotone cubic where it is steep or a survey's (a cliff kept a cliff: the B-spline alone rounded Monument
 * Valley's buttes into domes); the share by the cell's four nodes' slopes and marks, blended across it.
 */
export function sampleLevel(at: (i: number, j: number) => number, px: number, py: number, mag: number, texel = 1) {
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
  // (6 × 6 texels from x0 − 2: the pre-filter's ring)
  const t: number[] = [];
  for (let j = 0; j < 6; j++)
    for (let i = 0; i < 6; i++) t.push(TILE_PRE || (i > 0 && i < 5 && j > 0 && j < 5) ? at(x0 + i - 2, y0 + j - 2) : 0);
  const node = (i: number, j: number) => {
    const c = 6 * (j + 1) + i + 1;
    if (!TILE_PRE) return t[c]!;
    // (a gentle node's alone — the steep and the surveyed keep their own: a butte's top not lowered by its foot)
    const blur = (4 * t[c]! + 2 * (t[c - 1]! + t[c + 1]! + t[c - 6]! + t[c + 6]!) + t[c - 7]! + t[c - 5]! + t[c + 5]! + t[c + 7]!) / 16;
    const g = (Math.max(Math.abs(t[c + 1]! - t[c - 1]!), Math.abs(t[c + 6]! - t[c - 6]!)) * 0.5) / Math.max(texel, 1e-3);
    const m = Math.max(smooth(TILE_STEEP[0], TILE_STEEP[1], g), isFine(t[c]!) ? 1 : 0);
    return blur + (t[c]! - blur) * m;
  };
  const wx = bspline4(fx),
    wy = bspline4(fy);
  let bs = 0;
  const rows: number[] = [];
  for (let j = 0; j < 4; j++) {
    bs += wy[j]! * (wx[0]! * node(0, j) + wx[1]! * node(1, j) + wx[2]! * node(2, j) + wx[3]! * node(3, j));
    const c = 6 * (j + 1) + 1;
    rows.push(monoCubic(t[c]!, t[c + 1]!, t[c + 2]!, t[c + 3]!, fx));
  }
  const mono = monoCubic(rows[0]!, rows[1]!, rows[2]!, rows[3]!, fy);
  // (the four nodes' steepness — the larger central difference of the texels — and their survey marks)
  const sn = [0, 1, 2, 3].map((n) => {
    const k0 = 6 * (2 + (n >> 1)) + 2 + (n & 1);
    const g = (Math.max(Math.abs(t[k0 + 1]! - t[k0 - 1]!), Math.abs(t[k0 + 6]! - t[k0 - 6]!)) * 0.5) / Math.max(texel, 1e-3);
    return Math.max(smooth(TILE_STEEP[0], TILE_STEEP[1], g), isFine(t[k0]!) ? 1 : 0);
  });
  const s = (sn[0]! * (1 - fx) + sn[1]! * fx) * (1 - fy) + (sn[2]! * (1 - fx) + sn[3]! * fx) * fy;
  const b = bs + (mono - bs) * s;
  return lin + (b - lin) * k;
}

/**
 * The tiles' coordinates (trace.wgsl tileCoord: longitude from the reference [rad], Mercator's y from it) of the camera's
 * anchor A — on the Earth's squashed axes [radii], float32 values (renderer params 67) —, in float64, from the reference as
 * the tracer has it (cos, sin of its longitude, sine of its latitude: float32): the raster's ground near the camera is read
 * from there plus its small offset (trace.wgsl tileAnchor) — a unit-sphere point in float32 is good to ~0.4 m only.
 */
export function anchorTileCoord(A: readonly number[], cosRef: number, sinRef: number, sinLatRef: number): [number, number] {
  // (geodetic: the squashed z stretched again — trace.wgsl geoQ, EARTH_AB as float32 —, at the anchor's height over the figure:
  // its radius's own geodetic direction taken back to the point's — ellipsoid.ts geodeticDirAt; the camera 2 km up, 7 m)
  const ab = Math.fround(1.0033640898209764);
  const r = Math.hypot(A[0]!, A[1]!, A[2]!);
  const q: [number, number, number] = [A[0]! / r, A[1]! / r, A[2]! / r];
  const s = geodeticDirAt(q, 1 - 1 / ab, (r - 1) * squashedScale(q, 1 - 1 / ab))[2];
  let dl = Math.atan2(A[1]!, A[0]!) - Math.atan2(sinRef, cosRef);
  dl -= TAU * Math.round(dl / TAU);
  return [dl, Math.atanh(s) - Math.atanh(sinLatRef)];
}
