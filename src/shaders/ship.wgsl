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
  // the re-entry (written each frame): the motion through the air (ship frame, unit) and the plasma's
  // level 0…1; the shield's and hull's temperatures [K], Mach, the air's density (/ sea level); the
  // gas's glow (linear rgb) and the air's temperature [K]; the shield's direction and cone; the body
  // along the flow (its front and back from the centre [m], its radius across it, the wake's length);
  // the body's centre (ship frame) and a clock [s]
  re0: vec4f,
  re1: vec4f,
  re2: vec4f,
  re3: vec4f,
  re4: vec4f,
  re5: vec4f,
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

// the cockpit's controls (cockpit/controls.ts: material 73 — the control's index in uv.x, its part in
// uv.y: 0 the base, still; 1 the arm, 2 the knob, 3 the lit cap, moving): per control its moving part's
// pivot and angle, the axis it turns about, a push, the lamp's light and the hover
struct Controls { pose: array<vec4f, 128> };
@group(0) @binding(20) var<uniform> K: Controls;
// their placards (cockpit/placards.ts: a cell per control, 4 × 8; white text, its alpha)
@group(0) @binding(21) var placardTex: texture_2d<f32>;

// a control vertex's index and part (uv: index + a placard's u × 0.9, part + its v × 0.9 — a margin
// against the interpolation's rounding)
fn ctlIndex(uv: vec2f) -> u32 { return u32(floor(uv.x + 0.002)); }
fn ctlPart(uv: vec2f) -> u32 { return u32(floor(uv.y + 0.002)); }

fn turnAbout(v: vec3f, k: vec3f, a: f32) -> vec3f {
  let c = cos(a);
  return v * c + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - c);
}

