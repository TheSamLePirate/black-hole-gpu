// Q5 C1 — the transmittance table's size (system/earth-air.ts builds and reads it; gpu-tables.ts places it: TABLE_TLUT): apart,
// so the tables' layout imports no renderer code.
export const TLUT_W = 256;
export const TLUT_H = 64;
/** a header vec4 (1 when in, W, H, its top's radius over the ground's), then one vec4 a texel (its optical depth rgb) */
export const TLUT_VEC4S = 1 + TLUT_W * TLUT_H;
