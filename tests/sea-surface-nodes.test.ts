import { expect, test } from "bun:test";
import { SEA_LEAF, SEA_MAX_NODES, seaNodes, type SeaView } from "../src/sea/surface-nodes";

// The sea's surface mesh (PLAN-MER-WEBGPU S2): its quadtree's nodes about the camera — none overlapping, the ground under the
// camera covered by the finest level at a low height, a bounded count, coarser from higher, culled behind the view, and fixed on
// the sea (a node's lattice does not move with the camera).

const view = (o: Partial<SeaView> = {}): SeaView => ({
  x: 1234.5,
  y: -987.25,
  h: 2,
  fwd: [1, 0, -0.1],
  cosHalf: Math.cos((55 * Math.PI) / 180),
  maxDist: 30_000,
  radius: 6_371_000,
  amp: 4,
  ...o,
});
const nodesOf = (v: SeaView) => {
  const r = seaNodes(v);
  const out: { x: number; y: number; s: number; l: number }[] = [];
  for (let i = 0; i < r.count; i++) out.push({ x: r.data[4 * i]!, y: r.data[4 * i + 1]!, s: r.data[4 * i + 2]!, l: r.data[4 * i + 3]! });
  return out;
};

test("no two nodes overlap; a bounded count; the camera's foot under the finest level when low", () => {
  for (const h of [2, 30, 500, 3000]) {
    const n = nodesOf(view({ h }));
    console.log(`  h ${h} m: ${n.length} nodes, finest ${Math.min(...n.map((a) => a.s))} m, coarsest ${Math.max(...n.map((a) => a.s))} m`);
    expect(n.length).toBeGreaterThan(10);
    expect(n.length).toBeLessThan(SEA_MAX_NODES);
    for (let i = 0; i < n.length; i++)
      for (let j = i + 1; j < n.length; j++) {
        const a = n[i]!,
          b = n[j]!;
        const ox = Math.min(a.x + a.s, b.x + b.s) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.s, b.y + b.s) - Math.max(a.y, b.y);
        expect(ox > 1e-6 && oy > 1e-6).toBe(false);
      }
  }
  // (2 m up: the node under the camera's foot is the finest)
  const low = nodesOf(view({ h: 2, fwd: [0, 0, -1], cosHalf: Math.cos(1.2) }));
  const under = low.find((a) => a.x <= 0 && a.x + a.s >= 0 && a.y <= 0 && a.y + a.s >= 0);
  expect(under?.s).toBe(SEA_LEAF);
});

test("from higher, coarser; behind the view, nothing; the lattice fixed on the sea", () => {
  const lo = nodesOf(view({ h: 2 }));
  const hi = nodesOf(view({ h: 2000 }));
  expect(Math.min(...hi.map((a) => a.s))).toBeGreaterThan(Math.min(...lo.map((a) => a.s)));
  // (looking along +x: no node wholly behind, beyond the near ones' reach)
  for (const a of lo) expect(a.x + a.s).toBeGreaterThan(-200);
  // (the camera moved 0.3 m: the nodes' origins on the sea unchanged — relative to it they moved by exactly −0.3)
  const v0 = view({ h: 30 });
  const a0 = nodesOf(v0);
  const a1 = nodesOf({ ...v0, x: v0.x + 0.3 });
  const key = (a: { x: number; y: number; s: number }, dx: number) => `${(a.x + dx).toFixed(3)},${a.y.toFixed(3)},${a.s}`;
  const set0 = new Set(a0.map((a) => key(a, 0)));
  const same = a1.filter((a) => set0.has(key(a, 0.3))).length;
  expect(same / a1.length).toBeGreaterThan(0.9);
});