@vertex
fn ctlVs(v: VIn, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let M = inst[ii].model;
  var pos = v.pos;
  var nrm = v.nrm;
  let kp = ctlPart(v.uv);
  if (kp >= 1u && kp <= 3u) {
    let i = ctlIndex(v.uv) * 4u;
    let P = K.pose[i];
    let A = K.pose[i + 1u].xyz;
    pos = P.xyz + turnAbout(v.pos - P.xyz, A, P.w) + K.pose[i + 2u].xyz;
    nrm = turnAbout(v.nrm, A, P.w);
  }
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

@fragment
fn fs(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
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
  let h0 = plate(c, size, axis, fw);
  let g = (vec2f(plate(c + vec2f(e, 0.0), size, axis, fw).x, plate(c + vec2f(0.0, e), size, axis, fw).x) - h0.x) / e;
  var grad = w.x * vec3f(0.0, g.y, g.x) + w.y * vec3f(g.x, 0.0, g.y) + w.z * vec3f(g.x, g.y, 0.0);
  grad -= dot(grad, qn) * qn;
  let bumpOn = select(0.0, 1.0, kind == 0u && (part == 0u || part == 4u));
  let qb = normalize(qn - grad * bumpOn);
  var n = normalize((model * vec4f(qb, 0.0)).xyz);
  // (the maps' footprint: the UV's and the position's derivatives, taken here — in uniform control flow)
  let duvx = dpdx(in.uv);
  let duvy = dpdy(in.uv);
  let dpx = dpdx(in.p);
  let dpy = dpdy(in.p);

  // ---- material
  let tone = h0.y;
  let seamDepth = clamp(-h0.x / 0.003, 0.0, 1.0);
  let grime = vnoise(in.q * 1.3) * 0.55 + vnoise(in.q * 6.1) * 0.3 + vnoise(in.q * 23.0) * 0.15;
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
  let sr = screenRefl(r, ar * ar);
  let wB = sr.w * (1.0 - smoothstep(0.1, 0.3, rough));
  let wC = sr.w * (1.0 - smoothstep(0.1, 0.3, cr));
  var col = mix(envSpec(r, rough), sr.rgb, wB) * fss * occS + (emsE + kd) * E / PI * occD;

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
  // (the thrusters light the flown craft; the lights, display-referred too: seen whatever the exposure)
  let own = select(0.0, 1.0, in.ii == 0u);
  let o = col * S.light.x + (dif * jl * ao * own + emit * 2.0) * S.jet.y;
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
fn hullDepthVs(v: VIn) -> @builtin(position) @invariant vec4f {
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

// ------------------------------------------------------------------------------------ re-entry
// Drawn in the plumes' pass (additive, display-referred, at half resolution): the hull glowing hot (a
// black body at the skin's temperatures — the faces to the flow the hottest), and around the craft the
// shock layer and its wake, marched through: a bow shock standing off before the body (a paraboloid
// about the flow), the hot gas between it and the body, brightest at the stagnation point, the ionized
// wake streaming behind, turbulent; near Mach 1 in dense air, a vapour cone. The march ends at the hull
// (its distance drawn first): nothing is seen through it.

/** A black body's colour (linear rgb, normalized), 800 … 12 000 K (Tanner Helland's fit of the locus). */
fn blackbody(T: f32) -> vec3f {
  let t = T / 100.0;
  var r = 1.0;
  var g: f32;
  var b: f32;
  if (t <= 66.0) { g = 0.39008157 * log(t) - 0.63184144; }
  else {
    r = 1.29293618 * pow(t - 60.0, -0.1332047592);
    g = 1.12989086 * pow(t - 60.0, -0.0755148492);
  }
  if (t >= 66.0) { b = 1.0; } else if (t <= 19.0) { b = 0.0; } else { b = 0.54320678 * log(t - 10.0) - 1.19625408; }
  return pow(clamp(vec3f(r, g, b), vec3f(0.0), vec3f(1.0)), vec3f(2.2));
}

/** The skin's glow at a temperature (display-referred): nothing below ~700 K, dull red, then orange,
 *  yellow-white — the visible part of σT⁴ climbing steeply. */
fn skinGlow(T: f32) -> vec3f {
  let k = max(T - 700.0, 0.0) / 900.0;
  return blackbody(max(T, 800.0)) * (0.35 * k * k * k);
}

struct GOut {
  @builtin(position) @invariant clip: vec4f,
  @location(0) n: vec3f,
  @location(1) q: vec3f,
};

@vertex
fn glowVs(v: VIn) -> GOut {
  var o: GOut;
  o.clip = projectFull((S.model * vec4f(v.pos, 1.0)).xyz);
  o.n = v.nrm;
  o.q = v.pos;
  return o;
}

@fragment
fn glowFs(in: GOut) -> @location(0) vec4f {
  let n = normalize(in.n);
  // the faces to the flow at the skin's hottest (the shield where it faces it, else the bare hull),
  // the lee about half as hot (a twentieth of the flux: T ∝ q^¼); the tiles' and panels' small
  // differences, the hot spots of the flow wandering
  let wind = dot(n, S.re0.xyz);
  let Tw = max(S.re1.x, S.re1.y);
  let nz = vnoise(in.q * 1.7) * 0.6 + vnoise(in.q * 5.3 + vec3f(0.0, 0.0, S.re5.w * 0.7)) * 0.4;
  let T = mix(0.5 * Tw, Tw, smoothstep(-0.2, 0.85, wind)) * (0.94 + 0.1 * nz);
  return vec4f(skinGlow(T) * S.jet.y, 0.0);
}

// the hull's distance from the camera at the plumes' resolution: where a march through the plasma ends
struct DistOut {
  @builtin(position) clip: vec4f,
  @location(0) p: vec3f,
};

@vertex
fn distVs(v: VIn) -> DistOut {
  var o: DistOut;
  o.p = (S.model * vec4f(v.pos, 1.0)).xyz;
  o.clip = projectFull(o.p);
  return o;
}

@fragment
fn distFs(in: DistOut) -> @location(0) vec4f {
  return vec4f(length(in.p), 0.0, 0.0, 1.0);
}

@group(0) @binding(18) var hullDist: texture_2d<f32>;

/** The flow's frame (ship frame): two axes across it, the motion. */
fn flowBasis() -> mat3x3f {
  let a = S.re0.xyz;
  let h = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(a.y) > 0.9);
  let b1 = normalize(cross(a, h));
  return mat3x3f(b1, cross(a, b1), a);
}

/** The box about the shock and the wake (flow frame): half-width across, the back and the front. */
fn sheathBox() -> vec3f {
  let Rp = S.re4.z;
  return vec3f(max(1.9 * Rp, 0.6 * Rp + 0.08 * S.re4.w) + 1.0, S.re4.y - 1.3 * S.re4.w, S.re4.x + 0.5 * Rp + 0.5);
}

struct SOut {
  @builtin(position) clip: vec4f,
  @location(0) q: vec3f, // ship frame
};

@vertex
fn sheathVs(@builtin(vertex_index) vi: u32) -> SOut {
  let B = flowBasis();
  let bx = sheathBox();
  let c = CUBE[vi];
  let l = vec3f(select(-bx.x, bx.x, (c & 1u) != 0u), select(-bx.x, bx.x, (c & 2u) != 0u), select(bx.y, bx.z, (c & 4u) != 0u));
  var o: SOut;
  o.q = S.re5.xyz + B * l;
  o.clip = projectFull((S.model * vec4f(o.q, 1.0)).xyz);
  return o;
}

/** The plasma's and the vapour's emission at a point of the flow frame (relative to the body's centre). */
fn sheathAt(l: vec3f, tm: f32) -> vec3f {
  let Rp = S.re4.z;
  let sf = S.re4.x;
  let sb = S.re4.y;
  let Lw = S.re4.w;
  let s = l.z;
  let rho = length(l.xy);
  let lev = S.re0.w;
  var e = vec3f(0.0);
  if (lev > 0.0) {
    // the bow shock: a paraboloid standing off the body's front; the hot gas just behind it, thin,
    // brightest at the stagnation point, the outer gas redder (N₂⁺, O), the core whiter
    let Rs = 1.35 * Rp;
    let d = sf + 0.12 * Rp - rho * rho / (2.0 * Rs) - s;
    let axis = exp(-rho * rho / (0.35 * Rp * Rp));
    let side = smoothstep(Rs * 1.35, Rs * 0.55, rho);
    if (d > -0.08 * Rp && side > 0.0) {
      let nz = vnoise(vec3f(l.xy * (2.2 / Rp), l.z * (0.8 / Rp) + tm * 4.0)) * 0.55 + vnoise(vec3f(l.xy * (6.0 / Rp), l.z * (2.0 / Rp) + tm * 9.0)) * 0.45;
      let rim = exp(-pow(d / (0.05 * Rp), 2.0));
      let layer = select(0.0, exp(-d / (0.3 * Rp)), d > 0.0);
      let a = (1.1 * rim + layer * (0.45 + 0.9 * nz)) * (0.6 + 3.0 * axis) * side;
      e += mix(S.re2.rgb * vec3f(1.0, 0.85, 0.75), vec3f(1.0, 0.82, 0.6), clamp(axis * 1.2, 0.0, 0.9)) * a;
    }
    // the wake: ionized gas streaming behind in streaks, narrowing, flickering
    let back = sb - s;
    if (back > -0.5 * Rp) {
      let rw = Rp * (0.5 + 0.05 * max(back, 0.0) / Rp);
      let core = exp(-rho * rho / (rw * rw));
      let fade = exp(-max(back, 0.0) / Lw) * smoothstep(0.2 * Rp, 2.5 * Rp, back);
      // (streaks: a noise stretched along the flow, drifting back)
      let st = vnoise(vec3f(l.xy * (3.0 / Rp), l.z * (0.18 / Rp) + tm * 1.6));
      let st2 = vnoise(vec3f(l.xy * (7.0 / Rp), l.z * (0.35 / Rp) + tm * 3.1));
      e += S.re2.rgb * vec3f(1.0, 0.75, 0.95) * (0.32 * core * fade * (0.1 + 2.2 * pow(st, 4.0) + 0.8 * pow(st2, 3.0)));
    }
    e *= lev * lev * 1.1;
  }
  // the vapour cone: near Mach 1 in dense air, a white shell flaring from the body's widest point
  let M = S.re1.z;
  let vk = (1.0 - smoothstep(0.03, 0.12, abs(M - 0.99))) * smoothstep(0.2, 0.5, S.re1.w);
  if (vk > 0.0) {
    let mid = 0.5 * (sf + sb);
    let aft = mid - s;
    let r = Rp * (0.9 + 0.5 * max(aft, 0.0) / Rp);
    let shell = exp(-pow((rho - r) / (0.25 * Rp), 2.0)) * exp(-max(aft, 0.0) / (1.4 * Rp)) * smoothstep(-0.4 * Rp, 0.2 * Rp, aft);
    e += vec3f(0.9, 0.93, 1.0) * (0.12 * vk * shell * (0.6 + 0.4 * vnoise(l * (3.0 / Rp))));
  }
  return e;
}

@fragment
fn sheathFs(in: SOut) -> @location(0) vec4f {
  let B = flowBasis();
  let R = mat3x3f(S.model[0].xyz, S.model[1].xyz, S.model[2].xyz);
  let cam = -(transpose(R) * S.model[3].xyz);
  let rw = normalize(in.q - cam);
  // (the ray in the flow frame, from the body's centre)
  let o = transpose(B) * (cam - S.re5.xyz);
  let r = transpose(B) * rw;
  let bx = sheathBox();
  let lo = vec3f(-bx.x, -bx.x, bx.y);
  let hi = vec3f(bx.x, bx.x, bx.z);
  let inv = 1.0 / select(r, vec3f(1e-6), abs(r) < vec3f(1e-6));
  let t0 = (lo - o) * inv;
  let t1 = (hi - o) * inv;
  let tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), max(min(t0.z, t1.z), 0.0));
  // (drawn by its back faces, wherever the camera is: the march from where the ray enters, or the
  // camera, to where it leaves — or meets the hull)
  let hd = textureLoad(hullDist, vec2i(in.clip.xy), 0).r;
  let tf = min(min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z)), hd);
  if (tf <= tn) { discard; }
  let N = 20;
  let dt = (tf - tn) / f32(N);
  let jit = fract(52.9829189 * fract(dot(in.clip.xy, vec2f(0.06711056, 0.00583715))));
  let tm = S.re5.w;
  var sum = vec3f(0.0);
  for (var i = 0; i < N; i++) {
    let t = tn + (f32(i) + jit) * dt;
    sum += sheathAt(o + r * t, tm) * dt;
  }
  // (inside the plasma — a camera under the belly — the glow saturates softly rather than blowing out)
  let g = sum / max(S.re4.z, 0.5);
  return vec4f(1.8 * (1.0 - exp(-g / 1.8)) * S.jet.y, 0.0);
}

