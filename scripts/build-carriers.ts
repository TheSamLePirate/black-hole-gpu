// The carriers (docs/PLAN-AVIATION-AAA.md, M2) in the craft's mesh format for ship.ts ("TRFC", as the traffic's —
// scripts/build-ships.ts), from scripts/build-carriers.py's GLBs (their transforms applied, the parked aircraft
// left out, each material's mean colour beside):
//   - in the ship's frame (x its port, y up — 0 its waterline —, z its bow, centred on its length), to its real size
//     (the Gerald R. Ford 333 m, the Kiev 273 m, the Implacable as built: 233.6 m), its waterline its freeboard under
//     its flight deck;
//   - its deck, hull and island on their maps (the carriers' texture layers: materials 80–86, ship.wgsl), every
//     other part flat in its material's mean colour (material 90, the colour in its UV);
//   - its top surface as a height map a metre a cell (DECK: its flight deck, island, guns — what the gear meets and
//     the craft hits).
//   bun scripts/build-carriers.ts <dir of the GLBs> (ford.glb, kiev.glb, implacable.glb and their .colours.json)

const dir = process.argv[2] ?? "/tmp/models";
const out = "assets/carriers";
await Bun.$`mkdir -p ${out}`;

/** Each carrier: its GLB, its length [m] (null: as built), its freeboard [m] under the flight deck, its bow's
 *  way in the GLB (glTF z: +1 — Blender's −y —), the textured materials (by name or by their map's name), its
 *  first layer. */
const CARRIERS = [
  { id: "ford", len: 333, freeboard: 18.5, bow: 1, maps: ["ship", "ship rest", "ship_bridge1"], layer: 0 },
  { id: "kiev", len: 273, freeboard: 15, bow: 1, maps: ["Material__0", "Material__1"], layer: 3 },
  {
    id: "implacable",
    len: null,
    freeboard: 13,
    bow: 1,
    deck: 22,
    maps: ["bsa008_implacable_1945_deckhouse_a", "bsa008_implacable_1945_a"],
    layer: 5,
  },
] as const;
/** a material drawn translucent in its model (railings, nets): left out */
const DROP_BLEND = true;

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
      `${name}: ${nv} vertices, ${ni / 3} triangles, ${(hi[0]! - lo[0]!).toFixed(1)} × ${(hi[1]! - lo[1]!).toFixed(1)} × ${(hi[2]! - lo[2]!).toFixed(1)} m (draught ${(-lo[1]!).toFixed(1)} m, top ${hi[1]!.toFixed(1)} m)`,
    ),
  );
}

