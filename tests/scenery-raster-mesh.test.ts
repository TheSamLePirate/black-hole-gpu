// The raster's tree proxies (system/scenery-raster.ts) hold the shapes they stand for: a point of the unit sphere, the
// unit cone or the unit cylinder is never outside its proxy — a proxy too narrow would lose a tree's edge.
import { expect, test } from "bun:test";
import { sceneryRasterMeshes } from "../src/system/scenery-raster";

type V = [number, number, number];
/** the proxy's faces (part p) as outward planes; true when every point is inside all of them */
function holds(mesh: Float32Array, part: number, points: V[]) {
  const tris: [V, V, V][] = [];
  const at = (i: number): V => [mesh[i]!, mesh[i + 1]!, mesh[i + 2]!];
  for (let i = 0; i < mesh.length; i += 12) {
    if (mesh[i + 3] !== part) continue;
    tris.push([at(i), at(i + 4), at(i + 8)]);
  }
  // (the proxy's centre: its vertices' mean, inside a convex shape — the planes turned outwards from it)
  const all = tris.flat();
  const c = [0, 1, 2].map((k) => all.reduce((s, p) => s + p[k]!, 0) / all.length) as V;
  let worst = Infinity;
  for (const [a, b, d] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const ln = Math.hypot(...n);
    if (ln < 1e-9) continue;
    n = n.map((x) => x / ln);
    const side = (p: V) => n[0]! * (p[0] - a[0]) + n[1]! * (p[1] - a[1]) + n[2]! * (p[2] - a[2]);
    if (side(c) > 0) n = n.map((x) => -x);
    for (const p of points) worst = Math.min(worst, -(n[0]! * (p[0] - a[0]) + n[1]! * (p[1] - a[1]) + n[2]! * (p[2] - a[2])));
  }
  return worst;
}
const sphere: V[] = [];
for (let i = 0; i < 400; i++) {
  const z = 1 - (2 * (i + 0.5)) / 400,
    r = Math.sqrt(1 - z * z),
    f = i * 2.399963;
  sphere.push([r * Math.cos(f), r * Math.sin(f), z]);
}
const cone: V[] = [];
for (let i = 0; i <= 20; i++)
  for (let k = 0; k < 64; k++) {
    const z = -i / 20,
      a = (k / 64) * 2 * Math.PI;
    cone.push([-z * Math.cos(a), -z * Math.sin(a), z]);
  }
const cylinder: V[] = [];
for (let i = 0; i <= 10; i++)
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * 2 * Math.PI;
    cylinder.push([Math.cos(a), Math.sin(a), i / 10]);
  }

test("the round crowns' proxies hold the unit sphere", () => {
  const [nearRound, , farRound] = sceneryRasterMeshes();
  expect(holds(nearRound!, 0, sphere)).toBeGreaterThanOrEqual(0);
  expect(holds(farRound!, 0, sphere)).toBeGreaterThanOrEqual(0);
});
test("the cones' proxies hold the unit cone and its base", () => {
  const [, nearCone, , farCone] = sceneryRasterMeshes();
  expect(holds(nearCone!, 1, cone)).toBeGreaterThanOrEqual(0);
  expect(holds(farCone!, 1, cone)).toBeGreaterThanOrEqual(0);
});
test("the trunks' proxies hold the unit cylinder", () => {
  const [nearRound, nearCone] = sceneryRasterMeshes();
  expect(holds(nearRound!, 2, cylinder)).toBeGreaterThanOrEqual(0);
  expect(holds(nearCone!, 2, cylinder)).toBeGreaterThanOrEqual(0);
});
