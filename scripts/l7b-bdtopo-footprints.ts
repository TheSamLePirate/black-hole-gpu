// L7b study, phase 2: the BD TOPO's buildings over the ortho mosaic — their footprints in the mosaic's pixels and heights
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { bdtopoHeight, bdtopoStands, bdtopoUrl } from "./src/system/bdtopo";
const [X18, Y18, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]!];
const z = 15,
  n15 = 2 ** z;
const x15 = Math.floor(X18 / 8),
  y15 = Math.floor(Y18 / 8);
const raw = new Uint8Array(await (await fetch(bdtopoUrl(x15, y15))).arrayBuffer());
const layer = new VectorTile(new PbfReader(raw)).layers.batiment!;
const feats: { h: number; rings: number[][][] }[] = [];
for (let i = 0; i < layer.length; i++) {
  const f = layer.feature(i);
  if (!bdtopoStands(f.properties)) continue;
  const h = bdtopoHeight(f.properties);
  const E = f.extent;
  // (tile units → z18 mosaic pixels: (x15 + u/E) × 8 tiles of 256 px, less the mosaic's origin)
  const rings = f.loadGeometry().map((ring) => ring.map((p) => [((x15 + p.x / E) * 8 - X18) * 256, ((y15 + p.y / E) * 8 - Y18) * 256]));
  feats.push({ h, rings });
}
await Bun.write(out, JSON.stringify(feats));
console.log(`${feats.length} buildings from tile ${x15}/${y15} (${n15})`);
