// The map on the GPU (ui/map3d/gpu.ts): the bodies as impostors — a quad per body, its pixels' view
// rays meeting the true sphere —, textured on the body's own axes, lit by their star; a field of stars
// behind; the orbits and paths as anti-aliased lines (dashed, faded), hidden exactly where a body stands
// in front of them (the bodies' depth first); a world's planisphere, lit pixel by pixel.
// View space: x right, y up, z forward (into the screen); the screen's pixels: y down. Depth: the view
// depth's logarithm between a near and a far (a low orbit and the whole system in one buffer).

struct U {
  size: vec4f,   // width, height [px], focal length [px], time [s]
  centre: vec4f, // the view's centre [px]; log2 of the near depth, 1 / log2(far / near)
  ax0: vec4f,    // the camera's right, up, forward in the world (the stars)
  ax1: vec4f,
  ax2: vec4f,
  rect: vec4f,   // the planisphere's rectangle [px]: left, top, width, height
};

/** A line's segment: its ends on the screen [px], 1 / their view depth (0: over everything), the
 *  distance along the line [px] (the dashes); its colour; its alphas at the ends, half its width [px],
 *  1 when it ends there (a round cap); its dash and gap [px] (0: solid). */
struct Seg {
  p0: vec4f,
  p1: vec4f,
  col: vec4f,
  a: vec4f,
  dash: vec4f,
};

struct B {
  c: vec4f,   // centre (view), radius
  k: vec4f,   // kind, map layer, air (0/1), rings' inner radius (× R)
  L: vec4f,   // towards the light (view), rings' outer radius (× R)
  a0: vec4f,  // the body's x axis (view), procedural kind
  a1: vec4f,  // its y axis, the night side's least light
  a2: vec4f,  // its z axis (pole), least radius [px]
  col: vec4f, // base colour (linear), the air's strength
  air: vec4f, // the air's colour (linear)
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> bodies: array<B>;
@group(0) @binding(2) var mapHi: texture_2d_array<f32>;
@group(0) @binding(3) var mapLo: texture_2d_array<f32>;
@group(0) @binding(4) var ringTex: texture_2d<f32>;
@group(0) @binding(5) var earthDay: texture_cube<f32>;
@group(0) @binding(6) var earthNight: texture_cube<f32>;
@group(0) @binding(7) var samp: sampler;
@group(0) @binding(8) var<storage, read> segs: array<Seg>;

/** A view depth's place in the depth buffer (0 near … 1 far, logarithmic). */
fn depthOf(z: f32) -> f32 {
  return clamp((log2(max(z, 1e-30)) - u.centre.z) * u.centre.w, 0.0, 1.0);
}

const PI = 3.14159265358979;
const MAP = 0.0;
const EARTH = 1.0;
const STAR = 2.0;
const HOLE = 3.0;
const MOUTH = 4.0;
const PROC = 5.0;

// ------------------------------------------------------------------------------------ noise
fn hash3(p: vec3f) -> f32 {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i);
  let n100 = hash3(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3f(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3f(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3f(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3f(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, w.x), mix(n010, n110, w.x), w.y), mix(mix(n001, n101, w.x), mix(n011, n111, w.x), w.y), w.z);
}
fn fbm(p: vec3f) -> f32 {
  var a = 0.5;
  var s = 0.0;
  var q = p;
  for (var i = 0; i < 5; i++) {
    s += a * vnoise(q);
    q = q * 2.03 + vec3f(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}

// ------------------------------------------------------------------------------------ bodies
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) id: u32,
};

/** How far beyond the body its quad reaches (× its drawn radius): the air, the rings, the glow. */
fn reach(b: B) -> f32 {
  let kind = b.k.x;
  if (kind == STAR) { return 6.0; }
  if (kind == HOLE) { return max(b.L.w * 1.08, 3.0); }
  if (kind == MOUTH) { return 1.8; }
  return max(select(1.0, 1.12, b.k.z > 0.5), b.L.w * 1.02) * 1.04;
}

@vertex
fn bodyVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let b = bodies[ii];
  var o: VOut;
  o.id = ii;
  let z = b.c.z;
  if (z <= 1e-12) {
    o.pos = vec4f(2.0, 2.0, 0.0, 1.0);
    return o;
  }
  let f = u.size.z;
  let px = vec2f(u.centre.x + f * b.c.x / z, u.centre.y - f * b.c.y / z);
  let rpx = max(f * b.c.w / z, b.a2.w) * reach(b);
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0))[vi];
  let q = px + corner * (rpx + 1.5);
  o.pos = vec4f(q.x / u.size.x * 2.0 - 1.0, 1.0 - q.y / u.size.y * 2.0, 0.0, 1.0);
  return o;
}

