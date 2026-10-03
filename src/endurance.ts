// The Endurance (Interstellar's ring ship, assets/endurance, built by scripts/build-endurance.ts) on an
// orbit around Gargantua, as in the film's shots. At its true size (64 m) it would be far below a
// pixel next to a hole of 10⁸ M☉ (M ≈ 1 AU): it is drawn at a cinematic scale, its diameter a setting
// in M. It is not lensed: seen along straight rays from the camera (fair while it is far from the hole
// compared with its size), with the tracer's own pinhole projection, into a box of the image (4×
// MSAA), hidden where the traced scene is nearer, composited over the traced image before bloom.
// Its level of detail follows its size on screen (5, 10, 40 or 100 % of the model's triangles, each
// downloaded when first needed); it is shaded with GGX, lit by the disk as seen from where it is
// (projected on spherical harmonics each frame: its light wraps round the ring as the disk's does).
import lod2Url from "../assets/endurance/endurance-lod2.bin";
import lod1Url from "../assets/endurance/endurance-lod1.bin";
import lod0Url from "../assets/endurance/endurance.bin";
import fullUrl from "../assets/endurance/endurance-full.bin";

import type { CameraFrame } from "./camera";
import { blToCartesian } from "./camera";
import { coordToZamo, isco, type Vec3 } from "./physics";
import { sphericalFrame } from "./wormhole";
import { mapToRest, mapToZamo, seenFrom } from "./system/local-patch";
import type { Settings } from "./settings";
import { DEG } from "./units";
import { cross, dot } from "./math/vec3";

const STRIDE = 8 * 4; // position, normal, material, ambient occlusion
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The Endurance's centre, velocity and axes (the hole's flat map) at time t: a circular prograde orbit. */
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
  const C = rz(q),
    V = rz(qv);
  // it flies along its hub's axis (as in the film): the axis along its velocity — prograde, the way the
  // disk turns — the ring spinning about it (right-handed about the motion), x0 its radial direction
  const z = unit(V);
  const x0 = unit(cross(cross(z, C), z));
  const y0 = cross(z, x0);
  const psi = (2 * Math.PI * t) / Math.max(s.enduranceSpin, 1);
  const x: Vec3 = [0, 1, 2].map((k) => Math.cos(psi) * x0[k]! + Math.sin(psi) * y0[k]!) as Vec3;
  const y = cross(z, x);
  return { C, V, x, y, z };
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
interface Mesh {
  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  count: number;
}

/** The levels of detail, coarsest first, and the box width [px] up to which each is drawn. */
const LODS: { url: string; upTo: number }[] = [
  { url: lod2Url, upTo: 200 },
  { url: lod1Url, upTo: 600 },
  { url: lod0Url, upTo: 1500 },
  { url: fullUrl, upTo: Infinity },
];

// order-2 real spherical harmonics (as ship.wgsl's shBasis)
const shBasis = (d: Vec3) => [
  0.282095,
  0.488603 * d[1],
  0.488603 * d[2],
  0.488603 * d[0],
  1.092548 * d[0] * d[1],
  1.092548 * d[1] * d[2],
  0.315392 * (3 * d[2] * d[2] - 1),
  1.092548 * d[0] * d[2],
  0.546274 * (d[0] * d[0] - d[1] * d[1]),
];
const SH_A = [Math.PI, 2.094395, 2.094395, 2.094395, 0.785398, 0.785398, 0.785398, 0.785398, 0.785398];

/**
 * The disk's light at C (the hole's flat map) on spherical harmonics, in the frame `toCam` maps to: its
 * face on C's side, an annulus from the ISCO to its outer edge, each ring's radiance ∝ the thin disk's
 * flux (r⁻³ (1 − √(r_in/r))), straight rays (its lensed images and the hole's shadow left out).
 * Returned scaled so that the irradiance towards its dominant direction is 1, with that direction and
 * how much of the light comes from it (0: all round, 1: a point).
 */
