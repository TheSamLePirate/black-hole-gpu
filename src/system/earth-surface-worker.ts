// WorldCover is categorical: lossless bytes, inflated off the frame loop and transferred once.
export interface CoverRequest {
  id: number;
  url: string;
  size: number;
}
export interface CoverReply {
  id: number;
  bytes?: Uint8Array;
  error?: string;
}
const g = globalThis as unknown as { onmessage: unknown; postMessage(m: CoverReply, t?: Transferable[]): void };
g.onmessage = async (e: MessageEvent<CoverRequest>) => {
  const q = e.data;
  try {
    const response = await fetch(q.url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok || !response.body) throw new Error(`WorldCover HTTP ${response.status}`);
    const bytes = new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    if (bytes.length !== q.size * q.size) throw new Error("WorldCover page size mismatch");
    g.postMessage({ id: q.id, bytes }, [bytes.buffer]);
  } catch (err) {
    g.postMessage({ id: q.id, error: String(err) });
  }
};
