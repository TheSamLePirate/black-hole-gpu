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
    // (a pixel the raster's primary visibility shaded — trace.wgsl shade, RASTER_MARK —: fresh itself, never rebuilt,
    // and kept out of the sky's pixels rebuilt round it — its dense samples outweighed the sky's one a block)
    if (moments[qi].x > 1e29) { continue; }
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
// The ground's albedo a raster pixel carries in moments.x (trace.wgsl rasterMark, rasterStale — RASTER_DETAIL; 0: none)
fn rasterAlb(mx: f32) -> f32 {
  if (mx > 1e29) { return clamp(mx * 1e-30 - 1.0, 0.0, 1.0); }
  if (mx < -2.5 && mx > -3.5) { return clamp((-3.0 - mx) / 0.45, 0.0, 1.0); }
  return 0.0;
}
// a colour taken at albedo b brought to albedo a — the texture swapped, the light kept (either none: as it is; bounded: a
// texel's error, a coast's sea and land, not a blow-up)
fn albSwap(a: f32, b: f32) -> f32 { return select(1.0, clamp(a / b, 0.25, 4.0), a > 0.0 && b > 0.0); }
// the share of a frame's jittered albedo read in the accumulated one (post.wgsl temporal: ~5 frames — antialiased, still sharp
// under the motion's resampling)
const ALB_ALPHA = 0.2;

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
  let mx = moments[idx].x;
  // (only while the raster shades at a rate this frame — R.f.y —: a mark left from before it stopped is not this frame's)
  if (R.f.y > 1.5 && mx < -2.5 && mx > -3.5) {
    // A pixel the raster covers and its shading left this frame (trace.wgsl shadeMark, RASTER_STALE — the rate of
    // earthRasterShading above 1): rebuilt from the fresh shaded pixels round it (RASTER_MARK) on the same surface — their
    // depths within a few per cent of its own nearest surface's, so a crown does not bleed into the ground behind it nor
    // the ground into a trunk —, Gaussian in the distance; no fresh pixel round it at all: its own last colour.
    let dp = moments[idx].y;
    var acc = vec4f(0.0);
    // (1 in 8 or 16 — R.f.y the rate —: the fresh samples two to four pixels apart: a window of 7 × 7, a wider Gaussian)
    let wide = R.f.y > 6.0;
    let rr = select(2, 3, wide);
    let gk = select(0.5, 0.22, wide);
    // (RASTER_DETAIL — R.f.z —: each sample's colour brought to this pixel's own albedo, the texture sharp between them)
    let ap = select(0.0, rasterAlb(mx), R.f.z > 0.5);
    for (var j = -rr; j <= rr; j++) {
      for (var i = -rr; i <= rr; i++) {
        let q = vec2i(gid.xy) + vec2i(i, j);
        if (any(q < vec2i(0)) || q.x >= i32(W) || q.y >= i32(size.y)) { continue; }
        let qi = u32(q.y) * W + u32(q.x);
        let m = moments[qi];
        if (m.x < 1e29 || stamps[qi] < R.u.w) { continue; }
        let rel = (m.y - dp) / (0.05 * dp + 1e-12);
        // (a floor under the depths' likeness: where none is alike — a grazing ground's depth changes by more than 5 % a
        // row, a silhouette —, the nearest fresh samples still decide; the pixel's own old colour, the camera turned since,
        // put the sky's colour on the ground and the history's clamp then let its ghosts through)
        acc += exp(-gk * f32(i * i + j * j)) * max(exp(-rel * rel), 0.002) * vec4f(loadAvg(u32(q.x), u32(q.y), W) * albSwap(ap, rasterAlb(m.x)), 1.0);
      }
    }
    c = select(loadAvg(gid.x, gid.y, W), acc.rgb / acc.w, acc.w > 0.0);
  } else if (block <= 1u || stamps[idx] >= R.u.w) {
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
  let pl = textureSampleLevel(plumeTex, samp, uv, 0.0);
  return c * (1.0 - clamp(pl.a, 0.0, 1.0)) + min(pl.rgb, vec3f(60000.0));
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
// the spot meter (the telescope's): the disc read alone — its centre (fractions of the width, the height), its
// radius (a fraction of the height); w > 0: on — the grid laid over the disc's square, the cells out of it not counted
@group(0) @binding(22) var<uniform> spot: vec4f;

@compute @workgroup_size(8, 8)
fn meter(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= 64u || gid.y >= 64u) { return; }
  let size = textureDimensions(src, 0);
  let on = spot.w > 0.0;
  let sz = vec2f(size);
  // (the cell's place in the image [px]: the whole of it, or the spot's square)
  let cellOf = select(
    (vec2f(gid.xy) + 0.5) / 64.0 * sz,
    spot.xy * sz + ((vec2f(gid.xy) + 0.5) / 64.0 * 2.0 - 1.0) * spot.z * sz.y,
    on,
  );
  if (on && length(cellOf - spot.xy * sz) > spot.z * sz.y) { return; }
  let cell = select(sz / 64.0, vec2f(2.0 * spot.z * sz.y / 64.0), on);
  // (each cell's mean over 4 × 4 points spread across it — not one point: a star or the Sun landing on
  // a grid point made the exposure pump)
  // (a point under the cockpit's mask — mask.wgsl, moments.x < 0: not traced, the cabin over it — not counted)
  var l = 0.0;
  var n = 0.0;
  for (var j = 0u; j < 16u; j++) {
    let o = (vec2f(f32(j & 3u), f32(j >> 2u)) + 0.5) / 4.0 - 0.5;
    let p = vec2u(clamp(cellOf + o * cell, vec2f(0.0), sz - 1.0));
    if (moments[p.y * size.x + p.x].x < 0.0) { continue; }
    l += dot(textureLoad(src, p, 0).rgb, vec3f(0.2126, 0.7152, 0.0722));
    n += 1.0;
  }
  if (n == 0.0) { return; }
  l /= n;
  var b = 0u;
  if (l > 0.0) { b = u32(clamp((log2(l) + 48.0) * 1.5, 1.0, 127.0)); }
  atomicAdd(&hist[b], 1u);
}
// ---------------------------------------------------------------------------------------------
// Temporal reprojection (realtime): the image kept from frame to frame. Each pixel's view direction is
// found in the previous frame's image by the camera's rotation alone — exact for everything far (the
// sky, the lensed images: a photon's arrival direction does not depend on how the camera is turned),
// and for what is near the neighbourhood clamp rejects what moved. The history is clamped to the
// range the current frame's samples span around the pixel (at the scale of the block: the current
// frame is a reconstruction from one ray a block, its own 3×3 would crush the history's detail), then
// blended: a pixel a ray landed on this frame takes more of it than one reconstructed between rays.
// ---------------------------------------------------------------------------------------------
// the catalogue stars a realtime frame splatted where they fall (trace.wgsl: splatStar, R8): 3 × u32 per
// pixel, the pre-exposed radiance × 2¹⁶
@group(0) @binding(23) var<storage, read> starAcc: array<u32>;
fn starsAt(i: u32) -> vec3f {
  return vec3f(f32(starAcc[3u * i]), f32(starAcc[3u * i + 1u]), f32(starAcc[3u * i + 2u])) * (1.0 / 65536.0);
}

