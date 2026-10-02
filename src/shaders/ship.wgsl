// The spacecraft (vessels.ts): the one the camera is mounted on and the others near it, rasterized in the
// camera's rest frame — metres to kilometres away, they live in the camera's local, flat patch of
// spacetime — and lit by the light probe the tracer takes around the camera (the lensed disk, Gargantua,
// the sky). One pass draws them all, an instance each (its transform, its kind: the Ranger's procedural
// plating, the Lander's painted maps, the Endurance's parts), their depths shared — reversed, in float:
// exact from a hatch's centimetres to a craft kilometres off.
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
//                       (Fdez-Agüera 2019), specular occlusion, specular anti-aliasing; the key
//                       light (a star near: analytic — trace.wgsl keyLight) in GGX with its own
//                       shadow; the mirror-like layers reflecting the traced image itself where it
//                       holds the reflected direction (screenRefl)
//   compVs / compFs     composite over the traced HDR image (premultiplied alpha)
//
// Camera frame C: x right, y up, z forward (right-handed). The probe's own axes (P: equirectangular
// u = atan2(x, z), v = polar angle from +y; its harmonics too) are fixed while the camera turns:
// S.probeX…Z take C's vectors there.

struct Ship {
  model: mat4x4f,   // ship → camera frame C
  proj: vec4f,      // tan(fov/2)·aspect, tan(fov/2), near, far
  mat: vec4f,       // hull albedo, metalness, roughness scale, specular mip count
  bound: vec4f,     // bounding sphere of the ship in C (centre, radius): the shadow map's box
  light: vec4f,     // gain on the light the hull receives (1: physical; × pre-exposure), clear coat (0…1), pre-exposure
  plasma: vec4f,    // re-entry: the air's flow direction (camera frame), glow level 0…1
  // C's axes (x, y, z) in the light probe's axes: the probe keeps its own axes when the camera turns
  probeX: vec4f,
  probeY: vec4f,
  probeZ: vec4f,
  // the rectangle of the image drawn (the ship's box: its MSAA targets are that small): ndc centre, scale
  view: vec4f,
  // thrusters: jets firing (count), display-referred emission scale (pre-exposure / 2^EV: a flame
  // looks as bright whatever the exposure), time [s], air density (relative to sea level)
  jet: vec4f,
  // the space station's box in the image [px] (x, y, width, height; 0: none) — its depth hides the hull
  box: vec4f,
  // the image's size [px], metres per M, the traced depths bound (1) — what hides the other craft
  img: vec4f,
  // the cockpit: the flight sticks' deflections (forward, to the right, twist) [rad], the throttle; their
  // pivots (ship frame, the left one's x > 0); the dashboard's figures — the local up and the motion in
  // the ship's frame, the speed [km/s], the height [km], the clock [s], the thrust's level
  ctl: vec4f,
  piv0: vec4f,
  piv1: vec4f,
  dash0: vec4f,
  dash1: vec4f,
  dash2: vec4f,
};

// A craft drawn: craft → camera frame, then its kind (0 Ranger, 1 Lander, 2 Endurance), in the shadow map
// (1), hidden by what the traced image holds nearer (1: the craft not flown)
struct Inst {
  model: mat4x4f,
  flags: vec4f,
};

// A thruster firing (ship frame, metres): exit centre and level, exhaust direction and kind (0: a
// main engine, 1: an attitude thruster), the exit's half-width and half-height, the plume's length
// and a seed, and the exit's width axis.
struct Jet {
  p: vec4f,
  d: vec4f,
  a: vec4f,
  u: vec4f,
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
  // the key light (the near world's star, analytic — trace.wgsl keyLight — the probe without it): its
  // direction and the disc's angular radius, its irradiance and on (0/1); on, it is the dominant light —
  // the hull's shadow map, its shadow on the ground
  let key = envIn[n + 1u];
  shOut[10] = envIn[n];
  shOut[11] = key;
  if (key.w > 0.5) { shOut[9] = vec4f(normalize(envIn[n].xyz), 1.0); }
}

// ------------------------------------------------------------------------------------ the ship
@group(0) @binding(0) var<uniform> S: Ship;
@group(0) @binding(1) var<storage, read> sh: array<vec4f>;
@group(0) @binding(2) var envTex: texture_2d<f32>; // GGX pre-filtered: mip = roughness · (count − 1)
@group(0) @binding(3) var linSamp: sampler;
@group(0) @binding(7) var shadowTex: texture_depth_2d;
@group(0) @binding(8) var shadowSamp: sampler_comparison;
@group(0) @binding(9) var<storage, read> jets: array<Jet>;
@group(0) @binding(10) var scene: texture_2d<f32>; // the traced image the ship is drawn over (× pre-exposure)
@group(0) @binding(11) var<storage, read> moments: array<vec2f>; // Σ l², the traced depth [M]
@group(0) @binding(12) var<storage, read> inst: array<Inst>;
@group(0) @binding(13) var albedoMap: texture_2d<f32>; // the Lander's paint (sRGB)
@group(0) @binding(14) var normalMap: texture_2d<f32>; // its tangent-space normals (v down the image)
@group(0) @binding(15) var lightsMap: texture_2d<f32>; // its lights' emission
@group(0) @binding(16) var mapSamp: sampler;
@group(1) @binding(0) var stationDepth: texture_2d<f32>; // the station's box: distance [m], coverage

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) mat: f32,
  @location(3) ao: f32,
  @location(4) uv: vec2f,
};

struct VOut {
  @builtin(position) @invariant clip: vec4f,
  @location(0) p: vec3f,   // camera frame C
  @location(1) n: vec3f,
  @location(2) mat: f32,
  @location(3) ao: f32,
  @location(4) q: vec3f,   // position and normal in the ship's frame (procedural plating)
  @location(5) qn: vec3f,
  @location(6) uv: vec2f,
  @location(7) @interpolate(flat) ii: u32,
};

// the near plane [m] (reversed depth: 1 there, 0 at infinity)
const NEAR = 0.01;

fn project(p: vec3f) -> vec4f {
  // same pinhole as the tracer: ndc = (x / (z tan·aspect), y / (z tan)); depth = near / z
  // (then the box's own ndc: ndc' = (ndc − centre) × scale, in clip space)
  let xy = (vec2f(p.x / S.proj.x, p.y / S.proj.y) - S.view.xy * p.z) * S.view.zw;
  return vec4f(xy, NEAR, p.z);
}

