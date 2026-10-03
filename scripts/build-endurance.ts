// Prepares the Endurance model for the web: FBX → (Blender: joined, decimated, triangulated) OBJ →
// its levels of detail, the app picking one by the ship's size on screen (src/endurance.ts):
// endurance-lod2.bin (5 % of the triangles), endurance-lod1.bin (10 %), endurance.bin (40 %) and
// endurance-full.bin (all of them).
//
//   bun scripts/build-endurance.ts ["assets/Interstellar Endurance"] [path/to/Blender] [name,name…]
//
//  1. positions centred on the ring and scaled to a diameter of 1 (the app sets its size), the ring's
//     axis (the model's thinnest extent) turned onto z;
//  2. normals smoothed across edges flatter than 40°, a material id per part (0 metal, 1 non-metal,
//     2 glass, 3 tiles, 4 lights, 5 interior, 6 the docked shuttles);
//  3. ambient occlusion baked per vertex (AO_RAYS cosine-distributed rays against a BVH, occlusion
//     weighted by 1 − t/AO_RANGE).
// Binary layout (little endian): "ENDR", u32 version (1), u32 vertex count, u32 index count,
// 6 × f32 bounds (min xyz, max xyz), then vertices (8 × f32: position 3, normal 3, material, AO) and
// u32 indices — the Ranger's layout (scripts/build-ranger.ts).
import { $ } from "bun";

const src = process.argv[2] ?? "assets/Interstellar Endurance";
const blender = process.argv[3] ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const out = "assets/endurance";
const tmp = `${process.env.TMPDIR ?? "/tmp"}/endurance-build`;
const MATERIALS: [RegExp, number][] = [
  [/^Non_Metal/, 1],
  [/^Metal/, 0],
  [/^Glass/, 2],
  [/^Tiles/, 3],
  [/^Light/, 4],
  [/^Interior/, 5],
  [/^RollingShuttle/, 6],
];
const SMOOTH = Math.cos((40 * Math.PI) / 180);
const AO_RAYS = 32;
const AO_RANGE = 0.06; // (the ring's diameter: 1)

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

