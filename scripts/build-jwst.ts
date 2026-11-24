// Builds assets/jwst/jwst.bin from assets/jwst/scene.gltf + assets/jwst/scene.bin.
// Pure Bun/TypeScript — no Blender required.
//
// Source model: "The James Webb Space Telescope" by Ignazio Pillitteri (@gnaz),
// https://sketchfab.com/3d-models/the-james-webb-space-telescope-dcb95b3193be49e7a60192055df2315d — licensed CC BY 4.0
// (https://creativecommons.org/licenses/by/4.0/): jwst.bin is a derived work under the same licence, its credit due
// wherever it is shown. To rebuild: on that page, "Download 3D Model" → glTF (a free Sketchfab account), unzip
// `scene.gltf` and `scene.bin` into assets/jwst/ (ignored by git: .gitignore — never committed; the textures are not
// used), then `bun scripts/build-jwst.ts`.
//
// What it does: the scene's hierarchy flattened into one mesh in the model's own axes and units (metres; no rotation:
// the glTF already has the sunshield's normal along Y, its Sun side −Y), centred on its bounding box; each vertex
// given a surface kind and an sRGB colour (classifyMaterial); then the vertices byte-identical once packed (position,
// quantised normal, colour) welded and the mesh reordered for the vertex cache and the vertex fetch (meshoptimizer
// `reorderMesh`, devDependency 1.3.0) — the same image, fewer vertices shaded.
//
// Binary format (little endian, gzipped):
//   "JWST" (4 bytes)
//   u32 version = 1
//   u32 vertexCount
//   u32 indexCount
//   f32 boundingRadius [m]
//   vertices: vertexCount × 24 bytes:
//     pos:    3 × f32 [m] (centred around model origin; -Y faces Sun, +Y cold mirror side, +Z mirror boresight:
//             the primary's 6.5 m disc lies in x–y at z ≈ 1.8 m, the secondary on its struts at z ≈ 4.9 m — read from
//             jwst.bin by the kinds and positions, 2026-11-24)
//     normal: 4 × snorm8
//     color:  4 × unorm8 (sRGB rgb, alpha = surface kind: 0 hull/structure, 1 gold mirror, 2 Kapton foil, 3 solar array)
//     part:   4 × u8 (0, 0, 0, 0)
//   indices: indexCount × u32

import { gzipSync } from "bun";
import { MeshoptEncoder } from "meshoptimizer";

const SRC_GLTF = "assets/jwst/scene.gltf";
const SRC_BIN = "assets/jwst/scene.bin";
const OUT_BIN = "assets/jwst/jwst.bin";

interface Gltf {
  scenes: { nodes: number[] }[];
  nodes: {
    name?: string;
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes: {
    name?: string;
    primitives: {
      attributes: Record<string, number>;
      indices?: number;
      material?: number;
      mode?: number;
    }[];
  }[];
  materials?: {
    name?: string;
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      metallicFactor?: number;
      roughnessFactor?: number;
    };
  }[];
  accessors: {
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
  }[];
  bufferViews: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }[];
}

function matMul(a: Float64Array, b: Float64Array): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r]! * b[c * 4 + 0]! + a[1 * 4 + r]! * b[c * 4 + 1]! + a[2 * 4 + r]! * b[c * 4 + 2]! + a[3 * 4 + r]! * b[c * 4 + 3]!;
    }
  }
  return o;
}

function nodeMat(n: Gltf["nodes"][number]): Float64Array {
  if (n.matrix) return Float64Array.from(n.matrix);
  const t = n.translation ?? [0, 0, 0];
  const s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  return Float64Array.from([
    (1 - 2 * (y! * y! + z! * z!)) * s[0]!,
    2 * (x! * y! + z! * w!) * s[0]!,
    2 * (x! * z! - y! * w!) * s[0]!,
    0,
    2 * (x! * y! - z! * w!) * s[1]!,
    (1 - 2 * (x! * x! + z! * z!)) * s[1]!,
    2 * (y! * z! + x! * w!) * s[1]!,
    0,
    2 * (x! * z! + y! * w!) * s[2]!,
    2 * (y! * z! - x! * w!) * s[2]!,
    (1 - 2 * (x! * x! + y! * y!)) * s[2]!,
    0,
    t[0]!,
    t[1]!,
    t[2]!,
    1,
  ]);
}

