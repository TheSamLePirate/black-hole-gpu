// The system map in WebGPU (PLAN-VAISSEAUX K3): the projected scene (camera.ts) rasterised with depth — the spheres as
// lit impostors (the night side dark, the Sun's glow, the hole black under its rim, the mouth a ring), drawn first and
// hiding what passes behind them; the orbits and paths as antialiased ribbons, dashed where they are. To its own
// canvas (the view draws it on the console's, the labels over it). Asked for only when the map is first shown — the
// globe's rule; the shader inline (the crew's bundle has no shader files).

import type { Projected } from "./camera";

const WGSL = /* wgsl */ `
struct U { size: vec2f, dpr: f32, pad: f32 };
@group(0) @binding(0) var<uniform> u: U;

fn clip(xy: vec2f, z: f32) -> vec4f {
  return vec4f(xy.x / u.size.x * 2.0 - 1.0, 1.0 - xy.y / u.size.y * 2.0, z, 1.0);
}

struct LV {
  @builtin(position) p: vec4f,
  @location(0) col: vec4f,
  @location(1) edge: f32,
  @location(2) along: f32,
  @location(3) dashed: f32,
  @location(4) w: f32,
};
@vertex fn vl(@location(0) xy: vec2f, @location(1) z: f32, @location(2) edge: f32, @location(3) along: f32,
              @location(4) dashed: f32, @location(5) col: vec4f, @location(6) w: f32) -> LV {
  var o: LV;
  o.p = clip(xy * u.dpr, z);
  o.col = col;
  o.edge = edge;
  o.along = along;
  o.dashed = dashed;
  o.w = w;
  return o;
}
@fragment fn fl(i: LV) -> @location(0) vec4f {
  let h = i.w * 0.5 + 1.0;
  let d = abs(i.edge) * h;
  var a = i.col.a * (1.0 - smoothstep(i.w * 0.5 - 0.5, i.w * 0.5 + 0.6, d));
  if (i.dashed > 0.5 && fract(i.along / 11.0) > 0.55) { discard; }
  return vec4f(i.col.rgb * a, a);
}

struct DV {
  @builtin(position) p: vec4f,
  @location(0) q: vec2f,
  @location(1) col: vec3f,
  @location(2) shade: f32,
  @location(3) light: vec3f,
  @location(4) scale: f32,
  @location(5) rpx: f32,
  @location(6) z: f32,
};
struct FO { @location(0) c: vec4f, @builtin(frag_depth) d: f32 };
@vertex fn vd(@builtin(vertex_index) vi: u32, @location(0) c: vec2f, @location(1) z: f32, @location(2) r: f32,
              @location(3) col: vec3f, @location(4) shade: f32, @location(5) light: vec3f) -> DV {
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  // (a star's quad three times its disc: its glow; the others a pixel more: their edge antialiased)
  let s = select(1.0 + 1.5 / max(r, 1.0), 3.0, shade > 0.5 && shade < 1.5);
  let k = corners[vi] * s;
  var o: DV;
  o.p = clip((c + k * r) * u.dpr, z);
  o.q = k;
  o.col = col;
  o.shade = shade;
  o.light = light;
  o.scale = s;
  o.rpx = r * u.dpr;
  o.z = z;
  return o;
}
fn out(c: vec4f, d: f32) -> FO {
  var o: FO;
  o.c = c;
  o.d = d;
  return o;
}
@fragment fn fd(i: DV) -> FO {
  let r = length(i.q);
  let e = clamp((1.0 - r) * i.rpx + 0.5, 0.0, 1.0);
  // 1: a star — its disc and its glow
  if (i.shade > 0.5 && i.shade < 1.5) {
    let core = smoothstep(1.05, 0.85, r);
    let glow = exp(-max(r - 1.0, 0.0) * 2.2) * 0.55;
    let a = clamp(core + glow * (1.0 - core), 0.0, 1.0);
    let c = mix(i.col, vec3f(1.0, 0.98, 0.92), core * 0.6);
    // (its glow hides nothing: drawn far)
    return out(vec4f(c * a, a), select(1.0, i.z, r < 1.0));
  }
  if (r > 1.0 + 1.0 / max(i.rpx, 1.0)) { discard; }
  // 2: the hole — black, its photon ring's glow at the rim
  if (i.shade > 1.5 && i.shade < 2.5) {
    let rim = smoothstep(0.75, 1.0, r) * 0.9;
    let c = vec3f(1.0, 0.62, 0.25) * rim;
    return out(vec4f(c * e, e), i.z);
  }
  // 3: the wormhole's mouth — a bright ring, a faint blue inside
  if (i.shade > 2.5) {
    let ring = smoothstep(0.7, 0.95, r);
    let c = mix(vec3f(0.12, 0.2, 0.4), vec3f(0.7, 0.85, 1.0), ring);
    return out(vec4f(c * e, e), i.z);
  }
  // 0: a lit sphere (screen axes: x right, y down, z toward the eye)
  let n = vec3f(i.q.x, i.q.y, sqrt(max(0.0, 1.0 - r * r)));
  let diff = max(dot(n, normalize(i.light)), 0.0);
  let c = i.col * (0.07 + 0.93 * diff) + i.col * 0.15 * pow(1.0 - n.z, 3.0);
  return out(vec4f(c * e, e), i.z);
}
`;

const SHADE = { lit: 0, star: 1, hole: 2, mouth: 3 } as const;