// ------------------------------------------------------------------------------------ contrails
// The condensation trails (contrails.ts): each segment a ribbon facing the camera, as wide as the trail
// is there; across it the optical depth of a round tube (a soft profile), puffs along it fixed in the
// air. Ice scatters the light it gets — the key light's, strongly forward (the trail bright between the
// camera and the star), and the sky's —: the colour added, the coverage (1 − transmittance) in alpha (the
// display dims what is behind by it). Hidden by the hull (the depth) and by what the traced image holds
// nearer (the ground, a mountain); fading into the distance's haze.

struct Seg {
  a: vec4f, // end a (ship frame), its width [m]
  b: vec4f,
  k: vec4f, // optical depths at a and b, distances along the trail [m]
  m: vec4f, // kind (0 an engine's, 1 a wingtip's)
};
@group(0) @binding(19) var<storage, read> segs: array<Seg>;

struct TOut {
  @builtin(position) clip: vec4f,
  @location(0) p: vec3f, // camera frame
  @location(1) v: f32,   // across: −1 … 1
  @location(2) tau: f32,
  @location(3) s: f32,
  @location(4) @interpolate(flat) kind: f32,
};

@vertex
fn trailVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> TOut {
  let G = segs[ii];
  let pa = (S.model * vec4f(G.a.xyz, 1.0)).xyz;
  let pb = (S.model * vec4f(G.b.xyz, 1.0)).xyz;
  let E = array<f32, 6>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
  let SD = array<f32, 6>(-1.0, -1.0, 1.0, 1.0, -1.0, 1.0);
  let e = E[vi];
  let sd = SD[vi];
  let p = mix(pa, pb, e);
  // (the ribbon's side: across the segment and the line of sight; along it, any)
  var d = pb - pa;
  if (dot(d, d) < 1e-8) { d = vec3f(0.0, 0.0, 1.0); }
  var side = cross(normalize(d), normalize(p));
  if (dot(side, side) < 1e-8) { side = cross(normalize(d), vec3f(0.0, 1.0, 0.0)); }
  side = normalize(side);
  let w = mix(G.a.w, G.b.w, e);
  var o: TOut;
  o.p = p + side * (sd * w);
  o.clip = projectFull(o.p);
  // (the ship's near and far planes hold it and its flames, not kilometres of trail: the depth kept
  // within them — before the camera, still hidden by the hull)
  if (o.clip.w > 0.0) { o.clip.z = clamp(o.clip.z, 1e-6 * o.clip.w, 0.99999 * o.clip.w); }
  o.v = sd;
  o.tau = mix(G.k.x, G.k.y, e);
  o.s = mix(G.k.z, G.k.w, e);
  o.kind = G.m.x;
  return o;
}

