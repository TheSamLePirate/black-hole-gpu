// The spaceship carrying the camera (Interstellar's Ranger, assets/ranger, built by
// scripts/build-ranger.ts). The camera is mounted on it at one of several attach points: the ship
// is rigid in the camera's rest frame, so it is drawn with the tracer's own pinhole projection and
// composited over the traced image (before bloom: the disk's glare spills over its silhouette). It is
// lit by a light probe traced around the camera (lensed disk, Gargantua, sky) — see ship.wgsl.
import meshUrl from "../assets/ranger/ranger.bin";

import { shipToCamera, type Mount, type MountPose } from "./mounts";
import type { GpuProfiler } from "./gpuprof";

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
  /** pre-exposure of the HDR target (renderer.ts: preExposure) */
  pre?: number;
  /** re-entry glow: the air's flow direction (camera frame), level 0…1 */
  plasma?: [number, number, number, number];
  /** the camera's axes (x right, y up, z forward) in the light probe's axes (default: the same) */
  probeAxes?: [V3, V3, V3];
  /** the thrusters: see Thrust */
  thrust?: Thrust | null;
  /** display-referred emission scale: pre-exposure / 2^EV (a flame as bright whatever the exposure) */
  glow?: number;
}

/**
 * What the thrusters do (ship frame: x left, y up, z nose): the main engine's throttle, the RCS
 * translation command (a push, |f| ≤ 1) and the attitude effort (angular acceleration per axis,
 * −1…1), the air's density relative to sea level, a clock [s].
 */
export interface Thrust {
  throttle: number;
  force: V3;
  torque: V3;
  air: number;
  time: number;
}

/** A thruster (ship frame, metres): exit centre, exhaust direction, the exit's half-sizes and width axis. */
interface JetDef {
  p: V3;
  d: V3;
  half: [number, number];
  u: V3;
  main: boolean;
}

// the two main engines: the nozzles in the rear bays (the mesh's "nozzle" parts: 1.55 × 0.85 m,
// exits at z = −4.65); the attitude thrusters: quads on the hull's edges — the nose's and the tail
// wing's corners — and a pair at each wingtip for roll
const MAIN_EXIT: V3[] = [[1.76, 1.19, -4.62], [-1.76, 1.19, -4.62]];
const JET_DEFS: JetDef[] = (() => {
  const jets: JetDef[] = MAIN_EXIT.map((p) => ({ p, d: [0, 0, -1] as V3, half: [0.6, 0.33] as [number, number], u: [1, 0, 0] as V3, main: true }));
  const rcs = (p: V3, d: V3, u: V3) => jets.push({ p: [p[0] + 0.06 * d[0], p[1] + 0.06 * d[1], p[2] + 0.06 * d[2]], d, half: [0.08, 0.08], u, main: false });
  for (const sx of [1, -1]) {
    const nose: V3 = [2.52 * sx, 1.38, 7.55];
    const tail: V3 = [3.12 * sx, 1.5, -3.0];
    const tip: V3 = [4.1 * sx, 0.44, 0.1];
    rcs(nose, [sx, 0, 0], [0, 0, 1]);
    rcs([nose[0] - 0.25 * sx, nose[1] + 0.12, nose[2]], [0, 1, 0], [1, 0, 0]);
    rcs([nose[0] - 0.25 * sx, nose[1] - 0.12, nose[2]], [0, -1, 0], [1, 0, 0]);
    rcs(tail, [sx, 0, 0], [0, 0, 1]);
    rcs([tail[0] - 0.25 * sx, tail[1] + 0.12, tail[2]], [0, 1, 0], [1, 0, 0]);
    rcs([tail[0] - 0.25 * sx, tail[1] - 0.12, tail[2]], [0, -1, 0], [1, 0, 0]);
    rcs([tail[0] - 0.3 * sx, tail[1], tail[2] - 0.25], [0, 0, -1], [1, 0, 0]);
    rcs([tail[0] - 0.3 * sx, tail[1], tail[2] + 0.25], [0, 0, 1], [1, 0, 0]);
    rcs([tip[0], tip[1] + 0.08, tip[2]], [0, 1, 0], [0, 0, 1]);
    rcs([tip[0], tip[1] - 0.08, tip[2]], [0, -1, 0], [0, 0, 1]);
  }
  return jets;
})();
/** (the ship's centre of mass, roughly: the torque arms) */
const COM: V3 = [0, 1.25, 1.5];
const MAX_JETS = 32;
const JET_FLOATS = 16;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

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
  /** the ship over the whole image (premultiplied), only its box written: the display reads that box */
  resolved: GPUTexture;
  /** the MSAA targets and their resolve, the size of the ship's box (rounded up by 128 px) */
  box: { w: number; h: number; color: GPUTexture; depth: GPUTexture; small: GPUTexture } | null;
  /** where the box was drawn in the image [x, y, w, h] */
  rect: [number, number, number, number];
  /** the thrusters' flames over the whole image at half resolution (the display adds them); something drawn in it */
  plume: GPUTexture;
  plumeDepth: GPUTexture;
  plumeDirty: boolean;
}

