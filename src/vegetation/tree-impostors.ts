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

import { TREE_ASPECTS, TREE_MODEL_KINDS, type TreeMesh, treeModel } from "./tree-model";

export const IMPOSTOR_VIEWS = 8;
export const IMPOSTOR_VIEW_PX = 64;
export const IMPOSTOR_SIZE = IMPOSTOR_VIEWS * IMPOSTOR_VIEW_PX;
/** the layers: two a kind (wide, slender), in TREE_MODEL_KINDS's order */
export const IMPOSTOR_LAYERS = TREE_MODEL_KINDS.length * 2;
export const IMPOSTOR_MIPS = 5;

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

/**
 * The impostors' bake and textures: the twelve models rendered once on the device — on the first ask (V2c draws them; until then
 * they are made for the preview alone: `__bh.renderer` has no frame cost from them).
 */
export class TreeImpostors {
  albedo: GPUTexture | null = null;
  surface: GPUTexture | null = null;
  bakeMs = 0;
  models: { kind: number; aspect: number; leaves: number; tris: number; radius: number }[] = [];
  private baking: Promise<void> | null = null;

  constructor(private device: GPUDevice) {}

  /** Bakes them (once). */
  bake(): Promise<void> {
    this.baking ??= this.run();
    return this.baking;
  }

  private async run() {
    const d = this.device;
    const t0 = performance.now();
    const big = IMPOSTOR_SIZE * 2;
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;
    const mk = (label: string) =>
      d.createTexture({ label, size: [IMPOSTOR_SIZE, IMPOSTOR_SIZE, IMPOSTOR_LAYERS], format: "rgba8unorm", usage, mipLevelCount: 1 });
    const albedo = mk("tree impostors: albedo");
    const surface = mk("tree impostors: surface");
    const rtUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const rtA = d.createTexture({ label: "tree impostor bake A", size: [big, big], format: "rgba8unorm", usage: rtUsage });
    const rtS = d.createTexture({ label: "tree impostor bake S", size: [big, big], format: "rgba8unorm", usage: rtUsage });
    const depth = d.createTexture({ size: [big, big], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
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
    let layer = 0;
    this.models = [];
    for (const kind of TREE_MODEL_KINDS) {
      for (const aspect of TREE_ASPECTS[kind]!) {
        const m: TreeMesh = treeModel(kind, aspect, 1);
        this.models.push({ kind, aspect, leaves: m.leaves, tris: m.index.length / 3, radius: m.radius });
        const half = Math.sqrt(m.radius * m.radius + 0.25);
        d.queue.writeBuffer(uni, 0, new Float32Array([m.radius, kind, half, 0]));
        const V = GPUBufferUsage.VERTEX;
        const vp = upload(m.pos, V),
          vn = upload(m.nrm, V),
          va = upload(m.attr, V),
          ib = upload(m.index, GPUBufferUsage.INDEX);
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
        // (down 2 × 2 into the layer)
        const cp = enc.beginComputePass({ label: "tree impostor down" });
        cp.setPipeline(downPipe);
        for (const [src, dst] of [
          [rtA, albedo],
          [rtS, surface],
        ] as const) {
          cp.setBindGroup(
            0,
            d.createBindGroup({
              layout: downPipe.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: src.createView() },
                { binding: 1, resource: dst.createView({ dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1 }) },
              ],
            }),
          );
          cp.dispatchWorkgroups(IMPOSTOR_SIZE / 8, IMPOSTOR_SIZE / 8);
        }
        cp.end();
        d.queue.submit([enc.finish()]);
        layer++;
      }
    }
    await d.queue.onSubmittedWorkDone();
    for (const b of buffers) b.destroy();
    rtA.destroy();
    rtS.destroy();
    depth.destroy();
    uni.destroy();
    this.albedo = albedo;
    this.surface = surface;
    this.bakeMs = performance.now() - t0;
  }

  /**
   * A preview of a layer for the eyes (an e2e's shot): its 8 × 8 views lit by a fixed sun from the south-east, 40° up, and the sky —
   * its leaves the kind's green, its bark brown, the background transparent —, as a PNG data URL (needs a document).
   */
  async preview(layer: number, sun: [number, number, number] = [0.55, -0.45, 0.7]): Promise<string> {
    await this.bake();
    const d = this.device;
    const read = async (tex: GPUTexture) => {
      const bpr = IMPOSTOR_SIZE * 4;
      const buf = d.createBuffer({ size: bpr * IMPOSTOR_SIZE, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = d.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: tex, origin: [0, 0, layer] }, { buffer: buf, bytesPerRow: bpr }, [
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
    const A = await read(this.albedo!);
    const S = await read(this.surface!);
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
