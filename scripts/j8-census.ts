// PLAN-J8 J8-0 (a): the census of the BD TOPO's buildings round J0's view (tests/e2e/lib/j0-scene.ts: the F-35 over the Rade
// d'Hyères, 43.06° N 6.32° E, heading 270°, then 340° after its turn) — by ring of distance (0–2, 2–5, 5–10, 10–15, 15–30 km): the
// z 15 tiles, their bytes, the buildings standing (each counted once: a building cut by two tiles comes in both, `cleabs` its one
// identity), over the whole disc and within the camera's field (±45° of the heading: the cockpit's ~90° across). The tiles fetched
// once from the Géoplateforme and kept out of the repository (~/.kerr-cache/bdtopo/15/x/y.pbf — an empty file: no tile there),
// 6 at a time (the scenery worker's own BDTOPO_RUNNERS; one heavy IGN load at a time across the two Macs: the 429s).
//
//   bun scripts/j8-census.ts [--out docs/progress/j8/census-j0.json] [--radius 30]
import { VectorTile } from "@mapbox/vector-tile";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PbfReader } from "pbf";
import { BDTOPO_Z, bdtopoStands, bdtopoUrl } from "../src/system/bdtopo";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};
const OUT = arg("--out", "docs/progress/j8/census-j0.json");
const RADIUS_KM = Number(arg("--radius", "30"));
const CACHE = join(homedir(), ".kerr-cache", "bdtopo", String(BDTOPO_Z));
const [LAT0, LON0] = [43.06, 6.32];
const HEADINGS = [270, 340];
const HALF_FOV = 45;
const RINGS = [0, 2, 5, 10, 15, 30];
const D = Math.PI / 180;
const n = 2 ** BDTOPO_Z;

/** a place's distance [km] and bearing [°] from the start (flat east/north: within 30 km, under 0.1 % off) */
function polar(lat: number, lon: number) {
  const e = (lon - LON0) * 111.32 * Math.cos(LAT0 * D),
    nn = (lat - LAT0) * 110.574;
  return { km: Math.hypot(e, nn), brg: ((Math.atan2(e, nn) / D) % 360 + 360) % 360 };
}
const ringOf = (km: number) => RINGS.findIndex((r, i) => i < RINGS.length - 1 && km >= r && km < RINGS[i + 1]!);
const inView = (brg: number, hdg: number) => Math.abs((((brg - hdg + 540) % 360) + 360) % 360 - 180) <= HALF_FOV;
const tileLon = (x: number) => (x / n) * 360 - 180;
const tileLat = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / D;

// the tiles touching the disc
const xOf = (lon: number) => Math.floor(((lon + 180) / 360) * n);
const yOf = (lat: number) => Math.floor(((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * n);
const dLat = RADIUS_KM / 110.574,
  dLon = RADIUS_KM / (111.32 * Math.cos(LAT0 * D));
const tiles: { x: number; y: number; km: number }[] = [];
for (let x = xOf(LON0 - dLon); x <= xOf(LON0 + dLon); x++)
  for (let y = yOf(LAT0 + dLat); y <= yOf(LAT0 - dLat); y++) {
    // (the tile's nearest point to the start)
    const lat = Math.min(Math.max(LAT0, tileLat(y + 1)), tileLat(y)),
      lon = Math.min(Math.max(LON0, tileLon(x)), tileLon(x + 1));
    const km = polar(lat, lon).km;
    if (km <= RADIUS_KM) tiles.push({ x, y, km });
  }
tiles.sort((a, b) => a.km - b.km);
console.log(`${tiles.length} z ${BDTOPO_Z} tiles within ${RADIUS_KM} km of ${LAT0}, ${LON0}; cache ${CACHE}`);

// fetched once, kept
let fetched = 0,
  cached = 0,
  failed = 0;
async function tileBytes(x: number, y: number): Promise<Uint8Array | null> {
  const p = join(CACHE, String(x), `${y}.pbf`);
  if (existsSync(p)) {
    cached++;
    const b = readFileSync(p);
    return b.length ? new Uint8Array(b) : null;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(bdtopoUrl(x, y)).catch(() => null);
    if (r && (r.status === 404 || r.status === 204)) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, new Uint8Array(0));
      fetched++;
      return null;
    }
    if (r?.ok) {
      const b = new Uint8Array(await r.arrayBuffer());
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
      fetched++;
      return b.length ? b : null;
    }
    // (429, 5xx, a network error: backed off)
    await Bun.sleep(1000 * 2 ** attempt);
  }
  failed++;
  return null;
}

