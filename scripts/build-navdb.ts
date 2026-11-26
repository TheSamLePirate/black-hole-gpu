// The navigation database (docs/PLAN-A320-VOL-AAA.md N1 — Sam, 26 Nov 2026: « États-Unis + monde »): the world's radio aids, named
// fixes and airways, from FlightGear's Navaids (Robin A. Peel's data, cycle 2013.10 — the same as the ILS of assets/approaches —, GPL v2
// or later; assets/approaches/raw/{nav,fix,awy}.dat.gz, git-ignored, from fgdata/Navaids):
// - nav.dat rows 2 (NDB), 3 (VOR, VORTAC, VOR-DME), 12 (a VOR's DME — folded into its VOR), 13 (a DME alone);
// - fix.dat: the named fixes (their ident, their place);
// - awy.dat: the airways' segments (from, to, low or high, their base and top [hundreds of ft], the airways' names joined by "-").
// Out, in the runways' 5° tiles (world/runways.ts tileKey): assets/nav/v1/t<la>_<lo>.json — `n` the aids [ident, kind ("V" VOR, "VD"
// VOR-DME, "VT" VORTAC, "N" NDB, "D" DME), lat, lon, freq (kHz), name], `f` the fixes [ident, lat, lon], `a` the airway segments touching
// the tile [names, from ident, lat, lon, to ident, lat, lon, level (1 low, 2 high), base, top] (each in its two ends' tiles) —, index.json
// (the tiles, their counts), idents.json (each ident → the tiles holding it), README-free: the licence in assets/nav/LICENSE.
//
//   bun scripts/build-navdb.ts            # → assets/nav/v1/

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tileKey } from "../src/world/runways";

const RAW = "assets/approaches/raw";
const OUT = "assets/nav/v1";
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

const lines = (f: string) =>
  gunzipSync(readFileSync(`${RAW}/${f}`))
    .toString("latin1")
    .split(/\r?\n/)
    .slice(2)
    .filter((l) => l.trim() && !l.startsWith("99"));

type Aid = [string, string, number, number, number, string];
type Fix = [string, number, number];
type Seg = [string, string, number, number, string, number, number, number, number, number];
const tiles = new Map<string, { n: Aid[]; f: Fix[]; a: Seg[] }>();
const tile = (lat: number, lon: number) => {
  const k = tileKey(lat, lon);
  let t = tiles.get(k);
  if (!t) tiles.set(k, (t = { n: [], f: [], a: [] }));
  return { k, t };
};
const idents = new Map<string, Set<string>>();
const ident = (id: string, k: string) => {
  let s = idents.get(id);
  if (!s) idents.set(id, (s = new Set()));
  s.add(k);
};

// the radio aids
const vorDme = new Set<string>();
const navRows = lines("nav.dat.gz").map((l) => l.trim().split(/\s+/));
for (const p of navRows) if (p[0] === "12") vorDme.add(`${p[7]}|${Number(p[1]).toFixed(2)}|${Number(p[2]).toFixed(2)}`);
let aids = 0;
for (const p of navRows) {
  const type = p[0];
  if (type !== "2" && type !== "3" && type !== "13") continue;
  const lat = Number(p[1]),
    lon = Number(p[2]);
  const freq = Number(p[4]);
  const id = p[7]!;
  const name = p.slice(8).join(" ");
  let kind: string;
  if (type === "2") kind = "N";
  else if (type === "13") kind = "D";
  else kind = / VORTAC$/.test(name) ? "VT" : vorDme.has(`${id}|${lat.toFixed(2)}|${lon.toFixed(2)}`) || / VOR-DME$/.test(name) ? "VD" : "V";
  // (nav.dat's VOR in 10 kHz units, its NDB in kHz, its DME paired to a VOR's frequency)
  const kHz = type === "2" ? freq : freq * 10;
  const { k, t } = tile(lat, lon);
  t.n.push([id, kind, r5(lat), r5(lon), kHz, name.replace(/ (NDB|VOR|VORTAC|VOR-DME|DME|DME-ILS|TACAN)$/, "")]);
  ident(id, k);
  aids++;
}
// the fixes
let fixes = 0;
for (const l of lines("fix.dat.gz")) {
  const p = l.trim().split(/\s+/);
  const lat = Number(p[0]),
    lon = Number(p[1]);
  const id = p[2];
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const { k, t } = tile(lat, lon);
  t.f.push([id, r5(lat), r5(lon)]);
  ident(id, k);
  fixes++;
}
// the airways' segments, in both ends' tiles
let segs = 0;
for (const l of lines("awy.dat.gz")) {
  const p = l.trim().split(/\s+/);
  if (p.length < 10) continue;
  const s: Seg = [
    p[9]!,
    p[0]!,
    r5(Number(p[1])),
    r5(Number(p[2])),
    p[3]!,
    r5(Number(p[4])),
    r5(Number(p[5])),
    Number(p[6]),
    Number(p[7]),
    Number(p[8]),
  ];
  const a = tile(s[2], s[3]),
    b = tile(s[5], s[6]);
  a.t.a.push(s);
  if (b.k !== a.k) b.t.a.push(s);
  segs++;
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
const index: Record<string, [number, number, number]> = {};
for (const [k, t] of tiles) {
  writeFileSync(`${OUT}/t${k}.json`, JSON.stringify({ v: 1, ...t }));
  index[k] = [t.n.length, t.f.length, t.a.length];
}
writeFileSync(`${OUT}/index.json`, JSON.stringify({ v: 1, cycle: "2013.10", tiles: index }));
writeFileSync(`${OUT}/idents.json`, JSON.stringify(Object.fromEntries([...idents].map(([id, s]) => [id, [...s]]))));
console.log(`navdb: ${aids} aids, ${fixes} fixes, ${segs} airway segments in ${tiles.size} tiles → ${OUT}`);
