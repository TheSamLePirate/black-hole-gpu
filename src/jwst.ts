// The James Webb Space Telescope (assets/jwst/jwst.bin, built by scripts/build-jwst.ts) rendered on
// its Sun–Earth L2 Halo orbit (system/jwst.ts). Same WebGPU architecture as StationRenderer (station.ts):
// 4× MSAA depth-tested box + 2048×2048 Sun shadow map, composited into hdr before bloom.
import jwstUrl from "../assets/jwst/jwst.bin";

import type { Vec3 } from "./physics";
import { JWST_RADIUS_M } from "./system/jwst";

const STRIDE = 24;
const SHADOW = 2048;

interface Mesh {
  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  count: number;
  reach: number;
}
interface Box {
  w: number;
  h: number;
  color: GPUTexture;
  depthColor: GPUTexture;
  depth: GPUTexture;
  resColor: GPUTexture;
  resDepth: GPUTexture;
  comp?: GPUBindGroup;
}

export interface JwstView {
  /** JWST centre from the camera [m], and its axes [ex, ey, ez] in camera frame */
  rel: Vec3;
  axes: [Vec3, Vec3, Vec3];
  /** towards the Sun (camera frame), its angular radius, its irradiance (tracer units) */
  sun: Vec3;
  sunRadius: number;
  sunE: Vec3;
  tanH: number;
  aspect: number;
  pre: number;
  mPerM: number;
}

export class JwstRenderer {
  readonly module: GPUShaderModule;
  ready = false;
  private mesh: Mesh | null = null;
  private fetching: Promise<void> | null = null;
  private uniform: GPUBuffer;
  private pipe: GPURenderPipeline;
  private shadowPipe: GPURenderPipeline;
  private comp: GPURenderPipeline;
  private shadowTex: GPUTexture;
  private bind: { g: GPUBindGroup; sceneDepth: GPUBuffer } | null = null;
  private shadowBind: GPUBindGroup;
  private box: Box | null = null;
  rect: [number, number, number, number] = [0, 0, 0, 0];

  depthTexture(): GPUTexture | null {
    return this.rect[2] > 0 ? (this.box?.resDepth ?? null) : null;
  }

