import traceWGSL from "./shaders/trace.wgsl" with { type: "text" };
import displayWGSL from "./shaders/display.wgsl" with { type: "text" };
import postWGSL from "./shaders/post.wgsl" with { type: "text" };
import skyWGSL from "./shaders/sky.wgsl" with { type: "text" };
import milkyWayUrl from "../assets/sky/milkyway.webp";
import starCatalogueUrl from "../assets/sky/stars.bin";
import starLodUrl from "../assets/sky/starlod.bin";
import { SkyTextureBuilder, loadPackedTexture, loadStarCatalogue, skyMatrix } from "./sky";
import { cameraFrame } from "./camera";
import {
  blackbodyLogY,
  buildBlackbodyLUT,
  buildSynchrotronLUT,
  captureTolerance,
  horizon,
  isco,
  ntFluxMax,
  powerLawRGB,
} from "./physics";
import type { Settings } from "./settings";
import { encodeEXR, encodePNG16 } from "./exporters";

const RENDER_MODES = { physical: 0, redshift: 1, temperature: 2, order: 3, steps: 4 } as const;
const SHIFT_MODES = { full: 0, gravitational: 1, noBeaming: 2, none: 3 } as const;
const BG_MODES = { stars: 0, checker: 1, image: 2, real: 3 } as const;
const TONEMAPS = { AgX: 0, "AgX punchy": 1, ACES: 2, clamp: 3 } as const;
const BLOCKS = [1, 2, 3, 4, 6, 8];
const PARAM_VEC4S = 31;
const BANDS = { visible: 0, "230GHz": 1, multi: 2 } as const;
const POL_FIELDS = { toroidal: 0, radial: 1, vertical: 2, spiral: 3 } as const;
/** Catalogue star flux per unit 10^(−0.4 m), in Milky Way map units (see scripts/build-sky.ts). */
const STAR_FLUX_SCALE = 1 / 4250;

const FLAG_ADAPTIVE_RK = 1;
const FLAG_ADAPTIVE_SPP = 2;
const FLAG_TEMPORAL = 4;
const FLAG_INTERLEAVED = 8;

/**
 * Bun's dev server sometimes serves a `type: "text"` import as an asset URL after a hot reload
 * (the production bundle inlines it). Accept both.
 */
async function wgsl(src: string): Promise<string> {
  if (/^(\/|https?:)\S*\.wgsl$/.test(src.trim())) return (await fetch(src.trim())).text();
  return src;
}

export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** Order in which the offsets of a block×block tile are visited (greedy farthest point on the torus). */
export function interleaveOrder(b: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let y = 0; y < b; y++) for (let x = 0; x < b; x++) cells.push([x, y]);
  if (b === 1) return cells;
  const order: [number, number][] = [cells.splice(Math.floor(cells.length / 2), 1)[0]!];
  while (cells.length) {
    let best = 0;
    let bestD = -1;
    cells.forEach(([x, y], i) => {
      let d = Infinity;
      for (const [ox, oy] of order) {
        const dx = Math.min(Math.abs(x - ox), b - Math.abs(x - ox));
        const dy = Math.min(Math.abs(y - oy), b - Math.abs(y - oy));
        d = Math.min(d, dx * dx + dy * dy);
      }
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    });
    order.push(cells.splice(best, 1)[0]!);
  }
  return order;
}

export interface OfflineOptions {
  width: number;
  height: number;
  spp: number;
  tolerance: number; // adaptive RK4 local error tolerance (0 = fixed heuristic steps)
  eps: number; // heuristic step scale (upper bound when adaptive)
  maxSteps: number;
  noiseThreshold: number; // relative standard error at which a pixel stops sampling (0 = off)
  minSpp: number;
  shutter: number; // motion-blur exposure [M]
  budgetMs: number; // GPU time per frame
}

export interface OfflineStatus {
  width: number;
  height: number;
  progress: number; // 0..1
  spp: number;
  targetSpp: number;
  elapsed: number; // s
  eta: number; // s
  paused: boolean;
  done: boolean;
}

export interface FrameStats {
  phase: "realtime" | "converging" | "converged" | "offline";
  block: number;
  spp: number;
  gpuMs: number;
  width: number;
  height: number;
  offline?: OfflineStatus;
}

interface Target {
  width: number;
  height: number;
  accum: GPUBuffer;
  moments: GPUBuffer;
  stamps: GPUBuffer;
  hdr: GPUTexture;
  bloomTex: GPUTexture;
  bloomLevels: number;
  resolveBuf: GPUBuffer;
  polAcc: GPUBuffer; // Σ Stokes Q, U per pixel
  polGrid: GPUBuffer; // per tick cell Σ I, Q, U, n
  polGridBuf: GPUBuffer; // cell px, grid W, grid H, image W
  polGridPass: GPUBindGroup;
  beam: { level: number; tex: GPUTexture; buf: GPUBuffer; h: GPUBindGroup; v: GPUBindGroup } | null;
  traceBind: GPUBindGroup;
  postPasses: { pipeline: GPUComputePipeline; bind: GPUBindGroup; w: number; h: number }[];
  displayBinds: Map<GPURenderPipeline, GPUBindGroup>;
}

interface OfflineJob {
  target: Target;
  settings: Settings;
  time: number;
  opts: OfflineOptions;
  sampleIndex: number;
  bandY: number;
  bandRows: number;
  elapsed: number; // active seconds
  lastTick: number;
  paused: boolean;
  done: boolean;
  shown: boolean;
}

