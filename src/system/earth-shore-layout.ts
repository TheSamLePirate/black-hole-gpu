// T7 — the shore's distances' layout in the tracer's table (system/earth-shore.ts; gpu-tables.ts TABLE_SHORE): no GPU or asset
// here — the table's sizes for gpu-tables.ts.
import { TERRAIN_CACHE_N } from "./terrain-cache-layout";

/** the relief cache's levels the distances are baked on: 9.6, 38, 153, 611 and 2 446 m nodes (±1.2 km to ±314 km — Dean's profile
 *  reaches kilometres out, PLAN-MER-WEBGPU L4; level 2 since 11 Nov 2026: the waterline's steps 38 m wide at level 3 alone) */
export const SHORE_LEVELS = [2, 3, 4, 5, 6] as const;
/** a level's header: its window's reference (cos, sin lon0, sin, cos lat0), then nodes a radian, spacing [m], published, level */
export const SHORE_HEADER_VEC4S = 2 * SHORE_LEVELS.length;
/** a level's nodes, four a vec4 */
export const SHORE_NODE_VEC4S = Math.ceil((TERRAIN_CACHE_N * TERRAIN_CACHE_N) / 4);
export const SHORE_VEC4S = SHORE_HEADER_VEC4S + SHORE_LEVELS.length * SHORE_NODE_VEC4S;

// L1 — the coastal swell field (system/earth-swell.ts; trace.wgsl seaSwellAt): on the same levels and windows as the distances,
// each node's swell phase φ [rad] — the eikonal's |∇φ| = k(h) from the offshore swell, refracted round the capes — and its height
// gain (shoaling × refraction), two floats a node; after the distances' region, last in the table (gpu-tables.ts TABLE_SWELL).
/** the field's header: [0] on, period [s], Hs [m], the swell's clock (ωt/2π, fractional); [1] the groups' clock (ωt/2π / 7,
 *  fractional); then each level's window (its own: the
 *  field is published after its bake's last sweep, frames after the distances) as the distances' header has it — reference, then
 *  nodes a radian, spacing [m], published, level */
export const SWELL_HEADER_VEC4S = 2 + 2 * SHORE_LEVELS.length;
/** a level's nodes, two a vec4: (φ, gain) — gain −1 where no swell reaches (land, a lagoon, the lee past 90°) */
export const SWELL_NODE_VEC4S = Math.ceil((TERRAIN_CACHE_N * TERRAIN_CACHE_N) / 2);
export const SWELL_VEC4S = SWELL_HEADER_VEC4S + SHORE_LEVELS.length * SWELL_NODE_VEC4S;
