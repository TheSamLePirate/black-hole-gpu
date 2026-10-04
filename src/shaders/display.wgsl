// Final image: HDR radiance (+ bloom) → exposure → tone mapping → sRGB.

struct Display {
  size: vec4f,  // output W, H, exposure (linear multiplier), tonemap (0 AgX, 1 AgX punchy, 2 ACES, 3 clamp, 4 film)
  flags: vec4f, // debug mode (1 = bypass exposure/tonemap/bloom), bloom strength, bloom levels, dither (0/1)
  view: vec4f,  // image placement in the output (uv): scale x, y, offset x, y (letterboxed preview)
  hdr: vec4f,   // extended-range output (0/1), peak in units of SDR white, lens flare strength, the shadows
                // kept from "AgX punchy"'s deepening (0…1: a landscape in the Earth's air)
  pol: vec4f,   // polarization ticks (0/1), cell size [image px], grid W, grid H
  img: vec4f,   // image W, H [px], polarization fraction drawn at full tick length, radio colour map (0/1)
  lod: vec4f,   // mip level of the HDR image to display (instrument beam), the Ranger drawn (0/1), depth of field (0/1), sharpening (RCAS, 0…1)
  ship: vec4f,  // the Ranger's box in the image [px]: x, y, width, height (its image holds only that)
  eye: vec4f,   // the Purkinje shift's strength (0 none … 1 the eye's), unused ×3
};

@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var<uniform> D: Display;
@group(0) @binding(2) var bloom: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var<storage, read> polGrid: array<vec4f>; // Σ I, Q, U, n per tick cell
@group(0) @binding(5) var ship: texture_2d<f32>; // the Ranger, premultiplied (same scale as hdr)
@group(0) @binding(6) var plumes: texture_2d<f32>; // its thrusters' flames (half resolution, added)
@group(0) @binding(7) var dofImg: texture_2d<f32>; // the image through the depth of field (when on)
@group(0) @binding(8) var bloomMips: texture_2d<f32>; // the bloom's levels (the flare's soft sources)
@group(0) @binding(9) var<storage, read> flareM: array<vec4f>; // [0]: mean excess over white, its centroid (uv)
@group(0) @binding(10) var lensDirt: texture_2d<f32>; // the lens's dust and smudges (black: none)

const LUMA = vec3f(0.2126, 0.7152, 0.0722);

