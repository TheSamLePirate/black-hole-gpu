// Procedural forests (src/system/forest.ts is the twin of this file: the same hash, cells, shapes).
// Included by the tracer and the near field's shader (src/forest-shader.ts): the host gives forestData(i),
// the scenery buffer's vec4 i; the section's offset is forestData(2).x (0: none).
//
// The grid's cells are a world-fixed Mercator grid (affine in the scenery's frame); a cell holds one tree
// at most, its crown within half a cell of its own: a ray walks the dual cells (round the cells' vertices),
// four candidate trees each, the first crossing exact. 8 × 8 blocks of dual cells keep the lowest ground
// and highest crown they may meet: a ray above the canopy or below the ground skips them whole.

// BEGIN_FOREST_STANDALONE (removed when included: the host declares the buffer and forestData)
@group(0) @binding(0) var<storage, read> forestStandalone: array<vec4f>;
fn forestData(i: u32) -> vec4f { return forestStandalone[i]; }
// END_FOREST_STANDALONE

// a crossing: its distance [m], normal (frame), the tree's kind (0: none), the part (0 crown, 1 trunk),
// the foot of its trunk (frame metres), its height [m], its own number in [0, 1), the light its own leaves
// leave it (1 at the crown's skin, less in its hollows)
struct ForestHit { t: f32, n: vec3f, kind: u32, part: u32, base: vec3f, height: f32, seed: f32, ao: f32 };

fn forestPcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn forestHash(i: u32, j: u32, k: u32) -> u32 { return forestPcg((i * 1597334677u) ^ forestPcg((j * 3812015801u) ^ k)); }
fn forestUnit(h: u32) -> f32 { return f32(h) / 4294967296.0; }
// value noise in [-1, 1], one lattice unit
fn forestNoise(p: vec3f) -> f32 {
  let i = bitcast<vec3u>(vec3i(floor(p))); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  let k = i * vec3u(73856093u, 19349663u, 83492791u);
  let a = forestUnit(forestPcg(k.x ^ k.y ^ k.z)); let b = forestUnit(forestPcg((k.x + 73856093u) ^ k.y ^ k.z));
  let c = forestUnit(forestPcg(k.x ^ (k.y + 19349663u) ^ k.z)); let d = forestUnit(forestPcg((k.x + 73856093u) ^ (k.y + 19349663u) ^ k.z));
  let e = forestUnit(forestPcg(k.x ^ k.y ^ (k.z + 83492791u))); let f1 = forestUnit(forestPcg((k.x + 73856093u) ^ k.y ^ (k.z + 83492791u)));
  let g = forestUnit(forestPcg(k.x ^ (k.y + 19349663u) ^ (k.z + 83492791u))); let h = forestUnit(forestPcg((k.x + 73856093u) ^ (k.y + 19349663u) ^ (k.z + 83492791u)));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z) * 2.0 - 1.0;
}

