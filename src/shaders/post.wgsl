// Post-processing: resolve the accumulation buffer to an HDR mip chain and build an
// energy-conserving multi-scale bloom (approximation of the optical point-spread function of
// a real camera/eye), following the dual-filter scheme of Jimenez (2014).

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var addTex: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> accum: array<vec4f>;
// u: realtime block size, interleave offset x, y, epoch; f.x: pre-exposure (the radiance is scaled
// before it is stored in half floats: our side's sunlit Saturn is ~10⁻⁷ of the disk's radiance)
struct Resolve { u: vec4u, f: vec4f };
@group(0) @binding(5) var<uniform> R: Resolve;
@group(0) @binding(6) var<storage, read> stamps: array<u32>;
@group(0) @binding(7) var<storage, read> polAcc: array<vec2f>;         // Σ Stokes Q, U
@group(0) @binding(8) var<storage, read_write> polGrid: array<vec4f>;  // per tick cell: Σ I, Q, U, n
@group(0) @binding(9) var<uniform> G: vec4u;                           // cell px, grid W, grid H, image W

@group(0) @binding(10) var<uniform> B: vec4f; // beam: σ [px of this level], kernel radius [px]
@group(0) @binding(11) var<storage, read> moments: array<vec2f>; // Σ luminance², depth [M] per pixel
@group(0) @binding(12) var<uniform> AT: vec4f; // à-trous: step [px], σ (standard errors), iteration, unused
@group(0) @binding(13) var<storage, read_write> gatherBuf: array<vec4f>; // Σ w·c, Σ w (horizontal pass)

// Realtime reconstruction of stale pixels by normalized convolution (Knutsson & Westin 1993): a
// Gaussian (σ = block/2) of the valid samples divided by the same Gaussian of the validity mask,
// separable in two passes. Valid = taken with the current camera and within the sample-age window
// (R.u.w), so stale pixels are interpolated smoothly from the recent sparse samples around them.
fn gatherWeight(d: i32, block: u32) -> f32 {
  let sg = max(0.5 * f32(block), 0.8);
  return exp(-f32(d * d) / (2.0 * sg * sg));
}

