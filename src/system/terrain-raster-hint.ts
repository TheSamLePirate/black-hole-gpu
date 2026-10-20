/**
 * The raster terrain patch's distance image, read by the tracer's main kernel as a start for each ground ray
 * (trace.wgsl: earthMarchHinted). Only where the device takes one more sampled texture: the stub that
 * returns no hint stays otherwise, and the kernel is what it was.
 */

/** Sampled textures per stage with the hint's: the aerial perspective's 21 and one. */
export const RASTER_HINT_TEXTURE_LIMIT = 22;
export const RASTER_HINT_BINDING = 35;

export function withTerrainRaster(trace: string, supported: boolean): string {
  const marker = /\/\/ BEGIN_TERRAIN_RASTER[\s\S]*?\/\/ END_TERRAIN_RASTER/;
  if (!marker.test(trace)) throw new Error("terrain-raster-hint: missing tracer stub");
  if (!supported) return trace;
  return trace.replace(
    marker,
    `
@group(0) @binding(${RASTER_HINT_BINDING}) var terrainDist: texture_2d<f32>;
// The patch's distance [m] at this ray's pixel (r32float, 0 where no triangle covers it; out of range reads 0).
fn terrainRasterHint(px: vec2f) -> f32 { return textureLoad(terrainDist, vec2i(floor(px)), 0).r; }`,
  );
}
