// The sky chart's lines on the GPU (skychart.ts builds them, overlay.wgsl draws them): gathered in a
// texture of the output's size, then laid over the displayed image where the traced rays met the sky.

const SEG_FLOATS = 10;

export class ChartOverlay {
  private module: GPUShaderModule;
  private linePipe: GPURenderPipeline;
  private composites = new Map<GPUTextureFormat, GPURenderPipeline>();
  private ubuf: GPUBuffer;
  private vbuf: GPUBuffer | null = null;
  private cap = 0;
  private count = 0;
  private tex: GPUTexture | null = null;
  private noShip: GPUTexture;

  /** (code: overlay.wgsl's source) */
  constructor(
    private device: GPUDevice,
    code: string,
  ) {
    this.module = device.createShaderModule({ code, label: "sky chart" });
    this.ubuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.noShip = device.createTexture({ size: [1, 1], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING });
    this.linePipe = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: this.module,
        entryPoint: "vsLine",
        buffers: [
          {
            arrayStride: SEG_FLOATS * 4,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x4" },
              { shaderLocation: 1, offset: 16, format: "float32x4" },
              { shaderLocation: 2, offset: 32, format: "float32x2" },
            ],
          },
        ],
      },
      fragment: {
        module: this.module,
        entryPoint: "fsLine",
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
      this.vbuf = this.device.createBuffer({ size: this.cap * SEG_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    this.device.queue.writeBuffer(this.vbuf!, 0, segs.buffer, segs.byteOffset, count * SEG_FLOATS * 4);
  }
  get active() {
    return this.count > 0;
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
      new Float32Array([outW, outH, 1, widthScale, ...view, imgW, imgH, 0, 0, ...(ship?.rect ?? [0, 0, 0, 0])]),
    );
    const lines = enc.beginRenderPass({
      colorAttachments: [{ view: this.tex.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
    });
    lines.setPipeline(this.linePipe);
    lines.setBindGroup(
      0,
      d.createBindGroup({ layout: this.linePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.ubuf } }] }),
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
