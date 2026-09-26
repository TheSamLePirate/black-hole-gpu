// The spaceship carrying the camera (Interstellar's Ranger, assets/ranger, built by
// scripts/build-ranger.ts). The camera is mounted on it at one of several attach points: the ship
// is rigid in the camera's rest frame, so it is drawn with the tracer's own pinhole projection and
// composited over the traced image (before bloom: the disk's glare spills over its silhouette). It is
// lit by a light probe traced around the camera (lensed disk, Gargantua, sky) — see ship.wgsl.
import meshUrl from "../assets/ranger/ranger.bin";

import { shipToCamera, type Mount, type MountPose } from "./mounts";

type V3 = [number, number, number];

export interface ShipView {
  mount: Mount | MountPose;
  look: [number, number]; // free look on the mount: yaw, pitch [deg]
  fov: number; // vertical, degrees
  aspect: number;
  albedo: number;
  metal: number;
  rough: number;
  light: number;
  coat: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const ENV_W = 256;
export const ENV_H = 128;
const RAW_MIPS = 9; // box-filtered probe 256×128 … 1×1: the source of the GGX filtering
const SPEC_MIPS = 6; // GGX pre-filtered, roughness = level / 5
const GGX_SAMPLES = [0, 48, 64, 96, 128, 128];
const SHADOW = 2048;
const STRIDE = 8 * 4; // position, normal, material, ambient occlusion

interface ShipTargetRes {
  w: number;
  h: number;
  color: GPUTexture; // MSAA
  depth: GPUTexture;
  resolved: GPUTexture;
  compBind: GPUBindGroup;
  hdrView: GPUTextureView;
}

export class ShipRenderer {
  ready = false;
  /** Light probe written by the tracer's `env` kernel (camera rest frame, equirectangular). */
  readonly envBuf: GPUBuffer;
  private envRaw: GPUTexture;
  private envSpec: GPUTexture;
  private ggxBufs: GPUBuffer[] = [];
  private shBuf: GPUBuffer;
  private uniform: GPUBuffer;
  private vbuf: GPUBuffer | null = null;
  private ibuf: GPUBuffer | null = null;
  private count = 0;
  private bound = { c: [0, 0, 0] as V3, r: 1 };
  private shadowTex: GPUTexture;
  private pipes!: {
    copy: GPUComputePipeline;
    down: GPUComputePipeline;
    ggx: GPUComputePipeline;
    sh: GPUComputePipeline;
    ship: GPURenderPipeline;
    shadow: GPURenderPipeline;
    comp: GPURenderPipeline;
  };
  private envBinds: { copy: GPUBindGroup[]; down: GPUBindGroup[]; ggx: GPUBindGroup[]; sh: GPUBindGroup } | null = null;
  private shipBind: GPUBindGroup | null = null;
  private shadowBind: GPUBindGroup | null = null;
  private targets = new WeakMap<GPUTexture, ShipTargetRes>();

