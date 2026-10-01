// The International Space Station (src/station.ts): NASA's model (scripts/build-iss.py) on its orbit,
// drawn as the Endurance is — the tracer's pinhole, a box of the image (4× MSAA), hidden where the
// traced scene is nearer (the tracer's per-pixel depth), composited over the traced image before
// bloom (and before the Ranger: its glass reflects it). Its joints are turned by part: each vertex
// carries its part (the station, an alpha joint, a beta gimbal, a radiator joint) and each part a
// transform to the camera frame.
//
// Lit by the Sun (its share above the Earth's limb, reddened through the air; the station's own shadow
// from a shadow map) and by the Earth below (its sunlit disc as seen from the station, on order-2
// spherical harmonics): GGX on painted metal and blankets, the solar cells' glass cover, the radiators.

struct U {
  view: vec4f,     // tan(fov/2)·aspect, tan(fov/2), near, far [m]
  box: vec4f,      // the box in the image [px]: x, y, width, height
  img: vec4f,      // image width, height; metres per M (the traced depth's unit); pre-exposure
  sun: vec4f,      // towards the Sun (camera frame); w: its angular radius
  sunE: vec4f,     // its irradiance (rgb, the tracer's units, its share above the limb); w: unused
  light: vec4f,    // the shadow map's box: centre (camera frame) and radius [m]
  sh: array<vec4f, 9>,      // the Earth's light (camera frame): order-2 harmonics, rgb
  part: array<vec4f, 39>,   // 13 parts × 3 rows: x_cam = row · (x, 1)
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> moments: array<vec2f>; // Σ l², the traced depth [M]
@group(0) @binding(2) var shadowTex: texture_depth_2d;
@group(0) @binding(3) var shadowSamp: sampler_comparison;

struct VIn {
  @location(0) p: vec3f,
  @location(1) n: vec4f,   // snorm8 normal
  @location(2) c: vec4f,   // unorm8 sRGB colour, kind (a × 255)
  @location(3) part: vec4u,
};

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) p: vec3f,   // camera frame [m]
  @location(1) n: vec3f,
  @location(2) col: vec3f,
  @location(3) @interpolate(flat) kind: u32,
  @location(4) q: vec3f,   // the station's frame at rest (the solar cells' grid)
  @location(5) @interpolate(flat) part: u32,
};

fn toCam(k: u32, x: vec3f, w: f32) -> vec3f {
  let a = u.part[3u * k];
  let b = u.part[3u * k + 1u];
  let c = u.part[3u * k + 2u];
  let h = vec4f(x, w);
  return vec3f(dot(a, h), dot(b, h), dot(c, h));
}

fn project(q: vec3f) -> vec4f {
  let W = u.img.x;
  let H = u.img.y;
  let ndc = vec2f(q.x / (q.z * u.view.x), q.y / (q.z * u.view.y));
  let px = vec2f((ndc.x + 1.0) * 0.5 * W, (1.0 - ndc.y) * 0.5 * H) - u.box.xy;
  let nb = vec2f(px.x / u.box.z * 2.0 - 1.0, 1.0 - px.y / u.box.w * 2.0);
  let z = clamp((q.z - u.view.z) / (u.view.w - u.view.z), 0.0, 1.0);
  return vec4f(nb * q.z, z * q.z, q.z);
}

@vertex
fn vs(v: VIn) -> VOut {
  var o: VOut;
  let k = min(v.part.x, 12u);
  let q = toCam(k, v.p, 1.0);
  o.p = q;
  o.n = normalize(toCam(k, v.n.xyz, 0.0));
  o.col = pow(v.c.rgb, vec3f(2.2));
  o.kind = u32(v.c.a * 255.0 + 0.5);
  o.q = v.p;
  o.part = k;
  o.pos = project(q);
  return o;
}

// ---- the shadow map: the station seen from the Sun (orthographic over its bounding sphere)
fn lightClip(q: vec3f) -> vec3f {
  let l = u.sun.xyz;
  let e1 = normalize(cross(l, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(l.y) > 0.9)));
  let e2 = cross(l, e1);
  let d = q - u.light.xyz;
  let R = u.light.w;
  return vec3f(dot(d, e1) / R, dot(d, e2) / R, 0.5 - 0.5 * dot(d, l) / R);
}

@vertex
fn shadowVs(v: VIn) -> @builtin(position) vec4f {
  return vec4f(lightClip(toCam(min(v.part.x, 12u), v.p, 1.0)), 1.0);
}

fn shadowAt(q: vec3f, n: vec3f) -> f32 {
  let c = lightClip(q + n * 0.06 + u.sun.xyz * 0.04);
  let uv = vec2f(0.5 + 0.5 * c.x, 0.5 - 0.5 * c.y);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  let texel = 1.0 / vec2f(textureDimensions(shadowTex));
  var s = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      s += textureSampleCompareLevel(shadowTex, shadowSamp, uv + vec2f(f32(i), f32(j)) * texel * 1.2, c.z - 0.0008);
    }
  }
  return s / 9.0;
}

