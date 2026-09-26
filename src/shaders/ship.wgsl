// The spaceship the camera is mounted on (Interstellar's Ranger), rasterized in the camera's rest
// frame — a few metres across, it lives in the camera's local, flat patch of spacetime — and lit by
// the light probe the tracer takes around the camera (the lensed disk, Gargantua, the sky).
//
//   envCopy / envDown   light probe (storage buffer) → equirectangular texture + box mips (the
//                       source of filtered importance sampling)
//   envGGX              radiance pre-filtered with the GGX lobe per roughness (one mip per level;
//                       Karis 2013, filtered importance sampling: Křivánek & Colbert 2008)
//   envSH               order-2 spherical harmonics of the probe (Ramamoorthi & Hanrahan 2001:
//                       diffuse irradiance) and the dominant light direction (L1 band)
//   shadowVs            depth of the ship seen from the dominant light (orthographic)
//   vs / fs             shading: painted plating under a clear coat, procedural relief (seams,
//                       rivets, pillowed and slightly tilted panels), baked ambient occlusion,
//                       split-sum reflections with multiple-scattering compensation
//                       (Fdez-Agüera 2019), specular occlusion, specular anti-aliasing
//   compVs / compFs     composite over the traced HDR image (premultiplied alpha)
//
// Camera frame C: x right, y up, z forward (right-handed); equirectangular u = atan2(x, z),
// v = polar angle from +y.

struct Ship {
  model: mat4x4f,   // ship → camera frame C
  proj: vec4f,      // tan(fov/2)·aspect, tan(fov/2), near, far
  mat: vec4f,       // hull albedo, metalness, roughness scale, specular mip count
  bound: vec4f,     // bounding sphere of the ship in C (centre, radius): the shadow map's box
  light: vec4f,     // gain on the light the hull receives (1: physical), clear coat (0…1), unused…
  plasma: vec4f,    // re-entry: the air's flow direction (camera frame), glow level 0…1
};

const ENV_W = 256u;
const ENV_H = 128u;
const PI = 3.14159265358979;

fn envDir(u: f32, v: f32) -> vec3f {
  let ph = (u - 0.5) * 2.0 * PI;
  let th = v * PI;
  return vec3f(sin(th) * sin(ph), cos(th), sin(th) * cos(ph));
}

fn envUV(d: vec3f) -> vec2f {
  return vec2f(atan2(d.x, d.z) / (2.0 * PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI);
}

// ------------------------------------------------------------------------------------ light probe
@group(0) @binding(0) var<storage, read> envIn: array<vec4f>;
@group(0) @binding(1) var envOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var envSrc: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> shOut: array<vec4f>; // 9 × rgb, then dominant dir + directionality
@group(0) @binding(4) var envSamp: sampler;
@group(0) @binding(5) var<uniform> G: vec4f; // GGX level: roughness, source mip count, sample count, unused

@compute @workgroup_size(8, 8)
fn envCopy(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ENV_W || gid.y >= ENV_H) { return; }
  textureStore(envOut, gid.xy, vec4f(envIn[gid.y * ENV_W + gid.x].rgb, 1.0));
}

// 2×2 average, solid-angle weighted (sin θ of the source rows)
@compute @workgroup_size(8, 8)
fn envDown(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(envOut);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let src = vec2i(textureDimensions(envSrc));
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var j = 0; j < 2; j++) {
    let y = min(i32(gid.y) * 2 + j, src.y - 1);
    let w = sin((f32(y) + 0.5) / f32(src.y) * PI) + 1e-3;
    for (var i = 0; i < 2; i++) {
      let x = min(i32(gid.x) * 2 + i, src.x - 1);
      acc += w * textureLoad(envSrc, vec2i(x, y), 0).rgb;
      wsum += w;
    }
  }
  textureStore(envOut, gid.xy, vec4f(acc / wsum, 1.0));
}

fn hammersley(i: u32, n: u32) -> vec2f {
  var b = i;
  b = (b << 16u) | (b >> 16u);
  b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
  b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
  b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
  b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
  return vec2f(f32(i) / f32(n), f32(b) * 2.3283064365386963e-10);
}