@fragment
fn trailFs(in: TOut) -> @location(0) vec4f {
  // hidden where the traced image holds something nearer (the ground below the trail, a ridge)
  let dist = length(in.p);
  if (S.img.w > 0.5 && in.p.z > 0.0) {
    let px = vec2f((in.p.x / (in.p.z * S.proj.x) + 1.0) * 0.5, (1.0 - in.p.y / (in.p.z * S.proj.y)) * 0.5) * S.img.xy;
    let q = vec2u(clamp(px, vec2f(0.0), S.img.xy - 1.0));
    if (moments[q.y * u32(S.img.x) + q.x].y * S.img.z < dist) { discard; }
  }
  // across a round tube: the chord through it, a soft edge; puffs along it (fixed in the air) and
  // ragged edges, the wingtips' a twisting thread
  let x = in.v;
  let chord = sqrt(max(1.0 - x * x, 0.0));
  let tip = in.kind > 0.5;
  let sc = select(45.0, 6.0, tip);
  let nz = vnoise(vec3f(in.s / sc, x * 1.7, in.kind * 7.3)) * 0.65 + vnoise(vec3f(in.s / (0.3 * sc), x * 4.1, 3.1)) * 0.35;
  let edge = smoothstep(0.0, 0.35, chord - 0.25 * (nz - 0.5));
  var tau = in.tau * chord * edge * (0.55 + 0.9 * nz);
  // (the haze between: a far trail paler)
  tau *= exp(-dist / 120000.0);
  let a = 1.0 - exp(-tau);
  if (a < 1e-4) { discard; }
  // the light it scatters: the key light (a star) or the probe's dominant one, through a phase strongly
  // forward (Henyey–Greenstein, g 0.6, its mean 1: the trail glowing with the star behind it), and the
  // sky's all round
  let vdir = normalize(-in.p);
  let keyOn = sh[11].w > 0.5;
  let l = fromProbe(sh[9].xyz);
  let Ek = select(irradiance(l) * sh[9].w * 2.0, sh[11].rgb, keyOn);
  let g = 0.6;
  let ct = dot(-l, vdir);
  let hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * ct, 1.5);
  let Ea = 0.5 * (irradiance(vdir) + irradiance(-vdir));
  let L = (0.85 / PI) * (Ek * (0.35 + 0.65 * hg) + Ea);
  return vec4f(L * S.light.x * a, a);
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

