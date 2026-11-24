// The International Space Station (assets/iss, built by scripts/build-iss.py from NASA's model) drawn
// where it is on its orbit (system/iss.ts), its joints turned so that its solar arrays face the Sun.
// As the Endurance is drawn (endurance.ts): with the tracer's pinhole, into a box of the image (4×
// MSAA), hidden where the traced scene is nearer, composited over the traced image before bloom. Two
// levels of detail: 93 k triangles (2.1 MB) at first and from afar, 537 k (9.9 MB) near.
import lod0Url from "../assets/iss/iss-lod0.bin";
import lod1Url from "../assets/iss/iss-lod1.bin";

import type { Vec3 } from "./physics";
import { m34mul, partTransforms, setStationGeometry, PORT_NAMES, type M34, type StationJoint, type StationPort } from "./system/iss";
import { dragonMesh } from "./system/dragon";
import { stationHulls, TriBVH } from "./system/collide";
import { compositeMeshBox, MESH_STRIDE as STRIDE, MeshBox, meshBoxPass, meshBoxPipelines, sphereBox } from "./meshbox";

/** the shadow map's reach: the station's bounding sphere [m] */
const REACH = 62;
const SHADOW = 2048;

interface Mesh {
  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  count: number;
}

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
  /** (Q6-ISS) the visiting Crew Dragon at Harmony's forward port drawn — system/dragon.ts; off while a craft flown is near the
   *  station (issTrack.near): that port the player's */
  dragon?: boolean;
}

export class StationRenderer {
  /** the station's module (read back at start-up for its compilation messages) */
  readonly module: GPUShaderModule;
  ready = false;
  joints: StationJoint[] = [];
  ports: StationPort[] = [];
  private meshes: (Mesh | null)[] = [null, null];
  /** (Q6-ISS) the docked Crew Dragon's own buffers — system/dragon.ts, at the first port —, drawn after the station's */
  private dragon: Mesh | null = null;
  /** the frames it was drawn in (a test's count) */
  dragonDraws = 0;
  private fetching: (Promise<void> | null)[] = [null, null];
  private get: (url: string) => Promise<Response> = fetch;
  private uniform: GPUBuffer;
  private pipe: GPURenderPipeline;
  private shadowPipe: GPURenderPipeline;
  private comp: GPURenderPipeline;
  private shadowTex: GPUTexture;
  private bind: { g: GPUBindGroup; sceneDepth: GPUBuffer } | null = null;
  private shadowBind: GPUBindGroup;
  private box: MeshBox;
  /** its box's resolved depth (distance [m], coverage): the Ranger hidden behind it */
  depthTexture(): GPUTexture | null {
    return this.rect[2] > 0 ? (this.box.current?.resDepth ?? null) : null;
  }
  /** where it was drawn [x, y, w, h] (w = 0: not drawn) */
  rect: [number, number, number, number] = [0, 0, 0, 0];
  /** called when the finer level has come in */
  onLoaded: () => void = () => {};

