// The relief codec on the IGN's own grids (src/pwa/relief-codec.ts, I8c): a sample of WMS-R tiles — a massif (Chamonix),
// a city and its buildings (Paris, the surface models), a coast and its no-data (Étretat), a plain (the Beauce) —, each
// fetched, kept small and read back: its bytes before and after, the worst error. The means per layer go to
// system/zones.ts's estimate and docs/ANALYSE-IGN-LIDAR.md §9.3.
//   bun scripts/relief-codec-bench.ts            (~1 min: 4 requests a second, the Géoplateforme's share kept low)

import { decodeRelief, encodeRelief } from "../src/pwa/relief-codec";
import { IGN_LIDAR, IGN_MNS_LIDAR, IGN_RGEALTI, ignHeightUrl } from "../src/system/earth-tiles";

const D = Math.PI / 180;
const tileOf = (lat: number, lon: number, z: number) => {
  const n = 2 ** z;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * n)] as const;
};
const PLACES = [
  { name: "Chamonix", lat: 45.92, lon: 6.87 },
  { name: "Paris", lat: 48.857, lon: 2.35 },
  { name: "Étretat", lat: 49.707, lon: 0.2 },
  { name: "Beauce", lat: 48.3, lon: 1.6 },
];
const LAYERS = [
  { name: "RGE ALTI z14", layer: IGN_RGEALTI, z: 14, size: 256 },
  { name: "LiDAR HD z16", layer: IGN_LIDAR, z: 16, size: 256 },
  { name: "MNS LiDAR z12 512²", layer: IGN_MNS_LIDAR, z: 12, size: 512 },
];

const rows: { layer: string; place: string; raw: number; enc: number; worst: number; holes: number }[] = [];
for (const L of LAYERS)
  for (const P of PLACES)
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
    ]) {
      const [x, y] = tileOf(P.lat, P.lon, L.z);
      const url = ignHeightUrl(L.layer, L.z, x + dx!, y + dy!, L.size);
      const res = await fetch(url);
      await Bun.sleep(250);
      if (!res.ok) {
        console.log(`  ${L.name} ${P.name}: HTTP ${res.status}`);
        continue;
      }
      const raw = await res.arrayBuffer();
      if (raw.byteLength !== L.size * L.size * 4) {
        console.log(`  ${L.name} ${P.name}: ${raw.byteLength} bytes, not a grid`);
        continue;
      }
      const enc = await encodeRelief(raw);
      const back = new Float32Array((await decodeRelief(enc.buffer as ArrayBuffer))!);
      const src = new Float32Array(raw);
      let worst = 0,
        holes = 0;
      for (let i = 0; i < src.length; i++) {
        const h = src[i]!;
        if (!Number.isFinite(h) || h < -100 || h > 9000) {
          holes++;
          if (
            !(back[i] === h || (Number.isNaN(h) && Number.isNaN(back[i]!))) &&
            !(back[i]! < -100 || back[i]! > 9000 || Number.isNaN(back[i]!))
          )
            worst = Number.POSITIVE_INFINITY;
          continue;
        }
        worst = Math.max(worst, Math.abs(back[i]! - h));
      }
      rows.push({ layer: L.name, place: P.name, raw: raw.byteLength, enc: enc.byteLength, worst, holes });
      console.log(
        `  ${L.name.padEnd(20)} ${P.name.padEnd(9)} ${String(raw.byteLength).padStart(8)} → ${String(enc.byteLength).padStart(7)} B (${((100 * enc.byteLength) / raw.byteLength).toFixed(1).padStart(4)} %)  worst ${(worst * 1000).toFixed(2)} mm, holes ${((100 * holes) / src.length).toFixed(0)} %`,
      );
    }
console.log("\nper layer: the mean kept [bytes], its share of the raw, the worst error");
for (const L of LAYERS) {
  const r = rows.filter((x) => x.layer === L.name);
  if (!r.length) continue;
  const enc = r.reduce((s, x) => s + x.enc, 0) / r.length,
    raw = r[0]!.raw;
  console.log(
    `  ${L.name.padEnd(20)} ${Math.round(enc).toString().padStart(7)} B of ${raw} (${((100 * enc) / raw).toFixed(1)} %), worst ${(Math.max(...r.map((x) => x.worst)) * 1000).toFixed(2)} mm — ${r.length} tiles`,
  );
}
