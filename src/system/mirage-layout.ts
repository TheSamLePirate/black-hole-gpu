// R6a-ciel — the mirages' tables' size (system/mirage.ts fills them; gpu-tables.ts places them: TABLE_MIR): apart, so the
// tables' layout imports no refraction code.
/** the band [rad] either side of the horizontal, and the apparent elevations a table holds */
export const MIRAGE_BAND = (0.6 * Math.PI) / 180;
export const MIRAGE_N = 256;
/** a header (x: 1 when in, y: the eye's height [m], z: the band's low end, w: its high end [rad]), then the three colours'
 *  true elevations [rad] — the sea −10 —, four a vec4 */
export const MIRAGE_VEC4S = 1 + (3 * MIRAGE_N) / 4;
