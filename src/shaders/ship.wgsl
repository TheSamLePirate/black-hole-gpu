// The spaceship the camera is mounted on (Interstellar's Ranger), rasterized in the camera's rest
// frame — a few metres across, it lives in the camera's local, flat patch of spacetime — and lit by
// the light probe the tracer takes around the camera (the lensed disk, Gargantua, the sky).
//
//   envCopy / envDown   light probe (storage buffer) → equirectangular texture + box-filtered mips
//                       (pre-filtered radiance for glossy reflections: mip ≈ roughness)
//   envSH               order-2 spherical harmonics of the probe (Ramamoorthi & Hanrahan 2001:
//                       diffuse irradiance) and the dominant light direction (L1 band)
//   shadowVs            depth of the ship seen from the dominant light (orthographic)
//   vs / fs             PBR shading (procedural painted panels per part, split-sum reflections)
//   compVs / compFs     composite over the traced HDR image (premultiplied alpha)
//
// Camera frame C: x right, y up, z forward (right-handed); equirectangular u = atan2(x, z),
// v = polar angle from +y.

struct Ship {
  model: mat4x4f,   // ship → camera frame C
  proj: vec4f,      // tan(fov/2)·aspect, tan(fov/2), near, far
  mat: vec4f,       // hull albedo (mean), metalness scale, roughness scale, env mip count
  bound: vec4f,     // bounding sphere of the ship in C (centre, radius): the shadow map's box
  light: vec4f,     // gain on the light the hull receives (1: physical), unused…
};

const ENV_W = 128u;
const ENV_H = 64u;
const PI = 3.14159265358979;

// ------------------------------------------------------------------------------------ light probe
@group(0) @binding(0) var<storage, read> envIn: array<vec4f>;
@group(0) @binding(1) var envOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var envSrc: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> shOut: array<vec4f>; // 9 × rgb, then dominant dir + directionality

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

var<workgroup> shAcc: array<array<vec3f, 9>, 64>;

fn shBasis(d: vec3f) -> array<f32, 9> {
  return array<f32, 9>(
    0.282095,
    0.488603 * d.y, 0.488603 * d.z, 0.488603 * d.x,
    1.092548 * d.x * d.y, 1.092548 * d.y * d.z, 0.315392 * (3.0 * d.z * d.z - 1.0),
    1.092548 * d.x * d.z, 0.546274 * (d.x * d.x - d.y * d.y));
}

fn envDir(u: f32, v: f32) -> vec3f {
  let ph = (u - 0.5) * 2.0 * PI;
  let th = v * PI;
  return vec3f(sin(th) * sin(ph), cos(th), sin(th) * cos(ph));
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
  // (1 for a single distant source: |L1| / L0 = 0.488603 / 0.282095 · (2/3 · 3/2)… normalised)
  let lum = vec3f(0.2126, 0.7152, 0.0722);
  let l1 = vec3f(dot(tot[3], lum), dot(tot[1], lum), dot(tot[2], lum));
  let l0 = max(dot(tot[0], lum), 1e-20);
  let m = length(l1);
  shOut[9] = vec4f(select(vec3f(0.0, 1.0, 0.0), l1 / m, m > 0.0), clamp(m / (1.7320508 * l0), 0.0, 1.0));
}

// ------------------------------------------------------------------------------------ the ship
@group(0) @binding(0) var<uniform> S: Ship;
@group(0) @binding(1) var<storage, read> sh: array<vec4f>;
@group(0) @binding(2) var envTex: texture_2d<f32>;
@group(0) @binding(3) var linSamp: sampler;
@group(0) @binding(7) var shadowTex: texture_depth_2d;
@group(0) @binding(8) var shadowSamp: sampler_comparison;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) tan: vec4f,
  @location(3) uv: vec2f,
  @location(4) mat: f32,
};

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) p: vec3f,   // camera frame C
  @location(1) n: vec3f,
  @location(2) t: vec4f,
  @location(3) uv: vec2f,
  @location(4) mat: f32,
  @location(5) q: vec3f,   // position and normal in the ship's frame (procedural panels)
  @location(6) qn: vec3f,
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
  o.t = vec4f((S.model * vec4f(v.tan.xyz, 0.0)).xyz, v.tan.w);
  o.uv = v.uv;
  o.mat = v.mat;
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

fn envLookup(d: vec3f, lod: f32) -> vec3f {
  let u = atan2(d.x, d.z) / (2.0 * PI) + 0.5;
  let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
  return textureSampleLevel(envTex, linSamp, vec2f(u, v), lod).rgb;
}

