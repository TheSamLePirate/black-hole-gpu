// R4 — the lift table's size (system/refraction-lift.ts fills it; gpu-tables.ts places it: TABLE_LIFT): apart, so the tables'
// layout imports no refraction code.
export const LIFT_ND = 128;
export const LIFT_NH = 8;
/** the farthest distance in the table [m] (the horizon from 400 km: ~2 300 km) */
export const LIFT_DMAX = 3.2e6;
/** the highest point height in it [m over the sea] */
export const LIFT_HMAX = 9000;
/** a header vec4 (x: 1 when in, y: the eye's height [m over the sea], z: LIFT_ND, w: LIFT_NH), the scenery's vec4 (its lift
 *  (x + y d) d² fitted near the ground, z the fade's angle, w 1 on — renderer.ts sceneryLift: the scenery's raster and the
 *  tracer's scenery the same numbers), then LIFT_ND × LIFT_NH floats, by height then distance — the lift Λ [m] */
export const LIFT_FLOATS = 8 + LIFT_ND * LIFT_NH;
export const LIFT_VEC4S = Math.ceil(LIFT_FLOATS / 4);
