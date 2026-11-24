// The traffic's plain airliners' landing gear (Sam, 24 Nov 2026 — PROBLEMES « le train des avions dessinés sans gréement »): the
// supplied meshes have none to show — the A320's (assets/traffic/a320.bin, from the supplied GLB) is built with its gear up (its
// wheels in their wells), the CRJ-900's had its own cut out (scripts/build-airliners.ts: every face under its belly) —, so on the
// ground both stood on nothing. Their gear now comes from the game's FlightGear A320 (assets/a320/a320.bin, GNU GPL v2): its three
// legs posed down and loaded (its rig: src/a320/rig.ts), each part's finish by its material (painted struts, chromed sliding tubes,
// tyres and hubs), simplified (meshoptimizer — scripts/build-traffic-gear.ts) and placed in each plain mesh's frame — the A320's at
// its own place, the CRJ's scaled onto its own wheels' (those of its gear cut out, their vertices still in its file). Each vertex
// keeps its leg (0 the nose, 1 the left main — x > 0 —, 2 the right) in its ambient occlusion's integer: 1 + leg (the shading reads
// it clamped to 1). Drawn with the aircraft, its legs retracted by the traffic's own gear position (traffic/runway-phase.ts `gear`):
// each turned about its own hinge by the A320's angle (FlightGear's: its position 0.2…0.8) and shrunk into its bay (under 0.6) —
// ship.wgsl trafficGearPos, legFold here (the same, for the tests and the bounds). Pure.

export type V3 = [number, number, number];

/** A leg: its hinge (the mesh's frame [m]), its axis, its angle up [°] (turned by it, the leg is in its bay). */
export interface GearLeg {
  at: Readonly<V3>;
  axis: Readonly<V3>;
  up: number;
}

/** the materials of the gear (ship.wgsl): its painted struts, fittings and links; its chromed sliding tubes; its tyres; its hubs */
export const GEAR_MAT = { paint: 55, chrome: 56, tyre: 57, hub: 58 } as const;
export const isGearMat = (m: number) => m > 54.5 && m < 58.5;

/** The right main leg from the left one: mirrored across x = 0 (a turn's axis mirrored is (x, −y, −z), the same angle). */
export function mirrorLeg(L: GearLeg): GearLeg {
  return { at: [-L.at[0], L.at[1], L.at[2]], axis: [L.axis[0], -L.axis[1], -L.axis[2]], up: L.up };
}

