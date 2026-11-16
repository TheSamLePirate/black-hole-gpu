// The page's side of the CPU worker (cpu-worker.ts — PLAN-J7 J7-7): a job run there, its arrays handed back; without a worker (the tests,
// an old browser) or if it fails, run here at once, as before.
import { type BVHParts, TriBVH } from "./collide";
import { type SeaCascades, type SeaPhysics, type SeaSystem, seaCascades } from "../sea/spectrum";

let worker: Worker | null = null;
let failed = false;
let next = 1;
const waiting = new Map<number, (r: unknown) => void>();

function the(): Worker | null {
  if (failed || typeof Worker === "undefined" || typeof location === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("cpu-worker.js", location.href), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; error?: string }>) => {
      const answer = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      answer?.(e.data.error ? null : e.data);
    };
    worker.onerror = () => {
      failed = true;
      worker?.terminate();
      worker = null;
      for (const answer of waiting.values()) answer(null);
      waiting.clear();
    };
    return worker;
  } catch {
    failed = true;
    return null;
  }
}

function ask<T>(w: Worker, msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T | null> {
  const id = next++;
  return new Promise<T | null>((ok) => {
    waiting.set(id, ok as (r: unknown) => void);
    w.postMessage({ id, ...msg }, transfer);
  });
}

/** The tree over these vertices and triangles: built off the page's thread when it can be (its arrays copied there, kept here). */
export async function buildBVH(pos: Float32Array, tri: Uint32Array): Promise<TriBVH> {
  const w = the();
  if (!w) return new TriBVH(pos, tri);
  const p = await ask<BVHParts>(w, { job: "bvh", pos: pos.slice(), tri: tri.slice() });
  return p ? TriBVH.fromParts(pos, tri, p) : new TriBVH(pos, tri);
}

/** An image's mip chain `size` → 1 (each level resized from the full image, « high »), made off the page's thread when it can be. */
export async function imageMipsOff(blob: Blob, size: number): Promise<ImageBitmap[]> {
  const here = async () => {
    const img = await createImageBitmap(blob);
    const out: ImageBitmap[] = [];
    for (let w = size; w >= 1; w >>= 1) out.push(await createImageBitmap(img, { resizeWidth: w, resizeHeight: w, resizeQuality: "high" }));
    return out;
  };
  const w = the();
  if (!w) return here();
  const r = await ask<{ levels: ImageBitmap[] }>(w, { job: "mips", blob, size });
  return r?.levels ?? here();
}

/** The sea's cascades (sea/spectrum.ts seaCascades), computed off the page's thread when it can be — the same for the same arguments. */
export async function seaCascadesOff(systems: readonly SeaSystem[], seed: number, phys: SeaPhysics): Promise<SeaCascades> {
  const w = the();
  if (!w) return seaCascades(systems, seed, phys);
  const s = await ask<SeaCascades>(w, { job: "sea", systems: [...systems], seed, phys });
  return s ?? seaCascades(systems, seed, phys);
}
