import { expect, test } from "bun:test";
import { thinGlass } from "../src/f35/glass-shell";

// A shell 5 mm thick about a point (0, 0, 0): its outer wall at z = 1, its inner at z = 0.995, each a square of two
// triangles drawn twice (one per winding) — the F-35 canopy's make
function shell() {
  const verts: number[] = [];
  const quad = (z: number) => {
    const base = verts.length / 3;
    for (const [x, y] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ])
      verts.push(x!, y!, z);
    return [base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2];
  };
  const tris = [...quad(1), ...quad(0.995)];
  return { verts: new Float32Array(verts), tris: new Uint32Array(tris) };
}

test("the canopy's shell thinned to one surface: the copies once, the inner wall dropped", () => {
  const { verts, tris } = shell();
  const out = thinGlass(tris, verts, 3, [0, 0, 0]);
  expect(out.length / 3).toBe(2);
  for (const i of out) expect(verts[3 * i + 2]).toBeCloseTo(1, 6);
});

test("a single surface is left whole", () => {
  const { verts } = shell();
  const one = new Uint32Array([0, 1, 2, 0, 2, 3]);
  expect(thinGlass(one, verts, 3, [0, 0, 0]).length).toBe(6);
});
