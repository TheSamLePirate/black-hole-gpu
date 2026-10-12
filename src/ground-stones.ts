// Stones on the living ground (character.wgsl: stonesGrow, stoneVs, stoneFs): a world-fixed lattice round the
// astronaut — each point jittered by its own hash, the same stone at the same place every frame —, kept where
// the ground grid's vegetation kind says stones lie (scree and bare ground the most, a forest's floor and moss
// some, a meadow a few, none on roads, water or buildings) and more on steep ground; most of them pebbles, a
// few boulders (the size's fourth power). Each a faceted, squashed, turned lump of an icosphere, sunk into
// the ground, coloured from the satellite's image greyed towards rock, moss on its top where it is damp; lit as
// the grass and the suit (the probe, the shadows), drawn before the grass (which stands round them).

import { VEGETATION } from "./grass-layout";
import { forestHash } from "./system/forest";

/** the lattice's spacing [m], its reach round the astronaut [m], its points a side, the stones drawn at most */
export const STONE_SPACING = 0.9;
export const STONE_REACH = 24;
export const STONE_LATTICE = Math.ceil((2 * STONE_REACH) / STONE_SPACING) + 2;
export const STONE_CAPACITY = 4096;

/** By vegetation kind (grass-layout.ts VEGETATION, by name): the share of lattice points holding a stone, its
 *  size's scale, the moss on its top (0 … 1). */
export interface StoneKind {
  density: number;
  size: number;
  moss: number;
}
export const STONES: Record<string, StoneKind> = {
  none: { density: 0, size: 0, moss: 0 },
  meadow: { density: 0.02, size: 0.6, moss: 0.15 },
  crop: { density: 0.004, size: 0.35, moss: 0 },
  scrub: { density: 0.09, size: 0.9, moss: 0.05 },
  "forest floor": { density: 0.06, size: 1, moss: 0.65 },
  reeds: { density: 0, size: 0, moss: 0 },
  sparse: { density: 0.26, size: 1, moss: 0.05 },
  moss: { density: 0.14, size: 0.8, moss: 0.85 },
};
/** the table as the shader reads it: per vegetation kind (its index) (density, size, moss, 0) */
export function packStones(): Float32Array {
  const out = new Float32Array(VEGETATION.length * 4);
  VEGETATION.forEach((v, k) => {
    const s = STONES[v.name] ?? STONES.none!;
    out.set([s.density, s.size, s.moss, 0], k * 4);
  });
  return out;
}
/** a stone's radius [m] from its draw u ∈ [0, 1) and its kind's size: pebbles mostly, a boulder now and then
 *  (stonesGrow's) */
export const stoneRadius = (u: number, size: number) => size * (0.04 + 0.66 * u ** 4);

/** The stone's mesh: an icosphere subdivided once (80 faces), unit radius, as a triangle list (xyz each). */
export function stoneMesh(): Float32Array<ArrayBuffer> {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: number[][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map((p) => p.map((x) => x / Math.hypot(...p)));
  const faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  const mid = (a: number[], b: number[]) => {
    const m = a.map((x, i) => (x + b[i]!) / 2);
    const l = Math.hypot(...m);
    return m.map((x) => x / l);
  };
  const out: number[] = [];
  for (const [a, b, c] of faces) {
    const A = v[a!]!,
      B = v[b!]!,
      C = v[c!]!;
    const ab = mid(A, B),
      bc = mid(B, C),
      ca = mid(C, A);
    for (const tri of [
      [A, ab, ca],
      [B, bc, ab],
      [C, ca, bc],
      [ab, bc, ca],
    ])
      for (const p of tri) out.push(...p);
  }
  return new Float32Array(out);
}
export const STONE_VERTICES = 80 * 3;

// ---- the large stones on the CPU (the walker's collisions): stonesGrow's own choices, the same hash
/** character.wgsl's hash2: the forest's hash (the same bits), over 2³² − 1 */
const hash2 = (x: number, z: number, k: number) => Math.fround(forestHash(x, z, k)) / 4294967295;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
/** The ground the stones lie on (grass-ground.ts GrassGround: what the GPU reads). */
export interface StoneGround {
  ready: boolean;
  cellAt(x: number, z: number): number;
  heightAt(x: number, z: number): number;
}
/** A stone: where it lies in the frame (x, z [m]), its radius, its foot and top [m along up]. */
export interface Boulder {
  x: number;
  z: number;
  r: number;
  base: number;
  top: number;
}
/** The stones at least `minR` round within `radius` of (x, z) — those stonesGrow lays there (the view and the
 *  vessel aside: they lie there all the same). */
export function bouldersNear(ground: StoneGround, x: number, z: number, radius: number, minR = 0.2, table = packStones()): Boulder[] {
  const out: Boulder[] = [];
  if (!ground.ready) return out;
  const sp = STONE_SPACING,
    reach = radius + 1;
  for (let gj = Math.floor((z - reach) / sp) - 1; gj <= Math.ceil((z + reach) / sp); gj++)
    for (let gi = Math.floor((x - reach) / sp) - 1; gi <= Math.ceil((x + reach) / sp); gi++) {
      const sx = (gi + hash2(gi, gj, 31)) * sp,
        sz = (gj + hash2(gi, gj, 32)) * sp;
      if (Math.hypot(sx - x, sz - z) > reach) continue;
      const k = ground.cellAt(sx, sz) >>> 24;
      if (k === 0 || k > 7) continue;
      const density = table[k * 4]!,
        size = table[k * 4 + 1]!;
      const slope = Math.hypot(
        ground.heightAt(sx + 0.5, sz) - ground.heightAt(sx - 0.5, sz),
        ground.heightAt(sx, sz + 0.5) - ground.heightAt(sx, sz - 0.5),
      );
      if (hash2(gi, gj, 33) >= density * (1 + 4 * smoothstep(0.35, 0.9, slope))) continue;
      const r = size * (0.04 + 0.66 * hash2(gi, gj, 34) ** 4);
      if (r < minR) continue;
      const base = ground.heightAt(sx, sz) - 0.35 * r;
      // (its top: squashed, the lump's bumps at most ~40 % out)
      out.push({ x: sx, z: sz, r, base, top: base + (0.45 + 0.4 * hash2(gi, gj, 37)) * r * 1.4 });
    }
  return out;
}
