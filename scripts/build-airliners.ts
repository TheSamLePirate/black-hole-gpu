// The real traffic's airliners (docs/PLAN-AVIATION-AAA.md, T2): the A320 (GLB) and the CRJ-900 (OBJ) supplied in
// assets/porte-avion/ (kept out of the repository) turned into the craft's mesh format for ship.ts — in the
// ship's frame (x its left, y up, z its nose), to the real aircraft's size, its parts' materials (40: the A320's
// painted skin, 41: the CRJ's, 42: its lights' lenses) — and their colour maps at 2048².
//   bun scripts/build-airliners.ts <dir of the unzipped models>
// The dir holds a320/source/Airbus A320.glb, a320/textures/*.jpeg, crj/inner/CRJ-900.obj, crj/textures/*.png.
//
// Format (little endian): "TRFC", u32 version 1, vertex count, index count, 6 × f32 bounds (min, max), then the
// vertices (10 × f32: position, normal, material, ambient occlusion, UV) and the u32 indices.

const dir = process.argv[2] ?? "/tmp/models";
const out = "assets/traffic";
await Bun.$`mkdir -p ${out}`;

interface Mesh {
  pos: number[];
  nrm: number[];
  uv: number[];
  part: number[];
  idx: number[];
}

function write(name: string, m: Mesh) {
  const nv = m.pos.length / 3,
    ni = m.idx.length;
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, m.pos[3 * i + k]!);
      hi[k] = Math.max(hi[k]!, m.pos[3 * i + k]!);
    }
  const buf = new ArrayBuffer(40 + nv * 40 + ni * 4);
  new Uint8Array(buf, 0, 4).set(new TextEncoder().encode("TRFC"));
  const u = new Uint32Array(buf, 0, 4);
  u[1] = 1;
  u[2] = nv;
  u[3] = ni;
  new Float32Array(buf, 16, 6).set([...lo, ...hi]);
  const v = new Float32Array(buf, 40, nv * 10);
  for (let i = 0; i < nv; i++)
    v.set(
      [
        m.pos[3 * i]!,
        m.pos[3 * i + 1]!,
        m.pos[3 * i + 2]!,
        m.nrm[3 * i]!,
        m.nrm[3 * i + 1]!,
        m.nrm[3 * i + 2]!,
        m.part[i]!,
        1,
        m.uv[2 * i]!,
        m.uv[2 * i + 1]!,
      ],
      i * 10,
    );
  new Uint32Array(buf, 40 + nv * 40, ni).set(m.idx);
  return Bun.write(`${out}/${name}.bin`, buf).then(() =>
    console.log(
      `${name}: ${nv} vertices, ${ni / 3} triangles, ${(hi[0]! - lo[0]!).toFixed(1)} × ${(hi[1]! - lo[1]!).toFixed(1)} × ${(hi[2]! - lo[2]!).toFixed(1)} m`,
    ),
  );
}

