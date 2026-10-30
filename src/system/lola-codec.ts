// The Moon's fine relief in tiles (PLAN-PLANETES-AAA P6): LRO LOLA's global 118 m model (USGS, public domain: 256 pixels
// a degree, half-metres over the 1 737.4 km sphere) cut by server/moon-tiles.ts into equirectangular tiles of 256² —
// level z a tile 2^z degrees a side (z 0: 118 m a texel at the equator … z 3: 948 m) —, read by src/system/moon-tiles.ts.
// No import: the room server's image carries this file alone beside server/.
//
// Mars's too (PLAN-PLANETES-AAA P7: the USGS's HRSC and MOLA blend, 200 m, resampled to 256 pixels a degree), in whole metres:
// its 29 km of relief do not fit half-metres in 16 bits.
//
// A tile on the wire: 8 bytes (LLD1, its level, its unit — 0: half-metres, 1: metres —, 0, 0) then its 256² heights [its
// unit], row by row from the north,
// each as its difference from the plane through its west, north and north-west neighbours (the first row and column:
// from the one before), modulo 2¹⁶ — exact whatever the cliffs —, gzipped (served with Content-Encoding: gzip).

export const LOLA_TILE = 256;
/** its levels: z 0 … 3 */
export const LOLA_LEVELS = 4;
/** half-metres a unit (the Moon's) */
export const LOLA_SCALE = 0.5;
/** a tile's unit's metres, by its header's code */
export const LOLA_UNITS = [0.5, 1] as const;
const MAGIC = [0x4c, 0x4c, 0x44, 0x31]; // "LLD1"

/** a level's tile side [°] */
export const lolaTileDeg = (z: number) => 2 ** z;
/** a level's tiles round the Moon (east from 180° W) and from pole to pole (from the north: the last one, at z 3, half
 *  past the south pole — its rows there the pole's) */
export const lolaCols = (z: number) => 360 / 2 ** z;
export const lolaRows = (z: number) => Math.ceil(180 / 2 ** z);

/** a tile's bytes before the gzip: the heights' differences [its unit: LOLA_UNITS[unit]] */
export function lolaEncode(h: Int16Array, z: number, unit = 0): Uint8Array {
  const n = LOLA_TILE;
  const out = new Uint8Array(8 + 2 * n * n);
  out.set(MAGIC, 0);
  out[4] = z;
  out[5] = unit;
  const r = new Uint16Array(out.buffer, 8, n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      r[i] = (h[i]! - predict(h, x, y)) & 0xffff;
    }
  return out;
}

/** a tile's unit [m] (its header's code) */
export const lolaUnit = (b: Uint8Array) => LOLA_UNITS[b[5]!] ?? 0.5;

/** the heights [its unit] back from a tile's bytes (gunzipped) */
export function lolaDecode(b: Uint8Array): Int16Array {
  const n = LOLA_TILE;
  if (b.length !== 8 + 2 * n * n || MAGIC.some((m, i) => b[i] !== m)) throw new Error("lola: not a tile");
  // (copied: the residuals at an even offset whatever the buffer's — a Node Buffer's slice is a view into its pool)
  const r = new Uint16Array(new Uint8Array(b.subarray(8)).buffer);
  const h = new Int16Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      h[i] = ((predict(h, x, y) + r[i]!) << 16) >> 16;
    }
  return h;
}

function predict(h: Int16Array, x: number, y: number): number {
  const n = LOLA_TILE;
  if (y === 0) return x === 0 ? 0 : h[x - 1]!;
  if (x === 0) return h[(y - 1) * n]!;
  return h[y * n + x - 1]! + h[(y - 1) * n + x]! - h[(y - 1) * n + x - 1]!;
}

/** A coarser tile from its four children (north-west, north-east, south-west, south-east; a missing one — past the south
 *  pole — its northern neighbour's rows): each texel the mean of the 2 × 2 under it. */
export function lolaParent(nw: Int16Array, ne: Int16Array, sw: Int16Array | null, se: Int16Array | null): Int16Array {
  const n = LOLA_TILE,
    m = n / 2;
  const out = new Int16Array(n * n);
  for (let y = 0; y < n; y++) {
    const south = y >= m;
    for (let x = 0; x < n; x++) {
      const east = x >= m;
      const c = south ? (east ? (se ?? ne) : (sw ?? nw)) : east ? ne : nw;
      // (past the pole: the child's last rows, held)
      const cy = south && !(east ? se : sw) ? n - 2 : 2 * (y - (south ? m : 0));
      const cx = 2 * (x - (east ? m : 0));
      const s = c[cy * n + cx]! + c[cy * n + cx + 1]! + c[(cy + 1) * n + cx]! + c[(cy + 1) * n + cx + 1]!;
      out[y * n + x] = Math.round(s / 4);
    }
  }
  return out;
}
