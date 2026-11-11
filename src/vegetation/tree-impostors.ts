// V2b — the trees' hemi-octahedral impostors (docs/ANALYSE-MER-LITTORAL-VEGETATION-2026-11-10.md §5.1 V2; PLAN-REFRACTION-HORIZONS
// Q8 F3): each modelled tree (vegetation/tree-model.ts — a kind at a proportion) photographed from 8 × 8 directions over the upper
// hemisphere (an octahedral map of the hemisphere turned 45°: views from overhead to the horizon, the way an aircraft sees trees —
// not the azimuth alone), each view an orthographic 64² frame of the tree's bounding sphere, into two texture arrays (a layer a
// model): its albedo's terms (r: the leaves' shade — variation × the crown's depth —, g: leaf 1 / bark 0, b: unused, a: coverage)
// and its surface (rg: the shading normal octahedrally encoded in the tree's frame, b: the depth along the view from the frame's
// plane, in bounding radii, a: coverage). Rendered at twice the size and averaged down 2 × 2 (coverage soft at the edges). To come
// with their drawing (V2c): the mips, each mip's coverage rescaled so that its thresholded share equals the full level's (Castaño
// 2010 — the forest far does not thin). Relit at the pixel by the shade (V2c): the impostors hold no light.
//
// Conventions (the reader's — V2c — must match): view index v = row × 8 + column; a view's direction d (from the tree towards the
// eye, z up) from its cell's centre (u, w) ∈ [−1, 1]²: p = ((u + w) / 2, (u − w) / 2), d = normalize(p.x, p.y, 1 − |p.x| − |p.y|);
// its frame: right = normalize(z × d) (x when d is vertical), up = d × right; centre (0, 0, 0.5) of the canonical tree (height 1),
// half-size the bounding sphere's radius √(radius² + 0.25); a view's texel (x, y) ∈ [0, 64)² at right × (2x/64 − 1) + up × (1 − 2y/64)
// (rows top-down); its depth b: 0.5 + 0.5 × (the point's offset towards the eye) / half-size.

import { ForestKind, KIND_SHAPES } from "../system/forest";
import { TREE_ASPECTS, TREE_MODEL_KINDS, type TreeMesh, treeModel, treeRng } from "./tree-model";

export const IMPOSTOR_VIEWS = 8;
export const IMPOSTOR_VIEW_PX = 64;
export const IMPOSTOR_SIZE = IMPOSTOR_VIEWS * IMPOSTOR_VIEW_PX;
/** the layers: two a kind (wide, slender), in TREE_MODEL_KINDS's order */
export const IMPOSTOR_LAYERS = TREE_MODEL_KINDS.length * 2;
export const IMPOSTOR_MIPS = 5;
/** the array's mips: the impostors' views read down to 4 texels (IMPOSTOR_MIPS), the canopy's tiles down to their mean (1 texel) */
export const IMPOSTOR_TEX_MIPS = 10;
/** (V1) the canopy's tiles after the impostors' 24 layers: their albedo's terms then their surface's — 0 the broadleaves' and pines'
 *  (the Mediterranean's, the lowlands'), 1 the conifers' (the mountains', the north's) */
export const CANOPY_TILES = 2;
export const CANOPY_LAYER = 2 * IMPOSTOR_LAYERS;
/** a tile's side [m] (512 texels: 12.5 cm), its trees on a jittered grid of 9 × 9 (7.1 m: the forest's cells) */
export const CANOPY_TILE_M = 64;
export const CANOPY_GRID = 9;
/** the layers in all */
export const IMPOSTOR_ARRAY_LAYERS = 2 * IMPOSTOR_LAYERS + 2 * CANOPY_TILES;

/** a view's direction (from the tree to the eye) — the reader's — for its cell (column, row) */
export function impostorViewDir(col: number, row: number): [number, number, number] {
  const u = ((col + 0.5) / IMPOSTOR_VIEWS) * 2 - 1;
  const w = ((row + 0.5) / IMPOSTOR_VIEWS) * 2 - 1;
  const px = (u + w) / 2,
    py = (u - w) / 2;
  const pz = 1 - Math.abs(px) - Math.abs(py);
  const l = Math.hypot(px, py, Math.max(pz, 0));
  return [px / l, py / l, Math.max(pz, 0) / l];
}