/** Each triangle's normals where none are given: the faces', summed at each vertex. */
function normals(pos: number[], idx: number[]): number[] {
  const n = new Array(pos.length).fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    const e1 = [0, 1, 2].map((k) => pos[3 * b + k]! - pos[3 * a + k]!);
    const e2 = [0, 1, 2].map((k) => pos[3 * c + k]! - pos[3 * a + k]!);
    const f = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    for (const i of [a, b, c]) for (let k = 0; k < 3; k++) n[3 * i + k] += f[k]!;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

// ---- the A320: its meshes already in the ship's frame and to size (34.1 m span, 37.6 m long); its painted
// materials (0, 3) the skin, its lights' (1, 2) the lenses
{
  const buf = await Bun.file(`${dir}/a320/source/Airbus A320.glb`).arrayBuffer();
  const dv = new DataView(buf);
  const jl = dv.getUint32(12, true);
  const J = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const binAt = 20 + jl + 8;
  const read = (ai: number): { a: Float32Array | Uint32Array | Uint16Array; n: number; c: number } => {
    const A = J.accessors[ai];
    const V = J.bufferViews[A.bufferView];
    const c = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[A.type as "SCALAR"]!;
    const off = binAt + (V.byteOffset ?? 0) + (A.byteOffset ?? 0);
    const Arr = A.componentType === 5126 ? Float32Array : A.componentType === 5125 ? Uint32Array : Uint16Array;
    return { a: new Arr(buf.slice(off, off + A.count * c * Arr.BYTES_PER_ELEMENT)), n: A.count, c };
  };
  const m: Mesh = { pos: [], nrm: [], uv: [], part: [], idx: [] };
  for (const mesh of J.meshes)
    for (const p of mesh.primitives) {
      const base = m.pos.length / 3;
      const P = read(p.attributes.POSITION);
      const T = p.attributes.TEXCOORD_0 !== undefined ? read(p.attributes.TEXCOORD_0) : null;
      const I = read(p.indices);
      const idx = [...I.a].map((i) => i + base);
      for (let i = 0; i < P.n; i++) {
        m.pos.push(P.a[3 * i]!, P.a[3 * i + 1]!, P.a[3 * i + 2]!);
        m.uv.push(T ? T.a[2 * i]! : 0, T ? T.a[2 * i + 1]! : 0);
        m.part.push(p.material === 1 || p.material === 2 ? 42 : 40);
      }
      m.idx.push(...idx);
    }
  m.nrm = normals(m.pos, m.idx);
  await write("a320", m);
  await Bun.$`sips -s format jpeg -s formatOptions 85 -Z 2048 ${`${dir}/a320/textures/faib_a320_cfm_t_0.jpeg`} --out ${`${out}/a320.jpg`}`.quiet();
}

// ---- the CRJ-900: its OBJ in tenths of the aircraft (x its left, y up, z its nose, the nose at z = 0): to
// 36.2 m long, centred on its length, its fuselage's axis near y = 0 (its belly 0.9 m under); its gear left out
{
  const t = await Bun.file(`${dir}/crj/inner/CRJ-900.obj`).text();
  const V: number[][] = [],
    VT: number[][] = [],
    VN: number[][] = [];
  const m: Mesh = { pos: [], nrm: [], uv: [], part: [], idx: [] };
  const k = 36.2 / 3.652402;
  const seen = new Map<string, number>();
  for (const line of t.split("\n")) {
    const w = line.trim().split(/\s+/);
    if (w[0] === "v") V.push(w.slice(1, 4).map(Number));
    else if (w[0] === "vt") VT.push(w.slice(1, 3).map(Number));
    else if (w[0] === "vn") VN.push(w.slice(1, 4).map(Number));
    else if (w[0] === "f") {
      const ids = w.slice(1).map((s) => {
        let i = seen.get(s);
        if (i === undefined) {
          const [a, b, c] = s.split("/").map((x) => (x ? Number(x) - 1 : -1));
          const p = V[a!]!;
          m.pos.push(p[0]! * k, (p[1]! - 0.222) * k, (p[2]! + 3.652402 / 2) * k);
          const uv = b! >= 0 ? VT[b!]! : [0, 0];
          m.uv.push(uv[0]!, 1 - uv[1]!);
          const n = c! >= 0 ? VN[c!]! : [0, 1, 0];
          m.nrm.push(n[0]!, n[1]!, n[2]!);
          m.part.push(41);
          i = m.pos.length / 3 - 1;
          seen.set(s, i);
        }
        return i;
      });
      // (its landing gear — down in the model — left out: every face wholly under the fuselage's belly, 1.05 m under
      // its axis; the traffic flies with it up, and on the ground its wheels are under the belly anyway)
      if (ids.every((i) => m.pos[3 * i + 1]! < -1.05)) continue;
      for (let j = 1; j + 1 < ids.length; j++) m.idx.push(ids[0]!, ids[j]!, ids[j + 1]!);
    }
  }
  await write("crj900", m);
  await Bun.$`sips -s format jpeg -s formatOptions 85 -Z 2048 ${`${dir}/crj/textures/CRJ-900_Cityjet_texture-4k.tga.png`} --out ${`${out}/crj900.jpg`}`.quiet();
}