/** The map's colour at a direction on the body's axes (equirectangular, longitude 0 at the centre). */
fn mapColour(b: B, nb: vec3f, lod: f32) -> vec3f {
  let lon = atan2(nb.y, nb.x);
  let lat = asin(clamp(nb.z, -1.0, 1.0));
  let uv = vec2f(0.5 + lon / (2.0 * PI), 0.5 - lat / PI);
  let layer = b.k.y;
  if (layer >= 0.0) { return textureSampleLevel(mapHi, samp, uv, i32(layer + 0.5), lod).rgb; }
  return textureSampleLevel(mapLo, samp, uv, i32(-layer - 0.5), max(lod - 1.0, 0.0)).rgb;
}

/** Gargantua's worlds, as the tracer draws them: Miller's knee-deep water, Mann's ice, Edmunds' plateaus. */
fn procColour(kind: f32, nb: vec3f) -> vec3f {
  if (kind < 0.5) {
    // Miller: a shallow sea, lighter shoals, darker channels; its giant waves' crests in bands
    let n = fbm(nb * 6.0);
    let band = 0.5 + 0.5 * sin(nb.x * 9.0 + 2.0 * fbm(nb * 2.0));
    let sea = mix(vec3f(0.035, 0.11, 0.12), vec3f(0.16, 0.26, 0.24), smoothstep(0.35, 0.75, n));
    return mix(sea, vec3f(0.32, 0.38, 0.36), 0.25 * pow(band, 12.0));
  }
  if (kind < 1.5) {
    // Mann: ice sheets, sharp ridges, blue cracks
    let n = fbm(nb * 5.0);
    let ridge = 1.0 - abs(2.0 * vnoise(nb * 18.0) - 1.0);
    let ice = mix(vec3f(0.55, 0.62, 0.7), vec3f(0.86, 0.9, 0.95), smoothstep(0.3, 0.7, n));
    return mix(ice, vec3f(0.28, 0.42, 0.6), 0.35 * pow(ridge, 8.0));
  }
  // Edmunds: plateaus and dunes, ochre and rust
  let n = fbm(nb * 4.0);
  let m = fbm(nb * 16.0 + 4.0);
  let rock = mix(vec3f(0.24, 0.16, 0.1), vec3f(0.5, 0.36, 0.22), smoothstep(0.35, 0.7, n));
  return mix(rock, vec3f(0.62, 0.5, 0.36), 0.35 * smoothstep(0.55, 0.8, m));
}

/**
 * A world's surface seen at a normal (view space; nb: on the body's axes), along a view direction, lit
 * from L: its map (or the Earth's day, clouds and city lights, or Gargantua's procedural worlds, or its
 * colour), the night side's least light, the sea's glint.
 */
fn surface(b: B, n: vec3f, nb: vec3f, d: vec3f, L: vec3f, lod: f32, air: bool, glint: f32) -> vec3f {
  let kind = b.k.x;
  var alb: vec3f;
  var emit = vec3f(0.0);
  let lit = shade(n, L, select(0.0, 1.0, air));
  if (kind == EARTH) {
    let q = vec3f(nb.y, nb.z, nb.x);
    let day = textureSampleLevel(earthDay, samp, q, lod);
    let cloud = smoothstep(0.08, 0.85, day.a);
    alb = mix(day.rgb, vec3f(0.9), cloud * 0.92);
    let night = textureSampleLevel(earthNight, samp, q, lod).r;
    let dark = 1.0 - smoothstep(-0.12, 0.06, dot(n, L));
    emit = vec3f(1.0, 0.72, 0.38) * night * night * dark * (1.0 - cloud) * 0.6;
    // (the sea's glint)
    let h = normalize(L - d);
    let spec = pow(max(dot(n, h), 0.0), 60.0) * (1.0 - cloud) * smoothstep(0.0, 0.2, dot(n, L)) * (1.0 - smoothstep(0.08, 0.2, length(day.rgb)));
    emit += vec3f(1.0, 0.95, 0.85) * spec * 0.6 * glint;
  } else if (kind == PROC) {
    alb = procColour(b.a0.w, nb);
  } else if (kind == MAP) {
    alb = mapColour(b, nb, lod);
  } else {
    // a world without a map: its colour, faint bands
    let lat = asin(clamp(nb.z, -1.0, 1.0));
    alb = b.col.rgb * (0.82 + 0.18 * sin(lat * 11.0 + 2.0 * fbm(nb * 3.0)));
  }
  // (the night side's least light: a globe read in the dark)
  return alb * max(lit, b.a1.w) + emit;
}

