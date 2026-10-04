// GPU block compression of the textures made at load time (the HD maps: hd-maps.ts) — BC7 for colour,
// BC5 for two-channel normals —: a quarter of rgba8's memory (an 8K map with its mips: 171 → 43 MB),
// no download more. One thread a 4 × 4 block, written to a buffer then copied into the compressed
// texture, level by level.
//  BC7 mode 6 (one subset, RGBA endpoints of 7 bits + a shared bit each, 4-bit indices): the block's
//  principal axis (power iterations on its colours' covariance), its extent along it, the endpoints
//  quantized for each of the four p-bit pairs and the pair of least error kept; each texel's index the
//  nearest of the 16 weights; the first texel's index under 8 (the anchor's implicit top bit: endpoints
//  swapped otherwise).
//  BC5: two BC4 blocks (red, green), each its range's ends and a 3-bit index into their 8-step palette.
// Without the "texture-compression-bc" feature the textures stay as they are.

const ENCODE = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outB: array<vec4u>;
@group(0) @binding(2) var<uniform> U: vec4u; // blocks across, down; the output's row stride [blocks]

fn texel(b: vec2u, i: u32) -> vec4f {
  let size = vec2i(textureDimensions(src));
  let p = min(vec2i(b * 4u + vec2u(i & 3u, i >> 2u)), size - 1);
  return textureLoad(src, p, 0) * 255.0;
}

// 128 bits as four words: n bits of v at bit position pos
fn put(w: ptr<function, array<u32, 4>>, pos: u32, n: u32, v: u32) {
  let i = pos >> 5u;
  let s = pos & 31u;
  (*w)[i] |= v << s;
  if (s + n > 32u) { (*w)[i + 1u] |= v >> (32u - s); }
}

const W4 = array<f32, 16>(0.0, 4.0, 9.0, 13.0, 17.0, 21.0, 26.0, 30.0, 34.0, 38.0, 43.0, 47.0, 51.0, 55.0, 60.0, 64.0);

@compute @workgroup_size(8, 8)
fn bc7(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= U.x || gid.y >= U.y) { return; }
  var px: array<vec3f, 16>;
  var mean = vec3f(0.0);
  for (var i = 0u; i < 16u; i++) {
    px[i] = texel(gid.xy, i).rgb;
    mean += px[i];
  }
  mean /= 16.0;
  // (the principal axis: power iterations on the covariance, from the extent's diagonal)
  var c0 = vec3f(0.0);
  var c1 = vec3f(0.0);
  var lo = px[0];
  var hi = px[0];
  for (var i = 0u; i < 16u; i++) {
    let d = px[i] - mean;
    c0 += d.x * d;
    c1 += vec3f(d.y * d.y, d.y * d.z, d.z * d.z);
    lo = min(lo, px[i]);
    hi = max(hi, px[i]);
  }
  let C = mat3x3f(c0, vec3f(c0.y, c1.x, c1.y), vec3f(c0.z, c1.y, c1.z));
  var axis = hi - lo;
  if (dot(axis, axis) < 1e-6) { axis = vec3f(0.577); }
  for (var k = 0; k < 4; k++) {
    let a = C * axis;
    if (dot(a, a) < 1e-12) { break; }
    axis = normalize(a);
  }
  axis = normalize(axis);
  var tlo = 1e9;
  var thi = -1e9;
  for (var i = 0u; i < 16u; i++) {
    let t = dot(px[i] - mean, axis);
    tlo = min(tlo, t);
    thi = max(thi, t);
  }
  let e0 = clamp(mean + axis * tlo, vec3f(0.0), vec3f(255.0));
  let e1 = clamp(mean + axis * thi, vec3f(0.0), vec3f(255.0));
  // (each p-bit pair: the endpoints quantized, every texel's nearest weight, the error)
  var best = 1e30;
  var bq0 = vec3u(0u);
  var bq1 = vec3u(0u);
  var bp = vec2u(0u);
  var bidx: array<u32, 16>;
  for (var pp = 0u; pp < 4u; pp++) {
    let p0 = pp & 1u;
    let p1 = pp >> 1u;
    let q0 = vec3u(clamp(round((e0 - f32(p0)) * 0.5), vec3f(0.0), vec3f(127.0)));
    let q1 = vec3u(clamp(round((e1 - f32(p1)) * 0.5), vec3f(0.0), vec3f(127.0)));
    let E0 = vec3f(q0 * 2u + p0);
    let E1 = vec3f(q1 * 2u + p1);
    let D = E1 - E0;
    let dd = max(dot(D, D), 1e-6);
    var err = 0.0;
    var idx: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
      let t = clamp(dot(px[i] - E0, D) / dd, 0.0, 1.0);
      let g = u32(round(t * 15.0));
      var bi = g;
      var be = 1e30;
      for (var j = max(i32(g) - 1, 0); j <= min(i32(g) + 1, 15); j++) {
        let w = W4[j];
        let c = floor((E0 * (64.0 - w) + E1 * w + 32.0) / 64.0);
        let e = dot(c - px[i], c - px[i]);
        if (e < be) { be = e; bi = u32(j); }
      }
      idx[i] = bi;
      err += be;
    }
    if (err < best) {
      best = err;
      bq0 = q0;
      bq1 = q1;
      bp = vec2u(p0, p1);
      bidx = idx;
    }
  }
  // (the anchor — texel 0 — under 8: else the endpoints swapped, the indices reversed)
  if (bidx[0] >= 8u) {
    let t = bq0;
    bq0 = bq1;
    bq1 = t;
    bp = bp.yx;
    for (var i = 0u; i < 16u; i++) { bidx[i] = 15u - bidx[i]; }
  }
  var w: array<u32, 4>;
  put(&w, 0u, 7u, 64u); // mode 6
  put(&w, 7u, 7u, bq0.x);
  put(&w, 14u, 7u, bq1.x);
  put(&w, 21u, 7u, bq0.y);
  put(&w, 28u, 7u, bq1.y);
  put(&w, 35u, 7u, bq0.z);
  put(&w, 42u, 7u, bq1.z);
  put(&w, 49u, 7u, 127u); // alpha: opaque
  put(&w, 56u, 7u, 127u);
  put(&w, 63u, 1u, bp.x);
  put(&w, 64u, 1u, bp.y);
  put(&w, 65u, 3u, bidx[0]);
  for (var i = 1u; i < 16u; i++) { put(&w, 68u + 4u * (i - 1u), 4u, bidx[i]); }
  outB[gid.y * U.z + gid.x] = vec4u(w[0], w[1], w[2], w[3]);
}