/** q turned by t [rad] about the unit axis a (Rodrigues — ship.wgsl rotAbout). */
export function rotAbout(q: Readonly<V3>, a: Readonly<V3>, t: number): V3 {
  const c = Math.cos(t),
    s = Math.sin(t);
  const d = (a[0] * q[0] + a[1] * q[1] + a[2] * q[2]) * (1 - c);
  return [
    q[0] * c + (a[1] * q[2] - a[2] * q[1]) * s + a[0] * d,
    q[1] * c + (a[2] * q[0] - a[0] * q[2]) * s + a[1] * d,
    q[2] * c + (a[0] * q[1] - a[1] * q[0]) * s + a[2] * d,
  ];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
/** a leg's turn towards its bay at a gear position g (0 up … 1 down): none from 0.8 down, all of it under 0.2 — FlightGear's
 *  table (its position-norm 0.2…0.8) —; its size: whole above 0.6, none at 0 (shrunk into its bay — the well the plain mesh has
 *  or not —, not drawn: a point) */
export const foldAngle = (g: number) => 1 - clamp01((g - 0.2) / 0.6);
export const foldScale = (g: number) => smooth(0, 0.6, g);

/** A vertex of a leg at gear position g: turned about its hinge, shrunk towards it (ship.wgsl trafficGearPos). */
export function legFold(p: Readonly<V3>, L: GearLeg, g: number): V3 {
  const k = foldScale(g);
  const q: V3 = [(p[0] - L.at[0]) * k, (p[1] - L.at[1]) * k, (p[2] - L.at[2]) * k];
  const r = rotAbout(q, L.axis, ((L.up * Math.PI) / 180) * foldAngle(g));
  return [L.at[0] + r[0], L.at[1] + r[1], L.at[2] + r[2]];
}

/** The leg of a gear vertex from its ambient occlusion (1 + leg); −1: not the gear's. */
export const legOfAo = (ao: number) => Math.round(ao) - 1;

/** The FlightGear A320's rig objects of the gear (its legs, struts, links, sliding tubes, wheels and their placards — the
 *  decals' triangles left out by their material —; not its doors), and its leg: 0 the nose, else the main's (its side by its
 *  place). */
export function gearObject(name: string): "nose" | "main" | null {
  if (/Door/.test(name)) return null;
  if (/^NLG/.test(name)) return "nose";
  if (/^(MLG|SideStay)/.test(name)) return "main";
  return null;
}

/** A leg carried into a mesh: first squashed upright above its wheels (`squash`: over the height `above` [m, the source's frame],
 *  its height × k — a lower aircraft's shorter legs, the wheels kept round), then a similarity (scaled about a point, moved):
 *  p → to + s (p − from). */
export interface Similar {
  from: V3;
  to: V3;
  s: number;
  squash?: { above: number; k: number };
}
export const applySimilar = (T: Similar, p: Readonly<V3>): V3 => {
  const y = T.squash && p[1] > T.squash.above ? T.squash.above + (p[1] - T.squash.above) * T.squash.k : p[1];
  return [T.to[0] + T.s * (p[0] - T.from[0]), T.to[1] + T.s * (y - T.from[1]), T.to[2] + T.s * (p[2] - T.from[2])];
};
/** a leg carried by a similarity: its hinge moved, its axis and angle kept */
export const legSimilar = (T: Similar, L: GearLeg): GearLeg => ({ at: applySimilar(T, L.at), axis: L.axis, up: L.up });

/** A TRFC mesh (assets/traffic/*.bin — scripts/build-airliners.ts): 10 floats a vertex (position, normal, material, ambient
 *  occlusion, UV), its indices. */
export interface Trfc {
  verts: Float32Array;
  idx: Uint32Array;
}

export function readTrfc(buf: ArrayBuffer): Trfc {
  if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== "TRFC") throw new Error("not a TRFC mesh");
  const u = new Uint32Array(buf, 0, 4);
  const nv = u[2]!,
    ni = u[3]!;
  return { verts: new Float32Array(buf.slice(40, 40 + nv * 40)), idx: new Uint32Array(buf.slice(40 + nv * 40, 40 + nv * 40 + ni * 4)) };
}

export function writeTrfc(m: Trfc): ArrayBuffer {
  const nv = m.verts.length / 10,
    ni = m.idx.length;
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, m.verts[10 * i + k]!);
      hi[k] = Math.max(hi[k]!, m.verts[10 * i + k]!);
    }
  const buf = new ArrayBuffer(40 + nv * 40 + ni * 4);
  new Uint8Array(buf, 0, 4).set(new TextEncoder().encode("TRFC"));
  const u = new Uint32Array(buf, 0, 4);
  u[1] = 1;
  u[2] = nv;
  u[3] = ni;
  new Float32Array(buf, 16, 6).set([...lo, ...hi]);
  new Float32Array(buf, 40, nv * 10).set(m.verts);
  new Uint32Array(buf, 40 + nv * 40, ni).set(m.idx);
  return buf;
}

/**
 * A mesh with some triangles left out (`keep` false) and the vertices no triangle uses dropped — the CRJ's gear cut out by
 * build-airliners.ts had left its 6 332 vertices behind, its stubs under the belly; a gear baked before (its materials) taken out
 * before baking again.
 */
export function filterTris(m: Trfc, keep: (t: number) => boolean): Trfc {
  const nv = m.verts.length / 10;
  const map = new Int32Array(nv).fill(-1);
  const idx: number[] = [];
  let n = 0;
  for (let t = 0; t < m.idx.length / 3; t++) {
    if (!keep(t)) continue;
    for (let k = 0; k < 3; k++) {
      const i = m.idx[3 * t + k]!;
      if (map[i]! < 0) map[i] = n++;
      idx.push(map[i]!);
    }
  }
  const verts = new Float32Array(n * 10);
  for (let i = 0; i < nv; i++) if (map[i]! >= 0) verts.set(m.verts.subarray(10 * i, 10 * i + 10), 10 * map[i]!);
  return { verts, idx: new Uint32Array(idx) };
}