export function diskSH(C: Vec3, rin: number, rout: number, toCam: (w: Vec3) => Vec3) {
  const sh = new Array(9).fill(0);
  const NR = 24,
    NP = 48;
  const h = Math.abs(C[2]) || 1e-3;
  for (let i = 0; i < NR; i++) {
    // (rings spaced in √r: the bright inner edge sampled finer)
    const u0 = Math.sqrt(rin) + ((Math.sqrt(rout) - Math.sqrt(rin)) * i) / NR;
    const u1 = Math.sqrt(rin) + ((Math.sqrt(rout) - Math.sqrt(rin)) * (i + 1)) / NR;
    const r = ((u0 + u1) / 2) ** 2;
    const L = r ** -3 * (1 - Math.sqrt(rin / r));
    const dA = (Math.PI * (u1 * u1 * u1 * u1 - u0 * u0 * u0 * u0)) / NP;
    for (let j = 0; j < NP; j++) {
      const ph = ((j + 0.5) * 2 * Math.PI) / NP;
      const d: Vec3 = [r * Math.cos(ph) - C[0], r * Math.sin(ph) - C[1], -C[2]];
      const l = Math.hypot(...d);
      const w = toCam([d[0] / l, d[1] / l, d[2] / l]);
      const dO = (dA * h) / (l * l * l);
      const b = shBasis(w);
      for (let k = 0; k < 9; k++) sh[k] += L * b[k]! * dO;
    }
  }
  const l1: Vec3 = [sh[3], sh[1], sh[2]];
  const m = Math.hypot(...l1);
  const dir: Vec3 = m > 0 ? [l1[0] / m, l1[1] / m, l1[2] / m] : [0, 0, 1];
  const b = shBasis(dir);
  const E = Math.max(
    sh.reduce((a, c, k) => a + SH_A[k]! * b[k]! * c, 0),
    1e-30,
  );
  return { sh: sh.map((c) => c / E), dir, directional: Math.min(m / (1.7320508 * Math.max(sh[0], 1e-30)), 1) };
}

export class EnduranceRenderer {
  /** a level of detail is loaded (the coarsest first) */
  ready = false;
  private meshes: (Mesh | null)[] = LODS.map(() => null);
  private fetching: (Promise<void> | null)[] = LODS.map(() => null);
  private get: (url: string) => Promise<Response> = fetch;
  private lod = 0;
  /** redraws once a finer level has arrived */
  onLoaded: () => void = () => {};
  private uniform: GPUBuffer;
  private bind: { g: GPUBindGroup; moments: GPUBuffer } | null = null;
  private pipe: GPURenderPipeline;
  private comp: GPURenderPipeline;
  private box: Box | null = null;
  /** where it was drawn [x, y, w, h] (w = 0: not drawn), and its box's resolved depth (distance, coverage) */
  rect: [number, number, number, number] = [0, 0, 0, 0];
  private dummy: GPUTexture;

