/**
 * PLAN-J2 J2-0 — the image's sharpness, image by image (docs/PLAN-J2-PAGES-RECONSTRUCTION.md §3, §4: "pas de flou intermittent à
 * chaque changement d'échelle"). A diagnostic, off by default (renderer.sharpProbe): when on, each image drawn ends with one compute
 * pass over the scene's colour as the display receives it (renderer.sceneColor's: the temporal upsampling's image where it ran,
 * else the native `hdr` — before the optics, the HUD, the tone curve), in a box of it (fractions of the image: by default the view
 * through the F-35's canopy, motion-quality's BOX): the mean energy of the Laplacian of its luminance, brought to the display's
 * scale (× exposure) then compressed (L / (1 + L)), its white points — over the SDR's white and 1.5 × their four neighbours: a sea's
 * glint, the J0 flight's white points — counted apart and left out (one of them outweighed the whole image) — the measure of
 * tests/e2e/motion-quality.e2e.test.ts on the 8-bit shots, here in linear light, every image, without reading the image back.
 * Its workgroups' partial sums are copied to a mapped buffer (a ring of four; an image whose buffer is still mapping is skipped
 * and counted) and summed on the CPU: `log` gets one row an image — its stamp, its time, the energy, the image's size, its scale
 * to the canvas, its source, the renderer's phase. Off: nothing is created, nothing encoded.
 */
const WGSL = /* wgsl */ `
struct U { box: vec4u, exposure: f32, p0: f32, p1: f32, p2: f32 };
@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var<uniform> u: U;
@group(0) @binding(2) var<storage, read_write> part: array<f32>;
var<workgroup> acc: array<f32, 256>;
var<workgroup> cnt: array<f32, 256>;
fn lum(p: vec2i) -> f32 { return max(u.exposure * dot(textureLoad(img, p, 0).rgb, vec3f(0.2126, 0.7152, 0.0722)), 0.0); }
fn tone(l: f32) -> f32 { return l / (1.0 + l); }
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3u,
    @builtin(num_workgroups) nw: vec3u) {
  let p = vec2i(u.box.xy + g.xy);
  var e = 0.0;
  var c = 0.0;
  if (p.x < i32(u.box.z) && p.y < i32(u.box.w)) {
    let l0 = lum(p);
    let n = vec4f(lum(p + vec2i(1, 0)), lum(p - vec2i(1, 0)), lum(p + vec2i(0, 1)), lum(p - vec2i(0, 1)));
    // (a white point: over the SDR's white and 1.5 × its four neighbours — counted, left out of the energy: one such pixel in the
    // box outweighed the whole image's detail)
    if (l0 > 1.0 && l0 > 1.5 * 0.25 * (n.x + n.y + n.z + n.w)) {
      c = 1.0;
    } else {
      let l = 4.0 * tone(l0) - tone(n.x) - tone(n.y) - tone(n.z) - tone(n.w);
      e = l * l;
    }
  }
  acc[li] = e;
  cnt[li] = c;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { acc[li] += acc[li + s]; cnt[li] += cnt[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) { let k = wg.y * nw.x + wg.x; part[2u * k] = acc[0]; part[2u * k + 1u] = cnt[0]; }
}`;

export interface SharpRow {
  /** the renderer's frame stamp */
  frame: number;
  /** performance.now() at its encoding [ms] */
  t: number;
  /** the Laplacian's mean energy in the box (compressed luminance, × 1e4), the white points left out */
  sharp: number;
  /** the white points in the box: pixels over the SDR's white (× exposure > 1) and 1.5 × their four neighbours' mean */
  points: number;
  width: number;
  height: number;
  /** the image's width over the canvas's (the render scale; 1 where the temporal upsampling ran: its image is the canvas's) */
  scale: number;
  /** the live image's own scale to the canvas (the internal resolution, upsampled or not) */
  renderScale: number;
  source: "taau image" | "hdr";
  phase: string;
  /** the renderer's global invalidations so far (renderer.invalidations): a step between two rows, an invalidation between them */
  invalidations: number;
}