/** the cell (fractional, [0, 8)²) a direction falls in — the bake's inverse (d.z clamped to the hemisphere) */
export function impostorCellOf(d: [number, number, number]): [number, number] {
  const z = Math.max(d[2], 0);
  const s = Math.abs(d[0]) + Math.abs(d[1]) + z;
  const px = d[0] / s,
    py = d[1] / s;
  const u = px + py,
    w = px - py;
  return [((u + 1) / 2) * IMPOSTOR_VIEWS, ((w + 1) / 2) * IMPOSTOR_VIEWS];
}

export const BAKE_WGSL = /* wgsl */ `
struct Bake { radius: f32, kind: f32, half: f32, pad: f32 };
@group(0) @binding(0) var<uniform> B: Bake;
struct VOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) a: vec4f, @location(2) depth: f32 };
const VIEWS = ${IMPOSTOR_VIEWS}.0;
fn viewDir(v: u32) -> vec3f {
  let col = f32(v % ${IMPOSTOR_VIEWS}u);
  let row = f32(v / ${IMPOSTOR_VIEWS}u);
  let u = (col + 0.5) / VIEWS * 2.0 - 1.0;
  let w = (row + 0.5) / VIEWS * 2.0 - 1.0;
  let p = vec2f(u + w, u - w) * 0.5;
  return normalize(vec3f(p, max(1.0 - abs(p.x) - abs(p.y), 0.0)));
}
@vertex fn vs(@location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) attr: vec4f, @builtin(instance_index) v: u32) -> VOut {
  let d = viewDir(v);
  var right = cross(vec3f(0.0, 0.0, 1.0), d);
  right = select(normalize(right), vec3f(1.0, 0.0, 0.0), dot(right, right) < 1e-8);
  let up = cross(d, right);
  let q = pos - vec3f(0.0, 0.0, 0.5);
  var o: VOut;
  // (orthographic, the bounding sphere's half-size; depth: towards the eye nearer — 0 at the front of the sphere, 1 at its back)
  let z = dot(q, d);
  o.pos = vec4f(dot(q, right) / B.half, dot(q, up) / B.half, 0.5 - 0.5 * z / B.half, 1.0);
  o.n = nrm;
  o.a = attr;
  o.depth = z / B.half;
  return o;
}
// (V1 — the canopy's tile: a tree's model at its place, scale and turn — an instance's —, seen from straight above, orthographic over
// the tile's 64 m, drawn again a tile away on every side: the tile wraps; its depth the height — the higher, the nearer)
struct TopIn { @location(3) at: vec4f, @location(4) scale: vec2f };
@vertex fn vsTop(@location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) attr: vec4f, t: TopIn) -> VOut {
  let c = cos(t.at.z);
  let sn = sin(t.at.z);
  let p = vec3f(pos.x * c - pos.y * sn, pos.x * sn + pos.y * c, pos.z) * vec3f(t.scale.x, t.scale.x, t.scale.y);
  let w = p + vec3f(t.at.xy, 0.0);
  var o: VOut;
  o.pos = vec4f(w.x / ${CANOPY_TILE_M}.0 * 2.0 - 1.0, 1.0 - w.y / ${CANOPY_TILE_M}.0 * 2.0, 1.0 - w.z / 40.0, 1.0);
  let nn = vec3f(nrm.x * c - nrm.y * sn, nrm.x * sn + nrm.y * c, nrm.z) / vec3f(t.scale.x, t.scale.x, t.scale.y);
  o.n = normalize(nn);
  o.a = attr;
  o.depth = w.z / 20.0 - 1.0;
  return o;
}
fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
// (a leaf card's mask: a spray of leaflets — five ellipses — on a broad leaf's card; a needle tuft's or a frond's: thin blades)
fn leafMask(uv: vec2f, kind: f32) -> bool {
  let c = uv * 2.0 - 1.0;
  if (kind == 2.0 || kind == 4.0) {
    // (needles, fronds: blades across the card's length)
    let blades = abs(fract(c.y * 3.5 + 0.5 * c.x * c.x) - 0.5);
    return blades < 0.32 * (1.0 - c.x * c.x) && abs(c.x) < 0.98;
  }
  var hit = false;
  for (var i = 0; i < 5; i++) {
    let a = f32(i) * 1.2566 + 0.3;
    let ctr = vec2f(cos(a), sin(a)) * 0.42;
    let dd = c - ctr;
    let ax = vec2f(cos(a), sin(a));
    let along = dot(dd, ax);
    let across = dot(dd, vec2f(-ax.y, ax.x));
    if ((along * along) / 0.2 + (across * across) / 0.07 < 1.0) { hit = true; }
  }
  return hit || dot(c, c) < 0.12;
}
struct FOut { @location(0) alb: vec4f, @location(1) surf: vec4f };
fn octEnc(n: vec3f) -> vec2f {
  let p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
  let w = select((1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)), p, n.z >= 0.0);
  return w * 0.5 + 0.5;
}
@fragment fn fs(i: VOut, @builtin(front_facing) front: bool) -> FOut {
  let leaf = i.a.z > 0.5;
  if (leaf && !leafMask(i.a.xy, B.kind)) { discard; }
  var n = normalize(i.n);
  // (a bark's back faces: turned; a leaf's two faces lit alike — its normal the crown's, bent outwards)
  if (!leaf && !front) { n = -n; }
  var o: FOut;
  o.alb = vec4f(i.a.w, select(0.0, 1.0, leaf), 0.0, 1.0);
  o.surf = vec4f(octEnc(n), clamp(0.5 + 0.5 * i.depth, 0.0, 1.0), 1.0);
  return o;
}
`;