// GGX pre-filtered radiance (N = V = R), filtered importance sampling from the box-mipped probe
@compute @workgroup_size(8, 8)
fn envGGX(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(envOut);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let n = envDir((f32(gid.x) + 0.5) / f32(size.x), (f32(gid.y) + 0.5) / f32(size.y));
  let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.99);
  let tx = normalize(cross(up, n));
  let ty = cross(n, tx);
  let a = G.x * G.x;
  let count = u32(G.z);
  let texelSolid = 4.0 * PI / f32(ENV_W * ENV_H);
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var i = 0u; i < count; i++) {
    let xi = hammersley(i, count);
    let ct = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
    let st = sqrt(1.0 - ct * ct);
    let ph = 2.0 * PI * xi.x;
    let h = tx * (st * cos(ph)) + ty * (st * sin(ph)) + n * ct;
    let l = 2.0 * dot(n, h) * h - n;
    let nl = dot(n, l);
    if (nl <= 0.0) { continue; }
    // pdf of l (N = V): D(h) / 4 → mip whose texels match the sample's solid angle
    let dd = ct * ct * (a * a - 1.0) + 1.0;
    let d = a * a / (PI * dd * dd);
    let solid = 1.0 / (f32(count) * d * 0.25 + 1e-6);
    let lod = clamp(0.5 * log2(solid / texelSolid) + 1.0, 0.0, G.y - 1.0);
    acc += textureSampleLevel(envSrc, envSamp, envUV(l), lod).rgb * nl;
    wsum += nl;
  }
  textureStore(envOut, gid.xy, vec4f(acc / max(wsum, 1e-6), 1.0));
}

var<workgroup> shAcc: array<array<vec3f, 9>, 64>;

fn shBasis(d: vec3f) -> array<f32, 9> {
  return array<f32, 9>(
    0.282095,
    0.488603 * d.y, 0.488603 * d.z, 0.488603 * d.x,
    1.092548 * d.x * d.y, 1.092548 * d.y * d.z, 0.315392 * (3.0 * d.z * d.z - 1.0),
    1.092548 * d.x * d.z, 0.546274 * (d.x * d.x - d.y * d.y));
}

@compute @workgroup_size(64)
fn envSH(@builtin(local_invocation_id) lid: vec3u) {
  var acc: array<vec3f, 9>;
  let n = ENV_W * ENV_H;
  for (var i = lid.x; i < n; i += 64u) {
    let x = i % ENV_W;
    let y = i / ENV_W;
    let v = (f32(y) + 0.5) / f32(ENV_H);
    let d = envDir((f32(x) + 0.5) / f32(ENV_W), v);
    let dw = (2.0 * PI / f32(ENV_W)) * (PI / f32(ENV_H)) * sin(v * PI); // solid angle
    let L = envIn[i].rgb * dw;
    let b = shBasis(d);
    for (var k = 0u; k < 9u; k++) { acc[k] += L * b[k]; }
  }
  shAcc[lid.x] = acc;
  workgroupBarrier();
  if (lid.x != 0u) { return; }
  var tot: array<vec3f, 9>;
  for (var t = 0u; t < 64u; t++) {
    for (var k = 0u; k < 9u; k++) { tot[k] += shAcc[t][k]; }
  }
  for (var k = 0u; k < 9u; k++) { shOut[k] = vec4f(tot[k], 0.0); }
  // dominant direction of the light (luminance of the L1 band) and how directional it is
  // (|L1| / L0 = √3 for a single distant source)
  let lum = vec3f(0.2126, 0.7152, 0.0722);
  let l1 = vec3f(dot(tot[3], lum), dot(tot[1], lum), dot(tot[2], lum));
  let l0 = max(dot(tot[0], lum), 1e-20);
  let m = length(l1);
  shOut[9] = vec4f(select(vec3f(0.0, 1.0, 0.0), l1 / m, m > 0.0), clamp(m / (1.7320508 * l0), 0.0, 1.0));
}

// ------------------------------------------------------------------------------------ the ship
@group(0) @binding(0) var<uniform> S: Ship;
@group(0) @binding(1) var<storage, read> sh: array<vec4f>;
@group(0) @binding(2) var envTex: texture_2d<f32>; // GGX pre-filtered: mip = roughness · (count − 1)
@group(0) @binding(3) var linSamp: sampler;
@group(0) @binding(7) var shadowTex: texture_depth_2d;
@group(0) @binding(8) var shadowSamp: sampler_comparison;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) mat: f32,
  @location(3) ao: f32,
};

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) p: vec3f,   // camera frame C
  @location(1) n: vec3f,
  @location(2) mat: f32,
  @location(3) ao: f32,
  @location(4) q: vec3f,   // position and normal in the ship's frame (procedural plating)
  @location(5) qn: vec3f,
};

