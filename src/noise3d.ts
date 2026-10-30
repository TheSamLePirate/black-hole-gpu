// Tiling 3D noises baked once into a texture (128³ rgba16float, 4 texels per lattice unit, period 32): r a gradient
// noise — the volumetric disk's turbulence reads it, a trilinear fetch instead of 8 hashed gradients a call (its 20–36
// noises a sample were half the cost of the thick disk) —; for the clouds (docs/PLAN-NUAGES-AAA.md N4: Nubis's noises),
// g a Perlin–Worley — a Perlin fBm remapped by an inverted Worley fBm: billowing domes, the cauliflower's —, b and a two
// inverted Worley fBms twice and four times finer — the detail that erodes a cloud's edges into wisps.
// Its depth holds two contents (PLAN-PLANETES-AAA P9 G8): the noises in slices 1–128, a guard on each side (slice 0 a copy
// of the noises' last, 129 of their first: the filtering wraps them as the sampler's repeat did — trace.wgsl noiseAt); then
// the giants' turbulence tile (system/giant-tile.ts) in slices 131–258, its frames in time, a guard on each side again.

const N = 128;
export const NOISE_PERIOD = 32;
/** the texture's depth: the noises and their guards, then the giants' tile and its guards (trace.wgsl NOISE_DZ) */
export const NOISE_DEPTH = 260;
/** the giants' tile's first frame's slice and its frames (trace.wgsl TILE_Z0, TILE_FRAMES) */
export const TILE_Z0 = 131;
export const TILE_FRAMES = 128;

const BAKE = `
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn grad(h: u32, d: vec3f) -> f32 {
  let g = vec3f(f32(h & 0x3ffu), f32((h >> 10u) & 0x3ffu), f32((h >> 20u) & 0x3ffu)) * (2.0 / 1023.0) - 1.0;
  return dot(g, d);
}
// (the tracer's gnoise, its lattice wrapped every ${NOISE_PERIOD} units)
fn gnoiseP(p: vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let P = ${NOISE_PERIOD}u;
  let b = vec3u(vec3i(i) % vec3i(i32(P)) + vec3i(i32(P))) % vec3u(P);
  let b1 = (b + 1u) % vec3u(P);
  let z0 = pcg(b.z);
  let z1 = pcg(b1.z);
  let y00 = pcg(b.y ^ z0);
  let y10 = pcg(b1.y ^ z0);
  let y01 = pcg(b.y ^ z1);
  let y11 = pcg(b1.y ^ z1);
  let n0 = grad(pcg(b.x ^ y00), f);
  let n1 = grad(pcg(b1.x ^ y00), f - vec3f(1.0, 0.0, 0.0));
  let n2 = grad(pcg(b.x ^ y10), f - vec3f(0.0, 1.0, 0.0));
  let n3 = grad(pcg(b1.x ^ y10), f - vec3f(1.0, 1.0, 0.0));
  let n4 = grad(pcg(b.x ^ y01), f - vec3f(0.0, 0.0, 1.0));
  let n5 = grad(pcg(b1.x ^ y01), f - vec3f(1.0, 0.0, 1.0));
  let n6 = grad(pcg(b.x ^ y11), f - vec3f(0.0, 1.0, 1.0));
  let n7 = grad(pcg(b1.x ^ y11), f - vec3f(1.0, 1.0, 1.0));
  return 1.6 * mix(mix(mix(n0, n1, u.x), mix(n2, n3, u.x), u.y), mix(mix(n4, n5, u.x), mix(n6, n7, u.x), u.y), u.z);
}
// (Worley: the distance to the nearest of one point a cell — C cells over the period, wrapped —, inverted: 1 at a point, 0
// a cell's width off)
fn worley(p: vec3f, C: u32) -> f32 {
  let q = p * (f32(C) / f32(${NOISE_PERIOD}u));
  let i = vec3i(floor(q));
  let f = q - floor(q);
  var d = 9.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let o = vec3i(x, y, z);
        let c = vec3u((i + o + vec3i(i32(C) * 64)) % vec3i(i32(C)));
        let h = pcg(c.x ^ pcg(c.y ^ pcg(c.z ^ (C * 7919u))));
        let pt = vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) / 1023.0;
        d = min(d, length(vec3f(o) + pt - f));
      }
    }
  }
  return clamp(1.0 - d, 0.0, 1.0);
}
fn worleyFbm(p: vec3f, C: u32) -> f32 { return 0.625 * worley(p, C) + 0.25 * worley(p, C * 2u) + 0.125 * worley(p, C * 4u); }
struct Slice { z: f32 };
@group(0) @binding(0) var<uniform> S: Slice;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) q: vec4f) -> @location(0) vec4f {
  // (texel centres: the lattice sampled at a quarter unit)
  let p = vec3f(q.xy, S.z + 0.5) * ${NOISE_PERIOD / N};
  // (the Perlin fBm brought to 0…1, remapped by the Worley's — remap(perlin, worley − 1, 1, 0, 1): the Worley's cells cut
  // it into round domes)
  let perlin = clamp(0.5 + 0.5 * (0.6 * gnoiseP(p) + 0.3 * gnoiseP(p * 2.0) + 0.1 * gnoiseP(p * 4.0)), 0.0, 1.0);
  let w0 = worleyFbm(p, 8u);
  let pw = clamp((perlin - (w0 - 1.0)) / (2.0 - w0), 0.0, 1.0);
  return vec4f(gnoiseP(p), pw, worleyFbm(p, 16u), worleyFbm(p, 32u));
}`;

export function bakeNoise3d(device: GPUDevice): GPUTexture {
  const tex = device.createTexture({
    size: [N, N, NOISE_DEPTH],
    dimension: "3d",
    format: "rgba16float",
    // (the giants' tile written in by a compute pass: giant-tile.ts)
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  });
  const mod = device.createShaderModule({ code: BAKE, label: "noise bake" });
  const pipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: mod, entryPoint: "vs" },
    fragment: { module: mod, entryPoint: "fs", targets: [{ format: "rgba16float" }] },
    primitive: { topology: "triangle-list" },
  });
  const bufs: GPUBuffer[] = [];
  const enc = device.createCommandEncoder();
  const view = tex.createView();
  // (slice s the noises' z = s − 1, wrapped: the guards 0 and N + 1 their last and first)
  for (let s = 0; s < N + 2; s++) {
    const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buf, 0, new Float32Array([(s + N - 1) % N, 0, 0, 0]));
    bufs.push(buf);
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view, depthSlice: s, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
    });
    pass.setPipeline(pipe);
    pass.setBindGroup(
      0,
      device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] }),
    );
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([enc.finish()]);
  void device.queue.onSubmittedWorkDone().then(() => bufs.forEach((b) => b.destroy()));
  return tex;
}
