// The tracer's WGSL as the renderer builds it: trace.wgsl with the forests set in, then each optional part (the
// terrain cache, the raster's hint and the relief's shadow map, the cloud pass and shadow maps, the trees' shadows, the
// near body's horizon maps,
// the ground's occlusion, the regional surface, the world scenery, the sea's FFT, the aerial table) in or out by what the device takes.
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
import { HORIZON_TEXTURE_LIMIT, withHorizonMaps } from "./horizon-maps";
import { ORTHO_TEXTURE_LIMIT, withOrthoImagery } from "./earth-tiles";
import { GTAO_TEXTURE_LIMIT, withGtao } from "./gtao";
import { DETAIL_TEXTURE_LIMIT, withDetailScans } from "./detail-scans";

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
  return withLiteSplit(
    aerialShader(
      seaShader(
        sceneryShader(
          surfaceShader(
            withOrthoImagery(
              withDetailScans(
                withGtao(
                  withHorizonMaps(
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
                    tex >= HORIZON_TEXTURE_LIMIT,
                  ),
                  tex >= GTAO_TEXTURE_LIMIT,
                ),
                tex >= DETAIL_TEXTURE_LIMIT,
              ),
              tex >= ORTHO_TEXTURE_LIMIT,
            ),
            tex >= SURFACE_TEXTURE_LIMIT,
          ),
          limits.maxStorageBuffersPerShaderStage >= SCENERY_STORAGE_LIMIT,
        ),
        tex >= SEA_TEXTURE_LIMIT,
      ),
      tex >= AERIAL_TEXTURE_LIMIT,
    ),
  );
}

/** shadeLite's output for its finishing pass (withLiteSplit): group 1's binding — shadeLite's own pipeline layout (renderer.liteLayout) */
export const LITE_OUT_BINDING = 13;
/** its format: the surface's radiance G (rgb) and its distance [m] (a) — rgba32float: the distance whole */
export const LITE_OUT_FORMAT: GPUTextureFormat = "rgba32float";
/**
 * shadeLite split (docs/PLAN-J1-OPAQUE-FORWARD.md; journal 11 Nov 2026): its end — the air and the clouds before the surface,
 * liteFinish — taken out of it: it writes its surface G and the distance to liteOut and marks the pixel RASTER_SPLIT, the
 * shadeLiteFinish pass puts the air and the clouds on (its old colour, the temporal blend's, untouched until then). Over a low forest
 * the kernel weighed 46 ms with that code in it, 28 without (kerr-mini): its presence, not its work.
 */
export function withLiteSplit(trace: string): string {
  const marker = /\/\/ BEGIN_LITE_OUT[\s\S]*?\/\/ END_LITE_OUT/;
  if (!marker.test(trace)) throw new Error("tracer-source: missing shadeLite's output marker");
  return `@group(1) @binding(${LITE_OUT_BINDING}) var liteOut: texture_storage_2d<${LITE_OUT_FORMAT}, write>;
${trace.replace(
  marker,
  () => `moments[idx] = vec2f(RASTER_SPLIT, tM / EARTH_RM * bodyRadius(k));
  textureStore(liteOut, vec2i(gid.xy), vec4f(G, tM));`,
)}`;
}
