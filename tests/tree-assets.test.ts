import { expect, test } from "bun:test";
import {
  decodeTreeAssets,
  dequantizeVertex,
  encodeTreeAssets,
  octDecode,
  octEncode,
  type PackedTreeAssets,
  quantizeVertex,
  TREE_VERTEX_BYTES,
} from "../src/vegetation/tree-assets";
import { TREE_ASPECTS, TREE_MODEL_KINDS, treeModel } from "../src/vegetation/tree-model";

const read = async () => {
  const manifest = await Bun.file("assets/vegetation/trees-v1.json").json();
  const raw = Bun.gunzipSync(await Bun.file(`assets/vegetation/${manifest.file}`).bytes());
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
};
const bytesOf = (p: PackedTreeAssets, i: number) =>
  Array.from(p.vertices.subarray(i * TREE_VERTEX_BYTES, (i + 1) * TREE_VERTEX_BYTES)).join(",");

test("prepared tree geometry: every source triangle and attribute kept through reordering and quantisation (LOD 0 and LOD 1)", async () => {
  const p = decodeTreeAssets(await read());
  expect(p.models.length).toBe(24);
  const q = new DataView(new ArrayBuffer(TREE_VERTEX_BYTES));
  const src = new Float32Array(10);
  for (const lod of [0, 1] as const)
    for (const kind of TREE_MODEL_KINDS)
      for (const aspect of TREE_ASPECTS[kind]!) {
        const source = treeModel(kind, aspect, 1, lod);
        // (a triangle's signature: its three quantised vertices, rotated to its least form — the build's reordering keeps
        // the winding)
        const signature = (vertices: string[]) =>
          vertices.map((_, i) => [...vertices.slice(i), ...vertices.slice(0, i)].join("|")).sort()[0]!;
        const reference: string[] = [];
        for (let i = 0; i < source.index.length; i += 3)
          reference.push(
            signature(
              Array.from(source.index.subarray(i, i + 3), (index) => {
                src.set(source.pos.subarray(index * 3, index * 3 + 3), 0);
                src.set(source.nrm.subarray(index * 3, index * 3 + 3), 3);
                src.set(source.attr.subarray(index * 4, index * 4 + 4), 6);
                quantizeVertex(q, 0, p.lo, p.ext, src);
                return Array.from(new Uint8Array(q.buffer)).join(",");
              }),
            ),
          );
        reference.sort();
        const pair = p.models.filter((m) => m.lod === lod && m.kind === kind && Math.abs(m.aspect - aspect) < 1e-6);
        expect(pair.length).toBe(1);
        const m = pair[0]!;
        const tris: string[] = [];
        for (let i = 0; i < m.indexCount; i += 3) {
          const ids = p.indices.subarray(m.firstIndex + i, m.firstIndex + i + 3);
          tris.push(signature(Array.from(ids, (index) => bytesOf(p, m.baseVertex + index))));
        }
        expect(tris.sort()).toEqual(reference);
        if (lod === 0) expect(m.error).toBe(0);
        else expect(m.error).toBeGreaterThan(0);
      }
});
test("quantisation error: positions within half a step of the common box, normals within 0.01 rad, attributes within half of 1/255", async () => {
  const p = decodeTreeAssets(await read());
  const m = treeModel(1, TREE_ASPECTS[1]![0]!, 1, 0);
  const src = new Float32Array(10);
  const q = new DataView(new ArrayBuffer(TREE_VERTEX_BYTES));
  const one: PackedTreeAssets = { ...p, vertices: new Uint8Array(q.buffer) };
  for (let i = 0; i < m.pos.length / 3; i++) {
    src.set(m.pos.subarray(i * 3, i * 3 + 3), 0);
    src.set(m.nrm.subarray(i * 3, i * 3 + 3), 3);
    src.set(m.attr.subarray(i * 4, i * 4 + 4), 6);
    quantizeVertex(q, 0, p.lo, p.ext, src);
    const d = dequantizeVertex(one, 0);
    for (let a = 0; a < 3; a++) expect(Math.abs(d[a]! - src[a]!)).toBeLessThanOrEqual((0.5 * p.ext[a]!) / 65535 + 1e-6);
    const l = Math.hypot(src[3]!, src[4]!, src[5]!);
    const dot = (d[3]! * src[3]! + d[4]! * src[4]! + d[5]! * src[5]!) / l;
    expect(Math.acos(Math.min(1, dot))).toBeLessThan(0.01);
    for (let a = 0; a < 4; a++) expect(Math.abs(d[6 + a]! - src[6 + a]!)).toBeLessThanOrEqual(0.5 / 255 + 1e-6);
  }
  // (the octahedral fold both ways round, the lower hemisphere's too)
  for (const n of [
    [0, 0, 1],
    [0, 0, -1],
    [0.6, -0.8, 0],
    [-0.3, 0.4, -0.866],
  ] as const) {
    const [x, y, z] = octDecode(...octEncode(n[0], n[1], n[2]));
    expect(Math.abs(x - n[0]) + Math.abs(y - n[1]) + Math.abs(z - n[2])).toBeLessThan(1e-4);
  }
});
test("tree asset codec rejects wrong version, truncated sections, bad offsets and indices past their model", async () => {
  const raw = await read();
  for (const mode of ["version", "offset", "index", "base"]) {
    const b = raw.slice(0),
      v = new DataView(b);
    if (mode === "version") v.setUint32(4, 1, true);
    if (mode === "offset") v.setUint32(40, 0xfffffff0, true);
    // (the first model's first index one past its own vertices: the next model's — the codec's local-index contract)
    if (mode === "index") v.setUint16(v.getUint32(48, true), v.getUint32(64 + 20, true), true);
    if (mode === "base") v.setUint32(64 + 64 + 28, 1, true);
    expect(() => decodeTreeAssets(b)).toThrow();
  }
  expect(() => decodeTreeAssets(raw.slice(0, raw.byteLength - 4))).toThrow();
});
test("tree asset codec roundtrip keeps all bytes and rejects duplicate model keys", async () => {
  const raw = await read(),
    p = decodeTreeAssets(raw);
  expect(encodeTreeAssets(p)).toEqual(new Uint8Array(raw));
  expect(() => encodeTreeAssets({ ...p, models: [p.models[0]!, p.models[0]!] })).toThrow("Duplicate");
});