// The realtime image with its stars: the reprojected one (the history, which keeps none: its stars,
// absent from the frame's range, clipped), the splatted stars over it
@compute @workgroup_size(8, 8)
fn stars(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let c = textureLoad(src, vec2i(gid.xy), 0);
  textureStore(dst, gid.xy, vec4f(c.rgb + starsAt(gid.y * size.x + gid.x), c.a));
}

struct Temporal {
  right: vec4f,   // current camera axes (w: tan of the half vertical field, aspect, unused)
  up: vec4f,
  fwd: vec4f,     // (w: the clamp's width, in standard deviations)
  pRight: vec4f,  // the previous frame's (w: its tan, aspect)
  pUp: vec4f,
  pFwd: vec4f,
  k: vec4f,       // history's exposure ratio (current / previous pre-exposure), on (0: copy; 2: the camera held, the
                  // history handed over to the refinement), the least α of a fresh
                  // pixel (1 / (n_max + 1): the history's weight capped at n_max), a pixel between rays' weight
  drift: vec4f,   // the camera's displacement since the previous frame [M], in these axes (the near body's frame);
                  // w: under this depth [M] a pixel shows the near body's ground — drawn afresh (0: none)
  cc: vec4f,      // the near body's centre from the camera now [M]; w: its ground reprojected rigidly (1) — R4
  m0: vec4f,      // its turn since the previous frame, as rows: a point's offset from the centre now → then
  m1: vec4f,
  m2: vec4f,
  mb: vec4f,      // the motion blur's shutter (a fraction of the frame; 0: none); y: the camera held, the history's
                  // weight left (1 → 0 over the refinement's first passes), z: its first frame stamp (bits), unused
};
@group(0) @binding(21) var<uniform> TA: Temporal;