// AMD FidelityFX RCAS (robust contrast-adaptive sharpening, FSR 1) on the HDR image's texel at p, in a
// reversible tone-mapped space (x / (1 + x) of the exposed value: the sky's 10⁴ and the shadows alike):
// the cross's four neighbours give the most negative lobe that keeps the result within their range — no
// ringing —, damped where the cross is noisy (its centre an outlier); amount 0…1 (FSR's sharpness
// 2 stops … 0). Returns the sharpened texel minus the texel: added to the bilinear sample.
fn rcasDelta(p: vec2i, amount: f32, expo: f32) -> vec3f {
  let dim = vec2i(textureDimensions(hdr, 0));
  let q = clamp(p, vec2i(1), dim - 2);
  let tm = 1.0 / max(expo, 1e-30);
  let e0 = textureLoad(hdr, q, 0).rgb;
  let e = e0 * expo / (1.0 + e0 * expo);
  let bb = textureLoad(hdr, q + vec2i(0, -1), 0).rgb;
  let dd = textureLoad(hdr, q + vec2i(-1, 0), 0).rgb;
  let ff = textureLoad(hdr, q + vec2i(1, 0), 0).rgb;
  let hh = textureLoad(hdr, q + vec2i(0, 1), 0).rgb;
  let b = bb * expo / (1.0 + bb * expo);
  let d = dd * expo / (1.0 + dd * expo);
  let f = ff * expo / (1.0 + ff * expo);
  let h = hh * expo / (1.0 + hh * expo);
  let mn4 = min(min(b, d), min(f, h));
  let mx4 = max(max(b, d), max(f, h));
  let hitMin = mn4 / max(4.0 * mx4, vec3f(1e-6));
  let hitMax = (vec3f(1.0) - mx4) / min(4.0 * mn4 - 4.0, vec3f(-1e-6));
  let lobeRGB = max(-hitMin, hitMax);
  var lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * exp2(-2.0 * (1.0 - amount));
  // (noise: the centre far off the cross's mean, against its range — the lobe eased)
  let lb = dot(b, LUMA);
  let ld = dot(d, LUMA);
  let lf = dot(f, LUMA);
  let lh = dot(h, LUMA);
  let le = dot(e, LUMA);
  let nz = abs(0.25 * (lb + ld + lf + lh) - le) / max(max(max(max(lb, ld), max(lf, lh)), le) - min(min(min(lb, ld), min(lf, lh)), le), 1e-6);
  lobe *= 1.0 - 0.5 * clamp(nz, 0.0, 1.0);
  let o = clamp((lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0), vec3f(0.0), vec3f(0.999));
  return (o / (1.0 - o)) * tm - e0;
}
// (x² — WGSL's pow is exp2(y·log2 x): undefined for x < 0 on some backends, D3D and Vulkan among them)
fn sq(x: f32) -> f32 { return x * x; }
// Lens flare (a camera's, as in the film): what is brighter than SDR white in the bloom's image —
// the lens's own glare of the scene — reflected between the lens elements: ghosts along the line
// through the image's centre (mirrored, tinted by the coatings), and a halo — a ring around the centre
// through the light, violet at its edge (chromatic).
// (read from a coarse level: a ghost is a defocused image — a soft patch, not a copy of the scene)
fn flareSrc(q: vec2f, lod: f32) -> vec3f {
  if (any(q < vec2f(0.0)) || any(q > vec2f(1.0))) { return vec3f(0.0); }
  let l = min(lod, f32(textureNumLevels(bloomMips)) - 1.0);
  // (level l sums the image's levels l + 1 … n − 1: their mean)
  let b = textureSampleLevel(bloomMips, samp, q, l).rgb / max(D.flags.z - l, 1.0) * D.size.z;
  // (the coatings colour a ghost, not the light: its brightness only)
  return vec3f(max(dot(b, LUMA) - 0.35, 0.0));
}
// The lens's dust: a smudged front element shows only when bright light floods it — the glare over
// white, spread wide (the bloom's coarsest levels), lighting its specks where they are (the screen's uv)
fn lensDirtGlow(uvOut: vec2f, uv: vec2f) -> vec3f {
  let dirt = textureSampleLevel(lensDirt, samp, uvOut, 0.0).rgb;
  // (the glare at the specks — the bloom's wide levels, their mean — and over the whole lens)
  let n = f32(textureNumLevels(bloomMips));
  let l = max(n - 3.0, 0.0);
  let near = textureSampleLevel(bloomMips, samp, clamp(uv, vec2f(0.0), vec2f(1.0)), l).rgb / max(D.flags.z - l, 1.0);
  let all = textureSampleLevel(bloomMips, samp, vec2f(0.5), n - 1.0).rgb;
  let glow = max(dot(near * D.size.z, LUMA) - 0.12, 0.0) + 0.3 * max(dot(all * D.size.z, LUMA) - 0.12, 0.0);
  return dirt * glow * vec3f(1.0, 0.95, 0.88) * 2.5;
}
fn lensFlare(uv: vec2f) -> vec3f {
  let aspect = D.img.x / max(D.img.y, 1.0);
  let toC = vec2f(0.5) - uv;
  var f = vec3f(0.0);
  // ghosts: images of the light mirrored through the centre, at several scales
  let ks = array<f32, 4>(0.45, 0.8, 1.25, 1.7);
  let tints = array<vec3f, 4>(vec3f(0.5, 0.3, 0.95), vec3f(0.85, 0.5, 0.3), vec3f(0.3, 0.55, 0.95), vec3f(0.75, 0.3, 0.8));
  for (var i = 0; i < 4; i++) {
    let q = uv + toC * (2.0 * ks[i]) ;
    let fall = 1.0 - smoothstep(0.0, 0.75, length((q - 0.5) * vec2f(aspect, 1.0)));
    f += flareSrc(q, 3.0 + f32(i & 1)) * tints[i] * fall * 0.3;
  }
  // the halo: a ring of radius h around the centre, the light it passes through reflected onto it
  let d = toC * vec2f(aspect, 1.0);
  let dl = max(length(d), 1e-4);
  let dir = d / dl / vec2f(aspect, 1.0);
  let h = 0.42;
  let ring = smoothstep(0.0, 0.25, dl) * (1.0 - smoothstep(0.7, 1.0, dl / 0.75));
  let hr = flareSrc(uv + dir * (h * 0.96), 2.0).r;
  let hg = flareSrc(uv + dir * h, 2.0).g;
  let hb = flareSrc(uv + dir * (h * 1.04), 2.0).b;
  f += vec3f(hr * 0.7, hg * 0.3, hb * 1.0) * ring * 0.2;
  // the aperture's ghosts: images of the diaphragm (a disc, its rim bright, coloured by dispersion —
  // red outside, violet inside) on the line from the light through the centre, mirrored — sharp
  // whatever the light's shape
  let m = flareM[0];
  let e = 1.5 * (1.0 - exp(-m.x * 20.0));
  if (e > 0.0) {
    let p = uv * vec2f(aspect, 1.0);
    let lc = m.yz;
    let rs = array<f32, 3>(0.2, 0.075, 0.045);
    let ks2 = array<f32, 3>(0.85, 1.45, 0.35);
    let gs = array<f32, 3>(1.0, 0.3, 0.2);
    for (var i = 0; i < 3; i++) {
      let gc = (vec2f(0.5) + (vec2f(0.5) - lc) * ks2[i]) * vec2f(aspect, 1.0);
      let r = rs[i];
      let d = length(p - gc);
      let w = 0.004 + 0.02 * r;
      let rim = vec3f(exp(-sq((d - r * 1.02) / w)), exp(-sq((d - r) / w)), exp(-sq((d - r * 0.98) / w)));
      let fill = (1.0 - smoothstep(r * 0.92, r, d)) * 0.07;
      f += e * gs[i] * (vec3f(1.0, 0.22, 0.85) * rim + vec3f(0.55, 0.3, 0.9) * fill);
    }
  }
  return f;
}

