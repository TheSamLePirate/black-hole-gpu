// The real traffic's ships (docs/PLAN-AVIATION-AAA.md, T3), in the craft's mesh format for ship.ts ("TRFC", as the
// airliners' — scripts/build-airliners.ts): in the ship's frame (x its left, y up — 0 its waterline —, z its bow,
// centred on its length), to a reference size each (the AIS's length and beam scale it):
//   - the container ship supplied (scripts/build-ships.py's GLB): its hull (material 44), its bridge (45), its
//     containers (46) on their colour maps (the traffic's texture array, layers 2–4); 300 m;
//   - the tanker: the same hull and bridge without the containers;
//   - the ferry, the trawler, the sailing boat: drawn here — a hull of sections (its bottom antifouling under the
//     waterline, its topsides painted), decks, superstructures with their windows, a funnel, masts, sails (the
//     painted materials 47–53, ship.wgsl).
//   bun scripts/build-ships.ts <the GLB> <the unzipped model's dir>

const glb = process.argv[2] ?? "/tmp/models/ship/ship.glb";
const dir = process.argv[3] ?? "/tmp/models/ship";
const out = "assets/traffic";
await Bun.$`mkdir -p ${out}`;

interface Mesh {
  pos: number[];
  nrm: number[];
  uv: number[];
  part: number[];
  idx: number[];
}
const empty = (): Mesh => ({ pos: [], nrm: [], uv: [], part: [], idx: [] });

/** The materials (ship.wgsl): the container ship's maps, then the painted ones. */
const M = {
  hull: 44,
  bridge: 45,
  boxes: 46,
  antifoul: 47,
  white: 48,
  navy: 49,
  deck: 50,
  sail: 51,
  metal: 52,
  accent: 53,
  grey: 54,
  glass: 42,
} as const;

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
      `${name}: ${nv} vertices, ${ni / 3} triangles, ${(hi[0]! - lo[0]!).toFixed(1)} × ${(hi[1]! - lo[1]!).toFixed(1)} × ${(hi[2]! - lo[2]!).toFixed(1)} m (draught ${(-lo[1]!).toFixed(1)} m)`,
    ),
  );
}

// ---- the container ship and the tanker: the GLB's meshes (glTF: x its length, y up, z across), their node
// offsets; its bow the end narrower at its waterline; 2.5 units its
// waterline (the black topsides' foot on its hull's map); to 300 m
{
  const buf = await Bun.file(glb).arrayBuffer();
  const dv = new DataView(buf);
  const jl = dv.getUint32(12, true);
  const J = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const binAt = 20 + jl + 8;
  const read = (ai: number) => {
    const A = J.accessors[ai];
    const V = J.bufferViews[A.bufferView];
    const c = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[A.type as "SCALAR"]!;
    const off = binAt + (V.byteOffset ?? 0) + (A.byteOffset ?? 0);
    const Arr = A.componentType === 5126 ? Float32Array : A.componentType === 5125 ? Uint32Array : Uint16Array;
    return { a: new Arr(buf.slice(off, off + A.count * c * Arr.BYTES_PER_ELEMENT)), n: A.count as number };
  };
  type Prim = { P: number[]; N: number[]; T: number[]; I: number[]; mat: string };
  const prims: Prim[] = [];
  for (const node of J.nodes) {
    if (node.mesh === undefined) continue;
    const t = node.translation ?? [0, 0, 0];
    for (const p of J.meshes[node.mesh].primitives) {
      const P = read(p.attributes.POSITION),
        N = read(p.attributes.NORMAL),
        T = read(p.attributes.TEXCOORD_0),
        I = read(p.indices);
      prims.push({
        P: [...P.a].map((x, i) => x + t[i % 3]),
        N: [...N.a],
        T: [...T.a],
        I: [...I.a],
        mat: J.materials[p.material].name as string,
      });
    }
  }
  let lo = Infinity,
    hi = -Infinity;
  for (const p of prims) for (let i = 0; i < p.P.length; i += 3) (lo = Math.min(lo, p.P[i]!)), (hi = Math.max(hi, p.P[i]!));
  const cx = (lo + hi) / 2;
  // (the bow: the end where its hull is the narrower at its waterline — the stern's is its transom's width)
  const beamAt = (end: number) => {
    let w = 0;
    for (const p of prims)
      if (p.mat === "Hull")
        for (let i = 0; i < p.P.length; i += 3)
          if (Math.abs(p.P[i + 1]! - 2.5) < 0.4 && Math.abs(p.P[i]! - end) < (hi - lo) * 0.06) w = Math.max(w, Math.abs(p.P[i + 2]!));
    return w;
  };
  const s = beamAt(hi) < beamAt(lo) ? 1 : -1;
  console.log(
    `container ship: ${(hi - lo).toFixed(2)} units long, its waterline's half-beam ${beamAt(lo).toFixed(2)} at −x, ${beamAt(hi).toFixed(2)} at +x — its bow at ${s > 0 ? "+x" : "−x"}`,
  );
  const k = 300 / (hi - lo);
  const WL = 2.5;
  const build = (withBoxes: boolean) => {
    const m = empty();
    for (const p of prims) {
      if (p.mat === "Containers" && !withBoxes) continue;
      const base = m.pos.length / 3;
      const mat = p.mat === "Hull" ? M.hull : p.mat === "Bridge" ? M.bridge : M.boxes;
      for (let i = 0; i < p.P.length / 3; i++) {
        m.pos.push(-s * p.P[3 * i + 2]! * k, (p.P[3 * i + 1]! - WL) * k, s * (p.P[3 * i]! - cx) * k);
        m.nrm.push(-s * p.N[3 * i + 2]!, p.N[3 * i + 1]!, s * p.N[3 * i]!);
        m.uv.push(p.T[2 * i]!, p.T[2 * i + 1]!);
        m.part.push(mat);
      }
      for (const i of p.I) m.idx.push(i + base);
    }
    return m;
  };
  await write("cargo", build(true));
  await write("tanker", build(false));
  for (const [src, name] of [
    ["Hull_Base_color_sRGB.png", "cargo-hull"],
    ["Bridge_Base_color_sRGB.png", "cargo-bridge"],
    ["Containers_Base_color_sRGB.png", "cargo-boxes"],
  ])
    await Bun.$`sips -s format jpeg -s formatOptions 85 -Z 2048 ${`${dir}/textures/${src}`} --out ${`${out}/${name}.jpg`}`.quiet();
}

