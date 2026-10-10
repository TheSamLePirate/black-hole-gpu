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
  rain: vec4f,  // the rain (PLAN-METEO W5): its strength (0 none … 1.3), a clock [s], in the cabin (1: the
                // canopy's drops) + 2 for Mars's dust (W6: grains, not drops), the vertical field's half tangent
  rainV: vec4f, // the drops' velocity relative to the camera [m/s, its axes: right, up, forward], their speed
  rainX: vec4f, // the rain's more (PLAN-PLUIE): the flown craft's distance from the camera [m] (0: none — the
                // drops beyond it hidden by it), the gusts (0…1: the curtains), the camera's lens wet (0/1), unused
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

// The HDR image at uv by a Catmull–Rom spline (9 bilinear taps; Jimenez's): its negative lobes keep the
// edges an upscale would blur; clamped at 0 (its ringing below black)
fn catmullRom(uv: vec2f) -> vec3f {
  let size = vec2f(textureDimensions(hdr, 0));
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
  c += textureSampleLevel(hdr, samp, vec2f(t0.x, t0.y), 0.0).rgb * w0.x * w0.y;
  c += textureSampleLevel(hdr, samp, vec2f(t12.x, t0.y), 0.0).rgb * w12.x * w0.y;
  c += textureSampleLevel(hdr, samp, vec2f(t3.x, t0.y), 0.0).rgb * w3.x * w0.y;
  c += textureSampleLevel(hdr, samp, vec2f(t0.x, t12.y), 0.0).rgb * w0.x * w12.y;
  c += textureSampleLevel(hdr, samp, vec2f(t12.x, t12.y), 0.0).rgb * w12.x * w12.y;
  c += textureSampleLevel(hdr, samp, vec2f(t3.x, t12.y), 0.0).rgb * w3.x * w12.y;
  c += textureSampleLevel(hdr, samp, vec2f(t0.x, t3.y), 0.0).rgb * w0.x * w3.y;
  c += textureSampleLevel(hdr, samp, vec2f(t12.x, t3.y), 0.0).rgb * w12.x * w3.y;
  c += textureSampleLevel(hdr, samp, vec2f(t3.x, t3.y), 0.0).rgb * w3.x * w3.y;
  return max(c, vec3f(0.0));
}

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

