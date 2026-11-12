// V2a — the trees modelled (docs/ANALYSE-MER-LITTORAL-VEGETATION-2026-11-10.md §5.1 V2, Sam's decision 3: generated
// procedurally): for each of the forest's kinds (system/forest.ts KIND_SHAPES) and two proportions — a young, wide tree and a
// tall, slender one: the cells hold crowns of ~2–3 m radius on trees of 2–34 m —, a tree of trunk, limbs, branches and leaf cards,
// grown to fill the kind's own envelope (its ellipsoid or cone: the shape the tracer draws near, so that the impostors far and the
// carved crowns near agree in size and place). The source of the hemi-octahedral impostors (V2b). Pure geometry, deterministic.
//
// Canonical frame: z up, the tree's height 1, its crown's radius `aspect` (r / H); the trunk's foot at the origin.
// Growth: a lite space colonisation (Runions et al. 2007) — leaf clumps scattered in the envelope, biased to its shell; each clump
// joined to the nearest node of the skeleton below it by a bent limb; radii by the pipe model (r³ summed at each fork, Leonardo /
// da Vinci's rule at exponent ~2.5). Conifers grow in whorls; pines raise a few limbs to a flat umbrella; palms arch their fronds;
// shrubs rise in several stems from the ground; columnar trees keep steep branches close to the axis.

import { ForestKind, KIND_SHAPES } from "../system/forest";

export interface TreeMesh {
  /** xyz per vertex (canonical frame) */
  pos: Float32Array<ArrayBuffer>;
  /** the shading normal per vertex: the bark's own; a leaf card's bent towards its clump's outside (the crown's volume) */
  nrm: Float32Array<ArrayBuffer>;
  /** per vertex: u, v (a leaf card's own square, for its mask), material (0 bark, 1 leaf), its shade (0.6–1: variation × the
   *  crown's depth — the leaves deep inside darker) */
  attr: Float32Array<ArrayBuffer>;
  index: Uint32Array<ArrayBuffer>;
  /** the bound the impostor frames: the radius about the axis and the top (the height, 1) */
  radius: number;
  leaves: number;
  segments: number;
}

/** the two proportions a kind is modelled at (r / H): wide (young, low) and slender (tall) — from the cells' radius (~2.7 m)
 *  over each kind's height range (forest.ts forestHeight) */
export const TREE_ASPECTS: Record<number, [number, number]> = {
  [ForestKind.broadleaf]: [0.22, 0.11],
  [ForestKind.conifer]: [0.19, 0.09],
  [ForestKind.pine]: [0.27, 0.13],
  [ForestKind.palm]: [0.33, 0.16],
  [ForestKind.shrub]: [1.1, 0.5],
  [ForestKind.columnar]: [0.22, 0.11],
};
/** the kinds modelled, in the impostors' layer order (two layers each: wide, slender) */
export const TREE_MODEL_KINDS: ForestKind[] = [
  ForestKind.broadleaf,
  ForestKind.conifer,
  ForestKind.pine,
  ForestKind.palm,
  ForestKind.shrub,
  ForestKind.columnar,
];

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** a small seeded generator (mulberry32) */
export function treeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** the kind's envelope in the canonical frame: inside(p) ≤ 1, and its centre (where the crown's outward normals point from) */
export function treeEnvelope(kind: ForestKind, aspect: number) {
  const k = KIND_SHAPES[kind]!;
  const R = k.width * aspect;
  // (its slenderness bounded as the tracer's crown — forest.ts shapeOf: the top in place, the crown shorter)
  if (k.cone) {
    const base = Math.max(k.crown, 1 - k.slender * R);
    return {
      R,
      lo: base,
      hi: 1,
      centre: [0, 0, base + 0.3 * (1 - base)] as V3,
      /** ≤ 1 inside */
      inside: (p: V3) => {
        if (p[2] < base || p[2] > 1) return 2;
        const rr = (R * (1 - p[2])) / (1 - base);
        return Math.hypot(p[0], p[1]) / Math.max(rr, 1e-4);
      },
    };
  }
  const d = Math.min(k.depth, k.slender * R),
    c = k.crown + k.depth - d;
  return {
    R,
    lo: Math.max(c - d, 0),
    hi: Math.min(c + d, 1),
    centre: [0, 0, c] as V3,
    inside: (p: V3) => Math.sqrt((p[0] * p[0] + p[1] * p[1]) / (R * R) + ((p[2] - c) * (p[2] - c)) / (d * d)),
  };
}