const PI = 3.14159265;

fn shIrr(n: vec3f) -> vec3f {
  let b = array<f32, 9>(0.282095, 0.488603 * n.y, 0.488603 * n.z, 0.488603 * n.x, 1.092548 * n.x * n.y,
    1.092548 * n.y * n.z, 0.315392 * (3.0 * n.z * n.z - 1.0), 1.092548 * n.x * n.z, 0.546274 * (n.x * n.x - n.y * n.y));
  let A = array<f32, 9>(PI, 2.094395, 2.094395, 2.094395, 0.785398, 0.785398, 0.785398, 0.785398, 0.785398);
  var e = vec3f(0.0);
  for (var k = 0u; k < 9u; k++) { e += A[k] * b[k] * u.sh[k].rgb; }
  return max(e, vec3f(0.0));
}

fn envAB(rough: f32, nv: f32) -> vec2f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = rough * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  return vec2f(-1.04, 1.04) * a004 + r.zw;
}

fn ggx(nh: f32, nv: f32, nl: f32, rough: f32, rs: f32) -> f32 {
  let a = min(rough * rough + 0.5 * rs, 1.0);
  let aa = a * a;
  let dd = nh * nh * (aa - 1.0) + 1.0;
  let D = aa / (PI * dd * dd);
  let V = 0.5 / max(nl * sqrt(nv * nv * (1.0 - aa) + aa) + nv * sqrt(nl * nl * (1.0 - aa) + aa), 1e-6);
  return D * V;
}

struct FOut {
  @location(0) color: vec4f,
  @location(1) depth: vec4f,
};

@fragment
fn fs(in: VOut, @builtin(front_facing) front: bool) -> FOut {
  let dist = length(in.p);
  // hidden where the traced scene is nearer (the Earth behind which it passes)
  let ip = vec2u(in.pos.xy + u.box.xy);
  let iw = u32(u.img.x);
  let ih = u32(u.img.y);
  let idx = min(ip.y, ih - 1u) * iw + min(ip.x, iw - 1u);
  if (moments[idx].y * u.img.z < dist * 0.999) { discard; }
  let V = -in.p / dist;
  var N = normalize(in.n);
  if (dot(N, V) < 0.0) { N = -N; } // (thin parts: the face seen)
  let fw = fwidth(in.q);
  var base = in.col;
  var metal = 0.0;
  var rough = 0.55;
  var f0 = 0.04;
  switch (in.kind) {
    case 1u: {
      // the solar cells: deep blue-black under their glass, a fine grid of silver interconnects (in the
      // blanket's plane: its rest coordinates), the amber Kapton between the panels
      let g = in.q * 2.5;
      // (at rest the blankets lie in the x–z plane: the grid along those)
      let line = max(abs(fract(g.x) - 0.5), abs(fract(g.z) - 0.5));
      let w = max(length(fw) * 2.5, 0.02);
      let grid = smoothstep(0.5 - w * 1.5, 0.5, line) * clamp(0.08 / w, 0.0, 1.0);
      base = mix(vec3f(0.018, 0.024, 0.06), in.col * 0.5, 0.25) * (1.0 - grid) + vec3f(0.5, 0.5, 0.52) * grid;
      rough = 0.12;
      f0 = 0.05;
    }
    case 2u: { base = mix(in.col, vec3f(0.85), 0.5); rough = 0.35; }
    default: {}
  }
  let nv = clamp(dot(N, V), 1e-3, 1.0);
  let F0 = mix(vec3f(f0), base, metal);
  let albedo = base * (1.0 - metal);
  // the Earth's light, all round (diffuse) and in the mirror direction (its harmonics: a rough lobe)
  let R = reflect(-V, N);
  let ab = envAB(rough, nv);
  var col = albedo / PI * shIrr(N) + shIrr(normalize(mix(R, N, rough * rough))) / PI * (F0 * ab.x + ab.y);
  // the Sun
  let L = u.sun.xyz;
  let nl = dot(N, L);
  if (nl > 0.0 && dot(u.sunE.rgb, u.sunE.rgb) > 0.0) {
    let vis = shadowAt(in.p, N);
    let H = normalize(L + V);
    let nh = clamp(dot(N, H), 0.0, 1.0);
    let F = F0 + (1.0 - F0) * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
    col += (albedo * (1.0 - F) / PI + ggx(nh, nv, nl, rough, u.sun.w) * F) * u.sunE.rgb * nl * vis;
  }
  var o: FOut;
  o.color = vec4f(col * u.img.w, 1.0);
  o.depth = vec4f(dist, 1.0, 0.0, 1.0);
  return o;
}

// ------------------------------------------------------------------------------------ composite
@group(0) @binding(4) var boxColor: texture_2d<f32>;
@vertex
fn compVs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}
@fragment
fn compFs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let q = vec2i(p.xy - u.box.xy);
  let dims = vec2i(textureDimensions(boxColor));
  if (any(q < vec2i(0)) || any(q >= dims)) { return vec4f(0.0); }
  return textureLoad(boxColor, q, 0);
}
