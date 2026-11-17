// PLAN-J8 J8-8 lot (1) — a building's leaves as the near material reads them, shared by the two workers that make them: the scenery
// worker (scenery-worker.ts — the near scene, today) and the cells' (cell-worker.ts — the near meshes per z 15 cell, kerr-mesh-v1:
// mesh-cells.ts). Agreed with the render session (17 Nov 2026): one code for the records — the same building the same look, wherever it
// was prepared (J8-A: the least difference between the qualities).
//
// A leaf a convex part (roofs.ts planBuilding), then one a chimney (B9): packScenery's geometry record — its bottom, its top, its edges'
// count, 1 (a building), its footprint's oriented box, the walls' colour, the packed word (materials, storeys, planes, shape, meshed,
// parapet, work), its edges (the x's last bit: a blind side — a party wall, a cut inside the building —, no window), the roof's colour,
// the eave, its roof's planes (the floor added) — the leaves' layout scenery-data.ts packScenery and trace.wgsl buildingFaceAt read.
// Pure: no DOM, no WebGPU.
import { buildingMesh } from "./roof-mesh";
import { osmColour, type Pt, type Region, RoofMaterial, type RoofPart, roofColour, stacksOf, WallMaterial, wallColour } from "./roofs";
import { buildingPacked, isWorkUsage, markedCoord, orientedBox, PARAPET_M, type Primitive } from "./scenery-data";

/** what a building's leaves read of its attributes (the scenery worker's Attr) */
export interface LeafAttr {
  wallMat: WallMaterial;
  usage?: string;
  light?: boolean;
  /** its walls' and roof's colours as the data name them (OSM's, Overture's) */
  colour?: unknown;
  roofColour?: unknown;
}

/** a terrace — a building flat whole, not a shed nor a hut —: its parapet round its roof */
export const parapetOf = (a: LeafAttr, plans: readonly RoofPart[]) =>
  plans.length === 1 && plans[0]!.shape === "flat" && !a.light && a.usage !== "Annexe" && plans[0]!.wall > 4;

/** a part's meshes (roof-mesh.ts): its walls from `bottom` up, its roof's planes over `floor`, the parapet a terrace's */
export const partMeshes = (a: LeafAttr, plans: readonly RoofPart[], bottom: number, floor: number) =>
  plans.map((p) => buildingMesh(p.rings, bottom, floor, p.planes, parapetOf(a, plans) ? PARAPET_M : 0));

/** a chimney's leaf's bytes (packScenery's: 112 + its four edges 64 + its planes' 32) */
export const STACK_BYTES = 112 + 64 + 32;

/**
 * A building's leaves: one a part (`mesh[k]` its triangles, or none), then its chimneys' when `stacks` says so (asked before each part's —
 * the scene's budget). `floor`: its roof's planes' and eave's base [m] (the ground plus its low); `bottom`: its walls' foot (below the ground:
 * the skirt). `seed`: the building's own (scenery-data.ts seed), its colours' and chimneys' variations.
 */