/** The light a surface reflects: Lambert, a terminator softened by the air. */
fn shade(n: vec3f, L: vec3f, soft: f32) -> f32 {
  let ndl = dot(n, L);
  // (linear light: a faint ambient, ~8 % once encoded for the screen)
  return max(ndl, 0.0) * 0.96 + soft * smoothstep(-0.12, 0.08, ndl) * 0.03 + 0.004;
}

/** Saturn's rings where the ray crosses its equator: colour, coverage (premultiplied). */
fn ringHit(b: B, d: vec3f, R: f32) -> vec4f {
  let r1 = b.k.w;
  let r2 = b.L.w;
  if (r2 <= 0.0) { return vec4f(0.0); }
  let a2 = b.a2.xyz;
  let dn = dot(d, a2);
  if (abs(dn) < 1e-6) { return vec4f(0.0); }
  let t = dot(b.c.xyz, a2) / dn;
  if (t <= 0.0) { return vec4f(0.0); }
  let p = d * t - b.c.xyz;
  let rr = length(p) / R;
  if (rr < r1 || rr > r2) { return vec4f(0.0); }
  let tx = textureSampleLevel(ringTex, samp, vec2f((rr - r1) / (r2 - r1), 0.5), 0.0);
  // (the planet's shadow across them)
  let L = b.L.xyz;
  let toC = -p;
  let along = dot(toC, L);
  let perp = length(toC - L * along);
  let lit = select(1.0, 0.08, along > 0.0 && perp < R);
  let face = 0.35 + 0.65 * abs(dot(L, a2));
  let a = clamp(tx.a * 0.9, 0.0, 1.0);
  return vec4f(tx.rgb * lit * face * a, a);
}

/** Linear light (premultiplied) to the canvas's sRGB: the maps decoded to light, lit, encoded back —
 *  the colours as the maps have them, the shading's falloff as the eye sees it. */
fn toDisplay(c: vec4f) -> vec4f {
  if (c.a <= 0.0) { return c; }
  return vec4f(pow(max(c.rgb / c.a, vec3f(0.0)), vec3f(1.0 / 2.2)) * c.a, c.a);
}

@fragment
fn bodyFs(in: VOut) -> @location(0) vec4f {
  return toDisplay(bodyLight(in));
}

