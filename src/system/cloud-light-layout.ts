// Q5 — the clouds' light volume's size (trace.wgsl cloudLightVolume writes it, wxCloud reads it; gpu-tables.ts places it:
// TABLE_CLV): apart, so the tables' layout imports no renderer code.
/** its texels a side, east and north, and in height */
export const CLV_N = 64;
export const CLV_NZ = 24;
/** its half-width [m]: 1.5 km a texel */
export const CLV_HALF_M = 48_000;
/** where each sample's own sunward march stops and the volume's starts [m] (wxLightTau's two first steps: 60 + 120) */
export const CLV_START_M = 180;
/** the texture it is written to: its slices side by side, a row a north step (row pitch 6 144 bytes: 256-aligned), then a row
 *  of its frame (P8: the frame it was made in, the next one's reference), padded to the dispatch's 8 */
export const CLV_TEX_W = CLV_N * CLV_NZ;
export const CLV_TEX_H = CLV_N + 8;
/** a header (x: 1 when written this frame), then its optical depths and its frame's row, four a vec4 */
export const CLV_VEC4S = 1 + (CLV_TEX_W * CLV_TEX_H) / 4;
