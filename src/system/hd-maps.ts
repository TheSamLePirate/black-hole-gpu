// The solar system's worlds up close (assets/planets-hd): the finer map of the body near the camera,
// streamed in as it nears — its colour (4096 or 8192 wide) and its relief, packed on the GPU:
//   color (rgba8, or Jupiter's native BC7/ASTC): the map (sRGB), mip-mapped in linear light
//   relief: the Moon's and Mars's heights from their laser altimeters (LOLA, MOLA: scripts/build-dem.py)
//   — rg16float [m]: their mean and, down the mips, their highest (the marches' local bound); the
//   tracer's ground and its normals —; elsewhere (rgba8) the normals'
//   east and south components (0.5: flat), from the body's normal map or computed from its height map
//   (Mercury), mip-mapped
// One body at a time (the tracer's P.hd names it); its mean albedo measured, so that the finer map
// keeps the body's brightness (the coarse map's mean sets it).

import type { MapName } from "./solar";

import moonColor from "../../assets/planets-hd/moon-color.jpg";
import moonDem from "../../assets/planets-hd/moon-dem.bin";
import marsColor from "../../assets/planets-hd/mars-color.jpg";
import marsDem from "../../assets/planets-hd/mars-dem.bin";
import mercuryColor from "../../assets/planets-hd/mercury-color.jpg";
import mercuryHeight from "../../assets/planets-hd/mercury-height.jpg";
import jupiterColor from "../../assets/planets-hd/jupiter-color.jpg";
import jupiterKtx from "../../assets/planets-hd/jupiter-color.ktx2";
import jupiterMetadata from "../../assets/planets-hd/jupiter.json";
import { ktxFormat, ktxLevels, ktxTarget, writeLevels } from "./ktx2";
import { gpuDiagnostics } from "../gpu-diagnostics";
import type { Tier } from "../tier";
import saturnColor from "../../assets/planets-hd/saturn-color.jpg";
import ioColor from "../../assets/planets-hd/io-color.jpg";
import ioNormal from "../../assets/planets-hd/io-normal.jpg";
import europaColor from "../../assets/planets-hd/europa-color.jpg";
import europaNormal from "../../assets/planets-hd/europa-normal.jpg";
import ganymedeColor from "../../assets/planets-hd/ganymede-color.jpg";
import ganymedeNormal from "../../assets/planets-hd/ganymede-normal.jpg";
import tethysColor from "../../assets/planets-hd/tethys-color.jpg";
import tethysNormal from "../../assets/planets-hd/tethys-normal.jpg";
import dioneColor from "../../assets/planets-hd/dione-color.jpg";
import dioneNormal from "../../assets/planets-hd/dione-normal.jpg";
import rheaColor from "../../assets/planets-hd/rhea-color.jpg";
import rheaNormal from "../../assets/planets-hd/rhea-normal.jpg";
import plutoColor from "../../assets/planets-hd/pluto-color.jpg";
import plutoNormal from "../../assets/planets-hd/pluto-normal.jpg";
import phobosColor from "../../assets/planets-hd/phobos-color.jpg";
import phobosNormal from "../../assets/planets-hd/phobos-normal.jpg";
import deimosColor from "../../assets/planets-hd/deimos-color.jpg";
import deimosNormal from "../../assets/planets-hd/deimos-normal.jpg";
import mimasColor from "../../assets/planets-hd/mimas-color.jpg";
import mimasNormal from "../../assets/planets-hd/mimas-normal.jpg";
import ceresColor from "../../assets/planets-hd/ceres-color.jpg";
import ceresNormal from "../../assets/planets-hd/ceres-normal.jpg";
import { blockCompress, canBlockCompress } from "./bc-encode";
import { type HeightMap, loadHeights } from "./heights-file";

/**
 * A body's finer maps: its colour; its heights [m] (an altimeter's: the ground drawn and stood on), or
 * its normals, or an image's heights and the relief's scale for them (its shading alone).
 */
interface HdSet {
  color: string;
  dem?: string;
  normal?: string;
  height?: string;
  relief?: number;
}
export const HD_SETS: Partial<Record<MapName, HdSet>> = {
  moon: { color: moonColor, dem: moonDem },
  mars: { color: marsColor, dem: marsDem },
  mercury: { color: mercuryColor, height: mercuryHeight, relief: 5 },
  jupiter: { color: jupiterColor },
  saturn: { color: saturnColor },
  io: { color: ioColor, normal: ioNormal },
  europa: { color: europaColor, normal: europaNormal },
  ganymede: { color: ganymedeColor, normal: ganymedeNormal },
  tethys: { color: tethysColor, normal: tethysNormal },
  dione: { color: dioneColor, normal: dioneNormal },
  rhea: { color: rheaColor, normal: rheaNormal },
  pluto: { color: plutoColor, normal: plutoNormal },
  phobos: { color: phobosColor, normal: phobosNormal },
  deimos: { color: deimosColor, normal: deimosNormal },
  mimas: { color: mimasColor, normal: mimasNormal },
  ceres: { color: ceresColor, normal: ceresNormal },
};

