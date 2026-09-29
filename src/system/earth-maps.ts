// The Earth's maps for the tracer (assets/earth), packed on the GPU:
//   cube (rgba8, a cube map): the day colour (sRGB) and the cloud cover (alpha)
//   night (r8, a cube map): the city lights (the night map's red channel — its dark blue ground has
//     almost none)
//   surf (rgba8, equirectangular): the normal map's east and south components, the oceans (1), the
//     height (8 848 m × value)
// The cube maps' faces: `ft` looks at Greenwich (lat 0, lon 0), `rt` at 90° E, `up` at the north pole
// (Greenwich at its bottom edge), `dn` at the south pole (Greenwich at its top edge): on the Earth's
// own axes q (x Greenwich, y 90° E, z north), the cube's direction is (q.y, q.z, q.x) — its faces +X…−Z
// are then rt, lf, up, dn, ft, bk, each seen from outside the way the maps are drawn.
// Two tiers: "med" (faces 2048², the equirectangular maps 4096 × 2048), loaded with the solar
// system's maps; "high" (faces 4096², 8192 × 4096), when the camera comes near the Earth.

import dayMedFt from "../../assets/earth/day-med/ft.jpg";
import dayMedBk from "../../assets/earth/day-med/bk.jpg";
import dayMedLf from "../../assets/earth/day-med/lf.jpg";
import dayMedRt from "../../assets/earth/day-med/rt.jpg";
import dayMedUp from "../../assets/earth/day-med/up.jpg";
import dayMedDn from "../../assets/earth/day-med/dn.jpg";
import dayHighFt from "../../assets/earth/day-high/ft.jpg";
import dayHighBk from "../../assets/earth/day-high/bk.jpg";
import dayHighLf from "../../assets/earth/day-high/lf.jpg";
import dayHighRt from "../../assets/earth/day-high/rt.jpg";
import dayHighUp from "../../assets/earth/day-high/up.jpg";
import dayHighDn from "../../assets/earth/day-high/dn.jpg";
import cloudMedFt from "../../assets/earth/cloud-med/ft.jpg";
import cloudMedBk from "../../assets/earth/cloud-med/bk.jpg";
import cloudMedLf from "../../assets/earth/cloud-med/lf.jpg";
import cloudMedRt from "../../assets/earth/cloud-med/rt.jpg";
import cloudMedUp from "../../assets/earth/cloud-med/up.jpg";
import cloudMedDn from "../../assets/earth/cloud-med/dn.jpg";
import cloudHighFt from "../../assets/earth/cloud-high/ft.jpg";
import cloudHighBk from "../../assets/earth/cloud-high/bk.jpg";
import cloudHighLf from "../../assets/earth/cloud-high/lf.jpg";
import cloudHighRt from "../../assets/earth/cloud-high/rt.jpg";
import cloudHighUp from "../../assets/earth/cloud-high/up.jpg";
import cloudHighDn from "../../assets/earth/cloud-high/dn.jpg";
import nightFt from "../../assets/earth/night/ft.jpg";
import nightBk from "../../assets/earth/night/bk.jpg";
import nightLf from "../../assets/earth/night/lf.jpg";
import nightRt from "../../assets/earth/night/rt.jpg";
import nightUp from "../../assets/earth/night/up.jpg";
import nightDn from "../../assets/earth/night/dn.jpg";
import normalMed from "../../assets/earth/normal-med.jpg";
import normalHigh from "../../assets/earth/normal-high.jpg";
import oceanMed from "../../assets/earth/ocean-med.jpg";
import oceanHigh from "../../assets/earth/ocean-high.jpg";
import heightMed from "../../assets/earth/height-med.jpg";
import heightHigh from "../../assets/earth/height-high.jpg";

export type EarthTier = "med" | "high";

/** the faces in the cube's layer order: +X, −X, +Y, −Y, +Z, −Z */
type Faces = [string, string, string, string, string, string];
const SETS: Record<EarthTier, { size: number; day: Faces; cloud: Faces; normal: string; ocean: string; height: string; w: number }> = {
  med: {
    size: 2048, w: 4096,
    day: [dayMedRt, dayMedLf, dayMedUp, dayMedDn, dayMedFt, dayMedBk],
    cloud: [cloudMedRt, cloudMedLf, cloudMedUp, cloudMedDn, cloudMedFt, cloudMedBk],
    normal: normalMed, ocean: oceanMed, height: heightMed,
  },
  high: {
    size: 4096, w: 8192,
    day: [dayHighRt, dayHighLf, dayHighUp, dayHighDn, dayHighFt, dayHighBk],
    cloud: [cloudHighRt, cloudHighLf, cloudHighUp, cloudHighDn, cloudHighFt, cloudHighBk],
    normal: normalHigh, ocean: oceanHigh, height: heightHigh,
  },
};
const NIGHT: Faces = [nightRt, nightLf, nightUp, nightDn, nightFt, nightBk];
const NIGHT_SIZE = 2048;