function linearToSrgb(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** Classifies JWST glTF materials into rich physically-based surface kinds and tuned colors. */
function classifyMaterial(name: string, baseLinear: readonly number[]): { srgb: [number, number, number]; kind: number } {
  const n = name.toLowerCase();
  // 1: 24k gold-coated beryllium primary mirror & gold optical reflector surfaces
  if (n.includes("topreflector") || n.includes("gold") || n.includes("mirror")) {
    // Rich NASA JWST 24k gold reflectance (sRGB)
    return {
      srgb: n.includes("mirror-sm") ? [0.98, 0.78, 0.24] : [0.96, 0.74, 0.22],
      kind: 1,
    };
  }
  // 3: Solar panel array on the sun-facing bus
  if (n.includes("solarpanel")) {
    return { srgb: [0.18, 0.26, 0.62], kind: 3 };
  }
  // 2: 5-layer Kapton sunshield foils & silver/purple MLI blankets
  if (n.includes("foillayer") || n.includes("foilbase") || n.includes("silverfoil") || n.includes("purpley") || n.includes("silver")) {
    if (n.includes("purpley")) {
      // Sun-facing Layer 5 silicon-coated Kapton (iconic pinkish-lavender metallic sheen)
      return { srgb: [0.76, 0.56, 0.74], kind: 2 };
    }
    if (n.includes("foillayer")) {
      // Cold aluminium-coated Kapton layers 1–4 (bright silver mirror foil)
      return { srgb: [0.88, 0.89, 0.91], kind: 2 };
    }
    return {
      srgb: [linearToSrgb(baseLinear[0] ?? 0.75), linearToSrgb(baseLinear[1] ?? 0.75), linearToSrgb(baseLinear[2] ?? 0.75)],
      kind: 2,
    };
  }
  // 0: carbon-fiber booms, optical bench, radiator, structural brackets
  return {
    srgb: [linearToSrgb(baseLinear[0] ?? 0.35), linearToSrgb(baseLinear[1] ?? 0.35), linearToSrgb(baseLinear[2] ?? 0.35)],
    kind: 0,
  };
}

async function main() {
  const gltf: Gltf = JSON.parse(await Bun.file(SRC_GLTF).text());
  const bin = new Uint8Array(await Bun.file(SRC_BIN).arrayBuffer());
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

  // Collect raw vertices & indices across the scene hierarchy
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = []; // 4 u8 per vertex
  const indices: number[] = [];

  const I = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  function walk(ni: number, pm: Float64Array) {
    const node = gltf.nodes[ni]!;
    const m = matMul(pm, nodeMat(node));
    // Normal matrix (upper-left 3x3; fine for rigid + uniform scale)
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes[node.mesh]!;
      for (const prim of mesh.primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;
        const pAcc = gltf.accessors[prim.attributes.POSITION!]!;
        const pBv = gltf.bufferViews[pAcc.bufferView]!;
        const pOff = (pBv.byteOffset ?? 0) + (pAcc.byteOffset ?? 0);
        const pStride = pBv.byteStride ?? 12;

        const nAcc = prim.attributes.NORMAL !== undefined ? gltf.accessors[prim.attributes.NORMAL] : undefined;
        const nBv = nAcc ? gltf.bufferViews[nAcc.bufferView] : undefined;
        const nOff = nAcc && nBv ? (nBv.byteOffset ?? 0) + (nAcc.byteOffset ?? 0) : 0;
        const nStride = nBv?.byteStride ?? 12;

        const mat = prim.material !== undefined ? gltf.materials?.[prim.material] : undefined;
        const { srgb, kind } = classifyMaterial(mat?.name ?? "", mat?.pbrMetallicRoughness?.baseColorFactor ?? [0.7, 0.7, 0.7, 1]);
        const cr = Math.round(srgb[0] * 255);
        const cg = Math.round(srgb[1] * 255);
        const cb = Math.round(srgb[2] * 255);

        const baseVertex = positions.length / 3;
        for (let i = 0; i < pAcc.count; i++) {
          const px = dv.getFloat32(pOff + i * pStride, true);
          const py = dv.getFloat32(pOff + i * pStride + 4, true);
          const pz = dv.getFloat32(pOff + i * pStride + 8, true);
          const wx = m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!;
          const wy = m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!;
          const wz = m[2]! * px + m[6]! * py + m[10]! * pz + m[14]!;
          positions.push(wx, wy, wz);

          let nx = 0,
            ny = 1,
            nz = 0;
          if (nAcc) {
            const rnx = dv.getFloat32(nOff + i * nStride, true);
            const rny = dv.getFloat32(nOff + i * nStride + 4, true);
            const rnz = dv.getFloat32(nOff + i * nStride + 8, true);
            nx = m[0]! * rnx + m[4]! * rny + m[8]! * rnz;
            ny = m[1]! * rnx + m[5]! * rny + m[9]! * rnz;
            nz = m[2]! * rnx + m[6]! * rny + m[10]! * rnz;
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl;
            ny /= nl;
            nz /= nl;
          }
          normals.push(nx, ny, nz);
          colors.push(cr, cg, cb, kind);
        }

        if (prim.indices !== undefined) {
          const iAcc = gltf.accessors[prim.indices]!;
          const iBv = gltf.bufferViews[iAcc.bufferView]!;
          const iOff = (iBv.byteOffset ?? 0) + (iAcc.byteOffset ?? 0);
          for (let i = 0; i < iAcc.count; i++) {
            let idx = 0;
            if (iAcc.componentType === 5125) idx = dv.getUint32(iOff + i * 4, true);
            else if (iAcc.componentType === 5123) idx = dv.getUint16(iOff + i * 2, true);
            else idx = dv.getUint8(iOff + i);
            indices.push(baseVertex + idx);
          }
        } else {
          for (let i = 0; i < pAcc.count; i++) indices.push(baseVertex + i);
        }
      }
    }
    for (const ch of node.children ?? []) walk(ch, m);
  }

  for (const r of gltf.scenes[0]!.nodes) walk(r, I);

  // Centre around bounding-box midpoint so the model's origin is its geometric centre
  const nv = positions.length / 3;
  const ni = indices.length;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = positions[3 * i]!,
      y = positions[3 * i + 1]!,
      z = positions[3 * i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  let reach = 0;
  for (let i = 0; i < nv; i++) {
    positions[3 * i] = positions[3 * i]! - cx;
    positions[3 * i + 1] = positions[3 * i + 1]! - cy;
    positions[3 * i + 2] = positions[3 * i + 2]! - cz;
    const r = Math.hypot(positions[3 * i]!, positions[3 * i + 1]!, positions[3 * i + 2]!);
    if (r > reach) reach = r;
  }

  // Pack binary: 20-byte header + nv * 24 bytes vertices + ni * 4 bytes indices
  const HEADER = 20;
  const STRIDE = 24;
  const raw = new ArrayBuffer(HEADER + nv * STRIDE + ni * 4);
  const outU8 = new Uint8Array(raw);
  const outDv = new DataView(raw);
  outU8.set([74, 87, 83, 84], 0); // "JWST"
  outDv.setUint32(4, 1, true);
  outDv.setUint32(8, nv, true);
  outDv.setUint32(12, ni, true);
  outDv.setFloat32(16, reach, true);

  const snorm8 = (x: number) => Math.max(-127, Math.min(127, Math.round(x * 127)));
  for (let i = 0; i < nv; i++) {
    const o = HEADER + i * STRIDE;
    outDv.setFloat32(o, positions[3 * i]!, true);
    outDv.setFloat32(o + 4, positions[3 * i + 1]!, true);
    outDv.setFloat32(o + 8, positions[3 * i + 2]!, true);
    outDv.setInt8(o + 12, snorm8(normals[3 * i]!));
    outDv.setInt8(o + 13, snorm8(normals[3 * i + 1]!));
    outDv.setInt8(o + 14, snorm8(normals[3 * i + 2]!));
    outDv.setInt8(o + 15, 0);
    outU8[o + 16] = colors[4 * i]!;
    outU8[o + 17] = colors[4 * i + 1]!;
    outU8[o + 18] = colors[4 * i + 2]!;
    outU8[o + 19] = colors[4 * i + 3]!;
    // part u8x4 = 0
  }
  // the vertices identical once packed, welded (the glTF repeats them per face and per primitive)
  const weld = new Map<string, number>();
  const firstOf: number[] = [];
  const welded = new Uint32Array(ni);
  const vtx = (i: number) => outU8.subarray(HEADER + i * STRIDE, HEADER + (i + 1) * STRIDE);
  for (let k = 0; k < ni; k++) {
    const i = indices[k]!;
    const key = String.fromCharCode(...vtx(i));
    let to = weld.get(key);
    if (to === undefined) {
      to = firstOf.length;
      weld.set(key, to);
      firstOf.push(i);
    }
    welded[k] = to;
  }
  // the triangles ordered for the vertex cache, the vertices for their fetch (meshoptimizer)
  await MeshoptEncoder.ready;
  const [remap, nOut] = MeshoptEncoder.reorderMesh(welded, true, false);
  const final = new ArrayBuffer(HEADER + nOut * STRIDE + ni * 4);
  const fU8 = new Uint8Array(final);
  const fDv = new DataView(final);
  fU8.set(outU8.subarray(0, HEADER), 0);
  fDv.setUint32(8, nOut, true);
  for (let w = 0; w < firstOf.length; w++) {
    const to = remap[w]!;
    if (to !== 0xffffffff) fU8.set(vtx(firstOf[w]!), HEADER + to * STRIDE);
  }
  const idxOff = HEADER + nOut * STRIDE;
  for (let i = 0; i < ni; i++) fDv.setUint32(idxOff + i * 4, welded[i]!, true);

  const gz = gzipSync(new Uint8Array(final), { level: 9 });
  await Bun.write(OUT_BIN, gz);
  console.log(
    `JWST built: ${nv.toLocaleString()} verts read, ${nOut.toLocaleString()} once welded and reordered, ${(ni / 3).toLocaleString()} tris, ` +
      `reach ${reach.toFixed(2)} m, size ${(maxX - minX).toFixed(2)} × ${(maxY - minY).toFixed(2)} × ${(maxZ - minZ).toFixed(2)} m, ` +
      `raw ${(final.byteLength / 1e6).toFixed(2)} MB -> gz ${(gz.byteLength / 1e6).toFixed(2)} MB (${OUT_BIN})`,
  );
}

await main();