fn project(p: vec3f) -> vec4f {
  // same pinhole as the tracer: ndc = (x / (z tan·aspect), y / (z tan)); depth ∈ [0, 1]
  let near = S.proj.z;
  let far = S.proj.w;
  return vec4f(p.x / S.proj.x, p.y / S.proj.y, (p.z - near) * far / (far - near), p.z);
}

@vertex
fn vs(v: VIn) -> VOut {
  var o: VOut;
  let p = (S.model * vec4f(v.pos, 1.0)).xyz;
  o.p = p;
  o.clip = project(p);
  o.n = (S.model * vec4f(v.nrm, 0.0)).xyz;
  o.mat = v.mat;
  o.ao = v.ao;
  o.q = v.pos;
  o.qn = v.nrm;
  return o;
}

// Orthographic view of the ship from the dominant light (direction sh[9].xyz, towards the light):
// x, y ∈ [−1, 1] across the bounding sphere, depth 0 on the light's side.
fn lightClip(p: vec3f) -> vec3f {
  let l = sh[9].xyz;
  let e1 = normalize(cross(l, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(l.y) > 0.9)));
  let e2 = cross(l, e1);
  let q = p - S.bound.xyz;
  let R = S.bound.w;
  return vec3f(dot(q, e1) / R, dot(q, e2) / R, 0.5 - 0.5 * dot(q, l) / R);
}

@vertex
fn shadowVs(v: VIn) -> @builtin(position) vec4f {
  return vec4f(lightClip((S.model * vec4f(v.pos, 1.0)).xyz), 1.0);
}

fn irradiance(n: vec3f) -> vec3f {
  // Ramamoorthi & Hanrahan: E(n) = Σ Â_l L_lm Y_lm(n)
  let b = shBasis(n);
  let A = array<f32, 9>(PI, 2.094395, 2.094395, 2.094395, 0.785398, 0.785398, 0.785398, 0.785398, 0.785398);
  var e = vec3f(0.0);
  for (var k = 0u; k < 9u; k++) { e += A[k] * b[k] * sh[k].rgb; }
  return max(e, vec3f(0.0));
}

fn envSpec(d: vec3f, rough: f32) -> vec3f {
  return textureSampleLevel(envTex, linSamp, envUV(d), rough * (S.mat.w - 1.0)).rgb;
}

// split-sum environment BRDF scale and bias (Karis 2014, analytic fit): F0·x + y
fn envAB(rough: f32, nv: f32) -> vec2f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = rough * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  return vec2f(-1.04, 1.04) * a004 + r.zw;
}

// Poisson-disk PCF, normal-offset bias
fn shadowAt(p: vec3f, ng: vec3f, l: vec3f) -> f32 {
  let q = lightClip(p + ng * 0.05 + l * 0.02);
  let uv = vec2f(0.5 + 0.5 * q.x, 0.5 - 0.5 * q.y);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  let texel = 1.0 / vec2f(textureDimensions(shadowTex));
  let taps = array<vec2f, 12>(
    vec2f(-0.326, -0.406), vec2f(-0.840, -0.074), vec2f(-0.696, 0.457), vec2f(-0.203, 0.621),
    vec2f(0.962, -0.195), vec2f(0.473, -0.480), vec2f(0.519, 0.767), vec2f(0.185, -0.893),
    vec2f(0.507, 0.064), vec2f(0.896, 0.412), vec2f(-0.322, -0.933), vec2f(-0.792, -0.598));
  var s = 0.0;
  for (var i = 0; i < 12; i++) {
    s += textureSampleCompareLevel(shadowTex, shadowSamp, uv + taps[i] * texel * 2.5, q.z - 0.0015);
  }
  return s / 12.0;
}

fn hash3(p: vec3i) -> f32 {
  var h = u32(p.x) * 374761393u + u32(p.y) * 668265263u + u32(p.z) * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return f32(h ^ (h >> 16u)) / 4294967295.0;
}

fn vnoise(p: vec3f) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3i(1, 0, 0)), u.x), mix(hash3(i + vec3i(0, 1, 0)), hash3(i + vec3i(1, 1, 0)), u.x), u.y),
    mix(mix(hash3(i + vec3i(0, 0, 1)), hash3(i + vec3i(1, 0, 1)), u.x), mix(hash3(i + vec3i(0, 1, 1)), hash3(i + vec3i(1, 1, 1)), u.x), u.y),
    u.z);
}