// ---- the drawn ships: a builder of faces (flat normals: hard edges), boxes, hulls

class Builder {
  m = empty();
  /** a point inside what is being drawn: each face turned away from it (counter-clockwise seen from outside) */
  inside: number[] | null = null;
  quad(a: number[], b: number[], c: number[], d: number[], mat: number) {
    this.tri(a, b, c, mat);
    this.tri(a, c, d, mat);
  }
  tri(a: number[], b0: number[], c0: number[], mat: number) {
    let b = b0,
      c = c0;
    const e1 = [0, 1, 2].map((i) => b[i]! - a[i]!),
      e2 = [0, 1, 2].map((i) => c[i]! - a[i]!);
    let n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const l = Math.hypot(...n);
    if (l < 1e-9) return;
    const I = this.inside;
    if (I && n[0]! * (a[0]! - I[0]!) + n[1]! * (a[1]! - I[1]!) + n[2]! * (a[2]! - I[2]!) < 0) {
      [b, c] = [c, b];
      n = n.map((x) => -x);
    }
    const base = this.m.pos.length / 3;
    for (const p of [a, b, c]) {
      this.m.pos.push(p[0]!, p[1]!, p[2]!);
      this.m.nrm.push(n[0]! / l, n[1]! / l, n[2]! / l);
      this.m.uv.push(0, 0);
      this.m.part.push(mat);
    }
    this.m.idx.push(base, base + 1, base + 2);
  }
  /** a box: across x0…x1, up y0…y1, along z0…z1 (its top narrowed by `taper` each side) */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: number, top = mat, taper = 0) {
    const p = (x: number, y: number, z: number) => [x, y, z];
    const t = taper;
    const was = this.inside;
    this.inside = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const A = p(x0, y0, z0),
      B = p(x1, y0, z0),
      C = p(x1, y0, z1),
      D = p(x0, y0, z1);
    const E = p(x0 + t, y1, z0 + t),
      F = p(x1 - t, y1, z0 + t),
      G = p(x1 - t, y1, z1 - t),
      H = p(x0 + t, y1, z1 - t);
    this.quad(E, H, G, F, top);
    this.quad(A, B, C, D, mat);
    this.quad(A, E, F, B, mat); // its back (z0)
    this.quad(D, C, G, H, mat); // its front (z1)
    this.quad(A, D, H, E, mat); // x0
    this.quad(B, F, G, C, mat); // x1
    this.inside = was;
  }
  /** a deck's windows: a dark band round a box, a hand's breadth proud */
  windows(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
    this.box(x0 - 0.05, x1 + 0.05, y0, y1, z0 - 0.05, z1 + 0.05, M.glass);
  }
  /**
   * A hull: its half-beam along its length (`half(f)`, f 0 its stern to 1 its bow), its depth from its keel to its
   * deck, its waterline — sections joined, its bottom antifouling, its topsides `paint`, its deck, its transom.
   */
  hull(L: number, B: number, keel: number, deck: number, paint: number, sheer = 0) {
    const n = 40;
    const half = (f: number) => {
      // (a fine bow — its last fifth drawn in —, a full stern a transom's width)
      const bow = f > 0.62 ? Math.sqrt(Math.max(0, 1 - ((f - 0.62) / 0.38) ** 2)) : 1;
      const stern = f < 0.12 ? 0.82 + 0.18 * (f / 0.12) : 1;
      return (B / 2) * bow * stern;
    };
    const rows: number[][][] = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const z = -L / 2 + f * L;
      const b = half(f);
      const top = deck + sheer * (2 * f - 1) ** 2 + (f > 0.8 ? (f - 0.8) * 2.5 * sheer : 0);
      // (its keel rising to the stem forward)
      const k = f > 0.85 ? keel + (top - keel) * 0.35 * ((f - 0.85) / 0.15) : keel;
      // a section: keel, bilge, waterline, deck edge — its right side (x < 0: the left is +x)
      rows.push([
        [0, k, z],
        [-b * 0.7, k + 0.1 * (0 - k), z],
        [-b * 0.97, k * 0.35, z],
        [-b, 0, z],
        [-b * 1.02, top, z],
      ]);
    }
    for (let i = 0; i < n; i++) {
      const a = rows[i]!,
        c = rows[i + 1]!;
      // (inside: on its axis, between its keel and its deck)
      this.inside = [0, (a[0]![1]! + a[4]![1]!) / 2, (a[0]![2]! + c[0]![2]!) / 2];
      for (let j = 0; j < 4; j++) {
        const mat = j < 3 ? M.antifoul : paint;
        // right side (x < 0), then its mirror
        this.quad(a[j]!, a[j + 1]!, c[j + 1]!, c[j]!, mat);
        const mi = (p: number[]) => [-p[0]!, p[1]!, p[2]!];
        this.quad(mi(a[j]!), mi(c[j]!), mi(c[j + 1]!), mi(a[j + 1]!), mat);
      }
      // the deck
      const mi = (p: number[]) => [-p[0]!, p[1]!, p[2]!];
      this.quad(a[4]!, mi(a[4]!), mi(c[4]!), c[4]!, M.deck);
    }
    // the transom
    const r = rows[0]!;
    this.inside = [0, (r[0]![1]! + r[4]![1]!) / 2, r[0]![2]! + 1];
    for (let j = 0; j < 4; j++) {
      const mi = (p: number[]) => [-p[0]!, p[1]!, p[2]!];
      this.quad(r[j]!, mi(r[j]!), mi(r[j + 1]!), r[j + 1]!, j < 3 ? M.antifoul : paint);
    }
    this.inside = null;
    return half;
  }
}