export class SystemGpu {
  readonly canvas = document.createElement("canvas");
  private ctx: GPUCanvasContext;
  private lines: GPURenderPipeline;
  private discs: GPURenderPipeline;
  private uniforms: GPUBuffer;
  private group: GPUBindGroup;
  private depth: GPUTexture | null = null;
  private lineBuf: GPUBuffer | null = null;
  private discBuf: GPUBuffer | null = null;
  private constructor(private device: GPUDevice) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx = this.canvas.getContext("webgpu") as GPUCanvasContext;
    this.ctx.configure({ device, format, alphaMode: "premultiplied" });
    const module = device.createShaderModule({ code: WGSL });
    const blend: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    };
    const layout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {} }],
    });
    const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const F = 4;
    this.lines = device.createRenderPipeline({
      layout: pl,
      vertex: {
        module,
        entryPoint: "vl",
        buffers: [
          {
            arrayStride: 11 * F,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 2 * F, format: "float32" },
              { shaderLocation: 2, offset: 3 * F, format: "float32" },
              { shaderLocation: 3, offset: 4 * F, format: "float32" },
              { shaderLocation: 4, offset: 5 * F, format: "float32" },
              { shaderLocation: 5, offset: 6 * F, format: "float32x4" },
              { shaderLocation: 6, offset: 10 * F, format: "float32" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "fl", targets: [{ format, blend }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less-equal" },
    });
    this.discs = device.createRenderPipeline({
      layout: pl,
      vertex: {
        module,
        entryPoint: "vd",
        buffers: [
          {
            arrayStride: 12 * F,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 2 * F, format: "float32" },
              { shaderLocation: 2, offset: 3 * F, format: "float32" },
              { shaderLocation: 3, offset: 4 * F, format: "float32x3" },
              { shaderLocation: 4, offset: 7 * F, format: "float32" },
              { shaderLocation: 5, offset: 8 * F, format: "float32x3" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "fd", targets: [{ format, blend }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });
    this.uniforms = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.uniforms } }] });
  }
  /** WebGPU's device, if this one has it (null: none, refused, or lost) */
  static async create(): Promise<SystemGpu | null> {
    try {
      const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
      const adapter = await gpu?.requestAdapter();
      if (!adapter) return null;
      return new SystemGpu(await adapter.requestDevice());
    } catch {
      return null;
    }
  }
  /** a buffer big enough (grown by half again) */
  private fit(buf: GPUBuffer | null, bytes: number): GPUBuffer {
    if (buf && buf.size >= bytes) return buf;
    buf?.destroy();
    return this.device.createBuffer({
      size: Math.max(256, Math.ceil(bytes * 1.5)),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }
  /** the scene drawn, W×H CSS pixels at `dpr` */
  render(P: Projected, W: number, H: number, dpr: number) {
    const w = Math.max(1, Math.round(W * dpr)),
      h = Math.max(1, Math.round(H * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h || !this.depth) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.depth?.destroy();
      this.depth = this.device.createTexture({ size: [w, h], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    this.device.queue.writeBuffer(this.uniforms, 0, new Float32Array([W, H, dpr, 0]));
    // the ribbons: each segment two triangles, its half-width and a pixel more for the edge
    const L: number[] = [];
    for (const l of P.lines) {
      let along = 0;
      const hw = l.width / 2 + 1;
      for (let k = 1; k < l.pts.length; k++) {
        const a = l.pts[k - 1],
          b = l.pts[k];
        if (!a || !b) continue;
        const dx = b[0] - a[0],
          dy = b[1] - a[1];
        const n = Math.hypot(dx, dy);
        if (n < 1e-6 || n > 1e5) continue;
        const nx = (-dy / n) * hw,
          ny = (dx / n) * hw;
        const v = (x: number, y: number, z: number, e: number, s: number) => L.push(x, y, z, e, s, l.dashed ? 1 : 0, ...l.colour, l.width);
        const a0 = along,
          a1 = along + n;
        v(a[0] + nx, a[1] + ny, a[2], 1, a0);
        v(a[0] - nx, a[1] - ny, a[2], -1, a0);
        v(b[0] + nx, b[1] + ny, b[2], 1, a1);
        v(a[0] - nx, a[1] - ny, a[2], -1, a0);
        v(b[0] - nx, b[1] - ny, b[2], -1, a1);
        v(b[0] + nx, b[1] + ny, b[2], 1, a1);
        along = a1;
      }
    }
    const D: number[] = [];
    for (const d of P.discs) D.push(d.x, d.y, d.z, d.r, ...d.colour, SHADE[d.shade], ...d.light, 0);
    const lines = new Float32Array(L),
      discs = new Float32Array(D);
    this.lineBuf = this.fit(this.lineBuf, lines.byteLength);
    this.discBuf = this.fit(this.discBuf, discs.byteLength);
    if (lines.byteLength) this.device.queue.writeBuffer(this.lineBuf, 0, lines);
    if (discs.byteLength) this.device.queue.writeBuffer(this.discBuf, 0, discs);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        { view: this.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      ],
      depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    pass.setBindGroup(0, this.group);
    if (discs.length) {
      pass.setPipeline(this.discs);
      pass.setVertexBuffer(0, this.discBuf);
      pass.draw(6, discs.length / 12);
    }
    if (lines.length) {
      pass.setPipeline(this.lines);
      pass.setVertexBuffer(0, this.lineBuf);
      pass.draw(lines.length / 11);
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}

/** The map's renderer: WebGPU when the device has it, asked once (the first show); else the canvas. */
export class SystemRenderer {
  kind: "webgpu" | "canvas" | "" = "";
  gpu: SystemGpu | null = null;
  private asked = false;
  constructor(private onReady: () => void) {}
  start() {
    if (this.asked) return;
    this.asked = true;
    void SystemGpu.create().then((g) => {
      this.gpu = g;
      this.kind = g ? "webgpu" : "canvas";
      this.onReady();
    });
  }
}