export class ShipRenderer {
  ready = false;
  /** Light probe written by the tracer's `env` kernel (camera rest frame, equirectangular). */
  readonly envBuf: GPUBuffer;
  private envRaw: GPUTexture;
  private envSpec: GPUTexture;
  private ggxBufs: GPUBuffer[] = [];
  /** spherical harmonics of the probe (9 × rgb, then the dominant direction), camera axes */
  readonly shBuf: GPUBuffer;
  private uniform: GPUBuffer;
  private jetBuf: GPUBuffer;
  private jetData = new Float32Array(MAX_JETS * JET_FLOATS);
  private jetCount = 0;
  private plumeBinds: { plume: GPUBindGroup; plumeIn: GPUBindGroup; hullDepth: GPUBindGroup } | null = null;
  /** which jets have the camera inside their plume (drawn by their back faces) */
  private jetInside: boolean[] = [];
  /** the camera in the ship's frame */
  private camShip: V3 = [0, 0, 0];
  private vbuf: GPUBuffer | null = null;
  private ibuf: GPUBuffer | null = null;
  private count = 0;
  private bound = { c: [0, 0, 0] as V3, r: 1, lo: [-1, -1, -1] as V3, hi: [1, 1, 1] as V3 };
  private shadowTex: GPUTexture;
  private pipes!: {
    copy: GPUComputePipeline;
    down: GPUComputePipeline;
    ggx: GPUComputePipeline;
    sh: GPUComputePipeline;
    ship: GPURenderPipeline;
    shadow: GPURenderPipeline;
    comp: GPURenderPipeline;
    plume: GPURenderPipeline;
    plumeIn: GPURenderPipeline;
    hullDepth: GPURenderPipeline;
  };
  private envBinds: { copy: GPUBindGroup[]; down: GPUBindGroup[]; ggx: GPUBindGroup[]; sh: GPUBindGroup } | null = null;
  private shipBind: GPUBindGroup | null = null;
  private shadowBind: GPUBindGroup | null = null;
  private targets = new WeakMap<GPUTexture, ShipTargetRes>();

  /** the ship's bounding sphere in the camera frame and the projection's half-extents (the scissor) */
  private onScreen: { c: V3; r: number; tx: number; ty: number; corners: V3[] } | null = null;

