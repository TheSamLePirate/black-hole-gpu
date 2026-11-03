// The horizon maps' bake (docs/PLAN-REFRACTION-HORIZONS.md H1; src/system/horizon-maps.ts — its CPU bake is this, read for
// read): for each texel of a lattice (a body's latitude/longitude map, or a polar cap's stereographic grid), its sectors'
// highest sine of elevation — three rays a sector, from D_bake out to the data's reach at steps ×1.25, the curvature exact,
// seen from the top of the texel and its neighbours —, stored as signed roots in rgba8unorm layers. A band of rows a dispatch.

struct Bake {
  // kind (0 lat/lon, 1 polar), the lattice's width, height, the band's first row
  shape: vec4u,
  // lat/lon: lon0, lat0, dlon, dlat; polar: pole (±1), rmax, 0, 0
  grid: vec4f,
  // the body's radius [m], D_bake [m], the reach [m], the source's texel [m]
  range: vec4f,
  // the steps along a ray, the receiver's level, the sectors, the source's top level
  count: vec4u,
  // the rays' spread either side of a sector's axis [rad], the layer the lattice's first sector goes to, the rays' reads (1 the
  // ground's mean — option (d), decision 37 —, 0 its top)
  extra: vec4f,
};
@group(0) @binding(0) var<uniform> B: Bake;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var out: texture_storage_2d_array<rgba8unorm, write>;

const PI = 3.14159265358979;
const TAU = 6.28318530717959;
const STEP = 1.25;
const SIN_MAX = 0.75;

// the highest of the 2 × 2 texels round a point at a level (the heights' G: their maximum down the mips — trace.wgsl demTop)
fn topAt(q: vec3f, level: u32) -> f32 {
  let l = min(level, B.count.w);
  let dl = max(vec2i(textureDimensions(src, l)), vec2i(1));
  let uv = vec2f(0.5 + atan2(q.y, q.x) / TAU, 0.5 - asin(clamp(q.z, -1.0, 1.0)) / PI);
  let x = uv * vec2f(dl) - 0.5;
  let i = vec2i(floor(x));
  let x0 = (i.x % dl.x + dl.x) % dl.x;
  let x1 = (x0 + 1) % dl.x;
  let y0 = clamp(i.y, 0, dl.y - 1);
  let y1 = clamp(i.y + 1, 0, dl.y - 1);
  return max(max(textureLoad(src, vec2i(x0, y0), l).g, textureLoad(src, vec2i(x1, y0), l).g),
    max(textureLoad(src, vec2i(x0, y1), l).g, textureLoad(src, vec2i(x1, y1), l).g));
}
// the mean height at a point at a level, bilinear (the mips' R — option (d): the rays read the ground's mean, horizon-maps.ts
// meanLevelAt)
fn meanAt(q: vec3f, level: u32) -> f32 {
  let l = min(level, B.count.w);
  let dl = max(vec2i(textureDimensions(src, l)), vec2i(1));
  let uv = vec2f(0.5 + atan2(q.y, q.x) / TAU, 0.5 - asin(clamp(q.z, -1.0, 1.0)) / PI);
  let x = uv * vec2f(dl) - 0.5;
  let i = vec2i(floor(x));
  let f = x - vec2f(i);
  let x0 = (i.x % dl.x + dl.x) % dl.x;
  let x1 = (x0 + 1) % dl.x;
  let y0 = clamp(i.y, 0, dl.y - 1);
  let y1 = clamp(i.y + 1, 0, dl.y - 1);
  let a = mix(textureLoad(src, vec2i(x0, y0), l).r, textureLoad(src, vec2i(x1, y0), l).r, f.x);
  let b = mix(textureLoad(src, vec2i(x0, y1), l).r, textureLoad(src, vec2i(x1, y1), l).r, f.x);
  return mix(a, b, f.y);
}
// the receiver's height: the highest of the nearest texel at a level and its 8 neighbours (horizon-maps.ts topAround)
fn topAround(q: vec3f, level: u32) -> f32 {
  let l = min(level, B.count.w);
  let dl = max(vec2i(textureDimensions(src, l)), vec2i(1));
  let uv = vec2f(0.5 + atan2(q.y, q.x) / TAU, 0.5 - asin(clamp(q.z, -1.0, 1.0)) / PI);
  let c = vec2i(floor(uv * vec2f(dl)));
  var m = -1e9;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let x = ((c.x + dx) % dl.x + dl.x) % dl.x;
      let y = clamp(c.y + dy, 0, dl.y - 1);
      m = max(m, textureLoad(src, vec2i(x, y), l).g);
    }
  }
  return m;
}
// the sine of the elevation of a point at h an arc th away, seen from h0 (horizon-maps.ts elevationSin)
fn elevationSin(h0: f32, h: f32, th: f32) -> f32 {
  let R = B.range.x;
  let rt = R + h;
  let s = sin(0.5 * th);
  let vert = h - h0 - rt * 2.0 * s * s;
  let horiz = rt * sin(th);
  return vert / sqrt(vert * vert + horiz * horiz);
}
fn encode(v: f32) -> f32 {
  let x = clamp(v / SIN_MAX, -1.0, 1.0);
  return 0.5 + 0.5 * sign(x) * sqrt(abs(x));
}