/** The flight stick's turn: forward (about the ship's x), to the right (about z), twisted (about y). */
fn stickRot(a: vec3f) -> mat3x3f {
  let cx = cos(a.x); let sx = sin(a.x);
  let cz = cos(a.y); let sz = sin(a.y);
  let cy = cos(a.z); let sy = sin(a.z);
  let Rx = mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, cx, sx), vec3f(0.0, -sx, cx));
  let Rz = mat3x3f(vec3f(cz, sz, 0.0), vec3f(-sz, cz, 0.0), vec3f(0.0, 0.0, 1.0));
  let Ry = mat3x3f(vec3f(cy, 0.0, -sy), vec3f(0.0, 1.0, 0.0), vec3f(sy, 0.0, cy));
  return Rz * Rx * Ry;
}

/** A vertex where it is drawn (the cockpit's flight sticks, 72: turned about their pivots as the pilot flies). */
fn stickPos(v: VIn) -> vec3f {
  if (abs(v.mat - 72.0) < 0.5) {
    let pv = select(S.piv1.xyz, S.piv0.xyz, v.pos.x > 0.0);
    return pv + stickRot(S.ctl.xyz) * (v.pos - pv);
  }
  return v.pos;
}

// the depth alone, first (the shading then runs once a pixel — the cabin's surfaces overlap many times);
// the cockpit's glass left out
struct DOut { @builtin(position) @invariant clip: vec4f };
@vertex
fn depthVs(v: VIn, @builtin(instance_index) ii: u32) -> DOut {
  var o: DOut;
  o.clip = project((inst[ii].model * vec4f(stickPos(v), 1.0)).xyz);
  if (abs(v.mat - 71.0) < 0.5) { o.clip = vec4f(2.0, 2.0, 2.0, 1.0); }
  return o;
}

@vertex
fn vs(v: VIn, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let M = inst[ii].model;
  let pos = stickPos(v);
  var nrm = v.nrm;
  if (abs(v.mat - 72.0) < 0.5) { nrm = stickRot(S.ctl.xyz) * v.nrm; }
  let p = (M * vec4f(pos, 1.0)).xyz;
  o.p = p;
  o.clip = project(p);
  o.n = (M * vec4f(nrm, 0.0)).xyz;
  o.mat = v.mat;
  o.ao = v.ao;
  o.q = pos;
  o.qn = nrm;
  o.uv = v.uv;
  o.ii = ii;
  return o;
}

// C → the probe's axes, and back
fn toProbe(v: vec3f) -> vec3f { return v.x * S.probeX.xyz + v.y * S.probeY.xyz + v.z * S.probeZ.xyz; }
fn fromProbe(d: vec3f) -> vec3f { return vec3f(dot(d, S.probeX.xyz), dot(d, S.probeY.xyz), dot(d, S.probeZ.xyz)); }

// Orthographic view of the ship from the dominant light (direction sh[9].xyz, towards the light):
// x, y ∈ [−1, 1] across the bounding sphere, depth 0 on the light's side.
fn lightClip(p: vec3f) -> vec3f {
  let l = fromProbe(sh[9].xyz);
  let e1 = normalize(cross(l, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(l.y) > 0.9)));
  let e2 = cross(l, e1);
  let q = p - S.bound.xyz;
  let R = S.bound.w;
  return vec3f(dot(q, e1) / R, dot(q, e2) / R, 0.5 - 0.5 * dot(q, l) / R);
}

@vertex
fn shadowVs(v: VIn, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  // (the cockpit's glass lets the light in: out of the map)
  if (abs(v.mat - 71.0) < 0.5) { return vec4f(2.0, 2.0, 2.0, 1.0); }
  return vec4f(lightClip((inst[ii].model * vec4f(v.pos, 1.0)).xyz), 1.0);
}

fn irradiance(n: vec3f) -> vec3f {
  // Ramamoorthi & Hanrahan: E(n) = Σ Â_l L_lm Y_lm(n)
  let b = shBasis(toProbe(n));
  let A = array<f32, 9>(PI, 2.094395, 2.094395, 2.094395, 0.785398, 0.785398, 0.785398, 0.785398, 0.785398);
  var e = vec3f(0.0);
  for (var k = 0u; k < 9u; k++) { e += A[k] * b[k] * sh[k].rgb; }
  return max(e, vec3f(0.0));
}

fn envSpec(d: vec3f, rough: f32) -> vec3f {
  return textureSampleLevel(envTex, linSamp, envUV(toProbe(d)), rough * (S.mat.w - 1.0)).rgb;
}

// split-sum environment BRDF scale and bias (Karis 2014, analytic fit): F0·x + y
fn envAB(rough: f32, nv: f32) -> vec2f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = rough * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  return vec2f(-1.04, 1.04) * a004 + r.zw;
}

// GGX specular from a disc light (angular radius rs) for the irradiance it gives at normal incidence:
// D · V (height-correlated Smith), the lobe widened by the disc (Karis 2013: α' = α + rs/2 — the
// highlight of a mirror-smooth varnish the Sun's own disc, not a point). Times F, E, n·l by the caller.
fn ggxSpec(nh: f32, nv: f32, nl: f32, rough: f32, rs: f32) -> f32 {
  let a = min(rough * rough + 0.5 * rs, 1.0);
  let aa = a * a;
  let dd = nh * nh * (aa - 1.0) + 1.0;
  let D = aa / (PI * dd * dd);
  let gv = nl * sqrt(nv * nv * (1.0 - aa) + aa);
  let gl = nv * sqrt(nl * nl * (1.0 - aa) + aa);
  let V = 0.5 / max(gv + gl, 1e-6);
  return D * V;
}

// How much of a direction (camera frame) the traced image holds: 1 well inside the frame, fading to 0
// over its last 6 % (and behind the camera)
fn inFrame(d: vec3f) -> f32 {
  if (d.z <= 0.0) { return 0.0; }
  let ndc = vec2f(d.x / (d.z * S.proj.x), d.y / (d.z * S.proj.y));
  let e = 1.0 - max(abs(ndc.x), abs(ndc.y));
  return smoothstep(0.0, 0.12, e);
}

// The far scene reflected along r, from the traced image itself: the world around the ship is at
// infinity next to its metres, so what a mirror shows along r is what the camera sees along r — at the
// image's full resolution (the probe's texels are 1.4° wide: windows and varnish reflected a blur).
// A cone of half-angle a: five taps (the centre, four around it). Radiance (the probe's units), weight.
fn screenRefl(r: vec3f, a: f32) -> vec4f {
  let w = inFrame(r);
  if (w <= 0.0) { return vec4f(0.0); }
  let dims = vec2f(textureDimensions(scene));
  let uv = vec2f(0.5 + 0.5 * r.x / (r.z * S.proj.x), 0.5 - 0.5 * r.y / (r.z * S.proj.y)) * dims;
  // (pixels per radian there)
  let rad = min(a * 0.5 * dims.y / (S.proj.y * r.z * r.z), 24.0);
  var acc = textureLoad(scene, clamp(vec2i(uv), vec2i(0), vec2i(dims) - 1), 0).rgb * 2.0;
  for (var k = 0; k < 4; k++) {
    let o = rad * vec2f(select(-0.7, 0.7, (k & 1) == 1), select(-0.7, 0.7, (k & 2) == 2));
    acc += textureLoad(scene, clamp(vec2i(uv + o), vec2i(0), vec2i(dims) - 1), 0).rgb;
  }
  return vec4f(acc / 6.0 / max(S.light.z, 1e-30), w);
}

