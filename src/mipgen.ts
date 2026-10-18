// A texture's mips made on the GPU (shaders/mips.wgsl): a render pass a level, each the mean of the one above. The
// canvases drawn as textures (the F-35's panoramic display, the cabin's screens) used to be halved on canvases and
// copied level by level — a few milliseconds of the processor's at each drawing (docs/PLAN-PCD-AAA.md, Q1).
import mipsWGSL from "./shaders/mips.wgsl" with { type: "text" };

export class MipGen {
  private pipes = new Map<GPUTextureFormat, GPURenderPipeline>();
  private samp: GPUSampler;
  private module: GPUShaderModule;
  /** each texture's passes: a level's target and the bind group reading the level above */
  private levels = new WeakMap<GPUTexture, { target: GPUTextureView; bind: GPUBindGroup }[]>();

  constructor(private device: GPUDevice) {
    this.module = device.createShaderModule({ code: mipsWGSL, label: "mips" });
    this.samp = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  }

  private desc(format: GPUTextureFormat): GPURenderPipelineDescriptor {
    return {
      label: `mips ${format}`,
      layout: "auto",
      vertex: { module: this.module, entryPoint: "vs" },
      fragment: { module: this.module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    };
  }

  private pipe(format: GPUTextureFormat) {
    let p = this.pipes.get(format);
    if (!p) {
      p = this.device.createRenderPipeline(this.desc(format));
      this.pipes.set(format, p);
    }
    return p;
  }

  /** Compiles the pipeline ahead of its first use (off the frame). */
  async warm(format: GPUTextureFormat) {
    if (this.pipes.has(format)) return;
    const p = await this.device.createRenderPipelineAsync(this.desc(format));
    if (!this.pipes.has(format)) this.pipes.set(format, p);
  }

  /** Remakes tex's mips from its level 0 (a texture with RENDER_ATTACHMENT and TEXTURE_BINDING). */
  run(tex: GPUTexture, enc?: GPUCommandEncoder) {
    const pipe = this.pipe(tex.format);
    let lv = this.levels.get(tex);
    if (!lv) {
      lv = [];
      for (let l = 1; l < tex.mipLevelCount; l++)
        lv.push({
          target: tex.createView({ baseMipLevel: l, mipLevelCount: 1 }),
          bind: this.device.createBindGroup({
            layout: pipe.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: tex.createView({ baseMipLevel: l - 1, mipLevelCount: 1 }) },
              { binding: 1, resource: this.samp },
            ],
          }),
        });
      this.levels.set(tex, lv);
    }
    const e = enc ?? this.device.createCommandEncoder({ label: "mips" });
    for (const { target, bind } of lv) {
      const pass = e.beginRenderPass({ colorAttachments: [{ view: target, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
    }
    if (!enc) this.device.queue.submit([e.finish()]);
  }
}
