// Q5 C5 — the weather grid's size (system/weather-grid.ts fills it; gpu-tables.ts places it: TABLE_WXGRID): apart, so the
// tables' layout imports no renderer code.
export const WXGRID_N = 5;
/** its centre (the squashed Earth's unit direction, the points' step [rad]), its header (1 when in, the weather's layers'
 *  classes — 0 low, 1 middle, 2 high, −1 none), then a vec4 a point (low, middle, high cover, visibility [m] — −1 none), then
 *  the cirrus's (Q5 C7: the model's high cover at the camera — −1 none: the climatology's cirrus —, 1 when a layer of the
 *  weather draws the high clouds already) */
export const WXGRID_VEC4S = 3 + WXGRID_N * WXGRID_N;
