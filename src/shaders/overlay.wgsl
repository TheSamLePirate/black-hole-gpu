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
@group(0) @binding(4) var shipScene: texture_2d<f32>; // (PLAN-J1 J1-5) where it is in the scene, its image cleared (r 1)

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
fn vsLine(@builtin(vertex_index) vi: u32, s: SegIn) -> SegOut { return segVertex(vi, s); }
fn segVertex(vi: u32, s: SegIn) -> SegOut {
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
fn fsLine(i: SegOut) -> @location(0) vec4f { return segCover(i); }
fn segCover(i: SegOut) -> vec4f {
  // distance to the segment [px]: across it, or from its nearer end
  let a = clamp(i.local.x, 0.0, i.len.x);
  let dist = length(vec2f(i.local.x - a, i.local.y));
  // (thinner than a pixel: fainter, not thinner)
  let w = max(i.len.y, 0.5);
  let cover = clamp(w + 0.5 - dist, 0.0, 1.0) * min(i.len.y / 0.5, 1.0);
  return vec4f(i.col.rgb, i.col.a * cover);
}

// ------------------------------------------------------------------------------ lines in space, behind what they pass behind
// (AM7, the magnetospheres' diagram): each end's distance from the camera [M]; the fragment hidden where the traced ray met
// something nearer (moments.y, the samples' nearest) — a planet, a moon —, the depth linear along the segment on screen
struct SegInD {
  @location(0) ends: vec4f,
  @location(1) col: vec4f,
  @location(2) width: vec2f,
  @location(3) depth: vec2f,
};
struct SegOutD {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) local: vec2f,
  @location(2) len: vec2f,
  @location(3) depth: vec2f,
};
@vertex
fn vsLineD(@builtin(vertex_index) vi: u32, s: SegInD) -> SegOutD {
  let o = segVertex(vi, SegIn(s.ends, s.col, s.width));
  return SegOutD(o.pos, o.col, o.local, o.len, s.depth);
}
@fragment
fn fsLineD(i: SegOutD) -> @location(0) vec4f {
  let uv = (i.pos.xy / U.out.xy - U.view.zw) / U.view.xy;
  if (any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0))) { discard; }
  let W = u32(U.img.x);
  let p = vec2u(uv * U.img.xy);
  let a = clamp(i.local.x, 0.0, i.len.x) / max(i.len.x, 1e-4);
  let d = mix(i.depth.x, i.depth.y, a);
  if (moments[p.y * W + p.x].y < d * 0.998) { discard; }
  return segCover(SegOut(i.pos, i.col, i.local, i.len));
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
    if (U.ship.z > 0.0 && all(q >= vec2f(0.0)) && all(q < U.ship.zw)) { a *= 1.0 - clamp(textureLoad(ship, vec2i(p), 0).a + textureLoad(shipScene, vec2i(p), 0).r, 0.0, 1.0); }
  }
  return vec4f(l.rgb, a);
}

// ------------------------------------------------------------------------------ the magnetosphere as light (AM7)
// The near body's magnetosphere drawn as glowing layers, at the traced image's size, composited over the output: the
// magnetopause (Shue et al. 1998) and the bow shock (a conic, e = 0.81) as thin emitting shells — their light integrated
// exactly across each step (the shell's Gaussian profile, its signed distance linear in the step: an erf) so that their rims,
// seen grazing, glow and their faces stay faint, at any step size —; the radiation belts as volumes in the dipole's L — the
// inner (protons) warm, the outer (electrons) blue —, a torus (Io's, at Jupiter) red; all stopped at the traced depth (the
// planet hides what lies behind it). A diagram's colours, labelled as such in the setting.
struct MagU {
  right: vec4f,  // camera right (its rest frame), tan(fov/2)
  up: vec4f,     // camera up, aspect
  fwd: vec4f,    // camera forward, the clock [s]
  centre: vec4f, // the body's centre in the camera's frame [its radii], its radius [M]
  dip: vec4f,    // its dipole's north (camera frame), on (1)
  sun: vec4f,    // the Sun's direction from it (camera frame), the magnetopause's standoff [radii]
  shape: vec4f,  // the magnetopause's flaring, the shock's standoff [radii], the torus's radius (0: none), its strength
  belts: vec4f,  // the inner belt's L, the outer's, their strengths (inner, outer; 0: none)
  view: vec4f,   // the image in the output: uv_out = uv · xy + zw
  img: vec4f,    // the traced image [px]: width, height
  out: vec4f,    // the output [px]: width, height
};
@group(0) @binding(5) var<uniform> MG: MagU;
@group(0) @binding(6) var magTex: texture_2d<f32>;
@group(0) @binding(7) var magSamp: sampler;