/** The Earth's height at a map value (0…1) [m]. */
export const EARTH_HEIGHT_SCALE = 8848;

export interface EarthMaps {
  cube: GPUTexture;
  night: GPUTexture;
  surf: GPUTexture;
  tier: EarthTier | null;
}

const PACK = /* wgsl */ `
@group(0) @binding(0) var a: texture_2d<f32>;
@group(0) @binding(1) var b: texture_2d<f32>;
@group(0) @binding(2) var c: texture_2d<f32>;
@group(0) @binding(3) var s: sampler;
struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: V;
  o.p = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(uv.x, 1.0 - uv.y);
  return o;
}
// a face: the day colour, the cloud cover
@fragment fn face(v: V) -> @location(0) vec4f {
  return vec4f(textureSampleLevel(a, s, v.uv, 0.0).rgb, textureSampleLevel(b, s, v.uv, 0.0).r);
}
// the relief: normal (east, south), ocean, height
@fragment fn surf(v: V) -> @location(0) vec4f {
  let n = textureSampleLevel(a, s, v.uv, 0.0);
  return vec4f(n.r, n.g, textureSampleLevel(b, s, v.uv, 0.0).r, textureSampleLevel(c, s, v.uv, 0.0).r);
}
// a mip level from the one above (2 × 2 texels): colour averaged in linear light, or plainly
fn quad(p: vec2u) -> array<vec4f, 4> {
  return array<vec4f, 4>(textureLoad(a, 2u * p, 0), textureLoad(a, 2u * p + vec2u(1u, 0u), 0),
    textureLoad(a, 2u * p + vec2u(0u, 1u), 0), textureLoad(a, 2u * p + vec2u(1u, 1u), 0));
}
@fragment fn downSrgb(v: V) -> @location(0) vec4f {
  let q = quad(vec2u(v.p.xy));
  var rgb = vec3f(0.0);
  var al = 0.0;
  for (var i = 0; i < 4; i++) { rgb += pow(q[i].rgb, vec3f(2.2)); al += q[i].a; }
  return vec4f(pow(rgb * 0.25, vec3f(1.0 / 2.2)), al * 0.25);
}
@fragment fn downLin(v: V) -> @location(0) vec4f {
  let q = quad(vec2u(v.p.xy));
  return (q[0] + q[1] + q[2] + q[3]) * 0.25;
}
`;

const levels = (n: number) => Math.floor(Math.log2(n)) + 1;

/** Placeholders (one texel each) until the maps are loaded. */
export function placeholderEarth(device: GPUDevice): EarthMaps {
  const mk = (format: GPUTextureFormat, layers: number, px: Uint8Array<ArrayBuffer>) => {
    const t = device.createTexture({ size: [1, 1, layers], format, viewFormats: format === "rgba8unorm" ? ["rgba8unorm-srgb"] : [], usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    for (let l = 0; l < layers; l++) device.queue.writeTexture({ texture: t, origin: [0, 0, l] }, px, {}, [1, 1]);
    return t;
  };
  return {
    cube: mk("rgba8unorm", 6, new Uint8Array([40, 60, 90, 0])),
    night: mk("r8unorm", 6, new Uint8Array([0])),
    surf: mk("rgba8unorm", 1, new Uint8Array([128, 128, 255, 0])),
    tier: null,
  };
}

class Packer {
  private mod: GPUShaderModule;
  private pipes = new Map<string, GPURenderPipeline>();
  private samp: GPUSampler;
  constructor(private device: GPUDevice) {
    this.mod = device.createShaderModule({ code: PACK, label: "earth pack" });
    this.samp = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "repeat" });
  }
  private pipe(entry: string, format: GPUTextureFormat) {
    const key = `${entry}/${format}`;
    let p = this.pipes.get(key);
    if (!p) {
      p = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module: this.mod, entryPoint: "vs" },
        fragment: { module: this.mod, entryPoint: entry, targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      this.pipes.set(key, p);
    }
    return p;
  }
  /** a full-screen pass of `entry` into one level of one layer of dst, reading a, b, c */
  draw(entry: string, dst: GPUTexture, layer: number, level: number, src: GPUTextureView[]) {
    const d = this.device;
    const p = this.pipe(entry, dst.format);
    const layout = p.getBindGroupLayout(0);
    // (an entry point's layout holds only the bindings it uses)
    const used = entry === "face" ? [0, 1, 3] : entry === "surf" ? [0, 1, 2, 3] : [0];
    const bind = d.createBindGroup({
      layout,
      entries: used.map((b) => ({ binding: b, resource: b === 3 ? this.samp : src[b]! })),
    });
    const enc = d.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: dst.createView({ dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: level, mipLevelCount: 1 }),
        loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0],
      }],
    });
    pass.setPipeline(p);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    d.queue.submit([enc.finish()]);
  }
  /** the mip chain of one layer, from its level 0 */
  mips(dst: GPUTexture, layer: number, srgb: boolean) {
    for (let l = 1; l < dst.mipLevelCount; l++) {
      const above = dst.createView({ dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: l - 1, mipLevelCount: 1 });
      this.draw(srgb ? "downSrgb" : "downLin", dst, layer, l, [above]);
    }
  }
}

