// The Earth's tiles decoded off the page's thread (T8a — docs/PLAN-REFRACTION-HORIZONS.md T8: "the decoding in a worker"): a
// request a tile — Terrarium's heights, a relief tile's imagery, an orthophoto's colours (tile-decode.ts) —, its arrays handed
// back, not copied. Built on its own (server.ts, scripts/build-pages.ts, package.json) as tile-decode-worker.js.
import { type DecodeReply, type DecodeRequest, decodeTile } from "./tile-decode";

const g = globalThis as unknown as {
  onmessage: ((e: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(m: DecodeReply, transfer: Transferable[]): void;
};
g.onmessage = async (e) => {
  const q = e.data;
  const t0 = performance.now();
  try {
    const r = await decodeTile(q);
    const transfer: Transferable[] = [];
    if (r.heights) transfer.push(r.heights.buffer);
    if (r.words) transfer.push(r.words.buffer);
    g.postMessage({ id: q.id, ms: performance.now() - t0, ...r }, transfer);
  } catch (err) {
    g.postMessage({ id: q.id, ms: performance.now() - t0, error: String(err) }, []);
  }
};
