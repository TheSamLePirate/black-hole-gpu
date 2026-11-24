// The James Webb Space Telescope (assets/jwst/jwst.bin, built by scripts/build-jwst.ts) rendered on
// its Sun–Earth L2 Halo orbit (system/jwst.ts). Drawn as the ISS is (station.ts; their common part in meshbox.ts):
// into a 4× MSAA depth-tested box, composited into the linear HDR image before bloom.
//
// Its life cycle (docs/GRAPHICS-PIPELINE.md, JWST): nothing on the GPU until it is approached — within
// JWST_PREPARE_KM the shader module, its three pipelines (compiled in the background: createRenderPipelineAsync)
// and the mesh (1.5 MB gzip) are made; drawn within JWST_DRAW_KM once ready and at least JWST_MIN_PX in radius
// on the image (closer than ~7 km at 1440 px and 60°: farther it is sub-pixel, the target's marker shows it);
// its 2048² Sun shadow map made and drawn only when it is JWST_SHADOW_PX or more across, in the telescope's own
// frame (the Sun's direction there changes by its slow roll alone: redrawn when that moves, kept otherwise);
// everything but the pipelines let go after JWST_RELEASE_S beyond JWST_RELEASE_KM.
import jwstUrl from "../assets/jwst/jwst.bin";

import type { Vec3 } from "./physics";
import { JWST_RADIUS_M } from "./system/jwst";
import { compositeMeshBox, MESH_STRIDE, MeshBox, meshBoxPass, meshBoxPipelines, sphereBox, sphereRadiusPx } from "./meshbox";

const SHADOW = 2048;
/** within it [km] the module, pipelines and mesh are prepared (the approach's last hours at a few km/s) */
export const JWST_PREPARE_KM = 100_000;
/** within it [km] it may be drawn (sub-pixel long before: JWST_MIN_PX decides) */
export const JWST_DRAW_KM = 2_000;
/** its least apparent radius drawn [px] (2 px across) */
export const JWST_MIN_PX = 1;
/** its least apparent radius [px] for its self-shadowing (finer than that the shadow map shows nothing) */
export const JWST_SHADOW_PX = 24;
/** beyond it [km], for JWST_RELEASE_S of wall time, its GPU memory is let go */
export const JWST_RELEASE_KM = 300_000;
export const JWST_RELEASE_S = 120;
/** the Sun's direction in the telescope's frame moved by more than this [rad]: its shadow map redrawn */
const SHADOW_REDRAW_RAD = 2e-4;

interface Mesh {
  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  count: number;
  reach: number;
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

interface Gpu {
  module: GPUShaderModule;
  uniform: GPUBuffer;
  pipe: GPURenderPipeline;
  shadowPipe: GPURenderPipeline;
  comp: GPURenderPipeline;
  shadowBind: GPUBindGroup;
  sampler: GPUSampler;
  /** a 1×1 depth stand-in bound while no shadow map is made */
  noShadow: GPUTexture;
}

export class JwstRenderer {
  /** prepared (pipelines and mesh) and drawable */
  ready = false;
  /** a preparation under way */
  preparing: Promise<void> | null = null;
  private gpu: Gpu | null = null;
  private mesh: Mesh | null = null;
  private shadowTex: GPUTexture | null = null;
  /** the Sun's direction in the model frame its shadow map was drawn for (null: to draw) */
  private shadowSun: Vec3 | null = null;
  private bind: { g: GPUBindGroup; sceneDepth: GPUBuffer; shadow: GPUTexture } | null = null;
  private box: MeshBox;
  /** when it went beyond JWST_RELEASE_KM [ms of wall time] (null: within) */
  private farSince: number | null = null;
  /** counts: preparations, releases, shadow maps drawn, frames drawn (tests, __bh) */
  stats = { prepared: 0, released: 0, shadowDraws: 0, draws: 0 };
  rect: [number, number, number, number] = [0, 0, 0, 0];

  depthTexture(): GPUTexture | null {
    return this.rect[2] > 0 ? (this.box.current?.resDepth ?? null) : null;
  }

