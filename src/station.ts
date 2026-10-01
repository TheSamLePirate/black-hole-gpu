// The International Space Station (assets/iss, built by scripts/build-iss.py from NASA's model) drawn
// where it is on its orbit (system/iss.ts), its joints turned so that its solar arrays face the Sun.
// As the Endurance is drawn (endurance.ts): with the tracer's pinhole, into a box of the image (4×
// MSAA), hidden where the traced scene is nearer, composited over the traced image before bloom. Two
// levels of detail: 93 k triangles (2.1 MB) at first and from afar, 537 k (9.9 MB) near.
import lod0Url from "../assets/iss/iss-lod0.bin";
import lod1Url from "../assets/iss/iss-lod1.bin";

import type { Vec3 } from "./physics";
import { rotAbout, setStationGeometry, PORT_NAMES, type StationJoint, type StationPort } from "./system/iss";

const STRIDE = 24;
const PARTS = 13;
/** the shadow map's reach: the station's bounding sphere [m] */
const REACH = 62;
const SHADOW = 2048;

interface Mesh { vbuf: GPUBuffer; ibuf: GPUBuffer; count: number }
interface Box { w: number; h: number; color: GPUTexture; depthColor: GPUTexture; depth: GPUTexture; resColor: GPUTexture; resDepth: GPUTexture; comp?: GPUBindGroup }

/** What the renderer gives for a frame: the station seen from the camera. */
export interface StationView {
  /** the station's origin (the truss's centre) from the camera [m], and its axes (x forward, y
   *  starboard, z nadir) — camera frame (x right, y up, z forward) */
  rel: Vec3;
  axes: [Vec3, Vec3, Vec3];
  /** the joints' angles [rad] (iss.ts: jointAngles) */
  angles: number[];
  /** towards the Sun (camera frame), its angular radius, its irradiance there (rgb, the tracer's
   *  units, its share above the Earth's limb) */
  sun: Vec3;
  sunRadius: number;
  sunE: Vec3;
  /** the Earth's light (camera frame), order-2 harmonics: 9 × rgb */
  sh: number[];
  tanH: number;
  aspect: number;
  pre: number;
  /** metres per M (the traced depth's unit) */
  mPerM: number;
}

type M34 = [Vec3, Vec3, Vec3, Vec3]; // columns: the images of x, y, z, then the translation

const mul = (A: M34, B: M34): M34 => {
  const ap = (v: Vec3, w: number): Vec3 => [0, 1, 2].map((k) => A[0][k]! * v[0] + A[1][k]! * v[1] + A[2][k]! * v[2] + w * A[3][k]!) as Vec3;
  return [ap(B[0], 0), ap(B[1], 0), ap(B[2], 0), ap(B[3], 1)];
};
/** A rotation by a about the line through p along k. */
const rotM = (p: Vec3, k: Vec3, a: number): M34 => {
  const c0 = rotAbout([1, 0, 0], k, a), c1 = rotAbout([0, 1, 0], k, a), c2 = rotAbout([0, 0, 1], k, a);
  const rp = rotAbout(p, k, a);
  return [c0, c1, c2, [p[0] - rp[0], p[1] - rp[1], p[2] - rp[2]]];
};

/** The parts' transforms (the station, then each joint's): at rest → turned, a gimbal after its alpha joint. */
export function partTransforms(joints: StationJoint[], angles: number[]): M34[] {
  const I: M34 = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]];
  const out: M34[] = [I];
  const own = joints.map((j, k) => rotM(j.pivot, j.axis, angles[k] ?? 0));
  joints.forEach((j, k) => out.push(j.parent >= 0 ? mul(own[j.parent]!, own[k]!) : own[k]!));
  while (out.length < PARTS) out.push(I);
  return out;
}

