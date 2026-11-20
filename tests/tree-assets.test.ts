import { expect, test } from "bun:test";
import { decodeTreeAssets, encodeTreeAssets, TREE_VERTEX_FLOATS } from "../src/vegetation/tree-assets";
import { TREE_ASPECTS, TREE_MODEL_KINDS, treeModel } from "../src/vegetation/tree-model";

const read = async () => {
  const manifest = await Bun.file("assets/vegetation/trees-v1.json").json();
  const raw = Bun.gunzipSync(await Bun.file(`assets/vegetation/${manifest.file}`).bytes());
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
};
test("prepared tree geometry: all source triangles and attributes preserved after build reordering", async () => {
  const models = decodeTreeAssets(await read());
  expect(models.length).toBe(12);
  for (const kind of TREE_MODEL_KINDS)
    for (const aspect of TREE_ASPECTS[kind]!) {
      const source = treeModel(kind, aspect);
      const reference: string[] = [];
      const signature = (vertices: number[][]) =>
        vertices.map((_, i) => [...vertices.slice(i), ...vertices.slice(0, i)].flat().join(",")).sort()[0]!;
      for (let i = 0; i < source.index.length; i += 3) {
        reference.push(
          signature(
            Array.from(source.index.subarray(i, i + 3), (index) => [
              ...source.pos.subarray(index * 3, index * 3 + 3),
              ...source.nrm.subarray(index * 3, index * 3 + 3),
              ...source.attr.subarray(index * 4, index * 4 + 4),
            ]),
          ),
        );
      }
      reference.sort();
      const pair = models.filter((m) => m.kind === kind && Math.abs(m.aspect - aspect) < 1e-6);
      expect(pair.length).toBe(1);
      for (const m of pair) {
        const leaves: string[] = [];
        for (let i = 0; i < m.indices.length; i += 3) {
          const ids = m.indices.subarray(i, i + 3);
          leaves.push(
            signature(Array.from(ids, (index) => [...m.vertices.subarray(index * TREE_VERTEX_FLOATS, (index + 1) * TREE_VERTEX_FLOATS)])),
          );
        }
        expect(leaves.sort()).toEqual(reference);
        expect(m.error).toBe(0);
      }
    }
});
test("tree asset codec rejects wrong version, truncated sections, bad indices and non-finite vertices", async () => {
  const raw = await read();
  for (const mode of ["version", "offset", "index", "nan"]) {
    const b = raw.slice(0),
      v = new DataView(b);
    if (mode === "version") v.setUint32(4, 99, true);
    if (mode === "offset") v.setUint32(16 + 28, 0xfffffff0, true);
    if (mode === "index") v.setUint32(v.getUint32(16 + 32, true), 0xffffffff, true);
    if (mode === "nan") v.setFloat32(v.getUint32(16 + 28, true), Number.NaN, true);
    expect(() => decodeTreeAssets(b)).toThrow();
  }
  expect(() => decodeTreeAssets(raw.slice(0, raw.byteLength - 4))).toThrow();
});
test("tree asset codec roundtrip keeps all bytes and rejects duplicate model keys", async () => {
  const raw = await read(),
    models = decodeTreeAssets(raw);
  expect(encodeTreeAssets(models)).toEqual(new Uint8Array(raw));
  expect(() => encodeTreeAssets([models[0]!, models[0]!])).toThrow("Duplicate");
});
