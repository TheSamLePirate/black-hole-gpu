// The Endurance (src/endurance.ts): a mesh at a place of the hole's frame, drawn with the tracer's
// pinhole projection into a box of the image (4× MSAA), hidden where the traced scene is nearer (the
// per-pixel depth the tracer writes), shaded with GGX (metals, paint, glass, tiles), lit by the accretion
// disk as seen from where it is — spherical harmonics projected each frame (src/endurance.ts): its
// diffuse light, its reflections (the harmonics along the mirror direction) and its highlights (the
// dominant direction) — and a faint fill; its lights glow blue. The box is then composited over the traced image
// (premultiplied), before bloom, and its depth handed to the depth of field.

struct U {
  view: vec4f,  // tan(fov/2), aspect, near, far [M]
  ax: vec4f,    // the ship's axes in the camera frame (x right, y up, z forward), times its size
  ay: vec4f,
  az: vec4f,
  pos: vec4f,   // its centre in the camera frame [M]; w: pre-exposure
  light: vec4f, // the disk's dominant direction (camera frame); w: the irradiance coming from it
  lcol: vec4f,  // the light's colour; w: the lights' glow (display-referred)
  fill: vec4f,  // the fill's colour × irradiance; w: unused
  box: vec4f,   // the box in the image [px]: x, y, width, height
  img: vec4u,   // image width, height (the depth buffer's)
  sh: array<vec4f, 9>, // the disk's light on order-2 harmonics (camera frame), × its irradiance (x)
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> moments: array<vec2f>; // Σ l², the traced depth [M]

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) n: vec3f,
  @location(1) p: vec3f,
  @location(2) @interpolate(flat) mat: u32,
  @location(3) ao: f32,
};

@vertex
fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) m: f32, @location(3) ao: f32) -> VOut {
  var o: VOut;
  let q = u.ax.xyz * p.x + u.ay.xyz * p.y + u.az.xyz * p.z + u.pos.xyz;
  o.p = q;
  o.n = normalize(normalize(u.ax.xyz) * n.x + normalize(u.ay.xyz) * n.y + normalize(u.az.xyz) * n.z);
  o.mat = u32(m + 0.5);
  o.ao = ao;
  // the tracer's pinhole: ndc = (x / (z tan·aspect), y / (z tan)); then into the box
  let W = f32(u.img.x);
  let H = f32(u.img.y);
  let ndc = vec2f(q.x / (q.z * u.view.x * u.view.y), q.y / (q.z * u.view.x));
  let px = vec2f((ndc.x + 1.0) * 0.5 * W, (1.0 - ndc.y) * 0.5 * H) - u.box.xy;
  let nb = vec2f(px.x / u.box.z * 2.0 - 1.0, 1.0 - px.y / u.box.w * 2.0);
  let z = clamp((q.z - u.view.z) / (u.view.w - u.view.z), 0.0, 1.0);
  o.pos = vec4f(nb * q.z, z * q.z, q.z);
  return o;
}

const PI = 3.14159265;

// the disk's irradiance on a surface of normal n (Ramamoorthi & Hanrahan 2001)
fn shIrr(n: vec3f) -> vec3f {
  let b = array<f32, 9>(0.282095, 0.488603 * n.y, 0.488603 * n.z, 0.488603 * n.x, 1.092548 * n.x * n.y,
    1.092548 * n.y * n.z, 0.315392 * (3.0 * n.z * n.z - 1.0), 1.092548 * n.x * n.z, 0.546274 * (n.x * n.x - n.y * n.y));
  let A = array<f32, 9>(PI, 2.094395, 2.094395, 2.094395, 0.785398, 0.785398, 0.785398, 0.785398, 0.785398);
  var e = 0.0;
  for (var k = 0u; k < 9u; k++) { e += A[k] * b[k] * u.sh[k].x; }
  return vec3f(max(e, 0.0));
}

// split-sum environment BRDF scale and bias (Karis 2014, analytic fit): F0·x + y
fn envAB(rough: f32, nv: f32) -> vec2f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = rough * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  return vec2f(-1.04, 1.04) * a004 + r.zw;
}

struct FOut {
  @location(0) color: vec4f,
  @location(1) depth: vec4f, // distance [M], coverage
};

@fragment
fn fs(in: VOut) -> FOut {
  let dist = length(in.p);
  // hidden where the traced scene is nearer (the disk's gas, a body)
  let ip = vec2u(in.pos.xy + u.box.xy);
  let idx = min(ip.y, u.img.y - 1u) * u.img.x + min(ip.x, u.img.x - 1u);
  if (moments[idx].y < dist * 0.97) { discard; }
  let V = -in.p / dist;
  var N = in.n;
  if (dot(N, V) < 0.0) { N = -N; } // (thin, open parts: lit from the side seen)
  // the parts: base colour, metalness, roughness
  var base = vec3f(0.72);
  var metal = 1.0;
  var rough = 0.4;
  var emit = vec3f(0.0);
  switch (in.mat) {
    case 1u: { base = vec3f(0.42, 0.42, 0.44); metal = 0.0; rough = 0.6; }
    case 2u: { base = vec3f(0.02); metal = 0.0; rough = 0.06; }
    case 3u: { base = vec3f(0.82, 0.81, 0.78); metal = 0.0; rough = 0.75; }
    case 4u: { base = vec3f(0.1); metal = 0.0; rough = 0.5; emit = vec3f(0.35, 0.6, 1.0) * u.lcol.w; }
    case 5u: { base = vec3f(0.25); metal = 0.0; rough = 0.8; }
    case 6u: { base = vec3f(0.62, 0.62, 0.6); metal = 0.3; rough = 0.5; }
    default: {}
  }
  let ao = mix(0.35, 1.0, in.ao);
  let F0 = mix(vec3f(0.04), base, metal);
  let albedo = base * (1.0 - metal);
  let nv = max(dot(N, V), 1e-3);
  let a = rough * rough;
  // diffuse: the disk's light all round (its harmonics' irradiance) and the fill
  let lc = u.lcol.rgb;
  let diffuse = albedo / PI * (shIrr(N) * lc + u.fill.rgb) * ao;
  // highlights: the dominant direction's share of it, GGX (Smith height-correlated, Schlick)
  let L = u.light.xyz;
  let nl = max(dot(N, L), 0.0);
  let hv = L + V;
  let H = hv * inverseSqrt(max(dot(hv, hv), 1e-8));
  let nh = max(dot(N, H), 0.0);
  let d = nh * nh * (a * a - 1.0) + 1.0;
  let D = a * a / (PI * d * d);
  let vis = 0.5 / max(nl * sqrt(nv * nv * (1.0 - a * a) + a * a) + nv * sqrt(nl * nl * (1.0 - a * a) + a * a), 1e-5);
  let F = F0 + (1.0 - F0) * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  let direct = D * vis * F * nl * u.light.w * lc;
  // reflections: the harmonics along the mirror direction (a rough lobe: their low orders), split-sum
  let R = reflect(-V, N);
  let ab = envAB(rough, nv);
  let refl = (shIrr(mix(R, N, a)) / PI) * lc * (F0 * ab.x + ab.y) * ao;
  var o: FOut;
  o.color = vec4f((diffuse + direct + refl) * u.pos.w + emit, 1.0);
  o.depth = vec4f(dist, 1.0, 0.0, 1.0);
  return o;
}

// ------------------------------------------------------------------------------------ composite
@group(0) @binding(2) var boxColor: texture_2d<f32>;
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
