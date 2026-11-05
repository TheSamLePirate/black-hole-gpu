// D1 (Q8): what Overture's base.pmtiles holds in its infrastructure layer round a few places — power lines, towers, poles,
// wind turbines (their height, hub, rotor) — read by HTTP ranges, nothing downloaded whole. `bun scripts/overture-infra-probe.ts`

import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PmTiles, fetchRange } from "../src/system/pmtiles";
const url = "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-10-21.0/base.pmtiles";
const pm = new PmTiles(url, fetchRange());
const h = await pm.header();
console.log("zoom", h.minZoom, h.maxZoom);
const tileOf = (lat: number, lon: number, z: number) => [
  Math.floor(((lon + 180) / 360) * 2 ** z),
  Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z),
];
for (const [lat, lon] of [
  [48.24, 1.83],
  [48.3, 1.75],
  [49.88, 2.95],
]) {
  const z = Math.min(14, h.maxZoom);
  const [x, y] = tileOf(lat, lon, z);
  const b = await pm.tile(z, x, y);
  if (!b) {
    console.log(lat, lon, "no tile");
    continue;
  }
  const vt = new VectorTile(new PbfReader(b));
  const out: Record<string, Record<string, number>> = {};
  for (const name of Object.keys(vt.layers)) {
    const l = vt.layers[name]!;
    const c: Record<string, number> = {};
    for (let i = 0; i < l.length; i++) {
      const p = l.feature(i).properties;
      const k = `${p.subtype ?? ""}/${p.class ?? ""}`;
      c[k] = (c[k] ?? 0) + 1;
    }
    out[name] = c;
  }
  console.log(lat, lon, z, x, y, JSON.stringify(out.infrastructure ?? {}), Object.keys(vt.layers).join(","));
  const inf = vt.layers.infrastructure;
  if (inf)
    for (let i = 0; i < inf.length && i < 400; i++) {
      const f = inf.feature(i);
      if (String(f.properties.class).includes("wind") || String(f.properties.class) === "generator") {
        console.log("  sample", JSON.stringify(f.properties));
        break;
      }
    }
}