  constructor(
    private device: GPUDevice,
    wgsl: string,
  ) {
    const d = device;
    const module = d.createShaderModule({ code: wgsl, label: "endurance" });
    this.uniform = d.createBuffer({ size: 304, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.pipe = d.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vs",
        buffers: [
          {
            arrayStride: STRIDE,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
              { shaderLocation: 2, offset: 24, format: "float32" },
              { shaderLocation: 3, offset: 28, format: "float32" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "fs", targets: [{ format: "rgba16float" }, { format: "rg16float" }] },
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
        targets: [
          {
            format: "rgba16float",
            // premultiplied over; the alpha channel (the pixel's variance estimate) kept
            blend: {
              color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
    this.dummy = d.createTexture({ size: [1, 1], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING });
  }

  /** Downloads the coarsest level (0.7 MB); the finer ones follow when the ship is drawn larger. */
  load(get: (url: string) => Promise<Response> = fetch) {
    this.get = get;
    return this.fetchLod(0);
  }

  private fetchLod(i: number) {
    return (this.fetching[i] ??= (async () => {
      const mesh = await this.get(LODS[i]!.url).then((r) => r.arrayBuffer());
      const u32 = new Uint32Array(mesh, 0, 4);
      if (new TextDecoder().decode(new Uint8Array(mesh, 0, 4)) !== "ENDR" || u32[1] !== 1) throw new Error("bad endurance mesh");
      const nv = u32[2]!,
        ni = u32[3]!;
      const d = this.device;
      const vbuf = d.createBuffer({ size: nv * STRIDE, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(vbuf, 0, mesh, 40, nv * STRIDE);
      const ibuf = d.createBuffer({ size: ni * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(ibuf, 0, mesh, 40 + nv * STRIDE, ni * 4);
      this.meshes[i] = { vbuf, ibuf, count: ni };
      this.ready = true;
      if (i > 0) this.onLoaded();
    })());
  }

  /** The level for a box `w` px wide (±15 % of hysteresis), its download started; the finest loaded up to it drawn. */
  private meshFor(w: number): Mesh | null {
    let want = LODS.findIndex((l) => w <= l.upTo);
    if (want > this.lod && w <= LODS[this.lod]!.upTo * 1.15) want = this.lod;
    if (want < this.lod && this.lod > 0 && w > LODS[this.lod - 1]!.upTo * 0.85) want = this.lod;
    this.lod = want;
    if (!this.meshes[want]) this.fetchLod(want).catch((e) => console.error("Endurance:", e));
    // (a finer one released when far coarser is drawn: its buffers back when it is needed again)
    for (let i = want + 2; i < LODS.length; i++) {
      const m = this.meshes[i];
      if (m) {
        m.vbuf.destroy();
        m.ibuf.destroy();
        this.meshes[i] = null;
        this.fetching[i] = null;
      }
    }
    for (let i = want; i >= 0; i--) if (this.meshes[i]) return this.meshes[i]!;
    for (let i = want + 1; i < LODS.length; i++) if (this.meshes[i]) return this.meshes[i]!;
    return null;
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
    const W = hdr.width,
      H = hdr.height;
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
    const bx = Math.max(0, x0),
      by = Math.max(0, y0);
    const bw = Math.min(W, x1) - bx,
      bh = Math.min(H, y1) - by;
    if (bw <= 0 || bh <= 0) return;
    const box = this.ensureBox(Math.ceil(bw / 64) * 64, Math.ceil(bh / 64) * 64);
    // the ship's axes in the camera frame (directions at rest, as the camera sees them), times its size
    const axis = (v: Vec3) => toCam(unit(mapToRest(v, cam))).map((c) => c * size) as Vec3;
    // the disk's light: its irradiance ~ the disk's solid angle (as the renderer's light meter), warm, on
    // spherical harmonics as the disk is seen from the ship; a faint fill from the lensed disk and the sky
    const r = Math.hypot(...C);
    const E = Math.min((0.75 * (Math.max(s.diskOuter, 2) ** 2 - 4)) / (r * r), 1) * (s.disk ? 1 : 0) * s.enduranceLight;
    const sh = diskSH(C, isco(s.spin), Math.max(s.diskOuter, isco(s.spin) + 1), (w) => toCam(unit(mapToRest(w, cam))));
    const u = new Float32Array(76);
    const uu = new Uint32Array(u.buffer);
    u.set([tanH, aspect, Math.max(dist - R * 1.2, 1e-3), dist + R * 1.2], 0);
    u.set([...axis(x), 0], 4);
    u.set([...axis(y), 0], 8);
    u.set([...axis(z), 0], 12);
    u.set([...p, pre], 16);
    // (its dominant direction lights the highlights: the part of it that comes from there)
    u.set([...sh.dir, 1.7 * E * sh.directional], 20);
    // (its lights: small blue glints, display-referred — the Film grade and the bloom make much more of them)
    u.set([1, 0.82, 0.62, 0.12 * glow], 24);
    u.set([0.06 * E + 0.004, 0.05 * E + 0.004, 0.045 * E + 0.005, 0], 28);
    for (let k = 0; k < 9; k++) u[40 + 4 * k] = 1.7 * E * sh.sh[k]!;
    u.set([bx, by, box.w, box.h], 32);
    uu.set([W, H, 0, 0], 36);
    this.device.queue.writeBuffer(this.uniform, 0, u);
    const d = this.device;
    const mesh = this.meshFor(bw);
    if (!mesh) return;
    if (this.bind?.moments !== moments) {
      this.bind = {
        moments,
        g: d.createBindGroup({
          layout: this.pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.uniform } },
            { binding: 1, resource: { buffer: moments } },
          ],
        }),
      };
    }
    const rp = enc.beginRenderPass({
      label: "endurance",
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
    rp.setVertexBuffer(0, mesh.vbuf);
    rp.setIndexBuffer(mesh.ibuf, "uint32");
    rp.drawIndexed(mesh.count);
    rp.end();
    // composited over the traced image, within its box
    const cp = enc.beginRenderPass({
      label: "endurance composite",
      colorAttachments: [{ view: hdr.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: "load", storeOp: "store" }],
    });
    cp.setPipeline(this.comp);
    box.comp ??= d.createBindGroup({
      layout: this.comp.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 2, resource: box.resColor.createView() },
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
    // (kept while at most 1.5× the need: a full-screen ship no longer holds a box of 4× its pixels)
    if (b && b.w >= w && b.h >= h && b.w <= 1.5 * w + 64 && b.h <= 1.5 * h + 64) return b;
    if (b) for (const t of [b.color, b.depthColor, b.depth, b.resColor, b.resDepth]) t.destroy();
    const d = this.device;
    const ms = (format: GPUTextureFormat) =>
      d.createTexture({ size: [w, h], format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const res = (format: GPUTextureFormat) =>
      d.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    // (its depth: distance and coverage — two channels)
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