  constructor(
    private device: GPUDevice,
    private wgsl: string,
  ) {
    this.box = new MeshBox(device);
  }

  /** Its pipelines (in the background) and its mesh made, once (again after a release: the mesh alone). */
  prepare(get: (url: string) => Promise<Response> = fetch): Promise<void> {
    if (this.ready) return Promise.resolve();
    return (this.preparing ??= (async () => {
      try {
        const d = this.device;
        if (!this.gpu) {
          const module = d.createShaderModule({ code: this.wgsl, label: "jwst" });
          const P = meshBoxPipelines(module, "jwst");
          const [pipe, shadowPipe, comp] = await Promise.all([
            d.createRenderPipelineAsync(P.main),
            d.createRenderPipelineAsync(P.shadow),
            d.createRenderPipelineAsync(P.comp),
          ]);
          const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === "error");
          if (errors.length) throw new Error(`jwst.wgsl: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("; ")}`);
          const uniform = d.createBuffer({ size: 10 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          this.gpu = {
            module,
            uniform,
            pipe,
            shadowPipe,
            comp,
            shadowBind: d.createBindGroup({
              layout: shadowPipe.getBindGroupLayout(0),
              entries: [{ binding: 0, resource: { buffer: uniform } }],
            }),
            sampler: d.createSampler({ compare: "less-equal", magFilter: "linear", minFilter: "linear" }),
            noShadow: d.createTexture({
              size: [1, 1],
              format: "depth32float",
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
            }),
          };
        }
        if (!this.mesh) this.mesh = await this.loadMesh(get);
        this.ready = true;
        this.stats.prepared++;
      } finally {
        this.preparing = null;
      }
    })());
  }

  private async loadMesh(get: (url: string) => Promise<Response>): Promise<Mesh> {
    const r = await get(jwstUrl);
    const buf = await new Response(r.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    const dv = new DataView(buf);
    if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== "JWST" || dv.getUint32(4, true) !== 1) throw new Error("bad jwst mesh");
    const nv = dv.getUint32(8, true);
    const ni = dv.getUint32(12, true);
    const reach = dv.getFloat32(16, true) || JWST_RADIUS_M;
    const off = 20;
    const d = this.device;
    const vbuf = d.createBuffer({ size: nv * MESH_STRIDE, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vbuf, 0, buf, off, nv * MESH_STRIDE);
    const ibuf = d.createBuffer({ size: ni * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ibuf, 0, buf, off + nv * MESH_STRIDE, ni * 4);
    return { vbuf, ibuf, count: ni, reach };
  }

  /** Told how far it is each frame it could be seen [km]: beyond JWST_RELEASE_KM for JWST_RELEASE_S, its GPU memory
   *  (mesh, shadow map, box) let go — the pipelines kept, a return only fetches the mesh again. */
  distance(km: number, nowMs: number) {
    if (!(km > JWST_RELEASE_KM)) {
      this.farSince = null;
      return;
    }
    this.farSince ??= nowMs;
    if (nowMs - this.farSince > JWST_RELEASE_S * 1000 && (this.mesh || this.shadowTex || this.box.current)) this.release();
  }

  /** Lets its GPU memory go (after the work submitted). */
  release() {
    if (this.preparing) return;
    const mesh = this.mesh,
      shadow = this.shadowTex;
    this.mesh = null;
    this.shadowTex = null;
    this.shadowSun = null;
    this.bind = null;
    this.ready = false;
    this.box.release();
    void this.device.queue.onSubmittedWorkDone().then(() => {
      mesh?.vbuf.destroy();
      mesh?.ibuf.destroy();
      shadow?.destroy();
    });
    this.stats.released++;
  }

  encode(enc: GPUCommandEncoder, hdr: GPUTexture, sceneDepth: GPUBuffer, v: JwstView) {
    this.rect = [0, 0, 0, 0];
    const g = this.gpu,
      mesh = this.mesh;
    if (!this.ready || !g || !mesh) return;
    const W = hdr.width,
      H = hdr.height;
    const p = v.rel;
    const R = mesh.reach + 0.5;
    const dist = Math.hypot(...p);
    // (sub-pixel: not drawn — 194 k vertices for no pixel)
    const px = sphereRadiusPx(R, dist, H, v.tanH);
    if (px < JWST_MIN_PX) return;
    const rect = sphereBox(p, R, W, H, v.tanH, v.aspect);
    if (!rect) return;
    const [bx, by, bw, bh] = rect;
    const box = this.box.ensure(Math.ceil(bw / 64) * 64, Math.ceil(bh / 64) * 64);
    // the Sun in the telescope's frame: its shadow map's light, the same while its attitude to the Sun holds
    const sunM: Vec3 = [
      v.sun[0] * v.axes[0][0] + v.sun[1] * v.axes[0][1] + v.sun[2] * v.axes[0][2],
      v.sun[0] * v.axes[1][0] + v.sun[1] * v.axes[1][1] + v.sun[2] * v.axes[1][2],
      v.sun[0] * v.axes[2][0] + v.sun[1] * v.axes[2][1] + v.sun[2] * v.axes[2][2],
    ];
    const shadowed = px >= JWST_SHADOW_PX;
    const u = new Float32Array(10 * 4);
    u.set([v.tanH * v.aspect, v.tanH, Math.max(dist - R * 1.4, 0.05), dist + R * 1.4], 0);
    u.set([bx, by, box.w, box.h], 4);
    u.set([W, H, v.mPerM, v.pre], 8);
    u.set([...v.sun, v.sunRadius], 12);
    // w = subtle deep-space starlight ambient ratio so the shaded 24k gold beryllium mirror glows subtly
    u.set([...v.sunE, 0.055], 16);
    u.set([...p, R], 20);
    // model -> camera 3x4 rows
    for (let r = 0; r < 3; r++) u.set([v.axes[0][r]!, v.axes[1][r]!, v.axes[2][r]!, p[r]!], 24 + 4 * r);
    // the Sun in the model frame (the shadow map's light), w: its shadows on
    u.set([...sunM, shadowed ? 1 : 0], 36);
    const d = this.device;
    d.queue.writeBuffer(g.uniform, 0, u);

    if (shadowed) {
      if (!this.shadowTex) {
        this.shadowTex = d.createTexture({
          size: [SHADOW, SHADOW],
          format: "depth32float",
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.shadowSun = null;
      }
      const s0 = this.shadowSun;
      if (!s0 || Math.hypot(sunM[0] - s0[0], sunM[1] - s0[1], sunM[2] - s0[2]) > SHADOW_REDRAW_RAD) {
        const sp = enc.beginRenderPass({
          label: "jwst: shadow map",
          colorAttachments: [],
          depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
        });
        sp.setPipeline(g.shadowPipe);
        sp.setBindGroup(0, g.shadowBind);
        sp.setVertexBuffer(0, mesh.vbuf);
        sp.setIndexBuffer(mesh.ibuf, "uint32");
        sp.drawIndexed(mesh.count);
        sp.end();
        this.shadowSun = sunM;
        this.stats.shadowDraws++;
      }
    }
    const shadowTex = this.shadowTex ?? g.noShadow;
    if (this.bind?.sceneDepth !== sceneDepth || this.bind.shadow !== shadowTex) {
      this.bind = {
        sceneDepth,
        shadow: shadowTex,
        g: d.createBindGroup({
          layout: g.pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: g.uniform } },
            { binding: 1, resource: { buffer: sceneDepth } },
            { binding: 2, resource: shadowTex.createView() },
            { binding: 3, resource: g.sampler },
          ],
        }),
      };
    }

    const rp = enc.beginRenderPass({ label: "jwst", ...meshBoxPass(box) });
    rp.setPipeline(g.pipe);
    rp.setBindGroup(0, this.bind.g);
    rp.setVertexBuffer(0, mesh.vbuf);
    rp.setIndexBuffer(mesh.ibuf, "uint32");
    rp.drawIndexed(mesh.count);
    rp.end();

    compositeMeshBox(d, enc, "jwst composite", hdr, g.comp, g.uniform, box, bx, by);
    this.rect = [bx, by, box.w, box.h];
    this.stats.draws++;
  }
}
