// The sky chart's overlay (skychart.ts): its lines — the constellations' figures, the grids, the ecliptic
// — as antialiased quads in the output's pixels, gathered in a texture of their own (their joints
// taken once: max blending), then laid over the displayed image where the traced ray met the sky — not
// the ground, the Sun's or the Moon's disk (the ray's depth: ≥ 1e8 M).

struct Overlay {
  out: vec4f,  // output width, height [px], mask on (1), the lines' widths' scale (output px per CSS px)
  view: vec4f, // the image in the output: uv_out = uv · xy + zw (the offline view letterboxed)
  img: vec4f,  // the traced image's width, height [px], 0, 0
  ship: vec4f, // the Ranger's box in the image [px]: x, y, width, height (0: not drawn)
};
@group(0) @binding(0) var<uniform> U: Overlay;
@group(0) @binding(1) var<storage, read> moments: array<vec2f>; // Σ luminance², depth [M] per traced pixel
@group(0) @binding(2) var lines: texture_2d<f32>;
@group(0) @binding(3) var ship: texture_2d<f32>; // the Ranger, premultiplied (its alpha: what it hides)

struct SegIn {
  @location(0) ends: vec4f, // x0, y0, x1, y1 in the image's NDC
  @location(1) col: vec4f,  // display sRGB, alpha
  @location(2) width: vec2f, // [output px], 0
};
struct SegOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  // (along the segment, across it [px]; its length, half width)
  @location(1) local: vec2f,
  @location(2) len: vec2f,
};

fn toPixels(ndc: vec2f) -> vec2f {
  let uv = vec2f(0.5 * ndc.x + 0.5, 0.5 - 0.5 * ndc.y);
  return (uv * U.view.xy + U.view.zw) * U.out.xy;
}

@vertex
fn vsLine(@builtin(vertex_index) vi: u32, s: SegIn) -> SegOut {
  let p0 = toPixels(s.ends.xy);
  let p1 = toPixels(s.ends.zw);
  let d = p1 - p0;
  let len = length(d);
  let t = select(vec2f(1.0, 0.0), d / len, len > 1e-4);
  let n = vec2f(-t.y, t.x);
  // (half the width and a pixel of antialiasing, on the sides and past the ends)
  let wpx = s.width.x * U.out.w;
  let h = 0.5 * wpx + 1.0;
  let corner = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0))[vi];
  let along = mix(-h, len + h, corner.x);
  let across = corner.y * h;
  let p = p0 + t * along + n * across;
  var o: SegOut;
  o.pos = vec4f(p.x / U.out.x * 2.0 - 1.0, 1.0 - p.y / U.out.y * 2.0, 0.0, 1.0);
  o.col = s.col;
  o.local = vec2f(along, across);
  o.len = vec2f(len, 0.5 * wpx);
  return o;
}

@fragment
fn fsLine(i: SegOut) -> @location(0) vec4f {
  // distance to the segment [px]: across it, or from its nearer end
  let a = clamp(i.local.x, 0.0, i.len.x);
  let dist = length(vec2f(i.local.x - a, i.local.y));
  // (thinner than a pixel: fainter, not thinner)
  let w = max(i.len.y, 0.5);
  let cover = clamp(w + 0.5 - dist, 0.0, 1.0) * min(i.len.y / 0.5, 1.0);
  return vec4f(i.col.rgb, i.col.a * cover);
}

// ------------------------------------------------------------------------------ the composite
struct FullOut { @builtin(position) pos: vec4f };
@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> FullOut {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[vi];
  var o: FullOut;
  o.pos = vec4f(p, 0.0, 1.0);
  return o;
}

@fragment
fn fsComposite(i: FullOut) -> @location(0) vec4f {
  let q = vec2i(i.pos.xy);
  let l = textureLoad(lines, q, 0);
  if (l.a <= 0.0) { discard; }
  var a = l.a;
  if (U.out.z > 0.5) {
    // the sky only: the traced pixel under this one (the image letterboxed in the output)
    let uv = (i.pos.xy / U.out.xy - U.view.zw) / U.view.xy;
    if (any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0))) { discard; }
    let W = u32(U.img.x);
    let p = vec2u(uv * U.img.xy);
    if (moments[p.y * W + p.x].y < 1e8) { discard; }
    // (and not over the Ranger, drawn over the traced image)
    let q = vec2f(p) - U.ship.xy;
    if (U.ship.z > 0.0 && all(q >= vec2f(0.0)) && all(q < U.ship.zw)) { a *= 1.0 - clamp(textureLoad(ship, vec2i(p), 0).a, 0.0, 1.0); }
  }
  return vec4f(l.rgb, a);
}
