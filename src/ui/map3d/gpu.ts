// The map's bodies on the GPU: textured, lit spheres under the map's 2D overlay (its orbits, paths,
// labels). Each body a quad on the screen, its pixels' view rays meeting the true sphere (perspective
// right, a planet filling the view as well as a dot): the tracer's own maps sampled on the body's axes —
// the planets' and moons' equirectangular maps, the Earth's day, clouds and city lights —, Gargantua's
// worlds drawn as the tracer draws them (Miller's water, Mann's ice, Edmunds' plateaus); lit by their
// star, their air's rim glowing, Saturn's rings, the stars burning, Gargantua's horizon, its disk and its
// photon ring; a field of stars behind. The device is the tracer's (no second one), its maps bound as
// they are — nothing loaded twice.

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

export interface MapTextures {
  hi: GPUTexture;
  lo: GPUTexture;
  rings: GPUTexture;
  earthDay: GPUTexture;
  earthNight: GPUTexture;
}

const srgbView = (t: GPUTexture, dimension: GPUTextureViewDimension) => t.createView({ dimension, ...(t.format === "rgba8unorm" ? { format: "rgba8unorm-srgb" as GPUTextureFormat } : {}) });

export class MapGpu {
  readonly canvas = document.createElement("canvas");
  private ctx: GPUCanvasContext;
  private format: GPUTextureFormat;
  private bodyPipe!: GPURenderPipeline;
  private skyPipe!: GPURenderPipeline;
  private uniform: GPUBuffer;
  private inst: GPUBuffer;
  private data = new Float32Array(MAX * FLOATS);
  private sampler: GPUSampler;
  private bind: { group: GPUBindGroup; key: MapTextures } | null = null;
  private skyBind!: GPUBindGroup;
  private n = 0;
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
      this.bodyPipe = device.createRenderPipeline({
        label: "map: bodies", layout: "auto",
        vertex: { module, entryPoint: "bodyVs" },
        fragment: { module, entryPoint: "bodyFs", targets: [{ format: this.format, blend }] },
        primitive: { topology: "triangle-list" },
      });
      this.skyPipe = device.createRenderPipeline({
        label: "map: stars", layout: "auto",
        vertex: { module, entryPoint: "skyVs" },
        fragment: { module, entryPoint: "skyFs", targets: [{ format: this.format, blend }] },
        primitive: { topology: "triangle-list" },
      });
      this.skyBind = device.createBindGroup({ layout: this.skyPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
      const err = await device.popErrorScope();
      if (err) throw new Error(err.message);
      this.status = "ok";
    } catch (e) {
      console.warn("The map's GPU layer: none —", e);
      this.status = "failed";
    }
  }

  /** The frame's bodies, back to front. */
  begin() {
    this.n = 0;
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
   * Draws the frame: the canvas as large as the overlay [px], the camera — its focal length [px], the
   * view's centre [px], its axes in the world (the stars behind) —, the time (the stars' twinkle).
   */
  render(w: number, h: number, f: number, cx: number, cy: number, axes: [V3, V3, V3], time: number) {
    if (this.status !== "ok") return;
    const c = this.canvas;
    if (c.width !== w || c.height !== h) (c.width = w), (c.height = h);
    const T = this.textures();
    const dev = this.device;
    dev.queue.writeBuffer(this.uniform, 0, new Float32Array([w, h, f, time, cx, cy, 0, 0, ...axes[0], 0, ...axes[1], 0, ...axes[2], 0]));
    if (this.n) dev.queue.writeBuffer(this.inst, 0, this.data, 0, this.n * FLOATS);
    if (T && (!this.bind || this.bind.key.hi !== T.hi || this.bind.key.lo !== T.lo || this.bind.key.earthDay !== T.earthDay || this.bind.key.earthNight !== T.earthNight || this.bind.key.rings !== T.rings)) {
      this.bind = {
        key: { ...T },
        group: dev.createBindGroup({
          layout: this.bodyPipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.uniform } },
            { binding: 1, resource: { buffer: this.inst } },
            { binding: 2, resource: srgbView(T.hi, "2d-array") },
            { binding: 3, resource: srgbView(T.lo, "2d-array") },
            { binding: 4, resource: T.rings.createView({ dimension: "2d", ...(T.rings.format === "rgba8unorm" ? { format: "rgba8unorm-srgb" } : {}) }) },
            { binding: 5, resource: srgbView(T.earthDay, "cube") },
            { binding: 6, resource: T.earthNight.createView({ dimension: "cube" }) },
            { binding: 7, resource: this.sampler },
          ],
        }),
      };
    }
    const enc = dev.createCommandEncoder({ label: "map" });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(this.skyPipe);
    pass.setBindGroup(0, this.skyBind);
    pass.draw(3);
    if (this.n && this.bind) {
      pass.setPipeline(this.bodyPipe);
      pass.setBindGroup(0, this.bind.group);
      pass.draw(6, this.n);
    }
    pass.end();
    dev.queue.submit([enc.finish()]);
  }
}
