// J9: prepared shared tree geometry. All offsets are bytes, little-endian, canonical z-up frame (height 1).
// Meshoptimizer belongs to the build only; the runtime codec has no simplification or WASM dependency.
//
// Format 2 (review of 24 Nov 2026): GPU-ready and quantised — one vertex blob and one index blob, laid out in the order the
// renderer uploads them, so the runtime makes views and uploads (no concatenation, no per-model copy):
//   vertex (16 B): position unorm16 × 4 within the asset's common box (lo + ext × q; w unused), normal snorm16 × 2
//   (octahedral), attributes unorm8 × 4 (u, v, material 0 bark / 1 leaf, shade) — WebGPU formats unorm16x4, snorm16x2,
//   unorm8x4, read as they are by the vertex stage;
//   index: uint16, local to its model (every model < 65 536 vertices; drawn with its baseVertex), the blob padded to 4 bytes.
// Format 1 (40 B float32 vertices, uint32 indices: 9.5 MB raw) is retired; its file is gone with it.
export const TREE_ASSET_FORMAT = 2;
/** a source vertex: position 3, normal 3, attributes 4 (the build's float input, before quantisation) */
export const TREE_VERTEX_FLOATS = 10;
export const TREE_VERTEX_BYTES = 16;
const MAGIC = 0x3147544b; // KTG1 (the container; its format word says 2)
const HEADER = 64;
const RECORD = 64;
const MAX_BYTES = 64 * 1024 * 1024;