// one BC4 block (64 bits: two words) of the channel values v
fn bc4(v: array<f32, 16>) -> vec2u {
  var lo = v[0];
  var hi = v[0];
  for (var i = 1u; i < 16u; i++) {
    lo = min(lo, v[i]);
    hi = max(hi, v[i]);
  }
  let r0 = u32(round(hi));
  let r1 = u32(round(lo));
  var w: array<u32, 4>;
  put(&w, 0u, 8u, r0);
  put(&w, 8u, 8u, r1);
  if (r0 > r1) {
    // (r0 > r1: r0, r1, then six steps from r0 to r1 — index 2 the nearest r0)
    let span = f32(r0 - r1);
    for (var i = 0u; i < 16u; i++) {
      let s = u32(round(clamp((v[i] - f32(r1)) / span, 0.0, 1.0) * 7.0));
      let k = select(select(8u - s, 1u, s == 0u), 0u, s == 7u);
      put(&w, 16u + 3u * i, 3u, k);
    }
  }
  return vec2u(w[0], w[1]);
}

@compute @workgroup_size(8, 8)
fn bc5(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= U.x || gid.y >= U.y) { return; }
  var r: array<f32, 16>;
  var g: array<f32, 16>;
  for (var i = 0u; i < 16u; i++) {
    let t = texel(gid.xy, i);
    r[i] = t.r;
    g[i] = t.g;
  }
  outB[gid.y * U.z + gid.x] = vec4u(bc4(r), bc4(g));
}
`;

export type BlockFormat = "bc7" | "bc5";

const pipes = new WeakMap<GPUDevice, Map<BlockFormat, GPUComputePipeline>>();
function pipeline(device: GPUDevice, f: BlockFormat) {
  let m = pipes.get(device);
  if (!m) pipes.set(device, (m = new Map()));
  let p = m.get(f);
  if (!p) {
    const module = device.createShaderModule({ code: ENCODE, label: "block compression" });
    m.set(f, (p = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: f } })));
  }
  return p;
}

/** Whether this device samples the BC formats (the renderer asked for the feature when it had it). */
export const canBlockCompress = (device: GPUDevice) => device.features.has("texture-compression-bc");

/**
 * A copy of an rgba8 texture (all its levels; width and height multiples of 4) block-compressed: BC7
 * (colour; an sRGB view allowed: "bc7-rgba-unorm-srgb") or BC5 (its red and green). The source is left
 * to the caller.
 */
export function blockCompress(device: GPUDevice, srcTex: GPUTexture, f: BlockFormat): GPUTexture {
  const format: GPUTextureFormat = f === "bc7" ? "bc7-rgba-unorm" : "bc5-rg-unorm";
  const dst = device.createTexture({
    size: [srcTex.width, srcTex.height],
    format,
    viewFormats: f === "bc7" ? ["bc7-rgba-unorm-srgb"] : [],
    mipLevelCount: srcTex.mipLevelCount,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const p = pipeline(device, f);
  for (let l = 0; l < srcTex.mipLevelCount; l++) {
    const w = Math.max(1, srcTex.width >> l),
      h = Math.max(1, srcTex.height >> l);
    const bx = Math.ceil(w / 4),
      by = Math.ceil(h / 4);
    // (rows of whole 256 bytes: the copy's rule)
    const stride = Math.ceil((bx * 16) / 256) * 16;
    const out = device.createBuffer({ size: stride * by * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const u = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(u, 0, new Uint32Array([bx, by, stride, 0]));
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(p);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: p.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: srcTex.createView({ baseMipLevel: l, mipLevelCount: 1 }) },
          { binding: 1, resource: { buffer: out } },
          { binding: 2, resource: { buffer: u } },
        ],
      }),
    );
    pass.dispatchWorkgroups(Math.ceil(bx / 8), Math.ceil(by / 8));
    pass.end();
    enc.copyBufferToTexture({ buffer: out, bytesPerRow: stride * 16 }, { texture: dst, mipLevel: l }, [bx * 4, by * 4]);
    device.queue.submit([enc.finish()]);
    out.destroy();
    u.destroy();
  }
  return dst;
}