fn rgbToYcocg(c: vec3f) -> vec3f {
  return vec3f(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
fn ycocgToRgb(y: vec3f) -> vec3f {
  return vec3f(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z);
}
// a reversible tone map (Karis): the clamp and its statistics where a bright sample does not dominate
fn tmFwd(c: vec3f) -> vec3f { return c / (1.0 + luminance(c)); }
fn tmInv(c: vec3f) -> vec3f { return c / max(1.0 - luminance(c), 1e-4); }

// The history read with a Catmull–Rom filter (9 bilinear taps): a bilinear read blurs it a little at
// every frame's sub-pixel shift — over the 16 frames a block's rays take to cover it, as much as the
// reconstruction it should sharpen
fn historyAt(uv: vec2f, size: vec2f) -> vec3f {
  let sp = uv * size;
  let t1 = floor(sp - 0.5) + 0.5;
  let f = sp - t1;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let t0 = (t1 - 1.0) / size;
  let t3 = (t1 + 2.0) / size;
  let t12 = (t1 + w2 / w12) / size;
  var c = vec3f(0.0);
  c += textureSampleLevel(addTex, samp, vec2f(t0.x, t0.y), 0.0).rgb * w0.x * w0.y;
  c += textureSampleLevel(addTex, samp, vec2f(t12.x, t0.y), 0.0).rgb * w12.x * w0.y;
  c += textureSampleLevel(addTex, samp, vec2f(t3.x, t0.y), 0.0).rgb * w3.x * w0.y;
  c += textureSampleLevel(addTex, samp, vec2f(t0.x, t12.y), 0.0).rgb * w0.x * w12.y;
  c += textureSampleLevel(addTex, samp, vec2f(t12.x, t12.y), 0.0).rgb * w12.x * w12.y;
  c += textureSampleLevel(addTex, samp, vec2f(t3.x, t12.y), 0.0).rgb * w3.x * w12.y;
  c += textureSampleLevel(addTex, samp, vec2f(t0.x, t3.y), 0.0).rgb * w0.x * w3.y;
  c += textureSampleLevel(addTex, samp, vec2f(t12.x, t3.y), 0.0).rgb * w12.x * w3.y;
  c += textureSampleLevel(addTex, samp, vec2f(t3.x, t3.y), 0.0).rgb * w3.x * w3.y;
  return max(c, vec3f(0.0));
}

// The ground's albedo history (RASTER_DETAIL: r its luminance, g its coverage — 0 the sky's, a tree's), read as historyAt
// reads the colour's — the same Catmull–Rom, so blurred alike — and written beside it each frame
@group(0) @binding(28) var albPrev: texture_2d<f32>;
@group(0) @binding(29) var albOut: texture_storage_2d<rgba16float, write>;
fn albHistAt(uv: vec2f, size: vec2f) -> vec2f {
  let sp = uv * size;
  let t1 = floor(sp - 0.5) + 0.5;
  let f = sp - t1;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let t0 = (t1 - 1.0) / size;
  let t3 = (t1 + 2.0) / size;
  let t12 = (t1 + w2 / w12) / size;
  var c = vec2f(0.0);
  c += textureSampleLevel(albPrev, samp, vec2f(t0.x, t0.y), 0.0).rg * w0.x * w0.y;
  c += textureSampleLevel(albPrev, samp, vec2f(t12.x, t0.y), 0.0).rg * w12.x * w0.y;
  c += textureSampleLevel(albPrev, samp, vec2f(t3.x, t0.y), 0.0).rg * w3.x * w0.y;
  c += textureSampleLevel(albPrev, samp, vec2f(t0.x, t12.y), 0.0).rg * w0.x * w12.y;
  c += textureSampleLevel(albPrev, samp, vec2f(t12.x, t12.y), 0.0).rg * w12.x * w12.y;
  c += textureSampleLevel(albPrev, samp, vec2f(t3.x, t12.y), 0.0).rg * w3.x * w12.y;
  c += textureSampleLevel(albPrev, samp, vec2f(t0.x, t3.y), 0.0).rg * w0.x * w3.y;
  c += textureSampleLevel(albPrev, samp, vec2f(t12.x, t3.y), 0.0).rg * w12.x * w3.y;
  c += textureSampleLevel(albPrev, samp, vec2f(t3.x, t3.y), 0.0).rg * w3.x * w3.y;
  return c;
}

// A pixel's direction now (d0, the current camera's) as it was seen from the previous frame's camera:
// what lies at a finite depth [M] moved by the camera's displacement — parallax —, a near body's ground
// carried by the body's own rigid move (R4); the far sky by the turn alone
fn reprojDir(d0: vec3f, depth: f32) -> vec3f {
  if (depth >= 1e8) { return d0; }
  let P = d0 * depth;
  if (TA.cc.w > 0.5 && depth < abs(TA.drift.w)) {
    let rel = P - TA.cc.xyz;
    return normalize(TA.cc.xyz + TA.drift.xyz + vec3f(dot(rel, TA.m0.xyz), dot(rel, TA.m1.xyz), dot(rel, TA.m2.xyz)));
  }
  return normalize(P + TA.drift.xyz);
}
// the current camera's direction through a pixel (its centre + o [px])
fn pixelDir(p: vec2f, size: vec2u) -> vec3f {
  let ndc = vec2f(2.0 * p.x / f32(size.x) - 1.0, 1.0 - 2.0 * p.y / f32(size.y));
  return normalize(TA.fwd.xyz + ndc.x * TA.right.w * TA.up.w * TA.right.xyz + ndc.y * TA.right.w * TA.up.xyz);
}
// where a direction was in the previous frame's image (uv), or −1 behind it
fn prevUv(d: vec3f) -> vec2f {
  let zf = dot(d, TA.pFwd.xyz);
  if (zf <= 1e-3) { return vec2f(-1.0); }
  let xp = dot(d, TA.pRight.xyz) / (zf * TA.pRight.w * TA.pUp.w);
  let yp = dot(d, TA.pUp.xyz) / (zf * TA.pRight.w);
  return vec2f(0.5 * (xp + 1.0), 0.5 * (1.0 - yp));
}

// The camera's motion blur: each pixel smeared along the way its point moved on the image since the
// previous frame (reprojDir — the turn, the parallax, a near ground's move), over the shutter's share
// of it (TA.mb.x); 2–12 taps along it, centred. The Ranger is drawn after it: sharp, as the camera
// moves with it.
@compute @workgroup_size(8, 8)
fn motionBlur(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let p = vec2f(gid.xy) + 0.5;
  let uvp = prevUv(reprojDir(pixelDir(p, size), moments[gid.y * size.x + gid.x].y));
  let cur = textureLoad(src, vec2i(gid.xy), 0);
  if (uvp.x < 0.0) {
    textureStore(dst, gid.xy, cur);
    return;
  }
  // (the pixel's travel this frame [px], the shutter's share, at most 40 px)
  var v = (p - uvp * vec2f(size)) * TA.mb.x;
  let lv = length(v);
  if (lv < 0.75) {
    textureStore(dst, gid.xy, cur);
    return;
  }
  v *= min(lv, 40.0) / lv;
  let n = clamp(i32(ceil(min(lv, 40.0))), 2, 12);
  var acc = vec3f(0.0);
  let hi = vec2f(size) - 1.0;
  for (var i = 0; i < n; i++) {
    let f = (f32(i) + 0.5) / f32(n) - 0.5;
    let q = clamp(p + v * f, vec2f(0.0), hi);
    acc += textureLoad(src, vec2i(q), 0).rgb;
  }
  textureStore(dst, gid.xy, vec4f(acc / f32(n), cur.a));
}

@compute @workgroup_size(8, 8)
fn temporal(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let cur = textureLoad(src, vec2i(gid.xy), 0);
  // (RASTER_DETAIL — R.f.z —: this pixel's ground albedo, kept beside the history for the next frame — resampled as it is)
  let aCur = select(0.0, rasterAlb(moments[gid.y * size.x + gid.x].x), R.f.z > 0.5 && R.f.y > 0.5);
  textureStore(albOut, gid.xy, vec4f(aCur, select(0.0, 1.0, aCur > 0.0), 0.0, 0.0));
  // (and its accumulated albedo, once the history gives one — below: written over the line above)
  var aAcc = aCur;
  if (TA.k.y < 0.5) {
    textureStore(dst, gid.xy, cur);
    return;
  }
  let W = size.x;
  if (TA.k.y > 1.5) {
    // the camera held after moving: the history where it was (the same pixel); a pixel the refinement has
    // drawn since the hand-over began (mb.z) takes over by its samples against the history's weight,
    // fading (mb.y) — the realtime rays before are in the history already
    let h = textureLoad(addTex, vec2i(gid.xy), 0);
    let idx = gid.y * W + gid.x;
    var c = h.rgb * TA.k.x;
    var n = h.a;
    // (the last realtime frame's stars — the camera has not moved — where the refinement has not drawn its own)
    var a = 0.0;
    if (stamps[idx] >= bitcast<u32>(TA.mb.z)) {
      let nc = accum[idx].a;
      let nh = h.a * TA.mb.y;
      a = nc / max(nc + nh, 1e-6);
      c = mix(c, cur.rgb, a);
      n = nh + nc;
    }
    c += (1.0 - a) * starsAt(idx) * TA.k.x;
    textureStore(dst, gid.xy, vec4f(max(c, vec3f(0.0)), n));
    return;
  }
  let block = max(R.u.x & 0xffu, 1u);
  // where this pixel's direction was in the previous frame
  let d0 = pixelDir(vec2f(gid.xy) + 0.5, size);
  // (what the pixel shows at a finite depth — a planet's ground under the ship — seen from where the
  // camera was: parallax; the far sky by the turn alone. A pixel reconstructed between rays takes the
  // nearest depth of the fresh samples around it — its own is a frame or more old (UE4's closest depth) —,
  // where a near body's ground is reprojected)
  let isFresh = block <= 1u || stamps[gid.y * W + gid.x] >= R.u.w;
  var depth = moments[gid.y * W + gid.x].y;
  // (a pixel of the raster's — shaded this frame, RASTER_MARK, or left and rebuilt, RASTER_STALE —: its depth is its own,
  // exact at every pixel, and its outline a pixel's; the block's scale is the traced rays')
  let mxp = moments[gid.y * W + gid.x].x;
  // (R.f.y: the raster's rate this frame, 0 without it — marks from before it stopped are not this frame's)
  let rasterPx = R.f.y > 0.5 && (mxp > 1e29 || (R.f.y > 1.5 && mxp < -2.5 && mxp > -3.5));
  if (!isFresh && TA.cc.w > 0.5 && !rasterPx) {
    let stp = i32(max(block / 2u, 1u));
    let hiD = vec2i(size) - 1;
    var dn = 3e38;
    for (var j = -1; j <= 1; j++) {
      for (var i = -1; i <= 1; i++) {
        let qp = clamp(vec2i(gid.xy) + vec2i(i, j) * stp, vec2i(0), hiD);
        let qi = u32(qp.y) * W + u32(qp.x);
        if (stamps[qi] >= R.u.w) { dn = min(dn, moments[qi].y); }
      }
    }
    if (dn < 3e38) { depth = dn; }
  }
  let d = reprojDir(d0, depth);
  let zf = dot(d, TA.pFwd.xyz);
  var alpha = 1.0;
  var hist = cur.rgb;
  var nOut = 0.0;
  // (the near body's ground: drawn afresh — or, the camera carried rigidly with it, where it was: the same
  // pixel — its ridges' edge too: a pixel by the ground (3×3) is carried, or the sky and the ground took
  // it in turn, one clamped, the other not: a checkerboard along the skyline)
  let ground = TA.drift.w != 0.0 && depth < abs(TA.drift.w) && TA.cc.w < 0.5;
  var byGround = ground;
  if (TA.drift.w < 0.0 && !ground) {
    let H = size.y;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let q = clamp(vec2i(gid.xy) + vec2i(dx, dy), vec2i(0), vec2i(i32(W) - 1, i32(H) - 1));
        byGround = byGround || moments[u32(q.y) * W + u32(q.x)].y < -TA.drift.w;
      }
    }
  }
  let carried = byGround && TA.drift.w < 0.0;
  if ((zf > 1e-3 && !ground) || carried) {
    var uv = prevUv(d);
    if (carried) { uv = (vec2f(gid.xy) + 0.5) / vec2f(size); }
    // (the history from under the cockpit's mask — mask.wgsl −1: not traced since it came on, the cabin there — is
    // stale: a fast roll carries the world out from behind the frame onto it; this frame's rays alone there)
    let up = vec2u(clamp(uv * vec2f(size), vec2f(0.0), vec2f(size) - 1.0));
    let mx = moments[up.y * W + up.x].x;
    let underCabin = mx < -0.5 && mx > -1.5;
    if (all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)) && !underCabin) {
      hist = historyAt(uv, vec2f(size)) * TA.k.x;
      // (the ground's detail: the history's colour is its pixels' albedo resampled — blurred as it is —, swapped for the
      // pixel's accumulated one: its jittered reads blended over a few frames (ALB_ALPHA), sharp and antialiased — the texture
      // as a converged view's, the light the history's. Only where the albedo history is whole there — its coverage 1: not at a
      // silhouette, the sky's pixels none —, written with this history — TA.mb.w)
      if (TA.mb.w > 0.5 && aCur > 0.0) {
        let ah = albHistAt(uv, vec2f(size));
        if (ah.y > 0.97 && ah.y < 1.03 && ah.x > 0.0) {
          let aH = ah.x / ah.y;
          aAcc = mix(aH, aCur, ALB_ALPHA);
          hist *= albSwap(aAcc, aH);
        }
      }
      // the range of the current frame around the pixel, at the block's scale (mean ± g σ, YCoCg of the
      // tone-mapped values; the fresh samples' alone, R2's suggestion, read the stamps nine times more for
      // +0.3 ms and nothing measurable)
      let st = select(i32(max(block / 2u, 1u)), 1, rasterPx);
      let hi = vec2i(size) - 1;
      var m1 = vec3f(0.0);
      var m2 = vec3f(0.0);
      var ws = 0.0;
      for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
          let qp = clamp(vec2i(gid.xy) + vec2i(i, j) * st, vec2i(0), hi);
          // (the range at this pixel's albedo: its neighbours' texture is theirs — RASTER_DETAIL)
          let sw = select(1.0, albSwap(aAcc, rasterAlb(moments[u32(qp.y) * W + u32(qp.x)].x)), aAcc > 0.0);
          let q = rgbToYcocg(tmFwd(textureLoad(src, qp, 0).rgb * sw));
          m1 += q;
          m2 += q * q;
          ws += 1.0;
        }
      }
      m1 /= ws;
      var sd = sqrt(max(m2 / ws - m1 * m1, vec3f(0.0)));
      // (a raster pixel left this frame at 1 in 8 or 16: its range from the fresh samples alone round it — this frame's
      // shading, not the blur rebuilt between them, which would pull a sharp history towards itself —, a little wider for
      // their fewness; none fresh enough near: the box above)
      if (rasterPx && mxp < -2.5 && R.f.y > 6.0) {
        var f1 = vec3f(0.0);
        var f2 = vec3f(0.0);
        var fc = 0.0;
        for (var j = -2; j <= 2; j++) {
          for (var i = -2; i <= 2; i++) {
            let qp = clamp(vec2i(gid.xy) + vec2i(i, j), vec2i(0), hi);
            let qi = u32(qp.y) * W + u32(qp.x);
            if (moments[qi].x < 1e29 || stamps[qi] < R.u.w) { continue; }
            let q = rgbToYcocg(tmFwd(textureLoad(src, qp, 0).rgb * albSwap(aAcc, rasterAlb(moments[qi].x))));
            f1 += q;
            f2 += q * q;
            fc += 1.0;
          }
        }
        if (fc >= 2.0) {
          m1 = f1 / fc;
          sd = sqrt(max(f2 / fc - m1 * m1, vec3f(0.0))) * 1.25 + vec3f(0.01);
        }
      }
      let h = rgbToYcocg(tmFwd(hist));
      let g = TA.fwd.w;
      // a ray landed on this pixel this frame, or it was reconstructed between rays
      let fresh = block <= 1u || stamps[gid.y * W + gid.x] >= R.u.w;
      // (the history's accumulated weight, capped: α = w / (n + w) — a pixel's first samples count fully,
      // then less and less, down to 1 / (n_max + 1); between rays w is small: the history kept)
      let nMax = 1.0 / max(TA.k.z, 1e-3) - 1.0;
      var nPrev = clamp(textureSampleLevel(addTex, samp, uv, 0.0).a, 0.0, nMax);
      let w = select(TA.k.w, 1.0, fresh);
      if (carried) {
        // (the ground carried with the camera: its history exact — not clamped to this frame's range, which
        // follows the ridges one ray march finds this frame; refined over ~10 frames: steady. Every pixel
        // alike: the ones between rays, taking half as much, lagged the light a quarter behind — a checkerboard)
        alpha = 0.1;
        nOut = nPrev;
      } else {
        // (clipped towards the mean, not clamped per channel — Salvi —; far outside the range — a
        // disocclusion, a change —, the history's weight cut)
        let lo = m1 - g * sd;
        let hb = m1 + g * sd;
        let dv = h - m1;
        let ext = max(hb - m1, vec3f(1e-5));
        let k = max(max(abs(dv.x) / ext.x, abs(dv.y) / ext.y), abs(dv.z) / ext.z);
        let hc = select(h, m1 + dv / k, k > 1.0);
        if (k > 2.0) { nPrev *= 0.25; }
        hist = tmInv(ycocgToRgb(clamp(hc, lo, hb)));
        alpha = w / (nPrev + w);
        nOut = min(nPrev + w, nMax);
      }
    }
  }
  // (this frame's colour brought to the accumulated albedo too — its own is this frame's jittered read)
  let c = mix(max(hist, vec3f(0.0)), cur.rgb * albSwap(aAcc, aCur), alpha);
  if (aAcc > 0.0) { textureStore(albOut, gid.xy, vec4f(aAcc, 1.0, 0.0, 0.0)); }
  // (the alpha: the history's weight — the variance the refining passes keep there is not needed while it moves)
  textureStore(dst, gid.xy, vec4f(c, nOut));
}