/** A body's light at a pixel (linear, premultiplied). */
fn bodyLight(in: VOut) -> vec4f {
  let b = bodies[in.id];
  let f = u.size.z;
  let d = normalize(vec3f((in.pos.x - u.centre.x) / f, -(in.pos.y - u.centre.y) / f, 1.0));
  let c = b.c.xyz;
  let cl = length(c);
  // (a dot at least: the sphere drawn as wide as its least radius on the screen)
  let R = max(b.c.w, b.a2.w * c.z / f);
  let cosA = dot(d, c / cl);
  let sin2 = max(1.0 - cosA * cosA, 0.0);
  let perp = cl * sqrt(sin2);
  let kind = b.k.x;
  let L = b.L.xyz;
  // (a pixel's width on the body, over its radius: the map's mip level)
  let px = (cl / f) / R;

  if (kind == STAR) {
    let col = b.col.rgb;
    if (perp < R) {
      let mu = sqrt(max(1.0 - (perp / R) * (perp / R), 0.0));
      let limb = 0.45 + 0.55 * pow(mu, 0.6);
      return vec4f(mix(col, vec3f(1.0, 0.98, 0.94), 0.65) * limb * 1.4, 1.0);
    }
    let g = exp(-(perp / R - 1.0) * 1.15) * 0.55 + exp(-(perp / R - 1.0) * 0.25) * 0.08;
    let a = clamp(g, 0.0, 1.0);
    return vec4f(col * a, a * 0.85);
  }

  if (kind == MOUTH) {
    let x = perp / R;
    if (x > 1.75) { discard; }
    let rim = exp(-pow((x - 1.0) / 0.12, 2.0));
    let inner = select(0.0, 0.55 * (1.0 - x * x), x < 1.0);
    let col = vec3f(0.78, 0.55, 1.0) * rim * 1.2 + vec3f(0.12, 0.05, 0.25) * inner;
    let a = clamp(rim + inner, 0.0, 1.0);
    return vec4f(col, a);
  }

  if (kind == HOLE) {
    // the disk in the hole's equator (inner and outer radii × R), Doppler-brightened on its approaching
    // side; the horizon black over what is behind it, the disk's near part in front of it; the photon
    // ring a thin bright circle
    let a2 = b.a2.xyz;
    let dn = dot(d, a2);
    // (the horizon's edge anti-aliased: its coverage of the pixel)
    let covH = clamp((1.0 - perp / R) / px + 0.5, 0.0, 1.0);
    let hitH = covH > 0.0;
    let pH = min(perp, R);
    let tH = select(1e30, cl * cosA - sqrt(max(R * R - pH * pH, 0.0)), hitH);
    var disk = vec4f(0.0);
    var tD = 1e30;
    if (abs(dn) > 1e-6) {
      let t = dot(c, a2) / dn;
      let p = d * t - c;
      let rr = length(p) / R;
      // (a pixel's width across the disk, in radii: its edges anti-aliased)
      let pxd = px * t / cl / sqrt(max(abs(dn), 0.05));
      if (t > 0.0 && rr > b.k.w - pxd && rr < b.L.w) {
        tD = t;
        let edge = clamp((rr - b.k.w) / pxd + 0.5, 0.0, 1.0);
        let x = max(rr - b.k.w, 0.0) / max(b.L.w - b.k.w, 1e-3);
        let hot = mix(vec3f(1.0, 0.92, 0.75), vec3f(1.0, 0.45, 0.14), smoothstep(0.0, 0.6, x));
        let tang = normalize(cross(a2, p));
        let dop = max(1.0 + 0.7 * dot(tang, -d), 0.2);
        let swirl = 0.65 + 0.35 * fbm(vec3f(rr * 9.0, atan2(dot(p, b.a1.xyz), dot(p, b.a0.xyz)) * 3.0, 0.0));
        let fall = pow(1.0 - x, 1.6) * swirl;
        let a = clamp(fall * 1.2, 0.0, 1.0) * edge;
        disk = vec4f(hot * fall * dop * 1.3 * edge, a);
      }
    }
    var out = disk;
    if (hitH) {
      out = mix(disk, select(vec4f(0.0, 0.0, 0.0, 1.0), vec4f(disk.rgb, 1.0), tD < tH), covH);
    }
    let ring = select(exp(-pow((perp / R - 1.5) / 0.05, 2.0)) * 0.9, 0.0, hitH);
    let o = vec4f(out.rgb + vec3f(1.0, 0.85, 0.6) * ring * (1.0 - out.a), out.a + ring * (1.0 - out.a));
    if (o.a <= 0.0) { discard; }
    return o;
  }

  // ---- a world (map, the Earth, Gargantua's, plain)
  let air = b.k.z > 0.5;
  var out = vec4f(0.0);
  var tS = 1e30;
  // (the limb anti-aliased: the pixel's coverage by the disc, the surface shaded at the limb just inside)
  let cov = clamp((1.0 - perp / R) / px + 0.5, 0.0, 1.0);
  if (cov > 0.0) {
    let pS = min(perp, R * 0.9995);
    tS = cl * cosA - sqrt(max(R * R - pS * pS, 0.0));
    let n = normalize(d * tS - c);
    let nb = vec3f(dot(n, b.a0.xyz), dot(n, b.a1.xyz), dot(n, b.a2.xyz));
    // (texels across a pixel: the far side's mip, steeper at the limb)
    let limb = max(dot(n, -d), 0.08);
    let lod = log2(max(px * 2048.0 / (2.0 * PI) / limb, 1.0));
    var col = surface(b, n, nb, d, L, lod, air, 1.0);
    // (the air: the limb hazed, lit)
    if (air) {
      let rim = pow(1.0 - limb, 3.0);
      col = mix(col, b.air.rgb * max(dot(n, L) + 0.25, 0.0), clamp(rim * b.col.w, 0.0, 0.8));
    }
    out = vec4f(col * cov, cov);
  }
  if (air && perp > R * (1.0 - px) && perp < R * 1.1) {
    // the air's glow beyond the limb, lit on the day side
    let h = max(perp - R, 0.0) / (R * 0.1);
    let pc = normalize(d * (cl * cosA) - c);
    let day = smoothstep(-0.35, 0.4, dot(pc, L));
    let g = exp(-h * 3.2) * (1.0 - h) * day * b.col.w;
    out = out + vec4f(b.air.rgb * g, g) * (1.0 - out.a);
  }
  // the rings, before or behind the world
  let rg = ringHit(b, d, R);
  if (rg.a > 0.0) {
    let t = dot(c, b.a2.xyz) / dot(d, b.a2.xyz);
    if (t < tS) { out = rg + out * (1.0 - rg.a); } else if (out.a < 1.0) { out = out + rg * (1.0 - out.a); }
  }
  if (out.a <= 0.0) { discard; }
  return out;
}

