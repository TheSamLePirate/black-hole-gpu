// J9-2: build shared geometry in Bun, never in the image loop.
// Packs 24 models: the 12 full near models (LOD 0) followed by the 12 structured tuft/limb LOD 1 models.
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { encodeTreeAssets, type TreeAssetModel, TREE_ASSET_FORMAT, TREE_VERTEX_FLOATS } from "../src/vegetation/tree-assets";
import { TREE_ASPECTS, TREE_MODEL_KINDS, type TreeMesh, treeModel } from "../src/vegetation/tree-model";

await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);

function leafMaskCpu(u: number, v: number, kind: number): boolean {
  const cx = u * 2 - 1,
    cy = v * 2 - 1;
  if (kind === 2 || kind === 4) {
    const t = cy * 3.5 + 0.5 * cx * cx;
    const blades = Math.abs(t - Math.floor(t) - 0.5);
    return blades < 0.32 * (1 - cx * cx) && Math.abs(cx) < 0.98;
  }
  for (let i = 0; i < 5; i++) {
    const a = i * 1.2566 + 0.3;
    const ca = Math.cos(a),
      sa = Math.sin(a);
    const dx = cx - ca * 0.42,
      dy = cy - sa * 0.42;
    const along = dx * ca + dy * sa,
      across = -dx * sa + dy * ca;
    if ((along * along) / 0.2 + (across * across) / 0.07 < 1) return true;
  }
  return cx * cx + cy * cy < 0.12;
}

function orthoMask(m: TreeMesh, kind: number, view: "side" | "top", N = 72): Uint8Array {
  const grid = new Uint8Array(N * N);
  const R = m.radius;
  for (let t = 0; t < m.index.length; t += 3) {
    const i0 = m.index[t]!,
      i1 = m.index[t + 1]!,
      i2 = m.index[t + 2]!;
    const x0 = view === "side" ? m.pos[i0 * 3 + 1]! / R : m.pos[i0 * 3]! / R;
    const y0 = view === "side" ? m.pos[i0 * 3 + 2]! * 2 - 1 : m.pos[i0 * 3 + 1]! / R;
    const x1 = view === "side" ? m.pos[i1 * 3 + 1]! / R : m.pos[i1 * 3]! / R;
    const y1 = view === "side" ? m.pos[i1 * 3 + 2]! * 2 - 1 : m.pos[i1 * 3 + 1]! / R;
    const x2 = view === "side" ? m.pos[i2 * 3 + 1]! / R : m.pos[i2 * 3]! / R;
    const y2 = view === "side" ? m.pos[i2 * 3 + 2]! * 2 - 1 : m.pos[i2 * 3 + 1]! / R;
    const gx0 = (x0 + 1) * 0.5 * N,
      gy0 = (y0 + 1) * 0.5 * N;
    const gx1 = (x1 + 1) * 0.5 * N,
      gy1 = (y1 + 1) * 0.5 * N;
    const gx2 = (x2 + 1) * 0.5 * N,
      gy2 = (y2 + 1) * 0.5 * N;
    const minX = Math.max(0, Math.floor(Math.min(gx0, gx1, gx2))),
      maxX = Math.min(N - 1, Math.ceil(Math.max(gx0, gx1, gx2)));
    const minY = Math.max(0, Math.floor(Math.min(gy0, gy1, gy2))),
      maxY = Math.min(N - 1, Math.ceil(Math.max(gy0, gy1, gy2)));
    const den = (gy1 - gy2) * (gx0 - gx2) + (gx2 - gx1) * (gy0 - gy2);
    if (Math.abs(den) < 1e-8) continue;
    const leaf = m.attr[i0 * 4 + 2]! > 0.5;
    const u0 = m.attr[i0 * 4]!,
      v0 = m.attr[i0 * 4 + 1]!;
    const u1 = m.attr[i1 * 4]!,
      v1 = m.attr[i1 * 4 + 1]!;
    const u2 = m.attr[i2 * 4]!,
      v2 = m.attr[i2 * 4 + 1]!;
    for (let py = minY; py <= maxY; py++) {
      const cy = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        if (grid[py * N + px]) continue;
        const cx = px + 0.5;
        const w0 = ((gy1 - gy2) * (cx - gx2) + (gx2 - gx1) * (cy - gy2)) / den;
        const w1 = ((gy2 - gy0) * (cx - gx2) + (gx0 - gx2) * (cy - gy2)) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        if (leaf && !leafMaskCpu(w0 * u0 + w1 * u1 + w2 * u2, w0 * v0 + w1 * v1 + w2 * v2, kind)) continue;
        grid[py * N + px] = 1;
      }
    }
  }
  return grid;
}

