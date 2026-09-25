import type { Settings } from "./settings";

type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3]; // rows

/** ICRS (J2000 equatorial) → galactic rotation (rows), Hipparcos definition. */
const EQ_TO_GAL: Mat3 = [
  [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
  [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mulMV = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const transpose = (m: Mat3): Mat3 => [
  [m[0][0], m[1][0], m[2][0]],
  [m[0][1], m[1][1], m[2][1]],
  [m[0][2], m[1][2], m[2][2]],
];

/**
 * Rotation from the black hole's frame (z = spin axis; the default camera sits at φ = 0, i.e. on
 * +x, so the sky seen behind the hole is −x) to ICRS equatorial coordinates, such that galactic
 * (l, b) = (skyL, skyB) lies at −x and the galactic plane is tilted by skyRoll w.r.t. the equator.
 */
export function skyMatrix(s: Pick<Settings, "skyL" | "skyB" | "skyRoll">): Mat3 {
  const d = Math.PI / 180;
  const l = s.skyL * d;
  const b = s.skyB * d;
  const roll = s.skyRoll * d;
  // galactic frame: target, "up" (towards the north galactic pole), side
  const tg: Vec3 = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
  let ng: Vec3 = [0, 0, 1];
  if (Math.abs(dot(tg, ng)) > 0.999) ng = [1, 0, 0];
  ng = norm([ng[0] - tg[0] * dot(tg, ng), ng[1] - tg[1] * dot(tg, ng), ng[2] - tg[2] * dot(tg, ng)]);
  const wg = cross(tg, ng);
  // black-hole frame: target −x, up = spin axis rolled about the target
  const tb: Vec3 = [-1, 0, 0];
  const z: Vec3 = [0, 0, 1];
  const side = cross(tb, z);
  const nb: Vec3 = [
    Math.cos(roll) * z[0] + Math.sin(roll) * side[0],
    Math.cos(roll) * z[1] + Math.sin(roll) * side[1],
    Math.cos(roll) * z[2] + Math.sin(roll) * side[2],
  ];
  const wb = cross(tb, nb);
  // R (bh → gal) = [tg ng wg] · [tb nb wb]ᵀ ; then gal → equatorial = EQ_TO_GALᵀ
  const G: Mat3 = transpose([tg, ng, wg]);
  const B: Mat3 = [tb, nb, wb];
  const R: Mat3 = [0, 1, 2].map((i) => [0, 1, 2].map((j) => G[i]![0] * B[0][j]! + G[i]![1] * B[1][j]! + G[i]![2] * B[2][j]!)) as Mat3;
  const E = transpose(EQ_TO_GAL);
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => E[i]![0] * R[0]![j]! + E[i]![1] * R[1]![j]! + E[i]![2] * R[2]![j]!)) as Mat3;
}

/** Equatorial (RA, Dec) in degrees of a direction in the black hole's frame. */
export function skyRaDec(m: Mat3, d: Vec3): [number, number] {
  const e = mulMV(m, d);
  const ra = ((Math.atan2(e[1], e[0]) * 180) / Math.PI + 360) % 360;
  return [ra, (Math.asin(Math.max(-1, Math.min(1, e[2]))) * 180) / Math.PI];
}

export function galacticToEquatorial(lDeg: number, bDeg: number): Vec3 {
  const l = (lDeg * Math.PI) / 180;
  const b = (bDeg * Math.PI) / 180;
  return mulMV(transpose(EQ_TO_GAL), [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)]);
}

// ---------------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------------
async function gunzip(res: Response): Promise<ArrayBuffer> {
  if (!res.ok || !res.body) throw new Error(`sky asset: HTTP ${res.status}`);
  return new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

/** rgb9e5 texture with its mip chain, from a gzip'd "SKY1" file (scripts/build-sky.ts). */
export async function loadPackedTexture(device: GPUDevice, url: string): Promise<GPUTexture> {
  const buf = await gunzip(await fetch(url));
  const head = new Uint32Array(buf, 0, 4);
  if (head[0] !== 0x31594b53) throw new Error("sky asset: bad texture header");
  const [, w, h, levels] = head as unknown as [number, number, number, number];
  const tex = device.createTexture({
    size: [w, h],
    format: "rgb9e5ufloat",
    mipLevelCount: levels,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  let off = 16;
  for (let l = 0; l < levels; l++) {
    const lw = Math.max(1, w >> l);
    const lh = Math.max(1, h >> l);
    device.queue.writeTexture({ texture: tex, mipLevel: l }, buf, { offset: off, bytesPerRow: lw * 4 }, [lw, lh]);
    off += lw * lh * 4;
  }
  return tex;
}

/** Star catalogue as one u32 storage buffer: [magic, grid, count, 0, cellStart[6·grid²+1], stars…]. */
export async function loadStarCatalogue(device: GPUDevice, url: string): Promise<GPUBuffer> {
  const buf = await gunzip(await fetch(url));
  const head = new Uint32Array(buf, 0, 4);
  if (head[0] !== 0x31525453) throw new Error("sky asset: bad catalogue header");
  const gpu = device.createBuffer({ size: buf.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(gpu, 0, buf);
  return gpu;
}

/**
 * Decodes an 8-bit image (log-encoded HDR map or sRGB photo) into linear rgba16float with a full
 * mip chain, on the GPU.
 */
export class SkyTextureBuilder {
  private decode: GPUComputePipeline;
  private down: GPUComputePipeline;
  constructor(
    private device: GPUDevice,
    code: string,
  ) {
    const module = device.createShaderModule({ code, label: "sky" });
    this.decode = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "decode" } });
    this.down = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "down" } });
  }

  build(bitmap: ImageBitmap, encoding: "log16" | "srgb", maxSize: number): GPUTexture {
    const d = this.device;
    const w = Math.min(bitmap.width, maxSize);
    const h = Math.min(bitmap.height, maxSize);
    const src = d.createTexture({
      size: [w, h],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    d.queue.copyExternalImageToTexture({ source: bitmap }, { texture: src }, [w, h]);
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    const tex = d.createTexture({
      size: [w, h],
      format: "rgba16float",
      mipLevelCount: levels,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    const modeBuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(modeBuf, 0, new Uint32Array([encoding === "log16" ? 0 : 1, 0, 0, 0]));
    const enc = d.createCommandEncoder();
    const run = (pipeline: GPUComputePipeline, srcView: GPUTextureView, level: number, withMode: boolean) => {
      const lw = Math.max(1, w >> level);
      const lh = Math.max(1, h >> level);
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: srcView },
        { binding: 1, resource: tex.createView({ baseMipLevel: level, mipLevelCount: 1 }) },
      ];
      if (withMode) entries.push({ binding: 2, resource: { buffer: modeBuf } });
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, d.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
      pass.dispatchWorkgroups(Math.ceil(lw / 8), Math.ceil(lh / 8));
      pass.end();
    };
    run(this.decode, src.createView(), 0, true);
    for (let l = 1; l < levels; l++) run(this.down, tex.createView({ baseMipLevel: l - 1, mipLevelCount: 1 }), l, false);
    d.queue.submit([enc.finish()]);
    d.queue.onSubmittedWorkDone().then(() => {
      src.destroy();
      modeBuf.destroy();
    });
    return tex;
  }
}