  /** The pixels the ship can cover on a w × h target: [x, y, w, h] (the whole target when the camera is inside its sphere). */
  private scissor(w: number, h: number): [number, number, number, number] {
    const o = this.onScreen;
    // (the mesh's box projected: a corner at or behind the near plane — the camera in or at the
    // ship — the whole image)
    if (!o || o.corners.some((q) => q[2] < 0.06)) return [0, 0, w, h];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of o.corners) {
      const nx = q[0] / (q[2] * o.tx), ny = q[1] / (q[2] * o.ty);
      x0 = Math.min(x0, nx), x1 = Math.max(x1, nx), y0 = Math.min(y0, ny), y1 = Math.max(y1, ny);
    }
    // (a pixel of margin for the MSAA footprint)
    const mx = 4 / w, my = 4 / h;
    x0 -= mx, x1 += mx, y0 -= my, y1 += my;
    const px = (n: number) => Math.min(w, Math.max(0, Math.floor(((n + 1) / 2) * w)));
    const py = (n: number) => Math.min(h, Math.max(0, Math.floor(((1 - n) / 2) * h)));
    const X0 = px(Math.min(x0, x1)) , X1 = Math.min(w, px(Math.max(x0, x1)) + 2);
    const Y0 = py(Math.max(y0, y1)), Y1 = Math.min(h, py(Math.min(y0, y1)) + 2);
    return X1 > X0 && Y1 > Y0 ? [X0, Y0, X1 - X0, Y1 - Y0] : [0, 0, 1, 1];
  }

  private shadowTick = 0;
  /** the renderer's GPU profiler (timestamps per pass) */
  prof: GpuProfiler | null = null;
  private pass<T extends GPUComputePassDescriptor | GPURenderPassDescriptor>(label: string, d?: T): T {
    return this.prof ? this.prof.pass(label, d) : ((d ?? {}) as T);
  }

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
    this.uniform = d.createBuffer({ size: 64 + 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.jetBuf = d.createBuffer({ size: this.jetData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
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
        // (back faces culled: the mesh's inward-wound triangles are its hidden inner faces — none of its
        // pixels goes missing from 288 viewpoints around it — and the pass is ~20 % faster)
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
        multisample: { count: 4 },
      }),
      shadow: d.createRenderPipeline({
        layout: "auto",
        vertex: { ...vertex, entryPoint: "shadowVs" },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
      }),
      // the plumes: emission added over the sky (and the hull: the display adds them), in a pass of
      // their own at half resolution — soft, they need no more — hidden by the hull's depth drawn first
      // there; by their front faces, or by their back faces without the depth test for a plume the
      // camera is in (rare: then the hull does not hide it)
      ...(() => {
        const blend: GPUBlendState = {
          color: { srcFactor: "one", dstFactor: "one", operation: "add" },
          alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
        };
        const plume = (inside: boolean) => d.createRenderPipeline({
          layout: "auto",
          vertex: { module, entryPoint: "plumeVs" },
          fragment: { module, entryPoint: "plumeFs", targets: [{ format: "rgba16float", blend }] },
          primitive: { topology: "triangle-list", cullMode: inside ? "front" : "back" },
          depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: inside ? "always" : "less" },
        });
        return {
          plume: plume(false),
          plumeIn: plume(true),
          hullDepth: d.createRenderPipeline({
            layout: "auto",
            vertex: { ...vertex, entryPoint: "hullDepthVs" },
            fragment: { module, entryPoint: "hullDepthFs", targets: [{ format: "rgba16float", writeMask: 0 }] },
            primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
            depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
          }),
        };
      })(),
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
  async load(get: (url: string) => Promise<Response> = fetch) {
    const d = this.device;
    const mesh = await get(meshUrl).then((r) => r.arrayBuffer());
    const u32 = new Uint32Array(mesh, 0, 4);
    if (new TextDecoder().decode(new Uint8Array(mesh, 0, 4)) !== "RNGR" || u32[1] !== 2) throw new Error("bad ranger.bin");
    const nv = u32[2]!;
    const ni = u32[3]!;
    const bb = new Float32Array(mesh, 16, 6);
    const lo: V3 = [bb[0]!, bb[1]!, bb[2]!];
    const hi: V3 = [bb[3]!, bb[4]!, bb[5]!];
    this.bound.c = [0, 1, 2].map((k) => (lo[k]! + hi[k]!) / 2) as V3;
    this.bound.r = Math.hypot(...sub(hi, lo)) / 2;
    this.bound.lo = lo;
    this.bound.hi = hi;
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
        { binding: 9, resource: { buffer: this.jetBuf } },
      ],
    });

    const pb = (p: GPURenderPipeline, jets = true) => d.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniform } }, ...(jets ? [{ binding: 9, resource: { buffer: this.jetBuf } }] : [])],
    });
    this.plumeBinds = { plume: pb(this.pipes.plume), plumeIn: pb(this.pipes.plumeIn), hullDepth: pb(this.pipes.hullDepth, false) };
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
    let pass = enc.beginComputePass(this.pass("ship probe: mips"));
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
    pass.end();
    pass = enc.beginComputePass(this.pass("ship probe: GGX"));
    pass.setPipeline(this.pipes.ggx);
    this.envBinds.ggx.forEach((g, i) => {
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(...groups(i + 1));
    });
    pass.end();
    pass = enc.beginComputePass(this.pass("ship probe: SH"));
    pass.setPipeline(this.pipes.sh);
    pass.setBindGroup(0, this.envBinds.sh);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  /**
   * The thrusters firing now → the jets' buffer: both main engines at the throttle; each attitude
   * thruster by how much its push helps the translation asked and its torque the rotation asked,
   * pulsed (as real RCS valves are) when that is little.
   */
  private writeJets(th: Thrust | null | undefined) {
    const out = this.jetData;
    let n = 0;
    if (th) {
      const air = Math.min(Math.max(th.air, 0), 1);
      const tq = th.torque;
      const tl = Math.hypot(...tq);
      for (let i = 0; i < JET_DEFS.length && n < MAX_JETS; i++) {
        const J = JET_DEFS[i]!;
        let level: number;
        let len: number;
        if (J.main) {
          level = Math.min(Math.max(th.throttle, 0), 1);
          if (level < 0.01) continue;
          len = (4 + 20 * level) * (1 - 0.45 * air);
        } else {
          const F: V3 = [-J.d[0], -J.d[1], -J.d[2]];
          const arm = sub(J.p, COM);
          // (the flight computer's rates turn the ship the other way round from the right-hand rule
          // in its frame — +y turns the nose right, +x lifts it: pilot.ts — so its torque, likewise)
          const tau = cross(F, arm);
          const taul = Math.hypot(...tau);
          const push = Math.max(0, dot(F, th.force));
          const turn = tl > 0.02 && taul > 1e-6 ? smooth(0.35, 0.85, dot(tau, tq) / (taul * tl)) * Math.min(tl, 1) : 0;
          const want = Math.min(1, push + turn);
          if (want < 0.03) continue;
          // (pulse-width modulated below full demand: ~9 pulses a second)
          const phase = (th.time * 9 + i * 0.37) % 1;
          if (want < 0.9 && phase > Math.max(want, 0.2)) continue;
          level = Math.min(1, 0.55 + want);
          len = 1.2 + 1.6 * level;
        }
        out.set([...J.p, level, ...J.d, J.main ? 0 : 1, J.half[0], J.half[1], len, (i * 0.618) % 1, ...J.u, 0], n * JET_FLOATS);
        // (the camera inside its proxy — the shader's frustum, a margin for the near plane)
        const spread = J.main ? 0.16 * (1 - air) + 0.03 * air : 0.45;
        const o = sub(this.camShip, J.p);
        const sAx = dot(o, J.d);
        const rad = (h: number) => (h + Math.max(sAx, 0) * spread) * 1.45 + 0.05 + 0.3;
        this.jetInside[n] = sAx > -0.45 && sAx < 0.85 * len + 0.3 && Math.abs(dot(o, J.u)) < rad(J.half[0]) && Math.abs(dot(o, cross(J.d, J.u))) < rad(J.half[1]);
        n++;
      }
    }
    this.jetCount = n;
    if (n) this.device.queue.writeBuffer(this.jetBuf, 0, out, 0, n * JET_FLOATS);
  }

  private writeUniform(v: ShipView) {
    const { S: R, t } = shipToCamera(v.mount, v.look[0], v.look[1]);
    // (the camera in the ship's frame: −Rᵀ t)
    this.camShip = [0, 1, 2].map((k) => -(R[0]![k]! * t[0] + R[1]![k]! * t[1] + R[2]![k]! * t[2])) as V3;
    this.writeJets(v.thrust);
    // column-major mat4: columns = images of the ship's x, y, z axes, then the translation
    const m = new Float32Array(56);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = R[r]![c]!;
    m.set([...t, 1], 12);
    const tanH = Math.tan((v.fov * Math.PI) / 360);
    m.set([tanH * v.aspect, tanH, 0.05, 80], 16);
    m.set([v.albedo, v.metal, v.rough, SPEC_MIPS], 20);
    const c = R.map((r) => dot(r, this.bound.c) + 0) as V3;
    m.set([c[0] + t[0], c[1] + t[1], c[2] + t[2], this.bound.r * 1.02], 24);
    // (the mesh's box corners in the camera frame: the screen box)
    const corners: V3[] = [];
    for (let k = 0; k < 8; k++) {
      const q: V3 = [k & 1 ? this.bound.hi[0] : this.bound.lo[0], k & 2 ? this.bound.hi[1] : this.bound.lo[1], k & 4 ? this.bound.hi[2] : this.bound.lo[2]];
      corners.push([dot(R[0]!, q) + t[0], dot(R[1]!, q) + t[1], dot(R[2]!, q) + t[2]]);
    }
    this.onScreen = { c: [c[0] + t[0], c[1] + t[1], c[2] + t[2]], r: this.bound.r * 1.02, tx: tanH * v.aspect, ty: tanH, corners };
    m.set([v.light * (v.pre ?? 1), v.coat, v.pre ?? 1, 0], 28);
    m.set(v.plasma ?? [0, 0, 1, 0], 32);
    const ax = v.probeAxes ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    ax.forEach((a, i) => m.set([...a, 0], 36 + 4 * i));
    m.set([0, 0, 1, 1], 48); // (the whole image: encodeShip narrows it to the ship's box)
    m.set([this.jetCount, v.glow ?? 1, v.thrust?.time ?? 0, v.thrust?.air ?? 0], 52);
    this.device.queue.writeBuffer(this.uniform, 0, m);
  }

  /** The ship's own images for an HDR target (its size): created on first use. */
  target(hdr: GPUTexture): ShipTargetRes {
    let res = this.targets.get(hdr);
    if (!res || res.w !== hdr.width || res.h !== hdr.height) {
      if (res) this.forget(hdr);
      const resolved = this.device.createTexture({
        size: [hdr.width, hdr.height], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const plume = this.device.createTexture({
        size: [Math.ceil(hdr.width / 2), Math.ceil(hdr.height / 2)], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      const plumeDepth = this.device.createTexture({ size: [plume.width, plume.height], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
      res = { w: hdr.width, h: hdr.height, resolved, box: null, rect: [0, 0, 0, 0], plume, plumeDepth, plumeDirty: true };
      this.targets.set(hdr, res);
    }
    return res;
  }

  /** Where the ship was drawn last in this target's image: [x, y, w, h] (for the display). */
  rectFor(hdr: GPUTexture): [number, number, number, number] {
    return this.targets.get(hdr)?.rect ?? [0, 0, 0, 0];
  }

  /**
   * Draws the ship for an HDR target: the shadow map; the shading with 4× MSAA in targets the size of
   * its box on screen (its bounding sphere's, rounded up by 128 px: a chase view's ship covers a
   * fraction of the image — the whole-screen MSAA clear and resolve cost as much as the drawing),
   * resolved and copied into its image, which the display composites over the traced one.
   */
  encodeShip(enc: GPUCommandEncoder, hdr: GPUTexture, v: ShipView) {
    if (!this.ready) return;
    const res = this.target(hdr);
    this.writeUniform(v);
    // the box: the sphere's screen box within the image, its size rounded up (few re-allocations)
    const W = hdr.width, H = hdr.height;
    const sc = this.scissor(W, H);
    const up = (x: number, max: number) => Math.min(max, Math.max(128, Math.ceil(x / 128) * 128));
    const bw = up(sc[2], W), bh = up(sc[3], H);
    const x0 = Math.min(Math.max(sc[0], 0), W - bw), y0 = Math.min(Math.max(sc[1], 0), H - bh);
    if (!res.box || res.box.w !== bw || res.box.h !== bh) {
      const old = res.box;
      if (old) this.device.queue.onSubmittedWorkDone().then(() => [old.color, old.depth, old.small].forEach((t) => t.destroy()));
      const d = this.device, size = [bw, bh];
      res.box = {
        w: bw, h: bh,
        color: d.createTexture({ size, format: "rgba16float", sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT }),
        depth: d.createTexture({ size, format: "depth24plus", sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }),
        small: d.createTexture({ size, format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }),
      };
    }
    // (the box's ndc: centre and scale of the full image's ndc; y up, pixels down)
    this.device.queue.writeBuffer(this.uniform, 192, new Float32Array([(2 * x0 + bw) / W - 1, 1 - (2 * y0 + bh) / H, W / bw, H / bh]));
    res.rect = [x0, y0, bw, bh];
    // (the self-shadowing, every other frame: the light turns slowly against the ship)
    if (this.shadowTick++ % 2 === 0) {
      const sp = enc.beginRenderPass(this.pass("ship: shadow map", {
        colorAttachments: [],
        depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
      }));
      sp.setPipeline(this.pipes.shadow);
      sp.setBindGroup(0, this.shadowBind!);
      sp.setVertexBuffer(0, this.vbuf!);
      sp.setIndexBuffer(this.ibuf!, "uint32");
      sp.drawIndexed(this.count);
      sp.end();
    }
    const b = res.box;
    const jets = this.jetCount > 0;
    const rp = enc.beginRenderPass(this.pass("ship: shading (MSAA)", {
      colorAttachments: [{ view: b.color.createView(), resolveTarget: b.small.createView(), loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 0] }],
      depthStencilAttachment: { view: b.depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    }));
    rp.setPipeline(this.pipes.ship);
    rp.setBindGroup(0, this.shipBind!);
    rp.setVertexBuffer(0, this.vbuf!);
    rp.setIndexBuffer(this.ibuf!, "uint32");
    rp.drawIndexed(this.count);
    rp.end();
    if (jets) {
      const pp = enc.beginRenderPass(this.pass("ship: thrusters", {
        colorAttachments: [{ view: res.plume.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
        depthStencilAttachment: { view: res.plumeDepth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
      }));
      const B = this.plumeBinds!;
      pp.setPipeline(this.pipes.hullDepth);
      pp.setBindGroup(0, B.hullDepth);
      pp.setVertexBuffer(0, this.vbuf!);
      pp.setIndexBuffer(this.ibuf!, "uint32");
      pp.drawIndexed(this.count);
      for (const inside of [false, true]) {
        pp.setPipeline(inside ? this.pipes.plumeIn : this.pipes.plume);
        pp.setBindGroup(0, inside ? B.plumeIn : B.plume);
        for (let i = 0; i < this.jetCount; i++) if (this.jetInside[i] === inside) pp.draw(36, 1, 0, i);
      }
      pp.end();
      res.plumeDirty = true;
    } else if (res.plumeDirty) {
      // (the flames out: their image cleared once)
      enc.beginRenderPass({ colorAttachments: [{ view: res.plume.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] }).end();
      res.plumeDirty = false;
    }
    enc.copyTextureToTexture({ texture: b.small }, { texture: res.resolved, origin: [x0, y0] }, [bw, bh]);
  }

  /** Frees the per-target buffers of a destroyed HDR texture. */
  forget(hdr: GPUTexture) {
    const r = this.targets.get(hdr);
    if (!r) return;
    r.resolved.destroy();
    r.plume.destroy();
    r.plumeDepth.destroy();
    if (r.box) [r.box.color, r.box.depth, r.box.small].forEach((t) => t.destroy());
    this.targets.delete(hdr);
  }
}