// ------------------------------------------------------------------------------------ the stars
@vertex
fn skyVs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}

/** A star in a cell of a cube's face: its direction and brightness. */
fn starIn(face: i32, cell: vec2f, N: f32) -> vec4f {
  let h = hash3(vec3f(cell, f32(face) * 17.0));
  let h2 = hash3(vec3f(cell.yx + 3.1, f32(face) * 5.0 + 1.0));
  let uv = (cell + vec2f(h, h2)) / N * 2.0 - 1.0;
  var p: vec3f;
  switch (face) {
    case 0: { p = vec3f(1.0, uv.y, -uv.x); }
    case 1: { p = vec3f(-1.0, uv.y, uv.x); }
    case 2: { p = vec3f(uv.x, 1.0, -uv.y); }
    case 3: { p = vec3f(uv.x, -1.0, uv.y); }
    case 4: { p = vec3f(uv.x, uv.y, 1.0); }
    default: { p = vec3f(-uv.x, uv.y, -1.0); }
  }
  let m = hash3(vec3f(cell * 1.7, f32(face) + 9.0));
  // (most faint, a few bright: a steep power law)
  return vec4f(normalize(p), pow(m, 14.0) * 1.6 + pow(m, 3.0) * 0.12);
}

@fragment
fn skyFs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let f = u.size.z;
  let v = normalize(vec3f((pos.x - u.centre.x) / f, -(pos.y - u.centre.y) / f, 1.0));
  let dir = normalize(u.ax0.xyz * v.x + u.ax1.xyz * v.y + u.ax2.xyz * v.z);
  // the cube face and cell the direction falls in
  let a = abs(dir);
  var face: i32;
  var uv: vec2f;
  if (a.x >= a.y && a.x >= a.z) {
    face = select(1, 0, dir.x > 0.0);
    uv = select(vec2f(dir.z, dir.y), vec2f(-dir.z, dir.y), dir.x > 0.0) / a.x;
  } else if (a.y >= a.z) {
    face = select(3, 2, dir.y > 0.0);
    uv = select(vec2f(dir.x, dir.z), vec2f(dir.x, -dir.z), dir.y > 0.0) / a.y;
  } else {
    face = select(5, 4, dir.z > 0.0);
    uv = select(vec2f(-dir.x, dir.y), vec2f(dir.x, dir.y), dir.z > 0.0) / a.z;
  }
  let N = 90.0;
  let cell = floor((uv * 0.5 + 0.5) * N);
  var sum = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let s = starIn(face, cell + vec2f(f32(i), f32(j)), N);
      let ang = acos(clamp(dot(s.xyz, dir), -1.0, 1.0)) * f;
      sum += s.w * exp(-ang * ang / 0.9);
    }
  }
  let k = clamp(sum, 0.0, 1.0);
  return vec4f(vec3f(0.82, 0.88, 1.0) * k, k);
}

// ------------------------------------------------------------------------------------ the bodies' depth
/** The opaque spheres' depth (the worlds, the stars, Gargantua's horizon — not the glows, the disk, the
 *  rings, the mouth): the lines behind them hidden pixel by pixel. */
