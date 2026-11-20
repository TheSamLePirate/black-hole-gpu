// J9: prepared, unquantized shared tree geometry. All offsets are bytes, little-endian, canonical z-up frame.
// Meshoptimizer belongs to the build only; the runtime codec has no simplification or WASM dependency.
export const TREE_ASSET_FORMAT = 1;
export const TREE_VERTEX_FLOATS = 10;
const MAGIC = 0x3147544b; // KTG1
const HEADER = 16;
const RECORD = 64;
const MAX_BYTES = 64 * 1024 * 1024;
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
function validate(m: TreeAssetModel) {
  const n = m.vertices.length / TREE_VERTEX_FLOATS;
  if (
    !Number.isInteger(n) ||
    n < 1 ||
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
  for (const i of m.indices) if (i >= n) throw new Error("Tree index out of range");
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(m.bounds.lo[axis]) || !Number.isFinite(m.bounds.hi[axis]) || m.bounds.lo[axis]! > m.bounds.hi[axis]!)
      throw new Error("Invalid tree bounds");
    for (let i = 0; i < n; i++) {
      const x = m.vertices[i * TREE_VERTEX_FLOATS + axis]!;
      if (x < m.bounds.lo[axis]! - 1e-6 || x > m.bounds.hi[axis]! + 1e-6) throw new Error("Tree vertex outside bounds");
    }
  }
}
export function encodeTreeAssets(models: TreeAssetModel[]): Uint8Array<ArrayBuffer> {
  if (!models.length || models.length > 128) throw new Error("Invalid tree asset count");
  const size = HEADER + models.length * RECORD + models.reduce((n, m) => n + m.vertices.byteLength + m.indices.byteLength, 0);
  if (size > MAX_BYTES) throw new Error("Tree assets exceed budget");
  const bytes = new Uint8Array(size),
    v = new DataView(bytes.buffer);
  v.setUint32(0, MAGIC, true);
  v.setUint32(4, TREE_ASSET_FORMAT, true);
  v.setUint32(8, models.length, true);
  v.setUint32(12, size, true);
  let at = HEADER + models.length * RECORD;
  const keys = new Set<string>();
  for (const [i, m] of models.entries()) {
    validate(m);
    const key = `${m.kind}/${m.aspect}/${m.lod}`;
    if (keys.has(key)) throw new Error("Duplicate tree model");
    keys.add(key);
    const r = HEADER + i * RECORD;
    v.setUint32(r, m.kind, true);
    v.setUint32(r + 4, m.lod, true);
    v.setFloat32(r + 8, m.aspect, true);
    v.setFloat32(r + 12, m.error, true);
    v.setFloat32(r + 16, m.radius, true);
    v.setUint32(r + 20, m.vertices.length / TREE_VERTEX_FLOATS, true);
    v.setUint32(r + 24, m.indices.length, true);
    v.setUint32(r + 28, at, true);
    bytes.set(new Uint8Array(m.vertices.buffer, m.vertices.byteOffset, m.vertices.byteLength), at);
    at += m.vertices.byteLength;
    v.setUint32(r + 32, at, true);
    bytes.set(new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength), at);
    at += m.indices.byteLength;
    for (let a = 0; a < 3; a++) {
      v.setFloat32(r + 36 + a * 4, m.bounds.lo[a]!, true);
      v.setFloat32(r + 48 + a * 4, m.bounds.hi[a]!, true);
    }
  }
  return bytes;
}
/** Input is the decompressed response body (util/inflate.ts); views keep the immutable asset buffer alive. */
export function decodeTreeAssets(buffer: ArrayBuffer): TreeAssetModel[] {
  if (buffer.byteLength < HEADER || buffer.byteLength > MAX_BYTES) throw new Error("Invalid tree asset size");
  const v = new DataView(buffer),
    count = v.getUint32(8, true);
  if (
    v.getUint32(0, true) !== MAGIC ||
    v.getUint32(4, true) !== TREE_ASSET_FORMAT ||
    v.getUint32(12, true) !== buffer.byteLength ||
    !count ||
    count > 128 ||
    HEADER + count * RECORD > buffer.byteLength
  )
    throw new Error("Invalid tree asset header");
  let at = HEADER + count * RECORD;
  const keys = new Set<string>(),
    models: TreeAssetModel[] = [];
  for (let i = 0; i < count; i++) {
    const r = HEADER + i * RECORD,
      n = v.getUint32(r + 20, true),
      ni = v.getUint32(r + 24, true),
      vo = v.getUint32(r + 28, true),
      io = v.getUint32(r + 32, true);
    if (vo !== at || io !== vo + n * TREE_VERTEX_FLOATS * 4 || io + ni * 4 > buffer.byteLength)
      throw new Error("Invalid tree asset offsets");
    at = io + ni * 4;
    const m: TreeAssetModel = {
      kind: v.getUint32(r, true),
      lod: v.getUint32(r + 4, true),
      aspect: v.getFloat32(r + 8, true),
      error: v.getFloat32(r + 12, true),
      radius: v.getFloat32(r + 16, true),
      vertices: new Float32Array(buffer, vo, n * TREE_VERTEX_FLOATS),
      indices: new Uint32Array(buffer, io, ni),
      bounds: {
        lo: [v.getFloat32(r + 36, true), v.getFloat32(r + 40, true), v.getFloat32(r + 44, true)],
        hi: [v.getFloat32(r + 48, true), v.getFloat32(r + 52, true), v.getFloat32(r + 56, true)],
      },
    };
    validate(m);
    const key = `${m.kind}/${m.aspect}/${m.lod}`;
    if (keys.has(key)) throw new Error("Duplicate tree model");
    keys.add(key);
    models.push(m);
  }
  if (at !== buffer.byteLength) throw new Error("Trailing tree asset data");
  return models;
}