// The occlusion depth [M] the raster passes test against (the astronaut, the grass, the stones, the vessels, the
// station, the Endurance), at full resolution, written each frame after the temporal pass — moments.y stays the
// depth of field's and the reprojection's. A pixel a ray landed on (or every pixel: one ray each, the refinement
// keeping the nearest of its samples — trace.wgsl), its own depth; one reconstructed between the rays, the
// nearest of the fresh samples that enclose it — the block lattice's four (the resolve's bilinear corners). Its
// own was traced one to b² − 1 frames ago: the ground or the sky behind a trunk that now covers it, and the
// grass 14 m away passed in front of the trunk. (Conservative: the grass may go a block short of a trunk's
// edge, where the colour is reconstructed from the trunk's rays anyway.)
@group(0) @binding(24) var<storage, read_write> sceneDepth: array<f32>;
@compute @workgroup_size(8, 8)
fn occlusion(@builtin(global_invocation_id) gid: vec3u) {
  let W = R.u.x >> 16u;
  let H = arrayLength(&sceneDepth) / max(W, 1u);
  if (gid.x >= W || gid.y >= H) { return; }
  let idx = gid.y * W + gid.x;
  let block = max(R.u.x & 0xffu, 1u);
  var depth = moments[idx].y;
  if (block > 1u && stamps[idx] < R.u.w) {
    let size = vec2u(W, H);
    let off = vec2i(i32(R.u.y), i32(R.u.z));
    let nb = vec2i((size + block - 1u) / block);
    let b0 = vec2i(floor((vec2f(gid.xy) + 0.5 - (vec2f(off) + 0.5)) / f32(block)));
    let maxP = vec2i(size) - 1;
    var dn = 3e38;
    for (var j = 0; j <= 1; j++) {
      for (var i = 0; i <= 1; i++) {
        let q = vec2u(min(clamp(b0 + vec2i(i, j), vec2i(0), nb - 1) * i32(block) + off, maxP));
        let qi = q.y * W + q.x;
        if (stamps[qi] >= R.u.w) { dn = min(dn, moments[qi].y); }
      }
    }
    // (none fresh — the first frames after a jump —: its own, as before)
    if (dn < 3e38) { depth = dn; }
  }
  sceneDepth[idx] = depth;
}

