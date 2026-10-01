// The Earth's maps for the tracer (assets/earth), packed on the GPU:
//   cube (rgba8, a cube map): the day colour (sRGB) and the cloud cover (alpha)
//   night (r8, a cube map): the city lights (the night map's red channel — its dark blue ground has
//     almost none)
//   surf (rgba8, equirectangular): the relief's normal (its east and south components, from the heights),
//     the oceans (1)
//   elev (r16float, equirectangular, the same size): the height above the sea [m] (NOAA's ETOPO 2022:
//     scripts/build-earth-relief.py), the sea floor below 0
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
import oceanMed from "../../assets/earth/ocean-med.jpg";
import oceanHigh from "../../assets/earth/ocean-high.jpg";
import reliefMed from "../../assets/earth/relief-med.bin";
import reliefHigh from "../../assets/earth/relief-high.bin";
import ktxMedRt from "../../assets/earth/ktx2/med-rt.ktx2";
import ktxMedLf from "../../assets/earth/ktx2/med-lf.ktx2";
import ktxMedUp from "../../assets/earth/ktx2/med-up.ktx2";
import ktxMedDn from "../../assets/earth/ktx2/med-dn.ktx2";
import ktxMedFt from "../../assets/earth/ktx2/med-ft.ktx2";
import ktxMedBk from "../../assets/earth/ktx2/med-bk.ktx2";
import ktxHighRt from "../../assets/earth/ktx2/high-rt.ktx2";
import ktxHighLf from "../../assets/earth/ktx2/high-lf.ktx2";
import ktxHighUp from "../../assets/earth/ktx2/high-up.ktx2";
import ktxHighDn from "../../assets/earth/ktx2/high-dn.ktx2";
import ktxHighFt from "../../assets/earth/ktx2/high-ft.ktx2";
import ktxHighBk from "../../assets/earth/ktx2/high-bk.ktx2";
import { ktxFormat, ktxLevels, ktxTarget, writeLevels } from "./ktx2";

export type EarthTier = "med" | "high";

/** the faces in the cube's layer order: +X, −X, +Y, −Y, +Z, −Z */
type Faces = [string, string, string, string, string, string];
const SETS: Record<EarthTier, { size: number; day: Faces; cloud: Faces; ocean: string; relief: string; w: number }> = {
  med: {
    size: 2048, w: 4096,
    day: [dayMedRt, dayMedLf, dayMedUp, dayMedDn, dayMedFt, dayMedBk],
    cloud: [cloudMedRt, cloudMedLf, cloudMedUp, cloudMedDn, cloudMedFt, cloudMedBk],
    ocean: oceanMed, relief: reliefMed,
  },
  high: {
    size: 4096, w: 8192,
    day: [dayHighRt, dayHighLf, dayHighUp, dayHighDn, dayHighFt, dayHighBk],
    cloud: [cloudHighRt, cloudHighLf, cloudHighUp, cloudHighDn, cloudHighFt, cloudHighBk],
    ocean: oceanHigh, relief: reliefHigh,
  },
};
const NIGHT: Faces = [nightRt, nightLf, nightUp, nightDn, nightFt, nightBk];
// the day cube GPU-compressed (scripts/build-ktx2.ts: day colour, cloud cover as alpha; mip-mapped)
const KTX: Record<EarthTier, Faces> = {
  med: [ktxMedRt, ktxMedLf, ktxMedUp, ktxMedDn, ktxMedFt, ktxMedBk],
  high: [ktxHighRt, ktxHighLf, ktxHighUp, ktxHighDn, ktxHighFt, ktxHighBk],
};

/**
 * The day cube from its KTX2 faces, in this GPU's compressed format (BC7, ASTC): a quarter of rgba8's
 * memory. Null when it has none, or the transcoder is not there (the JPEG faces then).
 */
