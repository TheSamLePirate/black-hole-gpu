// A tiling 3D gradient noise baked once into a texture (128³ r16float, 4 texels per lattice unit,
// period 32): the volumetric disk's turbulence reads it — a trilinear fetch instead of 8 hashed
// gradients a call (its 20–36 noises a sample were half the cost of the thick disk).

const N = 128;
export const NOISE_PERIOD = 32;

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
struct Slice { z: f32 };
@group(0) @binding(0) var<uniform> S: Slice;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) q: vec4f) -> @location(0) vec4f {
  // (texel centres: the lattice sampled at a quarter unit)
  let p = vec3f(q.xy, S.z + 0.5) * ${NOISE_PERIOD / N};
  return vec4f(gnoiseP(p), 0.0, 0.0, 1.0);
}`;

export function bakeNoise3d(device: GPUDevice): GPUTexture {
  const tex = device.createTexture({
    size: [N, N, N], dimension: "3d", format: "r16float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const mod = device.createShaderModule({ code: BAKE, label: "noise bake" });
  const pipe = device.createRenderPipeline({
    layout: "auto", vertex: { module: mod, entryPoint: "vs" },
    fragment: { module: mod, entryPoint: "fs", targets: [{ format: "r16float" }] }, primitive: { topology: "triangle-list" },
  });
  const bufs: GPUBuffer[] = [];
  const enc = device.createCommandEncoder();
  const view = tex.createView();
  for (let z = 0; z < N; z++) {
    const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buf, 0, new Float32Array([z, 0, 0, 0]));
    bufs.push(buf);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view, depthSlice: z, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] }));
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([enc.finish()]);
  void device.queue.onSubmittedWorkDone().then(() => bufs.forEach((b) => b.destroy()));
  return tex;
}