/** a model as the build makes it: float vertices (TREE_VERTEX_FLOATS each), model-local indices */
export interface TreeAssetModel {
  kind: number;
  aspect: number;
  lod: number;
  /** Absolute canonical geometric error for the bark; leaf cards are unchanged. */
  error: number;
  radius: number;
  vertices: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
  bounds: { lo: [number, number, number]; hi: [number, number, number] };
}
/** a model's record in the packed asset: its range in the shared blobs */
export interface PackedTreeModel {
  kind: number;
  aspect: number;
  lod: number;
  error: number;
  radius: number;
  vertexCount: number;
  indexCount: number;
  /** first vertex in the vertex blob (the draw's baseVertex) */
  baseVertex: number;
  /** first index in the index blob (the draw's firstIndex) */
  firstIndex: number;
  bounds: { lo: [number, number, number]; hi: [number, number, number] };
}
export interface PackedTreeAssets {
  /** the common quantisation box: position = lo + ext × unorm16 */
  lo: [number, number, number];
  ext: [number, number, number];
  models: PackedTreeModel[];
  /** TREE_VERTEX_BYTES per vertex, every model's in record order */
  vertices: Uint8Array<ArrayBuffer>;
  /** model-local uint16 indices, every model's in record order, padded to an even count */
  indices: Uint16Array<ArrayBuffer>;
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
/** a unit normal on the octahedron, folded to the square [−1, 1]² */
export function octEncode(x: number, y: number, z: number): [number, number] {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let ox = x / l,
    oy = y / l;
  if (z < 0) {
    const fx = (1 - Math.abs(oy)) * (ox >= 0 ? 1 : -1);
    const fy = (1 - Math.abs(ox)) * (oy >= 0 ? 1 : -1);
    ox = fx;
    oy = fy;
  }
  return [ox, oy];
}
export function octDecode(ox: number, oy: number): [number, number, number] {
  let x = ox,
    y = oy;
  const z = 1 - Math.abs(x) - Math.abs(y);
  const t = Math.max(-z, 0);
  x += x >= 0 ? -t : t;
  y += y >= 0 ? -t : t;
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
/** one source vertex quantised into its 16 bytes at `at` of `out` */
export function quantizeVertex(
  out: DataView,
  at: number,
  lo: readonly number[],
  ext: readonly number[],
  v: ArrayLike<number>,
  o = 0,
): void {
  for (let a = 0; a < 3; a++) out.setUint16(at + a * 2, Math.round(clamp01((v[o + a]! - lo[a]!) / ext[a]!) * 65535), true);
  out.setUint16(at + 6, 0, true);
  const [ox, oy] = octEncode(v[o + 3]!, v[o + 4]!, v[o + 5]!);
  out.setInt16(at + 8, Math.round(Math.max(-1, Math.min(1, ox)) * 32767), true);
  out.setInt16(at + 10, Math.round(Math.max(-1, Math.min(1, oy)) * 32767), true);
  for (let a = 0; a < 4; a++) out.setUint8(at + 12 + a, Math.round(clamp01(v[o + 6 + a]!) * 255));
}
/** a packed vertex back to floats (position 3, normal 3, attributes 4) — what the vertex stage reads */
export function dequantizeVertex(p: PackedTreeAssets, i: number): number[] {
  const v = new DataView(p.vertices.buffer, p.vertices.byteOffset + i * TREE_VERTEX_BYTES, TREE_VERTEX_BYTES);
  const pos = [0, 1, 2].map((a) => p.lo[a]! + p.ext[a]! * (v.getUint16(a * 2, true) / 65535));
  const n = octDecode(Math.max(v.getInt16(8, true) / 32767, -1), Math.max(v.getInt16(10, true) / 32767, -1));
  const attr = [0, 1, 2, 3].map((a) => v.getUint8(12 + a) / 255);
  return [...pos, ...n, ...attr];
}

function validateSource(m: TreeAssetModel) {
  const n = m.vertices.length / TREE_VERTEX_FLOATS;
  if (
    !Number.isInteger(n) ||
    n < 1 ||
    n > 65536 ||
    m.indices.length % 3 ||
    m.indices.length < 3 ||
    !Number.isInteger(m.kind) ||
    m.kind < 1 ||
    m.kind > 6 ||
    !Number.isInteger(m.lod) ||
    m.lod < 0 ||
    m.lod > 15 ||
    !(m.aspect > 0) ||
    !Number.isFinite(m.aspect) ||
    !(m.radius > 0) ||
    !Number.isFinite(m.radius) ||
    !Number.isFinite(m.error) ||
    m.error < 0
  )
    throw new Error("Invalid tree asset model");
  for (const x of m.vertices) if (!Number.isFinite(x)) throw new Error("Non-finite tree vertex");
  for (let i = 0; i < n; i++)
    for (let a = 0; a < 4; a++) {
      const x = m.vertices[i * TREE_VERTEX_FLOATS + 6 + a]!;
      if (x < 0 || x > 1) throw new Error("Tree attribute outside [0, 1]");
    }
  for (const i of m.indices) if (i >= n) throw new Error("Tree index out of range");
}
/** the build's float models quantised into one GPU-ready asset (record order kept) */
export function packTreeAssets(models: TreeAssetModel[]): PackedTreeAssets {
  if (!models.length || models.length > 128) throw new Error("Invalid tree asset count");
  const keys = new Set<string>();
  const lo: [number, number, number] = [Infinity, Infinity, Infinity],
    hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const m of models) {
    validateSource(m);
    const key = `${m.kind}/${m.aspect}/${m.lod}`;
    if (keys.has(key)) throw new Error("Duplicate tree model");
    keys.add(key);
    for (let i = 0; i < m.vertices.length; i += TREE_VERTEX_FLOATS)
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a]!, m.vertices[i + a]!);
        hi[a] = Math.max(hi[a]!, m.vertices[i + a]!);
      }
  }
  // (the box as the file stores it — float32 —: the quantisation and the reader's decoding the same numbers)
  const ext = [0, 1, 2].map((a) => Math.fround(Math.max(hi[a]! - lo[a]!, 1e-6) * (1 + 1e-6))) as [number, number, number];
  for (let a = 0; a < 3; a++) lo[a] = Math.fround(lo[a]!);
  const nv = models.reduce((s, m) => s + m.vertices.length / TREE_VERTEX_FLOATS, 0);
  const ni = models.reduce((s, m) => s + m.indices.length, 0);
  const vertices = new Uint8Array(nv * TREE_VERTEX_BYTES);
  const indices = new Uint16Array(ni + (ni & 1));
  const dv = new DataView(vertices.buffer);
  const out: PackedTreeModel[] = [];
  let bv = 0,
    fi = 0;
  for (const m of models) {
    const n = m.vertices.length / TREE_VERTEX_FLOATS;
    for (let i = 0; i < n; i++) quantizeVertex(dv, (bv + i) * TREE_VERTEX_BYTES, lo, ext, m.vertices, i * TREE_VERTEX_FLOATS);
    indices.set(m.indices, fi);
    out.push({
      kind: m.kind,
      aspect: m.aspect,
      lod: m.lod,
      error: m.error,
      radius: m.radius,
      vertexCount: n,
      indexCount: m.indices.length,
      baseVertex: bv,
      firstIndex: fi,
      bounds: { lo: [...m.bounds.lo], hi: [...m.bounds.hi] },
    });
    bv += n;
    fi += m.indices.length;
  }
  return { lo, ext, models: out, vertices, indices };
}

