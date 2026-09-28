// The solar system's worlds up close (assets/planets-hd): the finer map of the body near the camera,
// streamed in as it nears — its colour (4096 or 8192 wide) and its relief's normals (from its normal
// map, or computed from its height map: Mars, Mercury), packed on the GPU:
//   color (rgba8): the map (sRGB), mip-mapped in linear light
//   relief (rgba8): the normals' east and south components (0.5: flat), mip-mapped
// One body at a time (the tracer's P.hd names it); its mean albedo measured, so that the finer map
// keeps the body's brightness (the coarse map's mean sets it).

import type { MapName } from "./solar";

import moonColor from "../../assets/planets-hd/moon-color.jpg";
import moonNormal from "../../assets/planets-hd/moon-normal.jpg";
import marsColor from "../../assets/planets-hd/mars-color.jpg";
import marsHeight from "../../assets/planets-hd/mars-height.jpg";
import mercuryColor from "../../assets/planets-hd/mercury-color.jpg";
import mercuryHeight from "../../assets/planets-hd/mercury-height.jpg";
import jupiterColor from "../../assets/planets-hd/jupiter-color.jpg";
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

/** A body's finer maps: its colour; its normals, or its height map and the relief's scale for them. */
interface HdSet { color: string; normal?: string; height?: string; relief?: number }
export const HD_SETS: Partial<Record<MapName, HdSet>> = {
  moon: { color: moonColor, normal: moonNormal },
  mars: { color: marsColor, height: marsHeight, relief: 6 },
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
`;

const levels = (w: number, h: number) => Math.floor(Math.log2(Math.max(w, h))) + 1;
const lin = (c: number) => (c / 255) ** 2.2;

export function placeholderHd(device: GPUDevice): HdMap {
  const mk = (px: number[]) => {
    const t = device.createTexture({ size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: t }, new Uint8Array(px), {}, [1, 1]);
    return t;
  };
  return { name: null, color: mk([128, 128, 128, 255]), relief: mk([128, 128, 255, 255]), hasRelief: false, mean: 0.25 };
}

async function bitmap(url: string) {
  const blob = await (await fetch(url)).blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

export async function loadHdMap(device: GPUDevice, name: MapName): Promise<HdMap | null> {
  const set = HD_SETS[name];
  if (!set) return null;
  const mod = device.createShaderModule({ code: PACK, label: "hd pack" });
  const samp = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "repeat" });
  const pipes = new Map<string, GPURenderPipeline>();
  const pipe = (entry: string) => {
    let p = pipes.get(entry);
    if (!p) {
      p = device.createRenderPipeline({
        layout: "auto", vertex: { module: mod, entryPoint: "vs" },
        fragment: { module: mod, entryPoint: entry, targets: [{ format: "rgba8unorm" }] }, primitive: { topology: "triangle-list" },
      });
      pipes.set(entry, p);
    }
    return p;
  };
  const kBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const draw = (entry: string, dst: GPUTexture, level: number, src: GPUTextureView) => {
    const p = pipe(entry);
    const uses = entry === "copy" ? [0, 1] : entry === "fromHeight" ? [0, 1, 2] : [0];
    const bind = device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: uses.map((b) => ({ binding: b, resource: b === 0 ? src : b === 1 ? samp : { buffer: kBuf } })),
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: dst.createView({ baseMipLevel: level, mipLevelCount: 1 }), loadOp: "clear", storeOp: "store", clearValue: [0.5, 0.5, 1, 1] }],
    });
    pass.setPipeline(p);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
  };
  const mips = (t: GPUTexture, srgb: boolean) => {
    for (let l = 1; l < t.mipLevelCount; l++) draw(srgb ? "downSrgb" : "downLin", t, l, t.createView({ baseMipLevel: l - 1, mipLevelCount: 1 }));
  };
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST;
  const upload = (img: ImageBitmap) => {
    const t = device.createTexture({ size: [img.width, img.height], format: "rgba8unorm", usage });
    device.queue.copyExternalImageToTexture({ source: img }, { texture: t }, [img.width, img.height]);
    return t;
  };

  // the colour, and its mean (a small copy of it, area-weighted)
  const cImg = await bitmap(set.color);
  const color = device.createTexture({ size: [cImg.width, cImg.height], format: "rgba8unorm", mipLevelCount: levels(cImg.width, cImg.height), usage });
  const cSrc = upload(cImg);
  draw("copy", color, 0, cSrc.createView());
  mips(color, true);
  const small = await createImageBitmap(cImg, { resizeWidth: 64, resizeHeight: 32, resizeQuality: "high" });
  const cv = new OffscreenCanvas(64, 32);
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(small, 0, 0);
  const px = ctx.getImageData(0, 0, 64, 32).data;
  let sum = 0, wsum = 0;
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
  const rUrl = set.normal ?? set.height;
  if (rUrl) {
    const rImg = await bitmap(rUrl);
    relief = device.createTexture({ size: [rImg.width, rImg.height], format: "rgba8unorm", mipLevelCount: levels(rImg.width, rImg.height), usage });
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
    relief = device.createTexture({ size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: relief }, new Uint8Array([128, 128, 255, 255]), {}, [1, 1]);
  }
  await device.queue.onSubmittedWorkDone();
  kBuf.destroy();
  return { name, color, relief, hasRelief, mean: Math.max(sum / wsum, 1e-3) };
}
