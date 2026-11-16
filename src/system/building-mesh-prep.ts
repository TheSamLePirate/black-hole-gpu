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
import { osmColour, type Region, RoofMaterial, type RoofPart, roofColour, stacksOf, WallMaterial, wallColour } from "./roofs";
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