export const DOWN_WGSL = /* wgsl */ `
// (2 × 2 averaged — coverage-weighted for the colours, the coverage itself plain)
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) g: vec3u) {
  let size = textureDimensions(dst);
  if (g.x >= size.x || g.y >= size.y) { return; }
  var acc = vec4f(0.0);
  for (var k = 0u; k < 4u; k++) {
    let t = textureLoad(src, vec2u(g.xy * 2u + vec2u(k & 1u, k >> 1u)), 0);
    acc += vec4f(t.rgb * t.a, t.a);
  }
  let a = acc.a / 4.0;
  textureStore(dst, g.xy, vec4f(select(vec3f(0.0), acc.rgb / acc.a, acc.a > 0.0), a));
}
`;

/** the frame's radius about the axis a kind's model is photographed in (canonical; the leaves stay within its envelope grown by a
 *  quarter — a palm's fronds droop further: 0.45) — the bake's and the reader's (trace: IMP_HALF) */
export function impostorFrameRadius(kind: number, aspect: number): number {
  return KIND_SHAPES[kind]!.width * aspect * (kind === ForestKind.palm ? 1.45 : 1.25) + 0.01;
}
/** a layer's frame half-size: the bounding sphere about (0, 0, 0.5) */
export const impostorHalf = (kind: number, aspect: number) => Math.hypot(impostorFrameRadius(kind, aspect), 0.5);

/** sampled textures per stage with the impostors bound: the deferred light kernel's 37 and theirs (one array) */
export const IMPOSTOR_TEXTURE_LIMIT = 38;
/** their binding in the tracer's group 0 */
export const IMPOSTOR_BINDING = 50;
/** the trees nearer than this [m] keep their carved crowns (dithered over the next 100 m into the impostors) */
export const IMPOSTOR_NEAR_M = 200;

/**
 * The tracer's reader (PLAN-VEGETATION-V2 V2c): the array — the albedo's terms in layers 0–11, the surface's in 12–23, mip-mapped —
 * and sceneryTreeImpostor, a far tree of shadeLite read from its impostor: the layer of its kind at the nearer proportion, scaled
 * to its cell's crown and height; one of the four views about the eye's direction (in the tree's own, scaled frame), drawn by their weights; the ray met with
 * that view's plane; its texel's coverage taken as a probability (`rnd`: the far forest keeps its mean cover, the history averages
 * it), its depth along the view, its normal, the leaves' shade. Bound where the device takes one more sampled texture.
 */
