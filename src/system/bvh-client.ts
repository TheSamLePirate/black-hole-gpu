// The page's side of the hulls' tree builder (bvh-worker.ts — PLAN-J7 J7-7): a tree built in the worker, its nodes handed back; without a
// worker (the tests, an old browser) or if it fails, built here at once, as before.
import { type BVHParts, TriBVH } from "./collide";

let worker: Worker | null = null;
let failed = false;
let next = 1;
const waiting = new Map<number, (p: BVHParts | null) => void>();

function the(): Worker | null {
  if (failed || typeof Worker === "undefined" || typeof location === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("bvh-worker.js", location.href), { type: "module" });
    worker.onmessage = (e: MessageEvent<BVHParts & { id: number; error?: string }>) => {
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

/** The tree over these vertices and triangles: built off the page's thread when it can be (its arrays copied there, kept here). */
export async function buildBVH(pos: Float32Array, tri: Uint32Array): Promise<TriBVH> {
  const w = the();
  if (!w) return new TriBVH(pos, tri);
  const id = next++;
  const parts = await new Promise<BVHParts | null>((ok) => {
    waiting.set(id, ok);
    w.postMessage({ id, pos: pos.slice(), tri: tri.slice() });
  });
  return parts ? TriBVH.fromParts(pos, tri, parts) : new TriBVH(pos, tri);
}
