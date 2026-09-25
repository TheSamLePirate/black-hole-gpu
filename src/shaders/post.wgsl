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

@group(0) @binding(10) var<uniform> B: vec4f; // beam: σ [px of this level], kernel radius [px]
@group(0) @binding(11) var<storage, read> moments: array<f32>; // Σ luminance² per pixel
@group(0) @binding(12) var<uniform> AT: vec4f; // à-trous: step [px], σ (standard errors), iteration, unused
@group(0) @binding(13) var<storage, read_write> gatherBuf: array<vec4f>; // Σ w·c, Σ w (horizontal pass)

// Realtime reconstruction of stale pixels by normalized convolution (Knutsson & Westin 1993): a
// Gaussian (σ = block/2) of the valid samples divided by the same Gaussian of the validity mask,
// separable in two passes. Valid = taken with the current camera and within the sample-age window
// (R.w), so stale pixels are interpolated smoothly from the recent sparse samples around them.
fn gatherWeight(d: i32, block: u32) -> f32 {
  let sg = max(0.5 * f32(block), 0.8);
  return exp(-f32(d * d) / (2.0 * sg * sg));
}

@compute @workgroup_size(8, 8)
fn gatherH(@builtin(global_invocation_id) gid: vec3u) {
  let W = R.x >> 16u;
  let H = arrayLength(&stamps) / max(W, 1u);
  if (gid.x >= W || gid.y >= H) { return; }
  let block = max(R.x & 0xffu, 1u);
  if (block <= 1u) { return; }
  let h = i32(block);
  var acc = vec4f(0.0);
  for (var dx = -h; dx <= h; dx++) {
    let x = i32(gid.x) + dx;
    if (x < 0 || x >= i32(W)) { continue; }
    let qi = gid.y * W + u32(x);
    if (stamps[qi] < R.w) { continue; }
    let a = accum[qi];
    acc += gatherWeight(dx, block) * vec4f(a.rgb / max(a.a, 1e-6), 1.0);
  }
  gatherBuf[gid.y * W + gid.x] = acc;
}

// Variance-guided edge-avoiding à-trous wavelet filter (Dammertz et al. 2010), with a statistical
// edge-stopping test: the resolve pass stores in alpha the variance of each pixel's Monte Carlo
// estimate, Var = (Σl²/n − l̄²)/n. A neighbour q is averaged into p with the B3-spline weight
// h × exp(−(l_p − l_q)² / (2σ²(Var_p + Var_q))): only when the two estimates are statistically
// compatible. Pixels whose relative standard error is already below 2 % are left untouched, so
// converged detail, stars and the photon ring are never blurred; genuinely noisy Monte Carlo
// estimates (returning radiation, thin volumes at low spp) are averaged with compatible
// neighbours. Variances are propagated (Σw² Var / (Σw)²) so wider iterations filter less.
@compute @workgroup_size(8, 8)
fn atrous(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let p = vec2i(gid.xy);
  let hi = vec2i(size) - 1;
  let c = textureLoad(src, p, 0);
  let lp = luminance(c.rgb);
  let varP = c.a;
  if (varP < 0.0 || varP < (0.02 * lp) * (0.02 * lp) + 1e-12) {
    textureStore(dst, gid.xy, c);
    return;
  }
  let h = array<f32, 5>(0.0625, 0.25, 0.375, 0.25, 0.0625);
  let step = i32(AT.x);
  let s2 = 2.0 * AT.y * AT.y;
  var wsum = 0.0;
  var col = vec3f(0.0);
  var vsum = 0.0;
  for (var j = -2; j <= 2; j++) {
    for (var i = -2; i <= 2; i++) {
      let q = textureLoad(src, clamp(p + vec2i(i, j) * step, vec2i(0), hi), 0);
      let dl = lp - luminance(q.rgb);
      let vq = select(q.a, varP, q.a < 0.0);
      let w = h[i + 2] * h[j + 2] * exp(-dl * dl / (s2 * (varP + vq) + 1e-20));
      wsum += w;
      col += w * q.rgb;
      vsum += w * w * vq;
    }
  }
  textureStore(dst, gid.xy, vec4f(col / wsum, vsum / (wsum * wsum)));
}

// Instrument beam (e.g. the EHT's ≈ 20 µas restoring beam): separable Gaussian on one mip level.
fn beamBlur(gid: vec2u, dir: vec2i) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let n = i32(B.y);
  let hi = vec2i(textureDimensions(src)) - 1;
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var i = -n; i <= n; i++) {
    let w = exp(-0.5 * f32(i * i) / (B.x * B.x));
    acc += w * textureLoad(src, clamp(vec2i(gid) + i * dir, vec2i(0), hi), 0).rgb;
    wsum += w;
  }
  textureStore(dst, gid, vec4f(acc / wsum, 1.0));
}
@compute @workgroup_size(8, 8)
fn beamH(@builtin(global_invocation_id) gid: vec3u) { beamBlur(gid.xy, vec2i(1, 0)); }
@compute @workgroup_size(8, 8)
fn beamV(@builtin(global_invocation_id) gid: vec3u) { beamBlur(gid.xy, vec2i(0, 1)); }

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
  if (((R.x >> 8u) & 0xffu) == 1u) {
    // polarized intensity P = √(Q² + U²), shown as grey radiance
    let a = accum[gid.y * W + gid.x];
    let q = polAcc[gid.y * W + gid.x] / max(a.a, 1e-6);
    textureStore(dst, gid.xy, vec4f(vec3f(length(q)), 1.0));
    return;
  }
  let idx = gid.y * W + gid.x;
  var c: vec3f;
  var variance = -1.0; // variance of the pixel's estimate (−1: unknown)
  if (block <= 1u || stamps[idx] >= R.w) {
    // sample taken with the current camera (possibly a few frames old while animating)
    c = loadAvg(gid.x, gid.y, W);
    let n = accum[idx].a;
    if (n >= 2.0) {
      let l = luminance(c);
      variance = max(moments[idx] / n - l * l, 0.0) / n;
    }
  } else {
    // Stale pixel (older than the camera change, or than the sample-age window while time runs):
    // Gaussian-weighted gather of the valid (recent) samples around it; they include the latest
    // frame's, one per block. Fallback: bilinear reconstruction from the latest frame.
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
    let bil = mix(mix(c00, c10, t.x), mix(c01, c11, t.x), t.y);
    // vertical pass of the normalized convolution (horizontal sums in gatherBuf)
    let h = i32(block);
    var acc = vec4f(bil * 0.02, 0.02);
    for (var dy = -h; dy <= h; dy++) {
      let y = i32(gid.y) + dy;
      if (y < 0 || y > maxP.y) { continue; }
      acc += gatherWeight(dy, block) * gatherBuf[u32(y) * W + gid.x];
    }
    c = acc.rgb / acc.w;
  }
  c = min(c, vec3f(60000.0));
  textureStore(dst, gid.xy, vec4f(c, variance));
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
