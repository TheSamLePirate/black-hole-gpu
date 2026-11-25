// The ground under inland water made level at the relief's preparation (PLAN-PONT-ROUTES-AAA, 25 Nov 2026 — PROBLEMES « L'eau sous
// Cheviré »): a national survey's relief over a river is not the river's surface — LiDAR has no return from water, the models fill it
// with what they can: a bridge's deck or pier traced across the bed, a boat, a bank's leftovers —, and the Loire under Cheviré stood
// 3–5 m spikes and a 5 m ridge under the deck out of its water (kerr-mini, groundAt across it). Every reader of the ground — the
// raster's relief, the tracer's heights, the walker's and the wheels' contact, the water's own tests — reads the relief's tiles: their
// heights made level once, here, where they are prepared (earth-tiles.ts refine → the decode worker, tile-decode.ts "flatten"), one
// owner for all of them.
//
// The rule: the water's heights (its cover from OpenMapTiles' `water` polygons and `waterway` lines — water-mask.ts, the bridges NOT cut
// out: the bed under a deck is the river's) opened morphologically over a window of ±FLATTEN_RADIUS_M — a spike or a ridge narrower
// than the window taken down to the water about it, a hole kept and never spread, nothing raised; the banks (a texel under
// FLATTEN_COVER) as they are. Pure: the decode worker runs it, the tests too.

/** a tile's side [px] (earth-tiles.ts TILE) */
const TILE = 256;
/** the reach of the water's level about a texel [m]: a deck's ridge, a pier's trace, a spike narrower than twice this go down */
export const FLATTEN_RADIUS_M = 48;
/** the cover a texel needs to be the water's (the polygon's edge, a bank, kept) */
export const FLATTEN_COVER = 0.75;
/** the window's half-width at most [texels] (van Herk's filter: the cost the same whatever it is — ~12 comparisons a texel) */
const MAX_HALF = 64;

/**
 * Levels a tile's heights (row-major TILE², `h`, changed in place) under its water (`cover`, 0 … 1, the same grid): each texel of cover
 * FLATTEN_COVER or more takes the opening of the water's heights over a square window of ±`radiusM` (the land's texels out of it), if
 * lower. `mpp`: the tile's metres a texel. Returns the texels lowered.
 */
export function flattenUnderWater(
  h: Float32Array,
  cover: Float32Array,
  mpp: number,
  radiusM = FLATTEN_RADIUS_M,
  minCover = FLATTEN_COVER,
): number {
  const n = TILE * TILE;
  if (h.length < n || cover.length < n) return 0;
  let any = false;
  for (let i = 0; i < n; i++)
    if (cover[i]! >= minCover) {
      any = true;
      break;
    }
  if (!any) return 0;
  const r = Math.max(1, Math.min(MAX_HALF, Math.round(radiusM / Math.max(mpp, 1e-3))));
  // (a morphological opening of the water's heights — their least within the window, then the greatest of those least within it,
  // the land out of both —: a spike or a ridge narrower than the window gone, a hole kept as it is, never spread; each pass
  // separable: along the rows, then the columns)
  const water = new Uint8Array(n);
  for (let i = 0; i < n; i++) water[i] = cover[i]! >= minCover && Number.isFinite(h[i]!) ? 1 : 0;
  // (one line's least — or greatest — within ±r, van Herk / Gil-Werman: three comparisons a texel, whatever r)
  const w = 2 * r + 1;
  const g = new Float32Array(TILE + 2 * w),
    hh = new Float32Array(TILE + 2 * w),
    line = new Float32Array(TILE + 2 * r);
  const run = (get: (k: number) => number, put: (k: number, v: number) => void, lo: boolean, none: number) => {
    const L = TILE + 2 * r;
    for (let k = 0; k < L; k++) line[k] = k < r || k >= TILE + r ? none : get(k - r);
    const better = (u: number, v: number) => (lo ? (u < v ? u : v) : u > v ? u : v);
    for (let s0 = 0; s0 < L; s0 += w) {
      const e = Math.min(s0 + w, L) - 1;
      g[s0] = line[s0]!;
      for (let k = s0 + 1; k <= e; k++) g[k] = better(g[k - 1]!, line[k]!);
      hh[e] = line[e]!;
      for (let k = e - 1; k >= s0; k--) hh[k] = better(hh[k + 1]!, line[k]!);
    }
    for (let x = 0; x < TILE; x++) put(x, better(hh[x]!, g[x + 2 * r]!));
  };
  const pass = (src: Float32Array, lo: boolean): Float32Array => {
    const none = lo ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    const tmp = new Float32Array(n),
      out = new Float32Array(n);
    for (let y = 0; y < TILE; y++) {
      const o = y * TILE;
      run(
        (k) => (water[o + k] ? src[o + k]! : none),
        (k, v) => {
          tmp[o + k] = v;
        },
        lo,
        none,
      );
    }
    for (let x = 0; x < TILE; x++)
      run(
        (k) => tmp[k * TILE + x]!,
        (k, v) => {
          out[k * TILE + x] = v;
        },
        lo,
        none,
      );
    return out;
  };
  const eroded = pass(h, true);
  const opened = pass(eroded, false);
  let lowered = 0;
  // (each texel's own last bit kept — earth-tiles.ts markFine: the survey's mark, its own, not the lower neighbour's)
  const hb = new Uint32Array(h.buffer, h.byteOffset, n);
  const one = new Float32Array(1),
    oneB = new Uint32Array(one.buffer);
  for (let i = 0; i < n; i++) {
    if (!water[i]) continue;
    const m = opened[i]!;
    if (Number.isFinite(m) && m < h[i]!) {
      const mark = hb[i]! & 1;
      one[0] = m;
      hb[i] = (oneB[0]! & ~1) | mark;
      lowered++;
    }
  }
  return lowered;
}

/**
 * (25 Nov 2026 — PROBLEMES « L'eau sous Cheviré ») A far level's overground (earth-tiles.ts I6: the IGN's surface less its ground, TILE²
 * row-major, 0 where none) cleared over its inland water (`cover`, the same grid, the bridges not cut out): the surface model over a river
 * is a deck, a boat, a pier — drawn as a wall of relief down to the water (a dam under the far layer's deck) —, and the inland water's
 * falls, which read the relief ±25 m about a pixel (trace.wgsl shadeWater: these levels at that footprint), took the Cheviré deck's
 * 50 m for a fall: the light band of white water under the viaduct. The decks are the bridges' own (the near scene, the far layer to
 * 12 km); over the sea the same rule already held (T7, `surveyOnly`). Returns the texels cleared.
 */
export function clearOverWater(over: Float32Array, cover: Float32Array): number {
  let cleared = 0;
  const n = Math.min(over.length, cover.length);
  for (let i = 0; i < n; i++)
    if (cover[i]! >= FLATTEN_COVER && over[i]! > 0) {
      over[i] = 0;
      cleared++;
    }
  return cleared;
}
