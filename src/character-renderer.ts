import type { GpuProfiler } from "./gpuprof";
import { AstronautModel } from "./character-model";
import shader from "./shaders/character.wgsl" with { type: "text" };
import type { Vec3 } from "./physics";
import type { CharacterFrame, PlanetCharacter } from "./controller/character";
import type { SceneryContact } from "./system/scenery-contact";
import { dot, sub, add, scale, unit, cross } from "./math/vec3";
import { sceneryFrame, seed } from "./system/scenery-data";
import { bladesInCell, grassDensity } from "./grass-layout";
export interface CharacterLight {
  sun: Vec3;
  irradiance: Vec3;
  sky: Vec3;
  pre: number;
  metres: number;
  fov: number;
}
const MAX = 65536;

/** The grass's settings: its reach [m], its sway (1 as authored), the share of its blades drawn. null: no grass pass. */
export interface GrassTune {
  density: number;
  reach: number;
  wind: number;
}

// One set of grass roots: generated in bounded chunks, drawn only once complete. Its origin and axes travel with it.
interface RootSet {
  index: number;
  buffer: GPUBuffer;
  count: number;
  cursor: number;
  key: string;
  origin: Vec3;
  axes: [Vec3, Vec3, Vec3];
  lattice: [number, number];
}
export class CharacterRenderer {
  readonly module: GPUShaderModule;
  readonly model: AstronautModel;
  private skinPipe: GPURenderPipeline;
  private skinShadow: GPURenderPipeline;
  private skinBindings: GPUBindGroup[] = [];
  private uniform: GPUBuffer;
  private visible: GPUBuffer;
  private commands: GPUBuffer;
  private vertices: GPUBuffer;
  private indices: GPUBuffer;
  private count: number;
  private avatar: GPURenderPipeline;
  private grass: GPURenderPipeline;
  private shadowPipe: GPURenderPipeline;
  private comp: GPURenderPipeline;
  private cull: GPUComputePipeline;
  private depth: GPUTexture | null = null;
  private shadow: GPUTexture;
  private sampler: GPUSampler;
  private size = "";
  private binds: GPUBindGroup[] = [];
  private bound: GPUBuffer | null = null;
  private lastScene: GPUBuffer | null = null;
  private rootsData = new Float32Array(MAX * 4);
  // Two sets: the drawn one, and the one being generated for the current key (the other one).
  private sets: RootSet[] = [];
  private drawn = -1;
  private building = -1;
  private lodUniform: GPUBuffer[] = [];
  private initialized = false;
  private active = false;
  private reason = "off";
  private cpuMs = 0;
  private generationMs = 0;
  constructor(private d: GPUDevice) {
    this.model = new AstronautModel(d);
    this.module = d.createShaderModule({ label: "character and grass", code: shader });
    const buffer = (size: number, usage: number) => d.createBuffer({ size, usage });
    this.uniform = buffer(84 * 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.sets = [0, 1].map((index) => ({
      index,
      buffer: buffer(MAX * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
      count: 0,
      cursor: 0,
      key: "",
      origin: [0, 0, 0] as Vec3,
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] as [Vec3, Vec3, Vec3],
      lattice: [0, 0] as [number, number],
    }));
    this.visible = buffer(MAX * 3 * 4, GPUBufferUsage.STORAGE);
    this.commands = buffer(48, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST);
    const v: number[] = [],
      idx: number[] = [];
    const rings = 24,
      slices = 36;
    for (let y = 0; y <= rings; y++)
      for (let x = 0; x <= slices; x++) {
        const a = (y / rings) * Math.PI,
          b = (x / slices) * Math.PI * 2;
        v.push(Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b));
      }
    for (let y = 0; y < rings; y++)
      for (let x = 0; x < slices; x++) {
        const a = y * (slices + 1) + x;
        idx.push(a, a + slices + 1, a + 1, a + 1, a + slices + 1, a + slices + 2);
      }
    this.vertices = buffer(v.length * 4, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    d.queue.writeBuffer(this.vertices, 0, new Float32Array(v));
    this.indices = buffer(idx.length * 4, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);
    d.queue.writeBuffer(this.indices, 0, new Uint32Array(idx));
    this.count = idx.length;
    const vertex: GPUVertexBufferLayout = { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] };
    const pipeline = (entry: string, buffers: GPUVertexBufferLayout[] = []) =>
      d.createRenderPipeline({
        layout: "auto",
        vertex: { module: this.module, entryPoint: entry, buffers },
        fragment: {
          module: this.module,
          entryPoint: "fs",
          targets: [
            {
              format: "rgba16float",
              ...(entry === "grassVs"
                ? {
                    blend: {
                      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                    } as GPUBlendState,
                  }
                : {}),
            },
          ],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: entry !== "grassVs", depthCompare: "greater" },
      });
    const skinVertex: GPUVertexBufferLayout = {
      arrayStride: 84,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x2" },
        { shaderLocation: 3, offset: 32, format: "uint16x4" },
        { shaderLocation: 4, offset: 40, format: "float32x4" },
        { shaderLocation: 5, offset: 56, format: "float32x4" },
        { shaderLocation: 6, offset: 72, format: "uint32" },
      ],
    };
    this.skinPipe = d.createRenderPipeline({
      layout: "auto",
      vertex: { module: this.module, entryPoint: "skinVs", buffers: [skinVertex] },
      fragment: { module: this.module, entryPoint: "skinFs", targets: [{ format: "rgba16float" }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
    });
    this.skinShadow = d.createRenderPipeline({
      layout: "auto",
      vertex: { module: this.module, entryPoint: "skinShadowVs", buffers: [skinVertex] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less", depthBias: 1, depthBiasSlopeScale: 1 },
    });
    this.avatar = pipeline("avatarVs", [vertex]);
    this.grass = pipeline("grassVs");
    this.shadowPipe = d.createRenderPipeline({
      layout: "auto",
      vertex: { module: this.module, entryPoint: "shadowVs", buffers: [vertex] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less", depthBias: 1, depthBiasSlopeScale: 1 },
    });
    this.comp = d.createRenderPipeline({
      layout: "auto",
      vertex: { module: this.module, entryPoint: "screenVs" },
      fragment: {
        module: this.module,
        entryPoint: "groundShadow",
        targets: [
          {
            format: "rgba16float",
            blend: {
              color: { operation: "add", srcFactor: "zero", dstFactor: "src" },
              alpha: { operation: "add", srcFactor: "zero", dstFactor: "one" },
            },
          },
        ],
      },
    });
    this.cull = d.createComputePipeline({ layout: "auto", compute: { module: this.module, entryPoint: "cull" } });
    this.shadow = d.createTexture({
      size: [512, 512],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.sampler = d.createSampler({ compare: "less-equal", magFilter: "linear", minFilter: "linear" });
    for (let i = 0; i < 3; i++) this.lodUniform.push(buffer(84 * 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST));
  }
  stats() {
    return {
      astronaut: this.model.stats(),
      active: this.active,
      reason: this.reason,
      roots: this.sets[this.drawn]?.count ?? 0,
      maxRoots: MAX,
      pending: this.building >= 0,
      rootBytes: MAX * 16,
      indexBytes: MAX * 3 * 4,
      shadowBytes: 512 * 512 * 4,
      depthBytes: this.depth ? Number(this.size.split(":")[0]) * Number(this.size.split(":")[1]) * 4 : 0,
      cpuMs: this.cpuMs,
      generationMs: this.generationMs,
    };
  }
  depthTexture() {
    return this.active ? this.depth : null;
  }
  reset() {
    this.active = false;
    this.reason = "off";
    this.dropRoots();
    if (this.depth) {
      this.depth.destroy();
      this.depth = null;
      this.size = "";
    }
    this.binds = [];
    this.bound = null;
  }
  private generate(c: PlanetCharacter, contact: SceneryContact | null, revision: number, grass: GrassTune | null) {
    this.reason = !grass
      ? "off"
      : c.body !== "earth"
        ? "other-planet"
        : !c.grounded && c.height() > 2
          ? "above-ground"
          : !contact
            ? "mask-unavailable"
            : !contact.grass(c.q)
              ? "outside-grass"
              : "grass";
    if (this.reason !== "grass") {
      this.dropRoots();
      return;
    }
    const q = c.q,
      up = c.up(),
      right = unit(cross(Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], up)),
      forward = cross(up, right);
    const cell = [Math.round(dot(q, right) / 8), Math.round(dot(q, forward) / 8)];
    const tune = grass!;
    const key = `${revision}:${cell.join(":")}:${tune.density}:${tune.reach}`;
    // The drawn set stays on screen until its replacement is complete: a rebuilt terrain patch or a crossed cell
    // no longer empties the grass for the frames the generation takes.
    if (this.drawn >= 0 && this.sets[this.drawn]?.key === key) return;
    if (this.building < 0 || this.sets[this.building]?.key !== key) {
      const s = this.sets[this.drawn === 0 ? 1 : 0]!;
      s.key = key;
      s.cursor = 0;
      s.count = 0;
      s.axes = [right, up, forward];
      s.origin = add(add(c.ground(q), right, cell[0]! * 8 - dot(q, right)), forward, cell[1]! * 8 - dot(q, forward));
      s.lattice = [cell[0]! * 8, cell[1]! * 8];
      this.building = s.index;
    }
    const s = this.sets[this.building]!;
    const begin = performance.now();
    const old = s.count;
    // A bounded chunk per frame; generate static roots once, never terrain-readback from the GPU.
    while (s.cursor < 64 * 64 && s.count < MAX && performance.now() - begin < 1) {
      const cellId = s.cursor++,
        x = (cellId % 64) - 32,
        z = Math.floor(cellId / 64) - 32,
        d = Math.hypot(x, z);
      if (d > tune.reach + 1) continue;
      const p = add(add(s.origin, s.axes[0], x), s.axes[2], z);
      if (!contact!.grass(p)) continue;
      const hx = x + s.lattice[0],
        hz = z + s.lattice[1];
      const density = bladesInCell(grassDensity(d) * tune.density, hx, hz);
      for (let n = 0; n < density && s.count < MAX; n++) {
        const a = seed(hx * 131 + n, hz),
          b = seed(hx, hz * 137 + n),
          g = seed(hx * 37 + n * 7, hz * 31);
        // Each blade stands on the ground under itself: the cell's centre is up to a metre away, a slope's
        // difference of tens of centimetres would float or bury it.
        const base = add(add(s.origin, s.axes[0], x + a), s.axes[2], z + b);
        const h = dot(sub(c.ground(base), s.origin), s.axes[1]);
        this.rootsData.set([x + a, h, z + b, g], s.count++ * 4);
      }
    }
    if (s.count > old) this.d.queue.writeBuffer(s.buffer, old * 16, this.rootsData, old * 4, (s.count - old) * 4);
    if (s.cursor >= 64 * 64 || s.count >= MAX) {
      this.drawn = this.building;
      this.building = -1;
    }
    this.generationMs = performance.now() - begin;
  }

  private dropRoots() {
    for (const s of this.sets) {
      s.count = 0;
      s.cursor = 0;
      s.key = "";
    }
    this.drawn = -1;
    this.building = -1;
  }
  encode(
    enc: GPUCommandEncoder,
    target: GPUTexture,
    moments: GPUBuffer,
    c: PlanetCharacter,
    frame: CharacterFrame,
    light: CharacterLight,
    contact: SceneryContact | null,
    revision: number,
    grass: GrassTune | null,
    prof: GpuProfiler,
    sceneryBuffer: GPUBuffer,
  ) {
    const began = performance.now();
    if (!this.model.ready && !this.model.error) void this.model.load();
    if (this.model.ready) this.model.evaluate(c.age, frame.speed);
    this.active = true;
    this.generate(c, contact, revision, grass);
    const width = target.width,
      height = target.height,
      key = `${width}:${height}`;
    if (key !== this.size) {
      this.depth?.destroy();
      this.depth = this.d.createTexture({
        size: [width, height],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.size = key;
    }
    const u = new Float32Array(84 * 4);
    const set = (i: number, v: number[]) => u.set(v, i * 4);
    const tan = Math.tan((light.fov * Math.PI) / 360);
    const roots = this.sets[this.drawn] ?? null;
    set(0, [(tan * width) / height, tan, roots?.lattice[0] ?? 0, roots?.lattice[1] ?? 0]);
    set(1, [width, height, light.metres, light.pre]);
    set(2, [...frame.origin, frame.phase]);
    set(3, [...frame.axes[0], Math.min(1, frame.speed / 4)]);
    set(4, [...frame.axes[1], c.age]);
    set(5, [...frame.axes[2], 0]);
    set(6, [...light.sun, 0]);
    set(7, [...light.irradiance, 0]);
    set(8, [...light.sky, 0]);
    // Transform roots in the static patch to this frame; no float32 planet-sized positions.
    const project = (v: Vec3): Vec3 => {
      const delta = sub(v, frame.q);
      return [dot(delta, cross(c.forward, c.up())), dot(delta, c.up()), dot(delta, c.forward)];
    };
    const cam = (v: Vec3) => add(add(scale(frame.axes[0], v[0]), frame.axes[1], v[1]), frame.axes[2], v[2]);
    set(9, [...add(frame.origin, cam(project(roots?.origin ?? [0, 0, 0]))), roots?.count ?? 0]);
    for (let i = 0; i < 3; i++) {
      const a = roots?.axes[i] ?? ([0, 0, 0] as Vec3);
      const local: Vec3 = [dot(a, cross(c.forward, c.up())), dot(a, c.up()), dot(a, c.forward)];
      set(10 + i, [...cam(local), 0]);
    }
    // Original procedural astronaut: layered pressure suit, hard rings, visor, life-support pack.
    const parts: number[][] = [
      [0, 1.22, 0, 0.26, 0.32, 0.16, 0],
      [0, 0.93, 0, 0.22, 0.14, 0.15, 1],
      [0, 1.66, 0, 0.19, 0.2, 0.19, 0],
      [0, 1.68, 0.125, 0.16, 0.135, 0.1, 2],
      [0, 1.48, 0, 0.205, 0.045, 0.19, 4],
      [0, 1.2, -0.21, 0.21, 0.3, 0.12, 4],
      [0, 1.22, 0.165, 0.135, 0.14, 0.035, 4],
      [0, 1.25, 0.202, 0.06, 0.05, 0.015, 1],
      [-0.34, 1.19, 0, 0.095, 0.23, 0.095, 0],
      [0.34, 1.19, 0, 0.095, 0.23, 0.095, 0],
      [-0.35, 0.94, 0, 0.08, 0.12, 0.08, 1],
      [0.35, 0.94, 0, 0.08, 0.12, 0.08, 1],
      [-0.12, 0.66, 0, 0.105, 0.25, 0.11, 0],
      [0.12, 0.66, 0, 0.105, 0.25, 0.11, 0],
      [-0.12, 0.28, 0, 0.09, 0.23, 0.1, 0],
      [0.12, 0.28, 0, 0.09, 0.23, 0.1, 0],
      [-0.12, 0.075, 0.07, 0.105, 0.07, 0.19, 1],
      [0.12, 0.075, 0.07, 0.105, 0.07, 0.19, 1],
      [-0.12, 0.46, 0.055, 0.11, 0.075, 0.095, 4],
      [0.12, 0.46, 0.055, 0.11, 0.075, 0.095, 4],
      [-0.29, 1.42, 0, 0.12, 0.07, 0.1, 3],
      [0.29, 1.42, 0, 0.12, 0.07, 0.1, 3],
      [0, 1.03, 0, 0.23, 0.04, 0.16, 4],
      [0, 1.64, -0.17, 0.12, 0.1, 0.055, 1],
    ];
    parts.forEach((p, i) => {
      set(13 + i * 2, [p[0]!, p[1]!, p[2]!, p[6]!]);
      set(14 + i * 2, [p[3]!, p[4]!, p[5]!, 0]);
    });
    if (contact) {
      const sf = sceneryFrame(contact.reply.lat, contact.reply.lon);
      [sf.east, sf.north, sf.up].forEach((a, i) => {
        const local: Vec3 = [dot(a, cross(c.forward, c.up())), dot(a, c.up()), dot(a, c.forward)];
        set(77 + i, [...cam(local), i === 2 ? 1 : 0]);
      });
      set(80, [...contact.local(frame.q), 0]);
    }
    set(83, [grass?.reach ?? 28, grass?.wind ?? 1, grass?.density ?? 1, 0]);
    this.d.queue.writeBuffer(this.uniform, 0, u);
    for (let i = 0; i < 3; i++) {
      u[23] = i;
      this.d.queue.writeBuffer(this.lodUniform[i]!, 0, u);
    }
    this.d.queue.writeBuffer(this.commands, 0, new Uint32Array([36, 0, 0, 0, 12, 0, 0, 0, 6, 0, 0, 0]));
    if (this.bound !== moments || this.lastScene !== sceneryBuffer) {
      this.lastScene = sceneryBuffer;
      this.bound = moments;
      this.binds = [];
      this.skinBindings = [];
    }
    const bind = (pipe: GPURenderPipeline | GPUComputePipeline, entries: GPUBindGroupEntry[], slot: number) =>
      (this.binds[slot] ??= this.d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }));
    const base = [{ binding: 0, resource: { buffer: this.uniform } }];
    const shading = [
      ...base,
      { binding: 8, resource: { buffer: sceneryBuffer } },
      { binding: 1, resource: { buffer: moments } },
      { binding: 5, resource: this.shadow.createView() },
      { binding: 6, resource: this.sampler },
    ];
    const shadowPass = enc.beginRenderPass({
      ...prof.pass("character solar shadow"),
      colorAttachments: [],
      depthStencilAttachment: { view: this.shadow.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    if (this.model.ready) {
      shadowPass.setPipeline(this.skinShadow);
      shadowPass.setBindGroup(
        0,
        (this.skinBindings[0] ??= this.d.createBindGroup({ layout: this.skinShadow.getBindGroupLayout(0), entries: base })),
      );
      shadowPass.setBindGroup(
        1,
        (this.skinBindings[1] ??= this.d.createBindGroup({
          layout: this.skinShadow.getBindGroupLayout(1),
          entries: [{ binding: 0, resource: { buffer: this.model.bones } }],
        })),
      );
      shadowPass.setVertexBuffer(0, this.model.vertices!);
      shadowPass.setIndexBuffer(this.model.indices!, "uint32");
      shadowPass.drawIndexed(this.model.count);
    } else {
      shadowPass.setPipeline(this.shadowPipe);
      shadowPass.setBindGroup(0, bind(this.shadowPipe, base, 0));
      shadowPass.setVertexBuffer(0, this.vertices);
      shadowPass.setIndexBuffer(this.indices, "uint32");
      shadowPass.drawIndexed(this.count, parts.length);
    }
    shadowPass.end();
    const comp = enc.beginRenderPass({
      ...prof.pass("character shadow on traced terrain"),
      colorAttachments: [{ view: target.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: "load", storeOp: "store" }],
    });
    comp.setPipeline(this.comp);
    comp.setBindGroup(
      0,
      bind(
        this.comp,
        shading.filter((e) => e.binding !== 8),
        1,
      ),
    );
    comp.draw(3);
    comp.end();
    if (roots?.count) {
      const pass = enc.beginComputePass({ ...prof.pass("grass visibility and LOD") });
      pass.setPipeline(this.cull);
      pass.setBindGroup(
        0,
        bind(
          this.cull,
          [
            ...base,
            { binding: 2, resource: { buffer: roots.buffer } },
            { binding: 7, resource: { buffer: this.visible } },
            { binding: 4, resource: { buffer: this.commands } },
            { binding: 8, resource: { buffer: sceneryBuffer } },
          ],
          2 + 8 * roots.index,
        ),
      );
      pass.dispatchWorkgroups(Math.ceil(roots.count / 128));
      pass.end();
    }
    const pass = enc.beginRenderPass({
      ...prof.pass("character and grass HDR"),
      colorAttachments: [{ view: target.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: "load", storeOp: "store" }],
      depthStencilAttachment: { view: this.depth!.createView(), depthClearValue: 0, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    if (this.model.ready) {
      pass.setPipeline(this.skinPipe);
      pass.setBindGroup(
        0,
        (this.skinBindings[2] ??= this.d.createBindGroup({ layout: this.skinPipe.getBindGroupLayout(0), entries: shading })),
      );
      pass.setBindGroup(
        1,
        (this.skinBindings[3] ??= this.d.createBindGroup({
          layout: this.skinPipe.getBindGroupLayout(1),
          entries: [
            { binding: 0, resource: { buffer: this.model.bones } },
            { binding: 1, resource: this.model.sampler },
            { binding: 2, resource: this.model.texture!.createView({ dimension: "2d-array" }) },
          ],
        })),
      );
      pass.setVertexBuffer(0, this.model.vertices!);
      pass.setIndexBuffer(this.model.indices!, "uint32");
      pass.drawIndexed(this.model.count);
    } else {
      pass.setPipeline(this.avatar);
      pass.setBindGroup(0, bind(this.avatar, shading, 3));
      pass.setVertexBuffer(0, this.vertices);
      pass.setIndexBuffer(this.indices, "uint32");
      pass.drawIndexed(this.count, parts.length);
    }
    if (roots?.count) {
      pass.setPipeline(this.grass);
      for (let lod = 0; lod < 3; lod++) {
        pass.setBindGroup(
          0,
          bind(
            this.grass,
            [
              { binding: 0, resource: { buffer: this.lodUniform[lod]! } },
              ...shading.slice(1),
              { binding: 2, resource: { buffer: roots.buffer } },
              { binding: 3, resource: { buffer: this.visible } },
            ],
            4 + lod + 8 * roots.index,
          ),
        );
        pass.drawIndirect(this.commands, lod * 16);
      }
    }
    pass.end();
    this.cpuMs = performance.now() - began;
    this.initialized = true;
  }
  get ready() {
    return this.initialized;
  }
}