/** Its connected parts (triangles sharing a vertex, or a vertex's place): each triangle's part. */
export function trianglePartsOf(m: Trfc): Int32Array {
  const nv = m.verts.length / 10;
  const par = new Int32Array(nv).map((_, i) => i);
  const find = (x: number): number => {
    while (par[x] !== x) {
      par[x] = par[par[x]!]!;
      x = par[x]!;
    }
    return x;
  };
  const join = (a: number, b: number) => {
    a = find(a);
    b = find(b);
    if (a !== b) par[a] = b;
  };
  for (let t = 0; t < m.idx.length; t += 3) {
    join(m.idx[t]!, m.idx[t + 1]!);
    join(m.idx[t]!, m.idx[t + 2]!);
  }
  const at = new Map<string, number>();
  for (let i = 0; i < nv; i++) {
    const k = `${m.verts[10 * i]!.toFixed(4)},${m.verts[10 * i + 1]!.toFixed(4)},${m.verts[10 * i + 2]!.toFixed(4)}`;
    const j = at.get(k);
    if (j === undefined) at.set(k, i);
    else join(i, j);
  }
  const out = new Int32Array(m.idx.length / 3);
  for (let t = 0; t < out.length; t++) out[t] = find(m.idx[3 * t]!);
  return out;
}

/** A box [lo, hi] (the mesh's frame [m]). */
export type Box = [V3, V3];
const inside = (b: Box, lo: V3, hi: V3) =>
  lo[0] >= b[0][0] && lo[1] >= b[0][1] && lo[2] >= b[0][2] && hi[0] <= b[1][0] && hi[1] <= b[1][1] && hi[2] <= b[1][2];

/**
 * The triangles of the parts that lie wholly inside one of `boxes` — the CRJ's gear stubs left under its belly by
 * build-airliners.ts's cut (its legs' tops, a door): found by place and connection, each part's box inside a gear's.
 */
export function trianglesInBoxes(m: Trfc, boxes: readonly Box[]): Uint8Array {
  const part = trianglePartsOf(m);
  const lo = new Map<number, V3>(),
    hi = new Map<number, V3>();
  for (let t = 0; t < part.length; t++) {
    const p = part[t]!;
    const L = lo.get(p) ?? [Infinity, Infinity, Infinity];
    const H = hi.get(p) ?? [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) {
      const i = m.idx[3 * t + k]!;
      for (let j = 0; j < 3; j++) {
        L[j] = Math.min(L[j]!, m.verts[10 * i + j]!);
        H[j] = Math.max(H[j]!, m.verts[10 * i + j]!);
      }
    }
    lo.set(p, L);
    hi.set(p, H);
  }
  const out = new Uint8Array(part.length);
  for (let t = 0; t < part.length; t++) {
    const p = part[t]!;
    if (boxes.some((b) => inside(b, lo.get(p)!, hi.get(p)!))) out[t] = 1;
  }
  return out;
}

/**
 * The gear's legs for the craft's shader (ship.wgsl S.tgear — ship.ts writes it once): by mesh (the plain A320's, the CRJ's), by
 * leg (the nose, the left main, the right main — mirrored) two vec4s: its hinge and its angle up [rad], its unit axis.
 */
export function gearUniform(
  mesh: Readonly<Record<"a320t" | "crj900", { readonly gear: { readonly nose: GearLeg; readonly main: GearLeg } }>>,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(12 * 4);
  (["a320t", "crj900"] as const).forEach((id, m) => {
    const G = mesh[id].gear;
    [G.nose, G.main, mirrorLeg(G.main)].forEach((L, k) => {
      const l = Math.hypot(...L.axis) || 1;
      out.set([...L.at, (L.up * Math.PI) / 180, L.axis[0] / l, L.axis[1] / l, L.axis[2] / l, 0], (m * 6 + k * 2) * 4);
    });
  });
  return out;
}