@compute @workgroup_size(8, 8)
fn gatherH(@builtin(global_invocation_id) gid: vec3u) {
  let W = R.u.x >> 16u;
  let H = arrayLength(&stamps) / max(W, 1u);
  if (gid.x >= W || gid.y >= H) { return; }
  let block = max(R.u.x & 0xffu, 1u);
  if (block <= 1u) { return; }
  let h = i32(block);
  var acc = vec4f(0.0);
  for (var dx = -h; dx <= h; dx++) {
    let x = i32(gid.x) + dx;
    if (x < 0 || x >= i32(W)) { continue; }
    let qi = gid.y * W + u32(x);
    if (stamps[qi] < R.u.w) { continue; }
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
  let block = max(R.u.x & 0xffu, 1u);
  if (((R.u.x >> 8u) & 0xffu) == 1u) {
    // polarized intensity P = √(Q² + U²), shown as grey radiance
    let a = accum[gid.y * W + gid.x];
    let q = polAcc[gid.y * W + gid.x] / max(a.a, 1e-6);
    textureStore(dst, gid.xy, vec4f(vec3f(length(q)), 1.0));
    return;
  }
  let idx = gid.y * W + gid.x;
  var c: vec3f;
  var variance = -1.0; // variance of the pixel's estimate (−1: unknown)
  if (block <= 1u || stamps[idx] >= R.u.w) {
    // sample taken with the current camera (possibly a few frames old while animating)
    c = loadAvg(gid.x, gid.y, W);
    let n = accum[idx].a;
    if (n >= 2.0) {
      let l = luminance(c);
      variance = max(moments[idx].x / n - l * l, 0.0) / n;
    }
  } else {
    // Stale pixel (older than the camera change, or than the sample-age window while time runs):
    // Gaussian-weighted gather of the valid (recent) samples around it; they include the latest
    // frame's, one per block. Fallback: bilinear reconstruction from the latest frame.
    let o = vec2f(f32(R.u.y), f32(R.u.z)) + 0.5;
    let nb = vec2i((size + block - 1u) / block);
    let f = (vec2f(gid.xy) + 0.5 - o) / f32(block);
    let b0 = vec2i(floor(f));
    let t = f - floor(f);
    let lo = vec2i(0);
    let hi = nb - 1;
    let maxP = vec2i(size) - 1;
    let off = vec2i(i32(R.u.y), i32(R.u.z));
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
  let pre = R.f.x;
  c = min(c * pre, vec3f(60000.0));
  textureStore(dst, gid.xy, vec4f(c, select(variance, variance * pre * pre, variance >= 0.0)));
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

// The first level: the Ranger (premultiplied, same scale — its image holds only its box, x y w h in
// px; w = 0: not drawn) and its jets taken over the traced image, as the display composites them — so
// the glare is the whole picture's: the hull hides the disk behind it from the bloom too (else the
// blurred disk, mixed back in, shows through it), and the exhaust glows.
@group(0) @binding(14) var shipTex: texture_2d<f32>;
@group(0) @binding(15) var plumeTex: texture_2d<f32>;
@group(0) @binding(16) var<uniform> SR: vec4f;
fn withShip(uv: vec2f) -> vec3f {
  var c = textureSampleLevel(src, samp, uv, 0.0).rgb;
  if (SR.z <= 0.0) { return c; }
  let dim = vec2f(textureDimensions(src));
  let px = uv * dim;
  if (all(px >= SR.xy) && all(px < SR.xy + SR.zw)) {
    // (the filter's texels kept within the box: beyond it the image is stale)
    let pc = clamp(px, SR.xy + 0.5, SR.xy + SR.zw - 0.5);
    let sp = textureSampleLevel(shipTex, samp, pc / dim, 0.0);
    c = min(sp.rgb, vec3f(60000.0)) + (1.0 - sp.a) * c;
  }
  return c + min(textureSampleLevel(plumeTex, samp, uv, 0.0).rgb, vec3f(60000.0));
}

const BLOOM_CAP = 6.0;
@compute @workgroup_size(8, 8)
fn downShip(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let texel = 1.0 / vec2f(textureDimensions(src));
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(size);
  var o = withShip(uv) * 0.125;
  o += (withShip(uv + texel * vec2f(-2.0, -2.0)) + withShip(uv + texel * vec2f(2.0, -2.0))
      + withShip(uv + texel * vec2f(-2.0, 2.0)) + withShip(uv + texel * vec2f(2.0, 2.0))) * 0.03125;
  o += (withShip(uv + texel * vec2f(0.0, -2.0)) + withShip(uv + texel * vec2f(-2.0, 0.0))
      + withShip(uv + texel * vec2f(2.0, 0.0)) + withShip(uv + texel * vec2f(0.0, 2.0))) * 0.0625;
  o += (withShip(uv + texel * vec2f(-1.0, -1.0)) + withShip(uv + texel * vec2f(1.0, -1.0))
      + withShip(uv + texel * vec2f(-1.0, 1.0)) + withShip(uv + texel * vec2f(1.0, 1.0))) * 0.125;
  // (the glare of what is far brighter than white — the Sun's disk, 10⁵ times the lit ground —
  // softly capped: its halo a camera's, not a blinding blob; white is ≈ 1/16 here, pre-exposed)
  let lo = dot(o, vec3f(0.2126, 0.7152, 0.0722));
  o *= 1.0 / (1.0 + lo / BLOOM_CAP);
  textureStore(dst, gid.xy, vec4f(o, 1.0));
}

// Depth of field (a thin lens): each pixel's circle of confusion from its depth (moments.y, the ray's
// length where what it shows became opaque; the sky, the shadow: 1e9), c = A |1 − F/d| (at most 2A,
// near), gathered as a scatter: a tap within its own circle's reach of this pixel adds its light over
// the circle's area — so a blurred foreground spreads over a sharp background, not the reverse (a tap
// farther than this pixel reaches no further than this pixel's own circle). F: the focus, or the
// depth at the image's centre (autofocus). Taps on a golden spiral, read from the image's mips (each
// covers the space between taps). At half resolution (the blur has no fine detail), its circle kept in
// alpha: the display mixes it over the sharp image where the circle is over a pixel or two. The
// Ranger, composited later, stays sharp.
struct Dof { f: vec4f, u: vec4u, box: vec4f }; // f: focus [M] (0: auto), largest circle A [px], taps, unused; u: W, H; box: the Endurance's [px] (w = 0: none)
@group(0) @binding(17) var<uniform> DF: Dof;
@group(0) @binding(20) var endDepth: texture_2d<f32>; // the Endurance's box: distance, coverage
fn dofDepth(p: vec2i) -> f32 {
  let q = clamp(p, vec2i(0), vec2i(DF.u.xy) - 1);
  var d = min(moments[u32(q.y) * DF.u.x + u32(q.x)].y, 1e5);
  if (DF.box.z > 0.0) {
    let b = q - vec2i(DF.box.xy);
    if (all(b >= vec2i(0)) && all(b < vec2i(textureDimensions(endDepth)))) {
      let e = textureLoad(endDepth, b, 0);
      if (e.y > 0.5) { d = min(d, e.x / e.y); }
    }
  }
  return d;
}
fn cocOf(d: f32, F: f32, A: f32) -> f32 { return A * min(abs(1.0 - F / max(d, 1e-3)), 2.0); }
@compute @workgroup_size(8, 8)
fn dof(@builtin(global_invocation_id) gid: vec3u) {
  let half = textureDimensions(dst);
  if (gid.x >= half.x || gid.y >= half.y) { return; }
  let size = DF.u.xy;
  // (the full-resolution pixel this one stands for)
  let p = min(vec2i(gid.xy) * 2, vec2i(size) - 1);
  let A = DF.f.y;
  var F = DF.f.x;
  if (F <= 0.0) {
    // autofocus: the harmonic mean of the finite depths around the centre — the sky and the shadow
    // are left out (focused on them, everything else would blur); a wider grid when the centre is all
    // shadow (the hole framed in the middle: focus on the disk around it)
    let c = vec2i(size / 2u);
    var inv = 0.0;
    var nf = 0.0;
    for (var ring = 1; ring <= 3; ring++) {
      let s = i32(max(size.y / 40u, 2u)) * ring * ring;
      for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
          let d = dofDepth(c + vec2i(i, j) * s);
          if (d < 1e4) {
            inv += 1.0 / d;
            nf += 1.0;
          }
        }
      }
      if (nf >= 3.0) { break; }
    }
    F = select(1e5, nf / max(inv, 1e-9), nf > 0.0);
  }
  // (this half-resolution pixel: the mean of its four)
  let c0 = textureSampleLevel(src, samp, (vec2f(p) + 1.0) / vec2f(size), 1.0).rgb;
  let dp = dofDepth(p);
  let cp = cocOf(dp, F, A);
  let R = 2.0 * A;
  if (R < 0.75) {
    textureStore(dst, gid.xy, vec4f(c0, 0.0));
    return;
  }
  let n = i32(DF.f.z);
  let texel = 1.0 / vec2f(size);
  // (each tap stands for the area between taps: read at the mip that covers it)
  let lod = clamp(log2(R * 1.77 / sqrt(f32(n))) - 0.5, 1.0, 4.0);
  var sum = c0 / max(cp * cp, 1.0);
  var wsum = 1.0 / max(cp * cp, 1.0);
  // (how blurred this pixel shows: its own circle, or a nearer blurred one spreading over it)
  var blur = cp;
  for (var i = 0; i < n; i++) {
    let rr = R * sqrt((f32(i) + 0.5) / f32(n));
    let ang = f32(i) * 2.39996323;
    let o = rr * vec2f(cos(ang), sin(ang));
    let q = p + vec2i(round(o));
    let dq = dofDepth(q);
    var cq = cocOf(dq, F, A);
    // (farther than this pixel: hidden behind it beyond its own circle)
    if (dq > dp) { cq = min(cq, max(cp, 0.5)); }
    let cover = clamp(cq - rr + 0.5, 0.0, 1.0);
    if (cover <= 0.0) { continue; }
    let w = cover / max(cq * cq, 1.0);
    if (dq < dp) { blur = max(blur, cq * cover); }
    sum += w * textureSampleLevel(src, samp, (vec2f(p) + 0.5 + o) * texel, lod).rgb;
    wsum += w;
  }
  textureStore(dst, gid.xy, vec4f(sum / wsum, blur));
}

// The lens flare's meter: where the light that burns out (beyond SDR white, after exposure) is on
// the image, and how much of it — its centroid and its mean excess over white, from a coarse level of
// the image, one workgroup summing it. The display draws the aperture's ghosts from these.
struct FlareU { k: f32, level: f32, pad: vec2f }; // exposure (linear), level read
@group(0) @binding(18) var<uniform> FU: FlareU;
@group(0) @binding(19) var<storage, read_write> flareOut: array<vec4f>; // [0]: mean excess, centroid (uv), unused
var<workgroup> flareSum: array<vec4f, 256>;
@compute @workgroup_size(16, 16)
fn flareMeter(@builtin(local_invocation_index) li: u32, @builtin(local_invocation_id) lid: vec3u) {
  let lvl = u32(FU.level);
  let size = textureDimensions(src, lvl);
  var acc = vec4f(0.0);
  for (var y = lid.y; y < size.y; y += 16u) {
    for (var x = lid.x; x < size.x; x += 16u) {
      let w = max(luminance(textureLoad(src, vec2u(x, y), lvl).rgb * FU.k) - 0.5, 0.0);
      let uv = (vec2f(f32(x), f32(y)) + 0.5) / vec2f(size);
      acc += vec4f(w, w * uv.x, w * uv.y, 0.0);
    }
  }
  flareSum[li] = acc;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { flareSum[li] += flareSum[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) {
    let t = flareSum[0];
    flareOut[0] = vec4f(t.x / f32(size.x * size.y), t.yz / max(t.x, 1e-9), 0.0);
  }
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

// ---------------------------------------------------------------------------------------------
// Light meter (auto exposure): the luminance of a 64 × 64 grid of the image (pre-exposed radiance)
// as a histogram of log₂ — bin b holds log₂ L ∈ [b/1.5 − 48, (b+1)/1.5 − 48); bin 0: black
// ---------------------------------------------------------------------------------------------
@group(0) @binding(20) var<storage, read_write> hist: array<atomic<u32>, 128>;

@compute @workgroup_size(8, 8)
fn meter(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= 64u || gid.y >= 64u) { return; }
  let size = textureDimensions(src, 0);
  // (each cell's mean over 4 × 4 points spread across it — not one point: a star or the Sun landing on
  // a grid point made the exposure pump)
  var l = 0.0;
  for (var j = 0u; j < 16u; j++) {
    let o = (vec2f(f32(j & 3u), f32(j >> 2u)) + 0.5) / 4.0;
    let p = vec2u((vec2f(gid.xy) + o) / 64.0 * vec2f(size));
    l += dot(textureLoad(src, min(p, size - 1u), 0).rgb, vec3f(0.2126, 0.7152, 0.0722));
  }
  l /= 16.0;
  var b = 0u;
  if (l > 0.0) { b = u32(clamp((log2(l) + 48.0) * 1.5, 1.0, 127.0)); }
  atomicAdd(&hist[b], 1u);
}