struct VSOut { @builtin(position) pos: vec4f };

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  let uv = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VSOut;
  o.pos = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

// Minimal AgX (Troy Sobotka's AgX, polynomial fit by Benjamin Wrensch).
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agx(c: vec3f, punchy: bool, keep: f32) -> vec3f {
  let m = mat3x3f(
    0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var v = m * max(c, vec3f(1e-10));
  v = clamp(log2(v), vec3f(minEv), vec3f(maxEv));
  v = (v - minEv) / (maxEv - minEv);
  v = agxContrast(v);
  if (punchy) {
    let luma = dot(v, vec3f(0.2126, 0.7152, 0.0722));
    // (its contrast: the mid-tones and highlights deepened — and the shadows with them, three stops under
    // the mid-grey nearly black: a sunlit landscape's shade (keep) left as AgX draws it, a dark grey)
    v = mix(pow(max(v, vec3f(0.0)), vec3f(1.35)), v, keep * (1.0 - smoothstep(0.3, 0.65, luma)));
    v = luma + 1.4 * (v - luma);
  }
  let mi = mat3x3f(
    1.19687900512017, -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  return pow(max(mi * v, vec3f(0.0)), vec3f(2.2));
}

// ACES filmic fit (Stephen Hill), linear sRGB in and out.
fn aces(c: vec3f) -> vec3f {
  let mIn = mat3x3f(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  let mOut = mat3x3f(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  let v = mIn * c;
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(mOut * (a / b), vec3f(0.0), vec3f(1.0));
}

// Extended-range display mapping (EDR/HDR canvas, 1 = SDR white). Linear up to a knee, then an
// exponential shoulder that reaches the display peak asymptotically, applied to the max channel so
// hues are preserved; the brightest highlights drift towards white, as film and AgX do.
fn hdrMap(c: vec3f, peak: f32, punchy: bool) -> vec3f {
  var v = max(c, vec3f(0.0));
  if (punchy) {
    // same saturation lift as "AgX punchy", relative to luminance
    let l = dot(v, vec3f(0.2126, 0.7152, 0.0722));
    v = max(vec3f(l) + 1.15 * (v - vec3f(l)), vec3f(0.0));
  }
  let m = max(max(v.r, v.g), v.b);
  let knee = min(0.6, 0.5 * peak);
  if (m <= knee) { return v; }
  let span = peak - knee;
  let m2 = knee + span * (1.0 - exp(-(m - knee) / span));
  let scaled = v * (m2 / m);
  let w = smoothstep(0.3, 1.0, (m2 - knee) / span);
  return mix(scaled, vec3f(m2), 0.75 * w);
}

// The film's look (Interstellar's Gargantua): 2 EV of overexposure, split toning (cool shadows,
// warm highlights), saturated orange mid-tones kept from turning yellow — in linear light, before
// the curve.
fn filmGrade(c0: vec3f) -> vec3f {
  var c = max(c0 * 4.0, vec3f(0.0));
  let l = dot(c, LUMA);
  // shadows towards teal (the film's blue-black space)
  let sh = 1.0 - smoothstep(0.0, 0.2, l);
  c = max(c + vec3f(-0.003, 0.002, 0.01) * sh, vec3f(0.0));
  // mid-tones more saturated (the orange strands); the highlights lose it in the curve
  let mid = smoothstep(0.01, 0.25, l) * (1.0 - smoothstep(0.8, 4.0, l));
  let l2 = dot(c, LUMA);
  c = max(vec3f(l2) + (1.0 + 0.3 * mid) * (c - vec3f(l2)), vec3f(0.0));
  // (the mid-tones towards orange-red: the green and blue held back, else the roll-off turns them gold —
  // the warm ones only: the disk's strands; a grey or bluish mid-tone — moonlit clouds, a twilight sky —
  // keeps its hue)
  let warm = smoothstep(0.1, 0.5, (c.r - c.b) / max(l2, 1e-6));
  return c * mix(vec3f(1.0), vec3f(1.0, 0.86, 0.72), mid * warm);
}
// Its curve (SDR): each channel rolls off on its own, as a film's dye layers — the red saturates
// first, orange turns yellow then white — to a warm cream at the top, with a gentle S for contrast.
fn film(c: vec3f) -> vec3f {
  let x = filmGrade(c);
  let W = 5.0;
  var v = x * (1.0 + x / (W * W)) / (1.0 + x);
  v = clamp(v, vec3f(0.0), vec3f(1.0));
  // (a hard toe: only the brightest burns out, the lanes and space stay deep)
  v = pow(v, vec3f(1.45));
  v = mix(v, v * v * (3.0 - 2.0 * v), 0.4);
  let m = max(v.r, max(v.g, v.b));
  v = mix(v, vec3f(1.0, 0.96, 0.87) * m, 0.5 * smoothstep(0.8, 1.0, m));
  // (back to display-linear: the curve above is in display space)
  return pow(v, vec3f(2.2));
}

// The same on an extended-range display: the SDR curve (its toe keeps the lanes and space deep), and
// what burns out there — the disk's heart — lifted above SDR white towards the peak.
fn filmHdr(c: vec3f, peak: f32) -> vec3f {
  let v = film(c);
  let m = max(v.r, max(v.g, v.b));
  let k = smoothstep(0.8, 1.0, m);
  return v * (1.0 + (max(0.6 * peak, 1.0) - 1.0) * k * k);
}

fn srgbToLinear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

fn srgbEncode(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

fn viridis(t0: f32) -> vec3f {
  let t = clamp(t0, 0.0, 1.0);
  let c0 = vec3f(0.2777, 0.0054, 0.3341);
  let c1 = vec3f(0.1051, 1.4046, 1.3846);
  let c2 = vec3f(-0.3309, 0.2148, 0.0951);
  let c3 = vec3f(-4.6342, -5.7991, -19.3324);
  let c4 = vec3f(6.2283, 14.1799, 56.6906);
  let c5 = vec3f(4.7764, -13.7451, -65.3530);
  let c6 = vec3f(-5.4355, 4.6459, 26.3124);
  return clamp(c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6))))), vec3f(0.0), vec3f(1.0));
}

