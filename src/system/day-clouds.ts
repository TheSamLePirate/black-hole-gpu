// The clouds of the day over the whole Earth (PLAN-CIEL C2): NASA GIBS's daily mosaic of the satellites'
// true-colour imagery (VIIRS on NOAA-20 since 2018, on Suomi NPP since 2012, MODIS on Terra since 2000),
// one equirectangular image of the globe (WMS, 4096 × 2048, ~2 MB, served to any page), turned into the
// cloud cover on the GPU: the light seen unmixed into the cloud-free Blue Marble beneath (the day cube's
// colour) and a cloud's top, grey — the deserts, the ice as bright there as here are not taken for
// clouds, a thin veil a part cover —; where the
// mosaic has nothing (the polar night, the gaps between swaths), the fixed map's cover. Written into the
// green of the Earth's night cube (its red the city lights: no texture more for the tracer, which has its
// 16), the cover in the fixed map's units (the day cube's alpha: the tracer maps both alike). Each region
// is seen near 13:30 local time: the day's clouds, held still.

const DAY = 86400e3;

/** The layers and the day each begins [ms UTC]: the newest first. */
const LAYERS: [string, number][] = [
  ["VIIRS_NOAA20_CorrectedReflectance_TrueColor", Date.UTC(2018, 0, 5)],
  ["VIIRS_SNPP_CorrectedReflectance_TrueColor", Date.UTC(2015, 10, 24)],
  ["MODIS_Terra_CorrectedReflectance_TrueColor", Date.UTC(2000, 1, 24)],
];

/**
 * The day whose mosaic stands for the game's date (its UTC day; today's not yet whole: yesterday's), and its
 * layer; null: none that day (before 2000, ahead of today — the game's 2067).
 */
export function dayCloudsFor(ms: number, now: number): { day: number; layer: string; date: string } | null {
  const day = Math.floor(ms / DAY) * DAY;
  if (!Number.isFinite(day) || day > Math.floor(now / DAY) * DAY) return null;
  const d = Math.min(day, Math.floor(now / DAY) * DAY - DAY);
  const l = LAYERS.find(([, from]) => d >= from);
  return l ? { day: d, layer: l[0], date: new Date(d).toISOString().slice(0, 10) } : null;
}