interface Seg {
  a: V3;
  b: V3;
  ra: number;
  rb: number;
}
interface Node {
  p: V3;
  parent: number;
  /** leaves carried (the pipe model's flow) */
  flow: number;
  depth: number;
}

/** A kind's tree at one proportion, its leaf clumps and its skeleton grown from `seed`. */
export function treeModel(kind: ForestKind, aspect: number, seed = 1): TreeMesh {
  const rnd = treeRng(seed * 7919 + kind * 104729 + Math.round(aspect * 1000));
  const k = KIND_SHAPES[kind]!;
  const env = treeEnvelope(kind, aspect);
  const R = env.R;
  const segs: Seg[] = [];
  const leaves: { p: V3; n: V3; s: number; shade: number; long?: V3 }[] = [];
  // (a point in the envelope, biased to its shell — the leaves live outside, the inside is shade)
  const inEnvelope = (shell: number): V3 => {
    for (let t = 0; t < 64; t++) {
      const p: V3 = [(2 * rnd() - 1) * R, (2 * rnd() - 1) * R, env.lo + rnd() * (env.hi - env.lo)];
      const f = env.inside(p);
      if (f <= 1 && f >= shell * rnd()) return p;
    }
    return [0, 0, (env.lo + env.hi) / 2];
  };
  // (the crown's outward normal at p — its envelope's gradient, numerically)
  const outward = (p: V3): V3 => {
    const e = 1e-3;
    return norm([
      env.inside(add(p, [e, 0, 0])) - env.inside(add(p, [-e, 0, 0])),
      env.inside(add(p, [0, e, 0])) - env.inside(add(p, [0, -e, 0])),
      env.inside(add(p, [0, 0, e])) - env.inside(add(p, [0, 0, -e])),
    ]);
  };
  const trunkTop = k.trunk > 0 ? k.trunk : 0;
  // (the trunk's radius at the foot, canonical: bark0 + barkH × H for a ~15 m tree, over H)
  const r0 = Math.max(0.012, (k.bark0 + k.barkH * 15) / 15) * (aspect > 0.5 ? 0.5 : 1);
  const nodes: Node[] = [];
  // (a slight lean — none for a spruce, a fir: their cone stands on its axis)
  const tilt = kind === ForestKind.conifer ? 0 : 0.04;
  const lean: V3 = [(rnd() - 0.5) * tilt, (rnd() - 0.5) * tilt, 1];
  const addNode = (p: V3, parent: number, depth: number) => {
    nodes.push({ p, parent, flow: 0, depth });
    return nodes.length - 1;
  };

  if (kind === ForestKind.conifer) {
    // (a straight bole to the top; whorls of branches drooping out to the cone's radius, shorter up)
    let prev = addNode([0, 0, 0], -1, 0);
    const tiers = 14 + Math.floor(rnd() * 4);
    for (let t = 0; t <= tiers; t++) {
      const z = env.lo * 0.6 + (1 - env.lo * 0.6) * (t / tiers);
      const node = addNode([lean[0] * z, lean[1] * z, z], prev, 0);
      prev = node;
      if (z < env.lo + 0.03 || z > 0.97) continue;
      const rr = (R * (1 - z)) / (1 - env.lo);
      const nb = 5 + Math.floor(rnd() * 3);
      const turn = rnd() * Math.PI * 2;
      for (let b = 0; b < nb; b++) {
        const az = turn + (b / nb) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
        // (its needles' cards reach ~0.4 of the radius past the branch: the branch shorter, the tuft within the cone)
        const L = rr * (0.62 + 0.18 * rnd());
        const dir: V3 = [Math.cos(az), Math.sin(az), 0];
        const mid = add(nodes[node]!.p, add(mul(dir, L * 0.55), [0, 0, 0.01]));
        const tip = add(nodes[node]!.p, add(mul(dir, L), [0, 0, -0.035 * (1 - z) - 0.01]));
        const m = addNode(mid, node, 1);
        const tipN = addNode(tip, m, 2);
        // (needles: cards along the branch's outer two thirds, drooping)
        const nl = 6 + Math.floor(rnd() * 3);
        for (let i = 0; i < nl; i++) {
          const f = 0.35 + 0.65 * (i / (nl - 1));
          const p = add(nodes[node]!.p, add(mul(dir, L * f), [0, 0, -0.03 * f * f * (1 - z) + (rnd() - 0.5) * 0.006]));
          // (their size the cone's radius there at most: no tuft past the tip)
          const sz = Math.min((0.05 * R) / 0.19, 0.22 * rr) * (1.1 - 0.4 * f) + 0.0006;
          leaves.push({ p, n: norm(add(outward(p), [0, 0, 0.6])), s: sz, shade: 0, long: dir });
        }
        nodes[tipN]!.flow += 1;
      }
    }
  } else if (kind === ForestKind.palm) {
    // (a slender curved stem; fronds arching out and down from its head)
    const head: V3 = [0.06 * R * (rnd() - 0.5), 0.06 * R * (rnd() - 0.5), k.crown];
    let prev = addNode([0, 0, 0], -1, 0);
    for (let i = 1; i <= 6; i++) {
      const f = i / 6;
      prev = addNode([head[0] * f * f, head[1] * f * f, head[2] * f], prev, 0);
    }
    const nf = 11 + Math.floor(rnd() * 4);
    for (let i = 0; i < nf; i++) {
      const az = (i / nf) * Math.PI * 2 + rnd() * 0.3;
      const up = 0.1 + 0.35 * rnd();
      const L = R * (0.85 + 0.25 * rnd());
      const dir: V3 = [Math.cos(az), Math.sin(az), 0];
      let pPrev = head;
      for (let s = 1; s <= 8; s++) {
        const f = s / 8;
        // (an arch: up, then down)
        const p = add(head, add(mul(dir, L * f), [0, 0, L * (up * f - 0.55 * f * f)]));
        leaves.push({ p: mul(add(p, pPrev), 0.5), n: norm(add(outward(p), [0, 0, 1])), s: 0.11 * R, shade: 0, long: norm(sub(p, pPrev)) });
        pPrev = p;
      }
    }
  } else {
    // (broadleaf, pine, shrub, columnar: clumps in the envelope, joined to the skeleton)
    const stems = kind === ForestKind.shrub ? 3 + Math.floor(rnd() * 3) : 1;
    const roots: number[] = [];
    for (let s = 0; s < stems; s++) {
      const az = rnd() * Math.PI * 2;
      const off: V3 = stems > 1 ? [Math.cos(az) * R * 0.15, Math.sin(az) * R * 0.15, 0] : [0, 0, 0];
      let prev = addNode(off, -1, 0);
      const top = stems > 1 ? env.lo + 0.2 * (env.hi - env.lo) : Math.max(trunkTop, env.lo + 0.15 * (env.hi - env.lo));
      const steps = 4;
      for (let i = 1; i <= steps; i++) {
        const z = (top * i) / steps;
        prev = addNode(add([lean[0] * z, lean[1] * z, z], mul(off, 1 + (stems > 1 ? (0.8 * i) / steps : 0))), prev, 0);
      }
      roots.push(prev);
    }
    // (the clumps: pine's on its flat top's shell, columnar's close to the axis)
    // (a crown dense as the carved one near: its clumps, each ~0.3 of the crown's radius, filling its shell)
    const nClumps = kind === ForestKind.shrub ? 90 : kind === ForestKind.pine ? 80 : kind === ForestKind.columnar ? 120 : 130;
    const shell = kind === ForestKind.pine ? 0.75 : kind === ForestKind.columnar ? 0.45 : 0.6;
    const clumps: V3[] = [];
    for (let i = 0; i < nClumps; i++) clumps.push(inEnvelope(shell));
    // (each clump joined to the nearest node that is lower and nearer the axis — a limb grows up and out; the join bent)
    clumps.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || a[2] - b[2]);
    for (const c of clumps) {
      let best = roots[0]!,
        bd = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        if (n.p[2] > c[2] + 0.02) continue;
        const d = len(sub(c, n.p)) * (1 + 0.6 * n.depth) - (n.depth === 0 ? 0.0 : 0.02);
        if (d < bd) [bd, best] = [d, i];
      }
      const from = nodes[best]!.p;
      const span = sub(c, from);
      const L = len(span);
      // (a limb in two or three pieces, bowed up — towards the light —, more for a columnar tree)
      const pieces = L > 0.12 ? 3 : 2;
      let prev = best;
      for (let i = 1; i <= pieces; i++) {
        const f = i / pieces;
        const bow = (kind === ForestKind.columnar ? 0.25 : 0.12) * L * Math.sin(Math.PI * f);
        const jitter: V3 = [(rnd() - 0.5) * 0.08 * L, (rnd() - 0.5) * 0.08 * L, bow];
        prev = addNode(add(add(from, mul(span, f)), i < pieces ? jitter : [0, 0, 0]), prev, nodes[best]!.depth + 1);
      }
      nodes[prev]!.flow += 1;
      // (the clump's leaves: cards scattered in a ball of the kind's clump size, facing out)
      const cr = Math.max((kind === ForestKind.columnar ? 0.42 : 0.3) * R, 0.018);
      const nl = kind === ForestKind.shrub ? 30 : 40;
      for (let i = 0; i < nl; i++) {
        const q: V3 = [2 * rnd() - 1, 2 * rnd() - 1, 2 * rnd() - 1];
        if (len(q) > 1) {
          i--;
          continue;
        }
        const p = add(c, mul(q, cr));
        if (env.inside(p) > 1.08) continue;
        const nOut = norm(add(mul(norm(q), 0.6), mul(outward(p), 0.8)));
        leaves.push({ p, n: nOut, s: cr * (0.5 + 0.35 * rnd()), shade: 0 });
      }
    }
  }
  // (the pipe model: each node's flow its leaves' and its children's; radius ∝ flow^(1/2.5), the trunk's r0 at the foot)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if (n.parent >= 0) nodes[n.parent]!.flow += n.flow;
  }
  const rootFlow = Math.max(...nodes.filter((n) => n.parent < 0).map((n) => n.flow), 1);
  const radiusOf = (n: Node) => Math.max(r0 * (Math.max(n.flow, 0.5) / rootFlow) ** (1 / 2.5), 0.002);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (n.parent < 0) continue;
    const p = nodes[n.parent]!;
    segs.push({ a: p.p, b: n.p, ra: radiusOf(p), rb: radiusOf(n) });
  }
  // (each leaf's shade: deeper in the crown darker — the envelope's value at it —, and its own variation)
  for (const l of leaves) {
    const depthIn = Math.min(Math.max(env.inside(l.p), 0), 1);
    l.shade = (0.55 + 0.45 * depthIn) * (0.85 + 0.15 * rnd());
  }
  return meshOf(segs, leaves, Math.max(R, ...leaves.map((l) => Math.hypot(l.p[0], l.p[1]) + l.s)));
}