// Electric-vector position angle ticks (as in EHT polarimetric images): orientation χ = ½ atan2(U, Q)
// from screen-up towards screen-right, length ∝ fractional polarization, colour = fraction.
fn polTick(uv: vec2f, c: vec3f) -> vec3f {
  let pt = uv * D.img.xy;
  let cs = D.pol.y;
  let cell = vec2i(floor(pt / cs));
  let gw = i32(D.pol.z);
  let gh = i32(D.pol.w);
  if (cell.x < 0 || cell.y < 0 || cell.x >= gw || cell.y >= gh) { return c; }
  let g = polGrid[cell.y * gw + cell.x];
  let n = max(g.w, 1.0);
  let I = g.x / n;
  let qu = g.yz / n;
  let P = length(qu);
  let frac = P / max(I, 1e-12);
  // only where the source is visible (exposed cell intensity) and measurably polarized
  if (I * D.size.z < 0.03 || frac < 2e-3) { return c; }
  let chi = 0.5 * atan2(qu.y, qu.x);
  let dir = vec2f(sin(chi), -cos(chi));
  let d = pt - (vec2f(cell) + 0.5) * cs;
  let along = abs(dot(d, dir));
  let perp = abs(d.x * dir.y - d.y * dir.x);
  let halfLen = 0.46 * cs * clamp(frac / D.img.z, 0.25, 1.0);
  let w = max(0.7, D.img.y / 900.0);
  let px = max(D.img.y / D.size.y, 1.0); // image pixels per output pixel (antialiasing width)
  let a = (1.0 - smoothstep(w, w + px, perp)) * (1.0 - smoothstep(halfLen, halfLen + px, along));
  return mix(c, viridis(frac / D.img.z), a);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let uvOut = in.pos.xy / D.size.xy;
  let uv = (uvOut - D.view.zw) / D.view.xy;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  var c = textureSampleLevel(hdr, samp, uv, D.lod.x).rgb;
  if (D.lod.w > 0.0 && D.lod.x == 0.0 && D.flags.x < 0.5) {
    c = max(c + rcasDelta(vec2i(uv * vec2f(textureDimensions(hdr, 0))), D.lod.w, D.size.z), vec3f(0.0));
  }
  if (D.lod.z > 0.5 && D.lod.x == 0.0) {
    // (the half-resolution blur where the circle of confusion is over a pixel or so)
    let dv = textureSampleLevel(dofImg, samp, uv, 0.0);
    c = mix(c, dv.rgb, smoothstep(0.6, 2.0, dv.a));
  }
  if (D.lod.y > 0.5) {
    // the Ranger over the traced image, within its box (the glare below still spills over its silhouette)
    let q = uv * D.img.xy - D.ship.xy;
    if (all(q >= vec2f(0.0)) && all(q < D.ship.zw)) {
      let sp = textureLoad(ship, vec2i(uv * D.img.xy), 0);
      c = min(sp.rgb, vec3f(60000.0)) + (1.0 - sp.a) * c;
    }
    // (the flames and the plasma added; the condensation trails over what is behind them — their
    // coverage in alpha)
    let pl = textureSampleLevel(plumes, samp, uv, 0.0);
    c = c * (1.0 - clamp(pl.a, 0.0, 1.0)) + min(pl.rgb, vec3f(60000.0));
  }
  if (D.flags.x < 0.5) {
    let b = textureSampleLevel(bloom, samp, uv, 0.0).rgb / max(D.flags.z, 1.0);
    let tm = u32(D.size.w);
    // (the film: the bloom a strong haze added over the sharp image — the camera's veiling glare —
    // rather than the eye's energy-conserving spread)
    if (tm == 4u) { c = c * (1.0 - 0.3 * D.flags.y) + b * (2.5 * D.flags.y); } else { c = mix(c, b, D.flags.y); }
    if (D.hdr.z > 0.0) { c += D.hdr.z * (lensFlare(uv) + lensDirtGlow(uvOut, uv)) / max(D.size.z, 1e-30); }
    c *= D.size.z;
    // (the eye at night — Purkinje: adapted to the dark (eye.x: from the exposure's level) the rods take
    // over, blind to red, keen on blue-green — the dim parts bluer and greyer, as one sees a moonlit
    // field; the bright lights still seen by the cones, in their colours)
    if (D.eye.x > 0.0) {
      let Lp = dot(c, LUMA);
      let Ls = dot(c, vec3f(0.02, 0.42, 0.56));
      let k = D.eye.x * (1.0 - smoothstep(0.08, 0.8, Lp));
      c = mix(c, Ls * vec3f(0.62, 0.82, 1.08), 0.75 * k);
    }
    if (D.img.w > 0.5) {
      // radio brightness temperature on the "afmhot" scale of EHT images (linear, exposure = peak)
      let t = clamp(c.g, 0.0, 1.0);
      c = srgbToLinear(clamp(vec3f(2.0 * t, 2.0 * t - 0.5, 2.0 * t - 1.0), vec3f(0.0), vec3f(1.0)));
    } else if (D.hdr.x > 0.5) {
      if (tm == 3u) { c = min(c, vec3f(D.hdr.y)); } else if (tm == 4u) { c = filmHdr(c, D.hdr.y); } else { c = hdrMap(c, D.hdr.y, tm == 1u); }
    } else if (tm == 0u) { c = agx(c, false, 0.0); } else if (tm == 1u) { c = agx(c, true, D.hdr.w); } else if (tm == 2u) { c = aces(c); } else if (tm == 4u) { c = film(c); }
  }
  // extended sRGB: values above 1 are brighter than SDR white on an HDR canvas
  c = clamp(c, vec3f(0.0), vec3f(select(1.0, D.hdr.y, D.hdr.x > 0.5)));
  if (D.pol.x > 0.5) { c = polTick(uv, c); }
  // Tiny dither against banding in the dark sky: triangular (TPDF, ±1 code — no noise modulation with
  // the signal) from two interleaved-gradient-noise draws (blue-ish: fine grain, no clumps)
  let q = in.pos.xy;
  let n = fract(52.9829189 * fract(dot(q, vec2f(0.06711056, 0.00583715))))
    + fract(52.9829189 * fract(dot(q + vec2f(47.0, 17.0), vec2f(0.06711056, 0.00583715)))) - 1.0;
  return vec4f(srgbEncode(c) + n * D.flags.w / 255.0, 1.0);
}
