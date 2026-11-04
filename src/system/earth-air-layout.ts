// Q5 C1 — the transmittance table's size (system/earth-air.ts builds and reads it; gpu-tables.ts places it: TABLE_TLUT): apart,
// so the tables' layout imports no renderer code.
export const TLUT_W = 256;
export const TLUT_H = 64;
/** (C1, second lot) the multiple scattering's table: 32 × 32 (the Sun's zenith cosine, the height) */
export const MSLUT_N = 32;
/** the transmittance's header vec4 (1 when in, W, H, its top's radius over the ground's), one vec4 a texel (its optical depth
 *  rgb); then the multiple scattering's header (1 when in, N, N, its top's height [m]), one vec4 a texel (Ψ_ms rgb) */
export const TLUT_VEC4S = 1 + TLUT_W * TLUT_H + 1 + MSLUT_N * MSLUT_N;
/** where the multiple scattering's header is in the table [vec4s] */
export const MSLUT_OFF = 1 + TLUT_W * TLUT_H;