  constructor(
    private device: GPUDevice,
    wgsl: string,
  ) {
    const d = device;
    const module = (this.module = d.createShaderModule({ code: wgsl, label: "station" }));
    this.uniform = d.createBuffer({ size: (6 + 9 + 39) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    // (meshbox.ts: the pipelines it shares with JWST's — its own created at start-up, as before)
    const P = meshBoxPipelines(module, "station");
    this.pipe = d.createRenderPipeline(P.main);
    this.shadowPipe = d.createRenderPipeline(P.shadow);
    this.comp = d.createRenderPipeline(P.comp);
    this.box = new MeshBox(d);
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
      const nv = u32[2]!,
        ni = u32[3]!,
        nj = u32[4]!,
        np = u32[5]!;
      const jf = new Float32Array(buf, 24, nj * 12);
      const pf = new Float32Array(buf, 24 + nj * 48, np * 8);
      const v3 = (f: Float32Array, o: number): Vec3 => [f[o]!, f[o + 1]!, f[o + 2]!];
      this.joints = Array.from({ length: nj }, (_, k) => ({
        pivot: v3(jf, 12 * k),
        axis: v3(jf, 12 * k + 3),
        normal: v3(jf, 12 * k + 6),
        parent: Math.round(jf[12 * k + 9]!),
        kind: Math.round(jf[12 * k + 10]!),
      }));
      this.ports = Array.from({ length: np }, (_, k) => ({
        centre: v3(pf, 8 * k),
        axis: v3(pf, 8 * k + 3),
        name: PORT_NAMES[k] ?? `port ${k + 1}`,
      }));
      setStationGeometry(this.joints, this.ports);
      if (!this.dragon && this.ports[0]) {
        const dm = dragonMesh(this.ports[0].centre, this.ports[0].axis);
        const dvb = this.device.createBuffer({ size: dm.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        this.device.queue.writeBuffer(dvb, 0, dm.vertices);
        const dib = this.device.createBuffer({ size: dm.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        this.device.queue.writeBuffer(dib, 0, dm.indices);
        this.dragon = { vbuf: dvb, ibuf: dib, count: dm.count };
      }
      const off = 24 + nj * 48 + np * 32;
      const d = this.device;
      const vbuf = d.createBuffer({ size: nv * STRIDE, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(vbuf, 0, buf, off, nv * STRIDE);
      const ibuf = d.createBuffer({ size: ni * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(ibuf, 0, buf, off + nv * STRIDE, ni * 4);
      this.meshes[i] = { vbuf, ibuf, count: ni };
      // (the coarse level: its parts for contacts, each in its own rest frame)
      if (i === 0) {
        const f = new Float32Array(buf, off, (nv * STRIDE) / 4);
        const u8 = new Uint8Array(buf, off, nv * STRIDE);
        const idx = new Uint32Array(buf, off + nv * STRIDE, ni);
        const pos = new Float32Array(nv * 3);
        for (let k = 0; k < nv; k++) pos.set(f.subarray(6 * k, 6 * k + 3), 3 * k);
        const lists: number[][] = [];
        for (let t = 0; t < ni; t += 3) (lists[u8[STRIDE * idx[t]! + 20]!] ??= []).push(idx[t]!, idx[t + 1]!, idx[t + 2]!);
        lists.forEach((l, k) => (stationHulls[k] = l ? new TriBVH(pos, new Uint32Array(l)) : null));
      }
      this.ready = true;
      if (i > 0) this.onLoaded();
    })());
  }

  /** The parts' transforms, station frame at rest → station frame (the joints turned). */
  partMatrices(angles: number[]): M34[] {
    return partTransforms(this.joints, angles);
  }

  /** Draws it (when on screen) into a box and composites it into `hdr`. */
  encode(enc: GPUCommandEncoder, hdr: GPUTexture, sceneDepth: GPUBuffer, v: StationView) {
    this.rect = [0, 0, 0, 0];
    if (!this.ready) return;
    const W = hdr.width,
      H = hdr.height;
    const p = v.rel;
    const R = REACH;
    const dist = Math.hypot(...p);
    // the box: the bounding sphere's projection (all of the image when the camera is inside it — meshbox.ts)
    const rect = sphereBox(p, R, W, H, v.tanH, v.aspect);
    if (!rect) return;
    const [bx, by, bw, bh] = rect;
    // (the finer level near: its download started when first wanted)
    const fine = dist < 2500 || bw > 500;
    if (fine && !this.meshes[1]) this.fetchLod(1).catch((e) => console.error("ISS:", e));
    const mesh = (fine && this.meshes[1]) || this.meshes[0] || this.meshes[1];
    if (!mesh) return;
    const box = this.box.ensure(Math.ceil(bw / 64) * 64, Math.ceil(bh / 64) * 64);
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
      const M = m34mul(S, T);
      for (let r = 0; r < 3; r++) u.set([M[0][r]!, M[1][r]!, M[2][r]!, M[3][r]!], 60 + 12 * k + 4 * r);
    });
    this.device.queue.writeBuffer(this.uniform, 0, u);
    const d = this.device;
    // its shadow map (from the Sun), then the shading
    const sp = enc.beginRenderPass({
      label: "station: shadow map",
      colorAttachments: [],
      depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    sp.setPipeline(this.shadowPipe);
    sp.setBindGroup(0, this.shadowBind);
    sp.setVertexBuffer(0, mesh.vbuf);
    sp.setIndexBuffer(mesh.ibuf, "uint32");
    sp.drawIndexed(mesh.count);
    if (v.dragon && this.dragon) {
      sp.setVertexBuffer(0, this.dragon.vbuf);
      sp.setIndexBuffer(this.dragon.ibuf, "uint32");
      sp.drawIndexed(this.dragon.count);
    }
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
    const rp = enc.beginRenderPass({ label: "station", ...meshBoxPass(box) });
    rp.setPipeline(this.pipe);
    rp.setBindGroup(0, this.bind.g);
    rp.setVertexBuffer(0, mesh.vbuf);
    rp.setIndexBuffer(mesh.ibuf, "uint32");
    rp.drawIndexed(mesh.count);
    if (v.dragon && this.dragon) {
      this.dragonDraws++;
      rp.setVertexBuffer(0, this.dragon.vbuf);
      rp.setIndexBuffer(this.dragon.ibuf, "uint32");
      rp.drawIndexed(this.dragon.count);
    }
    rp.end();
    compositeMeshBox(d, enc, "station composite", hdr, this.comp, this.uniform, box, bx, by);
    this.rect = [bx, by, box.w, box.h];
  }
}