fn forestEllipsoid(o: vec3f, d: vec3f, c: vec3f, r: vec3f) -> vec4f {
  let p = (o - c) / r; let v = d / r; let a = dot(v, v); let b = dot(p, v); let det = b * b - a * (dot(p, p) - 1.0);
  if (det < 0.0) { return vec4f(-1.0); }
  // (the stable pair: no cancellation however far the ray starts)
  let q = -(b + select(-1.0, 1.0, b >= 0.0) * sqrt(det));
  let t0 = min(q / a, (dot(p, p) - 1.0) / q); let t1 = max(q / a, (dot(p, p) - 1.0) / q);
  let t = select(t1, t0, t0 >= 0.001);
  if (t < 0.001) { return vec4f(-1.0); }
  return vec4f(t, normalize((o + d * t - c) / (r * r)));
}
// a cone, its apex up at `apex`, `h` high, its base `rb` wide; and its base's disc
fn forestCone(o: vec3f, d: vec3f, apex: vec3f, rb: f32, h: f32) -> vec4f {
  let k = rb / h; let k2 = k * k; let co = o - apex;
  let a = d.x * d.x + d.y * d.y - k2 * d.z * d.z;
  let b = 2.0 * (co.x * d.x + co.y * d.y - k2 * co.z * d.z);
  let c = co.x * co.x + co.y * co.y - k2 * co.z * co.z;
  var best = vec4f(-1.0);
  var roots = vec2f(-1.0);
  if (abs(a) < 1e-9) {
    if (abs(b) > 1e-9) { roots = vec2f(-c / b, -1.0); }
  } else {
    let det = b * b - 4.0 * a * c;
    if (det >= 0.0) {
      let q = -0.5 * (b + select(-1.0, 1.0, b >= 0.0) * sqrt(det));
      roots = vec2f(q / a, select(c / q, -1.0, abs(q) < 1e-12));
    }
  }
  for (var n = 0u; n < 2u; n++) {
    let t = roots[n];
    if (t > 0.001 && (best.x < 0.0 || t < best.x)) {
      let q = co + d * t;
      if (q.z <= 0.0 && q.z >= -h) { best = vec4f(t, normalize(vec3f(q.xy, k * length(q.xy) + 1e-6))); }
    }
  }
  if (abs(d.z) > 1e-7) {
    let t = (apex.z - h - o.z) / d.z;
    let q = o + d * t - apex;
    if (t > 0.001 && (best.x < 0.0 || t < best.x) && dot(q.xy, q.xy) <= rb * rb) { best = vec4f(t, 0.0, 0.0, -1.0); }
  }
  return best;
}
// a vertical cylinder round (c.x, c.y) from c.z to `top`, seen from outside
fn forestTrunk(o: vec3f, d: vec3f, c: vec3f, r: f32, top: f32) -> vec4f {
  let p = o.xy - c.xy; let a = dot(d.xy, d.xy);
  if (a < 1e-12) { return vec4f(-1.0); }
  let b = dot(p, d.xy); let det = b * b - a * (dot(p, p) - r * r);
  if (det < 0.0) { return vec4f(-1.0); }
  let t = (-b - sqrt(det)) / a;
  let z = o.z + d.z * t;
  if (t < 0.001 || z < c.z || z > top) { return vec4f(-1.0); }
  return vec4f(t, vec3f((p + d.xy * t) / r, 0.0));
}

