// GPU-compressed colour maps (scripts/build-ktx2.ts): KTX2 files transcoded by a worker to what this
// GPU samples natively — BC7 or ASTC 4×4, a quarter of rgba8's memory — and written level by level.
// Without a worker or a compressed format: RGBA8, as before (the caller's JPEG path otherwise).

import type { KtxReply, KtxRequest, KtxTarget } from "./ktx-worker";

let worker: Worker | null = null;
let failed = false;
let next = 1;
const waiting = new Map<number, (r: KtxReply) => void>();

function getWorker(): Worker | null {
  if (worker || failed || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("ktx-worker.js", location.href), { type: "module" });
    worker.onmessage = (e: MessageEvent<KtxReply>) => {
      const f = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      f?.(e.data);
    };
    worker.onerror = () => {
      failed = true;
      worker = null;
      for (const [id, f] of waiting) f({ id, error: "KTX2 worker unavailable" });
      waiting.clear();
    };
  } catch {
    failed = true;
  }
  return worker;
}

/** What this device can sample of the compressed formats (the features the renderer asked for). */
export function ktxTarget(device: Pick<GPUDevice, "features">): KtxTarget {
  if (device.features.has("texture-compression-bc")) return "bc7";
  if (device.features.has("texture-compression-astc")) return "astc";
  return "rgba";
}

/** The texture format for a target (colour maps: sRGB). */
export function ktxFormat(t: KtxTarget): GPUTextureFormat {
  return t === "bc7" ? "bc7-rgba-unorm-srgb" : t === "astc" ? "astc-4x4-unorm-srgb" : "rgba8unorm";
}

/** A KTX2 file's levels, transcoded for the target (rejects without a worker or on error). */
export function ktxLevels(url: string, target: KtxTarget): Promise<{ width: number; height: number; levels: Uint8Array[] }> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("no KTX2 worker"));
  const id = next++;
  return new Promise((resolve, reject) => {
    waiting.set(id, (r) => (r.error ? reject(new Error(r.error)) : resolve({ width: r.width!, height: r.height!, levels: r.levels! })));
    w.postMessage({
      id,
      url: new URL(url, location.href).href,
      target,
      wasm: new URL("basis_transcoder.wasm", location.href).href,
    } satisfies KtxRequest);
  });
}

/** Writes transcoded levels into a texture's layer (block-compressed rows: 16 bytes per 4 × 4 block). */
export function writeLevels(
  device: GPUDevice,
  tex: GPUTexture,
  levels: Uint8Array[],
  width: number,
  height: number,
  target: KtxTarget,
  layer = 0,
) {
  const n = Math.min(levels.length, tex.mipLevelCount);
  for (let l = 0; l < n; l++) {
    const w = Math.max(1, width >> l),
      h = Math.max(1, height >> l);
    const block = target !== "rgba";
    const bytesPerRow = block ? Math.ceil(w / 4) * 16 : w * 4;
    const rows = block ? Math.ceil(h / 4) : h;
    // (a level smaller than a block: the copy covers the whole block)
    const size = block ? [Math.ceil(w / 4) * 4, Math.ceil(h / 4) * 4] : [w, h];
    device.queue.writeTexture(
      { texture: tex, mipLevel: l, origin: [0, 0, layer] },
      levels[l]! as Uint8Array<ArrayBuffer>,
      { bytesPerRow, rowsPerImage: rows },
      [size[0]!, size[1]!, 1],
    );
  }
}