// Plating on one projection plane (c in metres). Returns height [m] and, in y, the panel's tone.
// fw: a pixel's footprint [m] — features narrower than a few pixels fade out (no shimmering).
fn plate(c: vec2f, size: vec2f, axis: i32, fw: f32) -> vec2f {
  let g = c / size;
  let cell = floor(g);
  let id = vec3i(vec2i(cell), axis);
  let loc = (g - cell) * size;                      // position in the panel [m]
  let edge = min(loc, size - loc);                  // distances to its borders
  let seam = min(edge.x, edge.y);
  // seam: a 1.2 cm groove, 3 mm deep
  let gw = 0.006;
  let fadeSeam = clamp(gw / (1.5 * fw) - 0.35, 0.0, 1.0);
  var h = -0.003 * fadeSeam * (1.0 - smoothstep(0.0, gw, seam));
  // pillowed panel (4 mm over its span) with a small random tilt: reflections break panel by panel
  let uv = loc / size * 2.0 - 1.0;
  h += 0.004 * (1.0 - uv.x * uv.x) * (1.0 - uv.y * uv.y);
  let tilt = vec2f(hash3(id + vec3i(0, 0, 7)), hash3(id + vec3i(0, 0, 13))) - 0.5;
  h += dot(tilt, loc - 0.5 * size) * 0.012;
  // rivets: rows 4 cm inside the borders, every 12 cm, 8 mm heads
  let fadeRiv = clamp(0.004 / (1.5 * fw) - 0.35, 0.0, 1.0);
  let rx = vec2f(edge.x - 0.04, (fract(loc.y / 0.12) - 0.5) * 0.12);
  let ry = vec2f(edge.y - 0.04, (fract(loc.x / 0.12) - 0.5) * 0.12);
  let rv = min(length(rx), length(ry));
  h += 0.0012 * fadeRiv * (1.0 - smoothstep(0.0, 0.004, rv));
  return vec2f(h, hash3(id));
}

// Plating on the projection planes weighted by w (one-hot: the dominant axis of the normal)
fn plating(q: vec3f, w: vec3f, fw: f32) -> vec2f {
  return w.x * plate(q.zy, vec2f(1.1, 0.7), 0, fw) + w.y * plate(q.xz, vec2f(0.7, 1.1), 1, fw) + w.z * plate(q.xy, vec2f(0.7, 0.7), 2, fw);
}

