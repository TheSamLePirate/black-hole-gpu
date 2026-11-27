// Traffic lamps are rendered after the aircraft has written scene depth: no HTML glow over an opaque hull.
import shader from "../shaders/traffic-lights.wgsl" with { type: "text" };
export interface TrafficLamp {
  at: readonly number[];
  colour: readonly number[];
  size: number;
}
export class TrafficLightRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private uniform: GPUBuffer | null = null;
  private lamps: GPUBuffer | null = null;
  static readonly MAX = 256;
  constructor(private device: GPUDevice) {}
  encode(
    enc: GPUCommandEncoder,
    hdr: GPUTexture,
    depth: GPUBuffer,
    lamps: readonly TrafficLamp[],
    fov: number,
    mPerM: number,
    glow: number,
    stamp: GPUComputePassTimestampWrites | undefined = undefined,
    depthSize: readonly number[] = [hdr.width, hdr.height],
  ) {
    if (!lamps.length) return;
    const d = this.device;
    if (!this.pipeline) {
      const module = d.createShaderModule({ code: shader });
      this.pipeline = d.createRenderPipeline({
        label: "traffic lamps",
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: {
          module,
          entryPoint: "fs",
          targets: [
            {
              format: "rgba16float",
              blend: {
                color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
      });
      this.uniform = d.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.lamps = d.createBuffer({ size: TrafficLightRenderer.MAX * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    }
    const n = Math.min(TrafficLightRenderer.MAX, lamps.length),
      data = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      const l = lamps[i]!;
      data.set([l.at[0]!, l.at[1]!, l.at[2]!, l.size, l.colour[0]!, l.colour[1]!, l.colour[2]!, 0], i * 8);
    }
    const tan = Math.tan((fov * Math.PI) / 360);
    d.queue.writeBuffer(
      this.uniform!,
      0,
      new Float32Array([(tan * hdr.width) / hdr.height, tan, hdr.width, hdr.height, mPerM, glow, 0, 0, depthSize[0]!, depthSize[1]!, 0, 0]),
    );
    d.queue.writeBuffer(this.lamps!, 0, data);
    const bind = d.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform! } },
        { binding: 1, resource: { buffer: this.lamps! } },
        { binding: 2, resource: { buffer: depth } },
      ],
    });
    const pass = enc.beginRenderPass({
      label: "traffic lamps",
      colorAttachments: [{ view: hdr.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: "load", storeOp: "store" }],
      timestampWrites: stamp,
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(6, n);
    pass.end();
  }
}