export class Renderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private tracePipeline: GPUComputePipeline; // realtime kernel
  private qualityPipeline: GPUComputePipeline; // + error-controlled integrator
  private traceLayout: GPUBindGroupLayout;
  private displayPipeline: GPURenderPipeline; // SDR canvas (preferred format)
  private sdrFormat: GPUTextureFormat;
  private hdrActive = false;
  private export8Pipeline: GPURenderPipeline;
  private export16Pipeline: GPURenderPipeline;
  private postResolve: GPUComputePipeline;
  private postDown: GPUComputePipeline;
  private postUp: GPUComputePipeline;
  private postPolGrid: GPUComputePipeline;
  private postBeamH: GPUComputePipeline;
  private postBeamV: GPUComputePipeline;
  private params = new ArrayBuffer(PARAM_VEC4S * 16);
  private paramsF = new Float32Array(this.params);
  private paramsU = new Uint32Array(this.params);
  private paramBuf: GPUBuffer;
  private displayBuf: GPUBuffer;
  private lutBuf: GPUBuffer;
  private syncLutBuf: GPUBuffer;
  private bgTexture: GPUTexture;
  private mwTexture: GPUTexture;
  private starLodTexture: GPUTexture;
  private catalogue: GPUBuffer;
  private skyBuilder: SkyTextureBuilder;
  private skyReady = false;
  private sampler: GPUSampler;
  private clampSampler: GPUSampler;

  private live: Target | null = null;
  private offline: OfflineJob | null = null;

  // live view state
  private frameStamp = 0;
  private epoch = 1;
  private sampleIndex = 0;
  private bandY = 0;
  private bandRows = 64;
  private realtimeBlock = 2;
  private lastBlock = 2;
  private interleaveIndex = 0;
  private lastOffset: [number, number] = [0, 0];
  private busy = false;
  private lastGpuMs = 0;
  private lastPhase: FrameStats["phase"] = "realtime";
  private slowFrames = 0;
  private fastFrames = 0;
  private orders = new Map<number, [number, number][]>();

  private cache = { spin: NaN, rIn: 0, fmax: 1, temp: NaN, logY: 0, alpha: NaN, volColor: [1, 1, 1] as number[] };

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    src: { trace: string; display: string; post: string; sky: string },
  ) {
    this.device = device;
    this.context = context;
    this.sdrFormat = format;

    const traceModule = device.createShaderModule({ code: src.trace, label: "trace" });
    const displayModule = device.createShaderModule({ code: src.display, label: "display" });
    const postModule = device.createShaderModule({ code: src.post, label: "post" });
    // explicit layout shared by the realtime and quality variants of the tracer
    const C = GPUShaderStage.COMPUTE;
    this.traceLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: "uniform" } },
        { binding: 1, visibility: C, buffer: { type: "storage" } },
        { binding: 2, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: C, texture: { sampleType: "float" } },
        { binding: 4, visibility: C, sampler: { type: "filtering" } },
        { binding: 5, visibility: C, buffer: { type: "storage" } },
        { binding: 6, visibility: C, buffer: { type: "storage" } },
        { binding: 7, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 8, visibility: C, texture: { sampleType: "float" } },
        { binding: 9, visibility: C, texture: { sampleType: "float" } },
        { binding: 10, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 11, visibility: C, buffer: { type: "storage" } },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.traceLayout] });
    const mkTrace = (quality: boolean) =>
      device.createComputePipeline({
        layout,
        compute: { module: traceModule, entryPoint: "main", constants: { QUALITY_PIPELINE: quality ? 1 : 0 } },
      });
    this.qualityPipeline = mkTrace(true);
    this.tracePipeline = mkTrace(false);
    const mkDisplay = (fmt: GPUTextureFormat) =>
      device.createRenderPipeline({
        layout: "auto",
        vertex: { module: displayModule, entryPoint: "vs" },
        fragment: { module: displayModule, entryPoint: "fs", targets: [{ format: fmt }] },
        primitive: { topology: "triangle-list" },
      });
    this.displayPipeline = mkDisplay(format);
    this.export8Pipeline = mkDisplay("rgba8unorm");
    this.export16Pipeline = mkDisplay("rgba16float");
    const mkPost = (entryPoint: string) =>
      device.createComputePipeline({ layout: "auto", compute: { module: postModule, entryPoint } });
    this.postResolve = mkPost("resolve");
    this.postDown = mkPost("down");
    this.postUp = mkPost("up");
    this.postPolGrid = mkPost("polgrid");
    this.postBeamH = mkPost("beamH");
    this.postBeamV = mkPost("beamV");

    this.paramBuf = device.createBuffer({ size: this.params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.displayBuf = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const lut = buildBlackbodyLUT();
    this.lutBuf = device.createBuffer({ size: lut.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.lutBuf, 0, lut);
    const sync = buildSynchrotronLUT();
    this.syncLutBuf = device.createBuffer({ size: sync.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.syncLutBuf, 0, sync);
    // trilinear + anisotropic: sky lookups use explicit gradients from the lensed pixel footprint
    this.sampler = device.createSampler({
      magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", maxAnisotropy: 16, addressModeU: "repeat",
    });
    this.clampSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    const placeholder = () => {
      const t = device.createTexture({ size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture: t }, new Uint8Array([0, 0, 0, 255]), {}, [1, 1]);
      return t;
    };
    this.bgTexture = placeholder();
    this.mwTexture = placeholder();
    this.starLodTexture = placeholder();
    // empty catalogue: grid 1, no stars
    this.catalogue = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.catalogue, 0, new Uint32Array([0x31525453, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    this.skyBuilder = new SkyTextureBuilder(device, src.sky);
  }

  /**
   * Loads the real sky (Gaia DR2 Milky Way map + Hipparcos/HYG catalogue) in the background; the
   * procedural sky is shown until it is ready.
   */
  async loadSky(): Promise<void> {
    const [bitmap, lod, cat] = await Promise.all([
      fetch(milkyWayUrl)
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" })),
      loadPackedTexture(this.device, starLodUrl),
      loadStarCatalogue(this.device, starCatalogueUrl),
    ]);
    this.mwTexture = this.skyBuilder.build(bitmap, "log16", this.device.limits.maxTextureDimension2D);
    this.starLodTexture = lod;
    this.catalogue = cat;
    this.skyReady = true;
    if (this.live) this.bindTarget(this.live);
    if (this.offline) this.bindTarget(this.offline.target);
    this.invalidate();
  }

  get realSkyLoaded() {
    return this.skyReady;
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    if (!navigator.gpu) throw new Error("WebGPU is not available in this browser.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter found.");
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBuffersPerShaderStage: Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 10),
        maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      },
    });
    device.lost.then((info) => console.error("WebGPU device lost:", info.message));
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("Could not create a WebGPU canvas context.");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    const src = {
      trace: await wgsl(traceWGSL), display: await wgsl(displayWGSL), post: await wgsl(postWGSL), sky: await wgsl(skyWGSL),
    };
    device.pushErrorScope("validation");
    const r = new Renderer(device, context, format, src);
    for (const [name, code] of Object.entries(src)) {
      const info = await device.createShaderModule({ code }).getCompilationInfo();
      const errors = info.messages.filter((m) => m.type === "error");
      if (errors.length) {
        throw new Error(`${name}.wgsl failed to compile:\n` + errors.map((m) => `  ${m.lineNum}:${m.linePos} ${m.message}`).join("\n"));
      }
    }
    const err = await device.popErrorScope();
    if (err) throw new Error(`WebGPU pipeline creation failed: ${err.message}`);
    return r;
  }

  /** Extended-range output currently active on the canvas. */
  get hdr() {
    return this.hdrActive;
  }

  /**
   * Switches the canvas between SDR (preferred 8-bit format) and extended range (rgba16float with
   * tone mapping "extended": values above 1 are shown brighter than SDR white on EDR/HDR screens).
   */
  private configureOutput(s: Settings) {
    const screenHdr = globalThis.matchMedia?.("(dynamic-range: high)").matches ?? false;
    const want = s.hdr === "on" || (s.hdr === "auto" && screenHdr);
    if (want === this.hdrActive) return;
    this.hdrActive = want;
    this.context.configure(
      want
        ? { device: this.device, format: "rgba16float", alphaMode: "opaque", toneMapping: { mode: "extended" } }
        : { device: this.device, format: this.sdrFormat, alphaMode: "opaque" },
    );
  }

  private get canvasPipeline() {
    return this.hdrActive ? this.export16Pipeline : this.displayPipeline;
  }

  get size() {
    return { width: this.live?.width ?? 0, height: this.live?.height ?? 0 };
  }

  /** Largest offline render the device can hold (accumulation buffer + texture limits). */
  get maxRender() {
    const l = this.device.limits;
    return {
      dimension: l.maxTextureDimension2D,
      pixels: Math.floor(Math.min(l.maxBufferSize, l.maxStorageBufferBindingSize) / 16),
    };
  }

  /** Scene changed: previous samples of the live view become stale. */
  invalidate() {
    this.epoch = this.frameStamp + 1;
    this.sampleIndex = 0;
    this.bandY = 0;
  }

  // ------------------------------------------------------------------------------------ targets
  private createTarget(width: number, height: number, polarization = true): Target {
    const d = this.device;
    const px = width * height;
    const polAcc = d.createBuffer({ size: polarization ? px * 8 : 16, usage: GPUBufferUsage.STORAGE });
    const polGrid = d.createBuffer({ size: Math.max(16, Math.ceil(width / 6) * Math.ceil(height / 6) * 16), usage: GPUBufferUsage.STORAGE });
    const polGridBuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const accum = d.createBuffer({ size: px * 16, usage: GPUBufferUsage.STORAGE });
    const moments = d.createBuffer({ size: px * 4, usage: GPUBufferUsage.STORAGE });
    const stamps = d.createBuffer({ size: px * 4, usage: GPUBufferUsage.STORAGE });
    const bloomLevels = Math.max(2, Math.min(8, Math.floor(Math.log2(Math.min(width, height))) - 3));
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;
    const hdr = d.createTexture({ size: [width, height], format: "rgba16float", mipLevelCount: bloomLevels, usage });
    const bloomTex = d.createTexture({
      size: [Math.max(1, width >> 1), Math.max(1, height >> 1)],
      format: "rgba16float",
      mipLevelCount: bloomLevels - 1,
      usage,
    });
    const resolveBuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const t: Target = {
      width,
      height,
      accum,
      moments,
      stamps,
      hdr,
      bloomTex,
      bloomLevels,
      resolveBuf,
      polAcc,
      polGrid,
      polGridBuf,
      polGridPass: null as unknown as GPUBindGroup,
      beam: null,
      traceBind: null as unknown as GPUBindGroup,
      postPasses: [],
      displayBinds: new Map(),
    };
    this.bindTarget(t);
    return t;
  }

  private destroyTarget(t: Target | null) {
    if (!t) return;
    for (const b of [t.accum, t.moments, t.stamps, t.resolveBuf, t.polAcc, t.polGrid, t.polGridBuf]) b.destroy();
    t.hdr.destroy();
    t.bloomTex.destroy();
    t.beam?.tex.destroy();
    t.beam?.buf.destroy();
  }

  private bindTarget(t: Target) {
    const d = this.device;
    t.traceBind = d.createBindGroup({
      layout: this.traceLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuf } },
        { binding: 1, resource: { buffer: t.accum } },
        { binding: 2, resource: { buffer: this.lutBuf } },
        { binding: 3, resource: this.bgTexture.createView() },
        { binding: 4, resource: this.sampler },
        { binding: 5, resource: { buffer: t.moments } },
        { binding: 6, resource: { buffer: t.stamps } },
        { binding: 7, resource: { buffer: this.syncLutBuf } },
        { binding: 8, resource: this.mwTexture.createView() },
        { binding: 9, resource: this.starLodTexture.createView() },
        { binding: 10, resource: { buffer: this.catalogue } },
        { binding: 11, resource: { buffer: t.polAcc } },
      ],
    });
    t.polGridPass = d.createBindGroup({
      layout: this.postPolGrid.getBindGroupLayout(0),
      entries: [
        { binding: 4, resource: { buffer: t.accum } },
        { binding: 7, resource: { buffer: t.polAcc } },
        { binding: 8, resource: { buffer: t.polGrid } },
        { binding: 9, resource: { buffer: t.polGridBuf } },
      ],
    });
    t.displayBinds.clear();
    for (const p of [this.displayPipeline, this.export8Pipeline, this.export16Pipeline]) {
      t.displayBinds.set(
        p,
        d.createBindGroup({
          layout: p.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: t.hdr.createView() },
            { binding: 1, resource: { buffer: this.displayBuf } },
            { binding: 2, resource: t.bloomTex.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
            { binding: 3, resource: this.clampSampler },
            { binding: 4, resource: { buffer: t.polGrid } },
          ],
        }),
      );
    }

    // resolve → downsample hdr[0] → … → hdr[n-1] → upsample into bloom[k-1] = hdr[k] + tent(bloom[k])
    const hdrMip = (l: number) => t.hdr.createView({ baseMipLevel: l, mipLevelCount: 1 });
    const bloomMip = (l: number) => t.bloomTex.createView({ baseMipLevel: l - 1, mipLevelCount: 1 });
    const mipSize = (l: number) => [Math.max(1, t.width >> l), Math.max(1, t.height >> l)] as const;
    const n = t.bloomLevels;
    t.postPasses = [
      {
        pipeline: this.postResolve,
        w: t.width,
        h: t.height,
        bind: d.createBindGroup({
          layout: this.postResolve.getBindGroupLayout(0),
          entries: [
            { binding: 2, resource: hdrMip(0) },
            { binding: 4, resource: { buffer: t.accum } },
            { binding: 5, resource: { buffer: t.resolveBuf } },
            { binding: 6, resource: { buffer: t.stamps } },
            { binding: 7, resource: { buffer: t.polAcc } },
          ],
        }),
      },
    ];
    for (let l = 1; l < n; l++) {
      const [w, h] = mipSize(l);
      t.postPasses.push({
        pipeline: this.postDown,
        w,
        h,
        bind: d.createBindGroup({
          layout: this.postDown.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: hdrMip(l - 1) },
            { binding: 1, resource: this.clampSampler },
            { binding: 2, resource: hdrMip(l) },
          ],
        }),
      });
    }
    for (let l = n - 2; l >= 1; l--) {
      const [w, h] = mipSize(l);
      t.postPasses.push({
        pipeline: this.postUp,
        w,
        h,
        bind: d.createBindGroup({
          layout: this.postUp.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: l === n - 2 ? hdrMip(n - 1) : bloomMip(l + 1) },
            { binding: 1, resource: this.clampSampler },
            { binding: 2, resource: bloomMip(l) },
            { binding: 3, resource: hdrMip(l) },
          ],
        }),
      });
    }
  }

  resize(width: number, height: number) {
    if (width < 1 || height < 1) return;
    width = Math.max(8, Math.floor(width));
    height = Math.max(8, Math.floor(height));
    if (this.live && width === this.live.width && height === this.live.height) return;
    const old = this.live;
    this.live = this.createTarget(width, height);
    if (old) this.device.queue.onSubmittedWorkDone().then(() => this.destroyTarget(old));
    this.invalidate();
  }

  async setBackgroundImage(file: Blob) {
    const bmp = await createImageBitmap(file, { colorSpaceConversion: "none" });
    // linear half floats + mips (footprint-filtered lookups)
    const tex = this.skyBuilder.build(bmp, "srgb", this.device.limits.maxTextureDimension2D);
    const old = this.bgTexture;
    this.bgTexture = tex;
    if (this.live) this.bindTarget(this.live);
    if (this.offline) this.bindTarget(this.offline.target);
    this.device.queue.onSubmittedWorkDone().then(() => old.destroy());
    this.invalidate();
  }

  // ------------------------------------------------------------------------------------ uniforms
  private diskConstants(s: Settings) {
    const c = this.cache;
    if (c.spin !== s.spin) {
      c.spin = s.spin;
      c.rIn = isco(s.spin);
      c.fmax = ntFluxMax(s.spin, c.rIn).fmax;
    }
    if (c.temp !== s.diskTemp) {
      c.temp = s.diskTemp;
      c.logY = blackbodyLogY(s.diskTemp);
    }
    if (c.alpha !== s.hotFlowAlpha) {
      c.alpha = s.hotFlowAlpha;
      c.volColor = powerLawRGB(s.hotFlowAlpha);
    }
    return c;
  }

  private writeParams(
    t: Target,
    s: Settings,
    time: number,
    o: {
      block: number;
      eps: number;
      steps: number;
      y0: number;
      y1: number;
      accumulate: boolean;
      sampleIndex: number;
      flags: number;
      offset?: [number, number];
      tol?: number;
      noise?: number;
      minSpp?: number;
      shutter?: number;
    },
  ) {
    const f = this.paramsF;
    const u = this.paramsU;
    const cam = cameraFrame(s);
    const dc = this.diskConstants(s);
    const a = s.spin;
    const tanH = Math.tan((s.fov * Math.PI) / 360);
    const pixelAngle = (2 * tanH) / t.height;
    const set = (i: number, x: number, y: number, z: number, w: number) => f.set([x, y, z, w], i * 4);

    set(0, t.width, t.height, o.block, o.sampleIndex);
    set(1, cam.r, cam.theta, cam.phi, tanH);
    set(2, ...cam.right, t.width / t.height);
    set(3, ...cam.up, pixelAngle);
    set(4, ...cam.fwd, 0);
    set(5, cam.zamo.alpha, cam.zamo.omega, cam.zamo.varpi, cam.zamo.sqrtSig);
    set(6, cam.zamo.sqrtSigOverDel, 0, 0, 0);
    set(7, ...cam.beta, cam.gamma);
    set(8, a, horizon(a), dc.rIn, Math.max(s.diskOuter, dc.rIn + 0.5));
    set(9, s.diskTemp, dc.fmax, s.turbulence, dc.logY);
    set(10, o.eps, o.steps, this.escapeRadius(s), captureTolerance(a));
    set(11, time, s.flowPeriod, s.bgIntensity, pixelAngle * 0.35 * s.starSize);
    set(12, s.hotFlow ? 1 : 0, s.hotFlowHR, s.hotFlowAlpha, s.hotFlowIntensity);
    set(13, o.y0, o.y1, o.accumulate ? 1 : 0, Math.random());
    set(14, s.limbDarkening ? 1 : 0, s.diskEmission === "bolometric" ? 1 : 0, s.diskBrightness, s.diskTau);
    set(15, s.jet ? 1 : 0, Math.sqrt(1 - 1 / (s.jetLorentz * s.jetLorentz)), s.jetWidth, s.jetIntensity);
    set(16, s.jetLength, s.jetCutoff, s.jetKnots, 0);
    u.set([this.frameStamp, t === this.live ? this.epoch : 0, o.flags, o.minSpp ?? 0], 17 * 4);
    set(18, o.tol ?? 1e-5, o.noise ?? 0, o.shutter ?? 0, s.temporalBlend);
    set(19, o.offset?.[0] ?? 0, o.offset?.[1] ?? 0, s.diskThickness, 0);
    set(20, dc.volColor[0]!, dc.volColor[1]!, dc.volColor[2]!, 0);
    u.set([RENDER_MODES[s.renderMode], SHIFT_MODES[s.shiftMode], BG_MODES[s.background], s.disk ? 1 : 0], 21 * 4);
    const sky = skyMatrix(s);
    set(22, ...sky[0], s.starBrightness * STAR_FLUX_SCALE);
    set(23, ...sky[1], this.skyReady ? 1 : 0);
    set(24, ...sky[2], 0);
    set(25, s.polarization ? 1 : 0, s.polFraction, POL_FIELDS[s.polField], (s.polJetPitch * Math.PI) / 180);
    set(26, s.returningRadiation ? 1 : 0, s.diskAlbedo, 3000, 0);
    set(27, BANDS[s.band], s.radioTau, s.radioNuS, s.radioTe / 0.593);
    set(28, s.radioJet, s.hotFlowHR, 0, 0);
    set(29, s.hotSpot ? 1 : 0, Math.max(s.spotRadius, horizon(a) + 1.5 * s.spotSize), s.spotSize, s.spotTau);
    set(30, s.spotTemp, s.spotBrightness, (s.spotPhase * Math.PI) / 180, s.spotHeight);
    this.device.queue.writeBuffer(this.paramBuf, 0, this.params);
  }

  /**
   * Radius beyond which an outgoing ray has left all emitting matter; the rest of its path is
   * handled by the analytic weak-field deflection (error O(M²/r²)).
   */
  private escapeRadius(s: Settings) {
    let r = Math.max(60, 1.5 * s.diskOuter);
    if (s.jet) r = Math.max(r, s.jetLength * 1.05);
    if (s.hotFlow) r = Math.max(r, 1.5 * s.diskOuter);
    return r;
  }

  /** Tick cell size in image pixels and grid dimensions. */
  private polCells(s: Settings, t: Target) {
    const cs = Math.max(6, Math.round((s.polTickSize * t.height) / 1080));
    return { cs, gw: Math.ceil(t.width / cs), gh: Math.ceil(t.height / cs) };
  }

  private writeDisplay(s: Settings, target: Target, outW: number, outH: number, letterbox: boolean, dither: boolean, hdr = false) {
    let sx = 1;
    let sy = 1;
    let ox = 0;
    let oy = 0;
    if (letterbox) {
      const k = Math.min(outW / target.width, outH / target.height);
      sx = (target.width * k) / outW;
      sy = (target.height * k) / outH;
      ox = (1 - sx) / 2;
      oy = (1 - sy) / 2;
    }
    const d = new Float32Array([
      outW, outH, Math.pow(2, s.exposure) / (s.band === "230GHz" ? s.radioPeak : 1), TONEMAPS[s.tonemap],
      s.renderMode === "physical" ? 0 : 1, s.bloom, target.bloomLevels - 1, dither ? 1 : 0,
      sx, sy, ox, oy,
      hdr ? 1 : 0, Math.max(1, s.hdrPeak), 0, 0,
      ...(() => {
        const { cs, gw, gh } = this.polCells(s, target);
        return [s.polarization ? 1 : 0, cs, gw, gh];
      })(),
      // fraction drawn at full length: synchrotron scenes vs the thermal disk's ≤ 11.7 %
      target.width, target.height, s.hotFlow || s.jet ? Math.max(0.05, s.polFraction) : 0.117, s.band === "230GHz" ? 1 : 0,
      this.beamSetup(s, target)?.level ?? 0, 0, 0, 0,
    ]);
    this.device.queue.writeBuffer(this.displayBuf, 0, d);
  }

  private writeResolve(t: Target, s: Settings) {
    const view = s.polarization && s.polView === "intensity" ? 1 << 8 : 0;
    const r = t === this.live ? [this.lastBlock | view, ...this.lastOffset, this.epoch] : [1 | view, 0, 0, 0];
    this.device.queue.writeBuffer(t.resolveBuf, 0, new Uint32Array(r));
    if (s.polarization) {
      const { cs, gw, gh } = this.polCells(s, t);
      this.device.queue.writeBuffer(t.polGridBuf, 0, new Uint32Array([cs, gw, gh, t.width]));
    }
  }

  private dispatchTrace(enc: GPUCommandEncoder, t: Target, x: number, y: number, quality: boolean) {
    const pass = enc.beginComputePass();
    pass.setPipeline(quality ? this.qualityPipeline : this.tracePipeline);
    pass.setBindGroup(0, t.traceBind);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(x / 8)), Math.max(1, Math.ceil(y / 8)));
    pass.end();
  }

  /**
   * Instrument beam: Gaussian of FWHM beamUas, with GM/c² subtending uasPerM, at the hole's distance
   * (1 M ≈ 1/r rad from the camera). Blurred on the coarsest mip level where σ ≥ 2 px; the display
   * samples that level (bilinear magnification of a band-limited image).
   */
  private beamSetup(s: Settings, t: Target) {
    if (s.band === "visible" || s.beamUas <= 0) return null;
    const pixelAngle = (2 * Math.tan((s.fov * Math.PI) / 360)) / t.height;
    const sigmaPx = ((s.beamUas / 2.3548) / s.uasPerM / Math.max(s.distance, 2)) / pixelAngle;
    if (sigmaPx < 1) return null;
    const level = Math.max(0, Math.min(t.bloomLevels - 1, Math.floor(Math.log2(sigmaPx / 2))));
    return { level, sigma: sigmaPx / 2 ** level };
  }

  private encodeBeam(enc: GPUCommandEncoder, t: Target, s: Settings) {
    const b = this.beamSetup(s, t);
    if (!b) return;
    const d = this.device;
    const w = Math.max(1, t.width >> b.level);
    const h = Math.max(1, t.height >> b.level);
    if (!t.beam || t.beam.level !== b.level) {
      t.beam?.tex.destroy();
      t.beam?.buf.destroy();
      const tex = d.createTexture({ size: [w, h], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
      const buf = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const lv = t.hdr.createView({ baseMipLevel: b.level, mipLevelCount: 1 });
      const mk = (p: GPUComputePipeline, src: GPUTextureView, dst: GPUTextureView) =>
        d.createBindGroup({
          layout: p.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: src },
            { binding: 2, resource: dst },
            { binding: 10, resource: { buffer: buf } },
          ],
        });
      t.beam = { level: b.level, tex, buf, h: mk(this.postBeamH, lv, tex.createView()), v: mk(this.postBeamV, tex.createView(), lv) };
    }
    d.queue.writeBuffer(t.beam.buf, 0, new Float32Array([b.sigma, Math.ceil(3 * b.sigma), 0, 0]));
    for (const [p, g] of [[this.postBeamH, t.beam.h], [this.postBeamV, t.beam.v]] as const) {
      const pass = enc.beginComputePass();
      pass.setPipeline(p);
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
      pass.end();
    }
  }

  private encodePost(enc: GPUCommandEncoder, t: Target, s?: Settings) {
    if (s?.polarization) {
      const { gw, gh } = this.polCells(s, t);
      const pass = enc.beginComputePass();
      pass.setPipeline(this.postPolGrid);
      pass.setBindGroup(0, t.polGridPass);
      pass.dispatchWorkgroups(Math.ceil(gw / 8), Math.ceil(gh / 8));
      pass.end();
    }
    t.postPasses.forEach((p, i) => {
      const pass = enc.beginComputePass();
      pass.setPipeline(p.pipeline);
      pass.setBindGroup(0, p.bind);
      pass.dispatchWorkgroups(Math.ceil(p.w / 8), Math.ceil(p.h / 8));
      pass.end();
      // beam after the downsampling chain (resolve + n − 1 downs), before the bloom upsampling
      if (s && i === t.bloomLevels - 1) this.encodeBeam(enc, t, s);
    });
  }

  private encodeDisplay(enc: GPUCommandEncoder, t: Target, pipeline: GPURenderPipeline, view: GPUTextureView) {
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
    });
    rp.setPipeline(pipeline);
    rp.setBindGroup(0, t.displayBinds.get(pipeline)!);
    rp.draw(3);
    rp.end();
  }

  private submit(enc: GPUCommandEncoder, done: (ms: number) => void) {
    const t0 = performance.now();
    this.device.queue.submit([enc.finish()]);
    this.busy = true;
    this.device.queue.onSubmittedWorkDone().then(() => {
      this.busy = false;
      const ms = performance.now() - t0;
      this.lastGpuMs = ms;
      done(ms);
    });
  }

  // ------------------------------------------------------------------------------------ live view
  /**
   * One frame of the live view.
   *  - A scene change (camera, parameters) starts a new epoch: earlier samples become stale.
   *  - Realtime (scene or time changing): one ray per block at a rotating offset. With a still
   *    camera the image fills in at full resolution over block² frames, temporally accumulated
   *    while time runs; stale pixels are reconstructed from the current frame's samples.
   *  - Still: progressive full-resolution refinement (error-controlled RK4, Gaussian-filtered
   *    jittered samples, adaptive sampling) in bands sized to ~28 ms of GPU time.
   */
  frame(s: Settings, time: number, sceneChanged: boolean, timeChanged: boolean, displayChanged: boolean): FrameStats | null {
    if (this.busy) return null;
    if (this.offline) return this.offlineFrame(s, displayChanged);
    const t = this.live;
    if (!t) return null;
    const cv = this.context.canvas as HTMLCanvasElement;
    if (cv.width !== t.width || cv.height !== t.height) return null;

    if (sceneChanged) this.invalidate();
    this.configureOutput(s);
    const enc = this.device.createCommandEncoder();
    let phase: FrameStats["phase"];
    let rows = 0;

    if (sceneChanged || timeChanged) {
      phase = "realtime";
      this.frameStamp++;
      this.sampleIndex = 0;
      this.bandY = 0;
      const block = s.realtimeSubsampling === "auto" ? this.realtimeBlock : s.realtimeSubsampling;
      if (block !== this.lastBlock) this.interleaveIndex = 0;
      let order = this.orders.get(block);
      if (!order) this.orders.set(block, (order = interleaveOrder(block)));
      const offset = order[this.interleaveIndex++ % order.length]!;
      let flags = FLAG_INTERLEAVED;
      if (s.temporalBlend < 1) flags |= FLAG_TEMPORAL;
      this.writeParams(t, s, time, {
        block, eps: s.realtimeEps, steps: s.realtimeSteps, y0: 0, y1: t.height, accumulate: false,
        sampleIndex: 0, flags, offset,
      });
      this.dispatchTrace(enc, t, Math.ceil(t.width / block), Math.ceil(t.height / block), false);
      this.lastBlock = block;
      this.lastOffset = offset;
    } else if (this.sampleIndex < s.targetSpp) {
      phase = "converging";
      this.frameStamp++;
      const y0 = this.bandY;
      const y1 = Math.min(t.height, y0 + this.bandRows);
      rows = y1 - y0;
      let flags = 0;
      if (s.adaptiveIntegrator) flags |= FLAG_ADAPTIVE_RK;
      if (s.noiseThreshold > 0) flags |= FLAG_ADAPTIVE_SPP;
      this.writeParams(t, s, time, {
        block: 1, eps: s.qualityEps, steps: s.qualitySteps, y0, y1, accumulate: this.sampleIndex > 0,
        sampleIndex: this.sampleIndex, flags, tol: s.integratorTolerance, noise: s.noiseThreshold, minSpp: 8,
      });
      this.dispatchTrace(enc, t, t.width, rows, s.adaptiveIntegrator);
      this.bandY = y1;
      if (this.bandY >= t.height) {
        this.bandY = 0;
        this.sampleIndex++;
      }
    } else {
      phase = "converged";
      if (this.lastPhase === "converged" && !displayChanged) return this.stats(phase, t);
    }

    this.writeResolve(t, s);
    this.writeDisplay(s, t, t.width, t.height, false, true, this.hdrActive);
    this.encodePost(enc, t, s);
    this.encodeDisplay(enc, t, this.canvasPipeline, this.context.getCurrentTexture().createView());
    const auto = s.realtimeSubsampling === "auto";
    this.submit(enc, (ms) => {
      if (phase === "realtime" && auto) this.adaptBlock(ms);
      if (phase === "converging" && rows > 0) {
        const perRow = ms / rows;
        this.bandRows = Math.round(Math.min(t.height, Math.max(8, 0.5 * this.bandRows + 0.5 * (28 / Math.max(perRow, 1e-3)))));
      }
    });
    this.lastPhase = phase;
    return this.stats(phase, t);
  }

  /**
   * Auto subsampling: coarser blocks when realtime frames exceed ~36 ms; finer ones when the
   * predicted cost at the next finer level (∝ number of rays) stays under ~26 ms.
   */
  private adaptBlock(ms: number) {
    const i = BLOCKS.indexOf(this.realtimeBlock);
    const finer = i > 0 ? BLOCKS[i - 1]! : 0;
    const predicted = finer ? ms * (this.realtimeBlock / finer) ** 2 : Infinity;
    if (ms > 36) {
      this.slowFrames++;
      this.fastFrames = 0;
    } else if (predicted < 26) {
      this.fastFrames++;
      this.slowFrames = 0;
    } else {
      this.slowFrames = this.fastFrames = 0;
    }
    if (this.slowFrames >= 3 && i < BLOCKS.length - 1) {
      this.realtimeBlock = BLOCKS[i + 1]!;
      this.slowFrames = 0;
    } else if (this.fastFrames >= 8 && finer) {
      this.realtimeBlock = finer;
      this.fastFrames = 0;
    }
  }

  private stats(phase: FrameStats["phase"], t: Target): FrameStats {
    const frac = this.bandY / Math.max(t.height, 1);
    return {
      phase,
      block: this.lastBlock,
      spp: phase === "realtime" ? 0 : this.sampleIndex + (phase === "converging" ? frac : 0),
      gpuMs: this.lastGpuMs,
      width: t.width,
      height: t.height,
    };
  }

  // ------------------------------------------------------------------------------------ offline
  get offlineActive() {
    return !!this.offline;
  }

  get offlineState(): OfflineStatus | null {
    return this.offline ? this.offlineStatus(this.offline) : null;
  }

  /** Starts a render of the current scene, frozen in time, at an arbitrary resolution. */
  startOffline(s: Settings, time: number, opts: OfflineOptions) {
    this.cancelOffline();
    this.offline = {
      target: this.createTarget(opts.width, opts.height, s.polarization),
      settings: structuredClone(s),
      time,
      opts,
      sampleIndex: 0,
      bandY: 0,
      bandRows: 8,
      elapsed: 0,
      lastTick: performance.now(),
      paused: false,
      done: false,
      shown: false,
    };
  }

  pauseOffline(paused: boolean) {
    if (!this.offline) return;
    this.offline.paused = paused;
    this.offline.lastTick = performance.now();
    this.offline.shown = false;
  }

  /** Changes the per-frame GPU budget of a running job. */
  setOfflineBudget(ms: number) {
    if (this.offline) this.offline.opts.budgetMs = ms;
  }

  cancelOffline() {
    if (!this.offline) return;
    const t = this.offline.target;
    this.offline = null;
    this.device.queue.onSubmittedWorkDone().then(() => this.destroyTarget(t));
    this.invalidate();
  }

  private offlineStatus(job: OfflineJob): OfflineStatus {
    const { opts, target } = job;
    const spp = job.sampleIndex + job.bandY / target.height;
    const progress = job.done ? 1 : Math.min(1, spp / opts.spp);
    return {
      width: target.width,
      height: target.height,
      progress,
      spp,
      targetSpp: opts.spp,
      elapsed: job.elapsed,
      eta: progress > 0.002 && !job.done ? (job.elapsed * (1 - progress)) / progress : NaN,
      paused: job.paused,
      done: job.done,
    };
  }

  private offlineFrame(display: Settings, displayChanged: boolean): FrameStats | null {
    const job = this.offline!;
    const t = job.target;
    // the frozen scene, with the live exposure / tone mapping / bloom so they stay adjustable
    const s = {
      ...job.settings, exposure: display.exposure, tonemap: display.tonemap, bloom: display.bloom,
      hdr: display.hdr, hdrPeak: display.hdrPeak,
    };
    this.configureOutput(s);
    const cv = this.context.canvas as HTMLCanvasElement;
    const now = performance.now();
    const working = !job.paused && !job.done;
    if (working) job.elapsed += (now - job.lastTick) / 1000;
    job.lastTick = now;
    const result = (): FrameStats => ({
      phase: "offline",
      block: 1,
      spp: job.sampleIndex,
      gpuMs: this.lastGpuMs,
      width: t.width,
      height: t.height,
      offline: this.offlineStatus(job),
    });
    if (!working && job.shown && !displayChanged) return result();

    const enc = this.device.createCommandEncoder();
    let rows = 0;
    if (working) {
      this.frameStamp++;
      const o = job.opts;
      const y0 = job.bandY;
      const y1 = Math.min(t.height, y0 + job.bandRows);
      rows = y1 - y0;
      let flags = 0;
      if (o.tolerance > 0) flags |= FLAG_ADAPTIVE_RK;
      if (o.noiseThreshold > 0) flags |= FLAG_ADAPTIVE_SPP;
      this.writeParams(t, s, job.time, {
        block: 1, eps: o.eps, steps: o.maxSteps, y0, y1, accumulate: job.sampleIndex > 0,
        sampleIndex: job.sampleIndex, flags, tol: o.tolerance, noise: o.noiseThreshold, minSpp: o.minSpp,
        shutter: o.shutter,
      });
      this.dispatchTrace(enc, t, t.width, rows, o.tolerance > 0);
      job.bandY = y1;
      if (job.bandY >= t.height) {
        job.bandY = 0;
        job.sampleIndex++;
        if (job.sampleIndex >= o.spp) job.done = true;
      }
    }
    this.writeResolve(t, s);
    this.writeDisplay(s, t, cv.width, cv.height, true, true, this.hdrActive);
    this.encodePost(enc, t, s);
    this.encodeDisplay(enc, t, this.canvasPipeline, this.context.getCurrentTexture().createView());
    this.submit(enc, (ms) => {
      if (rows > 0) {
        const perRow = ms / rows;
        job.bandRows = Math.round(Math.min(t.height, Math.max(2, 0.5 * job.bandRows + 0.5 * (job.opts.budgetMs / Math.max(perRow, 1e-3)))));
      }
    });
    job.shown = true;
    return result();
  }

  // ------------------------------------------------------------------------------------ export
  private async readTexture(tex: GPUTexture, w: number, h: number, bpp: number): Promise<Uint8Array> {
    const bytesPerRow = Math.ceil((w * bpp) / 256) * 256;
    const buf = this.device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex, mipLevel: 0 }, { buffer: buf, bytesPerRow }, [w, h]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const out = new Uint8Array(w * h * bpp);
    for (let y = 0; y < h; y++) out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * bpp), y * w * bpp);
    buf.unmap();
    buf.destroy();
    return out;
  }

  private exportTarget(): Target {
    return this.offline?.target ?? this.live!;
  }

  /** Tone-mapped image of a target at its native resolution (8- or 16-bit float output). */
  private async renderDisplayed(s: Settings, t: Target, bits: 8 | 16): Promise<Uint8Array> {
    const format: GPUTextureFormat = bits === 8 ? "rgba8unorm" : "rgba16float";
    const pipeline = bits === 8 ? this.export8Pipeline : this.export16Pipeline;
    const tex = this.device.createTexture({
      size: [t.width, t.height],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const enc = this.device.createCommandEncoder();
    this.writeResolve(t, s);
    this.writeDisplay(s, t, t.width, t.height, false, bits === 8);
    this.encodePost(enc, t, s);
    this.encodeDisplay(enc, t, pipeline, tex.createView());
    this.device.queue.submit([enc.finish()]);
    const data = await this.readTexture(tex, t.width, t.height, bits === 8 ? 4 : 8);
    tex.destroy();
    return data;
  }

  /** Current image (the offline render if one exists, else the live view) as an 8-bit sRGB PNG. */
  async exportPNG(s: Settings): Promise<Blob> {
    const t = this.exportTarget();
    const px = await this.renderDisplayed(s, t, 8);
    const canvas = new OffscreenCanvas(t.width, t.height);
    const img = new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), t.width, t.height);
    canvas.getContext("2d")!.putImageData(img, 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
  }

  /** 16 bits per channel, tone-mapped sRGB PNG (no dithering). */
  async exportPNG16(s: Settings): Promise<Blob> {
    const t = this.exportTarget();
    const half = new Uint16Array((await this.renderDisplayed(s, t, 16)).buffer);
    const f = new Float32Array(half.length);
    for (let i = 0; i < half.length; i++) f[i] = halfToFloat(half[i]!);
    return encodePNG16(f, t.width, t.height);
  }

  /** Scene-referred linear radiance (× exposure) as half-float OpenEXR: no bloom, no tone mapping. */
  async exportEXR(s: Settings): Promise<Blob> {
    const t = this.exportTarget();
    const enc = this.device.createCommandEncoder();
    this.writeResolve(t, s);
    this.encodePost(enc, t, s);
    this.device.queue.submit([enc.finish()]);
    const half = new Uint16Array((await this.readTexture(t.hdr, t.width, t.height, 8)).buffer);
    const k = Math.pow(2, s.exposure);
    const f = new Float32Array(half.length);
    for (let i = 0; i < half.length; i++) f[i] = halfToFloat(half[i]!) * k;
    return encodeEXR(f, t.width, t.height);
  }
}