@fragment
fn fs(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let side = select(-1.0, 1.0, front);
  let ng = normalize(in.n) * side;       // geometric (smoothed) normal, camera frame
  let qn = normalize(in.qn) * side;      // same, ship frame
  let part = u32(in.mat + 0.5);
  let fw = max(length(fwidth(in.q)), 1e-5);
  // specular anti-aliasing (Kaplanyan & Hoffman 2016): normal variation within the pixel
  let dn = fwidth(ng);
  let kernel = min(2.0 * dot(dn, dn), 0.25);

  // ---- procedural relief: gradient of the height field by finite differences, in the ship frame
  // plating projected along the dominant axis only: blending projections would cross two seam grids
  let aq = abs(qn);
  let w = select(select(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), aq.y >= aq.z), vec3f(1.0, 0.0, 0.0), aq.x >= aq.y && aq.x >= aq.z);
  let e = max(0.5 * fw, 0.0015);
  let h0 = plating(in.q, w, fw);
  let hx = plating(in.q + vec3f(e, 0.0, 0.0), w, fw).x;
  let hy = plating(in.q + vec3f(0.0, e, 0.0), w, fw).x;
  let hz = plating(in.q + vec3f(0.0, 0.0, e), w, fw).x;
  var grad = (vec3f(hx, hy, hz) - h0.x) / e;
  grad -= dot(grad, qn) * qn;
  let bumpOn = select(0.0, 1.0, part == 0u || part == 4u);
  let qb = normalize(qn - grad * bumpOn);
  let n = normalize((S.model * vec4f(qb, 0.0)).xyz);

  // ---- material
  let tone = h0.y;
  let seamDepth = clamp(-h0.x / 0.003, 0.0, 1.0);
  let grime = vnoise(in.q * 1.3) * 0.55 + vnoise(in.q * 6.1) * 0.3 + vnoise(in.q * 23.0) * 0.15;
  var albedo = vec3f(S.mat.x) * (0.92 + 0.12 * tone) * (1.0 - 0.22 * grime * grime) * mix(1.0, 0.45, seamDepth * bumpOn);
  var metal = S.mat.y;
  var rough = 0.5 + 0.2 * grime;
  var coat = S.light.y; // clear coat over the paint
  switch part {
    case 1u: { albedo = vec3f(0.01, 0.012, 0.015); metal = 0.0; rough = 0.03; coat = 0.0; }        // glass
    case 2u: { albedo = vec3f(0.35, 0.33, 0.31); metal = 1.0; rough = 0.32 + 0.1 * grime; coat = 0.0; } // nozzles
    case 3u: { albedo = vec3f(0.04); metal = 0.0; rough = 0.45; coat = 0.5 * coat; }                // window frames
    case 4u: { albedo *= 0.72; }                                                                     // hatch, airlock
    default: {}
  }
  rough = clamp(rough * S.mat.z, 0.03, 1.0);
  let alpha = rough * rough;
  rough = sqrt(sqrt(min(alpha * alpha + kernel, 1.0)));
  metal = clamp(metal, 0.0, 1.0);
  // baked per vertex (≈ 0.45 m triangles): softened a little, and the seams' own cavity added
  let ao = pow(clamp(in.ao, 0.0, 1.0), 0.8) * mix(1.0, 0.55, seamDepth * bumpOn);

  // ---- lighting
  let v = normalize(-in.p);
  let nv = clamp(dot(n, v), 1e-4, 1.0);
  let r = reflect(-v, n);
  // reflections below the geometric surface (bumped normals at grazing angles) fade out
  let horizon = clamp(1.0 + 1.3 * dot(r, ng), 0.0, 1.0);
  let dom = sh[9];
  let sd = shadowAt(in.p, ng, dom.xyz);
  let dirW = dom.w * smoothstep(-0.1, 0.35, dot(ng, dom.xyz));
  let occD = mix(1.0, sd, dirW) * ao;
  let so = clamp(pow(nv + ao, exp2(-16.0 * rough - 1.0)) - 1.0 + ao, 0.0, 1.0); // specular occlusion (Lagarde)
  let occS = so * horizon * horizon * mix(1.0, sd, dom.w * smoothstep(0.5, 0.95, dot(r, dom.xyz)));
  let E = irradiance(n);

  // base layer: metal/paint, with multiple-scattering energy compensation (Fdez-Agüera 2019)
  let f0 = mix(vec3f(0.04), albedo, metal);
  let ab = envAB(rough, nv);
  let fss = f0 * ab.x + ab.y;
  let ess = ab.x + ab.y;
  let fAvg = f0 + (1.0 - f0) / 21.0;
  let fms = fss * fAvg / (1.0 - (1.0 - ess) * fAvg);
  let emsE = (1.0 - ess) * fms;
  let kd = albedo * (1.0 - metal) * (1.0 - (fss + emsE));
  var col = envSpec(r, rough) * fss * occS + (emsE + kd) * E / PI * occD;

  // clear coat: a thin varnish (F0 = 0.04, roughness 0.05) that darkens what is below by its Fresnel
  let cr = clamp(0.05 * S.mat.z, 0.03, 1.0);
  let cab = envAB(cr, nv);
  let fc = (0.04 * cab.x + cab.y) * coat;
  col = col * (1.0 - fc) + envSpec(r, cr) * fc * occS;
  // re-entry: the faces meeting the air glow (visual, driven by ρ v³ — the heat does nothing yet)
  let pl = S.plasma.w;
  if (pl > 0.0) {
    let face = max(dot(n, -S.plasma.xyz), 0.0);
    col += vec3f(1.0, 0.42, 0.2) * (8.0 * pl * pl * face * face) / max(S.light.x, 1e-3);
  }
  return vec4f(col * S.light.x, 1.0);
}

// ------------------------------------------------------------------------------------ composite
@group(0) @binding(0) var shipTex: texture_2d<f32>;

@vertex
fn compVs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn compFs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = textureLoad(shipTex, vec2i(pos.xy), 0);
  return vec4f(min(c.rgb, vec3f(60000.0)), c.a); // premultiplied (MSAA-resolved coverage)
}
