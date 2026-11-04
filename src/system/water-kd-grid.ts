// The sea's water by region's grid (T7; system/water-kd.ts loads it): the constants, the bytes' meaning and the table's packing —
// no asset here (gpu-tables.ts and the scripts read it).

export const WATER_W = 4320;
export const WATER_H = 2160;
export const KD_MIN = 0.016;
export const KD_MAX = 6.0;
/** the table's vec4s: the header, then the cells twelve a vec4 */
export const WATER_VEC4S = 1 + Math.ceil((WATER_W * WATER_H) / 12);

/** Kd490 [1/m] of a stored byte */
export const kdOfByte = (b: number) => Math.exp(Math.log(KD_MIN) + (b / 255) * (Math.log(KD_MAX) - Math.log(KD_MIN)));

/** The table from the map's bytes (row by row from the north, west to east from −180°). */
export function waterTable(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  if (bytes.length !== WATER_W * WATER_H) throw new Error(`water-kd: ${bytes.length} cells, ${WATER_W * WATER_H} expected`);
  const t = new Float32Array(4 * WATER_VEC4S);
  t.set([1, WATER_W, WATER_H, 0]);
  for (let n = 0; n < bytes.length; n += 3) {
    t[4 + n / 3] = bytes[n]! + 256 * (bytes[n + 1] ?? 0) + 65536 * (bytes[n + 2] ?? 0);
  }
  return t;
}

/** A cell's byte read back from the table (trace.wgsl waterCell, the same) */
export function waterCell(t: Float32Array, n: number): number {
  const v = t[4 + Math.floor(n / 3)]!;
  return (v >>> (8 * (n % 3))) & 255;
}
