// J9-0: reproducible geometry inventory, outside the frame. No GPU cost inferred here.
import { ForestKind } from "../src/system/forest";
import { TREE_ASPECTS, TREE_MODEL_KINDS, treeModel } from "../src/vegetation/tree-model";

const rows = TREE_MODEL_KINDS.flatMap((kind) =>
  TREE_ASPECTS[kind]!.map((aspect) => {
    const mesh = treeModel(kind, aspect);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.pos.length; i++) {
      const axis = i % 3;
      lo[axis] = Math.min(lo[axis]!, mesh.pos[i]!);
      hi[axis] = Math.max(hi[axis]!, mesh.pos[i]!);
    }
    let invalidIndices = 0;
    for (const index of mesh.index) if (index >= mesh.pos.length / 3) invalidIndices++;
    return {
      kind: Object.entries(ForestKind).find(([, value]) => value === kind)![0],
      aspect,
      seed: 1,
      vertices: mesh.pos.length / 3,
      triangles: mesh.index.length / 3,
      leafCards: mesh.leaves,
      branchSegments: mesh.segments,
      bytes: mesh.pos.byteLength + mesh.nrm.byteLength + mesh.attr.byteLength + mesh.index.byteLength,
      bounds: { lo, hi },
      invalidIndices,
    };
  }),
);
if (rows.some((row) => row.invalidIndices || ![...row.bounds.lo, ...row.bounds.hi].every(Number.isFinite))) {
  throw new Error("Invalid tree geometry");
}
const report = {
  source: "src/vegetation/tree-model.ts",
  sourceSha256: new Bun.CryptoHasher("sha256").update(await Bun.file("src/vegetation/tree-model.ts").arrayBuffer()).digest("hex"),
  units: "canonical: z up, height 1; bounds include leaf card corners before alpha rejection",
  totals: { bytes: rows.reduce((n, row) => n + row.bytes, 0), triangles: rows.reduce((n, row) => n + row.triangles, 0) },
  models: rows,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv[2]) await Bun.write(process.argv[2], json);
else console.log(json);
