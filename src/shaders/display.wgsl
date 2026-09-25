// Final image: HDR radiance (+ bloom) → exposure → tone mapping → sRGB.

struct Display {
  size: vec4f,  // output W, H, exposure (linear multiplier), tonemap (0 AgX, 1 AgX punchy, 2 ACES, 3 clamp)
  flags: vec4f, // debug mode (1 = bypass exposure/tonemap/bloom), bloom strength, bloom levels, dither (0/1)
  view: vec4f,  // image placement in the output (uv): scale x, y, offset x, y (letterboxed preview)
};

@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var<uniform> D: Display;
@group(0) @binding(2) var bloom: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

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
fn agx(c: vec3f, punchy: bool) -> vec3f {
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
    v = pow(max(v, vec3f(0.0)), vec3f(1.35));
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

fn srgbEncode(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let uvOut = in.pos.xy / D.size.xy;
  let uv = (uvOut - D.view.zw) / D.view.xy;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  var c = textureSampleLevel(hdr, samp, uv, 0.0).rgb;
  if (D.flags.x < 0.5) {
    let b = textureSampleLevel(bloom, samp, uv, 0.0).rgb / max(D.flags.z, 1.0);
    c = mix(c, b, D.flags.y);
    c *= D.size.z;
    let tm = u32(D.size.w);
    if (tm == 0u) { c = agx(c, false); } else if (tm == 1u) { c = agx(c, true); } else if (tm == 2u) { c = aces(c); }
  }
  c = clamp(c, vec3f(0.0), vec3f(1.0));
  // Tiny dither against banding in the dark sky.
  let n = fract(sin(dot(in.pos.xy, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  return vec4f(srgbEncode(c) + n * D.flags.w / 255.0, 1.0);
}