  constructor(private device: GPUDevice, shipWGSL: string) {
    const d = device;
    this.envBuf = d.createBuffer({ size: ENV_W * ENV_H * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const envUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
    this.envRaw = d.createTexture({ size: [ENV_W, ENV_H], format: "rgba16float", mipLevelCount: RAW_MIPS, usage: envUsage });
    this.envSpec = d.createTexture({ size: [ENV_W, ENV_H], format: "rgba16float", mipLevelCount: SPEC_MIPS, usage: envUsage });
    for (let l = 0; l < SPEC_MIPS; l++) {
      const b = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(b, 0, new Float32Array([Math.max(l / (SPEC_MIPS - 1), 0.02), RAW_MIPS, GGX_SAMPLES[l]!, 0]));
      this.ggxBufs.push(b);
    }
    this.shBuf = d.createBuffer({ size: 16 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.uniform = d.createBuffer({ size: 64 + 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shadowTex = d.createTexture({
      size: [SHADOW, SHADOW], format: "depth32float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const module = d.createShaderModule({ code: shipWGSL, label: "ship" });
    const cp = (entryPoint: string) => d.createComputePipeline({ layout: "auto", compute: { module, entryPoint } });
    const vertex: GPUVertexState = {
      module,
      entryPoint: "vs",
      buffers: [{
        arrayStride: STRIDE,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" },
          { shaderLocation: 2, offset: 24, format: "float32" },
          { shaderLocation: 3, offset: 28, format: "float32" },
        ],
      }],
    };
    this.pipes = {
      copy: cp("envCopy"),
      down: cp("envDown"),
      ggx: cp("envGGX"),
      sh: cp("envSH"),
      ship: d.createRenderPipeline({
        layout: "auto",
        vertex,
        fragment: { module, entryPoint: "fs", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list", cullMode: "none", frontFace: "ccw" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
        multisample: { count: 4 },
      }),
      shadow: d.createRenderPipeline({
        layout: "auto",
        vertex: { ...vertex, entryPoint: "shadowVs" },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
      }),
      comp: d.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "compVs" },
        fragment: {
          module,
          entryPoint: "compFs",
          targets: [{
            format: "rgba16float",
            // premultiplied over; the alpha channel (the pixel's variance estimate) is kept
            blend: {
              color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
      }),
    };
  }

  /** Downloads the mesh (1 MB). */
  async load() {
    const d = this.device;
    const mesh = await fetch(meshUrl).then((r) => r.arrayBuffer());
    const u32 = new Uint32Array(mesh, 0, 4);
    if (new TextDecoder().decode(new Uint8Array(mesh, 0, 4)) !== "RNGR" || u32[1] !== 2) throw new Error("bad ranger.bin");
    const nv = u32[2]!;
    const ni = u32[3]!;
    const bb = new Float32Array(mesh, 16, 6);
    const lo: V3 = [bb[0]!, bb[1]!, bb[2]!];
    const hi: V3 = [bb[3]!, bb[4]!, bb[5]!];
    this.bound.c = [0, 1, 2].map((k) => (lo[k]! + hi[k]!) / 2) as V3;
    this.bound.r = Math.hypot(...sub(hi, lo)) / 2;
    const verts = new Float32Array(mesh, 40, nv * 8);
    const idx = new Uint32Array(mesh, 40 + nv * STRIDE, ni);
    this.vbuf = d.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.vbuf, 0, verts);
    this.ibuf = d.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.ibuf, 0, idx);
    this.count = ni;
    this.bind();
    this.ready = true;
  }

  private bind() {
    const d = this.device;
    const raw = (l: number) => this.envRaw.createView({ baseMipLevel: l, mipLevelCount: 1 });
    const spec = (l: number) => this.envSpec.createView({ baseMipLevel: l, mipLevelCount: 1 });
    const envSamp = d.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat" });
    this.envBinds = {
      copy: [raw(0), spec(0)].map((view) =>
        d.createBindGroup({
          layout: this.pipes.copy.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: this.envBuf } }, { binding: 1, resource: view }],
        }),
      ),
      down: Array.from({ length: RAW_MIPS - 1 }, (_, i) =>
        d.createBindGroup({
          layout: this.pipes.down.getBindGroupLayout(0),
          entries: [{ binding: 1, resource: raw(i + 1) }, { binding: 2, resource: raw(i) }],
        }),
      ),
      ggx: Array.from({ length: SPEC_MIPS - 1 }, (_, i) =>
        d.createBindGroup({
          layout: this.pipes.ggx.getBindGroupLayout(0),
          entries: [
            { binding: 1, resource: spec(i + 1) },
            { binding: 2, resource: this.envRaw.createView() },
            { binding: 4, resource: envSamp },
            { binding: 5, resource: { buffer: this.ggxBufs[i + 1]! } },
          ],
        }),
      ),
      sh: d.createBindGroup({
        layout: this.pipes.sh.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.envBuf } }, { binding: 3, resource: { buffer: this.shBuf } }],
      }),
    };
    const samp = d.createSampler({
      magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat", addressModeV: "clamp-to-edge", maxAnisotropy: 8,
    });
    const cmp = d.createSampler({ compare: "less-equal", magFilter: "linear", minFilter: "linear" });
    this.shipBind = d.createBindGroup({
      layout: this.pipes.ship.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.shBuf } },
        { binding: 2, resource: this.envSpec.createView() },
        { binding: 3, resource: samp },
        { binding: 7, resource: this.shadowTex.createView() },
        { binding: 8, resource: cmp },
      ],
    });
    this.shadowBind = d.createBindGroup({
      layout: this.pipes.shadow.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.shBuf } },
      ],
    });
  }

  /** Probe → box mips, GGX pre-filtered mips, spherical harmonics (after the tracer's env pass). */
  encodeEnv(enc: GPUCommandEncoder) {
    if (!this.envBinds) return;
    const groups = (l: number) => [Math.ceil(Math.max(1, ENV_W >> l) / 8), Math.ceil(Math.max(1, ENV_H >> l) / 8)] as const;
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipes.copy);
    for (const g of this.envBinds.copy) {
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(ENV_W / 8, ENV_H / 8);
    }
    pass.setPipeline(this.pipes.down);
    this.envBinds.down.forEach((g, i) => {
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(...groups(i + 1));
    });
    pass.setPipeline(this.pipes.ggx);
    this.envBinds.ggx.forEach((g, i) => {
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(...groups(i + 1));
    });
    pass.setPipeline(this.pipes.sh);
    pass.setBindGroup(0, this.envBinds.sh);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  private writeUniform(v: ShipView) {
    const { S: R, t } = shipToCamera(v.mount, v.look[0], v.look[1]);
    // column-major mat4: columns = images of the ship's x, y, z axes, then the translation
    const m = new Float32Array(32);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = R[r]![c]!;
    m.set([...t, 1], 12);
    const tanH = Math.tan((v.fov * Math.PI) / 360);
    m.set([tanH * v.aspect, tanH, 0.05, 80], 16);
    m.set([v.albedo, v.metal, v.rough, SPEC_MIPS], 20);
    const c = R.map((r) => dot(r, this.bound.c) + 0) as V3;
    m.set([c[0] + t[0], c[1] + t[1], c[2] + t[2], this.bound.r * 1.02], 24);
    m.set([v.light, v.coat, 0, 0], 28);
    this.device.queue.writeBuffer(this.uniform, 0, m);
  }

  /**
   * Draws the ship over the resolved HDR image (mip 0 of `hdr`, which must allow render attachment):
   * shadow map, MSAA shading, resolve, premultiplied composite.
   */
  encodeShip(enc: GPUCommandEncoder, hdr: GPUTexture, v: ShipView) {
    if (!this.ready) return;
    const d = this.device;
    let res = this.targets.get(hdr);
    if (!res || res.w !== hdr.width || res.h !== hdr.height) {
      const size = [hdr.width, hdr.height];
      const color = d.createTexture({ size, format: "rgba16float", sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const depth = d.createTexture({ size, format: "depth24plus", sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const resolved = d.createTexture({ size, format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      res = {
        w: hdr.width, h: hdr.height, color, depth, resolved,
        compBind: d.createBindGroup({ layout: this.pipes.comp.getBindGroupLayout(0), entries: [{ binding: 0, resource: resolved.createView() }] }),
        hdrView: hdr.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
      };
      this.targets.set(hdr, res);
    }
    this.writeUniform(v);
    let rp = enc.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    rp.setPipeline(this.pipes.shadow);
    rp.setBindGroup(0, this.shadowBind!);
    rp.setVertexBuffer(0, this.vbuf!);
    rp.setIndexBuffer(this.ibuf!, "uint32");
    rp.drawIndexed(this.count);
    rp.end();
    rp = enc.beginRenderPass({
      colorAttachments: [{ view: res.color.createView(), resolveTarget: res.resolved.createView(), loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 0] }],
      depthStencilAttachment: { view: res.depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    rp.setPipeline(this.pipes.ship);
    rp.setBindGroup(0, this.shipBind!);
    rp.setVertexBuffer(0, this.vbuf!);
    rp.setIndexBuffer(this.ibuf!, "uint32");
    rp.drawIndexed(this.count);
    rp.end();
    rp = enc.beginRenderPass({ colorAttachments: [{ view: res.hdrView, loadOp: "load", storeOp: "store" }] });
    rp.setPipeline(this.pipes.comp);
    rp.setBindGroup(0, res.compBind);
    rp.draw(3);
    rp.end();
  }

  /** Frees the per-target buffers of a destroyed HDR texture. */
  forget(hdr: GPUTexture) {
    const r = this.targets.get(hdr);
    if (!r) return;
    r.color.destroy();
    r.depth.destroy();
    r.resolved.destroy();
    this.targets.delete(hdr);
  }
}