type Acc = { tiles: number; bytes: number; buildings: number; withHeight: number; maxTileBuildings: number };
const zero = (): Acc => ({ tiles: 0, bytes: 0, buildings: 0, withHeight: 0, maxTileBuildings: 0 });
const disc = RINGS.slice(0, -1).map(zero);
const views = HEADINGS.map(() => RINGS.slice(0, -1).map(zero));
const seen = new Set<string>();
let decodeMs = 0;

let next = 0;
const t0 = performance.now();
async function runner() {
  while (next < tiles.length) {
    const T = tiles[next++]!;
    const b = await tileBytes(T.x, T.y);
    // (a tile counted in the ring of its nearest point, and in a view when its centre is within the field)
    const c = polar(tileLat(T.y + 0.5), tileLon(T.x + 0.5));
    const ri = ringOf(T.km);
    if (ri < 0) continue;
    const tileIn = HEADINGS.map((h) => inView(c.brg, h) || T.km < 1);
    disc[ri]!.tiles++;
    disc[ri]!.bytes += b?.length ?? 0;
    tileIn.forEach((v, k) => {
      if (v) {
        views[k]![ri]!.tiles++;
        views[k]![ri]!.bytes += b?.length ?? 0;
      }
    });
    if (!b) continue;
    const s = performance.now();
    const layer = new VectorTile(new PbfReader(b)).layers.batiment;
    let inTile = 0;
    for (let i = 0; layer && i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3 || !bdtopoStands(f.properties)) continue;
      inTile++;
      const id = String(f.properties.cleabs ?? `${T.x}/${T.y}/${i}`);
      if (seen.has(id)) continue;
      seen.add(id);
      // (its place: its first ring's mean corner)
      const ring = f.loadGeometry()[0]!;
      const e = f.extent;
      const mx = ring.reduce((a, p) => a + p.x, 0) / ring.length / e,
        my = ring.reduce((a, p) => a + p.y, 0) / ring.length / e;
      const p = polar(tileLat(T.y + my), tileLon(T.x + mx));
      const r = ringOf(p.km);
      if (r < 0) continue;
      const h = typeof f.properties.hauteur === "number" && f.properties.hauteur > 0;
      disc[r]!.buildings++;
      if (h) disc[r]!.withHeight++;
      HEADINGS.forEach((hd, k) => {
        if (inView(p.brg, hd) || p.km < 0.3) {
          views[k]![r]!.buildings++;
          if (h) views[k]![r]!.withHeight++;
        }
      });
    }
    disc[ri]!.maxTileBuildings = Math.max(disc[ri]!.maxTileBuildings, inTile);
    decodeMs += performance.now() - s;
    if ((fetched + cached + failed) % 200 === 0)
      console.log(`  ${fetched + cached + failed}/${tiles.length} tiles (${fetched} fetched, ${cached} cached, ${failed} failed)`);
  }
}
await Promise.all(Array.from({ length: 6 }, runner));
const label = (i: number) => `${RINGS[i]}–${RINGS[i + 1]} km`;
const table = (rows: Acc[]) =>
  rows.map((a, i) => ({ ring: label(i), ...a, kB: Math.round(a.bytes / 1024) }));
const out = {
  at: new Date().toISOString(),
  place: { lat: LAT0, lon: LON0, headings: HEADINGS, halfFov: HALF_FOV, radiusKm: RADIUS_KM },
  source: `Géoplateforme BD TOPO z ${BDTOPO_Z} (${bdtopoUrl(0, 0).replace(/0\/0\.pbf$/, "x/y.pbf")})`,
  tiles: { total: tiles.length, fetched, cached, failed },
  decodeMsTotal: Math.round(decodeMs),
  wallS: Math.round((performance.now() - t0) / 100) / 10,
  disc: table(disc),
  views: HEADINGS.map((h, k) => ({ heading: h, rings: table(views[k]!) })),
  note: "buildings counted once (cleabs); a tile in the ring of its nearest point; the view: ±45° of the heading from the start",
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ tiles: out.tiles, decodeMsTotal: out.decodeMsTotal, wallS: out.wallS }));
for (const r of out.disc) console.log(`  disc ${r.ring}: ${r.tiles} tiles, ${r.kB} kB, ${r.buildings} buildings (${r.withHeight} with a height)`);
for (const v of out.views)
  for (const r of v.rings) console.log(`  view ${v.heading}° ${r.ring}: ${r.tiles} tiles, ${r.kB} kB, ${r.buildings} buildings`);
console.log(`written ${OUT}`);
