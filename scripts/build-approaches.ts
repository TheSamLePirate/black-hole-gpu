// The approaches' real data (docs/PLAN-APPROCHES.md AP0 — Sam, 15 Nov 2026: « faisons comme FlightGear », nothing paid for):
// the world's ILS from FlightGear's nav.dat (Robin A. Peel, cycle 2013.10, GPL v2 or later — assets/approaches/raw/nav.dat.gz,
// git-ignored, from fgdata/Navaids), each localizer tied to one of our runways' ends (assets/runways/v1, OurAirports): by its
// airfield's code and its runway's name, else by geometry — the antenna beyond the far end of a runway of the field, on its
// extended centreline within 3°, under 1.5 km from that end (a runway renumbered since 2013: BIKF's 02/20 now 01/19) —; a
// localizer more than 3° off its runway kept when it names itself an LDA, an SDF or an IGS (an offset approach), else left out
// and counted; a field closed or gone left out and counted. With each its glide (its real slope), its DME, its marker beacons.
//
// Out: assets/approaches/v1/t<la>_<lo>.json — the runways' tiles (world/runways.ts tileKey): each tied localizer as a record —,
// report.json (the counts and what was left out, by reason). The FAA's CIFP (public domain) comes in AP0b.
//
//   bun scripts/build-approaches.ts            # → assets/approaches/v1/

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { wgs84Inverse } from "../src/system/ellipsoid";
import { type Airfield, decodeTile, type Runway, tileKey } from "../src/world/runways";

const RAW = "assets/approaches/raw";
const OUT = "assets/approaches/v1";
const RUNWAYS = "assets/runways/v1";
const FT = 0.3048;

/** One radio aid of nav.dat (its rows 4–9, 12, 13). */
export interface NavRow {
  type: number;
  lat: number;
  lon: number;
  /** [m over the sea] */
  elev: number;
  /** [kHz] (×10 of nav.dat's 10 kHz unit) */
  freq: number;
  /** [NM] */
  range: number;
  /** the type's own figure: a localizer's true course, a glide's slope [°] × 100 000 + its course (300134.020: 3.00°, 134.020°),
   *  a DME's bias */
  extra: number;
  ident: string;
  field: string;
  rwy: string;
  name: string;
}

/** nav.dat's rows of the types an approach uses. */
export function readNavDat(text: string): NavRow[] {
  const out: NavRow[] = [];
  for (const line of text.split("\n")) {
    const p = line.trim().split(/\s+/);
    const type = Number(p[0]);
    if (!(type >= 4 && type <= 9) && type !== 12 && type !== 13) continue;
    if (p.length < 10) continue;
    out.push({
      type,
      lat: Number(p[1]),
      lon: Number(p[2]),
      elev: Number(p[3]) * FT,
      freq: Number(p[4]) * 10,
      range: Number(p[5]),
      extra: Number(p[6]),
      ident: p[7]!,
      field: p[8]!,
      rwy: p[9]!,
      name: p.slice(10).join(" "),
    });
  }
  return out;
}

/** A runway end's name compared without its leading zero (« 09 » and « 9 »). */
export const endName = (s: string) => s.replace(/^0+(?=\d)/, "").toUpperCase();

export interface EndRef {
  rw: Runway;
  /** 1: the le end, 2: the he end */
  end: 1 | 2;
  name: string;
  /** the landing direction from that threshold [° true] */
  hdg: number;
  /** that threshold, and the far one */
  thr: { lat: number; lon: number };
  far: { lat: number; lon: number };
}

export function endsOf(f: Airfield): EndRef[] {
  return f.runways.flatMap((rw) => [
    { rw, end: 1 as const, name: rw.le, hdg: rw.hdg, thr: { lat: rw.lat1, lon: rw.lon1 }, far: { lat: rw.lat2, lon: rw.lon2 } },
    {
      rw,
      end: 2 as const,
      name: rw.he,
      hdg: (rw.hdg + 180) % 360,
      thr: { lat: rw.lat2, lon: rw.lon2 },
      far: { lat: rw.lat1, lon: rw.lon1 },
    },
  ]);
}

const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const OFFSET_KIND = /LDA|SDF|IGS/i;

export type TieWay = "name" | "geometry";
export interface Tie {
  end: EndRef;
  way: TieWay;
  /** the localizer's course off the runway's [°] */
  off: number;
}

/**
 * A localizer tied to one of the field's ends: by its runway's name when its course agrees within 3° (or it is an offset aid),
 * else by geometry; null and why when none fits.
 */
