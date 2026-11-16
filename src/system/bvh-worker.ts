// The collision trees of the crafts' hulls built off the page's thread (PLAN-J7 J7-7: the F-35's, ~100 ms and its collections on the main
// thread at a craft change — an image held). A request: the vertices and the triangles; the answer: the tree's nodes (collide.ts
// TriBVH.parts), handed back without a copy. bvh-client.ts is the page's side.
import { TriBVH } from "./collide";

export interface BVHRequest {
  id: number;
  pos: Float32Array;
  tri: Uint32Array;
}

const g = globalThis as unknown as { onmessage: unknown; postMessage(v: unknown, t?: Transferable[]): void };
g.onmessage = (e: MessageEvent<BVHRequest>) => {
  const { id, pos, tri } = e.data;
  try {
    const p = new TriBVH(pos, tri).parts();
    g.postMessage({ id, ...p }, [p.box.buffer, p.link.buffer, p.order.buffer]);
  } catch (err) {
    g.postMessage({ id, error: String(err) });
  }
};
