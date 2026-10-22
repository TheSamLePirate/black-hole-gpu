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

  /** Remakes tex's mips from its level 0 (a texture with RENDER_ATTACHMENT and TEXTURE_BINDING) — within `rects` alone
   *  when given ([x, y, w, h] of level 0, px: an atlas's cells redrawn — the rest of each level kept). */
  run(tex: GPUTexture, enc?: GPUCommandEncoder, rects?: [number, number, number, number][]) {
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
    lv.forEach(({ target, bind }, i) => {
      const l = i + 1;
      const W = Math.max(1, tex.width >> l),
        H = Math.max(1, tex.height >> l);
      const pass = e.beginRenderPass({
        colorAttachments: [{ view: target, loadOp: rects ? "load" : "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
      });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bind);
      if (!rects) pass.draw(3);
      else
        for (const [x, y, w, h] of rects) {
          const x0 = Math.min(x >> l, W - 1),
            y0 = Math.min(y >> l, H - 1);
          pass.setScissorRect(
            x0,
            y0,
            Math.max(1, Math.min(Math.ceil(w / 2 ** l), W - x0)),
            Math.max(1, Math.min(Math.ceil(h / 2 ** l), H - y0)),
          );
          pass.draw(3);
        }
      pass.end();
    });
    if (!enc) this.device.queue.submit([e.finish()]);
  }
}
