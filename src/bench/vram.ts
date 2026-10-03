// The GPU memory the page allocates, summed from its createTexture / createBuffer calls (less the
// destroyed): WebGPU tells no VRAM figure. Installed before the renderer exists — on the benchmark's
// page only (#bench), as it wraps every allocation. Same estimate as scripts/bench.ts.

const BYTES: Record<string, number> = {
  rgba8unorm: 4,
  "rgba8unorm-srgb": 4,
  bgra8unorm: 4,
  "bgra8unorm-srgb": 4,
  rgba16float: 8,
  rgba32float: 16,
  r32float: 4,
  rg32float: 8,
  r16float: 2,
  rg16float: 4,
  r8unorm: 1,
  rg8unorm: 2,
  depth32float: 4,
  depth24plus: 4,
  "depth24plus-stencil8": 4,
  r32uint: 4,
  rg32uint: 8,
  rgb10a2unorm: 4,
  rg11b10ufloat: 4,
  "bc7-rgba-unorm": 1,
  "bc7-rgba-unorm-srgb": 1,
  "bc5-rg-unorm": 1,
  "bc4-r-unorm": 0.5,
  "bc6h-rgb-ufloat": 1,
  "astc-4x4-unorm": 1,
  "astc-4x4-unorm-srgb": 1,
};

let total = 0;
let peak = 0;
let installed = false;

/** The page's GPU allocations now and at their peak [MiB] (null: the hook not installed). */
export function vram(): { mib: number; peakMiB: number } | null {
  return installed ? { mib: total / 2 ** 20, peakMiB: peak / 2 ** 20 } : null;
}

export function installVramHook() {
  if (installed || typeof GPUDevice === "undefined") return;
  installed = true;
  const live = new WeakMap<object, number>();
  const add = (o: object, n: number) => {
    live.set(o, n);
    total += n;
    peak = Math.max(peak, total);
  };
  const P = GPUDevice.prototype;
  const ct = P.createTexture,
    cb = P.createBuffer;
  P.createTexture = function (d: GPUTextureDescriptor) {
    const t = ct.call(this, d);
    const s = d.size as GPUExtent3DDict & number[];
    const w = s.width ?? s[0] ?? 1,
      h = s.height ?? s[1] ?? 1,
      l = s.depthOrArrayLayers ?? s[2] ?? 1;
    const mips = (d.mipLevelCount ?? 1) > 1 ? 4 / 3 : 1;
    add(t, w * h * l * (BYTES[d.format] ?? 4) * mips * Math.max(1, d.sampleCount ?? 1));
    return t;
  };
  P.createBuffer = function (d: GPUBufferDescriptor) {
    const b = cb.call(this, d);
    add(b, d.size);
    return b;
  };
  for (const C of [GPUTexture, GPUBuffer] as unknown as { prototype: { destroy(): void } }[]) {
    const ds = C.prototype.destroy;
    C.prototype.destroy = function () {
      const n = live.get(this);
      if (n !== undefined) {
        total -= n;
        live.delete(this);
      }
      return ds.call(this);
    };
  }
}
