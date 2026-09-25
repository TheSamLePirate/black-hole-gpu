// Post-processing: resolve the accumulation buffer to an HDR mip chain and build an
// energy-conserving multi-scale bloom (approximation of the optical point-spread function of
// a real camera/eye), following the dual-filter scheme of Jimenez (2014).

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var addTex: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> accum: array<vec4f>;
@group(0) @binding(5) var<uniform> R: vec4u; // realtime block size, interleave offset x, y, epoch
@group(0) @binding(6) var<storage, read> stamps: array<u32>;
@group(0) @binding(7) var<storage, read> polAcc: array<vec2f>;         // Σ Stokes Q, U
@group(0) @binding(8) var<storage, read_write> polGrid: array<vec4f>;  // per tick cell: Σ I, Q, U, n
@group(0) @binding(9) var<uniform> G: vec4u;                           // cell px, grid W, grid H, image W

fn luminance(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// Polarization ticks: mean Stokes I, Q, U (luminance) over each cell of the tick grid.
@compute @workgroup_size(8, 8)
fn polgrid(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= G.y || gid.y >= G.z) { return; }
  let W = G.w;
  let H = arrayLength(&accum) / W;
  var s = vec4f(0.0);
  for (var y = gid.y * G.x; y < min((gid.y + 1u) * G.x, H); y++) {
    for (var x = gid.x * G.x; x < min((gid.x + 1u) * G.x, W); x++) {
      let i = y * W + x;
      let a = accum[i];
      let n = max(a.a, 1e-6);
      s += vec4f(luminance(a.rgb) / n, polAcc[i] / n, 1.0);
    }
  }
  polGrid[gid.y * G.y + gid.x] = s;
}

fn loadAvg(x: u32, y: u32, W: u32) -> vec3f {
  let s = accum[y * W + x];
  return s.rgb / max(s.a, 1e-6);
}

@compute @workgroup_size(8, 8)
fn resolve(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let W = size.x;
  let block = max(R.x & 0xffu, 1u);
  if ((R.x >> 8u) == 1u) {
    // polarized intensity P = √(Q² + U²), shown as grey radiance
    let a = accum[gid.y * W + gid.x];
    let q = polAcc[gid.y * W + gid.x] / max(a.a, 1e-6);
    textureStore(dst, gid.xy, vec4f(vec3f(length(q)), 1.0));
    return;
  }
  let idx = gid.y * W + gid.x;
  var c: vec3f;
  if (block <= 1u || stamps[idx] >= R.w) {
    // sample taken with the current camera (possibly a few frames old while animating)
    c = loadAvg(gid.x, gid.y, W);
  } else {
    // Stale pixel: bilinear reconstruction from the latest realtime frame, whose samples sit at
    // (block·i + ox, block·j + oy).
    let o = vec2f(f32(R.y), f32(R.z)) + 0.5;
    let nb = vec2i((size + block - 1u) / block);
    let f = (vec2f(gid.xy) + 0.5 - o) / f32(block);
    let b0 = vec2i(floor(f));
    let t = f - floor(f);
    let lo = vec2i(0);
    let hi = nb - 1;
    let maxP = vec2i(size) - 1;
    let off = vec2i(i32(R.y), i32(R.z));
    let p00 = vec2u(min(clamp(b0, lo, hi) * i32(block) + off, maxP));
    let p11 = vec2u(min(clamp(b0 + 1, lo, hi) * i32(block) + off, maxP));
    let c00 = loadAvg(p00.x, p00.y, W);
    let c10 = loadAvg(p11.x, p00.y, W);
    let c01 = loadAvg(p00.x, p11.y, W);
    let c11 = loadAvg(p11.x, p11.y, W);
    c = mix(mix(c00, c10, t.x), mix(c01, c11, t.x), t.y);
  }
  c = min(c, vec3f(60000.0));
  textureStore(dst, gid.xy, vec4f(c, 1.0));
}

// 13-tap downsample (box-filtered 4×4 with overlapping bilinear fetches)
@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let texel = 1.0 / vec2f(textureDimensions(src));
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(size);
  let a = textureSampleLevel(src, samp, uv + texel * vec2f(-2.0, -2.0), 0.0).rgb;
  let b = textureSampleLevel(src, samp, uv + texel * vec2f(0.0, -2.0), 0.0).rgb;
  let c = textureSampleLevel(src, samp, uv + texel * vec2f(2.0, -2.0), 0.0).rgb;
  let d = textureSampleLevel(src, samp, uv + texel * vec2f(-2.0, 0.0), 0.0).rgb;
  let e = textureSampleLevel(src, samp, uv, 0.0).rgb;
  let f = textureSampleLevel(src, samp, uv + texel * vec2f(2.0, 0.0), 0.0).rgb;
  let g = textureSampleLevel(src, samp, uv + texel * vec2f(-2.0, 2.0), 0.0).rgb;
  let h = textureSampleLevel(src, samp, uv + texel * vec2f(0.0, 2.0), 0.0).rgb;
  let i = textureSampleLevel(src, samp, uv + texel * vec2f(2.0, 2.0), 0.0).rgb;
  let j = textureSampleLevel(src, samp, uv + texel * vec2f(-1.0, -1.0), 0.0).rgb;
  let k = textureSampleLevel(src, samp, uv + texel * vec2f(1.0, -1.0), 0.0).rgb;
  let l = textureSampleLevel(src, samp, uv + texel * vec2f(-1.0, 1.0), 0.0).rgb;
  let m = textureSampleLevel(src, samp, uv + texel * vec2f(1.0, 1.0), 0.0).rgb;
  var o = e * 0.125;
  o += (a + c + g + i) * 0.03125;
  o += (b + d + f + h) * 0.0625;
  o += (j + k + l + m) * 0.125;
  textureStore(dst, gid.xy, vec4f(o, 1.0));
}

// 3×3 tent upsample of the coarser level, added to this level's downsampled image.
@compute @workgroup_size(8, 8)
fn up(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let texel = 1.0 / vec2f(textureDimensions(src));
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(size);
  var o = textureSampleLevel(src, samp, uv, 0.0).rgb * 4.0;
  o += (textureSampleLevel(src, samp, uv + texel * vec2f(-1.0, 0.0), 0.0).rgb
      + textureSampleLevel(src, samp, uv + texel * vec2f(1.0, 0.0), 0.0).rgb
      + textureSampleLevel(src, samp, uv + texel * vec2f(0.0, -1.0), 0.0).rgb
      + textureSampleLevel(src, samp, uv + texel * vec2f(0.0, 1.0), 0.0).rgb) * 2.0;
  o += textureSampleLevel(src, samp, uv + texel * vec2f(-1.0, -1.0), 0.0).rgb
     + textureSampleLevel(src, samp, uv + texel * vec2f(1.0, -1.0), 0.0).rgb
     + textureSampleLevel(src, samp, uv + texel * vec2f(-1.0, 1.0), 0.0).rgb
     + textureSampleLevel(src, samp, uv + texel * vec2f(1.0, 1.0), 0.0).rgb;
  let here = textureLoad(addTex, gid.xy, 0).rgb;
  textureStore(dst, gid.xy, vec4f(here + o / 16.0, 1.0));
}