export function buildingLeaves(o: {
  plans: readonly RoofPart[];
  a: LeafAttr;
  region: Region;
  seed: number;
  floor: number;
  bottom: number;
  mesh: readonly (Primitive["mesh"] | undefined)[];
  stacks: () => boolean;
  /** a chimney's leaf made (the scene counts its bytes: the next part's `stacks` sees them) */
  onStack?: () => void;
}): { prims: Primitive[]; partLeaf: number[]; stacks: number; vertices: number; meshed: number } {
  const { plans, a, region, seed, floor, bottom } = o;
  const wall = osmColour(a.colour) ?? wallColour(a.wallMat, region, seed);
  const roof = osmColour(a.roofColour) ?? roofColour(plans[0]!.roofMat, region, (seed * 7.31) % 1);
  const stackColour = wallColour(WallMaterial.Brick, region, 0.7);
  const prims: Primitive[] = [];
  /** each part's leaf in `prims` (its chimneys' after it) */
  const partLeaf: number[] = [];
  let stacks = 0,
    vertices = 0,
    meshed = 0;
  for (const [k, plan] of plans.entries()) {
    const edges: number[] = [];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [r, ring] of plan.rings.entries())
      for (let j = 0; j < ring.length; j++) {
        const p = ring[j]!,
          n = ring[(j + 1) % ring.length]!;
        // (its x's last bit: a blind side — a party wall, a cut inside the building —, no window drawn on it: Q3)
        edges.push(markedCoord(p[0], r === 0 && !!plan.blind?.[j]), p[1], n[0], n[1]);
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
      }
    const mesh = o.mesh[k];
    const lip = parapetOf(a, plans) ? PARAPET_M : 0;
    partLeaf.push(prims.length);
    prims.push({
      min: [minX, minY, bottom],
      max: [maxX, maxY, floor + plan.top + lip],
      data: [
        bottom,
        floor + plan.top + lip,
        edges.length / 4,
        1,
        // (its footprint's oriented box — the raster's solid box for it without triangles: orientedBox)
        ...orientedBox(edges),
        ...wall,
        buildingPacked(plan.roofMat, a.wallMat, plan.storeys, plan.planes.length, plan.shape, !!mesh, lip > 0, isWorkUsage(a.usage)),
        ...edges,
        ...roof,
        floor + plan.wall,
        ...plan.planes.flatMap(([pa, pb, pc]) => [pa, pb, pc + floor, 0]),
      ],
      mesh,
    });
    vertices += edges.length / 4;
    if (mesh) meshed++;
    // (its chimneys — B9 —: a leaf a stack, its render's or brick's colour, no window)
    if (o.stacks())
      for (const st of stacksOf(plan, (seed * 13.7 + k * 0.31) % 1, plan.shape === "mansard")) {
        const se: number[] = [];
        for (let j = 0; j < 4; j++)
          se.push(markedCoord(st.ring[j]![0], false), st.ring[j]![1], st.ring[(j + 1) % 4]![0], st.ring[(j + 1) % 4]![1]);
        const xs = st.ring.map((p) => p[0]),
          ys = st.ring.map((p) => p[1]);
        const sb = floor + plan.top - 1.5;
        prims.push({
          min: [Math.min(...xs), Math.min(...ys), sb],
          max: [Math.max(...xs), Math.max(...ys), floor + st.top],
          data: [
            sb,
            floor + st.top,
            4,
            1,
            ...orientedBox(se),
            ...stackColour,
            buildingPacked(RoofMaterial.Concrete, WallMaterial.Brick, 1, 1, "stack", false),
            ...se,
            0.12,
            0.11,
            0.1,
            floor + st.top,
            0,
            0,
            floor + st.top,
            0,
          ],
        });
        stacks++;
        o.onStack?.();
      }
  }
  return { prims, partLeaf, stacks, vertices, meshed };
}

/**
 * (B6) A BD TOPO roof without its ridge — Paris's — measured by the IGN's canopy model, its surface over its ground (I4: ~3 m a texel
 * within CANOPY_NEAR, a texel the mean over it): its footprint's inner points, 1.5 m in from its walls, the 85th percentile of their
 * heights its top — the roof the eave's to it [m]; a measure of fewer than six points none (null), a roof out of reason none.
 * `canopyAt` (x, y) — a point of the rings' metres — → the canopy's height there [m] (NaN where the survey has none). Shared by the
 * scenery worker and the cells' (J8-8): the same building the same roof.
 */
export function lidarRoof(rings: Pt[][], eave: number, canopyAt: (x: number, y: number) => number): number | null {
  const outer = rings[0]!;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of outer) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const step = Math.max(1.5, Math.max(x1 - x0, y1 - y0) / 7);
  const inside = (x: number, y: number) => {
    let c = false,
      near = Infinity;
    for (const r of rings)
      for (let k = 0, j = r.length - 1; k < r.length; j = k++) {
        const a = r[k]!,
          b = r[j]!;
        if (a[1] > y !== b[1] > y && x < a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) c = !c;
        const dx = b[0] - a[0],
          dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        near = Math.min(near, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
      }
    return c && near > 1.5;
  };
  const hs: number[] = [];
  for (let y = y0 + step / 2; y < y1; y += step)
    for (let x = x0 + step / 2; x < x1; x += step) {
      if (!inside(x, y)) continue;
      const h = canopyAt(x, y);
      if (Number.isFinite(h) && h < 50) hs.push(h);
    }
  if (hs.length < 6) return null;
  hs.sort((p, q) => p - q);
  const top = hs[Math.floor(0.85 * (hs.length - 1))]!;
  const roof = top - eave;
  return roof > 0.8 && roof < 12 ? roof : roof <= 0.8 && roof > -2 ? 0 : null;
}
