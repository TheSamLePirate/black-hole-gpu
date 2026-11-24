// J9 (review of 24 Nov 2026): the near trees' geometry asked once per page — from the entry's veil on (renderer
// departureReady, prewarmEarthFlight) or the scenery raster's creation, whichever comes first —, fetched and checked in a
// worker (tree-asset-worker.ts; on the page's thread where there is none), kept until the GPU buffers are made. A failure is
// not kept: the next ask tries again (NearTreeGeometry spaces its asks: 1, 2, 4 … 60 s).
import { noteAsset } from "../pwa/seen";
import { inflated } from "../util/inflate";
import url from "./tree-asset-url";
import { decodeTreeAssets, type PackedTreeAssets, type PackedTreeModel } from "./tree-assets";

if (typeof location !== "undefined") {
  try {
    noteAsset(new URL(url, location.href).href);
  } catch {
    /* non-standard / SSR environment */
  }
}

export type TreeAssetReply =
  | {
      buffer: ArrayBuffer;
      lo: [number, number, number];
      ext: [number, number, number];
      models: PackedTreeModel[];
      vertexOffset: number;
      vertexBytes: number;
      indexOffset: number;
      indexCount: number;
      ms: number;
    }
  | { error: string; ms: number };

export interface LoadedTreeAssets extends PackedTreeAssets {
  /** where it was decoded and how long it took [ms]: the worker's fetch + inflate + check, or the page's */
  decodedIn: "worker" | "page";
  decodeMs: number;
}

let pending: Promise<LoadedTreeAssets> | null = null;

async function onPage(href: string): Promise<LoadedTreeAssets> {
  const t0 = performance.now();
  const res = await fetch(href);
  if (!res.ok) throw Error(`tree geometry: ${res.status}`);
  const p = decodeTreeAssets(await inflated(res));
  return { ...p, decodedIn: "page", decodeMs: performance.now() - t0 };
}

function inWorker(href: string): Promise<LoadedTreeAssets> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL("tree-asset-worker.js", location.href), { type: "module" });
    } catch (e) {
      reject(e);
      return;
    }
    w.onerror = (e) => {
      w.terminate();
      reject(Error(`tree geometry worker: ${e.message}`));
    };
    w.onmessage = (e: MessageEvent<TreeAssetReply>) => {
      w.terminate();
      const r = e.data;
      if ("error" in r) {
        reject(Error(r.error));
        return;
      }
      resolve({
        lo: r.lo,
        ext: r.ext,
        models: r.models,
        vertices: new Uint8Array(r.buffer, r.vertexOffset, r.vertexBytes),
        indices: new Uint16Array(r.buffer, r.indexOffset, r.indexCount),
        decodedIn: "worker",
        decodeMs: r.ms,
      });
    };
    w.postMessage({ url: href });
  });
}

/** the near trees' geometry, asked once (a failed ask forgotten: the next one fetches again) */
export function loadTreeAssets(): Promise<LoadedTreeAssets> {
  pending ??= (async () => {
    const href = typeof location !== "undefined" ? new URL(url, location.href).href : url;
    // (the worker where there is one — a page —; its script missing — an old build's cache —: on the page)
    if (typeof Worker === "undefined" || typeof location === "undefined") return onPage(href);
    try {
      return await inWorker(href);
    } catch (e) {
      // (the asset itself refused — a network error, a bad file —: the same on the page; the worker's own failure: retried there)
      if (/tree (geometry|asset)/i.test(String(e)) && !String(e).includes("worker")) throw e;
      return onPage(href);
    }
  })().catch((e) => {
    pending = null;
    throw e;
  });
  return pending;
}
/** the decoded copy let go once on the GPU (~4 MB): a later ask — a recreated device — fetches again (the HTTP/PWA cache) */
export function forgetTreeAssets(): void {
  pending = null;
}
/** asked ahead — the entry's veil, the title —: its failure left to the renderer's own ask */
export function preloadTreeAssets(): void {
  loadTreeAssets().catch(() => {});
}
