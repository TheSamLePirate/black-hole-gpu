// The sky chart's lines on the GPU (skychart.ts builds them, overlay.wgsl draws them): gathered in a
// texture of the output's size, then laid over the displayed image where the traced rays met the sky.

const SEG_FLOATS = 10;
/** (with depths — AM7's lines in space: each end's distance [M]) */
const SEG_FLOATS_D = 12;

export class ChartOverlay {
  /** the overlay's module (read back at start-up for its compilation messages) */
  readonly module: GPUShaderModule;
  private linePipe: GPURenderPipeline;
  private composites = new Map<GPUTextureFormat, GPURenderPipeline>();
  private ubuf: GPUBuffer;
  private vbuf: GPUBuffer | null = null;
  private cap = 0;
  private count = 0;
  private tex: GPUTexture | null = null;
  private noShip: GPUTexture;

  private segFloats: number;
  // (the magnetosphere's glowing layers — AM7 —: their parameters, their half-size target, the passes)
  private magU: GPUBuffer | null = null;
  private magData: Float32Array | null = null;
  private magTex: GPUTexture | null = null;
  private magPipe: GPURenderPipeline | null = null;
  private magComps = new Map<GPUTextureFormat, GPURenderPipeline>();
  private magSamp: GPUSampler | null = null;
  /** (code: overlay.wgsl's source; depth: lines in space, hidden behind what the traced rays met nearer — AM7) */
  constructor(
    private device: GPUDevice,
    code: string,
    private depth = false,
  ) {
    this.segFloats = depth ? SEG_FLOATS_D : SEG_FLOATS;
    this.module = device.createShaderModule({ code, label: depth ? "lines in space" : "sky chart" });
    this.ubuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.noShip = device.createTexture({ size: [1, 1], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING });
    this.linePipe = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: this.module,
        entryPoint: depth ? "vsLineD" : "vsLine",
        buffers: [
          {
            arrayStride: this.segFloats * 4,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x4" },
              { shaderLocation: 1, offset: 16, format: "float32x4" },
              { shaderLocation: 2, offset: 32, format: "float32x2" },
              ...(depth ? [{ shaderLocation: 3, offset: 40, format: "float32x2" as GPUVertexFormat }] : []),
            ],
          },
        ],
      },
      fragment: {
        module: this.module,
        entryPoint: depth ? "fsLineD" : "fsLine",
        // (a polyline's joints overlap: the strongest of them, not their sum)
        targets: [
          {
            format: "rgba8unorm",
            blend: {
              color: { operation: "max", srcFactor: "one", dstFactor: "one" },
              alpha: { operation: "max", srcFactor: "one", dstFactor: "one" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  /** the lines to draw from now on (skychart.ts's segments), none: null */
  set(segs: Float32Array | null, count: number) {
    this.count = segs ? count : 0;
    if (!segs || !count) return;
    if (count > this.cap) {
      this.vbuf?.destroy();
      this.cap = Math.max(1024, Math.ceil(count * 1.5));
      this.vbuf = this.device.createBuffer({ size: this.cap * this.segFloats * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    this.device.queue.writeBuffer(this.vbuf!, 0, segs.buffer, segs.byteOffset, count * this.segFloats * 4);
  }
  get active() {
    return this.count > 0 || !!this.magData;
  }
  /** the magnetosphere's layers (overlay.wgsl MagU, 44 floats; the depth mode's), none: null */
  setVolume(data: Float32Array | null) {
    this.magData = data;
  }
  private encodeVolume(
    enc: GPUCommandEncoder,
    out: GPUTextureView,
    format: GPUTextureFormat,
    outW: number,
    outH: number,
    view: number[],
    moments: GPUBuffer,
    imgW: number,
    imgH: number,
  ) {
    const d = this.device;
    // (at half the traced image's size: each texel its 2 × 2 block's ray and depth)
    const hw = Math.max(1, Math.ceil(imgW / 2)),
      hh = Math.max(1, Math.ceil(imgH / 2));
    if (!this.magTex || this.magTex.width !== hw || this.magTex.height !== hh) {
      this.magTex?.destroy();
      this.magTex = d.createTexture({
        size: [hw, hh],
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    this.magU ??= d.createBuffer({ size: 48 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.magSamp ??= d.createSampler({ magFilter: "linear", minFilter: "linear" });
    const u = new Float32Array(48);
    u.set(this.magData!.subarray(0, 32));
    u.set(view, 32);
    u.set([imgW, imgH, hw, hh, outW, outH, 0, 0], 36);
    d.queue.writeBuffer(this.magU, 0, u);
    this.magPipe ??= d.createRenderPipeline({
      layout: "auto",
      vertex: { module: this.module, entryPoint: "vsFull" },
      fragment: { module: this.module, entryPoint: "fsMagVol", targets: [{ format: "rgba16float" }] },
      primitive: { topology: "triangle-list" },
    });
    const p1 = enc.beginRenderPass({
      colorAttachments: [{ view: this.magTex.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
    });
    p1.setPipeline(this.magPipe);
    p1.setBindGroup(
      0,
      d.createBindGroup({
        layout: this.magPipe.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: { buffer: moments } },
          { binding: 5, resource: { buffer: this.magU } },
        ],
      }),
    );
    p1.draw(3);
    p1.end();
    let comp = this.magComps.get(format);
    if (!comp) {
      comp = d.createRenderPipeline({
        layout: "auto",
        vertex: { module: this.module, entryPoint: "vsFull" },
        fragment: {
          module: this.module,
          entryPoint: "fsMagComp",
          // (a glow: added over the image, what it covers dimmed by its alpha — premultiplied)
          targets: [
            {
              format,
              blend: {
                color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
      });
      this.magComps.set(format, comp);
    }
    const p2 = enc.beginRenderPass({ colorAttachments: [{ view: out, loadOp: "load", storeOp: "store" }] });
    p2.setPipeline(comp);
    p2.setBindGroup(
      0,
      d.createBindGroup({
        layout: comp.getBindGroupLayout(0),
        entries: [
          { binding: 5, resource: { buffer: this.magU } },
          { binding: 6, resource: this.magTex.createView() },
          { binding: 7, resource: this.magSamp },
        ],
      }),
    );
    p2.draw(3);
    p2.end();
  }

  private composite(format: GPUTextureFormat) {
    let p = this.composites.get(format);
    if (!p) {
      p = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module: this.module, entryPoint: "vsFull" },
        fragment: {
          module: this.module,
          entryPoint: "fsComposite",
          targets: [
            {
              format,
              blend: {
                color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
      });
      this.composites.set(format, p);
    }
    return p;
  }

  /**
   * Draws the lines over `out` (its format, size): the image in it at uv·(sx, sy) + (ox, oy), traced at
   * imgW × imgH with its rays' depths in `moments` (the sky only where they escaped); the lines' widths ×
   * widthScale; not over the Ranger (its image and its box in the traced image's pixels).
   */
  encode(
    enc: GPUCommandEncoder,
    out: GPUTextureView,
    format: GPUTextureFormat,
    outW: number,
    outH: number,
    view: [number, number, number, number],
    moments: GPUBuffer,
    imgW: number,
    imgH: number,
    widthScale = 1,
    ship: { view: GPUTextureView; rect: number[] } | null = null,
  ) {
    if (this.magData) this.encodeVolume(enc, out, format, outW, outH, view, moments, imgW, imgH);
    if (!this.count || !this.vbuf) return;
    const d = this.device;
    if (!this.tex || this.tex.width !== outW || this.tex.height !== outH) {
      this.tex?.destroy();
      this.tex = d.createTexture({
        size: [outW, outH],
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    d.queue.writeBuffer(
      this.ubuf,
      0,
      // (out.z: the sky only — the chart —; lines in space are tested against the depth instead)
      new Float32Array([outW, outH, this.depth ? 0 : 1, widthScale, ...view, imgW, imgH, 0, 0, ...(ship?.rect ?? [0, 0, 0, 0])]),
    );
    const lines = enc.beginRenderPass({
      colorAttachments: [{ view: this.tex.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
    });
    lines.setPipeline(this.linePipe);
    lines.setBindGroup(
      0,
      d.createBindGroup({
        layout: this.linePipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.ubuf } }, ...(this.depth ? [{ binding: 1, resource: { buffer: moments } }] : [])],
      }),
    );
    lines.setVertexBuffer(0, this.vbuf);
    lines.draw(6, this.count);
    lines.end();
    const pipe = this.composite(format);
    const comp = enc.beginRenderPass({ colorAttachments: [{ view: out, loadOp: "load", storeOp: "store" }] });
    comp.setPipeline(pipe);
    comp.setBindGroup(
      0,
      d.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.ubuf } },
          { binding: 1, resource: { buffer: moments } },
          { binding: 2, resource: this.tex.createView() },
          { binding: 3, resource: ship?.view ?? this.noShip.createView() },
        ],
      }),
    );
    comp.draw(3);
    comp.end();
  }
}