export function withTreeImpostors(trace: string, supported: boolean): string {
  const marker = /\/\/ BEGIN_IMPOSTOR[\s\S]*?\/\/ END_IMPOSTOR/;
  if (!marker.test(trace)) throw new Error("tree impostors: missing tracer stub");
  if (!supported) return trace;
  const aspects: number[] = [];
  const halves: number[] = [];
  for (const kind of TREE_MODEL_KINDS)
    for (const a of TREE_ASPECTS[kind]!) {
      aspects.push(a);
      halves.push(impostorHalf(kind, a));
    }
  const arr = (v: number[]) => v.map((x) => x.toFixed(5)).join(", ");
  return trace.replace(
    marker,
    `
@group(0) @binding(${IMPOSTOR_BINDING}) var impTex: texture_2d_array<f32>;
const IMPOSTOR_BOUND = true;
const IMPOSTOR_NEAR_M = ${IMPOSTOR_NEAR_M.toFixed(1)};
const IMP_ASPECT = array<f32, ${IMPOSTOR_LAYERS}>(${arr(aspects)});
const IMP_HALF = array<f32, ${IMPOSTOR_LAYERS}>(${arr(halves)});
const CANOPY_LAYER = ${CANOPY_LAYER};
// (V1 — the canopy's tile at a world point xy [m], tile t (0 broadleaves and pines, 1 conifers), for a footprint fpM [m]: x the
// albedo's factor — the leaves' shade where the crowns cover, the shaded ground between them, over the tile's mean —, yz the
// normal's tilt east and north — the crowns' rounded tops —, w its weight (faded as the footprint passes the tile's mean texel)
fn canopyTile(xy: vec2f, fpM: f32, t: i32) -> vec4f {
  let uv = xy / ${CANOPY_TILE_M}.0;
  let lod = log2(max(fpM * ${IMPOSTOR_SIZE}.0 / ${CANOPY_TILE_M}.0, 1.0));
  let w = 1.0 - smoothstep(${IMPOSTOR_TEX_MIPS - 2}.0, ${IMPOSTOR_TEX_MIPS - 1}.0, lod);
  if (w <= 0.0) { return vec4f(1.0, 0.0, 0.0, 0.0); }
  let A = textureSampleLevel(impTex, detailSamp, uv, CANOPY_LAYER + t, lod);
  let S = textureSampleLevel(impTex, detailSamp, uv, CANOPY_LAYER + ${CANOPY_TILES} + t, lod);
  let M = textureSampleLevel(impTex, detailSamp, vec2f(0.5), CANOPY_LAYER + t, ${IMPOSTOR_TEX_MIPS - 1}.0);
  let lum = mix(0.3, mix(0.55, 1.15, A.r), A.a);
  let mean = mix(0.3, mix(0.55, 1.15, M.r), M.a);
  let e = S.rg * 2.0 - 1.0;
  // (the crowns' normal — octahedral, upper hemisphere —, its tilt weighed by the cover)
  return vec4f(mix(1.0, lum / mean, w), e * A.a * w, w);
}
fn impViewDir(c: vec2f) -> vec3f {
  let u = (c.x + 0.5) / ${IMPOSTOR_VIEWS}.0 * 2.0 - 1.0;
  let w = (c.y + 0.5) / ${IMPOSTOR_VIEWS}.0 * 2.0 - 1.0;
  let p = vec2f(u + w, u - w) * 0.5;
  return normalize(vec3f(p, max(1.0 - abs(p.x) - abs(p.y), 0.0)));
}
fn sceneryTreeImpostor(o: vec3f, d: vec3f, ci: i32, cj: i32, hd: ForestHead, tree: ForestHit, rnd: f32) -> ImpHit {
  let none = ImpHit(-1.0, vec3f(0.0), 0.0, false);
  if (tree.kind == 0u || tree.kind > ${TREE_MODEL_KINDS.length}u) { return none; }
  // (the cell's crown radius, forestCandidate's draw)
  let gi = u32(((hd.i0 + ci) % hd.columns + hd.columns) % hd.columns);
  let gj = bitcast<u32>(hd.j0 + cj);
  let r = hd.cell * (0.3 + 0.17 * forestUnit(forestHash(gi, gj, 3u)));
  let H = tree.height;
  let b = (tree.kind - 1u) * 2u;
  let ratio = r / H;
  let L = b + select(0u, 1u, abs(log(ratio / IMP_ASPECT[b + 1u])) < abs(log(ratio / IMP_ASPECT[b])));
  let sx = r / IMP_ASPECT[L];
  let half = IMP_HALF[L];
  // (the ray in the tree's canonical frame — height 1 —: the same parameter t, metres along d)
  let oc = vec3f((o.xy - tree.base.xy) / sx, (o.z - tree.base.z) / H);
  let dc = vec3f(d.xy / sx, d.z / H);
  let eye = normalize(-dc);
  let z = max(eye.z, 0.0);
  let pp = eye.xy / (abs(eye.x) + abs(eye.y) + z);
  // (the four views about the eye's direction, one drawn by their bilinear weights — a pixel's own, the frame's: the history blends
  // them, no view's jump as the eye turns round the tree, two reads as for one)
  let cf = (vec2f(pp.x + pp.y, pp.x - pp.y) * 0.5 + 0.5) * ${IMPOSTOR_VIEWS}.0 - 0.5;
  let pick = vec2f(fract(rnd * 13.17 + 0.21), fract(rnd * 29.71 + 0.57));
  let cell = clamp(floor(cf) + select(vec2f(0.0), vec2f(1.0), pick < fract(cf)), vec2f(0.0), vec2f(${IMPOSTOR_VIEWS - 1}.0));
  let vv = impViewDir(cell);
  var right = cross(vec3f(0.0, 0.0, 1.0), vv);
  right = select(normalize(right), vec3f(1.0, 0.0, 0.0), dot(right, right) < 1e-8);
  let up = cross(vv, right);
  let den = dot(dc, vv);
  if (abs(den) < 1e-6) { return none; }
  let C = vec3f(0.0, 0.0, 0.5);
  let tc = dot(C - oc, vv) / den;
  let q = oc + dc * tc - C;
  let uv = vec2f(dot(q, right), dot(q, up)) / half;
  if (max(abs(uv.x), abs(uv.y)) > 1.0) { return none; }
  // (the mip: the pixel's footprint over a texel — 64 across the frame's 2 half × the larger scale)
  let footM = max(tc, 1.0) * 2.0 * P.cam.w / P.res.y;
  let texM = 2.0 * half * max(sx, H) / ${IMPOSTOR_VIEW_PX}.0;
  let lod = clamp(log2(max(footM / texM, 1e-3)), 0.0, ${IMPOSTOR_MIPS - 1}.0);
  // (held inside the view's own cell: the filter never reaches the next view)
  let inset = 0.5 * exp2(ceil(lod)) / ${IMPOSTOR_VIEW_PX}.0;
  let a = (cell + clamp(vec2f(uv.x * 0.5 + 0.5, 0.5 - 0.5 * uv.y), vec2f(inset), vec2f(1.0 - inset))) / ${IMPOSTOR_VIEWS}.0;
  let A = textureSampleLevel(impTex, detailSamp, a, i32(L), lod);
  if (A.a <= rnd) { return none; }
  let S = textureSampleLevel(impTex, detailSamp, a, i32(L + ${IMPOSTOR_LAYERS}u), lod);
  // (the depth along the view, towards the eye; t: back along the ray by it)
  let zoff = (S.b - 0.5) * 2.0 * half;
  let t = tc - zoff / max(dot(-dc, vv), 1e-4);
  var e = S.rg * 2.0 - 1.0;
  var nc = vec3f(e, 1.0 - abs(e.x) - abs(e.y));
  if (nc.z < 0.0) { nc = vec3f((1.0 - abs(e.yx)) * select(vec2f(-1.0), vec2f(1.0), e >= vec2f(0.0)), nc.z); }
  let n = normalize(vec3f(nc.xy / sx, nc.z / H));
  return ImpHit(t, n, A.r, A.g > 0.5);
}`,
  );
}