// Poisson-disk PCF (8 taps, each a bilinear 2×2 comparison), normal-offset bias
fn shadowAt(p: vec3f, ng: vec3f, l: vec3f) -> f32 {
  let q = lightClip(p + ng * 0.05 + l * 0.02);
  let uv = vec2f(0.5 + 0.5 * q.x, 0.5 - 0.5 * q.y);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  let texel = 1.0 / vec2f(textureDimensions(shadowTex));
  let taps = array<vec2f, 8>(
    vec2f(-0.613, 0.617), vec2f(0.170, -0.040), vec2f(-0.299, -0.792), vec2f(0.645, 0.493),
    vec2f(-0.651, -0.118), vec2f(0.422, -0.810), vec2f(0.035, 0.950), vec2f(0.934, -0.208));
  var s = 0.0;
  for (var i = 0; i < 8; i++) {
    s += textureSampleCompareLevel(shadowTex, shadowSamp, uv + taps[i] * texel * 2.5, q.z - 0.0015);
  }
  return s / 8.0;
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


// ------------------------------------------------------------------------------------ the cockpit
// The cabin's surfaces (materials 60–72: scripts/build-cockpit.ts), shaded procedurally — the model came
// without its maps: relief on the dominant projection plane (c, metres), its height [m] by kind.
fn cabinHeight(kind: u32, c: vec2f, fw: f32) -> f32 {
  switch kind {
    // padded walls and ceiling, the airlock: quilted cushions 22 cm, seams between them
    case 61u, 70u: {
      let g = c / 0.22;
      let f = fract(g) * 2.0 - 1.0;
      let seam = clamp(0.004 / (1.5 * fw) - 0.35, 0.0, 1.0);
      return 0.006 * (1.0 - f.x * f.x) * (1.0 - f.y * f.y) - 0.002 * seam * (1.0 - smoothstep(0.0, 0.06, min(1.0 - abs(f.x), 1.0 - abs(f.y))));
    }
    // the floor: diamond plate, 3 cm
    case 60u: {
      let g = c / 0.03;
      let r = vec2f(fract(g.x + g.y) - 0.5, fract(g.x - g.y + 0.5 * floor(g.y)) - 0.5);
      let fade = clamp(0.01 / (1.5 * fw) - 0.35, 0.0, 1.0);
      return 0.0012 * fade * (1.0 - smoothstep(0.08, 0.2, abs(r.x) * abs(r.y) * 8.0));
    }
    // the seats: stitched fabric, 8 cm
    case 63u: {
      let f = fract(c / 0.08) * 2.0 - 1.0;
      return 0.0035 * (1.0 - f.x * f.x) * (1.0 - f.y * f.y);
    }
    // the consoles: panel lines every 12 cm
    case 62u: {
      let f = fract(c / 0.12);
      let e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 0.12;
      let fade = clamp(0.003 / (1.5 * fw) - 0.35, 0.0, 1.0);
      return -0.0008 * fade * (1.0 - smoothstep(0.0, 0.0015, e));
    }
    default: { return 0.0; }
  }
}

fn glyph(p: vec2f, seed: f32) -> f32 {
  // a 3 × 5 cell block of "characters": lit cells by a hash — text, from afar
  let cell = floor(p * vec2f(3.0, 5.0));
  return step(0.45, hash3(vec3i(vec2i(cell), i32(seed * 977.0))));
}

/** A screen's picture (its own UV 0…1, its number), as the film's: cyan monochrome — block diagrams,
 *  columns of text, the attitude, the orbit; one in four black with white and amber text. The flight's
 *  figures drive them. Linear radiance, display-referred. */
fn screenUI(uv: vec2f, k: f32, t: f32) -> vec3f {
  let id = u32(k + 0.5) % 5u;
  let base = vec3f(0.05, 0.3, 0.42);     // the lit screen
  let ink = vec3f(0.55, 0.92, 1.0);      // its brighter lines and text
  let dark = vec3f(0.015, 0.08, 0.12);   // its darker text
  let p = uv * 2.0 - 1.0;
  let up = S.dash0.xyz;
  var c = base;
  if (id == 0u) {
    // the attitude: the horizon turned by the roll, moved by the pitch (the local up in the ship's frame)
    let roll = atan2(-up.x, up.y);
    let pitch = asin(clamp(up.z, -1.0, 1.0));
    let q = vec2f(cos(roll) * p.x + sin(roll) * p.y, -sin(roll) * p.x + cos(roll) * p.y);
    let y = q.y + pitch * 1.6;
    c = mix(base * 1.25, base * 0.55, step(0.0, -y));
    c = mix(c, ink, 1.0 - smoothstep(0.0, 0.02, abs(y)));
    for (var i = -3; i <= 3; i++) {
      if (i == 0) { continue; }
      let yy = y - f32(i) * 0.28;
      c = mix(c, ink, 0.8 * (1.0 - smoothstep(0.0, 0.012, abs(yy))) * step(abs(q.x), 0.18 + 0.06 * f32(abs(i) % 2)));
    }
    c = mix(c, vec3f(1.0, 0.8, 0.4), (1.0 - smoothstep(0.0, 0.025, abs(p.y))) * step(0.12, abs(p.x)) * step(abs(p.x), 0.4));
  } else if (id == 1u || id == 4u) {
    // a block diagram: boxes, the lines between them, labels in them
    let cell = floor(uv * vec2f(3.0, 4.0));
    let f = fract(uv * vec2f(3.0, 4.0));
    let hb = hash3(vec3i(vec2i(cell), i32(id) * 7 + i32(k)));
    let inBox = step(0.12, f.x) * step(f.x, 0.88) * step(0.2, f.y) * step(f.y, 0.8) * step(0.25, hb);
    let edge = inBox * (1.0 - step(0.15, f.x) * step(f.x, 0.85) * step(0.24, f.y) * step(f.y, 0.76));
    c = mix(c, base * 1.5, inBox * 0.6);
    c = mix(c, ink, edge);
    let line = (1.0 - smoothstep(0.0, 0.015, abs(f.y - 0.5))) * step(f.x, 0.12) + (1.0 - smoothstep(0.0, 0.015, abs(f.x - 0.5))) * step(f.y, 0.2) * step(0.6, hb);
    c = mix(c, ink, clamp(line, 0.0, 1.0) * 0.8);
    let lab = glyph(fract(vec2f(f.x * 10.0, f.y * 6.0)), floor(f.x * 10.0) + hb * 91.0) * inBox * step(0.3, f.x) * step(f.x, 0.75) * step(0.42, f.y) * step(f.y, 0.58);
    c = mix(c, dark, lab);
    // (a figure that changes: the thrust's level, flickering in one of them)
    let blink = step(0.5, fract(t * 1.5 + hb * 3.0)) * step(0.85, hb);
    c = mix(c, ink * 1.3, blink * inBox * 0.3);
  } else if (id == 2u) {
    // columns of text, scrolling slowly; a trace at the foot
    let rows = 16.0;
    let row = floor(uv.y * rows - t * 0.6);
    let lx = uv.x * 22.0;
    let word = hash3(vec3i(i32(floor(lx / 5.0)), i32(row), i32(k)));
    let on = glyph(fract(vec2f(lx, uv.y * rows - t * 0.6)), floor(lx) + row * 31.0) * step(fract(lx), 0.75) * step(fract(uv.y * rows - t * 0.6), 0.7) * step(0.3, word) * step(fract(lx / 5.0), 0.8) * step(uv.y, 0.7);
    c = mix(c, dark, on);
    let wave = 0.84 + 0.06 * sin(uv.x * 18.0 + t * 1.3) * (0.4 + 0.6 * S.dash2.w);
    c = mix(c, ink, 1.0 - smoothstep(0.0, 0.012, abs(uv.y - wave)));
  } else {
    // black with white and amber text (the film's upper screen): the flight's figures, a blinking line
    c = vec3f(0.006, 0.008, 0.01);
    let rows = 9.0;
    let row = floor(uv.y * rows);
    let lx = uv.x * 14.0;
    let on = glyph(fract(vec2f(lx, uv.y * rows)), floor(lx) + row * 17.0 + floor(t * 0.5) * step(4.0, row)) * step(fract(lx), 0.75) * step(fract(uv.y * rows), 0.7) * step(0.3, hash3(vec3i(i32(floor(lx / 4.0)), i32(row), 5)));
    let col = select(vec3f(1.0, 0.95, 0.75), vec3f(1.0, 0.7, 0.2), row > 5.0);
    c = mix(c, col * 0.9, on * select(1.0, step(0.5, fract(t * 0.9)), row == 8.0));
  }
  // (the screen's fine lines, its edges' fall-off)
  c *= 0.9 + 0.1 * sin(uv.y * 600.0);
  let edge = smoothstep(0.0, 0.03, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  return c * edge;
}

@fragment
fn fs(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  return shade(in, front, false);
}

// the cockpit's glass (71): see-through, its reflections over the view (blended, premultiplied)
@fragment
fn fsGlass(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  return shade(in, front, true);
}

fn shade(in: VOut, front: bool, glassPass: bool) -> vec4f {
  // (the space station before it: hidden there — the station is composited first, into the traced image)
  if (S.box.z > 0.0) {
    let dims = vec2f(textureDimensions(scene));
    let px = vec2f((in.p.x / (in.p.z * S.proj.x) + 1.0) * 0.5, (1.0 - in.p.y / (in.p.z * S.proj.y)) * 0.5) * dims - S.box.xy;
    let sd = vec2i(textureDimensions(stationDepth));
    let q = vec2i(px);
    if (all(q >= vec2i(0)) && all(q < sd)) {
      let st = textureLoad(stationDepth, q, 0);
      if (st.g > 0.5 && st.r / st.g < length(in.p) - 0.05) { discard; }
    }
  }
  let I = inst[in.ii];
  let model = I.model;
  let kind = u32(I.flags.x + 0.5);
  // (a craft not flown: hidden where the traced image holds something nearer — a planet, the disk)
  if (I.flags.z > 0.5 && S.img.w > 0.5) {
    let px = vec2f((in.p.x / (in.p.z * S.proj.x) + 1.0) * 0.5, (1.0 - in.p.y / (in.p.z * S.proj.y)) * 0.5) * S.img.xy;
    let q = vec2u(clamp(px, vec2f(0.0), S.img.xy - 1.0));
    if (moments[q.y * u32(S.img.x) + q.x].y * S.img.z < length(in.p) * 0.999) { discard; }
  }
  let side = select(-1.0, 1.0, front);
  let ng = normalize(in.n) * side;       // geometric (smoothed) normal, camera frame
  let qn = normalize(in.qn) * side;      // same, ship frame
  let part = u32(in.mat + 0.5);
  // (the cockpit's glass in its own pass; the rest in the opaque one)
  if ((part == 71u) != glassPass) { discard; }
  let cabin = part >= 60u && part != 71u;
  let fw = max(length(fwidth(in.q)), 1e-5);
  // specular anti-aliasing (Kaplanyan & Hoffman 2016): normal variation within the pixel
  let dn = fwidth(ng);
  let kernel = min(2.0 * dot(dn, dn), 0.25);

  // ---- procedural relief: gradient of the height field by finite differences, in the ship frame
  // plating projected along the dominant axis only (blending projections would cross two seam
  // grids), its plane picked by one-hot weights: one plate per sample, three in all. (No branches:
  // per-pixel branches here measured slower than the arithmetic they skip.)
  let aq = abs(qn);
  let w = select(select(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), aq.y >= aq.z), vec3f(1.0, 0.0, 0.0), aq.x >= aq.y && aq.x >= aq.z);
  let c = w.x * in.q.zy + w.y * in.q.xz + w.z * in.q.xy;
  let size = w.x * vec2f(1.1, 0.7) + w.y * vec2f(0.7, 1.1) + w.z * vec2f(0.7, 0.7);
  let axis = i32(w.y + 2.0 * w.z);
  let e = max(0.5 * fw, 0.0015);
  // (the hull's plating: the Ranger's hull alone — the cabin has its own relief)
  var h0 = vec2f(0.0, 0.5);
  var g = vec2f(0.0);
  if (!cabin) {
    h0 = plate(c, size, axis, fw);
    g = (vec2f(plate(c + vec2f(e, 0.0), size, axis, fw).x, plate(c + vec2f(0.0, e), size, axis, fw).x) - h0.x) / e;
  }
  var grad = w.x * vec3f(0.0, g.y, g.x) + w.y * vec3f(g.x, 0.0, g.y) + w.z * vec3f(g.x, g.y, 0.0);
  grad -= dot(grad, qn) * qn;
  let bumpOn = select(0.0, 1.0, kind == 0u && (part == 0u || part == 4u));
  var qb = normalize(qn - grad * bumpOn);
  // (the cabin: its own relief, on the same plane)
  if (cabin) {
    let hc = cabinHeight(part, c, fw);
    let gc = (vec2f(cabinHeight(part, c + vec2f(e, 0.0), fw), cabinHeight(part, c + vec2f(0.0, e), fw)) - hc) / e;
    var gr = w.x * vec3f(0.0, gc.y, gc.x) + w.y * vec3f(gc.x, 0.0, gc.y) + w.z * vec3f(gc.x, gc.y, 0.0);
    gr -= dot(gr, qn) * qn;
    qb = normalize(qn - gr);
  }
  var n = normalize((model * vec4f(qb, 0.0)).xyz);
  // (the maps' footprint: the UV's and the position's derivatives, taken here — in uniform control flow)
  let duvx = dpdx(in.uv);
  let duvy = dpdy(in.uv);
  let dpx = dpdx(in.p);
  let dpy = dpdy(in.p);

  // ---- material
  let tone = h0.y;
  let seamDepth = clamp(-h0.x / 0.003, 0.0, 1.0);
  // (the cabin: one octave — its surfaces fill the view, the shading's cost counts)
  var grime = vnoise(in.q * 1.3) * 0.55;
  if (!cabin) { grime += vnoise(in.q * 6.1) * 0.3 + vnoise(in.q * 23.0) * 0.15; } else { grime += 0.25; }
  var albedo = vec3f(S.mat.x) * (0.92 + 0.12 * tone) * (1.0 - 0.22 * grime * grime) * mix(1.0, 0.45, seamDepth * bumpOn);
  var metal = S.mat.y;
  var rough = 0.5 + 0.2 * grime;
  var coat = S.light.y; // clear coat over the paint
  var emit = vec3f(0.0);
  switch part {
    case 1u: { albedo = vec3f(0.01, 0.012, 0.015); metal = 0.0; rough = 0.03; coat = 0.0; }        // glass
    case 2u: { albedo = vec3f(0.35, 0.33, 0.31); metal = 1.0; rough = 0.32 + 0.1 * grime; coat = 0.0; } // nozzles
    case 3u: { albedo = vec3f(0.04); metal = 0.0; rough = 0.45; coat = 0.5 * coat; }                // window frames
    case 4u: { albedo *= 0.72; }                                                                     // hatch, airlock
    case 10u: {
      // the Lander: its painted maps — colour, normals (a cotangent frame from the derivatives: Schüler
      // 2013), its lights; plates of painted metal under a thin varnish, the dark ones rougher
      albedo = textureSampleGrad(albedoMap, mapSamp, in.uv, duvx, duvy).rgb;
      var tn = textureSampleGrad(normalMap, mapSamp, in.uv, duvx, duvy).xyz * 2.0 - 1.0;
      tn.y = -tn.y;
      let d2 = cross(dpy, ng);
      let d1 = cross(ng, dpx);
      let T = d2 * duvx.x + d1 * duvy.x;
      let B = d2 * duvx.y + d1 * duvy.y;
      let im = inverseSqrt(max(max(dot(T, T), dot(B, B)), 1e-30));
      n = normalize(T * im * tn.x + B * im * tn.y + ng * tn.z);
      let lum = dot(albedo, vec3f(0.2126, 0.7152, 0.0722));
      metal = 0.3;
      rough = 0.35 + 0.35 * (1.0 - smoothstep(0.02, 0.3, lum)) + 0.1 * grime;
      coat = 0.35 * coat;
      emit = textureSampleGrad(lightsMap, mapSamp, in.uv, duvx, duvy).rgb;
    }
    // the Endurance's parts (as endurance.wgsl): metal, non-metal panels, glass, tiles, lights, interior,
    // the rolling shuttle
    case 20u: { albedo = vec3f(0.72) * (1.0 - 0.18 * grime); metal = 1.0; rough = 0.38 + 0.12 * grime; coat = 0.0; }
    case 21u: { albedo = vec3f(0.42, 0.42, 0.44) * (1.0 - 0.15 * grime); metal = 0.0; rough = 0.6; coat = 0.3 * coat; }
    case 22u: { albedo = vec3f(0.02); metal = 0.0; rough = 0.06; coat = 0.0; }
    case 23u: { albedo = vec3f(0.82, 0.81, 0.78) * (1.0 - 0.12 * grime); metal = 0.0; rough = 0.75; coat = 0.0; }
    case 24u: { albedo = vec3f(0.1); metal = 0.0; rough = 0.5; coat = 0.0; emit = vec3f(0.35, 0.6, 1.0) * 0.6; }
    case 25u: { albedo = vec3f(0.25); metal = 0.0; rough = 0.8; coat = 0.0; }
    case 26u: { albedo = vec3f(0.62, 0.62, 0.6); metal = 0.3; rough = 0.5; coat = 0.2 * coat; }
    // the cockpit (each part's tone varied by its hash; the small parts on the consoles: switches, some
    // of them lit)
    case 60u: { albedo = vec3f(0.07, 0.075, 0.085) * (1.0 - 0.3 * grime); metal = 0.6; rough = 0.42 + 0.25 * grime; coat = 0.0; }
    case 61u, 70u: { albedo = vec3f(0.6, 0.62, 0.64) * (0.9 + 0.2 * fract(in.uv.y)) * (1.0 - 0.12 * grime); metal = 0.0; rough = 0.85; coat = 0.0; }
    case 62u: {
      // the consoles: charcoal, their panels' markings silk-screened light grey (labels, lines), the small
      // parts — switches — a little lighter
      let small = floor(in.uv.y) < 4.0;
      // (labels: a thin strip — text from arm's length — in one cell of eight on a 6 × 2.5 cm grid; a rule
      // every 20 cm; faded out where a pixel spans them)
      let gc = c / vec2f(0.06, 0.025);
      let fc = fract(gc);
      let hc = hash3(vec3i(vec2i(floor(gc)), 3));
      let fadeL = clamp(0.004 / (1.5 * fw) - 0.35, 0.0, 1.0);
      let lab = step(0.87, hc) * step(0.1, fc.x) * step(fc.x, 0.25 + 0.6 * fract(hc * 13.0)) * step(0.38, fc.y) * step(fc.y, 0.62) * fadeL;
      let ruled = (1.0 - smoothstep(0.0, 0.0008, abs(fract(c.y * 5.0 + 0.5) - 0.5) / 5.0)) * fadeL;
      albedo = select(vec3f(0.03, 0.033, 0.036) * (0.85 + 0.3 * fract(in.uv.y)), vec3f(0.07, 0.072, 0.075), small);
      albedo = mix(albedo, vec3f(0.5), clamp(lab * 0.85 + ruled * 0.3, 0.0, 1.0) * select(1.0, 0.0, small));
      metal = 0.0; rough = 0.55 + 0.15 * grime; coat = 0.1 * coat;
    }
    case 63u: { albedo = vec3f(0.04, 0.045, 0.055) * (0.85 + 0.3 * fract(in.uv.y)); metal = 0.0; rough = 0.92; coat = 0.0; }
    case 64u: { albedo = vec3f(0.8, 0.8, 0.78) * (1.0 - 0.08 * grime); metal = 0.0; rough = 0.22; coat = 0.6 * coat; }
    case 65u: { albedo = vec3f(0.37, 0.34, 0.26) * (0.85 + 0.3 * fract(in.uv.y)) * (1.0 - 0.2 * grime); metal = 0.0; rough = 0.95; coat = 0.0; }
    case 66u: {
      // brushed aluminium: streaks along the part's longest axis (the noise stretched)
      let st = vnoise(in.q * vec3f(3.0, 3.0, 3.0) + vec3f(0.0, 0.0, in.q.x * 80.0));
      albedo = vec3f(0.62, 0.62, 0.64) * (0.92 + 0.08 * st); metal = 1.0; rough = 0.24 + 0.14 * st + 0.1 * grime; coat = 0.0;
    }
    case 67u: { albedo = vec3f(0.03, 0.032, 0.035); metal = 0.2; rough = 0.45; coat = 0.0; }
    case 68u: { albedo = vec3f(0.008); metal = 0.0; rough = 0.06; coat = 0.0; }
    case 69u: { albedo = vec3f(0.16, 0.16, 0.17) * (1.0 - 0.2 * grime); metal = 0.75; rough = 0.38 + 0.2 * grime; coat = 0.0; }
    case 72u: { albedo = vec3f(0.025); metal = 0.0; rough = 0.62; coat = 0.0; }
    // (the glass: no diffuse light of its own — the lamps' highlights only)
    case 71u: { albedo = vec3f(0.0); metal = 0.0; rough = 0.05; coat = 0.0; }
    default: {}
  }
  // the cabin's own light: the screens' pictures, the switches' LEDs (green, amber, red, blue — a few
  // blinking), the clock the screens run on
  let tm = S.dash2.x;
  if (part == 68u) {
    let k = floor(in.uv.x * 0.5);
    emit = screenUI(vec2f(in.uv.x - 2.0 * k, in.uv.y), k, tm) * 2.2;
  } else if ((part == 62u || part == 66u || part == 69u) && floor(in.uv.y) < 2.5 && fract(in.uv.y) > 0.72) {
    // (the tiniest parts only — indicators, not the switches —, a soft dome lit from within)
    let hh = fract(in.uv.y);
    // (the film's: white and amber, a rare red)
    let led = select(select(vec3f(1.0, 0.95, 0.85), vec3f(1.0, 0.55, 0.12), hh > 0.84), vec3f(1.0, 0.18, 0.08), hh > 0.94);
    let blink = select(1.0, step(0.5, fract(tm * (0.7 + hh) + hh * 7.0)), hh > 0.95);
    emit = led * 1.2 * blink * (0.5 + 0.5 * clamp(dot(n, normalize(-in.p)), 0.0, 1.0));
    albedo = led * 0.15;
  }
  rough = clamp(rough * S.mat.z, 0.03, 1.0);
  let alpha = rough * rough;
  rough = sqrt(sqrt(min(alpha * alpha + kernel, 1.0)));
  metal = clamp(metal, 0.0, 1.0);
  // baked per vertex (≈ 0.45 m triangles): softened a little, and the seams' own cavity added
  let ao = pow(clamp(in.ao, 0.0, 1.0), 0.8) * mix(1.0, 0.55, seamDepth * bumpOn);
  // (the cabin: the outside's light only through its windows — the share of the sky each point sees, baked)
  let skyV = select(1.0, clamp(in.uv.x, 0.0, 1.0), cabin && part != 68u);

  // ---- lighting
  let v = normalize(-in.p);
  let nv = clamp(dot(n, v), 1e-4, 1.0);
  let r = reflect(-v, n);
  // reflections below the geometric surface (bumped normals at grazing angles) fade out
  let horizon = clamp(1.0 + 1.3 * dot(r, ng), 0.0, 1.0);
  let dom = vec4f(fromProbe(sh[9].xyz), sh[9].w);
  // (with a key light the probe holds the surroundings alone — no light in it compact enough to cast
  // the hull's shadow: that is the key's)
  let keyOn = sh[11].w > 0.5;
  let dirW = select(dom.w * smoothstep(-0.1, 0.35, dot(ng, dom.xyz)), 0.0, keyOn);
  let specW = select(dom.w * smoothstep(0.5, 0.95, dot(r, dom.xyz)), 0.0, keyOn);
  // (a craft away from the flown one is not in its shadow map)
  let shOn = I.flags.y > 0.5;
  let sd = select(1.0, shadowAt(in.p, ng, dom.xyz), shOn);
  let occD = mix(1.0, sd, dirW) * ao;
  let so = clamp(pow(nv + ao, exp2(-16.0 * rough - 1.0)) - 1.0 + ao, 0.0, 1.0); // specular occlusion (Lagarde)
  let occS = so * horizon * horizon * mix(1.0, sd, specW);
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
  // the mirror-like layers (glass, the varnish) reflect the traced image where it holds the direction,
  // the probe elsewhere; rougher ones the probe (one cone of taps, as sharp as the smoother layer)
  let cr = clamp(0.05 * S.mat.z, 0.03, 1.0);
  let ar = min(rough, cr);
  // (the traced image's own reflection: for the smooth layers only — the cabin's matt surfaces skip it)
  var sr = vec4f(0.0);
  if (!cabin || ar < 0.3) { sr = screenRefl(r, ar * ar); }
  let wB = sr.w * (1.0 - smoothstep(0.1, 0.3, rough));
  let wC = sr.w * (1.0 - smoothstep(0.1, 0.3, cr));
  var col = (mix(envSpec(r, rough), sr.rgb, wB) * fss * occS + (emsE + kd) * E / PI * occD) * skyV;

  // the key light (a star, a disc of angular radius rs): Lambert and GGX on the base, the varnish's own
  // sharp highlight on top — shadowed by the hull (its shadow map, from this light)
  var key = vec3f(0.0);
  var keyCoat = vec3f(0.0);
  var keyFc = 0.0;
  if (keyOn) {
    let Ek = sh[11].rgb;
    let rs = sh[10].w;
    let l = dom.xyz;
    let nl = dot(n, l);
    // (the bumped normal facing the light on a face turned away from it: no light)
    let face = smoothstep(-0.02, 0.08, dot(ng, l));
    if (nl > 0.0 && face > 0.0 && dot(Ek, Ek) > 0.0) {
      let vis = select(1.0, shadowAt(in.p, ng, l), shOn) * face;
      let hv = normalize(l + v);
      let nh = clamp(dot(n, hv), 0.0, 1.0);
      let vh = clamp(dot(v, hv), 0.0, 1.0);
      let fk = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
      // (the star itself in the traced image, reflected there already: its highlight not twice)
      let lf = inFrame(l);
      let sk = ggxSpec(nh, nv, nl, rough, rs) * fk * (1.0 - wB * lf);
      // (the multiple scattering's energy, as for the environment: Fdez-Agüera)
      let ms = 1.0 + f0 * (1.0 - ess) / max(ess, 1e-3);
      let kdk = albedo * (1.0 - metal) * (1.0 - fk) / PI;
      key = (kdk + sk * ms) * Ek * nl * vis;
      let fcv = (0.04 + 0.96 * pow(1.0 - vh, 5.0)) * coat;
      keyFc = fcv;
      keyCoat = ggxSpec(nh, nv, nl, cr, rs) * fcv * Ek * nl * vis * (1.0 - wC * lf);
    }
  }
  // clear coat: a thin varnish (F0 = 0.04, roughness 0.05) that darkens what is below by its Fresnel
  let cab = envAB(cr, nv);
  let fc = (0.04 * cab.x + cab.y) * coat;
  col = col * (1.0 - fc) + mix(envSpec(r, cr), sr.rgb, wC) * fc * occS + key * (1.0 - keyFc) + keyCoat;
  // re-entry: the faces meeting the air glow (visual, driven by ρ v³ — the heat does nothing yet)
  let pl = S.plasma.w;
  if (pl > 0.0) {
    let face = max(dot(n, -S.plasma.xyz), 0.0);
    col += vec3f(1.0, 0.42, 0.2) * (8.0 * pl * pl * face * face) * S.light.z / max(S.light.x, 1e-30);
  }
  // the thrusters' own light on the hull (and in the engine bays): display-referred, like the flames
  var jl = vec3f(0.0);
  let dif = albedo * (1.0 - metal) + f0 * 0.25;
  for (var k = 0u; k < u32(S.jet.x); k++) {
    let J = jets[k];
    let main = J.d.w < 0.5;
    let src = J.p.xyz + J.d.xyz * select(0.25, 0.9, main);
    let lp = (S.model * vec4f(src, 1.0)).xyz;
    let L = lp - in.p;
    let d2 = dot(L, L);
    let ndl = max(dot(n, L * inverseSqrt(d2)), 0.0);
    let tint = select(vec3f(1.0, 0.95, 0.88), vec3f(0.55, 0.72, 1.0), main);
    jl += tint * (J.p.w * select(0.5, 2.2, main) * ndl / (d2 + select(0.08, 0.35, main)));
  }
  // (resolved by the MSAA as c / (1 + L): a highlight's sample no longer outweighs the pixel's others —
  // the hardware's plain mean of HDR values left the lit edges jagged; compFs undoes it)
  // the cabin's lamps: warm lights along the ceiling and over the consoles (display-referred, as the
  // thrusters': the cabin as lit whatever the exposure the outside sets), GGX highlights too
  var cl = vec3f(0.0);
  if (cabin || glassPass) {
    let lamps = array<vec3f, 4>(vec3f(0.0, 2.1, -3.2), vec3f(0.0, 2.15, -0.3), vec3f(0.85, 2.05, 2.4), vec3f(-0.85, 2.05, 2.4));
    for (var k = 0; k < 4; k++) {
      let lp = (model * vec4f(lamps[k], 1.0)).xyz;
      let L = lp - in.p;
      let d2 = dot(L, L);
      let l = L * inverseSqrt(d2);
      let nl = max(dot(n, l), 0.0);
      let hv = normalize(l + v);
      let spec = ggxSpec(clamp(dot(n, hv), 0.0, 1.0), nv, nl, max(rough, 0.08), 0.05) * (f0 + (1.0 - f0) * pow(1.0 - clamp(dot(v, hv), 0.0, 1.0), 5.0));
      cl += vec3f(0.85, 0.93, 1.0) * (albedo * (1.0 - metal) / PI + spec) * nl / (d2 + 0.25);
    }
    // (and the light the cabin's pale walls send round it: a soft fill)
    cl = (cl * 3.5 + albedo * (1.0 - metal) * vec3f(0.12, 0.14, 0.16)) * ao;
  }
  // (the thrusters light the flown craft; the lights, display-referred too: seen whatever the exposure)
  let own = select(0.0, 1.0, in.ii == 0u);
  if (glassPass) {
    // the glass: the cabin reflected (its lamps, a faint glow) by Fresnel, the outside seen through it
    let F = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
    let og = (cl + vec3f(0.02, 0.025, 0.03) * F) * S.jet.y;
    let a = clamp(0.02 + 0.9 * F, 0.0, 1.0);
    return vec4f(og / (1.0 + dot(og, vec3f(0.2126, 0.7152, 0.0722))), a);
  }
  let o = col * S.light.x + (dif * jl * ao * own + emit * 2.0 + cl) * S.jet.y;
  return vec4f(o / (1.0 + dot(o, vec3f(0.2126, 0.7152, 0.0722))), 1.0);
}

// ------------------------------------------------------------------------------------ thrusters
// Each firing thruster is a glowing volume in a box around its plume, marched along the view ray
// (emission only, added over the hull and the sky; the depth test against the hull hides what is
// behind it). Main engines: a blue-white core, hottest at the exit, a wide faint halo; in vacuum
// long and flaring, in air narrow with shock diamonds. Attitude thrusters: short white puffs.

/** The tracer's pinhole over the whole image (the plumes' half-resolution pass), with a depth. */
fn projectFull(p: vec3f) -> vec4f {
  let near = S.proj.z;
  let far = S.proj.w;
  return vec4f(p.x / S.proj.x, p.y / S.proj.y, (p.z - near) * far / (far - near), p.z);
}

// the hull's depth alone, at the plumes' resolution: what hides them
@vertex
fn hullDepthVs(v: VIn) -> @builtin(position) vec4f {
  return projectFull((S.model * vec4f(v.pos, 1.0)).xyz);
}

@fragment
fn hullDepthFs() -> @location(0) vec4f {
  return vec4f(0.0);
}

struct POut {
  @builtin(position) clip: vec4f,
  @location(0) q: vec3f, // ship frame
  @location(1) @interpolate(flat) id: u32,
};

const CUBE = array<u32, 36>(0u, 2u, 1u, 1u, 2u, 3u, 4u, 5u, 6u, 5u, 7u, 6u, 0u, 1u, 4u, 1u, 5u, 4u,
  2u, 6u, 3u, 3u, 6u, 7u, 0u, 4u, 2u, 2u, 4u, 6u, 1u, 3u, 5u, 3u, 7u, 5u);

/** The plume's half-extents (along the exit's width and height axes) at a distance s from the exit. */
fn plumeRadius(J: Jet, s: f32) -> vec2f {
  if (J.d.w < 0.5) {
    // (vacuum: the exhaust flares out; in air it stays a column)
    let spread = mix(0.16, 0.03, clamp(S.jet.w, 0.0, 1.0));
    return J.a.xy + vec2f(max(s, 0.0) * spread);
  }
  return J.a.xy + vec2f(max(s, 0.0) * 0.45);
}

// the proxy: a frustum around the plume (its halo included), from just inside the exit to 0.85 × its
// length (the flame has faded by then) — tight, so few pixels run the march
const HALO = 1.45;
fn plumeEnd(J: Jet) -> f32 { return J.a.z * 0.85; }
fn plumeBox(J: Jet) -> vec3f {
  return vec3f(plumeRadius(J, plumeEnd(J)) * HALO, plumeEnd(J));
}

@vertex
fn plumeVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> POut {
  let J = jets[ii];
  let c = CUBE[vi];
  let far = (c & 4u) != 0u;
  let s = select(-0.15, plumeEnd(J), far);
  let b = plumeRadius(J, max(s, 0.0)) * HALO + vec2f(0.05);
  let d = J.d.xyz;
  let u = J.u.xyz;
  let v = cross(d, u);
  let q = J.p.xyz + u * (select(-1.0, 1.0, (c & 1u) != 0u) * b.x) + v * (select(-1.0, 1.0, (c & 2u) != 0u) * b.y) + d * s;
  var o: POut;
  o.q = q;
  // (the whole image's ndc, not the ship's box: the flames reach beyond the hull)
  o.clip = projectFull((S.model * vec4f(q, 1.0)).xyz);
  o.id = ii;
  return o;
}

@fragment
fn plumeFs(in: POut) -> @location(0) vec4f {
  let J = jets[in.id];
  let d = J.d.xyz;
  let u = J.u.xyz;
  let v = cross(d, u);
  let main = J.d.w < 0.5;
  // the camera in the ship's frame (the model is rigid: its inverse is the transpose)
  let R = mat3x3f(S.model[0].xyz, S.model[1].xyz, S.model[2].xyz);
  let cam = -(transpose(R) * S.model[3].xyz);
  let ro = cam - J.p.xyz;
  let rw = normalize(in.q - cam);
  let o = vec3f(dot(ro, u), dot(ro, v), dot(ro, d));
  let r = vec3f(dot(rw, u), dot(rw, v), dot(rw, d));
  let b = plumeBox(J);
  let lo = vec3f(-b.x, -b.y, -0.15);
  let hi = vec3f(b.x, b.y, b.z);
  // (drawn by its front faces, depth-tested against the hull — or, the camera inside it, by its back
  // faces; the march starts at the camera or where the ray enters)
  let inv = 1.0 / select(r, vec3f(1e-6), abs(r) < vec3f(1e-6));
  let t0 = (lo - o) * inv;
  let t1 = (hi - o) * inv;
  let tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), max(min(t0.z, t1.z), 0.0));
  let tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  if (tf <= tn) { discard; }
  let tEnd = tf;
  let N = 12;
  let dt = (tEnd - tn) / f32(N);
  // (interleaved gradient noise: an even, fine dither of the steps — Jimenez 2014)
  let jit = fract(52.9829189 * fract(dot(in.clip.xy, vec2f(0.06711056, 0.00583715))));
  let L = J.a.z;
  let air = clamp(S.jet.w, 0.0, 1.0);
  let tm = S.jet.z;
  var sum = vec3f(0.0);
  for (var i = 0; i < N; i++) {
    let t = tn + (f32(i) + jit) * dt;
    let x = o + r * t;
    let s = x.z;
    if (s < 0.0) { continue; }
    let rad = plumeRadius(J, s);
    let e = x.xy / rad;
    let q2 = dot(e, e);
    if (q2 > HALO * HALO * 1.2) { continue; }
    // flicker: turbulence carried downstream
    let ph = s * 1.3 - tm * 31.0 + J.a.w * 40.0;
    let fl = 0.8 + 0.2 * sin(ph + 2.1 * x.x) * sin(0.61 * ph + 1.7 * x.y + 1.3);
    var dens: f32;
    var col: vec3f;
    if (main) {
      let fall = exp(-s / (0.28 * L)) * smoothstep(0.0, 0.2, s) * (1.0 - smoothstep(0.65 * L, 0.85 * L, s));
      let core = exp(-4.0 * q2);
      let hot = 0.22 + 5.5 * exp(-s / 1.1);
      // shock diamonds in air (spacing ~ the exit's size)
      let dia = 1.0 + 0.9 * air * (0.5 + 0.5 * cos(6.2832 * s / (1.6 * J.a.y + 0.5))) * exp(-s / (0.3 * L));
      let halo = 0.02 * exp(-1.2 * q2);
      dens = (core * hot * dia * fl + halo) * fall;
      col = mix(vec3f(0.22, 0.38, 1.0), vec3f(0.85, 0.93, 1.0), clamp(core * hot * 0.3, 0.0, 1.0));
    } else {
      let fall = exp(-s / (0.3 * L)) * smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.65 * L, 0.85 * L, s));
      dens = (exp(-2.5 * q2) * fl + 0.1 * exp(-1.2 * q2)) * fall;
      col = vec3f(1.0, 0.97, 0.93);
    }
    sum += col * (dens * dt);
  }
  let gain = select(2.0, 0.8, main) * J.p.w;
  return vec4f(sum * gain * S.jet.y, 0.0);
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
  // (the resolve's mean of c / (1 + L) over the covered samples, undone: c' / (1 − L'), premultiplied
  // by the coverage again)
  if (c.a <= 0.0) { return vec4f(0.0); }
  let m = c.rgb / c.a;
  let h = m / max(1.0 - dot(m, vec3f(0.2126, 0.7152, 0.0722)), 1.0 / 60000.0);
  return vec4f(min(h, vec3f(60000.0)) * c.a, c.a); // premultiplied (MSAA-resolved coverage)
}
