// The Endurance (Interstellar's ring ship, assets/endurance, built by scripts/build-endurance.ts) on an
// orbit around Gargantua, as in the film's shots. At its true size (64 m) it would be far below a
// pixel next to a hole of 10⁸ M☉ (M ≈ 1 AU): it is drawn at a cinematic scale, its diameter a setting
// in M. It is not lensed: seen along straight rays from the camera (fair while it is far from the hole
// compared with its size), with the tracer's own pinhole projection, into a box of the image (4×
// MSAA), hidden where the traced scene is nearer, composited over the traced image before bloom.
import meshUrl from "../assets/endurance/endurance.bin";

import type { CameraFrame } from "./camera";
import { blToCartesian } from "./camera";
import { coordToZamo, type Vec3 } from "./physics";
import { sphericalFrame } from "./wormhole";
import { mapToRest, mapToZamo, seenFrom } from "./system/local-patch";
import type { Settings } from "./settings";

const STRIDE = 8 * 4; // position, normal, material, ambient occlusion
const DEG = Math.PI / 180;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The Endurance's centre, velocity and axes (the hole's flat map) at time t: a circular orbit. */
export function endurancePose(s: Settings, t: number) {
  const a = Math.max(s.enduranceOrbit, 3);
  const om = 1 / (a ** 1.5 + s.spin);
  const ph = s.endurancePhase * DEG + om * t;
  const i = s.enduranceIncl * DEG;
  // (in the orbit's plane from its ascending node, then the plane tilted about the line of nodes)
  const nd = s.enduranceNode * DEG;
  const u = ph - nd;
  const q: Vec3 = [a * Math.cos(u), a * Math.sin(u) * Math.cos(i), a * Math.sin(u) * Math.sin(i)];
  const qv: Vec3 = [-a * om * Math.sin(u), a * om * Math.cos(u) * Math.cos(i), a * om * Math.cos(u) * Math.sin(i)];
  const rz = (v: Vec3): Vec3 => [v[0] * Math.cos(nd) - v[1] * Math.sin(nd), v[0] * Math.sin(nd) + v[1] * Math.cos(nd), v[2]];
  const C = rz(q), V = rz(qv);
  // the ring's axis along the radius (its face to the hole), turning about it
  const z = unit(C);
  const x0 = unit(cross(z, [0, 0, 1]));
  const y0 = cross(z, x0);
  const psi = (2 * Math.PI * t) / Math.max(s.enduranceSpin, 1);
  const x: Vec3 = [0, 1, 2].map((k) => Math.cos(psi) * x0[k]! + Math.sin(psi) * y0[k]!) as Vec3;
  const y = cross(z, x);
  return { C, V, x, y, z };
}

interface Box { w: number; h: number; color: GPUTexture; depthColor: GPUTexture; depth: GPUTexture; resColor: GPUTexture; resDepth: GPUTexture }

export class EnduranceRenderer {
  ready = false;
  private vbuf: GPUBuffer | null = null;
  private ibuf: GPUBuffer | null = null;
  private count = 0;
  private uniform: GPUBuffer;
  private pipe: GPURenderPipeline;
  private comp: GPURenderPipeline;
  private box: Box | null = null;
  /** where it was drawn [x, y, w, h] (w = 0: not drawn), and its box's resolved depth (distance, coverage) */
  rect: [number, number, number, number] = [0, 0, 0, 0];
  private dummy: GPUTexture;
  private loading: Promise<void> | null = null;

