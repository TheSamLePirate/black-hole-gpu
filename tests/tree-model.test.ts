import { expect, test } from "bun:test";
import { IMPOSTOR_VIEWS, impostorCellOf, impostorViewDir } from "../src/vegetation/tree-impostors";
import { TREE_ASPECTS, TREE_MODEL_KINDS, treeEnvelope, treeModel } from "../src/vegetation/tree-model";

// V2a/V2b — the modelled trees (vegetation/tree-model.ts) and the impostors' views (vegetation/tree-impostors.ts): deterministic,
// finite, their leaves in the kind's envelope (the crown the tracer carves near — the impostors far must stand where it stands),
// their bound the frame's; the views' directions and the reader's inverse the same cells.

test("each kind's tree: deterministic, finite, its leaves within its envelope, its top at the height", () => {
  for (const kind of TREE_MODEL_KINDS)
    for (const aspect of TREE_ASPECTS[kind]!) {
      const a = treeModel(kind, aspect, 3);
      const b = treeModel(kind, aspect, 3);
      expect(a.pos).toEqual(b.pos);
      expect(a.leaves).toBeGreaterThan(50);
      for (const v of a.pos) expect(Number.isFinite(v)).toBe(true);
      const env = treeEnvelope(kind, aspect);
      let out = 0,
        zmax = 0;
      for (let v = 0; v < a.pos.length / 3; v++) {
        const p: [number, number, number] = [a.pos[3 * v]!, a.pos[3 * v + 1]!, a.pos[3 * v + 2]!];
        zmax = Math.max(zmax, p[2]);
        // (a leaf's corners: within the envelope grown by a card's size)
        if (a.attr[4 * v + 2]! > 0.5 && env.inside(p) > 1.6) out++;
        expect(Math.hypot(p[0], p[1])).toBeLessThanOrEqual(a.radius + 1e-6 + 0.2);
      }
      // (a palm's fronds droop below the flat disc the tracer draws near: a share of them out)
      expect(out / (a.pos.length / 3)).toBeLessThan(kind === 4 ? 0.3 : 0.02);
      expect(zmax).toBeGreaterThan(0.85);
      expect(zmax).toBeLessThan(1.12);
    }
});

test("the impostors' views: a cell's direction falls back in its cell; overhead in the middle, the horizon on the rim", () => {
  for (let row = 0; row < IMPOSTOR_VIEWS; row++)
    for (let col = 0; col < IMPOSTOR_VIEWS; col++) {
      const d = impostorViewDir(col, row);
      expect(Math.hypot(...d)).toBeCloseTo(1, 6);
      expect(d[2]).toBeGreaterThanOrEqual(0);
      const [u, w] = impostorCellOf(d);
      expect(Math.floor(u)).toBe(col);
      expect(Math.floor(w)).toBe(row);
    }
  const mid = impostorCellOf([0, 0, 1]);
  expect(mid[0]).toBeCloseTo(IMPOSTOR_VIEWS / 2, 6);
  expect(mid[1]).toBeCloseTo(IMPOSTOR_VIEWS / 2, 6);
  // (a horizontal view on the octahedron's rim: |u − 4| + … at the square's edge midpoints or corners)
  const [hu, hw] = impostorCellOf([1, 0, 0]);
  expect(Math.max(Math.abs(hu - 4), Math.abs(hw - 4))).toBeCloseTo(IMPOSTOR_VIEWS / 2, 6);
});
