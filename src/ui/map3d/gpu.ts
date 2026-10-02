// The map on the GPU: textured, lit spheres, the orbits and paths, under the map's 2D overlay (its marks,
// labels, handles). Each body a quad on the screen, its pixels' view rays meeting the true sphere (perspective
// right, a planet filling the view as well as a dot): the tracer's own maps sampled on the body's axes —
// the planets' and moons' equirectangular maps, the Earth's day, clouds and city lights —, Gargantua's
// worlds drawn as the tracer draws them (Miller's water, Mann's ice, Edmunds' plateaus); lit by their
// star, their air's rim glowing, Saturn's rings, the stars burning, Gargantua's horizon, its disk and its
// photon ring; a field of stars behind. The orbits and paths: anti-aliased lines of any width, dashed,
// faded along, hidden pixel by pixel where a body stands in front of them (the bodies' depth drawn
// first). The ground track's planisphere: the same surfaces laid out in longitude and latitude. The
// device is the tracer's (no second one), its maps bound as they are — nothing loaded twice.

import mapWGSL from "../../shaders/map.wgsl" with { type: "text" };

export type V3 = [number, number, number];

/** What a body is drawn as. */
export const enum BodyKind {
  /** a world with a map (the tracer's arrays) */
  Map = 0,
  /** the Earth: its day (clouds), its night */
  Earth = 1,
  Star = 2,
  /** Gargantua: its horizon, its disk, its photon ring */
  Hole = 3,
  /** the wormhole's mouth */
  Mouth = 4,
  /** one of Gargantua's worlds, drawn like the tracer's (proc: 0 Miller, 1 Mann, 2 Edmunds) */
  Proc = 5,
  /** a world without a map: its colour, its bands */
  Plain = 6,
}

/** A body to draw this frame (view space: x right, y up, z forward; map units). */
export interface GpuBody {
  /** centre, radius (view space) */
  c: V3;
  R: number;
  kind: BodyKind;
  /** the map's layer: ≥ 0 in the large array, < 0: −(index + 1) in the small one */
  layer?: number;
  proc?: number;
  /** towards the light (view space, unit) */
  L: V3;
  /** the body's own axes in view space (x: longitude 0, z: its pole) */
  ax: [V3, V3, V3];
  /** base colour (linear rgb) */
  col: V3;
  /** the air: its rim's colour (linear) and strength (0: none) */
  air?: { col: V3; k: number };
  /** rings (× R): inner, outer */
  rings?: [number, number];
  /** the least radius drawn [px] (a dot that stays visible) */
  minPx: number;
  /** the night side's least light (0 … 1: a globe read in the dark; the map's, near 0) */
  night?: number;
}

const FLOATS = 32;
const MAX = 256;
/** Floats per line segment (Seg in map.wgsl). */
const SEG = 20;

export interface MapTextures {
  hi: GPUTexture;
  lo: GPUTexture;
  rings: GPUTexture;
  earthDay: GPUTexture;
  earthNight: GPUTexture;
}

/** A CSS colour ("r, g, b", "rgb(…)", "rgba(…)", "#rgb", "#rrggbb") as display rgb (0 … 1) and alpha. */
export function cssColour(s: string): [number, number, number, number] {
  const t = s.trim();
  if (t[0] === "#") {
    const h = t.length === 4 ? [...t.slice(1)].map((c) => c + c).join("") : t.slice(1, 7);
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, 1];
  }
  const m = /\(([^)]*)\)/.exec(t);
  const v = (m ? m[1]! : t).split(",").map((x) => parseFloat(x));
  return [(v[0] ?? 255) / 255, (v[1] ?? 255) / 255, (v[2] ?? 255) / 255, v[3] ?? 1];
}

const srgbView = (t: GPUTexture, dimension: GPUTextureViewDimension) => t.createView({ dimension, ...(t.format === "rgba8unorm" ? { format: "rgba8unorm-srgb" as GPUTextureFormat } : {}) });