  constructor(private device: GPUDevice, wgsl: string) {
    const d = device;
    const module = d.createShaderModule({ code: wgsl, label: "endurance" });
    this.uniform = d.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.pipe = d.createRenderPipeline({
      layout: "auto",
      vertex: {
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
      },
      fragment: { module, entryPoint: "fs", targets: [{ format: "rgba16float" }, { format: "rgba16float" }] },
      // (no culling: the model has open, single-sided parts)
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
      multisample: { count: 4 },
    });
    this.comp = d.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "compVs" },
      fragment: {
        module,
        entryPoint: "compFs",
        targets: [{
          format: "rgba16float",
          // premultiplied over; the alpha channel (the pixel's variance estimate) kept
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.dummy = d.createTexture({ size: [1, 1], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING });
  }

  /** Downloads the mesh (6 MB) once. */
  load(get: (url: string) => Promise<Response> = fetch) {
    this.loading ??= (async () => {
      const mesh = await get(meshUrl).then((r) => r.arrayBuffer());
      const u32 = new Uint32Array(mesh, 0, 4);
      if (new TextDecoder().decode(new Uint8Array(mesh, 0, 4)) !== "ENDR" || u32[1] !== 1) throw new Error("bad endurance.bin");
      const nv = u32[2]!, ni = u32[3]!;
      const d = this.device;
      this.vbuf = d.createBuffer({ size: nv * STRIDE, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(this.vbuf, 0, mesh, 40, nv * STRIDE);
      this.ibuf = d.createBuffer({ size: ni * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(this.ibuf, 0, mesh, 40 + nv * STRIDE, ni * 4);
      this.count = ni;
      this.ready = true;
    })();
    return this.loading;
  }

  /** The box's resolved depth (distance, coverage) for the depth of field, or a 1 × 1 placeholder. */
  depthTexture() {
    return this.box?.resDepth ?? this.dummy;
  }

  /**
   * Draws it for an image (W × H) and composites it into `hdr` (mip 0): the camera frame, the scene's
   * time, the moments buffer holding the traced depth, the pre-exposure and the display-referred glow.
   */
  encode(enc: GPUCommandEncoder, hdr: GPUTexture, moments: GPUBuffer, s: Settings, cam: CameraFrame, t: number, pre: number, glow: number) {
    this.rect = [0, 0, 0, 0];
    if (!this.ready || cam.region !== "hole") return;
    const W = hdr.width, H = hdr.height;
    const { C, V, x, y, z } = endurancePose(s, t);
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    // its place and velocity as the camera sees them (retarded, aberrated: local-patch.ts)
    const f = sphericalFrame(X);
    const vz = coordToZamo([dot(V, f.er), dot(V, f.et), dot(V, f.ep)], cam.r, cam.theta, cam.zamo);
    const rel = seenFrom(mapToZamo([C[0] - X[0], C[1] - X[1], C[2] - X[2]], cam), vz, cam.beta);
    const toCam = (v: Vec3): Vec3 => [dot(v, cam.right), dot(v, cam.up), dot(v, cam.fwd)];
    const p = toCam(rel);
    const size = Math.max(s.enduranceSize, 1e-3);
    const R = 0.55 * size;
    const dist = Math.hypot(...p);
    if (p[2] < R + 1e-3) return; // (behind, or the camera at it)
    const tanH = Math.tan((s.fov * DEG) / 2);
    const aspect = W / H;
    // the box: the bounding sphere's projection, rounded up (few re-allocations)
    const sx = (v: number, zz: number) => ((v / (zz * tanH * aspect) + 1) / 2) * W;
    const sy = (v: number, zz: number) => ((1 - v / (zz * tanH)) / 2) * H;
    const zr = p[2] - R;
    const x0 = Math.floor(Math.min(sx(p[0] - R, zr), sx(p[0] - R, p[2] + R))) - 4;
    const x1 = Math.ceil(Math.max(sx(p[0] + R, zr), sx(p[0] + R, p[2] + R))) + 4;
    const y0 = Math.floor(Math.min(sy(p[1] + R, zr), sy(p[1] + R, p[2] + R))) - 4;
    const y1 = Math.ceil(Math.max(sy(p[1] - R, zr), sy(p[1] - R, p[2] + R))) + 4;
    const bx = Math.max(0, x0), by = Math.max(0, y0);
    const bw = Math.min(W, x1) - bx, bh = Math.min(H, y1) - by;
    if (bw <= 0 || bh <= 0) return;
    const box = this.ensureBox(Math.ceil(bw / 64) * 64, Math.ceil(bh / 64) * 64);
    // the ship's axes in the camera frame (directions at rest, as the camera sees them), times its size
    const axis = (v: Vec3) => toCam(unit(mapToRest(v, cam))).map((c) => c * size) as Vec3;
    // the disk's light: from the hole's direction; its irradiance ~ the disk's solid angle (as the
    // renderer's light meter), warm; a faint fill from the lensed disk and the sky
    const r = Math.hypot(...C);
    const E = Math.min((0.75 * (Math.max(s.diskOuter, 2) ** 2 - 4)) / (r * r), 1) * (s.disk ? 1 : 0) * s.enduranceLight;
    // (the disk an extended source: from the hole's direction and from its face below the ship)
    const L = toCam(unit(mapToRest(unit([-C[0] / r, -C[1] / r, -C[2] / r - 0.7 * Math.sign(C[2] || 1)]), cam)));
    const Lb = toCam(unit(mapToRest([0, 0, -Math.sign(C[2] || 1)], cam)));
    const u = new Float32Array(44);
    const uu = new Uint32Array(u.buffer);
    u.set([tanH, aspect, Math.max(dist - R * 1.2, 1e-3), dist + R * 1.2], 0);
    u.set([...axis(x), 0], 4);
    u.set([...axis(y), 0], 8);
    u.set([...axis(z), 0], 12);
    u.set([...p, pre], 16);
    u.set([...L, 1.6 * E], 20);
    // (its lights: small blue glints, display-referred — the Film grade and the bloom make much more of them)
    u.set([1, 0.82, 0.62, 0.12 * glow], 24);
    u.set([0.06 * E + 0.004, 0.05 * E + 0.004, 0.045 * E + 0.005, 0], 28);
    u.set([...Lb, 0.5 * E], 36 + 4);
    u.set([bx, by, box.w, box.h], 32);
    uu.set([W, H, 0, 0], 36);
    this.device.queue.writeBuffer(this.uniform, 0, u);
    const d = this.device;
    const bind = d.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: moments } },
      ],
    });
    const rp = enc.beginRenderPass({
      label: "endurance",
      colorAttachments: [
        { view: box.color.createView(), resolveTarget: box.resColor.createView(), loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 0] },
        { view: box.depthColor.createView(), resolveTarget: box.resDepth.createView(), loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 0] },
      ],
      depthStencilAttachment: { view: box.depth.createView(), depthLoadOp: "clear", depthClearValue: 1, depthStoreOp: "discard" },
    });
    rp.setPipeline(this.pipe);
    rp.setBindGroup(0, bind);
    rp.setVertexBuffer(0, this.vbuf!);
    rp.setIndexBuffer(this.ibuf!, "uint32");
    rp.drawIndexed(this.count);
    rp.end();
    // composited over the traced image, within its box
    const cp = enc.beginRenderPass({
      label: "endurance composite",
      colorAttachments: [{ view: hdr.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: "load", storeOp: "store" }],
    });
    cp.setPipeline(this.comp);
    cp.setBindGroup(0, d.createBindGroup({
      layout: this.comp.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 2, resource: box.resColor.createView() },
      ],
    }));
    cp.setScissorRect(bx, by, Math.min(box.w, W - bx), Math.min(box.h, H - by));
    cp.draw(3);
    cp.end();
    this.rect = [bx, by, box.w, box.h];
  }

  private ensureBox(w: number, h: number): Box {
    const b = this.box;
    if (b && b.w >= w && b.h >= h && b.w <= 2 * w && b.h <= 2 * h) return b;
    if (b) for (const t of [b.color, b.depthColor, b.depth, b.resColor, b.resDepth]) t.destroy();
    const d = this.device;
    const ms = (format: GPUTextureFormat) => d.createTexture({ size: [w, h], format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const res = () => d.createTexture({ size: [w, h], format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.box = { w, h, color: ms("rgba16float"), depthColor: ms("rgba16float"), depth: ms("depth24plus"), resColor: res(), resDepth: res() };
    return this.box;
  }
}