/** The mosaic's URL (GIBS's WMS, the whole globe in one image). */
export function dayCloudsUrl(layer: string, date: string, width = 4096): string {
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=${width}&HEIGHT=${width / 2}&FORMAT=image/jpeg&TIME=${date}`;
}

const PACK = /* wgsl */ `
@group(0) @binding(0) var mosaic: texture_2d<f32>;
@group(0) @binding(1) var fixedCube: texture_cube<f32>;
@group(0) @binding(2) var s: sampler;
@group(0) @binding(3) var<uniform> U: vec4f; // face, size, the fixed cube's level, its colour decoded (1: an sRGB format)
@group(0) @binding(4) var above: texture_2d<f32>;
struct V { @builtin(position) p: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: V;
  o.p = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  return o;
}
const PI = 3.14159265;
// a texel of a cube face: its direction (WebGPU's faces +X, −X, +Y, −Y, +Z, −Z)
fn faceDir(f: u32, px: vec2f, n: f32) -> vec3f {
  let a = 2.0 * px.x / n - 1.0;
  let b = 2.0 * px.y / n - 1.0;
  switch (f) {
    case 0u: { return vec3f(1.0, -b, -a); }
    case 1u: { return vec3f(-1.0, -b, a); }
    case 2u: { return vec3f(a, 1.0, b); }
    case 3u: { return vec3f(a, -1.0, -b); }
    case 4u: { return vec3f(a, -b, 1.0); }
    default: { return vec3f(-a, -b, -1.0); }
  }
}
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
@fragment fn cover(v: V) -> @location(0) vec4f {
  let c = normalize(faceDir(u32(U.x), v.p.xy, U.y));
  // (the cube's direction is the Earth's (y, z, x): x Greenwich, y 90° E, z north)
  let lon = atan2(c.x, c.z);
  let lat = asin(clamp(c.y, -1.0, 1.0));
  let day = textureSampleLevel(mosaic, s, vec2f(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI), 0.0).rgb;
  let fixedTexel = textureSampleLevel(fixedCube, s, c, U.z);
  // (no data: the polar night, a gap between swaths — the fixed map's cover)
  if (max(max(day.r, day.g), day.b) < 0.025) { return vec4f(0.0, fixedTexel.a, 0.0, 1.0); }
  // (in linear light: a compressed cube's sRGB format reads decoded, the JPEGs as stored)
  let dl = pow(day, vec3f(2.2));
  let bl = select(pow(fixedTexel.rgb, vec3f(2.2)), fixedTexel.rgb, U.w > 0.5);
  let hi = max(max(day.r, day.g), day.b);
  let sat = (hi - min(min(day.r, day.g), day.b)) / max(hi, 1e-3);
  // (the light seen, the ground's and a cloud's mixed: d = b (1 − c) + C c, a cloud's top C ≈ 0.6 —
  // unmixed; a coloured pixel (the ground, a desert's dust, a lake) not a cloud)
  let yd = luma(dl);
  let yb = luma(bl);
  let a = clamp((yd - yb) / max(0.6 - yb, 0.05), 0.0, 1.0) * (1.0 - smoothstep(0.2, 0.5, sat));
  // (in the fixed map's units: the tracer maps (raw − 0.06) × 1.25 to the cover)
  return vec4f(0.0, select(0.0, a / 1.25 + 0.06, a > 0.0), 0.0, 1.0);
}
@fragment fn down(v: V) -> @location(0) vec4f {
  let p = 2u * vec2u(v.p.xy);
  let g = textureLoad(above, p, 0).g + textureLoad(above, p + vec2u(1u, 0u), 0).g + textureLoad(above, p + vec2u(0u, 1u), 0).g + textureLoad(above, p + vec2u(1u, 1u), 0).g;
  return vec4f(0.0, 0.25 * g, 0.0, 1.0);
}
`;

/**
 * The day's mosaic made into the cloud cover, in the green of the night cube (rg8: its every level; its red,
 * the lights, kept), the fixed day cube (its colour: the Blue Marble, its alpha: the fixed cover) read beside.
 */
export function buildDayClouds(device: GPUDevice, mosaic: ImageBitmap, fixedCube: GPUTexture, night: GPUTexture): void {
  const size = night.width;
  const levels = night.mipLevelCount;
  const img = device.createTexture({
    size: [mosaic.width, mosaic.height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: mosaic }, { texture: img }, [mosaic.width, mosaic.height]);
  const mod = device.createShaderModule({ code: PACK, label: "day clouds" });
  // (the green alone written: the lights stay)
  const pipe = (entry: string) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: mod, entryPoint: "vs" },
      fragment: { module: mod, entryPoint: entry, targets: [{ format: night.format, writeMask: GPUColorWrite.GREEN }] },
      primitive: { topology: "triangle-list" },
    });
  const coverPipe = pipe("cover");
  const downPipe = pipe("down");
  const samp = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat" });
  const uni = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // (the fixed cube read at the level nearest the night cube's texels)
  const fixedLevel = Math.max(0, Math.min(fixedCube.mipLevelCount - 1, Math.log2(fixedCube.width / size)));
  const fixedView = fixedCube.createView({ dimension: "cube" });
  const level = (face: number, l: number) =>
    night.createView({ dimension: "2d", baseArrayLayer: face, arrayLayerCount: 1, baseMipLevel: l, mipLevelCount: 1 });
  const pass = (pipeline: GPURenderPipeline, bind: GPUBindGroup, face: number, l: number) => {
    const enc = device.createCommandEncoder();
    const p = enc.beginRenderPass({ colorAttachments: [{ view: level(face, l), loadOp: "load", storeOp: "store" }] });
    p.setPipeline(pipeline);
    p.setBindGroup(0, bind);
    p.draw(3);
    p.end();
    device.queue.submit([enc.finish()]);
  };
  for (let f = 0; f < 6; f++) {
    device.queue.writeBuffer(uni, 0, new Float32Array([f, size, fixedLevel, fixedCube.format.endsWith("-srgb") ? 1 : 0]));
    const bind = device.createBindGroup({
      layout: coverPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: img.createView() },
        { binding: 1, resource: fixedView },
        { binding: 2, resource: samp },
        { binding: 3, resource: { buffer: uni } },
      ],
    });
    pass(coverPipe, bind, f, 0);
    for (let l = 1; l < levels; l++) {
      const bindDown = device.createBindGroup({
        layout: downPipe.getBindGroupLayout(0),
        entries: [{ binding: 4, resource: level(f, l - 1) }],
      });
      pass(downPipe, bindDown, f, l);
    }
  }
  void device.queue.onSubmittedWorkDone().then(() => {
    img.destroy();
    uni.destroy();
  });
}