for (const C of CARRIERS) {
  const buf = await Bun.file(`${dir}/${C.id}.glb`).arrayBuffer();
  const colours = (await Bun.file(`${dir}/${C.id}.colours.json`).json()) as Record<string, [number, number, number]>;
  const dv = new DataView(buf);
  const jl = dv.getUint32(12, true);
  const J = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const binAt = 20 + jl + 8;
  const view = (bi: number) => {
    const V = J.bufferViews[bi];
    return buf.slice(binAt + (V.byteOffset ?? 0), binAt + (V.byteOffset ?? 0) + V.byteLength);
  };
  const read = (ai: number) => {
    const A = J.accessors[ai];
    const V = J.bufferViews[A.bufferView];
    const c = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[A.type as "SCALAR"]!;
    const off = binAt + (V.byteOffset ?? 0) + (A.byteOffset ?? 0);
    const Arr = A.componentType === 5126 ? Float32Array : A.componentType === 5125 ? Uint32Array : Uint16Array;
    return new Arr(buf.slice(off, off + A.count * c * Arr.BYTES_PER_ELEMENT)) as ArrayLike<number>;
  };
  const imgName = (mi: number) => {
    const t = J.materials[mi].pbrMetallicRoughness?.baseColorTexture?.index;
    return t === undefined ? null : ((J.images[J.textures[t].source].name as string | undefined) ?? null);
  };
  // (each textured material's layer: by its name or its map's)
  const layerOf = (mi: number) => {
    const name = J.materials[mi].name as string,
      img = imgName(mi);
    const k = C.maps.findIndex((m) => m === name || m === img);
    return k < 0 ? -1 : C.layer + k;
  };
  // the maps: from the GLB's images, at 2048²
  for (let k = 0; k < C.maps.length; k++) {
    const mi = J.materials.findIndex((_: unknown, i: number) => layerOf(i) === C.layer + k);
    const t = J.materials[mi].pbrMetallicRoughness.baseColorTexture.index;
    const im = J.images[J.textures[t].source];
    const tmp = `/tmp/carrier-${C.id}-${k}.${im.mimeType === "image/png" ? "png" : "jpg"}`;
    await Bun.write(tmp, view(im.bufferView));
    await Bun.$`sips -s format jpeg -s formatOptions 85 -z 2048 2048 ${tmp} --out ${`${out}/${C.id}-${k}.jpg`}`.quiet();
  }
  // the triangles: their places (glTF: x port, y up, z bow — for this carrier's bow), their parts
  type Tri = { P: number[]; N: number[]; T: number[]; I: number[]; mat: number };
  const tris: Tri[] = [];
  for (const node of J.nodes) {
    if (node.mesh === undefined) continue;
    const t = node.translation ?? [0, 0, 0];
    for (const p of J.meshes[node.mesh].primitives) {
      const mat = J.materials[p.material];
      if (DROP_BLEND && mat.alphaMode === "BLEND") continue;
      const P = read(p.attributes.POSITION),
        N = read(p.attributes.NORMAL),
        I = read(p.indices);
      const T = p.attributes.TEXCOORD_0 !== undefined ? read(p.attributes.TEXCOORD_0) : null;
      tris.push({
        P: Array.from(P, (x, i) => x + t[i % 3]),
        N: Array.from(N),
        T: T ? Array.from(T) : new Array((P.length / 3) * 2).fill(0),
        I: Array.from(I),
        mat: p.material,
      });
    }
  }
  // its frame: its length along z (its bow +z), centred; to its real size
  let zlo = Infinity,
    zhi = -Infinity,
    xlo = Infinity,
    xhi = -Infinity;
  for (const t of tris)
    for (let i = 0; i < t.P.length; i += 3) {
      zlo = Math.min(zlo, t.P[i + 2]!);
      zhi = Math.max(zhi, t.P[i + 2]!);
      xlo = Math.min(xlo, t.P[i]!);
      xhi = Math.max(xhi, t.P[i]!);
    }
  // (the Implacable's bow: the end narrower at its waterline — its stern a round of flight deck over the water)
  let s = C.bow;
  if (s === 0) {
    let ylo = Infinity;
    for (const t of tris) for (let i = 1; i < t.P.length; i += 3) ylo = Math.min(ylo, t.P[i]!);
    const beamAt = (end: number) => {
      let w = 0;
      for (const t of tris)
        for (let i = 0; i < t.P.length; i += 3)
          if (t.P[i + 1]! < ylo + 6 && Math.abs(t.P[i + 2]! - end) < (zhi - zlo) * 0.08)
            w = Math.max(w, Math.abs(t.P[i]! - (xlo + xhi) / 2));
      return w;
    };
    s = beamAt(zhi) < beamAt(zlo) ? 1 : -1;
    console.log(
      `${C.id}: its bow at ${s > 0 ? "+z" : "−z"} (waterline half-beams ${beamAt(zlo).toFixed(1)} / ${beamAt(zhi).toFixed(1)} m)`,
    );
  }
  const k = C.len ? C.len / (zhi - zlo) : 1;
  const cz = (zlo + zhi) / 2,
    cx = (xlo + xhi) / 2;
  // (its flight deck: the height most of its upward faces' area lies at — above its lower quarter: not its flat
  // bottom —; its waterline the freeboard under it)
  let ymin = Infinity,
    ymax = -Infinity;
  for (const t of tris) for (let i = 1; i < t.P.length; i += 3) (ymin = Math.min(ymin, t.P[i]!)), (ymax = Math.max(ymax, t.P[i]!));
  const yFloor = (ymin + 0.25 * (ymax - ymin)) * k;
  const hist = new Map<number, number>();
  for (const t of tris)
    for (let i = 0; i < t.I.length; i += 3) {
      const v = [0, 1, 2].map((j) => t.I[i + j]! * 3);
      const e1 = [0, 1, 2].map((q) => t.P[v[1]! + q]! - t.P[v[0]! + q]!),
        e2 = [0, 1, 2].map((q) => t.P[v[2]! + q]! - t.P[v[0]! + q]!);
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const a = Math.hypot(...n) / 2;
      if (n[1]! / (2 * a + 1e-12) < 0.98) continue;
      const y = Math.round(((t.P[v[0]! + 1]! + t.P[v[1]! + 1]! + t.P[v[2]! + 1]!) / 3) * k * 2) / 2;
      if (y < yFloor) continue;
      hist.set(y, (hist.get(y) ?? 0) + a * k * k);
    }
  // (the Implacable's deck, cambered and lightened, not flat: its height from its side, 22 m over its keel)
  const deckY = "deck" in C ? C.deck : [...hist].sort((a, b) => b[1] - a[1])[0]![0];
  console.log(
    `${C.id}: upward area by height`,
    [...hist]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([y, a]) => `${y} m: ${Math.round(a)} m²`)
      .join(", "),
  );
  const wl = deckY - C.freeboard;
  console.log(
    `${C.id}: ×${k.toFixed(3)}, its flight deck ${deckY.toFixed(1)} m over its model's origin, its waterline ${C.freeboard} m under it`,
  );
  const m: Mesh = { pos: [], nrm: [], uv: [], part: [], idx: [] };
  for (const t of tris) {
    const base = m.pos.length / 3;
    const layer = layerOf(t.mat);
    const col = colours[J.materials[t.mat].name] ?? [0.45, 0.46, 0.47];
    for (let i = 0; i < t.P.length / 3; i++) {
      m.pos.push(s * (t.P[3 * i]! - cx) * k, t.P[3 * i + 1]! * k - wl, s * (t.P[3 * i + 2]! - cz) * k);
      m.nrm.push(s * t.N[3 * i]!, t.N[3 * i + 1]!, s * t.N[3 * i + 2]!);
      if (layer >= 0) {
        m.uv.push(t.T[2 * i]!, t.T[2 * i + 1]!);
        m.part.push(80 + layer);
      } else {
        // (flat: its colour in its UV — r and g in the first, packed, b in the second)
        m.uv.push(Math.round(col[0]! * 255) + Math.round(col[1]! * 255) * 256, col[2]!);
        m.part.push(90);
      }
    }
    for (const i of t.I) m.idx.push(i + base);
  }
  // (the Ford's three arresting wires: steel cables across its landing area, a hand over its deck on their bow
  // springs — game/carrier.ts LANDING.ford.wires, across its axis 8.8° to port)
  if (C.id === "ford") {
    const ang = (8.8 * Math.PI) / 180;
    const ax = [Math.sin(ang), Math.cos(ang)],
      across = [Math.cos(ang), -Math.sin(ang)];
    for (const [wx, wz] of [
      [2.9, -101],
      [5.1, -87],
      [6.9, -75],
    ]) {
      const y = C.freeboard + 0.08;
      const r = 0.035;
      const half = 16;
      const base = m.pos.length / 3;
      const seg = 8;
      for (const e of [-1, 1])
        for (let k = 0; k < seg; k++) {
          const a = (2 * Math.PI * k) / seg;
          const off = [Math.cos(a) * r * ax[0]!, Math.sin(a) * r, Math.cos(a) * r * ax[1]!];
          m.pos.push(wx + across[0]! * half * e + off[0]!, y + off[1]!, wz + across[1]! * half * e + off[2]!);
          m.nrm.push(Math.cos(a) * ax[0]!, Math.sin(a), Math.cos(a) * ax[1]!);
          m.uv.push(Math.round(0.18 * 255) + Math.round(0.18 * 255) * 256, 0.19);
          m.part.push(90);
        }
      for (let k = 0; k < seg; k++) {
        const a0 = base + k,
          a1 = base + ((k + 1) % seg),
          b0 = base + seg + k,
          b1 = base + seg + ((k + 1) % seg);
        m.idx.push(a0, b0, b1, a0, b1, a1);
      }
    }
  }
  await write(C.id, m);
  // its top surface: the highest of its faces over each metre — a ray down from above
  let lo = [Infinity, Infinity],
    hi = [-Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) {
    lo = [Math.min(lo[0]!, m.pos[i]!), Math.min(lo[1]!, m.pos[i + 2]!)];
    hi = [Math.max(hi[0]!, m.pos[i]!), Math.max(hi[1]!, m.pos[i + 2]!)];
  }
  const x0 = Math.floor(lo[0]!) - 1,
    z0 = Math.floor(lo[1]!) - 1;
  const nx = Math.ceil(hi[0]!) + 1 - x0,
    nz = Math.ceil(hi[1]!) + 1 - z0;
  const H = new Float32Array(nx * nz).fill(-1e9);
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = m.idx[i]! * 3,
      b = m.idx[i + 1]! * 3,
      c = m.idx[i + 2]! * 3;
    const ax = m.pos[a]!,
      az = m.pos[a + 2]!,
      bx = m.pos[b]!,
      bz = m.pos[b + 2]!,
      qx = m.pos[c]!,
      qz = m.pos[c + 2]!;
    const det = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
    if (Math.abs(det) < 1e-9) continue;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, qx) - x0)),
      i1 = Math.min(nx - 1, Math.ceil(Math.max(ax, bx, qx) - x0));
    const j0 = Math.max(0, Math.floor(Math.min(az, bz, qz) - z0)),
      j1 = Math.min(nz - 1, Math.ceil(Math.max(az, bz, qz) - z0));
    for (let jj = j0; jj <= j1; jj++)
      for (let ii = i0; ii <= i1; ii++) {
        const px = x0 + ii + 0.5,
          pz = z0 + jj + 0.5;
        const l1 = ((bz - qz) * (px - qx) + (qx - bx) * (pz - qz)) / det;
        const l2 = ((qz - az) * (px - qx) + (ax - qx) * (pz - qz)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
        const y = l1 * m.pos[a + 1]! + l2 * m.pos[b + 1]! + l3 * m.pos[c + 1]!;
        if (y > H[jj * nx + ii]!) H[jj * nx + ii] = y;
      }
  }
  // "DECK", the grid (nx, nz), its corner and cell [m], the flight deck's height [m], then the heights [cm] (int16:
  // −32768 none — the sea)
  const db = new ArrayBuffer(32 + nx * nz * 2);
  new Uint8Array(db, 0, 4).set(new TextEncoder().encode("DECK"));
  const hd = new DataView(db);
  hd.setUint32(4, nx, true);
  hd.setUint32(8, nz, true);
  hd.setFloat32(12, x0, true);
  hd.setFloat32(16, z0, true);
  hd.setFloat32(20, 1, true);
  hd.setFloat32(24, C.freeboard, true);
  const hs = new Int16Array(db, 32, nx * nz);
  for (let i = 0; i < nx * nz; i++) hs[i] = H[i]! < -1e8 ? -32768 : Math.max(-32767, Math.min(32767, Math.round(H[i]! * 100)));
  await Bun.write(`${out}/${C.id}.deck.bin`, db);
  console.log(`${C.id}: its deck map ${nx} × ${nz} m`);
}
