// J9 (review of 24 Nov 2026): the near trees' geometry fetched, inflated and checked off the page's thread — ~4 MB raw, its
// index check over every model —; the whole decompressed buffer handed back, not copied, with its records (the GPU-ready
// blobs are views of it: tree-assets.ts format 2). Built on its own (server.ts, scripts/build-pages.ts) as tree-asset-worker.js.
import { inflated } from "../util/inflate";
import type { TreeAssetReply } from "./tree-asset-load";
import { decodeTreeAssets } from "./tree-assets";

const g = globalThis as unknown as {
  onmessage: ((e: MessageEvent<{ url: string }>) => void) | null;
  postMessage(m: TreeAssetReply, transfer: Transferable[]): void;
};
g.onmessage = async (e) => {
  const t0 = performance.now();
  try {
    const res = await fetch(e.data.url);
    if (!res.ok) throw Error(`tree geometry: ${res.status}`);
    const buffer = await inflated(res);
    const p = decodeTreeAssets(buffer);
    g.postMessage(
      {
        buffer,
        lo: p.lo,
        ext: p.ext,
        models: p.models,
        vertexOffset: p.vertices.byteOffset,
        vertexBytes: p.vertices.byteLength,
        indexOffset: p.indices.byteOffset,
        indexCount: p.indices.length,
        ms: performance.now() - t0,
      },
      [buffer],
    );
  } catch (err) {
    g.postMessage({ error: String(err), ms: performance.now() - t0 }, []);
  }
};
