// The James Webb Space Telescope (src/jwst.ts): assets/jwst/jwst.bin on its Sun–Earth L2 Halo orbit.
// Drawn as the ISS is (station.wgsl): into a 4× MSAA depth-tested box with a 2048×2048 Sun shadow map,
// composited into the linear HDR buffer before bloom.
//
// Surface kinds (encoded in vertex color alpha × 255):
//   0: dark composite booms, radiator, optical bench, brackets
//   1: 24k gold-coated beryllium hexagonal primary & secondary mirrors (high metal, crisp GGX, starlight sheen)
//   2: 5-layer Kapton sunshield foils & silver/lavender MLI blankets (micro-crinkled anisotropic-like foil normal)
//   3: spacecraft bus solar array (deep blue photovoltaic cell grid)

struct U {
  view: vec4f,     // tan(fov/2)·aspect, tan(fov/2), near, far [m]
  box: vec4f,      // the box in the image [px]: x, y, width, height
  img: vec4f,      // image width, height; metres per M; pre-exposure
  sun: vec4f,      // towards the Sun (camera frame); w: its angular radius
  sunE: vec4f,     // its irradiance (rgb, tracer units); w: ambient starlight scale
  light: vec4f,    // shadow map box: centre (camera frame) and radius [m]
  row0: vec4f,     // model -> camera affine transform (3 rows)
  row1: vec4f,
  row2: vec4f,
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> sceneDepth: array<f32>;
@group(0) @binding(2) var shadowTex: texture_depth_2d;
@group(0) @binding(3) var shadowSamp: sampler_comparison;

struct VIn {
  @location(0) p: vec3f,
  @location(1) n: vec4f,
  @location(2) c: vec4f,
  @location(3) part: vec4u,
};

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) p: vec3f,
  @location(1) n: vec3f,
  @location(2) col: vec3f,
  @location(3) @interpolate(flat) kind: u32,
  @location(4) q: vec3f,
};

fn toCam(x: vec3f, w: f32) -> vec3f {
  let h = vec4f(x, w);
  return vec3f(dot(u.row0, h), dot(u.row1, h), dot(u.row2, h));
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
  let q = toCam(v.p, 1.0);
  o.p = q;
  o.n = normalize(toCam(v.n.xyz, 0.0));
  o.col = pow(v.c.rgb, vec3f(2.2));
  o.kind = u32(v.c.a * 255.0 + 0.5);
  o.q = v.p;
  o.pos = project(q);
  return o;
}

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
  return vec4f(lightClip(toCam(v.p, 1.0)), 1.0);
}

fn shadowAt(q: vec3f, n: vec3f) -> f32 {
  let c = lightClip(q + n * 0.025 + u.sun.xyz * 0.02);
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

fn ggx(nh: f32, nv: f32, nl: f32, rough: f32, rs: f32) -> f32 {
  let a = min(rough * rough + 0.5 * rs, 1.0);
  let aa = a * a;
  let dd = nh * nh * (aa - 1.0) + 1.0;
  let D = aa / (PI * dd * dd);
  let V = 0.5 / max(nl * sqrt(nv * nv * (1.0 - aa) + aa) + nv * sqrt(nl * nl * (1.0 - aa) + aa), 1e-6);
  return D * V;
}

// Subtle procedural crinkle perturbation for the 5-layer Kapton sunshield foils
fn foilCrinkle(q: vec3f) -> vec3f {
  let p = q * 3.8;
  let a = sin(p.x * 2.1 + cos(p.z * 1.7)) * cos(p.z * 2.5 - sin(p.x * 1.9));
  let b = cos(p.x * 3.3 - p.z * 2.7) * sin(p.y * 4.1 + p.z * 1.3);
  return vec3f(a, 0.25 * (a - b), b) * 0.065;
}

struct FOut {
  @location(0) color: vec4f,
  @location(1) depth: vec4f,
};

@fragment
fn fs(in: VOut) -> FOut {
  let dist = length(in.p);
  let ip = vec2u(in.pos.xy + u.box.xy);
  let iw = u32(u.img.x);
  let ih = u32(u.img.y);
  let idx = min(ip.y, ih - 1u) * iw + min(ip.x, iw - 1u);
  if (sceneDepth[idx] * u.img.z < dist * 0.999) { discard; }

  let V = -in.p / dist;
  var N = normalize(in.n);
  if (dot(N, V) < 0.0) { N = -N; }
  let fw = fwidth(in.q);

  var base = in.col;
  var metal = 0.15;
  var rough = 0.55;
  var f0 = 0.04;

  switch (in.kind) {
    case 1u: {
      // 24k gold-coated beryllium primary & secondary mirror
      base = vec3f(0.96, 0.62, 0.09);
      metal = 0.96;
      rough = 0.09;
      f0 = 0.04;
    }
    case 2u: {
      // 5-layer Kapton sunshield foils & MLI blankets (crinkled specular reflection)
      let cr = toCam(foilCrinkle(in.q), 0.0);
      N = normalize(N + cr);
      metal = 0.84;
      rough = 0.24;
      f0 = 0.05;
    }
    case 3u: {
      // Solar array cells on the bus
      let g = in.q * 4.0;
      let line = max(abs(fract(g.x) - 0.5), abs(fract(g.z) - 0.5));
      let w = max(length(fw) * 4.0, 0.02);
      let grid = smoothstep(0.5 - w * 1.5, 0.5, line) * clamp(0.08 / w, 0.0, 1.0);
      base = mix(vec3f(0.02, 0.03, 0.09), in.col * 0.5, 0.3) * (1.0 - grid) + vec3f(0.55, 0.58, 0.65) * grid;
      metal = 0.1;
      rough = 0.14;
      f0 = 0.05;
    }
    default: {
      // Carbon-fiber booms, radiator, optical bench
      metal = 0.12;
      rough = 0.52;
    }
  }

  let nv = clamp(dot(N, V), 1e-3, 1.0);
  let F0 = mix(vec3f(f0), base, metal);
  let albedo = base * (1.0 - metal);

  // Deep-space starlight + subtle Milky Way + sunshield bounce ambient so the cold golden mirror reads cleanly
  let sunPower = max(length(u.sunE.rgb), 1e-5);
  let ambStrength = sunPower * u.sunE.w;
  let R = reflect(-V, N);
  let skyTint = mix(vec3f(0.55, 0.68, 0.95), vec3f(1.0, 0.88, 0.68), 0.5 + 0.5 * clamp(R.y, -1.0, 1.0));
  let Famb = F0 + (vec3f(1.0) - F0) * pow(1.0 - nv, 4.0) * (1.0 - rough * 0.7);
  let goldBoost = select(1.0, 2.2, in.kind == 1u);
  var col = (albedo / PI * 0.55 + Famb * skyTint * mix(0.95, 0.28, rough) * goldBoost) * ambStrength;

  // Direct sunlight + crisp 3x3 PCF self-shadowing
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