// the ferry: 150 m, 26 m beam, its deck 9 m over its 6 m draught; four decks of cabins and their windows, its
// bridge forward, its funnel aft
{
  const b = new Builder();
  const L = 150,
    B = 26;
  b.hull(L, B, -6, 9, M.white, 1.5);
  for (let d = 0; d < 4; d++) {
    const y0 = 9 + d * 3,
      z0 = -L / 2 + 22 + d * 3,
      z1 = L / 2 - 38 - d * 4,
      w = B / 2 - 0.8 - d * 0.4;
    b.box(-w, w, y0, y0 + 3, z0, z1, M.white);
    b.windows(-w, w, y0 + 1.1, y0 + 2.2, z0 + 2, z1 - 1);
  }
  // its bridge: forward, the full beam, glazed
  b.box(-B / 2 + 0.5, B / 2 - 0.5, 21, 24, L / 2 - 58, L / 2 - 50, M.white);
  b.windows(-B / 2 + 0.5, B / 2 - 0.5, 22, 23.4, L / 2 - 58, L / 2 - 50);
  // its funnels, twin, aft
  for (const x of [-4.5, 4.5]) {
    b.box(x - 1.8, x + 1.8, 21, 29, -L / 2 + 30, -L / 2 + 38, M.white, M.navy, 0.3);
    b.box(x - 1.6, x + 1.6, 26.5, 29.2, -L / 2 + 30.2, -L / 2 + 37.8, M.navy);
  }
  // a blue band along its hull
  b.box(-B / 2 - 0.08, B / 2 + 0.08, 3.2, 4.4, -L / 2 + 6, L / 2 - 22, M.navy);
  // its mast
  b.box(-0.3, 0.3, 24, 32, L / 2 - 55, L / 2 - 54.4, M.metal);
  await write("ferry", b.m);
}