export class MapGpu {
  readonly canvas = document.createElement("canvas");
  private ctx: GPUCanvasContext;
  private format: GPUTextureFormat;
  private bodyPipe!: GPURenderPipeline;
  private depthPipe!: GPURenderPipeline;
  private skyPipe!: GPURenderPipeline;
  private linePipe!: GPURenderPipeline;
  private planiPipe!: GPURenderPipeline;
  private uniform: GPUBuffer;
  private inst: GPUBuffer;
  private data = new Float32Array(MAX * FLOATS);
  private sampler: GPUSampler;
  private bind: { group: GPUBindGroup; plani: GPUBindGroup; key: MapTextures } | null = null;
  private skyBind!: GPUBindGroup;
  private depthBind!: GPUBindGroup;
  private n = 0;
  // the lines: their segments (grown as needed), the buffer and its bind group
  private segs = new Float32Array(4096 * SEG);
  private nSeg = 0;
  private segBuf: GPUBuffer | null = null;
  private lineBind: GPUBindGroup | null = null;
  private depth: GPUTexture | null = null;
  private colours = new Map<string, [number, number, number, number]>();
  // the line being drawn: its style, its last point, its length so far, its last segment
  private ln = { r: 1, g: 1, b: 1, hw: 0.5, k: 1, on: 0, off: 0, x: 0, y: 0, iz: 0, a: 0, s: 0, has: false, last: -1 };
  /** the planisphere this frame: its rectangle [px] (the first body is the world) */
  private rect: [number, number, number, number] | null = null;
  /** Its pipelines being built, built, or not to be had (a shader refused: the map draws in 2D). */
  status: "pending" | "ok" | "failed" = "pending";