export interface HdMap {
  name: MapName | null;
  color: GPUTexture;
  relief: GPUTexture;
  /** the relief is there (not a flat placeholder) */
  hasRelief: boolean;
  /** the relief's heights [m] (the texture holds them, as half floats), with their range: or none */
  dem: (HeightMap & { lo: number; hi: number }) | null;
  /** the colour map's mean linear luminance (area-weighted) */
  mean: number;
}

const PACK = /* wgsl */ `
@group(0) @binding(0) var a: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
@group(0) @binding(2) var<uniform> k: vec4f; // height → slope: scale; texel size u, v
struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: V;
  o.p = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(uv.x, 1.0 - uv.y);
  return o;
}
@fragment fn copy(v: V) -> @location(0) vec4f { return textureSampleLevel(a, s, v.uv, 0.0); }
// an altimeter's heights [m] as floats (the target's texels: the map's)
@group(0) @binding(3) var dem: texture_2d<i32>;
@fragment fn fromDem(v: V) -> @location(0) vec4f {
  let h = f32(textureLoad(dem, vec2u(v.p.xy), 0).r);
  return vec4f(h, h, 0.0, 1.0);
}
// the normals from a height map (the normal maps' convention: red east, green south)
@fragment fn fromHeight(v: V) -> @location(0) vec4f {
  let du = vec2f(k.y, 0.0);
  let dv = vec2f(0.0, k.z);
  let hx = textureSampleLevel(a, s, v.uv + du, 0.0).r - textureSampleLevel(a, s, v.uv - du, 0.0).r;
  let hy = textureSampleLevel(a, s, v.uv + dv, 0.0).r - textureSampleLevel(a, s, v.uv - dv, 0.0).r;
  // (east: +u; south: +v; the slopes shortened towards the poles' crowded texels)
  let c = max(cos((v.uv.y - 0.5) * 3.14159265), 0.05);
  let n = normalize(vec3f(-hx * k.x / c, hy * k.x, 1.0));
  return vec4f(0.5 + 0.5 * n.x, 0.5 - 0.5 * n.y, 1.0, 1.0);
}
fn quad(p: vec2u) -> array<vec4f, 4> {
  return array<vec4f, 4>(textureLoad(a, 2u * p, 0), textureLoad(a, 2u * p + vec2u(1u, 0u), 0),
    textureLoad(a, 2u * p + vec2u(0u, 1u), 0), textureLoad(a, 2u * p + vec2u(1u, 1u), 0));
}
@fragment fn downSrgb(v: V) -> @location(0) vec4f {
  let q = quad(vec2u(v.p.xy));
  var rgb = vec3f(0.0);
  for (var i = 0; i < 4; i++) { rgb += pow(q[i].rgb, vec3f(2.2)); }
  return vec4f(pow(rgb * 0.25, vec3f(1.0 / 2.2)), 1.0);
}
@fragment fn downLin(v: V) -> @location(0) vec4f {
  let q = quad(vec2u(v.p.xy));
  return (q[0] + q[1] + q[2] + q[3]) * 0.25;
}
// the heights' mips: their mean, and their highest
@fragment fn downDem(v: V) -> @location(0) vec4f {
  let q = quad(vec2u(v.p.xy));
  return vec4f((q[0].r + q[1].r + q[2].r + q[3].r) * 0.25, max(max(q[0].g, q[1].g), max(q[2].g, q[3].g)), 0.0, 1.0);
}
`;

const levels = (w: number, h: number) => Math.floor(Math.log2(Math.max(w, h))) + 1;
/** an 8-bit sRGB code to linear (the IEC 61966-2-1 curve — what the GPU's -srgb views decode) */
const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function placeholderHd(device: GPUDevice): HdMap {
  const mk = (px: number[]) => {
    const t = device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      viewFormats: ["rgba8unorm-srgb"],
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: t }, new Uint8Array(px), {}, [1, 1]);
    return t;
  };
  return { name: null, color: mk([128, 128, 128, 255]), relief: mk([128, 128, 255, 255]), hasRelief: false, dem: null, mean: 0.25 };
}