// the trawler: 28 m, 8 m beam; its wheelhouse forward, its gantry aft, a mast
{
  const b = new Builder();
  const L = 28,
    B = 8;
  b.hull(L, B, -3, 2.6, M.navy, 0.8);
  b.box(-2.8, 2.8, 2.6, 5.4, 2, 8, M.white);
  b.windows(-2.8, 2.8, 4.2, 5.1, 2.3, 7.8);
  b.box(-2.4, 2.4, 5.4, 7.4, 3, 7, M.white);
  b.windows(-2.4, 2.4, 6.2, 7.1, 3.2, 6.8);
  // the gantry: two legs and a beam over its stern
  for (const x of [-3.4, 3.2]) b.box(x, x + 0.25, 2.6, 8, -L / 2 + 1.2, -L / 2 + 1.5, M.accent);
  b.box(-3.4, 3.45, 7.75, 8, -L / 2 + 1.2, -L / 2 + 1.5, M.accent);
  // its mast and a boom
  b.box(-0.15, 0.15, 7.4, 13, 5, 5.3, M.metal);
  b.box(-0.1, 0.1, 6, 6.2, -6, 5, M.metal);
  await write("trawler", b.m);
}

// the frigate (a carrier's escort): 135 m, 17 m beam, its deck 7 m over its 5 m draught, haze grey; its gun
// forward, its bridge and mast, its funnel, its hangar and helicopter deck aft
{
  const b = new Builder();
  const L = 135,
    B = 17;
  b.hull(L, B, -5, 7, M.grey, 1.2);
  // its superstructure: bridge forward of amidships, then the funnel, the hangar
  b.box(-6.5, 6.5, 7, 12, 8, 34, M.grey, M.grey, 0.4);
  b.box(-5.5, 5.5, 12, 15.5, 22, 32, M.grey, M.grey, 0.3);
  b.windows(-5.5, 5.5, 13.6, 14.8, 30, 32.05);
  b.box(-6, 6, 7, 13, -26, 8, M.grey, M.grey, 0.3);
  b.box(-2.5, 2.5, 13, 20, -6, 2, M.grey, M.navy, 0.5);
  // its mast, its radar
  b.box(-0.5, 0.5, 15.5, 32, 25, 26, M.metal);
  b.box(-2.5, 2.5, 25, 26, 24.5, 26.5, M.metal);
  // its gun forward
  b.box(-1.8, 1.8, 7, 9.2, 40, 44, M.grey, M.grey, 0.4);
  b.box(-0.18, 0.18, 8, 8.4, 44, 51, M.metal);
  // its helicopter deck aft: a dark square, a white circle's ring of boxes
  b.box(-7.5, 7.5, 7, 7.15, -60, -28, M.deck);
  await write("frigate", b.m);
}

// the sailing boat: 12 m, 3.8 m beam; its fin keel, its mast 16 m, its mainsail and its jib (both faces)
{
  const b = new Builder();
  const L = 12,
    B = 3.8;
  b.hull(L, B, -0.6, 1.1, M.white, 0.25);
  // its keel and rudder
  b.box(-0.12, 0.12, -2.1, -0.5, -0.5, 0.9, M.navy);
  b.box(-0.08, 0.08, -1.4, -0.3, -L / 2 + 0.6, -L / 2 + 1.1, M.navy);
  // its coachroof
  b.box(-1.1, 1.1, 1.1, 1.7, -1.2, 2.2, M.white);
  b.windows(-1.1, 1.1, 1.3, 1.55, -0.8, 1.8);
  // its mast and boom
  const mz = 1.6;
  b.box(-0.08, 0.08, 1.1, 17, mz - 0.08, mz + 0.08, M.metal);
  b.box(-0.06, 0.06, 2.1, 2.25, -L / 2 + 1.4, mz, M.metal);
  // the sails, a hair to each side of the mast's plane
  const sail = (pts: number[][]) => {
    b.tri(pts[0]!, pts[1]!, pts[2]!, M.sail);
    b.tri(pts[0]!, pts[2]!, pts[1]!, M.sail);
  };
  sail([
    [0.02, 2.3, mz - 0.1],
    [0.02, 16.6, mz - 0.1],
    [0.02, 2.3, -L / 2 + 1.5],
  ]);
  sail([
    [-0.02, 1.4, mz + 0.3],
    [-0.02, 14.5, mz + 0.15],
    [-0.02, 1.4, L / 2 - 0.4],
  ]);
  await write("sailboat", b.m);
}
