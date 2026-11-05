// R5 — the near body's limb-bending table's size (system/refraction-planets.ts fills it; gpu-tables.ts places it: TABLE_PREFR):
// apart, so the tables' layout imports no refraction code.
/** the tangent heights in the table (quadratic from 0 to the profile's top) */
export const PREFR_GL = 512;
/** two header vec4s — (x: the near body's index + 1, 0 none; y: its radius [m]; z: the profile's top [m]; w: the critical
 *  height [m] — under it a grazing ray is trapped) and (x, y: red's and blue's bending over green's less 1; z: PREFR_GL) —,
 *  then ln B(ht) [rad] for each tangent height */
export const PREFR_FLOATS = 8 + PREFR_GL;
export const PREFR_VEC4S = Math.ceil(PREFR_FLOATS / 4);