export class StationRenderer {
  ready = false;
  joints: StationJoint[] = [];
  ports: StationPort[] = [];
  private meshes: (Mesh | null)[] = [null, null];
  private fetching: (Promise<void> | null)[] = [null, null];
  private get: (url: string) => Promise<Response> = fetch;
  private uniform: GPUBuffer;
  private pipe: GPURenderPipeline;
  private shadowPipe: GPURenderPipeline;
  private comp: GPURenderPipeline;
  private shadowTex: GPUTexture;
  private bind: { g: GPUBindGroup; moments: GPUBuffer } | null = null;
  private shadowBind: GPUBindGroup;
  private box: Box | null = null;
  /** its box's resolved depth (distance [m], coverage): the Ranger hidden behind it */
  depthTexture(): GPUTexture | null {
    return this.rect[2] > 0 ? this.box?.resDepth ?? null : null;
  }
  /** where it was drawn [x, y, w, h] (w = 0: not drawn) */
  rect: [number, number, number, number] = [0, 0, 0, 0];
  /** called when the finer level has come in */
  onLoaded: () => void = () => {};

  constructor(private device: GPUDevice, wgsl: string) {
    const d = device;
    const module = d.createShaderModule({ code: wgsl, label: "station" });
    this.uniform = d.createBuffer({ size: (6 + 9 + 39) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const buffers: GPUVertexBufferLayout[] = [{
      arrayStride: STRIDE,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "snorm8x4" },
        { shaderLocation: 2, offset: 16, format: "unorm8x4" },
        { shaderLocation: 3, offset: 20, format: "uint8x4" },
      ],
    }];
    this.pipe = d.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs", buffers },
      fragment: { module, entryPoint: "fs", targets: [{ format: "rgba16float" }, { format: "rg16float" }] },
      // (no culling: its panels are single sheets)
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
        targets: [{
          format: "rgba16float",
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.shadowTex = d.createTexture({ size: [SHADOW, SHADOW], format: "depth32float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.shadowBind = d.createBindGroup({ layout: this.shadowPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
  }

  /** Downloads the coarse level; the fine one follows when the station is drawn large. */
  load(get: (url: string) => Promise<Response> = fetch) {
    this.get = get;
    return this.fetchLod(0);
  }

  private fetchLod(i: number) {
    return (this.fetching[i] ??= (async () => {
      const r = await this.get([lod0Url, lod1Url][i]!);
      const buf = await new Response(r.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      const u32 = new Uint32Array(buf, 0, 6);
      if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== "ISS1" || u32[1] !== 2) throw new Error("bad station mesh");
      const nv = u32[2]!, ni = u32[3]!, nj = u32[4]!, np = u32[5]!;
      const jf = new Float32Array(buf, 24, nj * 12);
      const pf = new Float32Array(buf, 24 + nj * 48, np * 8);
      const v3 = (f: Float32Array, o: number): Vec3 => [f[o]!, f[o + 1]!, f[o + 2]!];
      this.joints = Array.from({ length: nj }, (_, k) => ({ pivot: v3(jf, 12 * k), axis: v3(jf, 12 * k + 3), normal: v3(jf, 12 * k + 6), parent: Math.round(jf[12 * k + 9]!), kind: Math.round(jf[12 * k + 10]!) }));
      this.ports = Array.from({ length: np }, (_, k) => ({ centre: v3(pf, 8 * k), axis: v3(pf, 8 * k + 3), name: PORT_NAMES[k] ?? `port ${k + 1}` }));
      setStationGeometry(this.joints, this.ports);
      const off = 24 + nj * 48 + np * 32;
      const d = this.device;
      const vbuf = d.createBuffer({ size: nv * STRIDE, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(vbuf, 0, buf, off, nv * STRIDE);
      const ibuf = d.createBuffer({ size: ni * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(ibuf, 0, buf, off + nv * STRIDE, ni * 4);
      this.meshes[i] = { vbuf, ibuf, count: ni };
      this.ready = true;
      if (i > 0) this.onLoaded();
    })());
  }

  /** The parts' transforms, station frame at rest → station frame (the joints turned). */
  partMatrices(angles: number[]): M34[] {
    return partTransforms(this.joints, angles);
  }

  /** Draws it (when on screen) into a box and composites it into `hdr`. */
  encode(enc: GPUCommandEncoder, hdr: GPUTexture, moments: GPUBuffer, v: StationView) {
    this.rect = [0, 0, 0, 0];
    if (!this.ready) return;
    const W = hdr.width, H = hdr.height;
    const p = v.rel;
    const R = REACH;
    if (p[2] < -R) return;
    const dist = Math.hypot(...p);
    // the box: the bounding sphere's projection (all of the image when the camera is inside it)
    let bx = 0, by = 0, bw = W, bh = H;
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
    // (the finer level near: its download started when first wanted)
    const fine = dist < 2500 || bw > 500;
    if (fine && !this.meshes[1]) this.fetchLod(1).catch((e) => console.error("ISS:", e));
    const mesh = (fine && this.meshes[1]) || this.meshes[0] || this.meshes[1];
    if (!mesh) return;
    const box = this.ensureBox(Math.ceil(bw / 64) * 64, Math.ceil(bh / 64) * 64);
    // the uniforms
    const u = new Float32Array((6 + 9 + 39) * 4);
    u.set([v.tanH * v.aspect, v.tanH, Math.max(dist - R * 1.2, 0.05), dist + R * 1.2], 0);
    u.set([bx, by, box.w, box.h], 4);
    u.set([W, H, v.mPerM, v.pre], 8);
    u.set([...v.sun, v.sunRadius], 12);
    u.set([...v.sunE, 0], 16);
    // (the shadow map round the station's middle)
    u.set([...p, R], 20);
    for (let k = 0; k < 9; k++) u.set([v.sh[3 * k]!, v.sh[3 * k + 1]!, v.sh[3 * k + 2]!, 0], 24 + 4 * k);
    // each part: station (at rest) → camera frame: [axes | rel] ∘ the joints' turns
    const S: M34 = [v.axes[0], v.axes[1], v.axes[2], p];
    this.partMatrices(v.angles).forEach((T, k) => {
      const M = mul(S, T);
      for (let r = 0; r < 3; r++) u.set([M[0][r]!, M[1][r]!, M[2][r]!, M[3][r]!], 60 + 12 * k + 4 * r);
    });
    this.device.queue.writeBuffer(this.uniform, 0, u);
    const d = this.device;
    // its shadow map (from the Sun), then the shading
    const sp = enc.beginRenderPass({ label: "station: shadow map", colorAttachments: [], depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" } });
    sp.setPipeline(this.shadowPipe);
    sp.setBindGroup(0, this.shadowBind);
    sp.setVertexBuffer(0, mesh.vbuf);
    sp.setIndexBuffer(mesh.ibuf, "uint32");
    sp.drawIndexed(mesh.count);
    sp.end();
    if (this.bind?.moments !== moments) {
      this.bind = {
        moments,
        g: d.createBindGroup({
          layout: this.pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.uniform } },
            { binding: 1, resource: { buffer: moments } },
            { binding: 2, resource: this.shadowTex.createView() },
            { binding: 3, resource: d.createSampler({ compare: "less-equal", magFilter: "linear", minFilter: "linear" }) },
          ],
        }),
      };
    }
    const rp = enc.beginRenderPass({
      label: "station",
      colorAttachments: [
        { view: box.color.createView(), resolveTarget: box.resColor.createView(), loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 0] },
        { view: box.depthColor.createView(), resolveTarget: box.resDepth.createView(), loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 0] },
      ],
      depthStencilAttachment: { view: box.depth.createView(), depthLoadOp: "clear", depthClearValue: 1, depthStoreOp: "discard" },
    });
    rp.setPipeline(this.pipe);
    rp.setBindGroup(0, this.bind.g);
    rp.setVertexBuffer(0, mesh.vbuf);
    rp.setIndexBuffer(mesh.ibuf, "uint32");
    rp.drawIndexed(mesh.count);
    rp.end();
    const cp = enc.beginRenderPass({
      label: "station composite",
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
    if (b) for (const t of [b.color, b.depthColor, b.depth, b.resColor, b.resDepth]) t.destroy();
    const d = this.device;
    const ms = (format: GPUTextureFormat) => d.createTexture({ size: [w, h], format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const res = (format: GPUTextureFormat) => d.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.box = { w, h, color: ms("rgba16float"), depthColor: ms("rg16float"), depth: ms("depth24plus"), resColor: res("rgba16float"), resDepth: res("rg16float") };
    return this.box;
  }
}

