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
  return withLiteDeferred(
    withLiteSplit(
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
    ),
    tex >= LITE_DEFERRED_TEXTURE_LIMIT,
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

/** Sampled textures per stage for the deferred raster ground's light kernel: the tracer's 33 (DETAIL_TEXTURE_LIMIT) and the
 *  material's record's four (trace.wgsl matIn0…3) */
export const LITE_DEFERRED_TEXTURE_LIMIT = 37;
/** the material's record's bindings in group 1: written by shadeLite (storage), read by shadeLiteLight (sampled) */
export const LITE_MAT_OUT = [14, 15, 16, 17] as const;
export const LITE_MAT_IN = [18, 19, 20, 21] as const;
/**
 * shadeLite deferred (journal 11 Nov 2026: the kernel on its registers' edge — any of the surfaces, the specular or the detail
 * compiled out, −11 to −12.5 ms over a forest): its material and its light two kernels — shadeLite ends writing the material's
 * record (liteMaterial → liteMatStore, the pixel marked RASTER_MAT), shadeLiteLight reads it back, lights it (liteLight) and
 * finishes as shadeLite did (liteEpilogue). Where the device takes the record's four more textures; shadeLite whole otherwise.
 */
export function withLiteDeferred(trace: string, supported: boolean): string {
  const marker = /\/\/ BEGIN_LITE_SURFACE[\s\S]*?\/\/ END_LITE_SURFACE/;
  if (!marker.test(trace)) throw new Error("tracer-source: missing shadeLite's surface marker");
  if (!supported) return trace;
  return trace.replace(
    marker,
    () => `let at = rasterAttrAt(centre, k);
  liteMatStore(gid.xy, liteMaterial(gq, q, ph, rd, ray.look, tM, fp, fx, fy, tn, hG, Ls, Lp, Li, E, isTree, anchored, at), tM, isTree,
    !isTree && (meshW || atLeaf(at) > 0u));
  moments[idx] = vec2f(RASTER_MAT, tM / EARTH_RM * bodyRadius(k));`,
  );
}