async function build(ratio: number, name: string) {
  await $`mkdir -p ${tmp} ${out}`;
  const obj = `${tmp}/${name}.obj`;
  const log = await $`${blender} -b --python scripts/endurance-convert.py -- ${`${src}/source/Endurance.fbx`} ${obj} ${ratio}`
    .quiet()
    .text();
  console.log(log.split("\n").find((l) => l.startsWith("endurance:")) ?? "(blender: no report)");

  // ---------------------------------------------------------------------------------- parse
  const P: V3[] = [];
  const tris: { v: [number, number, number]; part: number }[] = [];
  let part = 0;
  for (const line of (await Bun.file(obj).text()).split("\n")) {
    const w = line.trim().split(/\s+/);
    if (w[0] === "v") P.push([+w[1]!, +w[2]!, +w[3]!]);
    else if (w[0] === "usemtl") part = MATERIALS.find(([re]) => re.test(w[1] ?? ""))?.[1] ?? 0;
    else if (w[0] === "f") {
      const v = w.slice(1).map((c) => Number(c.split("/")[0]) - 1);
      for (let k = 1; k + 1 < v.length; k++) tris.push({ v: [v[0]!, v[k]!, v[k + 1]!], part });
    }
  }

  // ---------------------------------------------------------------------------------- frame
  const lo: V3 = [Infinity, Infinity, Infinity],
    hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of P) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, p[k]!)), (hi[k] = Math.max(hi[k]!, p[k]!));
  const ext = [0, 1, 2].map((k) => hi[k]! - lo[k]!);
  const axis = ext.indexOf(Math.min(...ext));
  const c = scale(add(lo, hi), 0.5);
  const d = Math.max(...ext);
  // (the axis onto z, keeping a right-handed frame)
  const perm = [(axis + 1) % 3, (axis + 2) % 3, axis];
  for (let i = 0; i < P.length; i++) {
    const q = scale(sub(P[i]!, c), 1 / d);
    P[i] = [q[perm[0]!]!, q[perm[1]!]!, q[perm[2]!]!];
  }

  // ---------------------------------------------------------------------------------- normals
  const fn = tris.map((t) => {
    const cr = cross(sub(P[t.v[1]]!, P[t.v[0]]!), sub(P[t.v[2]]!, P[t.v[0]]!));
    return { n: norm(cr), area: Math.hypot(...cr) / 2 };
  });
  const around = new Map<number, number[]>();
  tris.forEach((t, i) => t.v.forEach((v) => (around.get(v) ?? around.set(v, []).get(v)!).push(i)));
  const verts: number[][] = [];
  const key = new Map<string, number>();
  const indices: number[] = [];
  tris.forEach((t, i) => {
    if (fn[i]!.area < 1e-14) return;
    for (let k = 0; k < 3; k++) {
      let n: V3 = [0, 0, 0];
      for (const j of around.get(t.v[k]!)!) if (dot(fn[j]!.n, fn[i]!.n) >= SMOOTH) n = add(n, scale(fn[j]!.n, fn[j]!.area));
      n = norm(n);
      const id = `${t.v[k]}/${n.map((x) => x.toFixed(3)).join()}/${t.part}`;
      let vi = key.get(id);
      if (vi === undefined) {
        vi = verts.length;
        key.set(id, vi);
        verts.push([...P[t.v[k]!]!, ...n, t.part, 1]);
      }
      indices.push(vi);
    }
  });

  // ---------------------------------------------------------------------------------- AO bake
  const T = tris.map((t) => t.v.map((i) => P[i]!) as [V3, V3, V3]);
  interface Node {
    lo: V3;
    hi: V3;
    l?: Node;
    r?: Node;
    items?: number[];
  }
  const cen = (i: number, k: number) => (T[i]![0][k]! + T[i]![1][k]! + T[i]![2][k]!) / 3;
  function bvh(items: number[]): Node {
    const lo: V3 = [Infinity, Infinity, Infinity],
      hi: V3 = [-Infinity, -Infinity, -Infinity];
    const clo: V3 = [Infinity, Infinity, Infinity],
      chi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const i of items) {
      for (const p of T[i]!) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, p[k]!)), (hi[k] = Math.max(hi[k]!, p[k]!));
      for (let k = 0; k < 3; k++) (clo[k] = Math.min(clo[k]!, cen(i, k))), (chi[k] = Math.max(chi[k]!, cen(i, k)));
    }
    if (items.length <= 4) return { lo, hi, items };
    const ax = [0, 1, 2].reduce((m, k) => (chi[k]! - clo[k]! > chi[m]! - clo[m]! ? k : m), 0);
    items.sort((a, b) => cen(a, ax) - cen(b, ax));
    const h = items.length >> 1;
    return { lo, hi, l: bvh(items.slice(0, h)), r: bvh(items.slice(h)) };
  }
  const root = bvh([...T.keys()]);
  const hitBox = (n: Node, o: V3, inv: V3, tMax: number) => {
    let t0 = 0,
      t1 = tMax;
    for (let k = 0; k < 3; k++) {
      let a = (n.lo[k]! - o[k]!) * inv[k]!,
        b = (n.hi[k]! - o[k]!) * inv[k]!;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
    return true;
  };
  const cast = (o: V3, dir: V3, tMax: number) => {
    const inv: V3 = [1 / dir[0], 1 / dir[1], 1 / dir[2]];
    let best = tMax;
    const stack: Node[] = [root];
    while (stack.length) {
      const n = stack.pop()!;
      if (!hitBox(n, o, inv, best)) continue;
      if (!n.items) {
        stack.push(n.l!, n.r!);
        continue;
      }
      for (const i of n.items) {
        const [a, b, cc] = T[i]!;
        const e1 = sub(b, a),
          e2 = sub(cc, a);
        const pv = cross(dir, e2);
        const det = dot(e1, pv);
        if (Math.abs(det) < 1e-14) continue;
        const id = 1 / det;
        const tv = sub(o, a);
        const u = dot(tv, pv) * id;
        if (u < 0 || u > 1) continue;
        const qv = cross(tv, e1);
        const v = dot(dir, qv) * id;
        if (v < 0 || u + v > 1) continue;
        const t = dot(e2, qv) * id;
        if (t > 1e-6 && t < best) best = t;
      }
    }
    return best;
  };
  const dirs: V3[] = [];
  for (let i = 0; i < AO_RAYS; i++) {
    const r = Math.sqrt((i + 0.5) / AO_RAYS),
      ph = i * 2.399963229728653;
    dirs.push([r * Math.cos(ph), r * Math.sin(ph), Math.sqrt(1 - r * r)]);
  }
  const t0 = performance.now();
  for (const v of verts) {
    const p = v.slice(0, 3) as V3,
      n = v.slice(3, 6) as V3;
    const t1 = norm(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const t2 = cross(n, t1);
    const o = add(p, scale(n, 1e-4));
    const rot = ((Math.sin(p[0] * 1298.98 + p[1] * 7823.3 + p[2] * 3771.9) * 43758.5453) % 1) * 2 * Math.PI;
    const cr = Math.cos(rot),
      sr = Math.sin(rot);
    let occ = 0;
    for (const [x0, y0, z] of dirs) {
      const x = x0 * cr - y0 * sr,
        y = x0 * sr + y0 * cr;
      const dd: V3 = [t1[0] * x + t2[0] * y + n[0] * z, t1[1] * x + t2[1] * y + n[1] * z, t1[2] * x + t2[2] * y + n[2] * z];
      const t = cast(o, dd, AO_RANGE);
      if (t < AO_RANGE) occ += 1 - t / AO_RANGE;
    }
    v[7] = 1 - occ / AO_RAYS;
  }

  // ---------------------------------------------------------------------------------- write
  const blo: V3 = [Infinity, Infinity, Infinity],
    bhi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of P) for (let k = 0; k < 3; k++) (blo[k] = Math.min(blo[k]!, p[k]!)), (bhi[k] = Math.max(bhi[k]!, p[k]!));
  const head = new ArrayBuffer(16 + 24);
  new Uint8Array(head, 0, 4).set(new TextEncoder().encode("ENDR"));
  new Uint32Array(head, 4, 3).set([1, verts.length, indices.length]);
  new Float32Array(head, 16, 6).set([...blo, ...bhi]);
  await Bun.write(`${out}/${name}.bin`, new Blob([head, new Float32Array(verts.flat()), new Uint32Array(indices)]));
  console.log(
    `${name}.bin: ${indices.length / 3} triangles, ${verts.length} vertices; AO ${AO_RAYS} rays in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );
}

const LODS: [number, string][] = [
  [0.05, "endurance-lod2"],
  [0.1, "endurance-lod1"],
  [0.4, "endurance"],
  [1, "endurance-full"],
];
const only = process.argv[4]?.split(",");
for (const [ratio, name] of LODS) if (!only || only.includes(name)) await build(ratio, name);
console.log((await $`ls -la ${out}`.text()).trim());