  constructor(private device: GPUDevice, private textures: () => MapTextures | null) {
    this.canvas.className = "m3-gpu";
    this.ctx = this.canvas.getContext("webgpu")!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format: this.format, alphaMode: "premultiplied" });
    this.uniform = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.inst = device.createBuffer({ size: this.data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat", addressModeV: "clamp-to-edge", maxAnisotropy: 8 });
    void this.build();
  }

  /** The pipelines, checked: a shader's error, a pipeline refused — the layer given up. */
  private async build() {
    const device = this.device;
    try {
      // (a development server may hand the shader over by its URL rather than its text: fetched then)
      const code = mapWGSL.includes("@fragment") ? mapWGSL : await (await fetch(mapWGSL)).text();
      device.pushErrorScope("validation");
      const module = device.createShaderModule({ code, label: "map" });
      const blend: GPUBlendState = {
        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      };
      const target = [{ format: this.format, blend }];
      // (one pass, one depth buffer: the sky and the bodies' colours ignore it, the bodies' depth fills
      // it, the lines are tested against it)
      const ds = (write: boolean, compare: GPUCompareFunction): GPUDepthStencilState => ({ format: "depth32float", depthWriteEnabled: write, depthCompare: compare });
      const tri: GPUPrimitiveState = { topology: "triangle-list" };
      this.bodyPipe = device.createRenderPipeline({
        label: "map: bodies", layout: "auto", primitive: tri, depthStencil: ds(false, "always"),
        vertex: { module, entryPoint: "bodyVs" },
        fragment: { module, entryPoint: "bodyFs", targets: target },
      });
      this.depthPipe = device.createRenderPipeline({
        label: "map: the bodies' depth", layout: "auto", primitive: tri, depthStencil: ds(true, "less"),
        vertex: { module, entryPoint: "bodyVs" },
        fragment: { module, entryPoint: "bodyDepthFs", targets: [{ format: this.format, writeMask: 0 }] },
      });
      this.skyPipe = device.createRenderPipeline({
        label: "map: stars", layout: "auto", primitive: tri, depthStencil: ds(false, "always"),
        vertex: { module, entryPoint: "skyVs" },
        fragment: { module, entryPoint: "skyFs", targets: target },
      });
      this.linePipe = device.createRenderPipeline({
        label: "map: lines", layout: "auto", primitive: tri, depthStencil: ds(false, "less-equal"),
        vertex: { module, entryPoint: "lineVs" },
        fragment: { module, entryPoint: "lineFs", targets: target },
      });
      this.planiPipe = device.createRenderPipeline({
        label: "map: planisphere", layout: "auto", primitive: tri, depthStencil: ds(false, "always"),
        vertex: { module, entryPoint: "planiVs" },
        fragment: { module, entryPoint: "planiFs", targets: target },
      });
      this.skyBind = device.createBindGroup({ layout: this.skyPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
      this.depthBind = device.createBindGroup({ layout: this.depthPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniform } }, { binding: 1, resource: { buffer: this.inst } }] });
      const err = await device.popErrorScope();
      if (err) throw new Error(err.message);
      this.status = "ok";
    } catch (e) {
      console.warn("The map's GPU layer: none —", e);
      this.status = "failed";
    }
  }

  /** The frame's bodies (back to front), lines, planisphere: none yet. */
  begin() {
    this.n = 0;
    this.nSeg = 0;
    this.ln.has = false;
    this.rect = null;
  }
  body(b: GpuBody) {
    if (this.n >= MAX) return;
    const o = this.n * FLOATS;
    const d = this.data;
    const ax = b.ax;
    d.set([b.c[0], b.c[1], b.c[2], b.R,
      b.kind, b.layer ?? 0, b.air ? 1 : 0, b.rings?.[0] ?? 0,
      b.L[0], b.L[1], b.L[2], b.rings?.[1] ?? 0,
      ax[0][0], ax[0][1], ax[0][2], b.proc ?? 0,
      ax[1][0], ax[1][1], ax[1][2], b.night ?? 0,
      ax[2][0], ax[2][1], ax[2][2], b.minPx,
      b.col[0], b.col[1], b.col[2], b.air?.k ?? 0,
      b.air?.col[0] ?? 0, b.air?.col[1] ?? 0, b.air?.col[2] ?? 0, 0], o);
    this.n++;
  }

  /**
   * A line starts: its colour (CSS; its alpha multiplies the points'), its width [px], its dashes
   * (dash, gap [px]; none: solid). Then its points (`to`), broken where it is hidden (`gap`).
   */
  line(col: string, width: number, dash?: readonly number[]) {
    this.gap();
    let c = this.colours.get(col);
    if (!c) this.colours.set(col, (c = cssColour(col)));
    const [r, g, b, a] = c;
    const L = this.ln;
    L.r = r, L.g = g, L.b = b;
    // (a line thinner than a pixel: a pixel wide, fainter)
    L.hw = Math.max(width, 1) / 2;
    L.k = a * Math.min(width, 1);
    L.on = dash && dash.length >= 2 && dash[0]! > 0 ? dash[0]! : 0;
    L.off = L.on ? dash![1]! : 0;
    L.s = 0;
  }
  /** The line's next point: on the screen [px], its view depth (0: drawn over everything), its alpha. */
  to(x: number, y: number, z: number, a: number) {
    const L = this.ln;
    const iz = z > 0 ? 1 / z : 0;
    if (L.has) {
      const len = Math.hypot(x - L.x, y - L.y);
      if (len > 0.05) {
        if (this.nSeg * SEG >= this.segs.length) {
          const grown = new Float32Array(this.segs.length * 2);
          grown.set(this.segs);
          this.segs = grown;
        }
        // (written in place: thousands a frame, no array made for each)
        const o = this.nSeg * SEG, d = this.segs;
        d[o] = L.x, d[o + 1] = L.y, d[o + 2] = L.iz, d[o + 3] = L.s;
        d[o + 4] = x, d[o + 5] = y, d[o + 6] = iz, d[o + 7] = L.s + len;
        d[o + 8] = L.r, d[o + 9] = L.g, d[o + 10] = L.b, d[o + 11] = 1;
        d[o + 12] = L.a * L.k, d[o + 13] = a * L.k, d[o + 14] = L.hw, d[o + 15] = 0;
        d[o + 16] = L.on, d[o + 17] = L.off, d[o + 18] = 0, d[o + 19] = 0;
        L.last = this.nSeg++;
        L.s += len;
      } else return;
    }
    L.x = x, L.y = y, L.iz = iz, L.a = a, L.has = true;
  }
  /** The line broken here (behind the camera, across the planisphere's edge): its end capped. */
  gap() {
    const L = this.ln;
    if (L.has && L.last >= 0) this.segs[L.last * SEG + 15] = 1;
    L.has = false;
    L.last = -1;
  }

  /** The planisphere this frame: the first body's surface (its axes the identity, its light in its own
   *  frame) laid out in the rectangle [px]. */
  planisphere(rect: [number, number, number, number]) {
    this.rect = rect;
  }

  /**
   * Draws the frame: the canvas as large as the overlay [px], the camera — its focal length [px], the
   * view's centre [px], its axes in the world (the stars behind) —, the time (the stars' twinkle); the
   * depths the lines are hidden between (near, far: the view's), the stars or not.
   */
  render(w: number, h: number, f: number, cx: number, cy: number, axes: [V3, V3, V3], time: number, opt: { near?: number; far?: number; sky?: boolean } = {}) {
    if (this.status !== "ok") return;
    this.gap();
    const c = this.canvas;
    if (c.width !== w || c.height !== h) (c.width = w), (c.height = h);
    const T = this.textures();
    const dev = this.device;
    const near = opt.near ?? 1e-3, far = opt.far ?? near * 1e12;
    const ln = Math.log2(near), kz = 1 / Math.max(Math.log2(far) - ln, 1e-6);
    const r = this.rect ?? [0, 0, 1, 1];
    dev.queue.writeBuffer(this.uniform, 0, new Float32Array([w, h, f, time, cx, cy, ln, kz, ...axes[0], 0, ...axes[1], 0, ...axes[2], 0, ...r]));
    if (this.n) dev.queue.writeBuffer(this.inst, 0, this.data, 0, this.n * FLOATS);
    if (T && (!this.bind || this.bind.key.hi !== T.hi || this.bind.key.lo !== T.lo || this.bind.key.earthDay !== T.earthDay || this.bind.key.earthNight !== T.earthNight || this.bind.key.rings !== T.rings)) {
      const tex = (layout: GPUBindGroupLayout, all: boolean) => dev.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: { buffer: this.inst } },
          { binding: 2, resource: srgbView(T.hi, "2d-array") },
          { binding: 3, resource: srgbView(T.lo, "2d-array") },
          ...(all ? [{ binding: 4, resource: T.rings.createView({ dimension: "2d", ...(T.rings.format === "rgba8unorm" ? { format: "rgba8unorm-srgb" } : {}) }) as GPUTextureView }] : []),
          { binding: 5, resource: srgbView(T.earthDay, "cube") },
          { binding: 6, resource: T.earthNight.createView({ dimension: "cube" }) },
          { binding: 7, resource: this.sampler },
        ],
      });
      this.bind = { key: { ...T }, group: tex(this.bodyPipe.getBindGroupLayout(0), true), plani: tex(this.planiPipe.getBindGroupLayout(0), false) };
    }
    // the lines' buffer, grown with them
    if (this.nSeg) {
      const bytes = this.nSeg * SEG * 4;
      if (!this.segBuf || this.segBuf.size < bytes) {
        this.segBuf?.destroy();
        this.segBuf = dev.createBuffer({ size: Math.max(bytes, this.segs.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.lineBind = dev.createBindGroup({ layout: this.linePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniform } }, { binding: 8, resource: { buffer: this.segBuf } }] });
      }
      dev.queue.writeBuffer(this.segBuf, 0, this.segs, 0, this.nSeg * SEG);
    }
    if (!this.depth || this.depth.width !== w || this.depth.height !== h) {
      this.depth?.destroy();
      this.depth = dev.createTexture({ size: [w, h], format: "depth32float", usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    const enc = dev.createCommandEncoder({ label: "map" });
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
      depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    if (this.rect && this.n && this.bind) {
      pass.setPipeline(this.planiPipe);
      pass.setBindGroup(0, this.bind.plani);
      pass.draw(6);
    } else {
      if (opt.sky !== false) {
        pass.setPipeline(this.skyPipe);
        pass.setBindGroup(0, this.skyBind);
        pass.draw(3);
      }
      if (this.n && this.bind) {
        pass.setPipeline(this.depthPipe);
        pass.setBindGroup(0, this.depthBind);
        pass.draw(6, this.n);
        pass.setPipeline(this.bodyPipe);
        pass.setBindGroup(0, this.bind.group);
        pass.draw(6, this.n);
      }
    }
    if (this.nSeg && this.lineBind) {
      pass.setPipeline(this.linePipe);
      pass.setBindGroup(0, this.lineBind);
      pass.draw(6, this.nSeg);
    }
    pass.end();
    dev.queue.submit([enc.finish()]);
  }
}