/**
 * The impostors' bake and texture: one array — the albedo's terms in layers 0–11, the surface's in 12–23, five mips —, made at once
 * (bound from the start, empty), the twelve models baked into it on the first ask; `ready` once they are (P.scenery[6].w).
 */
export class TreeImpostors {
  readonly texture: GPUTexture;
  ready = false;
  failed: string | null = null;
  /** where the bake is: idle, pipelines, models (n), ready */
  stage = "idle";
  bakeMs = 0;
  models: { kind: number; aspect: number; leaves: number; tris: number; radius: number }[] = [];
  private baking: Promise<void> | null = null;

  constructor(private device: GPUDevice) {
    this.texture = device.createTexture({
      label: "tree impostors",
      size: [IMPOSTOR_SIZE, IMPOSTOR_SIZE, IMPOSTOR_ARRAY_LAYERS],
      format: "rgba8unorm",
      mipLevelCount: IMPOSTOR_TEX_MIPS,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
  }

  /** Bakes them (once). */
  bake(): Promise<void> {
    this.baking ??= this.run().catch((e) => {
      this.failed = String(e);
      console.warn("tree impostors: not baked —", e);
    });
    return this.baking;
  }

  private async run() {
    const d = this.device;
    const t0 = performance.now();
    const big = IMPOSTOR_SIZE * 2;
    const tex = this.texture;
    const rtUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const rtA = d.createTexture({ label: "tree impostor bake A", size: [big, big], format: "rgba8unorm", usage: rtUsage });
    const rtS = d.createTexture({ label: "tree impostor bake S", size: [big, big], format: "rgba8unorm", usage: rtUsage });
    const depth = d.createTexture({ size: [big, big], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.stage = "pipelines";
    const module = d.createShaderModule({ code: BAKE_WGSL, label: "tree impostor bake" });
    const pipe = await d.createRenderPipelineAsync({
      label: "tree impostor bake",
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vs",
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
          { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
          { arrayStride: 16, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x4" }] },
        ],
      },
      fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }, { format: "rgba8unorm" }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });
    const downModule = d.createShaderModule({ code: DOWN_WGSL, label: "tree impostor down" });
    const downPipe = await d.createComputePipelineAsync({
      label: "tree impostor down",
      layout: "auto",
      compute: { module: downModule, entryPoint: "down" },
    });
    const uni = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const group = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uni } }] });
    const buffers: GPUBuffer[] = [];
    const upload = (data: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, usage: number) => {
      const b = d.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(b, 0, data);
      buffers.push(b);
      return b;
    };
    const down = (enc: GPUCommandEncoder, src: GPUTextureView, dst: GPUTextureView, size: number) => {
      const cp = enc.beginComputePass({ label: "tree impostor down" });
      cp.setPipeline(downPipe);
      cp.setBindGroup(
        0,
        d.createBindGroup({
          layout: downPipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: src },
            { binding: 1, resource: dst },
          ],
        }),
      );
      cp.dispatchWorkgroups(Math.ceil(size / 8), Math.ceil(size / 8));
      cp.end();
    };
    const level = (layer: number, mip: number) =>
      tex.createView({ dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: mip, mipLevelCount: 1 });
    let layer = 0;
    this.models = [];
    const meshes: { vp: GPUBuffer; vn: GPUBuffer; va: GPUBuffer; ib: GPUBuffer; count: number; kind: number; aspect: number }[] = [];
    for (const kind of TREE_MODEL_KINDS) {
      for (const aspect of TREE_ASPECTS[kind]!) {
        this.stage = `models ${layer}`;
        const m: TreeMesh = treeModel(kind, aspect, 1);
        this.models.push({ kind, aspect, leaves: m.leaves, tris: m.index.length / 3, radius: m.radius });
        d.queue.writeBuffer(uni, 0, new Float32Array([m.radius, kind, impostorHalf(kind, aspect), 0]));
        const V = GPUBufferUsage.VERTEX;
        const vp = upload(m.pos, V),
          vn = upload(m.nrm, V),
          va = upload(m.attr, V),
          ib = upload(m.index, GPUBufferUsage.INDEX);
        meshes.push({ vp, vn, va, ib, count: m.index.length, kind, aspect });
        const enc = d.createCommandEncoder({ label: "tree impostor bake" });
        const pass = enc.beginRenderPass({
          colorAttachments: [
            { view: rtA.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] },
            { view: rtS.createView(), loadOp: "clear", storeOp: "store", clearValue: [0.5, 0.5, 1, 0] },
          ],
          depthStencilAttachment: { view: depth.createView(), depthLoadOp: "clear", depthStoreOp: "discard", depthClearValue: 1 },
        });
        pass.setPipeline(pipe);
        pass.setBindGroup(0, group);
        pass.setVertexBuffer(0, vp);
        pass.setVertexBuffer(1, vn);
        pass.setVertexBuffer(2, va);
        pass.setIndexBuffer(ib, "uint32");
        const px = IMPOSTOR_VIEW_PX * 2;
        for (let v = 0; v < IMPOSTOR_VIEWS * IMPOSTOR_VIEWS; v++) {
          const col = v % IMPOSTOR_VIEWS,
            row = Math.floor(v / IMPOSTOR_VIEWS);
          pass.setViewport(col * px, row * px, px, px, 0, 1);
          pass.drawIndexed(m.index.length, 1, 0, 0, v);
        }
        pass.end();
        // (down 2 × 2 into the layer's first level, then each mip from the one above — the views stay in their cells: 64 … 4)
        for (const [src, at] of [
          [rtA, layer],
          [rtS, layer + IMPOSTOR_LAYERS],
        ] as const) {
          down(enc, src.createView(), level(at, 0), IMPOSTOR_SIZE);
          for (let mip = 1; mip < IMPOSTOR_TEX_MIPS; mip++) down(enc, level(at, mip - 1), level(at, mip), IMPOSTOR_SIZE >> mip);
        }
        d.queue.submit([enc.finish()]);
        layer++;
      }
    }
    // (V1 — the canopy's tiles, from the same models)
    this.stage = "canopy";
    await this.bakeCanopy(meshes, module, rtA, rtS, depth, upload, down, level);
    await d.queue.onSubmittedWorkDone();
    for (const b of buffers) b.destroy();
    rtA.destroy();
    rtS.destroy();
    depth.destroy();
    uni.destroy();
    this.bakeMs = performance.now() - t0;
    this.ready = true;
    this.stage = "ready";
  }

  /**
   * (V1) The canopy's tiles: a forest of the models on a jittered 9 × 9 grid over 64 m (the forest's 7 m cells, 85 % of them a tree),
   * their kinds, heights and crowns drawn as the forest draws them, seen from above, wrapping; into CANOPY_LAYER (albedo's terms)
   * and CANOPY_LAYER + CANOPY_TILES (surface), with their mips — the last a texel of 4 m.
   */
  private async bakeCanopy(
    meshes: { vp: GPUBuffer; vn: GPUBuffer; va: GPUBuffer; ib: GPUBuffer; count: number; kind: number; aspect: number }[],
    module: GPUShaderModule,
    rtA: GPUTexture,
    rtS: GPUTexture,
    depth: GPUTexture,
    upload: (data: Float32Array<ArrayBuffer>, usage: number) => GPUBuffer,
    down: (enc: GPUCommandEncoder, src: GPUTextureView, dst: GPUTextureView, size: number) => void,
    level: (layer: number, mip: number) => GPUTextureView,
  ) {
    const d = this.device;
    const pipe = await d.createRenderPipelineAsync({
      label: "tree canopy bake",
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vsTop",
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
          { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
          { arrayStride: 16, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x4" }] },
          {
            arrayStride: 24,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 3, offset: 0, format: "float32x4" },
              { shaderLocation: 4, offset: 16, format: "float32x2" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }, { format: "rgba8unorm" }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });
    // (a uniform a model: the leaf mask's kind)
    const groups = meshes.map((m) => {
      const u = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(u, 0, new Float32Array([0, m.kind, 1, 0]));
      return { u, g: d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: u } }] }) };
    });
    const heights: Record<number, [number, number]> = {
      [ForestKind.broadleaf]: [12, 24],
      [ForestKind.pine]: [10, 20],
      [ForestKind.conifer]: [14, 30],
    };
    const mixes: [number, number][][] = [
      [
        [ForestKind.broadleaf, 0.6],
        [ForestKind.pine, 0.4],
      ],
      [
        [ForestKind.conifer, 0.9],
        [ForestKind.pine, 0.1],
      ],
    ];
    const cell = CANOPY_TILE_M / CANOPY_GRID;
    for (let tile = 0; tile < CANOPY_TILES; tile++) {
      const rnd = treeRng(4099 + tile * 7);
      const per = new Map<number, number[]>();
      for (let j = 0; j < CANOPY_GRID; j++)
        for (let i = 0; i < CANOPY_GRID; i++) {
          if (rnd() > 0.85) continue;
          let pick = rnd();
          let kind = mixes[tile]![0]![0];
          for (const [k, w] of mixes[tile]!) {
            if (pick < w) {
              kind = k;
              break;
            }
            pick -= w;
          }
          const [lo, hi] = heights[kind]!;
          const H = lo + (hi - lo) * rnd();
          const r = cell * (0.3 + 0.17 * rnd());
          const a = TREE_ASPECTS[kind]!;
          const v = Math.abs(Math.log(r / H / a[1]!)) < Math.abs(Math.log(r / H / a[0]!)) ? 1 : 0;
          const mi = meshes.findIndex((m) => m.kind === kind && m.aspect === a[v]);
          const x = (i + 0.12 + 0.76 * rnd()) * cell,
            y = (j + 0.12 + 0.76 * rnd()) * cell,
            rot = rnd() * Math.PI * 2;
          const list = per.get(mi) ?? [];
          for (let oy = -1; oy <= 1; oy++)
            for (let ox = -1; ox <= 1; ox++) list.push(x + ox * CANOPY_TILE_M, y + oy * CANOPY_TILE_M, rot, 0, r / a[v]!, H);
          per.set(mi, list);
        }
      const enc = d.createCommandEncoder({ label: "tree canopy bake" });
      const pass = enc.beginRenderPass({
        colorAttachments: [
          { view: rtA.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] },
          { view: rtS.createView(), loadOp: "clear", storeOp: "store", clearValue: [0.5, 0.5, 0, 0] },
        ],
        depthStencilAttachment: { view: depth.createView(), depthLoadOp: "clear", depthStoreOp: "discard", depthClearValue: 1 },
      });
      pass.setPipeline(pipe);
      for (const [mi, list] of per) {
        const m = meshes[mi]!;
        const inst = upload(new Float32Array(list), GPUBufferUsage.VERTEX);
        pass.setBindGroup(0, groups[mi]!.g);
        pass.setVertexBuffer(0, m.vp);
        pass.setVertexBuffer(1, m.vn);
        pass.setVertexBuffer(2, m.va);
        pass.setVertexBuffer(3, inst);
        pass.setIndexBuffer(m.ib, "uint32");
        pass.drawIndexed(m.count, list.length / 6);
      }
      pass.end();
      for (const [src, at] of [
        [rtA, CANOPY_LAYER + tile],
        [rtS, CANOPY_LAYER + CANOPY_TILES + tile],
      ] as const) {
        down(enc, src.createView(), level(at, 0), IMPOSTOR_SIZE);
        for (let mip = 1; mip < IMPOSTOR_TEX_MIPS; mip++) down(enc, level(at, mip - 1), level(at, mip), IMPOSTOR_SIZE >> mip);
      }
      d.queue.submit([enc.finish()]);
    }
    await d.queue.onSubmittedWorkDone();
    for (const g of groups) g.u.destroy();
  }

  /**
   * A preview of a layer for the eyes (an e2e's shot): its 8 × 8 views lit by a fixed sun from the south-east, 40° up, and the sky —
   * its leaves the kind's green, its bark brown, the background transparent —, as a PNG data URL (needs a document).
   */
  async preview(layer: number, sun: [number, number, number] = [0.55, -0.45, 0.7]): Promise<string> {
    await this.bake();
    const d = this.device;
    const read = async (at: number) => {
      const bpr = IMPOSTOR_SIZE * 4;
      const buf = d.createBuffer({ size: bpr * IMPOSTOR_SIZE, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = d.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: this.texture, origin: [0, 0, at] }, { buffer: buf, bytesPerRow: bpr }, [
        IMPOSTOR_SIZE,
        IMPOSTOR_SIZE,
        1,
      ]);
      d.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const out = new Uint8Array(buf.getMappedRange().slice(0));
      buf.destroy();
      return out;
    };
    const A = await read(layer);
    const S = await read(layer >= CANOPY_LAYER ? layer + CANOPY_TILES : layer + IMPOSTOR_LAYERS);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = IMPOSTOR_SIZE;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(IMPOSTOR_SIZE, IMPOSTOR_SIZE);
    const l = Math.hypot(...sun);
    const L = sun.map((x) => x / l) as [number, number, number];
    for (let i = 0; i < IMPOSTOR_SIZE * IMPOSTOR_SIZE; i++) {
      const a = A[4 * i + 3]! / 255;
      if (a <= 0) continue;
      const ex = (S[4 * i]! / 255) * 2 - 1,
        ey = (S[4 * i + 1]! / 255) * 2 - 1;
      let nx = ex,
        ny = ey;
      const nz = 1 - Math.abs(ex) - Math.abs(ey);
      if (nz < 0) {
        nx = (1 - Math.abs(ey)) * Math.sign(ex || 1);
        ny = (1 - Math.abs(ex)) * Math.sign(ey || 1);
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      const ndl = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl);
      const leaf = A[4 * i + 1]! > 127;
      const shade = A[4 * i]! / 255;
      const base = leaf ? [0.09, 0.2, 0.05] : [0.22, 0.15, 0.1];
      const lit = (0.25 + 0.95 * ndl) * shade;
      const srgb = (x: number) => Math.round(255 * Math.min(1, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
      img.data[4 * i] = srgb(base[0]! * lit * 2.2);
      img.data[4 * i + 1] = srgb(base[1]! * lit * 2.2);
      img.data[4 * i + 2] = srgb(base[2]! * lit * 2.2);
      img.data[4 * i + 3] = Math.round(a * 255);
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
  }
}