/** (the downloads, counted by the loading screen) */
let get: (url: string) => Promise<Response> = (u) => fetch(u);

/** An image into a new texture (level 0 only), in the given format (r8unorm: its red channel). */
async function upload(device: GPUDevice, url: string, format: GPUTextureFormat = "rgba8unorm") {
  const blob = await (await get(url)).blob();
  const img = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const t = device.createTexture({
    size: [img.width, img.height], format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: img }, { texture: t }, [img.width, img.height]);
  img.close();
  return t;
}

export async function loadEarthMaps(device: GPUDevice, tier: EarthTier, fetcher?: (url: string) => Promise<Response>): Promise<EarthMaps> {
  if (fetcher) get = fetcher;
  const set = SETS[tier];
  const pk = new Packer(device);
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
  const cube = device.createTexture({ size: [set.size, set.size, 6], format: "rgba8unorm", viewFormats: ["rgba8unorm-srgb"], mipLevelCount: levels(set.size), usage });
  const night = device.createTexture({ size: [NIGHT_SIZE, NIGHT_SIZE, 6], format: "r8unorm", mipLevelCount: levels(NIGHT_SIZE), usage });
  const surf = device.createTexture({ size: [set.w, set.w / 2], format: "rgba8unorm", mipLevelCount: levels(set.w), usage });
  // (face by face: a few large images decoded at a time)
  for (let f = 0; f < 6; f++) {
    const [day, cloud] = await Promise.all([upload(device, set.day[f]!), upload(device, set.cloud[f]!, "r8unorm")]);
    pk.draw("face", cube, f, 0, [day.createView(), cloud.createView()]);
    pk.mips(cube, f, true);
    day.destroy();
    cloud.destroy();
  }
  for (let f = 0; f < 6; f++) {
    const lights = await upload(device, NIGHT[f]!, "r8unorm");
    const enc = device.createCommandEncoder();
    enc.copyTextureToTexture({ texture: lights }, { texture: night, origin: [0, 0, f] }, [NIGHT_SIZE, NIGHT_SIZE]);
    device.queue.submit([enc.finish()]);
    pk.mips(night, f, false);
    lights.destroy();
  }
  const [n, o, h] = await Promise.all([upload(device, set.normal), upload(device, set.ocean, "r8unorm"), upload(device, set.height, "r8unorm")]);
  pk.draw("surf", surf, 0, 0, [n.createView(), o.createView(), h.createView()]);
  pk.mips(surf, 0, false);
  n.destroy();
  o.destroy();
  h.destroy();
  await device.queue.onSubmittedWorkDone();
  return { cube, night, surf, tier };
}

/**
 * The heights the tracer draws (the packed map's alpha, its finest level) read back to the CPU: the
 * ground the ship stands on (src/terrain.ts: earthHeightSampler), a byte per texel.
 */
const ALPHA_WGSL = `
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return vec4f(textureLoad(src, vec2i(p.xy), 0).a, 0.0, 0.0, 1.0);
}`;

export async function readEarthHeights(device: GPUDevice, surf: GPUTexture): Promise<{ map: Uint8Array; W: number; H: number }> {
  const W = surf.width, H = surf.height;
  const map = new Uint8Array(W * H);
  // (the heights — the packed map's alpha — drawn by the GPU into a one-byte texture, read back in
  // bands copied whole: no loop over the 33 M texels on the main thread, which took four long tasks)
  const heights = device.createTexture({ size: [W, H], format: "r8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const mod = device.createShaderModule({ code: ALPHA_WGSL, label: "earth heights" });
  const pipe = device.createRenderPipeline({
    layout: "auto", vertex: { module: mod, entryPoint: "vs" },
    fragment: { module: mod, entryPoint: "fs", targets: [{ format: "r8unorm" }] }, primitive: { topology: "triangle-list" },
  });
  {
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: heights.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: surf.createView({ baseMipLevel: 0, mipLevelCount: 1 }) }] }));
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
  }
  // (rows are 256-byte aligned: W is a power of two ≥ 256)
  const rows = Math.max(1, Math.floor((32 << 20) / W));
  const buf = device.createBuffer({ size: W * rows, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  for (let y = 0; y < H; y += rows) {
    const n = Math.min(rows, H - y);
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: heights, origin: [0, y, 0] }, { buffer: buf, bytesPerRow: W }, [W, n]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ, 0, W * n);
    map.set(new Uint8Array(buf.getMappedRange(0, W * n)), y * W);
    buf.unmap();
  }
  buf.destroy();
  heights.destroy();
  return { map, W, H };
}