export function tieLocalizer(loc: NavRow, f: Airfield): Tie | { why: string } {
  const ends = endsOf(f).filter((e) => e.rw.surface !== "water");
  const offsetAid = OFFSET_KIND.test(loc.name);
  const named = ends.find((e) => endName(e.name) === endName(loc.rwy));
  if (named) {
    const off = angDiff(loc.extra, named.hdg);
    if (off <= 3 || offsetAid) return { end: named, way: "name", off };
  }
  // (by geometry: on the extended centreline of an end, beyond its far threshold, within 1.5 km of it)
  let best: Tie | null = null,
    bestD = Infinity;
  for (const e of ends) {
    const off = angDiff(loc.extra, e.hdg);
    if (off > 3) continue;
    const g = wgs84Inverse(e.far.lat, e.far.lon, loc.lat, loc.lon);
    if (g.d > 1500) continue;
    // (beyond the far end along the landing direction, and near the centreline)
    const along = g.d * Math.cos(g.az - (e.hdg * Math.PI) / 180);
    const across = Math.abs(g.d * Math.sin(g.az - (e.hdg * Math.PI) / 180));
    if (along < -300 || across > 250) continue;
    if (g.d < bestD) (bestD = g.d), (best = { end: e, way: "geometry", off });
  }
  if (best) return best;
  if (named) return { why: "course" };
  return { why: "runway" };
}

/** A tied localizer as the tiles keep it. */
export interface ApproachRecord {
  /** the field's ident (our tiles'), the end's name (ours), the end's name in nav.dat when it differs (renumbered) */
  f: string;
  r: string;
  was?: string;
  /** « ILS » | « LOC » | « LDA » | « SDF » | « IGS » */
  k: string;
  id: string;
  /** [kHz] */
  fq: number;
  /** the antenna and the true course [°], quantized */
  loc: [number, number, number];
  /** « I » | « II » | « III » when an ILS says it */
  cat?: string;
  /** [NM] */
  rng: number;
  /** the glide's antenna, its elevation [m over the sea], its slope [°] */
  gs?: [number, number, number, number];
  dme?: [number, number];
  /** the markers: « O » | « M » | « I », place */
  mk?: [string, number, number][];
  /** how it was tied: « n » by name, « g » by geometry; the course off the runway's [°] */
  tie: "n" | "g";
  off: number;
}

const q5 = (x: number) => Math.round(x * 1e5) / 1e5;

export function kindOf(loc: NavRow, hasGs: boolean): string {
  const n = loc.name.toUpperCase();
  if (/LDA/.test(n)) return "LDA";
  if (/SDF/.test(n)) return "SDF";
  if (/IGS/.test(n)) return "IGS";
  return hasGs ? "ILS" : "LOC";
}

export function catOf(name: string): string | undefined {
  const m = /cat-(III|II|I)\b/i.exec(name);
  return m ? m[1]!.toUpperCase() : undefined;
}