export function encodeTreeAssets(p: PackedTreeAssets): Uint8Array<ArrayBuffer> {
  const count = p.models.length;
  if (!count || count > 128) throw new Error("Invalid tree asset count");
  const vOff = HEADER + count * RECORD;
  const iOff = vOff + p.vertices.byteLength;
  const size = iOff + p.indices.byteLength;
  if (size > MAX_BYTES) throw new Error("Tree assets exceed budget");
  const bytes = new Uint8Array(size),
    v = new DataView(bytes.buffer);
  v.setUint32(0, MAGIC, true);
  v.setUint32(4, TREE_ASSET_FORMAT, true);
  v.setUint32(8, count, true);
  v.setUint32(12, size, true);
  for (let a = 0; a < 3; a++) {
    v.setFloat32(16 + a * 4, p.lo[a]!, true);
    v.setFloat32(28 + a * 4, p.ext[a]!, true);
  }
  v.setUint32(40, vOff, true);
  v.setUint32(44, p.vertices.byteLength / TREE_VERTEX_BYTES, true);
  v.setUint32(48, iOff, true);
  v.setUint32(52, p.indices.length, true);
  const keys = new Set<string>();
  for (const [i, m] of p.models.entries()) {
    const key = `${m.kind}/${m.aspect}/${m.lod}`;
    if (keys.has(key)) throw new Error("Duplicate tree model");
    keys.add(key);
    const r = HEADER + i * RECORD;
    v.setUint32(r, m.kind, true);
    v.setUint32(r + 4, m.lod, true);
    v.setFloat32(r + 8, m.aspect, true);
    v.setFloat32(r + 12, m.error, true);
    v.setFloat32(r + 16, m.radius, true);
    v.setUint32(r + 20, m.vertexCount, true);
    v.setUint32(r + 24, m.indexCount, true);
    v.setUint32(r + 28, m.baseVertex, true);
    v.setUint32(r + 32, m.firstIndex, true);
    for (let a = 0; a < 3; a++) {
      v.setFloat32(r + 36 + a * 4, m.bounds.lo[a]!, true);
      v.setFloat32(r + 48 + a * 4, m.bounds.hi[a]!, true);
    }
  }
  bytes.set(p.vertices, vOff);
  bytes.set(new Uint8Array(p.indices.buffer, p.indices.byteOffset, p.indices.byteLength), iOff);
  return bytes;
}

/** Input is the decompressed response body (util/inflate.ts); the blobs are views of it (no copy). */
export function decodeTreeAssets(buffer: ArrayBuffer): PackedTreeAssets {
  if (buffer.byteLength < HEADER || buffer.byteLength > MAX_BYTES) throw new Error("Invalid tree asset size");
  const v = new DataView(buffer),
    count = v.getUint32(8, true);
  if (
    v.getUint32(0, true) !== MAGIC ||
    v.getUint32(4, true) !== TREE_ASSET_FORMAT ||
    v.getUint32(12, true) !== buffer.byteLength ||
    !count ||
    count > 128
  )
    throw new Error("Invalid tree asset header");
  const vOff = v.getUint32(40, true),
    nv = v.getUint32(44, true),
    iOff = v.getUint32(48, true),
    ni = v.getUint32(52, true);
  if (vOff !== HEADER + count * RECORD || iOff !== vOff + nv * TREE_VERTEX_BYTES || ni & 1 || iOff + ni * 2 !== buffer.byteLength)
    throw new Error("Invalid tree asset offsets");
  const lo = [0, 1, 2].map((a) => v.getFloat32(16 + a * 4, true)) as [number, number, number];
  const ext = [0, 1, 2].map((a) => v.getFloat32(28 + a * 4, true)) as [number, number, number];
  if (lo.some((x) => !Number.isFinite(x)) || ext.some((x) => !(x > 0) || !Number.isFinite(x))) throw new Error("Invalid tree asset box");
  const indices = new Uint16Array(buffer, iOff, ni);
  const keys = new Set<string>(),
    models: PackedTreeModel[] = [];
  let bv = 0,
    fi = 0;
  for (let i = 0; i < count; i++) {
    const r = HEADER + i * RECORD;
    const m: PackedTreeModel = {
      kind: v.getUint32(r, true),
      lod: v.getUint32(r + 4, true),
      aspect: v.getFloat32(r + 8, true),
      error: v.getFloat32(r + 12, true),
      radius: v.getFloat32(r + 16, true),
      vertexCount: v.getUint32(r + 20, true),
      indexCount: v.getUint32(r + 24, true),
      baseVertex: v.getUint32(r + 28, true),
      firstIndex: v.getUint32(r + 32, true),
      bounds: {
        lo: [v.getFloat32(r + 36, true), v.getFloat32(r + 40, true), v.getFloat32(r + 44, true)],
        hi: [v.getFloat32(r + 48, true), v.getFloat32(r + 52, true), v.getFloat32(r + 56, true)],
      },
    };
    if (
      m.baseVertex !== bv ||
      m.firstIndex !== fi ||
      !m.vertexCount ||
      m.vertexCount > 65536 ||
      m.indexCount < 3 ||
      m.indexCount % 3 ||
      !(m.kind >= 1 && m.kind <= 6) ||
      m.lod > 15 ||
      !(m.aspect > 0) ||
      !(m.radius > 0) ||
      !(m.error >= 0)
    )
      throw new Error("Invalid tree asset model");
    bv += m.vertexCount;
    fi += m.indexCount;
    if (bv > nv || fi > ni) throw new Error("Invalid tree asset offsets");
    // (the indices local to their model: one past its vertices would read the next model's — or past the buffer)
    const own = indices.subarray(m.firstIndex, m.firstIndex + m.indexCount);
    for (let k = 0; k < own.length; k++) if (own[k]! >= m.vertexCount) throw new Error("Tree index out of range");
    const key = `${m.kind}/${m.aspect}/${m.lod}`;
    if (keys.has(key)) throw new Error("Duplicate tree model");
    keys.add(key);
    models.push(m);
  }
  if (bv !== nv || fi + (fi & 1) !== ni) throw new Error("Trailing tree asset data");
  return { lo, ext, models, vertices: new Uint8Array(buffer, vOff, nv * TREE_VERTEX_BYTES), indices };
}
