// The Endurance (src/endurance.ts): a mesh at a place of the hole's frame, drawn with the tracer's
// pinhole projection into a box of the image (4× MSAA), hidden where the traced scene is nearer (the
// per-pixel depth the tracer writes), lit by the accretion disk (a warm light from the hole's
// direction) and a faint fill; its lights glow blue. The box is then composited over the traced image
// (premultiplied), before bloom, and its depth handed to the depth of field.

struct U {
  view: vec4f,  // tan(fov/2), aspect, near, far [M]
  ax: vec4f,    // the ship's axes in the camera frame (x right, y up, z forward), times its size
  ay: vec4f,
  az: vec4f,
  pos: vec4f,   // its centre in the camera frame [M]; w: pre-exposure
  light: vec4f, // direction to the light (camera frame); w: its irradiance
  lcol: vec4f,  // the light's colour; w: the lights' glow (display-referred)
  fill: vec4f,  // the fill's colour × irradiance; w: unused
  box: vec4f,   // the box in the image [px]: x, y, width, height
  img: vec4u,   // image width, height (the depth buffer's)
  light2: vec4f, // the disk's face below the ship: direction (camera frame); w: its irradiance
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
  let L = u.light.xyz;
  // (the light behind the ship, facing the camera: L + V ≈ 0 — its half vector unresolved, no highlight)
  let hv = L + V;
  let H = hv * inverseSqrt(max(dot(hv, hv), 1e-8));
  let nl = max(dot(N, L), 0.0);
  // the parts: albedo, specular strength, shininess
  var albedo = vec3f(0.72);
  var spec = 0.08;
  var shin = 40.0;
  var emit = vec3f(0.0);
  switch (in.mat) {
    case 1u: { albedo = vec3f(0.42, 0.42, 0.44); spec = 0.05; }
    case 2u: { albedo = vec3f(0.03); spec = 0.6; shin = 200.0; }
    case 3u: { albedo = vec3f(0.82, 0.81, 0.78); spec = 0.04; }
    case 4u: { albedo = vec3f(0.1); emit = vec3f(0.35, 0.6, 1.0) * u.lcol.w; }
    case 5u: { albedo = vec3f(0.25); }
    case 6u: { albedo = vec3f(0.62, 0.62, 0.6); spec = 0.1; }
    default: { spec = 0.15; shin = 60.0; }
  }
  let ao = mix(0.35, 1.0, in.ao);
  let nl2 = max(dot(N, u.light2.xyz), 0.0);
  let diffuse = albedo / 3.14159265 * ((u.light.w * nl + u.light2.w * nl2) * u.lcol.rgb + u.fill.rgb * ao) * ao;
  let specular = u.lcol.rgb * u.light.w * spec * pow(clamp(dot(N, H), 0.0, 1.0), shin) * nl * (shin + 8.0) / 25.1327;
  var o: FOut;
  o.color = vec4f((diffuse + specular) * u.pos.w + emit, 1.0);
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