@compute @workgroup_size(8, 8)
fn bake(@builtin(global_invocation_id) id: vec3u) {
  let size = B.shape.yz;
  let ij = vec2u(id.x, id.y + B.shape.w);
  if (ij.x >= size.x || ij.y >= size.y) { return; }
  // (the texel's point, its latitude and longitude)
  var lat: f32;
  var lon: f32;
  if (B.shape.x == 0u) {
    lat = B.grid.y - (f32(ij.y) + 0.5) * B.grid.w;
    lon = B.grid.x + (f32(ij.x) + 0.5) * B.grid.z;
  } else {
    let xy = (-1.0 + (vec2f(ij) + 0.5) * 2.0 / vec2f(size)) * B.grid.y;
    let c = 2.0 * atan(length(xy) / 2.0);
    lon = atan2(xy.y, xy.x);
    lat = B.grid.x * (PI / 2.0 - c);
  }
  let sl = sin(lat);
  let cl = cos(lat);
  let so = sin(lon);
  let co = cos(lon);
  let p = vec3f(cl * co, cl * so, sl);
  let east = vec3f(-so, co, 0.0);
  let north = vec3f(-sl * co, -sl * so, cl);
  let h0 = topAround(p, B.count.y);
  let S = B.count.z;
  var v: array<f32, 16>;
  // (option (d): each sector's dominant blocker — its step along the ray, D_bake × 1.25ⁿ —, for the horizon seen again from a
  // receiver's own height at shading: tan e' = tan e + (h0 − h)/d)
  var at: array<f32, 16>;
  let mean = B.extra.z > 0.5;
  for (var k = 0u; k < S; k++) {
    var best = -1.0;
    var bestStep = 0u;
    for (var r = 0; r < 3; r++) {
      let ang = f32(k) * TAU / f32(S) + f32(r - 1) * B.extra.x;
      // (on the map an azimuth from north, clockwise; on a cap an angle from the grid's +x — its radial south on the north
      // cap, north on the south one)
      var a = cos(ang);
      var b = sin(ang);
      if (B.shape.x != 0u) {
        a = -B.grid.x * cos(ang - lon);
        b = sin(ang - lon);
      }
      let t = a * north + b * east;
      var d = B.range.y;
      for (var n = 0u; n < B.count.x; n++) {
        let th = d / B.range.x;
        let q = p * cos(th) + t * sin(th);
        let level = u32(max(ceil(log2(0.5 * (1.0 - 1.0 / STEP) * d / B.range.w)), 0.0));
        let h = select(topAt(q, level), meanAt(q, level + 1u), mean);
        let e = elevationSin(h0, h, th);
        if (e > best) {
          best = e;
          bestStep = n;
        }
        d *= STEP;
      }
    }
    v[k] = encode(best);
    at[k] = f32(bestStep) / 255.0;
  }
  let layer0 = i32(B.extra.y);
  for (var k = 0u; k < S / 4u; k++) {
    textureStore(out, vec2i(ij), layer0 + i32(k), vec4f(v[4u * k], v[4u * k + 1u], v[4u * k + 2u], v[4u * k + 3u]));
    // (the blockers' steps in the layers after the sines')
    textureStore(out, vec2i(ij), layer0 + i32(S / 4u + k), vec4f(at[4u * k], at[4u * k + 1u], at[4u * k + 2u], at[4u * k + 3u]));
  }
}

// the render's mips: the mean of the encoded values (a softened penumbra from afar — never a visibility: plan §2.5)
@group(0) @binding(3) var down: texture_2d_array<f32>;
@group(0) @binding(4) var downOut: texture_storage_2d_array<rgba8unorm, write>;
@compute @workgroup_size(8, 8)
fn mip(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(downOut);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let s = vec2i(id.xy) * 2;
  let l = i32(id.z);
  let c = textureLoad(down, s, l, 0) + textureLoad(down, s + vec2i(1, 0), l, 0) + textureLoad(down, s + vec2i(0, 1), l, 0)
    + textureLoad(down, s + vec2i(1, 1), l, 0);
  textureStore(downOut, vec2i(id.xy), l, 0.25 * c);
}
