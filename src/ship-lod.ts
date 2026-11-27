// The traffic's meshes' levels of detail (perf lot of 25 Nov 2026 — tests/e2e/traffic-cost): an airliner 5 km off, a container ship 15 km
// off, a few pixels on the image, drew their 11 700 and 53 000 triangles in the craft's pass (its depth pre-pass, its shading, its motion,
// the shadow map): triangles far under a pixel, each shaded as a quad. Each mesh simplified (meshoptimizer) into levels of a growing
// error in metres — each material's triangles apart (a plain airliner's gear legs, the rigged A320's parts apart too: they move), their
// borders locked (no crack between them) —, made off the page's thread (system/cpu-worker.ts) once the mesh is in; the craft's pass draws the coarsest level
// whose error stays under half a pixel where it stands (ship.ts lodPx): the same image. Pure.

/** a level: its triangles' indices (into the mesh's own vertices) — its opaque ones first, `solid` indices, then its glass —, and its
 *  error [m]: the largest distance from the mesh it moved */
export interface LodLevel {
  idx: Uint32Array;
  solid: number;
  error: number;
}

/** meshoptimizer's simplify (MeshoptSimplifier.simplify) with its error absolute: positions xyz packed, a target count of 0 */
export type Simplify = (indices: Uint32Array, positions: Float32Array, targetError: number, prune: boolean) => [Uint32Array, number];

/** the levels' errors asked [m]: each four times the last; a level kept only if it draws under ¾ of the one before */
export const LOD_ERRORS = [0.04, 0.16, 0.64, 2.56, 10.24];

/** a triangle's group: its material (the vertex's 7th float), and its moving part where it has one — a plain airliner's gear leg
 *  (materials 55–58: its ambient occlusion's integer, ship.wgsl trafficLeg), the rigged A320's and the F-35's part (materials 30–39,
 *  100–139: the integer of its ambient occlusion, ship.wgsl jetMap) —: the parts that move apart, the materials' seams kept */
export function groupOf(verts: Float32Array, v: number, stride = 10): number {
  const m = Math.round(verts[stride * v + 6]!);
  const moving = (m >= 55 && m <= 58) || (m >= 30 && m <= 39) || (m >= 100 && m <= 139) || (m >= 150 && m <= 161);
  // (the part the integer of the occlusion, its fraction the occlusion itself — as ship.wgsl truncates it: no rounding up)
  return moving ? m * 4096 + Math.floor(verts[stride * v + 7]!) : m * 4096;
}

/** The levels of a mesh (its vertices `stride` floats each, xyz first; its opaque triangles the first `solid` indices, its glass after
 *  them), coarser and coarser; none worth it: []. */
export function buildLods(verts: Float32Array, idx: Uint32Array, simplify: Simplify, solid = idx.length, stride = 10): LodLevel[] {
  const nt = idx.length / 3;
  // (the glass's groups apart from the opaque ones: each level's opaque triangles first, as the mesh's — the glass's pass draws the rest)
  const groups = new Map<number, number[]>();
  for (let t = 0; t < nt; t++) {
    const k = 2 * groupOf(verts, idx[3 * t]!, stride) + (3 * t >= solid ? 1 : 0);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(t);
  }
  // (each group's vertices packed — the simplifier's work follows the vertices it is given)
  const packed = [...groups.entries()].map(([key, tris]) => {
    const local = new Map<number, number>();
    const back: number[] = [];
    const ix = new Uint32Array(tris.length * 3);
    tris.forEach((t, i) => {
      for (let c = 0; c < 3; c++) {
        const v = idx[3 * t + c]!;
        let l = local.get(v);
        if (l === undefined) local.set(v, (l = back.push(v) - 1));
        ix[3 * i + c] = l;
      }
    });
    const pos = new Float32Array(back.length * 3);
    back.forEach((v, l) => pos.set(verts.subarray(stride * v, stride * v + 3), 3 * l));
    return { ix, pos, back, glass: (key & 1) === 1 };
  });
  const out: LodLevel[] = [];
  let last = nt;
  for (const e of LOD_ERRORS) {
    const parts: { ix: Uint32Array; glass: boolean }[] = [];
    let error = 0;
    let n = 0;
    for (const g of packed) {
      // (a few triangles: kept whole — nothing to gain, a part's shape to lose)
      if (g.ix.length < 3 * 8) {
        parts.push({ ix: g.ix.map((l) => g.back[l]!), glass: g.glass });
        n += g.ix.length;
        continue;
      }
      // (the coarser levels prune what is smaller than their error: a part under half a pixel where they are drawn)
      const [r, err] = simplify(g.ix, g.pos, e, e >= 0.6);
      error = Math.max(error, err);
      parts.push({ ix: r.map((l) => g.back[l]!), glass: g.glass });
      n += r.length;
    }
    if (n / 3 > 0.75 * last) continue;
    const all = new Uint32Array(n);
    let o = 0,
      opaque = 0;
    for (const glass of [false, true])
      for (const p of parts)
        if (p.glass === glass) {
          all.set(p.ix, o);
          o += p.ix.length;
          if (!glass) opaque = o;
        }
    out.push({ idx: all, solid: opaque, error: Math.max(error, 1e-6) });
    last = n / 3;
  }
  return out;
}

/** The level to draw: the coarsest whose error, `pxPerM` pixels a metre where the mesh stands, stays within `maxPx`; −1 the mesh whole. */
export function pickLod(errors: readonly number[], pxPerM: number, maxPx: number): number {
  let k = -1;
  for (let i = 0; i < errors.length; i++) if (errors[i]! * pxPerM <= maxPx) k = i;
  return k;
}
