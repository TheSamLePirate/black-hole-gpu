// The tracer's WGSL as the renderer builds it: trace.wgsl with the forests set in, then each optional part (the
// terrain cache, the raster's hint and the relief's shadow map, the cloud pass and shadow maps, the trees' shadows,
// the regional surface, the world scenery, the sea's FFT, the aerial table) in or out by what the device takes.
// One function for the renderer (Renderer.create) and the tools that measure the kernels (scripts/wgsl-inline-size.ts,
// scripts/d3d12-compile-proxy.ts): what they measure is what the page compiles.
import { withForest } from "../forest-shader";
import { SEA_TEXTURE_LIMIT, seaShader } from "../sea/fft-gpu";
import { AERIAL_TEXTURE_LIMIT, aerialShader } from "./aerial";
import { CLOUD_PASS_TEXTURE_LIMIT, withCloudPass } from "./cloud-pass";
import { CLOUD_SHADOW_TEXTURE_LIMIT, withCloudShadow } from "./cloud-shadow";
import { SURFACE_TEXTURE_LIMIT, surfaceShader } from "./earth-surface";
import { sceneryShader } from "./scenery";
import { SCENERY_STORAGE_LIMIT } from "./scenery-data";
import { withTerrainCache } from "./terrain-cache";
import { RASTER_HINT_TEXTURE_LIMIT, SUN_SHADOW_TEXTURE_LIMIT, withSunShadow, withTerrainRaster } from "./terrain-raster-hint";
import { TREE_SHADOW_TEXTURE_LIMIT, withTreeShadow } from "./tree-shadow";

/** what of the device decides the tracer's optional parts */
export interface TracerLimits {
  maxSampledTexturesPerShaderStage: number;
  maxStorageBuffersPerShaderStage: number;
}

/** a device taking every part (the full device, Apple's and the desktop GPUs') */
export const FULL_TRACER_LIMITS: TracerLimits = { maxSampledTexturesPerShaderStage: 48, maxStorageBuffersPerShaderStage: 16 };

/** The tracer's source for a device: trace.wgsl and forest.wgsl composed as Renderer.create() composes them. */
export function composeTracer(trace: string, forest: string, limits: TracerLimits): string {
  const tex = limits.maxSampledTexturesPerShaderStage;
  return aerialShader(
    seaShader(
      sceneryShader(
        surfaceShader(
          withTreeShadow(
            withCloudShadow(
              withCloudPass(
                withSunShadow(
                  withTerrainRaster(withTerrainCache(withForest(trace, forest)), tex >= RASTER_HINT_TEXTURE_LIMIT),
                  tex >= SUN_SHADOW_TEXTURE_LIMIT,
                ),
                tex >= CLOUD_PASS_TEXTURE_LIMIT,
              ),
              tex >= CLOUD_SHADOW_TEXTURE_LIMIT,
            ),
            tex >= TREE_SHADOW_TEXTURE_LIMIT,
          ),
          tex >= SURFACE_TEXTURE_LIMIT,
        ),
        limits.maxStorageBuffersPerShaderStage >= SCENERY_STORAGE_LIMIT,
      ),
      tex >= SEA_TEXTURE_LIMIT,
    ),
    tex >= AERIAL_TEXTURE_LIMIT,
  );
}