// The cloud pass's history (docs/PLAN-NUAGES-AAA.md N1b — trace.wgsl clouds writes cloudCur, its half-size buffers): each
// texel's clouds where they were in the previous frame — reprojected with **their own** distance (the cloud's, not the
// ground's: no smear of a cumulus over the valley behind it under parallax), the history clamped to the 3 × 3 of this
// frame's texels round it (premultiplied light and cover: a cloud uncovered or gone is not dragged), 15 % of this frame's
// mixed in. Light and cover premultiplied; the distances, this frame's. CT.x: the history valid (0: this frame copied).
@group(0) @binding(40) var cloudCurA: texture_2d<f32>;
@group(0) @binding(41) var cloudCurB: texture_2d<f32>;
@group(0) @binding(42) var cloudHistA: texture_2d<f32>;
@group(0) @binding(44) var cloudDstA: texture_storage_2d<rgba32float, write>;
@group(0) @binding(45) var cloudDstB: texture_storage_2d<rgba32float, write>;
@group(0) @binding(46) var<uniform> CT: vec4f;
fn cloudPremul(q: vec2i) -> vec4f {
  let a = textureLoad(cloudCurA, q, 0);
  return vec4f(a.rgb * a.a, a.a);
}
@compute @workgroup_size(8, 8)
fn cloudTemporal(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(cloudCurA);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let p = vec2i(gid.xy);
  let cur = cloudPremul(p);
  let b = textureLoad(cloudCurB, p, 0);
  textureStore(cloudDstB, p, b);
  var out = cur;
  if (CT.x > 0.5 && TA.k.y > 0.5) {
    // (the cloud's distance [M], else far: the sky's turn alone)
    let depth = select(1e9, b.z, b.z > 0.0 && cur.a > 0.0);
    let uv = prevUv(reprojDir(pixelDir(vec2f(gid.xy) + 0.5, size), depth));
    if (all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))) {
      let h = uv * vec2f(size) - 0.5;
      let i0 = vec2i(floor(h));
      let f = h - floor(h);
      let hi = vec2i(size) - 1;
      var hist = vec4f(0.0);
      for (var j = 0; j < 4; j++) {
        let o = vec2i(j & 1, j >> 1);
        let a = textureLoad(cloudHistA, clamp(i0 + o, vec2i(0), hi), 0);
        hist += select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1) * vec4f(a.rgb * a.a, a.a);
      }
      var lo = cur;
      var up = cur;
      for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
          let q = cloudPremul(clamp(p + vec2i(i, j), vec2i(0), hi));
          lo = min(lo, q);
          up = max(up, q);
        }
      }
      out = mix(clamp(hist, lo, up), cur, 0.15);
    }
  }
  textureStore(cloudDstA, p, vec4f(select(vec3f(0.0), out.rgb / out.a, out.a > 1e-6), out.a));
}