// ---- The rain (PLAN-METEO W5): what falls between the camera and the scene, and on the canopy ----
fn rh21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn rh22(p: vec2f) -> vec2f { return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)))) * 43758.5453); }
// the scene's light round uv (four taps 6 % of the image out): what the drops catch and send on
fn rainLight(uv: vec2f) -> vec3f {
  let o = 0.06;
  return 0.25 * (textureSampleLevel(hdr, samp, uv + vec2f(o, 0.0), 0.0).rgb + textureSampleLevel(hdr, samp, uv - vec2f(o, 0.0), 0.0).rgb
    + textureSampleLevel(hdr, samp, uv + vec2f(0.0, o), 0.0).rgb + textureSampleLevel(hdr, samp, uv - vec2f(0.0, o), 0.0).rgb);
}
// A value noise (bilinear, smoothed) — the curtains' and the veil's
fn rvn(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh21(i), rh21(i + vec2f(1.0, 0.0)), u.x), mix(rh21(i + vec2f(0.0, 1.0)), rh21(i + vec2f(1.0, 1.0)), u.x), u.y);
}
// one streak layer in coordinates (a across, b along the drops' motion, both in cells — b already moved by
// the clock): a drop in some cells — each its own size, sheen and fall (the big ones fall faster, their
// streaks longer) —, its streak L cells long behind it, w cells wide, tapered, brightest at its head;
// x: how much of the pixel it covers (fwa: the pixel across, in cells), y: that cover by its sheen
fn rainCells(a: f32, b0: f32, L: f32, w: f32, fwa: f32, dens: f32, seed: f32) -> vec2f {
  // (each column of cells shifted along by its own amount: no rows of drops lined up — rings, radially)
  let b = b0 + rh21(vec2f(floor(a), seed + 0.37));
  let id = vec2f(floor(a), floor(b));
  let h = rh22(id + seed);
  if (h.x > dens) { return vec2f(0.0); }
  let g = rh22(id + seed + 5.3);
  let size = 0.6 + 1.0 * g.x;
  let sheen = 0.55 + 0.8 * g.y;
  let Ld = min(L * (0.8 + 0.25 * size), 0.9);
  let fa = fract(a);
  let fb = fract(b);
  let ra = 0.15 + 0.7 * h.y;
  // (its head within the cell, the streak behind it inside the cell too)
  let rb = Ld + (1.0 - Ld) * rh21(id + seed + 7.1);
  let wd = w * size;
  let across = 1.0 - smoothstep(0.0, 0.5 * wd + fwa, abs(fa - ra));
  let u = clamp((fb - (rb - Ld)) / max(Ld, 1e-4), 0.0, 1.0);
  let along = smoothstep(rb - Ld, rb - 0.75 * Ld, fb) * (1.0 - smoothstep(rb - 0.015, rb, fb)) * (0.45 + 0.55 * u);
  // (thinner than the pixel: its share of it)
  let c = across * along * min(1.0, wd / max(fwa, 1e-4));
  return vec2f(c, c * sheen);
}
// The falling drops as the camera sees them in its exposure (1/60 s): seven layers, 0.9 to 13 m away. Still
// or slow, streaks parallel — the fall and the wind; moving fast, they rush out of the point the drops come
// from (the focus of expansion), log-polar about it. The near ones out of focus — wide and faint —, the far
// ones paler (the air between). Their density in curtains the wind drives (stronger in gusts and a storm),
// behind them a veil of the rain further off. Those beyond the flown craft hidden by it (shipA: its cover
// at the pixel). x: their cover, y: their sheen (cover-weighted)
fn rainStreaks(uv: vec2f, shipA: f32) -> vec2f {
  let tanH = D.rain.w;
  let asp = D.img.x / D.img.y;
  let n = vec2f((uv.x - 0.5) * 2.0 * tanH * asp, (0.5 - uv.y) * 2.0 * tanH);
  let v = D.rainV.xyz;
  let t = D.rain.y;
  let T = 1.0 / 60.0;
  let k = clamp(D.rain.x, 0.0, 1.3);
  let dust = D.rain.z > 1.5;
  // (the focus of expansion: where the drops come from, when they come at the camera)
  let fz = max(-v.z, 1e-3);
  let foe = -v.xy / fz;
  let radial = select(0.0, 1.0 - smoothstep(0.8 * tanH * asp, 2.5 * tanH * asp, length(foe)), v.z < -1.0);
  let mxy = length(v.xy);
  let dirP = select(vec2f(0.0, -1.0), v.xy / max(mxy, 1e-4), mxy > 0.05);
  let perp = vec2f(-dirP.y, dirP.x);
  let dq = n - foe;
  let r = max(length(dq), 1e-4);
  let th = atan2(dq.y, dq.x);
  // (a screen pixel in the view's tangent — the image placed in the output: its scale)
  let pxT = 2.0 * tanH / max(D.size.y * D.view.y, 1.0);
  // (the curtains: how much the density swings, the gusts and a storm's rain driving it)
  let curt = select(0.35 + 0.45 * D.rainX.y + 0.3 * max(k - 1.0, 0.0) / 0.3, 0.2, dust);
  var cover = 0.0;
  var sheen = 0.0;
  for (var i = 0u; i < 7u; i++) {
    let z = 0.9 * pow(1.55, f32(i));
    let seed = f32(i) * 17.31;
    // (a drop ~1.5 mm across — the near ones out of focus: a blur ~4 mm more —, its spacing 0.1 m in a
    // steady rain; dust: grains, a third as wide)
    let wM = (0.0015 + 0.004 * exp(-0.6 * z)) / z * select(1.0, 0.35, dust);
    // (out of focus, near: as much light spread wider — fainter)
    let blur = 1.0 / (1.0 + 2.2 * exp(-0.9 * z));
    let fade = (1.0 - 0.09 * f32(i)) * blur;
    // (behind the flown craft: hidden by it)
    let hid = select(1.0, 1.0 - shipA, D.rainX.x > 0.0 && z > D.rainX.x);
    // (the curtains at this depth: the density over the ground, metres across, carried by the wind)
    let xm = dot(n, perp) * z + t * 0.35 * mxy;
    let dens0 = select(0.55, 0.35, radial > 0.5) * mix(1.0, 0.35 + 1.3 * rvn(vec2f(xm * 0.18, t * 0.25 + f32(i))), curt);
    var c = vec2f(0.0);
    if (radial < 0.999) {
      let cellA = 0.1 / (z * sqrt(max(k, 0.05)));
      let speed = mxy / z;
      let L = speed * T;
      let cellB = max(3.0 * cellA, 1.6 * L);
      let a = dot(n, perp) / cellA;
      let b = dot(n, dirP) / cellB - t * speed / cellB;
      c += (1.0 - radial) * rainCells(a, b, L / cellB, wM / cellA, pxT / cellA, dens0, seed);
    }
    if (radial > 0.001) {
      let rate = fz / z;
      let N = floor(220.0 / sqrt(z) * sqrt(max(k, 0.05)));
      let a = th * N / 6.2831853;
      let cellR = 0.12;
      let b = (log(r) - t * rate) / cellR;
      let L = rate * T / cellR;
      c += radial * rainCells(a, b, L, wM / r * N / 6.2831853, pxT / r * N / 6.2831853, dens0 * 0.25, seed + 3.3) * (1.0 - 0.1 * f32(i));
    }
    cover += c.x * fade * hid;
    sheen += c.y * fade * hid;
  }
  // (the rain further off: a veil of fine streaks falling, in its own curtains — no grains for dust)
  var veil = 0.0;
  if (!dust) {
    let vx = dot(n, perp) / tanH;
    let vy = dot(n, dirP) / tanH;
    let fall = t * (0.6 + 0.03 * mxy);
    let s1 = rvn(vec2f(vx * 180.0, vy * 3.0 - fall * 6.0));
    let s2 = rvn(vec2f(vx * 97.0 + 13.0, vy * 2.0 - fall * 4.0));
    let sheet = 0.35 + 0.65 * rvn(vec2f(vx * 2.5 + t * 0.05 * (1.0 + mxy), t * 0.07));
    veil = smoothstep(0.6, 1.0, max(s1, s2)) * sheet * (1.0 - radial) * 0.22;
  }
  let kk = min(k, 1.0) * (0.85 + 0.25 * max(k - 1.0, 0.0) / 0.3);
  // (rushing at the camera, the streaks long and many: fainter — as a camera sees them, not a tunnel)
  let cv = clamp((cover * 0.95 * kk + veil * kk) * (1.0 - 0.45 * radial), 0.0, mix(0.75, 0.4, radial));
  return vec2f(cv, sheen / max(cover, 1e-4));
}
// ---- The drops on the glass (PLAN-PLUIE P3): a height field of water on the canopy (or the lens) — its
// height h and slope g — that refracts the scene behind it. Three layers: fixed droplets coming and drying,
// a mist of tiny ones, and big drops sliding in jerks, a beaded trail behind them, wiping the droplets on
// their way. Still or slow, they slide down; in flight the air drives them up the glass and out, stretched,
// and blows them off past ~100 m/s.
struct Wet { h: f32, g: vec2f };
// a dome of water: c its centre, r its radius, s its stretch along y (1: round) — its height and slope at p
fn dome(p: vec2f, c: vec2f, r: f32, s: f32) -> Wet {
  var o: Wet;
  let d = vec2f(p.x - c.x, (p.y - c.y) / s) / r;
  let q = dot(d, d);
  if (q >= 1.0) { return o; }
  let z = sqrt(1.0 - q);
  o.h = z;
  // (its slope: steep at its rim — the refraction strongest there, as in a real bead)
  o.g = -d / max(z, 0.22) / r * vec2f(1.0, 1.0 / s);
  return o;
}
fn wetMax(a: Wet, b: Wet) -> Wet {
  if (b.h > a.h) { return b; }
  return a;
}
// fixed droplets: p in cells; each cell maybe a droplet that comes and dries (its life at rate per s)
fn dropletLayer(p: vec2f, t: f32, dens: f32, rMax: f32, seed: f32) -> Wet {
  let id = floor(p);
  let f = fract(p);
  let h = rh22(id + seed);
  var o: Wet;
  if (rh21(id + seed + 4.1) > dens) { return o; }
  let r = rMax * (0.35 + 0.65 * h.x);
  let c = vec2f(r + (1.0 - 2.0 * r) * h.x, r + (1.0 - 2.0 * r) * h.y);
  // (it lands — grows in a flash —, stays, then dries away)
  let life = fract(t * (0.05 + 0.08 * h.y) + rh21(id + seed + 9.7));
  let g = smoothstep(0.0, 0.03, life) * (1.0 - smoothstep(0.75, 1.0, life));
  o = dome(f, c, r * (0.55 + 0.45 * g), 1.0);
  o.h *= g;
  o.g *= g;
  return o;
}
// big drops sliding: p in cells (a cell a column's stretch of glass); each slides down it in jerks (or up and
// out in the air's stream), a beaded wet trail behind; trail: its cover (it wipes the droplets)
fn slideLayer(p: vec2f, t: f32, dens: f32, blow: f32, xOut: f32, trail: ptr<function, f32>) -> Wet {
  let id = floor(p);
  let f = fract(p);
  let h = rh22(id + 31.7);
  var o: Wet;
  if (rh21(id + 12.9) > dens) { return o; }
  // (its run down the cell: a stick-slip — still, then a slide —, wrapping round; in the air's stream, up)
  let rate = mix(0.12 + 0.12 * h.x, 0.9 + 0.6 * h.x, blow);
  let ph = fract(t * rate + h.y);
  let stick = ph + 0.06 * sin(ph * 31.0 + h.x * 6.0) * (1.0 - blow);
  var y = mix(stick * 1.1 - 0.05, 1.05 - stick * 1.1, blow);
  // (its wander across: a zig-zag down the glass; out from the middle in the stream)
  let x = 0.5 + 0.18 * sin(stick * 8.0 + h.x * 9.0) * (1.0 - blow) + 0.3 * blow * (xOut - 0.5) * stick;
  let r = (0.13 + 0.07 * h.x) * (1.0 - 0.45 * blow);
  o = dome(f, vec2f(x, y), r, 1.0 + 1.6 * blow);
  // (its trail: where it has been — above it sliding down, below it blown up —, narrower, beaded, drying)
  let behind = select(y - f.y, f.y - y, blow > 0.5);
  if (behind > 0.0) {
    let w = 1.0 - smoothstep(0.25 * r, 0.6 * r, abs(f.x - x));
    let fade = 1.0 - smoothstep(0.0, 0.85, behind);
    *trail = max(*trail, w * fade);
    // (its beads: small drops left every few millimetres)
    let by = fract(f.y * 9.0 + h.y);
    let bead = dome(vec2f(f.x, by), vec2f(x, 0.5), 0.35 * r * 3.0, 1.0);
    if (w * fade > 0.3) { o = wetMax(o, Wet(bead.h * 0.6 * fade, bead.g * 0.6 * fade / 9.0)); }
  }
  return o;
}
// The water on the glass at uv: k the rain, blow 0…1 the air's stream over it, lens: the camera's lens (out
// of focus, few and large) rather than the canopy
fn glassWater(uv: vec2f, k: f32, blow: f32, lens: bool) -> Wet {
  let asp = D.img.x / D.img.y;
  let t = D.rain.y;
  let p = vec2f(uv.x * asp, uv.y);
  var trail = 0.0;
  var w: Wet;
  if (lens) {
    // (the lens: a few big drops, slow)
    w = dropletLayer(p * 4.0, t * 0.5, 0.3 * k, 0.42, 51.0);
    w.g *= 4.0;
    return w;
  }
  // (the air's stream thins them: past ~100 m/s the glass is swept)
  let keep = 1.0 - 0.85 * smoothstep(60.0, 110.0, D.rainV.w);
  var s = slideLayer(vec2f(p.x * 7.0, p.y * 2.2), t, (0.35 + 0.4 * k) * keep, blow, uv.x, &trail);
  s.g *= vec2f(7.0, 2.2);
  var d1 = dropletLayer(p * 22.0, t, (0.25 + 0.45 * k) * keep, 0.4, 3.0);
  d1.g *= 22.0;
  var d2 = dropletLayer(p * 55.0, t * 1.3, (0.3 + 0.4 * k) * keep, 0.42, 17.0);
  d2.g *= 55.0 * 0.6;
  d2.h *= 0.6;
  // (the droplets wiped where a drop has slid)
  let wipe = 1.0 - smoothstep(0.1, 0.5, trail);
  d1.h *= wipe;
  d1.g *= wipe;
  d2.h *= wipe;
  d2.g *= wipe;
  w = wetMax(wetMax(d2, d1), s);
  // (in the stream, every drop stretched along it: its slope across)
  return w;
}
// The scene through the water: each bead a small lens — the scene behind it shifted, inverted at its
// heart, its rim darker (the light bent away), a glint of the sky at its top; the lens's drops soft
fn wetGlass(uv: vec2f, c: vec3f, glass: f32, lens: bool) -> vec3f {
  let k = clamp(D.rain.x, 0.0, 1.0);
  let blow = smoothstep(25.0, 75.0, D.rainV.w);
  let w = glassWater(uv, k, blow, lens);
  if (w.h <= 0.0) { return c; }
  let asp = D.img.x / D.img.y;
  // (the refraction: a bead shows the scene round it, a few per cent of the view, upside down — the shift
  // along its slope, strongest at its rim)
  let gn0 = normalize(w.g + vec2f(1e-5));
  let shift = gn0 * (1.0 - w.h) * vec2f(1.0 / asp, 1.0) * select(0.06, 0.12, lens);
  let refr = textureSampleLevel(hdr, samp, clamp(uv + shift, vec2f(0.001), vec2f(0.999)), 0.0).rgb;
  // (clear water: the scene through it as bright as beside it; a thin dark ring at its edge, where the light
  // is bent away; a small sharp glint of the sky near its top; a faint caustic brightening at its foot)
  let rim = (1.0 - 0.62 * smoothstep(0.42, 0.95, 1.0 - w.h)) * 0.94;
  let gn = normalize(w.g + vec2f(1e-5));
  let glint = pow(max(dot(gn, vec2f(0.35, 0.94)), 0.0), 24.0) * smoothstep(0.25, 0.6, 1.0 - w.h) * (1.0 - smoothstep(0.85, 1.0, 1.0 - w.h));
  let foot = pow(max(dot(gn, vec2f(-0.2, -0.98)), 0.0), 6.0) * 0.12;
  let sky = rainLight(uv);
  let lit = refr * (rim + foot) + glint * 1.8 * max(sky, refr);
  // (the edge of a bead soft — the lens's drops out of focus, softer still)
  let m = smoothstep(0.0, select(0.18, 0.6, lens), w.h);
  return mix(c, lit, m * glass * select(1.0, 0.75, lens));
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
  // (the image upscaled here when rendered under the canvas — its render scale: a Catmull–Rom, sharper
  // than the browser's bilinear; at the canvas's size, RCAS's sharpening instead — per image texel, it
  // would draw that texel's blocks once upscaled)
  let up = D.lod.x == 0.0 && (D.size.x > D.img.x * 1.01 || D.size.y > D.img.y * 1.01);
  var c: vec3f;
  if (up) {
    c = catmullRom(uv);
  } else {
    c = textureSampleLevel(hdr, samp, uv, D.lod.x).rgb;
    if (D.lod.w > 0.0 && D.lod.x == 0.0 && D.flags.x < 0.5) {
      c = max(c + rcasDelta(vec2i(uv * vec2f(textureDimensions(hdr, 0))), D.lod.w, D.size.z), vec3f(0.0));
    }
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
      let sp = select(textureLoad(ship, vec2i(uv * D.img.xy), 0), textureSampleLevel(ship, samp, uv, 0.0), up);
      c = min(sp.rgb, vec3f(60000.0)) + (1.0 - sp.a) * c;
    }
    // (the flames and the plasma added; the condensation trails over what is behind them — their
    // coverage in alpha)
    let pl = textureSampleLevel(plumes, samp, uv, 0.0);
    c = c * (1.0 - clamp(pl.a, 0.0, 1.0)) + min(pl.rgb, vec3f(60000.0));
  }
  if (D.rain.x > 0.0 && D.flags.x < 0.5) {
    // (in the cabin: the drops on its glass — where the Ranger's image lets the outside through —, the rain
    // beyond it fainter)
    var glass = 1.0;
    let inCab = D.rain.z > 0.5 && D.rain.z < 1.5;
    if (inCab && D.lod.y > 0.5) {
      let q = uv * D.img.xy - D.ship.xy;
      if (all(q >= vec2f(0.0)) && all(q < D.ship.zw)) { glass = 1.0 - clamp(textureSampleLevel(ship, samp, uv, 0.0).a, 0.0, 1.0); }
    }
    // (a drop sends on the sky's light above it as much as the scene's round it: brighter than a dark ground;
    // near a light — a runway's, the landing lights' — it shines with it: the bloom's glow there)
    let lit = max(rainLight(uv), textureSampleLevel(hdr, samp, vec2f(uv.x, max(uv.y - 0.3, 0.02)), 0.0).rgb);
    let glow = textureSampleLevel(bloom, samp, uv, 0.0).rgb / max(D.flags.z, 1.0);
    // (dust: the grains the storm's own ochre, dimmer than drops — they scatter, they do not shine)
    let dust = D.rain.z > 1.5;
    // (the flown craft over the image here: the drops beyond it hidden)
    var shipA = 0.0;
    if (D.rainX.x > 0.0 && D.lod.y > 0.5) {
      let q = uv * D.img.xy - D.ship.xy;
      if (all(q >= vec2f(0.0)) && all(q < D.ship.zw)) { shipA = clamp(textureSampleLevel(ship, samp, uv, 0.0).a, 0.0, 1.0); }
    }
    let rs = rainStreaks(uv, shipA);
    let col = select((lit * 1.25 + glow * 3.0) * rs.y, rainLight(uv) * vec3f(1.25, 0.95, 0.68), dust);
    c = mix(c, col, rs.x * glass * select(1.0, 0.5, inCab));
    if (!dust && inCab && glass > 0.0) { c = wetGlass(uv, c, glass, false); }
    // (outside: the camera's lens wet — a few soft drops — PLAN-PLUIE, the owner's choice)
    if (!dust && !inCab && D.rainX.z > 0.5) { c = wetGlass(uv, c, 1.0, true); }
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