export class SharpnessProbe {
  /** the box [fractions of the image: x0, y0, x1, y1] (motion-quality's BOX of its 1600 × 1000 image by default) */
  box: [number, number, number, number] = [380 / 1600, 120 / 1000, 1220 / 1600, 700 / 1000];
  readonly log: SharpRow[] = [];
  /** the images skipped (every buffer of the ring still mapping) */
  skipped = 0;
  private pipeline: GPUComputePipeline;
  private uniform: GPUBuffer;
  private part: GPUBuffer | null = null;
  private partN = 0;
  private ring: { buf: GPUBuffer; busy: boolean }[] = [];
  private pending: { buf: { buf: GPUBuffer; busy: boolean }; n: number; gn: number; row: Omit<SharpRow, "sharp" | "points"> }[] = [];
  constructor(private device: GPUDevice) {
    const module = device.createShaderModule({ code: WGSL, label: "sharpness probe" });
    this.pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" }, label: "sharpness probe" });
    this.uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: "sharpness probe" });
  }
  /** encodes the measure of tex (its first level) into enc; flush() after the submission */
  encode(
    enc: GPUCommandEncoder,
    tex: GPUTexture,
    w: number,
    h: number,
    exposure: number,
    row: Omit<SharpRow, "sharp" | "points" | "width" | "height">,
  ): void {
    const x0 = Math.max(1, Math.floor(this.box[0] * w)),
      y0 = Math.max(1, Math.floor(this.box[1] * h)),
      x1 = Math.min(w - 1, Math.ceil(this.box[2] * w)),
      y1 = Math.min(h - 1, Math.ceil(this.box[3] * h));
    if (x1 <= x0 || y1 <= y0) return;
    const gx = Math.ceil((x1 - x0) / 16),
      gy = Math.ceil((y1 - y0) / 16),
      n = gx * gy;
    const slot = this.ring.find((r) => !r.busy) ?? (this.ring.length < 4 ? this.newSlot() : null);
    if (!slot) {
      this.skipped++;
      return;
    }
    if (!this.part || this.partN < n) {
      this.part?.destroy();
      this.partN = Math.max(n, 4096);
      this.part = this.device.createBuffer({ size: 8 * this.partN, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      for (const r of this.ring) r.buf.destroy();
      this.ring = [];
      this.encode(enc, tex, w, h, exposure, row);
      return;
    }
    const u = new ArrayBuffer(32);
    new Uint32Array(u, 0, 4).set([x0, y0, x1, y1]);
    new Float32Array(u, 16, 4).set([exposure, 0, 0, 0]);
    this.device.queue.writeBuffer(this.uniform, 0, u);
    const bind = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: tex.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
        { binding: 1, resource: { buffer: this.uniform } },
        { binding: 2, resource: { buffer: this.part } },
      ],
    });
    const pass = enc.beginComputePass({ label: "sharpness probe" });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(gx, gy);
    pass.end();
    enc.copyBufferToBuffer(this.part, 0, slot.buf, 0, 8 * n);
    slot.busy = true;
    this.pending.push({ buf: slot, n: (x1 - x0) * (y1 - y0), gn: n, row: { ...row, width: w, height: h } });
  }
  private newSlot() {
    const s = {
      buf: this.device.createBuffer({ size: 8 * Math.max(this.partN, 4096), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      busy: false,
    };
    this.ring.push(s);
    return s;
  }
  /** after the submission: the images encoded read back as they come */
  flush() {
    for (const p of this.pending.splice(0)) {
      const gn = p.gn;
      p.buf.buf
        .mapAsync(GPUMapMode.READ, 0, 8 * gn)
        .then(() => {
          const a = new Float32Array(p.buf.buf.getMappedRange(0, 8 * gn));
          let s = 0,
            c = 0;
          for (let i = 0; i < gn; i++) {
            s += a[2 * i]!;
            c += a[2 * i + 1]!;
          }
          p.buf.buf.unmap();
          this.log.push({ ...p.row, sharp: (1e4 * s) / Math.max(p.n, 1), points: Math.round(c) });
          if (this.log.length > 20000) this.log.splice(0, this.log.length - 20000);
        })
        .catch(() => {})
        .finally(() => (p.buf.busy = false));
    }
  }
  destroy() {
    this.part?.destroy();
    for (const r of this.ring) r.buf.destroy();
    this.uniform.destroy();
  }
}