// split-sum environment BRDF, analytic fit (Karis 2014, "Physically based shading on mobile")
fn envBRDF(f0: vec3f, rough: f32, nv: f32) -> vec3f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = rough * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  let ab = vec2f(-1.04, 1.04) * a004 + r.zw;
  return f0 * ab.x + ab.y;
}

fn shadowAt(p: vec3f, n: vec3f, l: vec3f) -> f32 {
  let q = lightClip(p + n * 0.04 + l * 0.02);
  let uv = vec2f(0.5 + 0.5 * q.x, 0.5 - 0.5 * q.y);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  let texel = 1.0 / vec2f(textureDimensions(shadowTex));
  var s = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      s += textureSampleCompareLevel(shadowTex, shadowSamp, uv + vec2f(f32(i), f32(j)) * texel * 1.5, q.z - 0.002);
    }
  }
  return s / 9.0;
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

// Hull plating on one projection plane: panel id (tone variation) and distance to the nearest seam.
fn plating(c: vec2f, size: vec2f, axis: i32) -> vec2f {
  let g = c / size;
  let cell = floor(g);
  let f = abs(fract(g) - 0.5);
  let seam = min((0.5 - f.x) * size.x, (0.5 - f.y) * size.y);
  return vec2f(hash3(vec3i(vec2i(cell), axis)), seam);
}

@fragment
fn fs(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  var n = normalize(in.n);
  if (!front) { n = -n; }
  let part = u32(in.mat + 0.5);
  // triplanar plating in the ship's frame (panels ≈ 1.1 × 0.7 m, seams ≈ 2 cm)
  let an = pow(abs(normalize(in.qn)), vec3f(4.0));
  let w = an / (an.x + an.y + an.z);
  let px = plating(in.q.zy, vec2f(1.1, 0.7), 0);
  let py = plating(in.q.xz, vec2f(0.7, 1.1), 1);
  let pz = plating(in.q.xy, vec2f(0.7, 0.7), 2);
  let tone = w.x * px.x + w.y * py.x + w.z * pz.x;
  let seam = w.x * px.y + w.y * py.y + w.z * pz.y;
  let groove = 1.0 - smoothstep(0.004, 0.02, seam);
  let grime = vnoise(in.q * 1.7) * 0.6 + vnoise(in.q * 7.3) * 0.4;
  var albedo = vec3f(S.mat.x) * (0.9 + 0.14 * tone) * (1.0 - 0.18 * grime * grime) * mix(1.0, 0.45, groove);
  var metal = S.mat.y * (0.8 + 0.4 * tone);
  var rough = clamp(S.mat.z * (0.42 + 0.18 * grime + 0.25 * groove), 0.04, 1.0);
  switch part {
    case 1u: { albedo = vec3f(0.015, 0.018, 0.022); metal = 0.0; rough = 0.05; }          // glass
    case 2u: { albedo = vec3f(0.12, 0.11, 0.10); metal = 0.9; rough = clamp(0.35 * S.mat.z, 0.04, 1.0); } // nozzles
    case 3u: { albedo = vec3f(0.05); metal = 0.3; rough = 0.5; }                            // window frames
    case 4u: { albedo *= 0.75; }                                                            // hatch, airlock
    default: {}
  }
  metal = clamp(metal, 0.0, 1.0);
  let v = normalize(-in.p);
  let nv = max(dot(n, v), 1e-4);
  let r = reflect(-v, n);
  // shadow from the dominant light, weighted by how directional the lighting is
  let dom = sh[9];
  let sd = shadowAt(in.p, normalize(in.n) * select(-1.0, 1.0, front), dom.xyz);
  let occ = mix(1.0, sd, dom.w * smoothstep(-0.1, 0.3, dot(n, dom.xyz)));
  let occR = mix(1.0, sd, dom.w * smoothstep(0.6, 0.95, dot(r, dom.xyz)));
  let f0 = mix(vec3f(0.04), albedo, metal);
  let diffuse = (1.0 - metal) * albedo / PI * irradiance(n) * occ;
  let lod = clamp(rough * (S.mat.w - 1.0) * 0.9, 0.0, S.mat.w - 1.0);
  let spec = envLookup(r, lod) * envBRDF(f0, rough, nv) * occR;
  return vec4f((diffuse + spec) * S.light.x, 1.0);
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