async function compressedCube(device: GPUDevice, tier: EarthTier): Promise<GPUTexture | null> {
  const target = ktxTarget(device);
  if (target === "rgba") return null;
  let cube: GPUTexture | null = null;
  try {
    for (let f = 0; f < 6; f++) {
      const k = await ktxLevels(KTX[tier][f]!, target);
      cube ??= device.createTexture({
        size: [k.width, k.height, 6], format: ktxFormat(target), mipLevelCount: k.levels.length,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      writeLevels(device, cube, k.levels, k.width, k.height, target, f);
    }
    return cube;
  } catch (e) {
    console.warn("Compressed Earth maps unavailable, JPEG instead:", e);
    cube?.destroy();
    return null;
  }
}
const NIGHT_SIZE = 2048;

/** The Earth's heights [m] as the tracer has them (its elev map: their texels), W × H equirectangular. */
export interface EarthHeights { map: Int16Array<ArrayBuffer>; W: number; H: number }

export interface EarthMaps {
  cube: GPUTexture;
  night: GPUTexture;
  surf: GPUTexture;
  elev: GPUTexture;
  /** the heights on the CPU (the ground the ship stands on): null for the placeholder */
  heights: EarthHeights | null;
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
// the heights [m] (r16float), from their whole metres (r16sint)
@group(0) @binding(4) var m: texture_2d<i32>;
@fragment fn elev(v: V) -> @location(0) vec4f {
  return vec4f(f32(textureLoad(m, vec2i(v.p.xy), 0).r), 0.0, 0.0, 1.0);
}
// the relief's normal from the heights (a: elev, the sea at 0) — the slopes −∂h/∂east, −∂h/∂south,
// central differences over the texels' sizes on the sphere — and the oceans (b)
@fragment fn surf(v: V) -> @location(0) vec4f {
  let d = vec2i(textureDimensions(a));
  let p = vec2i(v.p.xy);
  let xm = (p.x + d.x - 1) % d.x;
  let xp = (p.x + 1) % d.x;
  let ym = max(p.y - 1, 0);
  let yp = min(p.y + 1, d.y - 1);
  let hE = max(textureLoad(a, vec2i(xp, p.y), 0).r, 0.0) - max(textureLoad(a, vec2i(xm, p.y), 0).r, 0.0);
  let hS = max(textureLoad(a, vec2i(p.x, yp), 0).r, 0.0) - max(textureLoad(a, vec2i(p.x, ym), 0).r, 0.0);
  let lat = (0.5 - (f32(p.y) + 0.5) / f32(d.y)) * 3.14159265;
  let dx = 2.0 * 3.14159265 * 6.371e6 * max(cos(lat), 1e-3) / f32(d.x) * 2.0;
  let dy = 3.14159265 * 6.371e6 / f32(d.y) * f32(yp - ym);
  let sl = clamp(vec2f(-hE / dx, -hS / dy), vec2f(-1.0), vec2f(1.0));
  return vec4f(0.5 + 0.5 * sl, textureSampleLevel(b, s, v.uv, 0.0).r, 1.0);
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
    elev: mk("r16float", 1, new Uint8Array([0, 0]) as Uint8Array<ArrayBuffer>),
    heights: null,
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
    const used = entry === "face" || entry === "surf" ? [0, 1, 3] : entry === "elev" ? [4] : [0];
    const bind = d.createBindGroup({
      layout,
      entries: used.map((b) => ({ binding: b, resource: b === 3 ? this.samp : b === 4 ? src[0]! : src[b]! })),
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
  const night = device.createTexture({ size: [NIGHT_SIZE, NIGHT_SIZE, 6], format: "r8unorm", mipLevelCount: levels(NIGHT_SIZE), usage });
  const surf = device.createTexture({ size: [set.w, set.w / 2], format: "rgba8unorm", mipLevelCount: levels(set.w), usage });
  let cube = await compressedCube(device, tier);
  if (!cube) {
    cube = device.createTexture({ size: [set.size, set.size, 6], format: "rgba8unorm", viewFormats: ["rgba8unorm-srgb"], mipLevelCount: levels(set.size), usage });
    // (face by face: a few large images decoded at a time)
    for (let f = 0; f < 6; f++) {
      const [day, cloud] = await Promise.all([upload(device, set.day[f]!), upload(device, set.cloud[f]!, "r8unorm")]);
      pk.draw("face", cube, f, 0, [day.createView(), cloud.createView()]);
      pk.mips(cube, f, true);
      day.destroy();
      cloud.destroy();
    }
  }
  for (let f = 0; f < 6; f++) {
    const lights = await upload(device, NIGHT[f]!, "r8unorm");
    const enc = device.createCommandEncoder();
    enc.copyTextureToTexture({ texture: lights }, { texture: night, origin: [0, 0, f] }, [NIGHT_SIZE, NIGHT_SIZE]);
    device.queue.submit([enc.finish()]);
    pk.mips(night, f, false);
    lights.destroy();
  }
  const [heights, o] = await Promise.all([loadHeights(set.relief), upload(device, set.ocean, "r8unorm")]);
  const elev = device.createTexture({ size: [set.w, set.w / 2], format: "r16float", mipLevelCount: levels(set.w), usage });
  const whole = device.createTexture({ size: [heights.W, heights.H], format: "r16sint", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: whole }, heights.map, { bytesPerRow: heights.W * 2 }, [heights.W, heights.H]);
  pk.draw("elev", elev, 0, 0, [whole.createView()]);
  pk.mips(elev, 0, false);
  pk.draw("surf", surf, 0, 0, [elev.createView({ baseMipLevel: 0, mipLevelCount: 1 }), o.createView()]);
  pk.mips(surf, 0, false);
  whole.destroy();
  o.destroy();
  await device.queue.onSubmittedWorkDone();
  return { cube, night, surf, elev, heights, tier };
}

/**
 * The heights [m] from their file (scripts/build-earth-relief.py: "ELV1", gzip; each row's values after
 * its first as differences, the low bytes then the high), the rows summed a band at a time (no long
 * task on the main thread).
 */
async function loadHeights(url: string): Promise<EarthHeights> {
  const res = await get(url);
  if (!res.ok || !res.body) throw new Error(`Earth relief: HTTP ${res.status}`);
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const head = new Uint32Array(buf, 0, 4);
  if (head[0] !== 0x31564c45) throw new Error("Earth relief: bad header");
  const W = head[1]!, H = head[2]!, n = W * H;
  const lo = new Uint8Array(buf, 16, n), hi = new Uint8Array(buf, 16 + n, n);
  const map = new Int16Array(n);
  for (let y0 = 0; y0 < H; y0 += 256) {
    for (let y = y0; y < Math.min(y0 + 256, H); y++) {
      let o = y * W;
      let v = 0;
      for (let x = 0; x < W; x++, o++) map[o] = v = v + ((lo[o]! | (hi[o]! << 8)) << 16 >> 16);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  return { map, W, H };
}
