// The sea's waves by FFT on the GPU (docs/PLAN-AVIATION-AAA.md, M1; shaders/seafft.wgsl): the cascades' initial
// amplitudes (sea/spectrum.ts) uploaded when the sea changes; each frame their modes now, their fields, the
// inverse FFTs, the texture array the tracer samples (three layers a cascade, 3c + j: its displacement-and-Jacobian, its
// slopes-and-their-squares, its foam and the slopes' product — seafft.wgsl) and its mips. Only the cascades in use: `active`,
// the coarsest first (PLAN-MER-WEBGPU S1 — from the air the finest are averaged whole by the nearest sea's pixel: their
// variance, known from the spectrum, stands for them). 1.6 ms on kerr-mini for three cascades (J0, 10 Nov 2026).

import { CASCADES, EARTH_SEA, SEA_N, type SeaCascades, type SeaPhysics } from "./spectrum";

const N = SEA_N;
const C: number = CASCADES.length;
export const SEA_LEVELS = Math.log2(N) + 1;
/** the world foam's first layer in the texture array (after the cascades' three each: 3C + 2·parity + level) */
export const FOAM_BASE = 3 * C;
/** the sky the sea mirrors (PLAN-MER-WEBGPU S5, the analysis's M4): the light probe about the camera, GGX-filtered by roughness —
 *  the ship's envSpec, 256 × 128, roughness = level / 5 —, copied into this layer's top half at each of its levels (takeSky) */
export const SKY_LAYER = 3 * C + 4;
/** the world foam's levels' sides [m] (seafft.wgsl FOAM_SIZE: both divide the sea's kilometre anchor) */
export const FOAM_SIZES = [128, 1024] as const;

/** The world foam's state for a frame (renderer seaFftParams): the camera on the sea's local axes [m], its cell on each level and
 *  the last frame's (in this frame's local axes), the cascades' offsets, the whitecaps' threshold and spread, the drift. */
export interface FoamFrame {
  cam: [number, number];
  cells: [number, number, number, number];
  prev: [number, number, number, number];
  offsets: number[];
  Jt: number;
  sJ: number;
  drift: [number, number];
  decay: number;
}
/** the device's sampled textures a stage the tracer needs to take the sea's (the surface's 18 and one) */
export const SEA_TEXTURE_LIMIT = 19;

/** The tracer without the sea's texture (a device taking fewer): its bindings out, its FFT waves the trains. */
export function seaShader(code: string, supported: boolean): string {
  if (supported) return code;
  return code
    .replace(/^@group\(0\) @binding\((33|34)\).*\n/gm, "")
    .replace(
      /\/\/ \(seaWavesFft begin\)[\s\S]*?\/\/ \(seaWavesFft end\)/,
      "fn seaWavesFft(q: vec3f, tu: vec3f, tc: vec3f, footM: f32) -> SeaWaves { return seaWaves(q, tu, tc, footM); }\nfn seaSurfaceHit(look: vec3f, t: f32, m: f32) -> f32 { return t; }",
    );
}

export class SeaFft {
  readonly texture: GPUTexture;
  private uniform: GPUBuffer;
  private h0: GPUBuffer;
  private fld: GPUBuffer;
  private foam: GPUBuffer;
  private pipes: Record<"spectrum" | "rows" | "cols" | "assemble" | "mip" | "foamWorld", GPUComputePipeline>;
  private binds: {
    spectrum: GPUBindGroup;
    rows: GPUBindGroup;
    cols: GPUBindGroup;
    assemble: GPUBindGroup;
    mips: GPUBindGroup[];
    foam: GPUBindGroup[];
  };
  private foamSampler: GPUSampler;
  /** the world foam's layer pair the next frame writes (0, 1: PLAN-MER-WEBGPU S4) — the tracer reads it after */
  foamParity = 0;
  /** whether a spectrum is there to animate */
  ready = false;
  /** what the spectrum holds: the height's and the slopes' variance over all cascades */
  stats = {
    height: 0,
    slopeX: 0,
    slopeZ: 0,
    slope01: 0,
    slopeC: [] as number[],
    /** each cascade's slopes' variance along, across, and their covariance */
    slopeXc: [] as number[],
    slopeZc: [] as number[],
    slopeXZc: [] as number[],
  };