@fragment
fn bodyDepthFs(in: VOut) -> @builtin(frag_depth) f32 {
  let b = bodies[in.id];
  if (b.k.x == MOUTH) { discard; }
  let f = u.size.z;
  let d = normalize(vec3f((in.pos.x - u.centre.x) / f, -(in.pos.y - u.centre.y) / f, 1.0));
  let c = b.c.xyz;
  let cl = length(c);
  let R = max(b.c.w, b.a2.w * c.z / f);
  let cosA = dot(d, c / cl);
  let perp = cl * sqrt(max(1.0 - cosA * cosA, 0.0));
  if (perp >= R) { discard; }
  let t = cl * cosA - sqrt(max(R * R - perp * perp, 0.0));
  return depthOf(t * d.z);
}

// ------------------------------------------------------------------------------------ the lines
struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) id: u32,
  // (along the segment from its start, across it [px])
  @location(1) @interpolate(linear) uv: vec2f,
  @location(2) @interpolate(linear) iz: f32,
};

@vertex
fn lineVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LOut {
  let g = segs[ii];
  let a = g.p0.xy;
  let len = length(g.p1.xy - a);
  let dir = select(vec2f(1.0, 0.0), (g.p1.xy - a) / len, len > 1e-4);
  let nrm = vec2f(-dir.y, dir.x);
  let e = g.a.z + 1.0;
  let cs = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0))[vi];
  let along = select(-e, len + e, cs.x > 0.5);
  let across = cs.y * e;
  let p = a + dir * along + nrm * across;
  var o: LOut;
  o.id = ii;
  o.uv = vec2f(along, across);
  // (1 / depth runs linearly across the screen: exact along the segment)
  o.iz = select(g.p0.z + (g.p1.z - g.p0.z) * along / max(len, 1e-4), 0.0, g.p0.z <= 0.0 || g.p1.z <= 0.0);
  o.pos = vec4f(p.x / u.size.x * 2.0 - 1.0, 1.0 - p.y / u.size.y * 2.0, 0.0, 1.0);
  return o;
}

struct LFrag {
  @location(0) col: vec4f,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn lineFs(in: LOut) -> LFrag {
  let g = segs[in.id];
  let len = length(g.p1.xy - g.p0.xy);
  let hw = g.a.z;
  let x = in.uv.x;
  var dist = abs(in.uv.y);
  // (round at its start — the joint with the segment before —, cut flat at its end unless the line
  // ends there: no joint drawn twice)
  if (x < 0.0) {
    dist = length(in.uv);
  } else if (x > len) {
    if (g.a.w < 0.5) { discard; }
    dist = length(vec2f(x - len, in.uv.y));
  }
  var cov = clamp(hw + 0.5 - dist, 0.0, 1.0);
  let t = clamp(x / max(len, 1e-4), 0.0, 1.0);
  if (g.dash.x > 0.0) {
    let s = mix(g.p0.w, g.p1.w, t) + min(x, 0.0) + max(x - len, 0.0);
    let per = g.dash.x + g.dash.y;
    let ph = s - per * floor(s / per);
    cov *= clamp(min(ph, g.dash.x - ph) + 0.5, 0.0, 1.0);
  }
  let a = mix(g.a.x, g.a.y, t) * cov;
  if (a <= 0.002) { discard; }
  var o: LFrag;
  o.col = vec4f(g.col.rgb * a, a);
  o.depth = select(depthOf(1.0 / max(in.iz, 1e-30)), 0.0, in.iz <= 0.0);
  return o;
}

// ------------------------------------------------------------------------------------ the planisphere
@vertex
fn planiVs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let cs = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0))[vi];
  let p = u.rect.xy + cs * u.rect.zw;
  return vec4f(p.x / u.size.x * 2.0 - 1.0, 1.0 - p.y / u.size.y * 2.0, 0.0, 1.0);
}

/** The first body (its axes the identity, its light in its own frame) laid out in longitude and
 *  latitude: each pixel the surface straight below, lit as the globe lights it. */
@fragment
fn planiFs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let b = bodies[0];
  let q = (pos.xy - u.rect.xy) / u.rect.zw;
  let lon = (q.x - 0.5) * 2.0 * PI;
  let lat = (0.5 - q.y) * PI;
  let n = vec3f(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
  // (the map's texels across a pixel)
  let lod = log2(max(2048.0 / u.rect.z, 1.0));
  // (no glint: a map seen from straight above everywhere would show one bright blob)
  let col = surface(b, n, n, -n, b.L.xyz, lod, b.k.z > 0.5, 0.0);
  return toDisplay(vec4f(col, 1.0));
}