// Temporal upsampling (TAAU): the realtime image rendered under the canvas (its render scale) accumulated at the canvas's
// own resolution — each of this frame's samples put where its ray went (the raster's Halton jitter, the rays' Gaussian —
// trace.wgsl rasterJitter, gaussJitter: the same hashes), weighed by its distance to the output pixel's centre, into a
// canvas-sized history reprojected as the native one is (reprojDir); that history clipped to the range of the native
// temporal result about it (lowTex: its 3 × 3 — what the reconstruction trusts, so no ghost outlives it). The native
// result upscaled where there is no history (a jump, a disocclusion, the cockpit's mask). dst: the history (no stars);
// upOut: the image the display shows (the stars splatted over it).
struct Taau {
  s: vec4f, // x: the native result's weight a frame, y: unused, z: the samples' kernel σ [render px], w: the history valid (1)
  u: vec4u, // x: this frame's stamp, y: the raster's jitter Halton's (1), z: the stars splatted this frame (1), w: unused
};
@group(0) @binding(25) var lowTex: texture_2d<f32>;
@group(0) @binding(26) var upOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(27) var<uniform> TU: Taau;
fn taauPcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn taauHalton(i: u32, b: u32) -> f32 {
  var f = 1.0;
  var r = 0.0;
  var n = i;
  while (n > 0u) {
    f /= f32(b);
    r += f * f32(n % b);
    n /= b;
  }
  return r;
}
// where this frame's ray through render pixel q went, from its centre [render px] (trace.wgsl: main, shade)
fn taauJitter(q: vec2u, raster: bool) -> vec2f {
  if (raster && TU.u.y != 0u) {
    let i = TU.u.x % 16u + 1u;
    return vec2f(taauHalton(i, 2u), taauHalton(i, 3u)) - 0.5;
  }
  let h = taauPcg(q.x ^ taauPcg(q.y ^ taauPcg(TU.u.x)));
  let u = vec2f(f32(h >> 8u), f32(taauPcg(h) >> 8u)) * (1.0 / 16777216.0);
  let rad = 0.42 * sqrt(-2.0 * log(max(u.x, 1e-7)));
  return rad * vec2f(cos(6.28318531 * u.y), sin(6.28318531 * u.y));
}
// the native result upscaled (Catmull–Rom, 9 bilinear taps)
fn lowAt(uv: vec2f, size: vec2f) -> vec3f {
  let sp = uv * size;
  let t1 = floor(sp - 0.5) + 0.5;
  let f = sp - t1;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let t0 = (t1 - 1.0) / size;
  let t3 = (t1 + 2.0) / size;
  let t12 = (t1 + w2 / w12) / size;
  var c = vec3f(0.0);
  c += textureSampleLevel(lowTex, samp, vec2f(t0.x, t0.y), 0.0).rgb * w0.x * w0.y;
  c += textureSampleLevel(lowTex, samp, vec2f(t12.x, t0.y), 0.0).rgb * w12.x * w0.y;
  c += textureSampleLevel(lowTex, samp, vec2f(t3.x, t0.y), 0.0).rgb * w3.x * w0.y;
  c += textureSampleLevel(lowTex, samp, vec2f(t0.x, t12.y), 0.0).rgb * w0.x * w12.y;
  c += textureSampleLevel(lowTex, samp, vec2f(t12.x, t12.y), 0.0).rgb * w12.x * w12.y;
  c += textureSampleLevel(lowTex, samp, vec2f(t3.x, t12.y), 0.0).rgb * w3.x * w12.y;
  c += textureSampleLevel(lowTex, samp, vec2f(t0.x, t3.y), 0.0).rgb * w0.x * w3.y;
  c += textureSampleLevel(lowTex, samp, vec2f(t12.x, t3.y), 0.0).rgb * w12.x * w3.y;
  c += textureSampleLevel(lowTex, samp, vec2f(t3.x, t3.y), 0.0).rgb * w3.x * w3.y;
  return max(c, vec3f(0.0));
}
@compute @workgroup_size(8, 8)
fn taau(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(upOut);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let rs = textureDimensions(src);
  let W = rs.x;
  let o = vec2f(gid.xy) + 0.5;
  let uvO = o / vec2f(size);
  // (the output pixel's centre on the render grid)
  let c = uvO * vec2f(rs);
  let base = clamp(vec2i(floor(c)), vec2i(0), vec2i(rs) - 1);
  let hi = vec2i(rs) - 1;
  // this frame's samples about it, each where its ray went; the native result's range there
  var sum = vec3f(0.0);
  var wsum = 0.0;
  var m1 = vec3f(0.0);
  var m2 = vec3f(0.0);
  let inv2s2 = 0.5 / (TU.s.z * TU.s.z);
  var dn = 3e38;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = clamp(base + vec2i(i, j), vec2i(0), hi);
      let n = rgbToYcocg(tmFwd(textureLoad(lowTex, q, 0).rgb));
      m1 += n;
      m2 += n * n;
      let qi = u32(q.y) * W + u32(q.x);
      dn = min(dn, moments[qi].y);
      if (stamps[qi] == TU.u.x) {
        let pos = vec2f(q) + 0.5 + taauJitter(vec2u(q), moments[qi].x > 1e29);
        let d = pos - c;
        let w = exp(-dot(d, d) * inv2s2);
        let s = textureLoad(src, q, 0).rgb;
        sum += w * s;
        wsum += w;
      }
    }
  }
  let bi = u32(base.y) * W + u32(base.x);
  // (the nearest depth about it — UE4's closest depth —: an outline's pixel carried with the ridge, not the far ground behind)
  let depth = dn;
  let mx = moments[bi].x;
  let underCabin = mx < -0.5 && mx > -1.5;
  // (the history where this pixel's point was: as the native pass finds it — the near body's ground drawn afresh has none)
  let ground = TA.drift.w != 0.0 && depth < abs(TA.drift.w) && TA.cc.w < 0.5;
  let carried = TA.drift.w < 0.0 && ground;
  var uv = vec2f(-1.0);
  if (carried) {
    uv = uvO;
  } else if (!ground) {
    let d = reprojDir(pixelDir(o, size), depth);
    if (dot(d, TA.pFwd.xyz) > 1e-3) { uv = prevUv(d); }
  }
  var outc: vec3f;
  var nOut: f32;
  let nMax = 1.0 / max(TA.k.z, 1e-3) - 1.0;
  if (TU.s.w > 0.5 && !underCabin && all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))) {
    let hist = historyAt(uv, vec2f(size)) * TA.k.x;
    var nPrev = clamp(textureSampleLevel(addTex, samp, uv, 0.0).a, 0.0, nMax);
    // (clipped towards the native result's mean about it, within g of its standard deviations — Salvi, as the native pass
    // does —: far outside it, a change, the history's weight cut)
    let h = rgbToYcocg(tmFwd(hist));
    let m = m1 / 9.0;
    let ext = max(TA.fwd.w * sqrt(max(m2 / 9.0 - m * m, vec3f(0.0))), vec3f(1e-4));
    let dv = h - m;
    let k = max(max(abs(dv.x) / ext.x, abs(dv.y) / ext.y), abs(dv.z) / ext.z);
    let hc = select(h, m + dv / k, k > 1.0);
    if (k > 2.0) { nPrev *= 0.25; }
    // (and pulled a little towards the native result each frame — TU.s.x —: where few samples land, the history cannot drift
    // from it however long the turn)
    let hcl = mix(tmInv(ycocgToRgb(hc)), lowAt(uvO, vec2f(rs)), TU.s.x);
    if (wsum > 1e-4) {
      let a = wsum / (nPrev + wsum);
      outc = mix(hcl, sum / wsum, a);
      nOut = min(nPrev + wsum, nMax);
    } else {
      outc = hcl;
      nOut = nPrev;
    }
  } else {
    // (no history: the native result upscaled, this frame's samples over it as far as they reach)
    let l = lowAt(uvO, vec2f(rs));
    outc = select(l, mix(l, sum / max(wsum, 1e-6), wsum / (1.0 + wsum)), wsum > 1e-4);
    nOut = 1.0 + wsum;
  }
  outc = max(outc, vec3f(0.0));
  textureStore(dst, gid.xy, vec4f(outc, nOut));
  // (the stars splatted on the render grid: the nearest's, its flux kept over the canvas's smaller pixels)
  let sc = f32(rs.x * rs.y) / f32(size.x * size.y);
  textureStore(upOut, gid.xy, vec4f(outc + starsAt(bi) * sc * f32(TU.u.z), 1.0));
}