// ------------------------------------------------------------------------------------ the cabin
// The Ranger's cockpit (materials 60–72: scripts/build-cockpit.ts), its own pipeline: the cabin fills the
// view from inside — a lean shader (no hull plating, no maps, no thrusters, no traced reflections). Its
// screens show the telemetry drawn in a texture (ui/cockpitscreens.ts: 4 × 2 slots); its glass, the
// outside seen through it, in a blended pass.
@group(0) @binding(17) var screenTex: texture_2d<f32>;

fn glyph(p: vec2f, seed: f32) -> f32 {
  // a 3 × 5 cell block of "characters": lit cells by a hash — text, from afar
  let cell = floor(p * vec2f(3.0, 5.0));
  return step(0.45, hash3(vec3i(vec2i(cell), i32(seed * 977.0))));
}


// a 4-tap shadow (the cabin's sun patches)
fn shadowCabin(p: vec3f, ng: vec3f, l: vec3f) -> f32 {
  let q = lightClip(p + ng * 0.05 + l * 0.02);
  let uv = vec2f(0.5 + 0.5 * q.x, 0.5 - 0.5 * q.y);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  let texel = 1.0 / vec2f(textureDimensions(shadowTex));
  var sum = 0.0;
  for (var i = 0; i < 4; i++) {
    let o = vec2f(select(-1.0, 1.0, (i & 1) == 1), select(-1.0, 1.0, (i & 2) == 2)) * 1.2;
    sum += textureSampleCompareLevel(shadowTex, shadowSamp, uv + o * texel, q.z - 0.0015);
  }
  return sum * 0.25;
}

@fragment
fn fsCabin(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  return cabinShade(in, front, false);
}

// the glass (71): see-through, the lamps' highlights over the view (blended, premultiplied)
@fragment
fn fsCabinGlass(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  return cabinShade(in, front, true);
}

