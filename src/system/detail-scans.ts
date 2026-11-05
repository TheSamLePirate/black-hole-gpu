// Q7 L8 / VIPER B3 — the ground's detail scans (docs/progress/refraction-horizons/Q7.md, "L8"): five CC0 materials (ambientCG:
// grass, soil, gravel, rock, asphalt — scripts/build-detail-scans.py → assets/detail/<name>.ktx2) in one texture array, 512²,
// mip-mapped, linear: R the luminance's ratio to the scan's mean (halved), G B its normal's x and y. shadeLite multiplies the
// ground's albedo — the photograph's, its hue and mean kept — by the ratio at three scales (4 m, 32 m, 512 m, each turned), faded
// out as the pixel's footprint passes its texels, and tilts its normal by the scan's; the material by the photograph's colour (or
// a road's). Bound where the device takes one more sampled texture; drawn once every layer is in (P.scenery[6].z).

import type { KtxTarget } from "./ktx-worker";
import { ktxLevels, ktxTarget, writeLevels } from "./ktx2";
import asphaltUrl from "../../assets/detail/asphalt.ktx2";
import grassUrl from "../../assets/detail/grass.ktx2";
import gravelUrl from "../../assets/detail/gravel.ktx2";
import rockUrl from "../../assets/detail/rock.ktx2";
import soilUrl from "../../assets/detail/soil.ktx2";

/** sampled textures per stage with the scans' (the occlusion's 32 and one), their binding */
export const DETAIL_TEXTURE_LIMIT = 33;
export const DETAIL_BINDING = 49;
/** the materials, in the array's order (shadeLite's detailMaterial) */
export const DETAIL_MATERIALS = ["grass", "soil", "gravel", "rock", "asphalt"] as const;
const URLS: Record<(typeof DETAIL_MATERIALS)[number], string> = {
  grass: grassUrl,
  soil: soilUrl,
  gravel: gravelUrl,
  rock: rockUrl,
  asphalt: asphaltUrl,
};
export const DETAIL_SIDE = 512;
/** the world coordinates' period [m] the scales divide (4, 32, 512): the scenery frame's origin taken modulo it */
export const DETAIL_PERIOD = 4096;

const LEVELS = Math.log2(DETAIL_SIDE) + 1;
const linearFormat = (t: KtxTarget): GPUTextureFormat => (t === "bc7" ? "bc7-rgba-unorm" : t === "astc" ? "astc-4x4-unorm" : "rgba8unorm");

/** The tracer's reader: the array and detailRead(uv, layer, lod), its two nearest levels blended (a compute kernel: no derivatives). */
export function withDetailScans(trace: string, supported: boolean): string {
  const marker = /\/\/ BEGIN_DETAIL[\s\S]*?\/\/ END_DETAIL/;
  if (!marker.test(trace)) throw new Error("detail scans: missing tracer stub");
  if (!supported) return trace;
  return trace.replace(
    marker,
    `
@group(0) @binding(${DETAIL_BINDING}) var detailTex: texture_2d_array<f32>;
const DETAIL_BOUND = true;
fn detailRead(uv: vec2f, layer: i32, lod: f32) -> vec4f {
  let l0 = clamp(floor(lod), 0.0, ${LEVELS - 1}.0);
  let a = textureSampleLevel(detailTex, noiseSamp, uv, layer, l0);
  let b = textureSampleLevel(detailTex, noiseSamp, uv, layer, min(l0 + 1.0, ${LEVELS - 1}.0));
  return mix(a, b, clamp(lod - l0, 0.0, 1.0));
}`,
  );
}

/** The scans' texture: made at once (bound from the start), its layers written as their files come in. */
export class DetailScans {
  readonly texture: GPUTexture;
  ready = false;
  failed = false;
  private loaded = 0;
  constructor(private device: GPUDevice) {
    const target = ktxTarget(device);
    this.texture = device.createTexture({
      label: "detail scans",
      size: [DETAIL_SIDE, DETAIL_SIDE, DETAIL_MATERIALS.length],
      format: linearFormat(target),
      mipLevelCount: LEVELS,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
  }
  /** each material's file transcoded and written into its layer; ready once all are (a failure: never drawn) */
  load() {
    const target = ktxTarget(this.device);
    DETAIL_MATERIALS.forEach((name, layer) => {
      ktxLevels(URLS[name], target).then(
        (r) => {
          writeLevels(this.device, this.texture, r.levels, r.width, r.height, target, layer);
          if (++this.loaded === DETAIL_MATERIALS.length) this.ready = true;
        },
        (e) => {
          this.failed = true;
          console.warn(`detail scan ${name} not loaded:`, e);
        },
      );
    });
  }
}

/** The scenery frame's origin's world coordinates modulo DETAIL_PERIOD [m] (east, north): continuous as the frame moves — its
 *  east along the parallel of a reference latitude (whole degrees, the scale's error under 1 % within half a degree) */
export function detailOrigin(latDeg: number, lonDeg: number): [number, number] {
  const R = 6371008.8,
    D = Math.PI / 180;
  const ref = Math.round(latDeg);
  const mod = (v: number) => ((v % DETAIL_PERIOD) + DETAIL_PERIOD) % DETAIL_PERIOD;
  return [mod(R * Math.cos(ref * D) * lonDeg * D), mod(R * latDeg * D)];
}