function packModel(kind: number, aspect: number, lod: 0 | 1, m: TreeMesh, error: number): TreeAssetModel {
  const indices = m.index.slice();
  const [remap, count] = MeshoptEncoder.reorderMesh(indices, true, false);
  const vertices = new Float32Array(count * TREE_VERTEX_FLOATS);
  for (let i = 0; i < remap.length; i++) {
    const to = remap[i]!;
    if (to === 0xffffffff) continue;
    vertices.set(m.pos.subarray(i * 3, i * 3 + 3), to * TREE_VERTEX_FLOATS);
    vertices.set(m.nrm.subarray(i * 3, i * 3 + 3), to * TREE_VERTEX_FLOATS + 3);
    vertices.set(m.attr.subarray(i * 4, i * 4 + 4), to * TREE_VERTEX_FLOATS + 6);
  }
  const lo: [number, number, number] = [Infinity, Infinity, Infinity],
    hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++)
    for (let a = 0; a < 3; a++) {
      const x = vertices[i * TREE_VERTEX_FLOATS + a]!;
      lo[a] = Math.min(lo[a]!, x);
      hi[a] = Math.max(hi[a]!, x);
    }
  return { kind, aspect, lod, error, radius: m.radius, vertices, indices, bounds: { lo, hi } };
}

const lod0Models: TreeAssetModel[] = [];
const lod1Models: TreeAssetModel[] = [];
const barkLodStudy: { kind: number; aspect: number; sourceTriangles: number; trialTriangles: number; absoluteError: number }[] = [];
const lodStudy: {
  kind: number;
  aspect: number;
  lod0Triangles: number;
  lod1Triangles: number;
  reductionPct: number;
  sideCoverage0: number;
  sideCoverage1: number;
  topCoverage0: number;
  topCoverage1: number;
  canonicalError: number;
}[] = [];

for (const kind of TREE_MODEL_KINDS)
  for (const aspect of TREE_ASPECTS[kind]!) {
    const m0 = treeModel(kind, aspect, 1, 0),
      m1 = treeModel(kind, aspect, 1, 1),
      barkCount = m0.segments * 30;
    const [bark, error] = MeshoptSimplifier.simplify(m0.index.slice(0, barkCount), m0.pos, 3, Math.floor((barkCount * 0.5) / 3) * 3, 0.002);
    barkLodStudy.push({
      kind,
      aspect,
      sourceTriangles: m0.index.length / 3,
      trialTriangles: (bark.length + m0.index.length - barkCount) / 3,
      absoluteError: error * MeshoptSimplifier.getScale(m0.pos, 3),
    });
    const side0 = orthoMask(m0, kind, "side"),
      side1 = orthoMask(m1, kind, "side"),
      top0 = orthoMask(m0, kind, "top"),
      top1 = orthoMask(m1, kind, "top");
    const cov = (g: Uint8Array) => g.reduce((a, b) => a + b, 0) / g.length;
    const s0 = cov(side0),
      s1 = cov(side1),
      t0 = cov(top0),
      t1 = cov(top1);
    const canonicalError = Number((0.032 * m0.radius + 0.008 * Math.abs(s1 - s0)).toFixed(5));
    lodStudy.push({
      kind,
      aspect,
      lod0Triangles: m0.index.length / 3,
      lod1Triangles: m1.index.length / 3,
      reductionPct: Number(((1 - m1.index.length / m0.index.length) * 100).toFixed(1)),
      sideCoverage0: Number(s0.toFixed(4)),
      sideCoverage1: Number(s1.toFixed(4)),
      topCoverage0: Number(t0.toFixed(4)),
      topCoverage1: Number(t1.toFixed(4)),
      canonicalError,
    });
    lod0Models.push(packModel(kind, aspect, 0, m0, 0));
    lod1Models.push(packModel(kind, aspect, 1, m1, canonicalError));
  }

const models = [...lod0Models, ...lod1Models];
const sourceHash = new Bun.CryptoHasher("sha256");
for (const path of [
  "src/vegetation/tree-model.ts",
  "src/vegetation/tree-leaf.ts",
  "src/vegetation/tree-assets.ts",
  "scripts/build-tree-assets.ts",
]) {
  sourceHash.update(path);
  sourceHash.update(await Bun.file(path).arrayBuffer());
}
const bytes = encodeTreeAssets(models),
  zip = Bun.gzipSync(bytes, { level: 9 });
const out = process.argv[2] ?? "assets/vegetation/trees-v1";
const generation = sourceHash.digest("hex");
const binaryPath = `${out}-${generation.slice(0, 16)}.bin`;
await Bun.write(binaryPath, zip);
if (!process.argv[2])
  await Bun.write(
    "src/vegetation/tree-asset-url.ts",
    `// Generated by scripts/build-tree-assets.ts; content-addressed geometry.
import url from "../../${binaryPath}" with { type: "file" };
export default url;
`,
  );
const manifest = {
  format: TREE_ASSET_FORMAT,
  sourceSha256: generation,
  file: binaryPath.split("/").pop()!,
  sha256: new Bun.CryptoHasher("sha256").update(zip).digest("hex"),
  meshoptimizer: "1.3.0",
  compression: "gzip",
  rawBytes: bytes.byteLength,
  bytes: zip.byteLength,
  barkLodStudy,
  lodStudy,
  models: models.map(({ vertices, indices, ...m }) => ({
    ...m,
    vertices: vertices.length / TREE_VERTEX_FLOATS,
    triangles: indices.length / 3,
  })),
};
await Bun.write(`${out}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    out,
    rawBytes: bytes.byteLength,
    bytes: zip.byteLength,
    lodStudy,
  }),
);
