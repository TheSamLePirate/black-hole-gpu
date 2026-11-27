// Bind emission stations to the nearest delivered rigid surface, offline.
import { gunzipSync } from "node:zlib";
import { ATTACHMENTS } from "../src/traffic/attachments";
import { readTrfc } from "../src/traffic/airliner-gear";
const bindings: Record<string, { part: number; point: number[] }[]> = {};
for (const id of ["b738", "b744", "b772", "b77w", "crj900"] as const) {
  const file = id === "crj900" ? "assets/traffic/crj-fg/crj900.bin" : `assets/traffic/boeing/${id}.bin`;
  const bytes = gunzipSync(await Bun.file(file).arrayBuffer());
  const m = readTrfc(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const rigFile = id === "crj900" ? "assets/traffic/crj-fg/crj900-rig.json" : `assets/traffic/boeing/${id}-rig.json`;
  const nodes = await Bun.file(rigFile).json();
  const isFlap = (part: number): boolean => {
    for (let i = part - 1; i >= 0; i = nodes[i].parent) if (/flap/.test(nodes[i].prop)) return true;
    return false;
  };
  bindings[id] = [1, -1].map((side) => {
    const q = ATTACHMENTS[id].flap;
    let distance = Infinity,
      part = 0;
    let point: number[] = [];
    for (let k = 0; k < m.verts.length; k += 10) {
      if (!isFlap(Math.floor(m.verts[k + 7]!))) continue;
      const d = Math.hypot(m.verts[k]! - q[0] * side, m.verts[k + 1]! - q[1], m.verts[k + 2]! - q[2]);
      if (d < distance) {
        distance = d;
        part = Math.floor(m.verts[k + 7]!);
        point = Array.from(m.verts.subarray(k, k + 3));
      }
    }
    if (!point.length) throw Error(`no flap for ${id}`);
    return { part, point };
  });
}
await Bun.write("src/traffic/rig-anchors.json", JSON.stringify(bindings, null, 2) + "\n");
