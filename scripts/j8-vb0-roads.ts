// PLAN-J8 J8-VB, VB0 — the BD TOPO's roads as the tiles already on the disk give them (docs/PLAN-DETAILS-VOL-BAS-FABLEFLIGHT.md §4.2: « reste
// à mesurer en VB0 : le taux de remplissage de ces champs à Paris et à Toulon »): every z 15 BD TOPO tile kept by the e2e's Earth data on
// disk (tests/e2e/lib/earth-cache.ts) and the census's cache (~/.kerr-cache/bdtopo/15), its `troncon_de_route` layer read, each field
// counted filled or not, its values' spread (the first values met), by place — Toulon-Hyères (42.9–43.3° N, 5.7–6.4° E) and Paris (48.7–49.0°
// N, 2.1–2.6° E). No network: only what is on the disk. Writes docs/progress/j8/vb0-roads.json.
//   bun scripts/j8-vb0-roads.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { earthDataDir } from "../tests/e2e/lib/earth-cache";

const FIELDS = [
  "largeur_de_chaussee",
  "nombre_de_voies",
  "sens_de_circulation",
  "position_par_rapport_au_sol",
  "urbain",
  "importance",
  "nature",
  "vitesse_moyenne_vl",
  "restriction_de_hauteur",
  "restriction_de_largeur",
] as const;
const PLACES = {
  "Toulon-Hyères": { s: 42.9, n: 43.3, w: 5.7, e: 6.4 },
  Paris: { s: 48.7, n: 49.0, w: 2.1, e: 2.6 },
} as const;
const D = Math.PI / 180;

/** a z 15 tile's centre */
const centre = (x: number, y: number) => {
  const n = 2 ** 15;
  return { lon: ((x + 0.5) / n) * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) / D };
};
const placeOf = (x: number, y: number) => {
  const c = centre(x, y);
  for (const [name, b] of Object.entries(PLACES)) if (c.lat >= b.s && c.lat <= b.n && c.lon >= b.w && c.lon <= b.e) return name;
  return null;
};

// (the tiles: the e2e's Earth data's BD TOPO responses — a .json beside each body, its URL —, then the census's cache)
const tiles = new Map<string, () => Uint8Array>();
const geopf = join(earthDataDir(), "data.geopf.fr");
if (existsSync(geopf))
  for (const f of readdirSync(geopf)) {
    if (!f.endsWith(".json")) continue;
    const meta = JSON.parse(readFileSync(join(geopf, f), "utf8")) as { url?: string; status?: number };
    const m = meta.url?.match(/\/BDTOPO\/15\/(\d+)\/(\d+)\.pbf/);
    if (!m || meta.status !== 200) continue;
    const bin = join(geopf, f.replace(/\.json$/, ".bin"));
    tiles.set(`${m[1]}/${m[2]}`, () => new Uint8Array(gunzipSync(readFileSync(bin))));
  }
const census = join(homedir(), ".kerr-cache", "bdtopo", "15");
if (existsSync(census))
  for (const x of readdirSync(census))
    for (const f of readdirSync(join(census, x))) {
      const y = f.replace(/\.pbf$/, "");
      if (!tiles.has(`${x}/${y}`)) tiles.set(`${x}/${y}`, () => new Uint8Array(readFileSync(join(census, x, f))));
    }

type Tally = {
  tiles: number;
  roads: number;
  filled: Record<string, number>;
  values: Record<string, Record<string, number>>;
  byNature: Record<string, { roads: number; width: number; lanes: number }>;
};
const out: Record<string, Tally> = {};
for (const [key, read] of tiles) {
  const [x, y] = key.split("/").map(Number) as [number, number];
  const place = placeOf(x, y);
  if (!place) continue;
  const t = (out[place] ??= { tiles: 0, roads: 0, filled: {}, values: {}, byNature: {} });
  t.tiles++;
  const layer = new VectorTile(new PbfReader(read())).layers.troncon_de_route;
  for (let i = 0; layer && i < layer.length; i++) {
    const pr = layer.feature(i).properties as Record<string, unknown>;
    // (a road cut by two tiles counts in each: the tiles' own counts, as the cells read them)
    t.roads++;
    // (the width's and lanes' fill by the road's nature: the paths and tracks are not the streets)
    const nat = String(pr.nature ?? "?");
    const bn = (t.byNature[nat] ??= { roads: 0, width: 0, lanes: 0 });
    bn.roads++;
    if (typeof pr.largeur_de_chaussee === "number" && pr.largeur_de_chaussee > 0) bn.width++;
    if (pr.nombre_de_voies !== undefined && pr.nombre_de_voies !== null && pr.nombre_de_voies !== "") bn.lanes++;
    for (const f of FIELDS) {
      const v = pr[f];
      if (v === undefined || v === null || v === "" || (f === "largeur_de_chaussee" && v === 0)) continue;
      t.filled[f] = (t.filled[f] ?? 0) + 1;
      // (the values' spread: the categories counted, the numbers in bands)
      const k =
        typeof v === "number"
          ? f === "largeur_de_chaussee"
            ? `${Math.floor(v / 2) * 2}–${Math.floor(v / 2) * 2 + 2} m`
            : String(v)
          : String(v);
      const vs = (t.values[f] ??= {});
      if (Object.keys(vs).length < 24 || vs[k]) vs[k] = (vs[k] ?? 0) + 1;
    }
  }
}
const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  source: "the e2e's Earth data on disk and ~/.kerr-cache/bdtopo/15",
};
for (const [place, t] of Object.entries(out)) {
  const share = Object.fromEntries(FIELDS.map((f) => [f, t.roads ? +((100 * (t.filled[f] ?? 0)) / t.roads).toFixed(1) : 0]));
  const byNature = Object.fromEntries(
    Object.entries(t.byNature)
      .sort((a, b) => b[1].roads - a[1].roads)
      .map(([k, v]) => [
        k,
        { roads: v.roads, widthPct: +((100 * v.width) / v.roads).toFixed(1), lanesPct: +((100 * v.lanes) / v.roads).toFixed(1) },
      ]),
  );
  report[place] = { tiles: t.tiles, roads: t.roads, filledPct: share, byNature, values: t.values };
  for (const [k, v] of Object.entries(byNature).slice(0, 10))
    console.log(`  ${k}: ${v.roads} — width ${v.widthPct} %, lanes ${v.lanesPct} %`);
  console.log(`${place}: ${t.tiles} tiles, ${t.roads} roads — filled ${JSON.stringify(share)}`);
}
writeFileSync("docs/progress/j8/vb0-roads.json", `${JSON.stringify(report, null, 1)}\n`);
console.log("→ docs/progress/j8/vb0-roads.json");
