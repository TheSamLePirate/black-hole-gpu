import type { GpuProfiler } from "./gpuprof";
import { AstronautModel } from "./character-model";
import shader from "./shaders/character.wgsl" with { type: "text" };
import { withForest } from "./forest-shader";
import { bouldersNear, packStones, STONE_CAPACITY, STONE_LATTICE, STONE_SPACING, STONE_VERTICES, stoneMesh } from "./ground-stones";
import type { Vec3 } from "./physics";
import type { CharacterFrame, PlanetCharacter } from "./controller/character";
import type { SceneryContact } from "./system/scenery-contact";
import { dot, sub, add, scale, cross } from "./math/vec3";
import { sceneryFrame } from "./system/scenery-data";
import { GrassGround, type VegetationAt } from "./system/grass-ground";
import {
  GRASS_GRID,
  GRASS_INSTANCE_BYTES,
  GRASS_LIGHT_CELL,
  GRASS_LIGHT_GRID,
  GRASS_LODS,
  GRASS_REACH_MAX,
  GRASS_SPACING,
  TRAMPLE_CELL,
  TRAMPLE_GRID,
  TRAMPLE_RECOVERY_S,
  VEGETATION,
  VEGETATION_VEC4S,
  packVegetation,
} from "./grass-layout";
export interface CharacterLight {
  sun: Vec3;
  irradiance: Vec3;
  sky: Vec3;
  pre: number;
  metres: number;
  fov: number;
}
// The procedural astronaut drawn while the model loads: layered pressure suit, hard rings, visor, life-support
// pack — each ellipsoid's centre, radii, material (character.wgsl avatarVertex).
const PARTS: number[][] = [
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
/** the uniform's vec4s (character.wgsl U): view…sky 9, the parts 64, the scenery's frame 6, the probe 3, the vessel 1 */
const UNIFORM_VEC4S = 83;
const U_PARTS = 9,
  U_SCENE = 73,
  U_PROBE = 79,
  U_SHIP = 82;
/** the grass's uniform's vec4s (character.wgsl G): 16 figures, then the kinds' table */
const GRASS_FIGURES = 17;
/** the figures, the kinds' table, the stones' table (character.wgsl G) */
const GRASS_VEC4S = GRASS_FIGURES + VEGETATION.length * VEGETATION_VEC4S + VEGETATION.length;
/** a stone's bytes (character.wgsl Stone: three vec4) */
const STONE_BYTES = 48;
/** the occluder's format: distance [m] × coverage, coverage (ship.wgsl reads it as the station's) */
const OCCLUDER: GPUTextureFormat = "rg16float";
/** the levels' first instances in the one blade buffer, and its capacity */
const LOD_FIRST = GRASS_LODS.map((_, i) => GRASS_LODS.slice(0, i).reduce((n, l) => n + l.capacity, 0));
const BLADE_CAPACITY = GRASS_LODS.reduce((n, l) => n + l.capacity, 0);

/** The light probe round the camera (the ship's: ShipRenderer) and the vessel's shadow map, shared with the astronaut. */
export interface CharacterProbe {
  /** spherical harmonics, dominant light, key light (ShipRenderer.shBuf) */
  sh: GPUBuffer;
  /** GGX pre-filtered radiance */
  env: GPUTextureView;
  mips: number;
  /** the vessel's shadow map */
  shipShadow: GPUTextureView;
  /** the camera's axes in the probe's; null: no fresh probe this frame (the astronaut falls back to the sky estimate) */
  axes: [Vec3, Vec3, Vec3] | null;
  /** the vessel's bounding sphere in the camera's axes [m]; null: no vessel shadow */
  shipBound: { c: Vec3; r: number } | null;
}

/** The grass's settings: its reach [m], its sway (1 as authored), the share of its blades drawn. null: no grass pass. */
export interface GrassTune {
  density: number;
  reach: number;
  wind: number;
}
/** What the living ground is told each frame besides the astronaut: the wind there, and the ground off-limits. */
export interface GrassWorld {
  /** the surface wind: its speed [m/s] and where it blows from [° from north]; null: unknown (a light breeze) */
  wind: { speed: number; from: number } | null;
  /** a ground point no vegetation grows on besides the scenery's own exclusions (a runway's pavement) */
  paved: (q: Vec3) => boolean;
}

export class CharacterRenderer {
  readonly module: GPUShaderModule;
  readonly model: AstronautModel;
  /** the ground under the grass (the CPU's grid: heights, what grows, the satellite's colours) */
  readonly grassGround = new GrassGround();
  private skinPipe: GPURenderPipeline;
  private skinShadow: GPURenderPipeline;
  private uniform: GPUBuffer;
  private vertices: GPUBuffer;
  private indices: GPUBuffer;
  private count: number;
  private avatar: GPURenderPipeline;
  private shadowPipe: GPURenderPipeline;
  private comp: GPURenderPipeline;
  // the living ground
  private grassDraw: GPURenderPipeline;
  /** the far levels: no depth written — their sub-pixel blades' soft footprints must not hide the blades behind */
  private grassDrawFar: GPURenderPipeline;
  private grassLight: GPUComputePipeline;
  private grassTrample: GPUComputePipeline;
  private grassBlades: GPUComputePipeline;
  private grassClamp: GPUComputePipeline;
  // the stones (ground-stones.ts): grown each frame on the lattice, drawn before the grass
  private stonesGrow: GPUComputePipeline;
  private stonesClamp: GPUComputePipeline;
  private stoneDraw: GPURenderPipeline;
  private stones: GPUBuffer;
  private stoneMesh: GPUBuffer;
  private stoneCount = 0;
  private grassUniform: GPUBuffer;
  private grassCells: GPUBuffer;
  private grassHeights: GPUBuffer;
  private blades: GPUBuffer;
  private shade: GPUBuffer;
  private trample: GPUBuffer;
  private commands: GPUBuffer;
  private countsStage: GPUBuffer;
  private countsBusy = false;
  private countsAt = 0;
  private lodUniform: GPUBuffer[] = [];
  private groundStamp = -1;
  private frameStamp = -1;
  private clearTrample = true;
  /** the per-frame arrays, reused: the uniforms, the draws' reset, the kinds' table (constant) */
  private uData = new Float32Array(UNIFORM_VEC4S * 4);
  private gData = new Float32Array(GRASS_VEC4S * 4);
  private drawReset = new Uint32Array([...GRASS_LODS.flatMap((l) => [l.segments * 6, 0, 0, 0]), STONE_VERTICES, 0, 0, 0]);
  private bladeCounts = [0, 0, 0];
  private grassOn = false;
  /** the lattice's points a side this frame */
  private lattice = 0;
  private lastAge = -1;
  private depth: GPUTexture | null = null;
  /** the astronaut's and the grass's distance for the vessel drawn after them (ship.wgsl's occluder) */
  private occluderTex: GPUTexture | null = null;
  private envSampler: GPUSampler;
  private probeKey: unknown[] = [];
  private shadow: GPUTexture;
  private sampler: GPUSampler;
  private size = "";
  /** the bind groups by pipeline (made again when a resource they hold changes) */
  private groups = new Map<string, GPUBindGroup>();
  private shadowView: GPUTextureView;
  private probeLit = false;
  private shipShadowed = false;
  private initialized = false;
  private active = false;
  private reason = "off";
  private cpuMs = 0;
  private generationMs = 0;
  constructor(private d: GPUDevice) {
    this.model = new AstronautModel(d);
    this.module = d.createShaderModule({ label: "character and grass", code: withForest(shader) });
    const buffer = (size: number, usage: number, label?: string) => d.createBuffer({ size, usage, label });
    const S = GPUBufferUsage.STORAGE;
    this.uniform = buffer(UNIFORM_VEC4S * 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.grassUniform = buffer(GRASS_VEC4S * 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "grass figures");
    this.grassCells = buffer(GRASS_GRID * GRASS_GRID * 4, S | GPUBufferUsage.COPY_DST, "grass ground: cells");
    this.grassHeights = buffer(GRASS_GRID * GRASS_GRID * 4, S | GPUBufferUsage.COPY_DST, "grass ground: heights");
    this.blades = buffer(BLADE_CAPACITY * GRASS_INSTANCE_BYTES, S, "grass blades");
    this.shade = buffer(GRASS_LIGHT_GRID * GRASS_LIGHT_GRID * 4, S, "grass shade");
    this.trample = buffer(TRAMPLE_GRID * TRAMPLE_GRID * 16, S | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, "grass footprints");
    this.commands = buffer(64, S | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, "grass and stones draws");
    this.countsStage = buffer(64, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.stones = buffer(STONE_CAPACITY * STONE_BYTES, S, "stones");
    const mesh = stoneMesh();
    this.stoneMesh = buffer(mesh.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, "stone mesh");
    d.queue.writeBuffer(this.stoneMesh, 0, mesh);
    GRASS_LODS.forEach((l, i) => {
      const b = buffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      d.queue.writeBuffer(b, 0, new Uint32Array([i, l.segments, LOD_FIRST[i]!, 0]));
      this.lodUniform.push(b);
    });
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
    const targets = (blend?: GPUBlendState): GPUColorTargetState[] => [
      { format: "rgba16float", ...(blend ? { blend } : {}) },
      { format: OCCLUDER, ...(blend ? { blend } : {}) },
    ];
    // (premultiplied: the grass's coverage at its edges and far away; its occluder a coverage-weighted distance)
    const premultiplied: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    };
    const depthStencil: GPUDepthStencilState = { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" };
    this.avatar = d.createRenderPipeline({
      layout: "auto",
      vertex: { module: this.module, entryPoint: "avatarVs", buffers: [vertex] },
      fragment: { module: this.module, entryPoint: "fs", targets: targets() },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil,
    });
    // (the grass writes its depth: its levels drawn far to near, a blade's soft edge falls over those behind it)
    const grassPipe = (writeDepth: boolean) =>
      d.createRenderPipeline({
        layout: "auto",
        vertex: { module: this.module, entryPoint: "grassVs" },
        fragment: { module: this.module, entryPoint: "grassFs", targets: targets(premultiplied) },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { ...depthStencil, depthWriteEnabled: writeDepth },
      });
    this.grassDraw = grassPipe(true);
    this.grassDrawFar = grassPipe(false);
    this.stoneDraw = d.createRenderPipeline({
      layout: "auto",
      vertex: { module: this.module, entryPoint: "stoneVs", buffers: [vertex] },
      fragment: { module: this.module, entryPoint: "stoneFs", targets: targets() },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil,
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
      fragment: { module: this.module, entryPoint: "skinFs", targets: targets() },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil,
    });
    this.skinShadow = d.createRenderPipeline({
      layout: "auto",
      vertex: { module: this.module, entryPoint: "skinShadowVs", buffers: [skinVertex] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less", depthBias: 1, depthBiasSlopeScale: 1 },
    });
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
    const compute = (entryPoint: string) => d.createComputePipeline({ layout: "auto", compute: { module: this.module, entryPoint } });
    this.grassLight = compute("grassLight");
    this.grassTrample = compute("grassTrample");
    this.grassBlades = compute("grassBlades");
    this.grassClamp = compute("grassClamp");
    this.stonesGrow = compute("stonesGrow");
    this.stonesClamp = compute("stonesClamp");
    this.shadow = d.createTexture({
      size: [512, 512],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.sampler = d.createSampler({ compare: "less-equal", magFilter: "linear", minFilter: "linear" });
    this.shadowView = this.shadow.createView();
    this.envSampler = d.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat" });
    this.gData.set(packVegetation(), GRASS_FIGURES * 4);
    this.gData.set(packStones(), (GRASS_FIGURES + VEGETATION.length * VEGETATION_VEC4S) * 4);
  }
  /** A boulder in the way of a capsule at q (radius [m], 1.8 m tall): one taller than a step above its feet, as
   *  drawn (ground-stones.ts bouldersNear) — the stones exist only while the living ground is on. */
  stoneBlocks(q: Vec3, radius = 0.3, step = 0.25): boolean {
    const g = this.grassGround;
    if (!this.grassOn || !g.ready || !g.frame) return false;
    const [x, y, z] = g.local(q);
    return bouldersNear(g, x, z, radius + 0.8).some(
      (b) => Math.hypot(b.x - x, b.z - z) < 0.8 * b.r + radius && b.top > y + step && b.base < y + 1.8,
    );
  }
  stats() {
    return {
      astronaut: this.model.stats(),
      active: this.active,
      reason: this.reason,
      /** the blades drawn (the last count read back, a few times a second): near, middle, far */
      blades: [...this.bladeCounts],
      roots: this.bladeCounts.reduce((a, b) => a + b, 0),
      stones: this.stoneCount,
      maxRoots: BLADE_CAPACITY,
      lodCapacity: GRASS_LODS.map((l) => l.capacity),
      lattice: this.lattice,
      pending: this.reason === "loading" || this.grassGround.remaining > 0,
      groundCells: this.grassGround.vegetated,
      groundCpuMs: this.grassGround.cpuMs,
      rootBytes: BLADE_CAPACITY * GRASS_INSTANCE_BYTES,
      indexBytes: GRASS_GRID * GRASS_GRID * 8 + GRASS_LIGHT_GRID ** 2 * 4 + TRAMPLE_GRID ** 2 * 16,
      shadowBytes: 512 * 512 * 4,
      depthBytes: this.depth ? Number(this.size.split(":")[0]) * Number(this.size.split(":")[1]) * 4 : 0,
      occluderBytes: this.occluderTex ? this.occluderTex.width * this.occluderTex.height * 4 : 0,
      probe: this.probeLit,
      shipShadow: this.shipShadowed,
      cpuMs: this.cpuMs,
      generationMs: this.generationMs,
    };
  }
  reset() {
    this.active = false;
    this.reason = "off";
    this.grassOn = false;
    this.grassGround.clear();
    this.groundStamp = -1;
    this.clearTrample = true;
    this.bladeCounts = [0, 0, 0];
    if (this.depth) {
      this.depth.destroy();
      this.depth = null;
      this.size = "";
    }
    this.occluderTex?.destroy();
    this.occluderTex = null;
    this.groups.clear();
    this.probeKey = [];
  }
  /**
   * The living ground's CPU side this frame: why there is grass or none, the ground grid's slice of work, its
   * upload once published, the grass's figures (the frame, the lattice, the astronaut, the wind, the vessel).
   */
  private prepareGrass(
    c: PlanetCharacter,
    frame: CharacterFrame,
    contact: SceneryContact | null,
    revision: number,
    grass: GrassTune | null,
    world: GrassWorld,
    light: CharacterLight,
    height: number,
    cam: (v: Vec3) => Vec3,
  ) {
    const g = this.grassGround;
    const reason = !grass
      ? "off"
      : c.body !== "earth" || !c.ours
        ? "other-planet"
        : !c.grounded && c.height() > 2
          ? "above-ground"
          : !contact
            ? "mask-unavailable"
            : null;
    if (reason) {
      this.reason = reason;
      if (g.frame) g.clear();
      this.groundStamp = -1;
      this.grassOn = false;
      this.bladeCounts = [0, 0, 0];
      return;
    }
    const begin = performance.now();
    const vegetation: VegetationAt = (q) => {
      const v = contact!.vegetation(q);
      return world.paved(q) ? { cover: 0, rgb: v.rgb } : v;
    };
    g.build(c.q, c.up(), (p) => c.rawHeight(p), vegetation, revision);
    this.generationMs = performance.now() - begin;
    if (!g.ready) {
      this.reason = "loading";
      this.grassOn = false;
      return;
    }
    if (this.frameStamp !== g.frameStamp) {
      // (a new frame: the last place's footprints would come back at the same local coordinates)
      this.clearTrample = true;
      this.frameStamp = g.frameStamp;
    }
    if (this.groundStamp !== g.stamp) {
      this.d.queue.writeBuffer(this.grassHeights, 0, g.heights);
      this.d.queue.writeBuffer(this.grassCells, 0, g.cells);
      this.groundStamp = g.stamp;
    }
    this.reason = g.vegetated ? "grass" : "outside-grass";
    this.grassOn = g.vegetated > 0;
    if (!this.grassOn) {
      this.bladeCounts = [0, 0, 0];
      return;
    }
    const tune = grass!;
    const f = g.frame!;
    // (the frame's axes and origin in the camera's: through the astronaut's own axes, as his body is placed)
    const toLocal = (v: Vec3): Vec3 => [dot(v, cross(c.forward, c.up())), dot(v, c.up()), dot(v, c.forward)];
    const R = cam(toLocal(f.right)),
      U = cam(toLocal(f.up)),
      F = cam(toLocal(f.forward));
    const O = add(frame.origin, cam(toLocal(sub(f.origin, frame.q))));
    const walker = g.local(frame.q),
      eye: Vec3 = [-dot(O, R), -dot(O, U), -dot(O, F)];
    const reach = Math.min(GRASS_REACH_MAX, Math.max(4, tune.reach));
    const N = Math.ceil((2 * reach) / GRASS_SPACING) + 2;
    const ahead = g.local(add(frame.q, c.forward, 1));
    const heading = [ahead[0] - walker[0], ahead[2] - walker[2]];
    const hn = Math.hypot(heading[0]!, heading[1]!) || 1;
    // (the wind: the weather's at the vessel, towards where it blows, in the frame — a light breeze when unknown)
    const wind = world.wind ?? { speed: 3, from: 250 };
    const up = c.up();
    const e = cross([0, 0, 1], up),
      en = Math.hypot(...e);
    const east: Vec3 = en > 1e-6 ? scale(e, 1 / en) : [1, 0, 0];
    const north = cross(up, east);
    const from = (wind.from * Math.PI) / 180;
    const toward = add(scale(east, -Math.sin(from)), north, -Math.cos(from));
    const wx = dot(toward, f.right),
      wz = dot(toward, f.forward),
      wn = Math.hypot(wx, wz) || 1;
    const strength = Math.min(2, Math.max(0.12, wind.speed / 8));
    // (the landed vessel's box: nothing grows under it)
    const hull = c.hullNow();
    let hullFig = [0, 0, 0, 0],
      hullAxis = [0, 0, 0, 0];
    if (hull) {
      const centre = g.local(hull.centre),
        a = g.local(add(f.origin, hull.axes[0], 1)),
        an = Math.hypot(a[0], a[2]) || 1;
      hullFig = [centre[0], centre[2], hull.half[0] + 0.15, hull.half[2] + 0.15];
      hullAxis = [a[0] / an, a[2] / an, 0, 1];
    }
    const age = c.age;
    const dt = this.lastAge < 0 ? 0 : Math.max(0, Math.min(0.25, age - this.lastAge));
    this.lastAge = age;
    const pixel = (2 * Math.tan((light.fov * Math.PI) / 360)) / height;
    const u = this.gData;
    const set = (i: number, v: number[]) => u.set(v, i * 4);
    set(0, [...O, reach]);
    set(1, [...R, GRASS_SPACING]);
    set(2, [...U, age]);
    set(3, [...F, Math.max(0, Math.min(1, tune.density))]);
    set(4, [Math.round(walker[0] / GRASS_SPACING) - N / 2, Math.round(walker[2] / GRASS_SPACING) - N / 2, N, pixel]);
    set(5, [g.centre[0] - (GRASS_GRID - 1) / 2, g.centre[1] - (GRASS_GRID - 1) / 2, GRASS_GRID, 1]);
    set(6, [...walker, c.speed]);
    set(7, [heading[0]! / hn, heading[1]! / hn, c.grounded ? 1 : 0, dt]);
    set(8, [...eye, tune.wind]);
    set(9, [wx / wn, wz / wn, strength, 1.5 + wind.speed * 0.6]);
    set(10, hullFig);
    set(11, hullAxis);
    const lc = (GRASS_LIGHT_GRID - 1) / 2;
    set(12, [Math.round(walker[0] / GRASS_LIGHT_CELL) - lc, Math.round(walker[2] / GRASS_LIGHT_CELL) - lc, GRASS_LIGHT_GRID, 1]);
    set(13, [TRAMPLE_CELL, TRAMPLE_GRID, Math.exp(-dt / TRAMPLE_RECOVERY_S), 0]);
    set(14, [GRASS_LODS[0].until, GRASS_LODS[1].until, GRASS_LODS[0].capacity, GRASS_LODS[1].capacity]);
    set(15, [GRASS_LODS[2].capacity, LOD_FIRST[1]!, LOD_FIRST[2]!, STONE_CAPACITY]);
    set(16, [
      Math.round(walker[0] / STONE_SPACING) - STONE_LATTICE / 2,
      Math.round(walker[2] / STONE_SPACING) - STONE_LATTICE / 2,
      STONE_LATTICE,
      STONE_SPACING,
    ]);
    this.d.queue.writeBuffer(this.grassUniform, 0, u);
    this.lattice = N;
  }
  encode(
    enc: GPUCommandEncoder,
    target: GPUTexture,
    sceneDepth: GPUBuffer,
    c: PlanetCharacter,
    frame: CharacterFrame,
    light: CharacterLight,
    contact: SceneryContact | null,
    revision: number,
    grass: GrassTune | null,
    prof: GpuProfiler,
    sceneryBuffer: GPUBuffer,
    probe: CharacterProbe,
    world: GrassWorld = { wind: null, paved: () => false },
  ) {
    const began = performance.now();
    if (!this.model.ready && !this.model.error) void this.model.load();
    // (on the ground, the feet on the ground under them: a slope's rise at each foot)
    if (this.model.ready) this.model.evaluate(c.age, frame.speed, frame.airborne, frame.airborne ? null : (x, z) => c.groundRise(x, z));
    this.active = true;
    const width = target.width,
      height = target.height,
      key = `${width}:${height}`;
    if (key !== this.size) {
      this.depth?.destroy();
      this.occluderTex?.destroy();
      this.depth = this.d.createTexture({ size: [width, height], format: "depth32float", usage: GPUTextureUsage.RENDER_ATTACHMENT });
      this.occluderTex = this.d.createTexture({
        size: [width, height],
        format: OCCLUDER,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.size = key;
    }
    const u = this.uData;
    u.fill(0);
    const set = (i: number, v: number[]) => u.set(v, i * 4);
    const tan = Math.tan((light.fov * Math.PI) / 360);
    set(0, [(tan * width) / height, tan, 0, 0]);
    set(1, [width, height, light.metres, light.pre]);
    // (the landing's give and the body lowered for the lower foot on a slope)
    set(2, [...add(frame.origin, frame.axes[1], frame.dip + this.model.footDrop), frame.phase]);
    set(3, [...frame.axes[0], Math.min(1, frame.speed / 4)]);
    set(4, [...frame.axes[1], c.age]);
    set(5, [...frame.axes[2], 0]);
    set(6, [...light.sun, 0]);
    set(7, [...light.irradiance, 0]);
    set(8, [...light.sky, 0]);
    const cam = (v: Vec3) => add(add(scale(frame.axes[0], v[0]), frame.axes[1], v[1]), frame.axes[2], v[2]);
    PARTS.forEach((p, i) => {
      set(U_PARTS + i * 2, [p[0]!, p[1]!, p[2]!, p[6]!]);
      set(U_PARTS + 1 + i * 2, [p[3]!, p[4]!, p[5]!, 0]);
    });
    if (contact) {
      const sf = sceneryFrame(contact.reply.lat, contact.reply.lon);
      [sf.east, sf.north, sf.up].forEach((a, i) => {
        const local: Vec3 = [dot(a, cross(c.forward, c.up())), dot(a, c.up()), dot(a, c.forward)];
        set(U_SCENE + i, [...cam(local), i === 2 ? 1 : 0]);
      });
      set(U_SCENE + 3, [...contact.local(frame.q), 0]);
    }
    // (the probe: the same light as the vessel's hull — none fresh, the astronaut's own estimate of the sky)
    this.probeLit = !!probe.axes;
    this.shipShadowed = !!(probe.axes && probe.shipBound);
    const ax = probe.axes;
    set(U_PROBE, [...(ax?.[0] ?? [1, 0, 0]), ax ? 1 : 0]);
    set(U_PROBE + 1, [...(ax?.[1] ?? [0, 1, 0]), probe.mips - 1]);
    set(U_PROBE + 2, [...(ax?.[2] ?? [0, 0, 1]), 0]);
    set(U_SHIP, probe.shipBound && ax ? [...probe.shipBound.c, probe.shipBound.r] : [0, 0, 0, 0]);
    this.d.queue.writeBuffer(this.uniform, 0, u);
    this.prepareGrass(c, frame, contact, revision, grass, world, light, height, cam);
    // (the bind groups follow their resources: a new occlusion depth buffer, scenery buffer or probe — made again)
    const resources = [sceneDepth, sceneryBuffer, probe.sh, probe.env, probe.shipShadow];
    if (resources.some((r, i) => r !== this.probeKey[i])) {
      this.probeKey = resources;
      this.groups.clear();
    }
    const resource = (b: number, lod: number): GPUBindingResource => {
      switch (b) {
        case 0:
          return { buffer: this.uniform };
        case 1:
          return { buffer: sceneDepth };
        case 4:
          return { buffer: this.commands };
        case 5:
          return this.shadowView;
        case 6:
          return this.sampler;
        case 8:
          return { buffer: sceneryBuffer };
        case 9:
          return { buffer: probe.sh };
        case 10:
          return probe.env;
        case 11:
          return this.envSampler;
        case 12:
          return probe.shipShadow;
        case 13:
          return { buffer: this.grassUniform };
        case 14:
          return { buffer: this.grassCells };
        case 15:
          return { buffer: this.grassHeights };
        case 16:
        case 17:
          return { buffer: this.blades };
        case 18:
          return { buffer: this.shade };
        case 21:
        case 22:
          return { buffer: this.stones };
        case 19:
          return { buffer: this.trample };
        default:
          return { buffer: this.lodUniform[lod]! };
      }
    };
    /** pipeline's group 0 with exactly the bindings its entry points use (layout "auto") */
    const group = (pipe: GPURenderPipeline | GPUComputePipeline, slot: string, bindings: number[], lod = 0) => {
      let g = this.groups.get(slot);
      if (!g) {
        g = this.d.createBindGroup({
          layout: pipe.getBindGroupLayout(0),
          entries: bindings.map((binding) => ({ binding, resource: resource(binding, lod) })),
        });
        this.groups.set(slot, g);
      }
      return g;
    };
    const lit = [0, 1, 5, 6, 8, 9, 10, 11, 12];
    const shadowPass = enc.beginRenderPass({
      ...prof.pass("character solar shadow"),
      colorAttachments: [],
      depthStencilAttachment: { view: this.shadowView, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    if (this.model.ready) {
      shadowPass.setPipeline(this.skinShadow);
      shadowPass.setBindGroup(0, group(this.skinShadow, "skin-shadow", [0]));
      shadowPass.setBindGroup(1, this.bonesGroup(this.skinShadow, "skin-shadow-bones", false));
      shadowPass.setVertexBuffer(0, this.model.vertices!);
      shadowPass.setIndexBuffer(this.model.indices!, "uint32");
      shadowPass.drawIndexed(this.model.count);
    } else {
      shadowPass.setPipeline(this.shadowPipe);
      shadowPass.setBindGroup(0, group(this.shadowPipe, "shadow", [0]));
      shadowPass.setVertexBuffer(0, this.vertices);
      shadowPass.setIndexBuffer(this.indices, "uint32");
      shadowPass.drawIndexed(this.count, PARTS.length);
    }
    shadowPass.end();
    const comp = enc.beginRenderPass({
      ...prof.pass("character shadow on traced terrain"),
      colorAttachments: [{ view: target.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: "load", storeOp: "store" }],
    });
    comp.setPipeline(this.comp);
    comp.setBindGroup(0, group(this.comp, "ground", [0, 1, 5, 6, 8, 9, 12]));
    comp.draw(3);
    comp.end();
    let readCounts = false;
    if (this.grassOn) {
      // the living ground: the trees' shade on it, the footprints, every blade of the lattice (the draws' counts reset first)
      this.d.queue.writeBuffer(this.commands, 0, this.drawReset);
      if (this.clearTrample) {
        enc.clearBuffer(this.trample);
        this.clearTrample = false;
      }
      const pass = enc.beginComputePass({ ...prof.pass("grass: shade, footprints, blades") });
      if (contact) {
        pass.setPipeline(this.grassLight);
        pass.setBindGroup(0, group(this.grassLight, "grass-light", [0, 8, 13, 15, 18]));
        pass.dispatchWorkgroups(Math.ceil(GRASS_LIGHT_GRID / 8), Math.ceil(GRASS_LIGHT_GRID / 8));
      }
      pass.setPipeline(this.grassTrample);
      pass.setBindGroup(0, group(this.grassTrample, "grass-trample", [13, 19]));
      pass.dispatchWorkgroups(TRAMPLE_GRID / 8, TRAMPLE_GRID / 8);
      pass.setPipeline(this.grassBlades);
      pass.setBindGroup(0, group(this.grassBlades, "grass-blades", [0, 4, 9, 12, 13, 14, 15, 16, 18, 19]));
      pass.dispatchWorkgroups(Math.ceil(this.lattice / 16), Math.ceil(this.lattice / 16));
      pass.setPipeline(this.grassClamp);
      pass.setBindGroup(0, group(this.grassClamp, "grass-clamp", [4, 13]));
      pass.dispatchWorkgroups(1);
      pass.setPipeline(this.stonesGrow);
      pass.setBindGroup(0, group(this.stonesGrow, "stones-grow", [0, 4, 13, 14, 15, 18, 21]));
      pass.dispatchWorkgroups(Math.ceil(STONE_LATTICE / 8), Math.ceil(STONE_LATTICE / 8));
      pass.setPipeline(this.stonesClamp);
      pass.setBindGroup(0, group(this.stonesClamp, "stones-clamp", [4, 13]));
      pass.dispatchWorkgroups(1);
      pass.end();
      // (the blades drawn, read back a few times a second — never waited for)
      if (!this.countsBusy && performance.now() - this.countsAt > 250) {
        enc.copyBufferToBuffer(this.commands, 0, this.countsStage, 0, 64);
        readCounts = true;
      }
    }
    const pass = enc.beginRenderPass({
      ...prof.pass(this.grassOn ? "character and grass HDR" : "character HDR"),
      colorAttachments: [
        { view: target.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: "load", storeOp: "store" },
        { view: this.occluderTex!.createView(), clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" },
      ],
      depthStencilAttachment: { view: this.depth!.createView(), depthClearValue: 0, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    if (this.model.ready) {
      pass.setPipeline(this.skinPipe);
      pass.setBindGroup(0, group(this.skinPipe, "skin", lit));
      pass.setBindGroup(1, this.bonesGroup(this.skinPipe, "skin-bones", true));
      pass.setVertexBuffer(0, this.model.vertices!);
      pass.setIndexBuffer(this.model.indices!, "uint32");
      pass.drawIndexed(this.model.count);
    } else {
      pass.setPipeline(this.avatar);
      pass.setBindGroup(0, group(this.avatar, "avatar", lit));
      pass.setVertexBuffer(0, this.vertices);
      pass.setIndexBuffer(this.indices, "uint32");
      pass.drawIndexed(this.count, PARTS.length);
    }
    if (this.grassOn) {
      // the stones first (opaque, their depth written: the grass stands round them)
      pass.setPipeline(this.stoneDraw);
      pass.setBindGroup(0, group(this.stoneDraw, "stones-draw", [0, 1, 5, 6, 9, 12, 13, 22]));
      pass.setVertexBuffer(0, this.stoneMesh);
      pass.drawIndirect(this.commands, 48);
    }
    if (this.grassOn) {
      // (far to near: the near blades' soft edges blend over the far ones; only the nearest level writes depth —
      // the far levels' blades are thin and many, their order unknown: tested against the astronaut alone)
      for (let lod = GRASS_LODS.length - 1; lod >= 0; lod--) {
        const pipe = lod === 0 ? this.grassDraw : this.grassDrawFar;
        pass.setPipeline(pipe);
        pass.setBindGroup(0, group(pipe, `grass-draw-${lod}`, [0, 1, 5, 6, 9, 10, 11, 13, 17, 20], lod));
        pass.drawIndirect(this.commands, lod * 16);
      }
    }
    pass.end();
    if (readCounts) this.readCounts();
    this.cpuMs = performance.now() - began;
    this.initialized = true;
  }
  /** The blades drawn this frame, mapped once its work is done (the stats, the tests). */
  private readCounts() {
    this.countsBusy = true;
    this.countsAt = performance.now();
    const done = () => (this.countsBusy = false);
    this.d.queue.onSubmittedWorkDone().then(
      () =>
        this.countsStage.mapAsync(GPUMapMode.READ).then(() => {
          const n = new Uint32Array(this.countsStage.getMappedRange().slice(0));
          this.countsStage.unmap();
          this.bladeCounts = [n[1]!, n[5]!, n[9]!];
          this.stoneCount = Math.min(n[13]!, STONE_CAPACITY);
          done();
        }, done),
      done,
    );
  }
  /**
   * The footprints now, read back (the tests, TARS): how many 12.5 cm cells are pressed (over 0.3), the deepest,
   * and their mean pressure.
   */
  async footprints(): Promise<{ cells: number; deepest: number; mean: number }> {
    const bytes = TRAMPLE_GRID * TRAMPLE_GRID * 16;
    const stage = this.d.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.d.createCommandEncoder();
    enc.copyBufferToBuffer(this.trample, 0, stage, 0, bytes);
    this.d.queue.submit([enc.finish()]);
    await stage.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(stage.getMappedRange().slice(0));
    stage.unmap();
    stage.destroy();
    let cells = 0,
      deepest = 0,
      sum = 0;
    for (let i = 2; i < f.length; i += 4) {
      const z = f[i]!;
      deepest = Math.max(deepest, z);
      if (z > 0.3) cells++, (sum += z);
    }
    return { cells, deepest, mean: cells ? sum / cells : 0 };
  }
  /** The astronaut's group 1: its bones (and for the lit pass its maps). */
  private bonesGroup(pipe: GPURenderPipeline, slot: string, maps: boolean) {
    let g = this.groups.get(slot);
    if (!g) {
      g = this.d.createBindGroup({
        layout: pipe.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: this.model.bones } },
          ...(maps
            ? [
                { binding: 1, resource: this.model.sampler },
                { binding: 2, resource: this.model.texture!.createView({ dimension: "2d-array" }) },
              ]
            : []),
        ],
      });
      this.groups.set(slot, g);
    }
    return g;
  }
  /** The astronaut's and the grass's distance this frame, for the vessel drawn over them (null: not on foot). */
  get occluder(): { depth: GPUTexture; rect: [number, number, number, number] } | null {
    const t = this.active ? this.occluderTex : null;
    return t ? { depth: t, rect: [0, 0, t.width, t.height] } : null;
  }
  get ready() {
    return this.initialized;
  }
  /** drawn last frame (on foot) */
  get drawing() {
    return this.active;
  }
}