// erf (Abramowitz & Stegun 7.1.26, |ε| < 1.5e-7)
fn erfA(x: f32) -> f32 {
  let s = sign(x);
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
// ∫ exp(−(F/w)²) dt over a step of length dt where F goes linearly from f0 to f1
fn layer(f0: f32, f1: f32, w: f32, dt: f32) -> f32 {
  let df = f1 - f0;
  if (abs(df) < 1e-4 * w) { return dt * exp(-(f0 * f0) / (w * w)); }
  return dt * 0.8862269 * w * (erfA(f1 / w) - erfA(f0 / w)) / df;
}
fn shueR(r0: f32, a: f32, c: f32) -> f32 { return r0 * pow(2.0 / max(1.0 + c, 1e-3), a); }
fn shockR(r0: f32, c: f32) -> f32 { return r0 * 1.81 / max(1.0 + 0.81 * c, 0.05); }
// a ray (origin o, unit d, body frame — the body at 0) against a sphere: [t0, t1] or t1 < t0
fn sphereSpan(o: vec3f, d: vec3f, R: f32) -> vec2f {
  let b = dot(o, d);
  let h = b * b - dot(o, o) + R * R;
  if (h <= 0.0) { return vec2f(1.0, 0.0); }
  let s = sqrt(h);
  return vec2f(max(-b - s, 0.0), -b + s);
}

@fragment
fn fsMagVol(i: FullOut) -> @location(0) vec4f {
  // (at half the traced image's size — measured on the M1: +5.5 ms at its full size —, each texel the ray through its 2 × 2
  // block's middle)
  let uv = (2.0 * floor(i.pos.xy) + 1.0) / MG.img.xy;
  let ndc = vec2f(2.0 * uv.x - 1.0, 1.0 - 2.0 * uv.y);
  let d = normalize(MG.fwd.xyz + ndc.x * MG.right.w * MG.up.w * MG.right.xyz + ndc.y * MG.right.w * MG.up.xyz);
  let o = -MG.centre.xyz;
  // (the traced ray's depth there [radii]: what lies beyond is hidden)
  let W = u32(MG.img.x);
  // (the largest of a 2 × 2 block: a frame traced in a checkerboard — one pixel in two — leaves the other's depth stale; a
  // checkerboard showed through the layers)
  let p = min(2u * vec2u(i.pos.xy), vec2u(MG.img.xy) - 2u);
  let dm = max(max(moments[p.y * W + p.x].y, moments[p.y * W + p.x + 1u].y), max(moments[(p.y + 1u) * W + p.x].y, moments[(p.y + 1u) * W + p.x + 1u].y));
  let tMax = dm / MG.centre.w;
  // (a static interleaved-gradient jitter: no flicker)
  let jit = fract(52.9829189 * fract(dot(i.pos.xy, vec2f(0.06711056, 0.00583715))));
  var E = vec3f(0.0);
  let s = MG.sun.xyz;
  let r0 = MG.sun.w;
  let al = MG.shape.x;
  let rs = MG.shape.y;
  // the boundaries: within 3 shock standoffs (the tail beyond, faded)
  if (r0 > 0.0) {
    let sp = sphereSpan(o, d, 3.0 * rs);
    let t1 = min(sp.y, tMax);
    if (t1 > sp.x) {
      // (24 steps: the shells' light integrated exactly across each — a coarse step loses nothing but their curvature)
      let N = 24u;
      let dt = (t1 - sp.x) / f32(N);
      let wm = 0.07 * r0;
      let ws = 0.05 * rs;
      var q = o + d * sp.x;
      var c = dot(q, s) / max(length(q), 1e-4);
      var fm = length(q) - shueR(r0, al, c);
      var fs = length(q) - shockR(rs, c);
      for (var k = 1u; k <= N; k++) {
        let q1 = o + d * (sp.x + f32(k) * dt);
        let l1 = max(length(q1), 1e-4);
        let c1 = dot(q1, s) / l1;
        let fm1 = l1 - shueR(r0, al, c1);
        let fs1 = l1 - shockR(rs, c1);
        // (faded towards the tail: the magnetopause open past ~140°, the shock past ~120°)
        let cm = 0.5 * (c + c1);
        E += vec3f(0.35, 0.75, 1.0) * (0.045 / wm) * layer(fm, fm1, wm, dt) * smoothstep(-0.85, -0.6, cm);
        E += vec3f(0.85, 0.9, 1.0) * (0.022 / ws) * layer(fs, fs1, ws, dt) * smoothstep(-0.6, -0.3, cm);
        fm = fm1;
        fs = fs1;
        c = c1;
      }
    }
  }
  // the belts and the torus: within their sphere, marched in the dipole's L
  let li = MG.belts.x;
  let lo = MG.belts.y;
  let tr = MG.shape.z;
  let Rb = max(max(lo, tr) + 2.5, 3.0);
  if (MG.dip.w > 0.5) {
    let sp = sphereSpan(o, d, Rb);
    let t1 = min(sp.y, tMax);
    if (t1 > sp.x) {
      let N = 24u;
      let dt = (t1 - sp.x) / f32(N);
      let z = MG.dip.xyz;
      for (var k = 0u; k < N; k++) {
        let q = o + d * (sp.x + (f32(k) + jit) * dt);
        let r = length(q);
        if (r < 1.0) { continue; }
        let sl = dot(q, z) / r;
        let c2 = max(1.0 - sl * sl, 1e-4);
        let L = r / c2;
        let cl = sqrt(c2);
        let inner = MG.belts.z * exp(-pow((L - li) / (0.28 * li), 2.0)) * pow(cl, 8.0);
        let outer = MG.belts.w * exp(-pow((L - lo) / (0.3 * lo), 2.0)) * pow(cl, 5.0);
        var e = vec3f(1.0, 0.55, 0.25) * inner + vec3f(0.3, 0.7, 1.0) * outer;
        if (tr > 0.0) {
          let rho = length(q - z * dot(q, z));
          let hz = dot(q, z);
          e += vec3f(1.0, 0.3, 0.32) * MG.shape.w * exp(-pow((rho - tr) / 0.35, 2.0) - pow(hz / 0.55, 2.0));
        }
        E += e * dt;
      }
    }
  }
  // (a soft saturation: the glow's colour kept, its alpha the strongest channel's)
  let col = vec3f(1.0) - exp(-E);
  return vec4f(col, max(col.r, max(col.g, col.b)));
}

@fragment
fn fsMagComp(i: FullOut) -> @location(0) vec4f {
  let uv = (i.pos.xy / MG.out.xy - MG.view.zw) / MG.view.xy;
  let c = textureSample(magTex, magSamp, clamp(uv, vec2f(0.0), vec2f(1.0)));
  return select(c, vec4f(0.0), any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)));
}
