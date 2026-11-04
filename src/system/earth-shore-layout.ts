// T7 — the shore's distances' layout in the tracer's table (system/earth-shore.ts; gpu-tables.ts TABLE_SHORE): no GPU or asset
// here — the table's sizes for gpu-tables.ts.
import { TERRAIN_CACHE_N } from "./terrain-cache-layout";

/** the relief cache's levels the distances are baked on: 6.1 m and 24 m nodes */
export const SHORE_LEVELS = [3, 4] as const;
/** a level's header: its window's reference (cos, sin lon0, sin, cos lat0), then nodes a radian, spacing [m], published, level */
export const SHORE_HEADER_VEC4S = 2 * SHORE_LEVELS.length;
/** a level's nodes, four a vec4 */
export const SHORE_NODE_VEC4S = Math.ceil((TERRAIN_CACHE_N * TERRAIN_CACHE_N) / 4);
export const SHORE_VEC4S = SHORE_HEADER_VEC4S + SHORE_LEVELS.length * SHORE_NODE_VEC4S;
