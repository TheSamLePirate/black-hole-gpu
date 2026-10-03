// GPU-compressed colour maps (audit B6): KTX2 files, UASTC with RDO and Zstandard, mip-mapped, that the
// page transcodes to BC7 or ASTC (src/system/ktx2.ts) — a quarter of the GPU memory of rgba8:
//   - the Earth's day cube, both tiers, each face its day colour with its cloud cover as alpha
//     (assets/earth/ktx2/<tier>-<face>.ktx2);
//   - the solar system's maps at their texture arrays' sizes (2048 × 1024, 1024 × 512)
//     (assets/planets/ktx2/<name>.ktx2), their mean linear albedos in means.json (the page scaled
//     each body's albedo by it; measured from the JPEG before).
// The finer (HD) maps stay JPEG: 8K in UASTC would add hundreds of MB to the repository.
//
//   bun scripts/build-ktx2.ts [earth|planets]      (needs basisu — brew install basis_universal — and
//                                                   python3 with Pillow for the means)
import { $ } from "bun";
import { mkdirSync } from "node:fs";
import { MAPS_HI, MAPS_LO } from "../src/system/solar";

const only = process.argv[2];
const FACES = ["rt", "lf", "up", "dn", "ft", "bk"];
const UASTC = ["-uastc", "-uastc_level", "1", "-uastc_rdo_l", "1.0", "-ktx2", "-ktx2_zstandard_level", "18", "-mipmap"];

/** Runs jobs a few at a time (basisu uses ~3.5 cores each). */
async function pool(jobs: (() => Promise<void>)[], n = 2) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < jobs.length) await jobs[i++]!();
    }),
  );
}

const jobs: (() => Promise<void>)[] = [];
if (!only || only === "earth") {
  mkdirSync("assets/earth/ktx2", { recursive: true });
  for (const tier of ["med", "high"])
    for (const f of FACES) {
      jobs.push(async () => {
        const out = `assets/earth/ktx2/${tier}-${f}.ktx2`;
        await $`basisu ${UASTC} -alpha_file assets/earth/cloud-${tier}/${f}.jpg -output_file ${out} assets/earth/day-${tier}/${f}.jpg`.quiet();
        console.log(out, (Bun.file(out).size / 1e6).toFixed(1), "MB");
      });
    }
}
if (!only || only === "planets") {
  mkdirSync("assets/planets/ktx2", { recursive: true });
  for (const [names, w, h] of [
    [MAPS_HI, 2048, 1024],
    [MAPS_LO, 1024, 512],
  ] as const)
    for (const name of names) {
      jobs.push(async () => {
        const out = `assets/planets/ktx2/${name}.ktx2`;
        await $`basisu ${UASTC} -resample ${w} ${h} -output_file ${out} assets/planets/${name}.jpg`.quiet();
        console.log(out, (Bun.file(out).size / 1e6).toFixed(1), "MB");
      });
    }
}
await pool(jobs);

if (!only || only === "planets") {
  // (each map's mean linear luminance, area-weighted by cos latitude, over a 64 × 32 copy — as the page
  // measured it from the JPEG — on the true sRGB curve)
  const names = [...MAPS_HI, ...MAPS_LO];
  const py = `
import json, sys
from PIL import Image
def lin(c):
  v = c / 255
  return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
out = {}
for n in sys.argv[1:]:
  im = Image.open(f"assets/planets/{n}.jpg").convert("RGB").resize((64, 32), Image.LANCZOS)
  import math
  s = w = 0.0
  for y in range(32):
    c = math.cos(((y + 0.5) / 32 - 0.5) * math.pi)
    for x in range(64):
      r, g, b = im.getpixel((x, y))
      s += c * (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)); w += c
  out[n] = max(s / w, 1e-3)
print(json.dumps(out, indent=1))`;
  const means = await $`python3 -c ${py} ${names}`.text();
  await Bun.write("assets/planets/ktx2/means.json", means);
  console.log("assets/planets/ktx2/means.json");
}