fn cabinShade(in: VOut, front: bool, glassPass: bool) -> vec4f {
  let part = u32(in.mat + 0.5);
  if ((part == 71u) != glassPass) { discard; }
  let model = inst[in.ii].model;
  if (glassPass) {
    // the glass, the short way: its Fresnel, the lamps' highlights on it, the outside seen through it
    let gn = normalize(in.n) * select(-1.0, 1.0, front);
    let gv = normalize(-in.p);
    let gnv = clamp(dot(gn, gv), 1e-4, 1.0);
    let F = 0.04 + 0.96 * pow(1.0 - gnv, 5.0);
    let lampsG = array<vec3f, 4>(vec3f(0.0, 2.1, -3.2), vec3f(0.0, 2.15, -0.3), vec3f(0.85, 2.05, 2.4), vec3f(-0.85, 2.05, 2.4));
    var hl = 0.0;
    for (var i = 0; i < 4; i++) {
      let L = (model * vec4f(lampsG[i], 1.0)).xyz - in.p;
      let d2 = dot(L, L);
      let hv = normalize(L * inverseSqrt(d2) + gv);
      hl += pow(clamp(dot(gn, hv), 0.0, 1.0), 400.0) * 60.0 / (d2 + 0.25);
    }
    let og = vec3f(0.85, 0.93, 1.0) * (hl * F + 0.02 * F) * S.jet.y;
    let a = clamp(0.02 + 0.9 * F, 0.0, 1.0);
    return vec4f(og / (1.0 + dot(og, vec3f(0.2126, 0.7152, 0.0722))), a);
  }
  let side = select(-1.0, 1.0, front);
  let ng = normalize(in.n) * side;
  let qn = normalize(in.qn) * side;
  let fw = max(length(fwidth(in.q)), 1e-5);
  // the screens' picture: its slot in the texture (the display the build gave it, by where it is), the
  // derivatives taken here
  let k = floor(in.uv.x * 0.5);
  // (the model's screen UVs: the picture upside down)
  let su = vec2f(in.uv.x - 2.0 * k, in.uv.y);
  let slot = u32(k + 0.5) % 8u;
  let auv = (vec2f(f32(slot % 4u), f32(slot / 4u)) + vec2f(0.02) + su * 0.96) / vec2f(4.0, 2.0);
  let gx = dpdx(auv);
  let gy = dpdy(auv);
  // a control's placard: its cell (the derivatives here, in uniform control flow)
  let ci = f32(ctlIndex(in.uv));
  let fu = clamp((in.uv.x - ci) / 0.9, 0.0, 1.0);
  let fv = clamp((in.uv.y - floor(in.uv.y + 0.002)) / 0.9, 0.0, 1.0);
  let puv = (vec2f(ci % 4.0, floor(ci / 4.0)) + vec2f(fu, 1.0 - fv)) / vec2f(4.0, 8.0);
  let legend = select(0.0, textureSampleGrad(placardTex, linSamp, puv, dpdx(puv), dpdy(puv)).a, part == 73u);
  // relief on the dominant plane
  let aq = abs(qn);
  let w = select(select(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), aq.y >= aq.z), vec3f(1.0, 0.0, 0.0), aq.x >= aq.y && aq.x >= aq.z);
  let c = w.x * in.q.zy + w.y * in.q.xz + w.z * in.q.xy;
  let e = max(0.5 * fw, 0.0015);
  let hc = cabinHeight(part, c, fw);
  let gc = (vec2f(cabinHeight(part, c + vec2f(e, 0.0), fw), cabinHeight(part, c + vec2f(0.0, e), fw)) - hc) / e;
  var gr = w.x * vec3f(0.0, gc.y, gc.x) + w.y * vec3f(gc.x, 0.0, gc.y) + w.z * vec3f(gc.x, gc.y, 0.0);
  gr -= dot(gr, qn) * qn;
  let n = normalize((model * vec4f(normalize(qn - gr), 0.0)).xyz);
  // the material
  let grime = vnoise(in.q * 1.3) * 0.55 + 0.25;
  var albedo = vec3f(0.5);
  var metal = 0.0;
  var rough = 0.6;
  var coat = 0.0;
  var emit = vec3f(0.0);
  switch part {
    // the cockpit (each part's tone varied by its hash; the small parts on the consoles: switches, some
    // of them lit)
    case 60u: { albedo = vec3f(0.07, 0.075, 0.085) * (1.0 - 0.3 * grime); metal = 0.6; rough = 0.42 + 0.25 * grime; coat = 0.0; }
    case 61u, 70u: { albedo = vec3f(0.6, 0.62, 0.64) * (0.9 + 0.2 * fract(in.uv.y)) * (1.0 - 0.12 * grime); metal = 0.0; rough = 0.85; coat = 0.0; }
    case 62u: {
      // the consoles: charcoal, their panels' markings silk-screened light grey (labels, lines), the small
      // parts — switches — a little lighter
      let small = floor(in.uv.y) < 4.0;
      // (labels: a line of small text — 3 × 5-cell characters, 4 mm — in one cell of eight on a 6 × 2.5 cm
      // grid; a rule every 20 cm; faded out where a pixel spans them. Solid light strips read as white
      // rectangles all over the consoles: the user's report, K1)
      let gc = c / vec2f(0.06, 0.025);
      let fc = fract(gc);
      let hc = hash3(vec3i(vec2i(floor(gc)), 3));
      let fadeL = clamp(0.0015 / (1.5 * fw) - 0.35, 0.0, 1.0);
      let strip = step(0.87, hc) * step(0.1, fc.x) * step(fc.x, 0.25 + 0.6 * fract(hc * 13.0)) * step(0.4, fc.y) * step(fc.y, 0.6);
      let ch = vec2f(fc.x * 15.0, (fc.y - 0.4) / 0.2);
      let lab = strip * glyph(fract(ch) * vec2f(1.25, 1.0), hc + floor(ch.x) * 0.37) * step(fract(ch.x), 0.8) * fadeL;
      let ruled = (1.0 - smoothstep(0.0, 0.0008, abs(fract(c.y * 5.0 + 0.5) - 0.5) / 5.0)) * fadeL;
      albedo = select(vec3f(0.03, 0.033, 0.036) * (0.85 + 0.3 * fract(in.uv.y)), vec3f(0.07, 0.072, 0.075), small);
      albedo = mix(albedo, vec3f(0.3), clamp(lab * 0.7 + ruled * 0.2, 0.0, 1.0) * select(1.0, 0.0, small));
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
    case 68u: { albedo = vec3f(0.008); metal = 0.0; rough = 0.35; coat = 0.0; }
    case 69u: { albedo = vec3f(0.16, 0.16, 0.17) * (1.0 - 0.2 * grime); metal = 0.75; rough = 0.38 + 0.2 * grime; coat = 0.0; }
    case 72u: { albedo = vec3f(0.025); metal = 0.0; rough = 0.62; coat = 0.0; }
    // the controls (73): their bases charcoal, the arms brushed steel, the knobs white, the caps lit
    case 73u: {
      let kp = ctlPart(in.uv);
      let L = K.pose[ctlIndex(in.uv) * 4u + 3u];
      switch kp {
        case 0u: { albedo = vec3f(0.035, 0.037, 0.04); metal = 0.0; rough = 0.5; }
        case 1u: { albedo = vec3f(0.6, 0.6, 0.62); metal = 1.0; rough = 0.3; }
        case 2u: { albedo = vec3f(0.75, 0.75, 0.72); metal = 0.0; rough = 0.4; }
        case 3u: {
          // (a cap: frosted dark glass, its legend lit by the lamp behind it — faintly when off, so it reads)
          albedo = vec3f(0.025) + L.rgb * 0.05; metal = 0.0; rough = 0.3;
          let on = max(max(L.r, L.g), L.b);
          emit = L.rgb * (0.25 + 0.75 * legend) + vec3f(0.5, 0.52, 0.55) * legend * 0.06 * (1.0 - on);
        }
        default: {
          // (a placard: silk-screened light grey on the panel's charcoal)
          albedo = mix(vec3f(0.03, 0.032, 0.035), vec3f(0.55, 0.56, 0.57), legend); metal = 0.0; rough = 0.6;
        }
      }
      // (under the pointer: a cool glow — what a click would work)
      emit += vec3f(0.18, 0.4, 0.6) * L.w * 0.35;
      coat = 0.0;
    }
    // (the glass: no diffuse light of its own — the lamps' highlights only)
    case 71u: { albedo = vec3f(0.0); metal = 0.0; rough = 0.05; coat = 0.0; }
    default: {}
  }
  let tm = S.dash2.x;
  if (part == 68u) {
    // (the telemetry, drawn: display-referred, as bright whatever the exposure)
    emit = textureSampleGrad(screenTex, linSamp, auv, gx, gy).rgb * 2.4;
  } else if ((part == 62u || part == 66u || part == 69u) && floor(in.uv.y) < 2.5 && fract(in.uv.y) > 0.88) {
    // (the tiniest parts — indicators, one in eight lit —: green, amber, a rare red, a few blinking; a
    // quarter of them lit white read as white rectangles everywhere)
    let hh = fract(in.uv.y);
    let led = select(select(vec3f(0.35, 1.0, 0.5), vec3f(1.0, 0.55, 0.12), hh > 0.93), vec3f(1.0, 0.18, 0.08), hh > 0.97);
    let blink = select(1.0, step(0.5, fract(tm * (0.7 + hh) + hh * 7.0)), hh > 0.975);
    emit = led * 0.8 * blink * (0.5 + 0.5 * clamp(dot(n, normalize(-in.p)), 0.0, 1.0));
    albedo = led * 0.15;
  }
  rough = clamp(rough, 0.04, 1.0);
  let ao = pow(clamp(in.ao, 0.0, 1.0), 0.8);
  // the outside's light: only through the windows — the share of the sky each point sees, baked
  let sky = select(select(clamp(in.uv.x, 0.0, 1.0), 0.2, part == 73u), 1.0, part == 68u);
  let v = normalize(-in.p);
  let nv = clamp(dot(n, v), 1e-4, 1.0);
  let r = reflect(-v, n);
  let f0 = mix(vec3f(0.04), albedo, metal);
  let ab = envAB(rough, nv);
  let fss = f0 * ab.x + ab.y;
  let kd = albedo * (1.0 - metal);
  var col = (envSpec(r, rough) * fss + kd * irradiance(n) / PI) * sky * ao;
  // the Sun (the key light, or the probe's dominant light) through the windows: its patches
  let dom = vec4f(fromProbe(sh[9].xyz), sh[9].w);
  let keyOn = sh[11].w > 0.5;
  let l = dom.xyz;
  let nl = dot(n, l);
  if (nl > 0.0 && dot(ng, l) > 0.0) {
    let vis = shadowCabin(in.p, ng, l);
    let Ek = select(irradiance(l) * dom.w * 2.0, sh[11].rgb, keyOn);
    let hv = normalize(l + v);
    let nh = clamp(dot(n, hv), 0.0, 1.0);
    let vh = clamp(dot(v, hv), 0.0, 1.0);
    let fk = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
    col += (kd * (1.0 - fk) / PI + ggxSpec(nh, nv, nl, rough, sh[10].w) * fk) * Ek * nl * vis;
  }
  // the lamps: cool lights along the ceiling and over the consoles, a soft fill (display-referred: the
  // cabin as lit whatever the exposure the outside sets)
  let lamps = array<vec3f, 4>(vec3f(0.0, 2.1, -3.2), vec3f(0.0, 2.15, -0.3), vec3f(0.85, 2.05, 2.4), vec3f(-0.85, 2.05, 2.4));
  var cl = vec3f(0.0);
  for (var i = 0; i < 4; i++) {
    let L = (model * vec4f(lamps[i], 1.0)).xyz - in.p;
    let d2 = dot(L, L);
    let lv = L * inverseSqrt(d2);
    let lnl = max(dot(n, lv), 0.0);
    let hv = normalize(lv + v);
    let spec = pow(clamp(dot(n, hv), 0.0, 1.0), 2.0 / max(rough * rough * rough * rough, 1e-4) - 2.0) * (2.0 / max(rough * rough * rough * rough, 1e-4) + 2.0) / (8.0 * PI);
    cl += (kd / PI + f0 * spec) * lnl / (d2 + 0.25);
  }
  cl = (cl * 3.5 * vec3f(0.85, 0.93, 1.0) + kd * vec3f(0.12, 0.14, 0.16)) * ao;
  // re-entry: the plasma's light through the windows, flickering
  let pl = S.re0.w;
  if (pl > 0.0) { cl += kd * S.re2.rgb * (pl * pl * 2.4 * sky * ao * (0.85 + 0.15 * sin(S.re5.w * 23.0 + in.p.x))); }
  let o = col * S.light.x + (emit * 2.0 + cl) * S.jet.y;
  return vec4f(o / (1.0 + dot(o, vec3f(0.2126, 0.7152, 0.0722))), 1.0);
}
