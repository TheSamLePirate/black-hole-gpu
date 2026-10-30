// Builds a world's relief tiles (server/moon-tiles.ts) and exits — the stack's moon-tiles service (deploy/compose.yml), into
// the volume the room server serves them from; a run after a finished one only checks the tiles are there.
//   bun server/moon-build.ts [--body moon|mars] [--out dir] [--rows r0 r1] [--cols c0 c1]   (z 0 tile rows / columns: a box)

import { buildLola, DEM_SOURCES } from "./moon-tiles";

const arg = (k: string, n = 1) => {
  const i = process.argv.indexOf(k);
  return i < 0 ? null : process.argv.slice(i + 1, i + 1 + n);
};
const body = arg("--body")?.[0] ?? "moon";
if (!DEM_SOURCES[body]) throw new Error(`no model for ${body}`);
const out = arg("--out")?.[0] ?? (body === "moon" ? (process.env.MOON_DIR ?? "./data/moon/lola") : `./data/${body}/dem`);
const pair = (k: string) => {
  const v = arg(k, 2);
  return v ? ([Number(v[0]), Number(v[1])] as [number, number]) : undefined;
};
const t0 = performance.now();
await buildLola(out, { rows: pair("--rows"), cols: pair("--cols"), body: DEM_SOURCES[body] });
console.log(`dem ${body}: done in ${((performance.now() - t0) / 60000).toFixed(1)} min → ${out}`);