if (import.meta.main) {
  const text = gunzipSync(readFileSync(`${RAW}/nav.dat.gz`)).toString("latin1");
  const nav = readNavDat(text);
  // (its version line — after a blank or « I » first line —: the data's cycle)
  const cycle = /data cycle (\d{4}\.\d{2})/.exec(text.slice(0, 400))?.[1] ?? "?";
  // (our airfields, each by its codes)
  const byCode = new Map<string, Airfield>();
  for (const name of readdirSync(RUNWAYS))
    if (/^t-?\d/.test(name))
      for (const a of decodeTile(JSON.parse(readFileSync(`${RUNWAYS}/${name}`, "utf8")))) {
        byCode.set(a.ident, a);
        if (a.icao) byCode.set(a.icao, a);
      }
  const key = (r: NavRow) => `${r.field}|${endName(r.rwy)}`;
  const gsBy = new Map<string, NavRow>(),
    dmeBy = new Map<string, NavRow>(),
    mkBy = new Map<string, NavRow[]>();
  for (const r of nav) {
    if (r.type === 6) gsBy.set(`${key(r)}|${r.ident}`, r);
    else if ((r.type === 12 || r.type === 13) && /ILS|LOC|LDA|IGS|SDF/i.test(r.name)) dmeBy.set(`${r.field}|${r.ident}`, r);
    else if (r.type >= 7 && r.type <= 9) mkBy.set(key(r), [...(mkBy.get(key(r)) ?? []), r]);
  }
  const locs = nav.filter((r) => r.type === 4 || r.type === 5);
  const tiles = new Map<string, ApproachRecord[]>();
  const report = {
    cycle,
    localizers: locs.length,
    tied: 0,
    byName: 0,
    byGeometry: 0,
    renumbered: 0,
    offsetAids: 0,
    withGlide: 0,
    badGlide: 0,
    left: { field: 0, runway: 0, course: 0 } as Record<string, number>,
    leftOut: [] as string[],
    offDeg: { p50: 0, p90: 0, over1: 0 },
    kinds: {} as Record<string, number>,
    cats: {} as Record<string, number>,
  };
  const offs: number[] = [];
  for (const loc of locs) {
    const f = byCode.get(loc.field);
    if (!f) {
      report.left.field!++;
      report.leftOut.push(`${loc.field} ${loc.rwy} ${loc.ident}: field`);
      continue;
    }
    const t = tieLocalizer(loc, f);
    if ("why" in t) {
      report.left[t.why] = (report.left[t.why] ?? 0) + 1;
      report.leftOut.push(`${loc.field} ${loc.rwy} ${loc.ident}: ${t.why}`);
      continue;
    }
    let gs = gsBy.get(`${key(loc)}|${loc.ident}`);
    // (a slope outside 2–7.5° — Lugano's 6.65° the steepest in service — a data error: the glide left out, counted)
    if (gs) {
      const a = Math.floor(gs.extra / 1000) / 100;
      if (!(a >= 2 && a <= 7.5)) {
        report.badGlide++;
        report.leftOut.push(`${loc.field} ${loc.rwy} ${loc.ident}: glide ${a}°`);
        gs = undefined;
      }
    }
    const dme = dmeBy.get(`${loc.field}|${loc.ident}`);
    const mk = mkBy.get(key(loc)) ?? [];
    const k = kindOf(loc, !!gs);
    const rec: ApproachRecord = {
      f: f.ident,
      r: t.end.name,
      ...(endName(t.end.name) !== endName(loc.rwy) ? { was: loc.rwy } : {}),
      k,
      id: loc.ident,
      fq: loc.freq,
      loc: [q5(loc.lat), q5(loc.lon), Math.round(loc.extra * 1000) / 1000],
      ...(catOf(loc.name) ? { cat: catOf(loc.name) } : {}),
      rng: loc.range,
      ...(gs ? { gs: [q5(gs.lat), q5(gs.lon), Math.round(gs.elev * 10) / 10, Math.floor(gs.extra / 1000) / 100] } : {}),
      ...(dme ? { dme: [q5(dme.lat), q5(dme.lon)] } : {}),
      ...(mk.length ? { mk: mk.map((m) => [m.type === 7 ? "O" : m.type === 8 ? "M" : "I", q5(m.lat), q5(m.lon)]) } : {}),
      tie: t.way === "name" ? "n" : "g",
      off: Math.round(t.off * 100) / 100,
    };
    const tk = tileKey(f.lat, f.lon);
    tiles.set(tk, [...(tiles.get(tk) ?? []), rec]);
    report.tied++;
    if (t.way === "name") report.byName++;
    else report.byGeometry++;
    if (rec.was) report.renumbered++;
    if (k === "LDA" || k === "SDF" || k === "IGS") report.offsetAids++;
    if (gs) report.withGlide++;
    report.kinds[k] = (report.kinds[k] ?? 0) + 1;
    if (rec.cat) report.cats[rec.cat] = (report.cats[rec.cat] ?? 0) + 1;
    offs.push(t.off);
  }
  offs.sort((a, b) => a - b);
  report.offDeg = {
    p50: Math.round(offs[Math.floor(offs.length * 0.5)]! * 100) / 100,
    p90: Math.round(offs[Math.floor(offs.length * 0.9)]! * 100) / 100,
    over1: offs.filter((x) => x > 1).length,
  };
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  let bytes = 0;
  for (const [tk, list] of tiles) {
    const json = JSON.stringify({ v: 1, src: { navdat: cycle }, a: list });
    bytes += json.length;
    writeFileSync(`${OUT}/t${tk}.json`, json);
  }
  const index = {
    v: 1,
    built: new Date().toISOString().slice(0, 10),
    credit: `nav.dat ${cycle} (Robin A. Peel, GPL v2+, via FlightGear)`,
    tiles: Object.fromEntries([...tiles].map(([k, v]) => [k, v.length])),
  };
  writeFileSync(`${OUT}/index.json`, JSON.stringify(index));
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify({ ...report, bytes, tiles: tiles.size }, null, 1)}\n`);
  console.log(
    `build-approaches: nav.dat ${cycle}: ${report.localizers} localizers, ${report.tied} tied (${report.byName} by name, ${report.byGeometry} by geometry, ${report.renumbered} renumbered, ${report.offsetAids} offset aids), left out ${JSON.stringify(report.left)}; course off p50 ${report.offDeg.p50}°, p90 ${report.offDeg.p90}°; ${tiles.size} tiles, ${(bytes / 1024).toFixed(0)} KB`,
  );
}