async function bitmap(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HD map: HTTP ${response.status} (${url})`);
  const blob = await response.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

/** the compressed Jupiter failed this session (a fetch, the transcoder, the GPU's memory): not retried */
let jupiterFailed = false;

/**
 * Whether Jupiter's 8K compressed map is worth fetching here: 32 MB to download and ~96 MB of transcoder
 * heap while it decodes — a tier ≥ 2 (not a phone, a weak GPU, a ≤ 4 GB device) sampling BC7 or ASTC at
 * 8192, and no failure yet this session. The others keep the 4K JPEG (3 MB).
 */
export function wantsJupiterKtx(device: Pick<GPUDevice, "features" | "limits">, tier: Pick<Tier, "level">): boolean {
  return !jupiterFailed && tier.level >= 2 && ktxTarget(device) !== "rgba" && device.limits.maxTextureDimension2D >= jupiterMetadata.width;
}

/** Upload prebuilt mips directly: no full-size RGBA staging image or runtime BC encoder. */
async function jupiterCompressed(device: GPUDevice): Promise<HdMap | null> {
  const target = ktxTarget(device);
  let color: GPUTexture | null = null;
  let relief: GPUTexture | null = null;
  try {
    const data = await ktxLevels(jupiterKtx, target);
    if (
      data.width !== jupiterMetadata.width ||
      data.height !== jupiterMetadata.height ||
      data.levels.length !== levels(data.width, data.height)
    )
      throw new Error("Jupiter KTX2 dimensions or mip chain do not match metadata");
    device.pushErrorScope("out-of-memory");
    device.pushErrorScope("validation");
    let validation: Promise<GPUError | null>;
    let allocation: Promise<GPUError | null>;
    try {
      color = device.createTexture({
        size: [data.width, data.height],
        format: ktxFormat(target),
        mipLevelCount: data.levels.length,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      writeLevels(device, color, data.levels, data.width, data.height, target);
      relief = device.createTexture({
        size: [1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture({ texture: relief }, new Uint8Array([128, 128, 255, 255]), {}, [1, 1]);
    } finally {
      validation = device.popErrorScope();
      allocation = device.popErrorScope();
    }
    const errors = await Promise.all([validation, allocation]);
    const error = errors.find((e) => e !== null);
    if (error) throw new Error(`Jupiter compressed upload: ${error.message}`);
    return { name: "jupiter", color, relief, hasRelief: false, dem: null, mean: jupiterMetadata.mean };
  } catch (error) {
    color?.destroy();
    relief?.destroy();
    jupiterFailed = true;
    gpuDiagnostics.record("jupiter-hd-fallback", error);
    console.warn("Jupiter compressed map unavailable, using the 4K JPEG:", error);
    return null;
  }
}

export async function loadHdMap(device: GPUDevice, name: MapName, tier: Pick<Tier, "level">): Promise<HdMap | null> {
  const set = HD_SETS[name];
  if (!set) return null;
  if (name === "jupiter" && wantsJupiterKtx(device, tier)) {
    const compressed = await jupiterCompressed(device);
    if (compressed) return compressed;
  }
  const mod = device.createShaderModule({ code: PACK, label: "hd pack" });
  const samp = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "repeat" });
  const pipes = new Map<string, GPURenderPipeline>();
  const pipe = (entry: string, format: GPUTextureFormat) => {
    let p = pipes.get(entry + format);
    if (!p) {
      p = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: mod, entryPoint: "vs" },
        fragment: { module: mod, entryPoint: entry, targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      pipes.set(entry + format, p);
    }
    return p;
  };
  const kBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const draw = (entry: string, dst: GPUTexture, level: number, src: GPUTextureView) => {
    const p = pipe(entry, dst.format);
    const uses = entry === "copy" ? [0, 1] : entry === "fromHeight" ? [0, 1, 2] : entry === "fromDem" ? [3] : [0];
    const bind = device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: uses.map((b) => ({ binding: b, resource: b === 0 || b === 3 ? src : b === 1 ? samp : { buffer: kBuf } })),
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: dst.createView({ baseMipLevel: level, mipLevelCount: 1 }),
          loadOp: "clear",
          storeOp: "store",
          clearValue: [0.5, 0.5, 1, 1],
        },
      ],
    });
    pass.setPipeline(p);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
  };
  const mips = (t: GPUTexture, srgb: boolean, entry = srgb ? "downSrgb" : "downLin") => {
    for (let l = 1; l < t.mipLevelCount; l++) draw(entry, t, l, t.createView({ baseMipLevel: l - 1, mipLevelCount: 1 }));
  };
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST;
  const upload = (img: ImageBitmap) => {
    const t = device.createTexture({ size: [img.width, img.height], format: "rgba8unorm", usage });
    device.queue.copyExternalImageToTexture({ source: img }, { texture: t }, [img.width, img.height]);
    return t;
  };

  // the colour, and its mean (a small copy of it, area-weighted)
  const cImg = await bitmap(set.color);
  const color = device.createTexture({
    size: [cImg.width, cImg.height],
    format: "rgba8unorm",
    viewFormats: ["rgba8unorm-srgb"],
    mipLevelCount: levels(cImg.width, cImg.height),
    usage,
  });
  const cSrc = upload(cImg);
  draw("copy", color, 0, cSrc.createView());
  mips(color, true);
  const small = await createImageBitmap(cImg, { resizeWidth: 64, resizeHeight: 32, resizeQuality: "high" });
  const cv = new OffscreenCanvas(64, 32);
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(small, 0, 0);
  const px = ctx.getImageData(0, 0, 64, 32).data;
  let sum = 0,
    wsum = 0;
  for (let y = 0; y < 32; y++) {
    const wgt = Math.cos(((y + 0.5) / 32 - 0.5) * Math.PI);
    for (let x = 0; x < 64; x++) {
      const i = 4 * (y * 64 + x);
      sum += wgt * (0.2126 * lin(px[i]!) + 0.7152 * lin(px[i + 1]!) + 0.0722 * lin(px[i + 2]!));
      wsum += wgt;
    }
  }
  cImg.close();
  cSrc.destroy();

  // the relief
  let relief: GPUTexture;
  let hasRelief = false;
  let dem: HdMap["dem"] = null;
  const rUrl = set.normal ?? set.height;
  if (set.dem) {
    const h = await loadHeights(set.dem);
    let lo = 0,
      hi = 0;
    for (let i = 0; i < h.map.length; i++) {
      const v = h.map[i]!;
      if (v < lo) lo = v;
      else if (v > hi) hi = v;
    }
    dem = { ...h, lo, hi };
    relief = device.createTexture({ size: [h.W, h.H], format: "rg16float", mipLevelCount: levels(h.W, h.H), usage });
    const whole = device.createTexture({
      size: [h.W, h.H],
      format: "r16sint",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: whole }, h.map, { bytesPerRow: h.W * 2 }, [h.W, h.H]);
    draw("fromDem", relief, 0, whole.createView());
    mips(relief, false, "downDem");
    await device.queue.onSubmittedWorkDone();
    whole.destroy();
    hasRelief = true;
  } else if (rUrl) {
    const rImg = await bitmap(rUrl);
    relief = device.createTexture({
      size: [rImg.width, rImg.height],
      format: "rgba8unorm",
      mipLevelCount: levels(rImg.width, rImg.height),
      usage,
    });
    const rSrc = upload(rImg);
    if (set.normal) draw("copy", relief, 0, rSrc.createView());
    else {
      device.queue.writeBuffer(kBuf, 0, new Float32Array([set.relief ?? 4, 1 / rImg.width, 1 / rImg.height, 0]));
      draw("fromHeight", relief, 0, rSrc.createView());
    }
    mips(relief, false);
    rImg.close();
    rSrc.destroy();
    hasRelief = true;
  } else {
    relief = device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: relief }, new Uint8Array([128, 128, 255, 255]), {}, [1, 1]);
  }
  await device.queue.onSubmittedWorkDone();
  kBuf.destroy();
  // (block-compressed where the GPU samples it — BC7 the colour, BC5 the relief's two slopes —: a
  // quarter of the memory, 340 → 86 MB for an 8K pair with its mips; the rgba8 freed)
  const fits = (t: GPUTexture) => t.width % 4 === 0 && t.height % 4 === 0;
  let c = color;
  let r = relief;
  if (canBlockCompress(device)) {
    if (fits(color)) c = blockCompress(device, color, "bc7");
    if (hasRelief && !dem && fits(relief)) r = blockCompress(device, relief, "bc5");
    await device.queue.onSubmittedWorkDone();
    if (c !== color) color.destroy();
    if (r !== relief) relief.destroy();
  }
  return { name, color: c, relief: r, hasRelief, dem, mean: Math.max(sum / wsum, 1e-3) };
}

/** The colour map's sRGB view's format (RGBA8, BC7 or native ASTC). */
export const hdColorFormat = (t: GPUTexture): GPUTextureFormat =>
  t.format.endsWith("-srgb") ? t.format : t.format === "bc7-rgba-unorm" ? "bc7-rgba-unorm-srgb" : "rgba8unorm-srgb";