  constructor(
    private device: GPUDevice,
    wgsl: string,
  ) {
    const d = device;
    const module = (this.module = d.createShaderModule({ code: wgsl, label: "jwst" }));
    this.uniform = d.createBuffer({ size: 9 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const buffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: STRIDE,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "snorm8x4" },
          { shaderLocation: 2, offset: 16, format: "unorm8x4" },
          { shaderLocation: 3, offset: 20, format: "uint8x4" },
        ],
      },
    ];
    this.pipe = d.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs", buffers },
      fragment: { module, entryPoint: "fs", targets: [{ format: "rgba16float" }, { format: "rg16float" }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
      multisample: { count: 4 },
    });
    this.shadowPipe = d.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "shadowVs", buffers },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less", depthBias: 2, depthBiasSlopeScale: 2 },
    });
    this.comp = d.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "compVs" },
      fragment: {
        module,
        entryPoint: "compFs",
        targets: [
          {
            format: "rgba16float",
            blend: {
              color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
    this.shadowTex = d.createTexture({
      size: [SHADOW, SHADOW],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shadowBind = d.createBindGroup({
      layout: this.shadowPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniform } }],
    });
  }

  load(get: (url: string) => Promise<Response> = fetch) {
    return (this.fetching ??= (async () => {
      const r = await get(jwstUrl);
      const buf = await new Response(r.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      const dv = new DataView(buf);
      if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== "JWST" || dv.getUint32(4, true) !== 1) throw new Error("bad jwst mesh");
      const nv = dv.getUint32(8, true);
      const ni = dv.getUint32(12, true);
      const reach = dv.getFloat32(16, true) || JWST_RADIUS_M;
      const off = 20;
      const d = this.device;
      const vbuf = d.createBuffer({ size: nv * STRIDE, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(vbuf, 0, buf, off, nv * STRIDE);
      const ibuf = d.createBuffer({ size: ni * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(ibuf, 0, buf, off + nv * STRIDE, ni * 4);
      this.mesh = { vbuf, ibuf, count: ni, reach };
      this.ready = true;
    })());
  }

  encode(enc: GPUCommandEncoder, hdr: GPUTexture, sceneDepth: GPUBuffer, v: JwstView) {
    this.rect = [0, 0, 0, 0];
    if (!this.ready || !this.mesh) return;
    const W = hdr.width,
      H = hdr.height;
    const p = v.rel;
    const R = this.mesh.reach + 0.5;
    if (p[2] < -R) return;
    const dist = Math.hypot(...p);
    let bx = 0,
      by = 0,
      bw = W,
      bh = H;
    if (p[2] > R + 0.5 && dist > R * 1.05) {
      const sx = (x: number, z: number) => ((x / (z * v.tanH * v.aspect) + 1) / 2) * W;
      const sy = (y: number, z: number) => ((1 - y / (z * v.tanH)) / 2) * H;
      const zr = p[2] - R;
      const x0 = Math.floor(Math.min(sx(p[0] - R, zr), sx(p[0] - R, p[2] + R))) - 4;
      const x1 = Math.ceil(Math.max(sx(p[0] + R, zr), sx(p[0] + R, p[2] + R))) + 4;
      const y0 = Math.floor(Math.min(sy(p[1] + R, zr), sy(p[1] + R, p[2] + R))) - 4;
      const y1 = Math.ceil(Math.max(sy(p[1] - R, zr), sy(p[1] - R, p[2] + R))) + 4;
      bx = Math.max(0, x0);
      by = Math.max(0, y0);
      bw = Math.min(W, x1) - bx;
      bh = Math.min(H, y1) - by;
    }
    if (bw <= 0 || bh <= 0) return;
    const box = this.ensureBox(Math.ceil(bw / 64) * 64, Math.ceil(bh / 64) * 64);
    const u = new Float32Array(9 * 4);
    u.set([v.tanH * v.aspect, v.tanH, Math.max(dist - R * 1.4, 0.05), dist + R * 1.4], 0);
    u.set([bx, by, box.w, box.h], 4);
    u.set([W, H, v.mPerM, v.pre], 8);
    u.set([...v.sun, v.sunRadius], 12);
    // w = subtle deep-space starlight ambient ratio so the shaded 24k gold beryllium mirror glows subtly
    u.set([...v.sunE, 0.055], 16);
    u.set([...p, R], 20);
    // model -> camera 3x4 rows
    for (let r = 0; r < 3; r++) u.set([v.axes[0][r]!, v.axes[1][r]!, v.axes[2][r]!, p[r]!], 24 + 4 * r);
    const d = this.device;
    d.queue.writeBuffer(this.uniform, 0, u);

    const sp = enc.beginRenderPass({
      label: "jwst: shadow map",
      colorAttachments: [],
      depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    sp.setPipeline(this.shadowPipe);
    sp.setBindGroup(0, this.shadowBind);
    sp.setVertexBuffer(0, this.mesh.vbuf);
    sp.setIndexBuffer(this.mesh.ibuf, "uint32");
    sp.drawIndexed(this.mesh.count);
    sp.end();

    if (this.bind?.sceneDepth !== sceneDepth) {
      this.bind = {
        sceneDepth,
        g: d.createBindGroup({
          layout: this.pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.uniform } },
            { binding: 1, resource: { buffer: sceneDepth } },
            { binding: 2, resource: this.shadowTex.createView() },
            { binding: 3, resource: d.createSampler({ compare: "less-equal", magFilter: "linear", minFilter: "linear" }) },
          ],
        }),
      };
    }

    const rp = enc.beginRenderPass({
      label: "jwst",
      colorAttachments: [
        {
          view: box.color.createView(),
          resolveTarget: box.resColor.createView(),
          loadOp: "clear",
          storeOp: "discard",
          clearValue: [0, 0, 0, 0],
        },
        {
          view: box.depthColor.createView(),
          resolveTarget: box.resDepth.createView(),
          loadOp: "clear",
          storeOp: "discard",
          clearValue: [0, 0, 0, 0],
        },
      ],
      depthStencilAttachment: { view: box.depth.createView(), depthLoadOp: "clear", depthClearValue: 1, depthStoreOp: "discard" },
    });
    rp.setPipeline(this.pipe);
    rp.setBindGroup(0, this.bind.g);
    rp.setVertexBuffer(0, this.mesh.vbuf);
    rp.setIndexBuffer(this.mesh.ibuf, "uint32");
    rp.drawIndexed(this.mesh.count);
    rp.end();

    const cp = enc.beginRenderPass({
      label: "jwst composite",
      colorAttachments: [{ view: hdr.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: "load", storeOp: "store" }],
    });
    cp.setPipeline(this.comp);
    box.comp ??= d.createBindGroup({
      layout: this.comp.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 4, resource: box.resColor.createView() },
      ],
    });
    cp.setBindGroup(0, box.comp);
    cp.setScissorRect(bx, by, Math.min(box.w, W - bx), Math.min(box.h, H - by));
    cp.draw(3);
    cp.end();
    this.rect = [bx, by, box.w, box.h];
  }

  private ensureBox(w: number, h: number): Box {
    const b = this.box;
    if (b && b.w >= w && b.h >= h && b.w <= 1.5 * w + 64 && b.h <= 1.5 * h + 64) return b;
    const d = this.device;
    if (b) {
      // Defer destruction until submitted GPU work completes (encodeShip may have bound resDepth earlier in this encoder).
      const old = [b.color, b.depthColor, b.depth, b.resColor, b.resDepth];
      void d.queue.onSubmittedWorkDone().then(() => {
        for (const t of old) t.destroy();
      });
    }
    const ms = (format: GPUTextureFormat) =>
      d.createTexture({ size: [w, h], format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const res = (format: GPUTextureFormat) =>
      d.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.box = {
      w,
      h,
      color: ms("rgba16float"),
      depthColor: ms("rg16float"),
      depth: ms("depth24plus"),
      resColor: res("rgba16float"),
      resDepth: res("rg16float"),
    };
    return this.box;
  }
}