// ---- the crowns near: the shape carved inwards by its leaves' clumps (and a conifer's branch tiers), so
// its outline breaks and the sky shows through — never past the plain shape (a cell's half, the blocks' top)
struct ForestCrown { cone: bool, c: vec3f, r: vec3f, amp: f32, grain: f32, tiers: f32 };
// a bound on the distance to the plain shape (negative inside)
fn forestCrownBase(s: ForestCrown, p: vec3f) -> f32 {
  let q = p - s.c;
  if (s.cone) {
    let k = s.r.x / s.r.y;
    return max((length(q.xy) + k * q.z) / sqrt(1.0 + k * k), -s.r.y - q.z);
  }
  let k0 = length(q / s.r); let k1 = length(q / (s.r * s.r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
// how deep the leaves carve it here [m], 0 … amp
fn forestCarve(s: ForestCrown, p: vec3f) -> f32 {
  let n = 0.68 * forestNoise(p / s.grain) + 0.32 * forestNoise(p / (s.grain * 0.4) + vec3f(31.7));
  var c = 0.5 + 0.5 * n;
  if (s.tiers > 0.0) { c = 0.62 * fract((p.z - s.c.z) / s.tiers + 0.37 * n) + 0.38 * c; }
  // (never deeper than half the shape is wide there: a spire's tip, a dome's top stay whole, nothing floats)
  let q = p - s.c;
  let wide = select(s.r.x * sqrt(max(0.0, 1.0 - (q.z / s.r.z) * (q.z / s.r.z))), s.r.x / s.r.y * max(-q.z, 0.0), s.cone);
  return min(s.amp * clamp(c, 0.0, 1.0), 0.5 * wide + 0.05);
}
fn forestCrownField(s: ForestCrown, p: vec3f) -> f32 { return forestCrownBase(s, p) + forestCarve(s, p); }
// the carved crown's first crossing after the plain shape's entry at t0 (t, normal, its hollow's light), or none
fn forestCarved(o: vec3f, d: vec3f, s: ForestCrown, t0: f32) -> vec4f {
  var t = t0;
  for (var n = 0; n < 28; n++) {
    let p = o + d * t;
    let b = forestCrownBase(s, p);
    // (deeper than the carving reaches: solid)
    let f = select(b + forestCarve(s, p), b, b < -s.amp);
    if (f < 0.002 + 0.002 * t) { return vec4f(t, b, 0.0, 1.0); }
    // (out of the plain shape again: through a gap)
    if (b > 0.02 && t > t0 + 0.05) { return vec4f(-1.0); }
    t += max(f * 0.5, 0.03);
  }
  return vec4f(t, forestCrownBase(s, o + d * t), 0.0, 1.0);
}
// a bare crown near (a deciduous tree in winter): its branches, radiating up and out from the trunk — thin
// across (around it, and up), long along the radius —, the sky between them, denser towards the core;
// (t, the plain shape's depth there), or none
fn forestBranches(q: vec3f, seed: f32) -> f32 {
  let rho = length(q.xy);
  let u = atan2(q.y, q.x) * 5.093; let v = (q.z - 0.55 * rho) * 2.4; let w = rho * 0.7;
  return 0.75 * forestNoise(vec3f(u, v, w + seed * 37.0)) + 0.25 * forestNoise(vec3f(u * 2.3, v * 2.3, w * 2.0 + 11.0));
}
fn forestTwigs(o: vec3f, d: vec3f, s: ForestCrown, t0: f32, seed: f32) -> vec4f {
  var t = t0;
  let core = 0.6 * min(s.r.x, s.r.z);
  // (until the ray leaves the plain shape: a vertical path through a tall crown is ~18 m)
  for (var n = 0; n < 140; n++) {
    let p = o + d * t;
    let b = forestCrownBase(s, p);
    if (b > 0.02 && t > t0 + 0.05) { return vec4f(-1.0); }
    if (forestBranches(p - s.c, seed) > 0.66 - 0.3 * clamp(-b / core, 0.0, 1.0)) { return vec4f(t, b, 0.0, 1.0); }
    t += 0.14;
  }
  return vec4f(-1.0);
}
fn forestTwigNormal(q: vec3f, seed: f32) -> vec3f {
  let e = vec2f(0.04, -0.04);
  return -normalize(e.xyy * forestBranches(q + e.xyy, seed) + e.yyx * forestBranches(q + e.yyx, seed) + e.yxy * forestBranches(q + e.yxy, seed) + e.xxx * forestBranches(q + e.xxx, seed) + vec3f(1e-6));
}
fn forestCrownNormal(s: ForestCrown, p: vec3f) -> vec3f {
  let e = vec2f(0.06, -0.06);
  return normalize(e.xyy * forestCrownField(s, p + e.xyy) + e.yyx * forestCrownField(s, p + e.yyx) + e.yxy * forestCrownField(s, p + e.yxy) + e.xxx * forestCrownField(s, p + e.xxx));
}

// the season (forest.ts forestSeason): the spring's fresh leaves, the autumn's colours, the deciduous crowns'
// bareness, the snow line on the evergreens [m]; whether a kind's leaves fall (0 … 1)
fn forestSeason() -> vec4f { return forestData(u32(forestData(2u).x) + 7u); }
fn forestDeciduous(kind: u32) -> f32 { return forestData(u32(forestData(2u).x) + 10u + 4u * kind).w; }
// a kind's leaves' and bark's albedo (linear), and the share of the satellite's colour in its leaves
fn forestLeaf(kind: u32) -> vec3f { return forestData(u32(forestData(2u).x) + 9u + 4u * kind).xyz; }
fn forestTint(kind: u32) -> f32 { return forestData(u32(forestData(2u).x) + 8u + 4u * kind).w; }
fn forestBark(kind: u32) -> vec3f {
  let b = bitcast<u32>(forestData(u32(forestData(2u).x) + 9u + 4u * kind).w);
  return vec3f(f32(b & 1023u), f32((b >> 10u) & 1023u), f32((b >> 20u) & 1023u)) / 1023.0;
}

// A crossing's look: its albedo and the light its leaves let through (both linear, over π), from its species,
// the satellite's colour under it (rgb, weight 0 … 1), the season — autumn's colours tree by tree (some turn
// early; yellow, orange or red), winter's bare twigs, snow on the evergreens' upper needles above the snow
// line — and its own shade (the crown darker inside and below). n: its normal (frame), p: the point.
struct ForestLook { albedo: vec3f, through: vec3f };
fn forestLook(h: ForestHit, n: vec3f, p: vec3f, sat: vec4f) -> ForestLook {
  if (h.part == 1u) { return ForestLook(forestBark(h.kind) * (0.8 + 0.4 * h.seed), vec3f(0.0)); }
  var alb = mix(forestLeaf(h.kind), sat.rgb * 1.25, forestTint(h.kind) * sat.w) * (0.82 + 0.36 * h.seed);
  let season = forestSeason(); let falls = forestDeciduous(h.kind);
  let s2 = fract(h.seed * 7.31 + 0.13);
  let turned = clamp(season.y * 1.6 - 0.5 * fract(h.seed * 3.7), 0.0, 1.0) * falls;
  let fall = select(select(vec3f(0.17, 0.035, 0.012), vec3f(0.2, 0.09, 0.012), s2 < 0.75), vec3f(0.2, 0.14, 0.018), s2 < 0.4);
  alb = mix(alb, fall, turned);
  alb = mix(alb, vec3f(0.085, 0.07, 0.06), season.z * falls);
  let snowy = (1.0 - falls) * smoothstep(season.w - 150.0, season.w + 150.0, h.base.z + h.height * 0.6 + 120.0 * (h.seed - 0.5));
  alb = mix(alb, vec3f(0.72, 0.74, 0.78), snowy * smoothstep(0.15, 0.7, n.z) * 0.85);
  // (light through the leaves: their own colour, deepened; the bare and the snowy let none)
  let through = alb * vec3f(1.15, 1.4, 0.55) * (1.0 - season.z * falls) * (1.0 - snowy);
  alb *= h.ao * mix(0.6, 1.0, smoothstep(h.base.z + h.height * 0.25, h.base.z + h.height, p.z));
  return ForestLook(alb, through);
}

// The section's header, read once a query: its offset, the cells' grid (w × h, the words' place), a cell's size, the
// world's columns, the grid's first global cell, and the cells → frame metres maps
struct ForestHead { F: u32, w: i32, h: i32, cellsAt: u32, cell: f32, columns: i32, i0: i32, j0: i32, C: vec3f, Dm: vec3f };
fn forestHead(F: u32) -> ForestHead {
  let h0 = forestData(F); let h1 = forestData(F + 1u); let h6 = forestData(F + 6u);
  return ForestHead(F, i32(h0.x), i32(h0.y), u32(h1.x), h1.z, i32(h1.w), bitcast<i32>(h6.x), bitcast<i32>(h6.y),
    forestData(F + 4u).xyz, forestData(F + 5u).xyz);
}
// Where a ray comes within reach of cell (i, j)'s tree [m along it]: its trunk's foot, less its crown's width and its height
// (forestCandidate's own t0) — the walk past a tree the raster named and the ray missed starts there
fn forestCandidateStart(o: vec3f, d: vec3f, i: i32, j: i32, hd: ForestHead) -> f32 {
  if (i < 0 || j < 0 || i >= hd.w || j >= hd.h) { return 0.0; }
  let k = u32(j * hd.w + i);
  let word = bitcast<u32>(forestData(hd.cellsAt + k / 4u)[k % 4u]);
  let z = f32(word & 0x3fffffu) / 100.0 - 20000.0;
  let height = 2.0 + f32(word >> 26u) * 0.5;
  let gi = u32(((hd.i0 + i) % hd.columns + hd.columns) % hd.columns); let gj = bitcast<u32>(hd.j0 + j);
  let u = f32(i) + 0.12 + 0.76 * forestUnit(forestHash(gi, gj, 1u));
  let v = f32(j) + 0.12 + 0.76 * forestUnit(forestHash(gi, gj, 2u));
  let r = hd.cell * (0.3 + 0.17 * forestUnit(forestHash(gi, gj, 3u)));
  let foot = vec3f(hd.C.x + hd.C.y * u + hd.C.z * v, hd.Dm.x + hd.Dm.y * u + hd.Dm.z * v, z);
  return max(0.0, dot(foot - o, d) - r - height);
}
// A ray's crossing with the one tree of cell (i, j), or none (t −1): forestQuery's own test of a candidate, and the raster's
// (the tree its instance drew at a pixel: docs/PLAN-RENDU-RASTER-AAA.md étape 1b). detail < 0: its plain crown whole, not shrunk
// as a far one's — the raster's material, the proxy drawn round that whole crown)
fn forestCandidate(o: vec3f, d: vec3f, i: i32, j: i32, detail: f32, hd: ForestHead) -> ForestHit {
  let none = ForestHit(-1.0, vec3f(0.0), 0u, 0u, vec3f(0.0), 0.0, 0.0, 1.0);
  let F = hd.F; let w = hd.w; let hh = hd.h; let cellsAt = hd.cellsAt; let cell = hd.cell; let columns = hd.columns;
  let i0 = hd.i0; let j0 = hd.j0; let C = hd.C; let Dm = hd.Dm;
  if (i < 0 || j < 0 || i >= w || j >= hh) { return none; }
  let k = u32(j * w + i);
  let word = bitcast<u32>(forestData(cellsAt + k / 4u)[k % 4u]);
  let kind = (word >> 22u) & 15u;
  if (kind == 0u) { return none; }
  let z = f32(word & 0x3fffffu) / 100.0 - 20000.0;
  let height = 2.0 + f32(word >> 26u) * 0.5;
  let gi = u32(((i0 + i) % columns + columns) % columns); let gj = bitcast<u32>(j0 + j);
  let u = f32(i) + 0.12 + 0.76 * forestUnit(forestHash(gi, gj, 1u));
  let v = f32(j) + 0.12 + 0.76 * forestUnit(forestHash(gi, gj, 2u));
  let r = cell * (0.3 + 0.17 * forestUnit(forestHash(gi, gj, 3u)));
  let foot = vec3f(C.x + C.y * u + C.z * v, Dm.x + Dm.y * u + Dm.z * v, z);
  // (the ray's nearest pass to the trunk's axis: farther than the crown, nothing)
  let rel = foot.xy - o.xy; let dd = dot(d.xy, d.xy);
  let off = select(length(rel - d.xy * (dot(rel, d.xy) / dd)), length(rel), dd < 1e-10);
  if (off > r + 0.5) { return none; }
  let kA = forestData(F + 7u + 4u * kind); let kB = forestData(F + 8u + 4u * kind); let kD = forestData(F + 10u + 4u * kind);
  // (the ray started near the tree: the shapes' sums stay small however far the camera)
  let t0 = max(0.0, dot(foot - o, d) - r - height);
  let oo = o + d * t0;
  // (a deciduous crown in winter: its twigs carved through, the sky behind them)
  let amp = (kD.x + 0.55 * kD.w * forestData(F + 7u).z) * r;
  let near = t0 + r + height < detail * (0.85 + 0.3 * forestUnit(forestHash(gi, gj, 8u)));
  // the plain crown (far: shrunk by half the carving, its mean)
  var crown = ForestCrown(kA.x > 0.5, vec3f(0.0), vec3f(0.0), amp, kD.y, kD.z);
  let shrink = select(0.5 * amp, 0.0, near || detail < 0.0);
  if (crown.cone) {
    crown.c = foot + vec3f(0.0, 0.0, height);
    crown.r = vec3f(kA.z * r - shrink, height * (1.0 - kA.y), 0.0);
  } else {
    crown.c = foot + vec3f(0.0, 0.0, kA.y * height);
    crown.r = vec3f(kA.z * r - shrink, kA.z * r - shrink, kA.w * height - shrink);
  }
  var h = select(forestEllipsoid(oo, d, crown.c, crown.r), forestCone(oo, d, crown.c, crown.r.x, crown.r.y), crown.cone);
  var part = 0u; var ao = 1.0;
  // (bare: a deciduous tree's winter, 0 … 1)
  let bare = kD.w * forestData(F + 7u).z;
  let seed = forestUnit(forestHash(gi, gj, 4u));
  if (h.x > 0.0 && near && bare > 0.5) {
    let c = forestTwigs(oo, d, crown, h.x, seed);
    if (c.x > 0.0) {
      h = vec4f(c.x, forestTwigNormal(oo + d * c.x - crown.c, seed));
      ao = clamp(1.0 + c.y / (crown.r.x + 1e-3), 0.45, 1.0);
    } else { h = vec4f(-1.0); }
  } else if (h.x > 0.0 && near) {
    let c = forestCarved(oo, d, crown, h.x);
    if (c.x > 0.0) {
      h = vec4f(c.x, forestCrownNormal(crown, oo + d * c.x));
      ao = clamp(1.0 + c.y / (crown.amp * 1.6 + 1e-3), 0.3, 1.0);
    } else { h = vec4f(-1.0); }
  } else if (h.x > 0.0 && bare > 0.5) {
    // (far: the twigs' cover, a fine fixed pattern the camera's jitter averages)
    let k = bitcast<vec3u>(vec3i(floor((oo + d * h.x) * 2.5)));
    if (forestUnit(forestPcg((k.x * 73856093u) ^ (k.y * 19349663u) ^ (k.z * 83492791u))) > 0.45) { h = vec4f(-1.0); }
  }
  if (h.x > 0.0) { h.x += t0; }
  if (kB.x > 0.0) {
    // (a bare crown shows its trunk running up into it)
    let tr = forestTrunk(oo, d, foot - vec3f(0.0, 0.0, 1.0), kB.y + kB.z * height, z + mix(kB.x, 0.8, bare) * height);
    if (tr.x > 0.0 && (h.x < 0.0 || tr.x + t0 < h.x)) { h = vec4f(tr.x + t0, tr.yzw); part = 1u; ao = 1.0; }
  }
  if (h.x <= 0.0) { return none; }
  return ForestHit(h.x, h.yzw, kind, part, foot, height, seed, ao);
}

// The first tree a ray from o along d (unit, frame metres) meets before tMax; anyHit: the first found.
// Crowns within `detail` metres along the ray are carved by their leaves (0: the plain shapes everywhere).
fn forestQuery(o: vec3f, d: vec3f, tMax: f32, anyHit: bool, detail: f32) -> ForestHit {
  return forestQueryFrom(o, d, 0.0, tMax, anyHit, detail);
}
// The same, the cells walked from tStart along the ray (the raster's: no tree before it — its instance there the nearest)
fn forestQueryFrom(o: vec3f, d: vec3f, tStart: f32, tMax: f32, anyHit: bool, detail: f32) -> ForestHit {
  var best = ForestHit(tMax, vec3f(0.0), 0u, 0u, vec3f(0.0), 0.0, 0.0, 1.0);
  let F = u32(forestData(2u).x);
  if (F == 0u) { return best; }
  let hd = forestHead(F);
  let A = forestData(F + 2u).xyz; let B = forestData(F + 3u).xyz;
  let h0 = forestData(F);
  let w = hd.w; let hh = hd.h; let bw = u32(h0.z); let bh = i32(h0.w);
  let blocksAt = u32(forestData(F + 1u).y);
  // the ray in dual cells' coordinates (the cells' coordinates + ½)
  let s0 = vec2f(A.x + A.y * o.x + A.z * o.y, B.x + B.y * o.x + B.z * o.y) + 0.5;
  let sr = vec2f(A.y * d.x + A.z * d.y, B.y * d.x + B.z * d.y);
  // (an axis the ray does not move along: never crossed, walked forwards)
  let sd = select(sr, vec2f(0.0), abs(sr) < vec2f(1e-12));
  let inv = select(1.0 / sd, vec2f(1e30), sd == vec2f(0.0));
  let ta = (vec2f(0.0) - s0) * inv; let tb = (vec2f(f32(w + 1), f32(hh + 1)) - s0) * inv;
  let t1 = min(min(max(ta, tb).x, max(ta, tb).y), tMax);
  var t = max(max(min(ta, tb).x, min(ta, tb).y), max(tStart, 0.0));
  let stp = vec2i(select(vec2i(-1), vec2i(1), sd >= vec2f(0.0)));
  let delta = abs(inv);
  var steps = 0u;
  // the blocks in the ray's order, an integer walk (a block found again from the ray's point would stall where
  // the ray barely moves across them — looking straight down: a float's step over 900 cells)
  let s1 = s0 + sd * t;
  var bc = clamp(vec2i(floor(s1 / 8.0)), vec2i(0), vec2i(i32(bw) - 1, bh - 1));
  var bNext = (vec2f(bc * 8) + select(vec2f(0.0), vec2f(8.0), sd >= vec2f(0.0)) - s0) * inv;
  let bDelta = 8.0 * delta;
  loop {
    if (t >= t1 || t >= best.t || steps > 640u) { break; }
    if (any(bc < vec2i(0)) || bc.x >= i32(bw) || bc.y >= bh) { break; }
    let bi = u32(bc.y) * bw + u32(bc.x);
    let bv = forestData(blocksAt + bi / 2u); let zb = select(bv.xy, bv.zw, (bi & 1u) == 1u);
    let tExit = min(min(bNext.x, bNext.y), t1);
    let za = o.z + d.z * t; let zz = o.z + d.z * tExit;
    steps++;
    if (!(zb.y < zb.x || max(za, zz) < zb.x || min(za, zz) > zb.y)) {
    // the dual cells in this block, in the ray's order (the first: where the ray enters it, kept inside it)
    let s = s0 + sd * t;
    var p = clamp(vec2i(floor(s)), bc * 8, bc * 8 + vec2i(7));
    var next = (vec2f(p) + select(vec2f(0.0), vec2f(1.0), sd >= vec2f(0.0)) - s0) * inv;
    loop {
      for (var q = 0; q < 4; q++) {
        let c = forestCandidate(o, d, p.x - 1 + (q & 1), p.y - 1 + (q >> 1), detail, hd);
        if (c.t > 0.0 && c.t < best.t) {
          best = c;
          if (anyHit) { return best; }
        }
      }
      let tc = min(next.x, next.y);
      if (best.t <= tc || tc >= tExit || steps > 640u) { break; }
      if (next.x < next.y) { p.x += stp.x; next.x += delta.x; } else { p.y += stp.y; next.y += delta.y; }
      steps++;
    }
    }
    if (best.t <= tExit) { break; }
    t = tExit;
    if (bNext.x < bNext.y) { bc.x += stp.x; bNext.x += bDelta.x; } else { bc.y += stp.y; bNext.y += bDelta.y; }
  }
  return best;
}