function meshOf(segs: Seg[], leaves: { p: V3; n: V3; s: number; shade: number; long?: V3 }[], radius: number): TreeMesh {
  const SIDES = 5;
  const nv = segs.length * SIDES * 2 + leaves.length * 4;
  const ni = segs.length * SIDES * 6 + leaves.length * 6;
  const pos = new Float32Array(nv * 3),
    nrm = new Float32Array(nv * 3),
    attr = new Float32Array(nv * 4),
    index = new Uint32Array(ni);
  let v = 0,
    ix = 0;
  const put = (p: V3, n: V3, a: [number, number, number, number]) => {
    pos.set(p, v * 3);
    nrm.set(n, v * 3);
    attr.set(a, v * 4);
    return v++;
  };
  for (const s of segs) {
    const ax = norm(sub(s.b, s.a));
    const ref: V3 = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = norm(cross(ax, ref));
    const w = cross(ax, u);
    const base = v;
    for (let i = 0; i < SIDES; i++) {
      const t = (i / SIDES) * Math.PI * 2;
      const d = add(mul(u, Math.cos(t)), mul(w, Math.sin(t)));
      put(add(s.a, mul(d, s.ra)), d, [i / SIDES, 0, 0, 0.8]);
      put(add(s.b, mul(d, s.rb)), d, [i / SIDES, 1, 0, 0.8]);
    }
    for (let i = 0; i < SIDES; i++) {
      const a0 = base + 2 * i,
        a1 = base + 2 * ((i + 1) % SIDES);
      index.set([a0, a1, a0 + 1, a1, a1 + 1, a0 + 1], ix);
      ix += 6;
    }
  }
  for (const l of leaves) {
    // (a card facing its normal, turned at random about it — or along its frond, its needles' branch)
    const n = l.n;
    const ref: V3 = l.long ?? (Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
    const t = norm(cross(n, ref));
    const b = cross(n, t);
    const hl = l.long ? 1.0 : 0.5,
      hw = l.long ? 0.28 : 0.5;
    const base = v;
    const c = l.p;
    const corner = (x: number, y: number): V3 => add(c, add(mul(b, x * l.s * hl * 2), mul(t, y * l.s * hw * 2)));
    put(corner(-1, -1), n, [0, 0, 1, l.shade]);
    put(corner(1, -1), n, [1, 0, 1, l.shade]);
    put(corner(1, 1), n, [1, 1, 1, l.shade]);
    put(corner(-1, 1), n, [0, 1, 1, l.shade]);
    index.set([base, base + 1, base + 2, base, base + 2, base + 3], ix);
    ix += 6;
  }
  return { pos, nrm, attr, index, radius, leaves: leaves.length, segments: segs.length };
}