  constructor(
    private device: GPUDevice,
    readonly code: string,
  ) {
    const d = device;
    this.texture = d.createTexture({
      // (the cascades' three layers each, then the world's foam: two levels × two layers written in turn — PLAN-MER-WEBGPU S4 —,
      // then the sky the sea mirrors — S5)
      size: [N, N, 3 * C + 5],
      format: "rgba16float",
      mipLevelCount: SEA_LEVELS,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });
    this.uniform = d.createBuffer({ size: 11 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.foam = d.createBuffer({ size: C * N * N * 4, usage: GPUBufferUsage.STORAGE });
    this.h0 = d.createBuffer({ size: C * N * N * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.fld = d.createBuffer({ size: C * 4 * N * N * 8, usage: GPUBufferUsage.STORAGE });
    const module = d.createShaderModule({ code, label: "seafft" });
    this.foamSampler = d.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });
    const pipe = (entryPoint: string) =>
      d.createComputePipeline({ layout: "auto", compute: { module, entryPoint }, label: `seafft ${entryPoint}` });
    this.pipes = {
      spectrum: pipe("spectrum"),
      rows: pipe("rows"),
      cols: pipe("cols"),
      assemble: pipe("assemble"),
      mip: pipe("mip"),
      foamWorld: pipe("foamWorld"),
    };
    const bg = (p: GPUComputePipeline, entries: { binding: number; resource: GPUBindingResource }[]) =>
      d.createBindGroup({ layout: p.getBindGroupLayout(0), entries });
    const level = (l: number, dim: "2d-array" = "2d-array") =>
      this.texture.createView({ dimension: dim, baseMipLevel: l, mipLevelCount: 1 });
    this.binds = {
      spectrum: bg(this.pipes.spectrum, [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.h0 } },
        { binding: 2, resource: { buffer: this.fld } },
      ]),
      rows: bg(this.pipes.rows, [{ binding: 2, resource: { buffer: this.fld } }]),
      cols: bg(this.pipes.cols, [{ binding: 2, resource: { buffer: this.fld } }]),
      assemble: bg(this.pipes.assemble, [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 2, resource: { buffer: this.fld } },
        { binding: 3, resource: level(0) },
        { binding: 5, resource: { buffer: this.foam } },
      ]),
      // (the world's foam, each parity: its pair written, the other read, the cascades' layers sampled)
      foam: [0, 1].map((w) =>
        bg(this.pipes.foamWorld, [
          { binding: 0, resource: { buffer: this.uniform } },
          {
            binding: 6,
            resource: this.texture.createView({
              dimension: "2d-array",
              baseMipLevel: 0,
              mipLevelCount: 1,
              baseArrayLayer: FOAM_BASE + 2 * w,
              arrayLayerCount: 2,
            }),
          },
          {
            binding: 7,
            resource: this.texture.createView({
              dimension: "2d-array",
              baseMipLevel: 0,
              mipLevelCount: 1,
              baseArrayLayer: FOAM_BASE + 2 * (1 - w),
              arrayLayerCount: 2,
            }),
          },
          { binding: 8, resource: this.texture.createView({ dimension: "2d-array", baseArrayLayer: 0, arrayLayerCount: 3 * C }) },
          { binding: 9, resource: this.foamSampler },
        ]),
      ),
      mips: Array.from({ length: SEA_LEVELS - 1 }, (_, i) =>
        bg(this.pipes.mip, [
          { binding: 3, resource: level(i + 1) },
          { binding: 4, resource: level(i) },
        ]),
      ),
    };
  }

  /** The sky the sea mirrors, from a probe's roughness levels (`src`: 2 : 1, rgba16float, level l at roughness l / 5 — the ship's
   *  envSpec) into the sky layer's top half, level by level; its own mips past them left as they are (read no coarser). */
  takeSky(enc: GPUCommandEncoder, src: GPUTexture) {
    const levels = Math.min(src.mipLevelCount, SEA_LEVELS);
    for (let l = 0; l < levels; l++) {
      const w = Math.max(1, src.width >> l),
        h = Math.max(1, src.height >> l);
      enc.copyTextureToTexture({ texture: src, mipLevel: l }, { texture: this.texture, mipLevel: l, origin: [0, 0, SKY_LAYER] }, [w, h, 1]);
    }
    this.skyLevels = levels;
  }
  /** the sky layer's levels written (0: none yet) */
  skyLevels = 0;

  /** A new sea: its cascades' amplitudes uploaded. */
  setSpectrum(s: SeaCascades) {
    for (let c = 0; c < C; c++) this.device.queue.writeBuffer(this.h0, c * N * N * 16, s.h0[c]!);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    this.stats = {
      height: sum(s.height),
      slopeX: sum(s.slopeX),
      slopeZ: sum(s.slopeZ),
      slope01: s.slopeX[0]! + s.slopeZ[0]! + s.slopeX[1]! + s.slopeZ[1]!,
      slopeC: s.slopeX.map((x, c) => x + s.slopeZ[c]!),
      slopeXc: [...s.slopeX],
      slopeZc: [...s.slopeZ],
      slopeXZc: [...s.slopeXZ],
    };
    this.ready = true;
  }

  /** A frame's waves at time `t` [s], choppiness `lambda`, into the texture array; `foamJ`: each cascade's Jacobian under
   *  which its crests break into foam (none: no foam made); `active`: the cascades computed (the coarsest first). */
  /** (the frames' runs, the last clock: a test's view of it) */
  runs = 0;
  lastT = 0;
  /** the cascades computed by the last frame (the coarsest first) */
  active: number = C;
  encode(
    enc: GPUCommandEncoder,
    t: number,
    lambda: number,
    desc: GPUComputePassDescriptor = { label: "sea fft" },
    foamJ = [-9, -9, -9, -9],
    phys: SeaPhysics = EARTH_SEA,
    active = C,
    foam: FoamFrame | null = null,
  ) {
    if (!this.ready) return;
    this.runs++;
    // (the foam's time step: the clock's, a frame's at most — a jump, a pause: nothing faded or made twice)
    const dt = Math.min(Math.max(t - this.lastT, 0), 0.1);
    this.lastT = t;
    // (the clock modulo the sea's repeat time — seafft.wgsl REPEAT — in float64: its phases exact in float32)
    const tm = ((t % 1024) + 1024) % 1024;
    this.device.queue.writeBuffer(
      this.uniform,
      0,
      new Float32Array([
        tm,
        lambda,
        C,
        N,
        ...CASCADES,
        ...[0, 1, 2, 3].map((c) => foamJ[c] ?? -9),
        phys.g,
        Number.isFinite(phys.depth) ? phys.depth : 0,
        dt,
        0,
        ...(foam ? foam.cells : [0, 0, 0, 0]),
        ...(foam ? foam.prev : [1e6, 1e6, 1e6, 1e6]),
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => foam?.offsets[i] ?? 0),
        ...(foam ? [foam.cam[0], foam.cam[1], foam.Jt, foam.sJ] : [0, 0, -9, 1]),
        ...(foam ? [foam.drift[0], foam.drift[1], foam.decay, this.foamParity] : [0, 0, 1, 0]),
        Math.min(Math.max(Math.round(active), 1), C),
        0,
        0,
        0,
      ]),
    );
    const A = Math.min(Math.max(Math.round(active), 1), C);
    this.active = A;
    const p = enc.beginComputePass(desc);
    p.setPipeline(this.pipes.spectrum);
    p.setBindGroup(0, this.binds.spectrum);
    p.dispatchWorkgroups(N / 8, N / 8, A);
    p.setPipeline(this.pipes.rows);
    p.setBindGroup(0, this.binds.rows);
    p.dispatchWorkgroups(1, N, 4 * A);
    p.setPipeline(this.pipes.cols);
    p.setBindGroup(0, this.binds.cols);
    p.dispatchWorkgroups(1, N, 4 * A);
    p.setPipeline(this.pipes.assemble);
    p.setBindGroup(0, this.binds.assemble);
    p.dispatchWorkgroups(N / 8, N / 8, A);
    // (the world's foam, then its pair's mips with the cascades')
    if (foam) {
      p.setPipeline(this.pipes.foamWorld);
      p.setBindGroup(0, this.binds.foam[this.foamParity]!);
      p.dispatchWorkgroups(N / 8, N / 8, 2);
    }
    p.setPipeline(this.pipes.mip);
    for (let l = 1; l < SEA_LEVELS; l++) {
      const w = Math.max(1, N >> l);
      p.setBindGroup(0, this.binds.mips[l - 1]!);
      p.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(w / 8), foam ? 3 * C + 4 : 3 * A);
    }
    if (foam) this.foamParity = 1 - this.foamParity;
    p.end();
  }

  /** The texture's first level read back (tests): each layer's channels' mean and standard deviation, min, max. */
  async probe(): Promise<{ mean: number[]; std: number[]; min: number[]; max: number[] }[]> {
    const d = this.device;
    const bytes = N * 8;
    const buf = d.createBuffer({ size: bytes * N * 3 * C, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = d.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.texture, mipLevel: 0 }, { buffer: buf, bytesPerRow: bytes, rowsPerImage: N }, [N, N, 3 * C]);
    d.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const u = new Uint16Array(buf.getMappedRange().slice(0));
    buf.unmap();
    buf.destroy();
    const half = (h: number) => {
      const s = h & 0x8000 ? -1 : 1,
        e = (h >> 10) & 31,
        f = h & 1023;
      return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? Number.NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
    };
    const out = [];
    for (let l = 0; l < 3 * C; l++) {
      const sum = [0, 0, 0, 0],
        sq = [0, 0, 0, 0],
        mn = [Infinity, Infinity, Infinity, Infinity],
        mx = [-Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < N * N; i++)
        for (let c = 0; c < 4; c++) {
          const v = half(u[(l * N * N + i) * 4 + c]!);
          sum[c]! += v;
          sq[c]! += v * v;
          mn[c] = Math.min(mn[c]!, v);
          mx[c] = Math.max(mx[c]!, v);
        }
      const n = N * N;
      out.push({
        mean: sum.map((x) => x / n),
        std: sq.map((x, c) => Math.sqrt(Math.max(0, x / n - (sum[c]! / n) ** 2))),
        min: mn,
        max: mx,
      });
    }
    return out;
  }

  destroy() {
    this.texture.destroy();
    this.uniform.destroy();
    this.h0.destroy();
    this.fld.destroy();
    this.foam.destroy();
  }
}
