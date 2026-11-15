// The FAA's CIFP read (docs/PLAN-APPROCHES.md AP0b): ARINC 424-18 fixed columns, the approaches (section P, subsection F) with
// the fixes they name — terminal waypoints (PC), runways (PG), terminal NDBs (PN), localizers (PI), enroute waypoints (EA), VHF
// navaids (D), NDBs (DB) —, the airports' magnetic variation (PA). Public domain (the FAA: « all digital products published by
// the FAA are in the public domain »); its agreement's conditions kept: not for real navigation, the FAA's error notes relayed
// (ASSETS.md). Pure: the text in, the procedures out with their legs placed and their courses true.
//
// Columns (1-based, as ARINC 424 numbers them): an approach record — 7–10 airport, 14–19 procedure (« I28R », « R19RZ »,
// « R12-Y »), 20 route type (A transition, else the approach's own letter), 21–25 transition, 27–29 sequence, 30–34 fix, 35–36
// its region, 37–38 its section, 39 continuation (0/1 primary, 2 a continuation: skipped — column 22 in the other records), 40–43 its description (43 « M » the
// missed approach point), 44 turn, 48–49 path terminator, 51–54 recommended navaid, 71–74 magnetic course (tenths; « T » last:
// true), 79–80 the navaid's section, 83 altitude description, 85–89 and 90–94 altitudes (feet, « FL180 »), 100–102 speed (kt),
// 103–106 vertical angle (hundredths, negative).

import type { ApproachKind, Leg } from "../src/world/approaches";

const FT = 0.3048;
const KT = 0.514444;

/** « N37374636 » / « W122234312 » → degrees (D M S.ss). */
export function coord(s: string): number {
  const h = s[0];
  const body = s.slice(1);
  const lat = h === "N" || h === "S";
  const d = Number(body.slice(0, lat ? 2 : 3)),
    m = Number(body.slice(lat ? 2 : 3, lat ? 4 : 5)),
    sec = Number(body.slice(lat ? 4 : 5)) / 100;
  const v = d + m / 60 + sec / 3600;
  return h === "S" || h === "W" ? -v : v;
}

/** A magnetic variation « E0140 » / « W0123 » → degrees east positive. */
const variation = (s: string) => {
  const v = Number(s.slice(1)) / 10;
  if (!Number.isFinite(v)) return 0;
  return s[0] === "W" ? -v : v;
};

const col = (l: string, a: number, b: number) => l.slice(a - 1, b);

/** An altitude field: feet, or a flight level; null when blank or unknown. */
function feet(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const fl = /^FL(\d{3})$/.exec(t);
  if (fl) return Number(fl[1]) * 100;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface Place {
  lat: number;
  lon: number;
}

/** A localizer (PI): its antenna, course (true), frequency [kHz], category, its glide. */
export interface CifpLoc {
  ident: string;
  rwy: string;
  lat: number;
  lon: number;
  crs: number;
  freq: number;
  cat?: string;
  gs?: { lat: number; lon: number; elev: number; angle: number };
}

/** A raw leg, as coded. */
interface RawLeg {
  rt: string;
  trans: string;
  seq: number;
  fix: string;
  region: string;
  sec: string;
  map: boolean;
  pt: string;
  nav: string;
  navSec: string;
  crs: string;
  altD: string;
  a1: number | null;
  a2: number | null;
  spd: number | null;
  vang: number | null;
}

export interface CifpProc {
  field: string;
  /** the procedure's id as coded (« I28R », « R19RZ ») and ours (« I28R », « R19R-Z ») */
  code: string;
  id: string;
  kind: ApproachKind;
  rwy: string;
  /** the localizer flown (ILS, LOC, LDA, SDF, IGS) */
  loc?: CifpLoc;
  /** the final's vertical angle [°] (an ILS's glide, an RNAV's), else none */
  angle?: number;
  transitions: { name: string; legs: Leg[] }[];
  final: Leg[];
  missed: Leg[];
}

export interface CifpData {
  cycle: string;
  effective: string;
  procs: CifpProc[];
  report: {
    procedures: number;
    kept: number;
    left: Record<string, number>;
    converted: Record<string, number>;
    unplaced: number;
    kinds: Record<string, number>;
  };
}

/** The procedure's letter → its kind (ARINC 424 approach route types); null: left out (back course, GLS, TACAN, MLS). */
export function kindOfLetter(c: string): ApproachKind | null {
  switch (c) {
    case "I":
      return "ILS";
    case "L":
      return "LOC";
    case "X":
      return "LDA";
    case "U":
      return "SDF";
    case "G":
      return "IGS";
    case "R":
    case "H":
    case "P":
      return "RNAV";
    case "V":
    case "S":
    case "D":
      return "VOR";
    case "N":
    case "Q":
      return "NDB";
    default:
      return null;
  }
}

/** « I28R » → 28R, « R19RZ » → 19R + Z, « R12-Y » → 12 + Y; a circling one (« VOR-A », « RNV-B ») → null. */
export function procRunway(code: string): { rwy: string; sfx: string } | null {
  const m = /^[A-Z](\d\d[LCR]?)-?([A-Z])?$/.exec(code.trim());
  if (!m) return null;
  return { rwy: m[1]!, sfx: m[2] ?? "" };
}

/** Our path terminators: the few an approach needs, the others mapped (and counted). */
const PT: Record<string, Leg["t"]> = {
  IF: "IF",
  TF: "TF",
  CF: "CF",
  DF: "DF",
  RF: "RF",
  HM: "HM",
  CA: "CA",
  VA: "VA",
  HF: "HM",
  HA: "HM",
  PI: "HM",
  AF: "RF",
  CI: "CF",
  VI: "CF",
  FC: "CF",
  FA: "CA",
  FD: "CA",
  CD: "CA",
  VD: "CA",
  VR: "VA",
  VM: "VA",
  FM: "VA",
};

/** An altitude constraint [m over the sea]: at or above, at or below (ARINC 424's description codes). */
function constraint(d: string, a1: number | null, a2: number | null): [number | null, number | null] | undefined {
  if (a1 === null) return undefined;
  const m1 = Math.round(a1 * FT),
    m2 = a2 === null ? null : Math.round(a2 * FT);
  switch (d) {
    case "+":
    case "H":
    case "J":
    case "V":
      return [m1, null];
    case "-":
      return [null, m1];
    case "B":
      return [m2, m1];
    default:
      // (« at »: blank, G, I — the glide's altitude in the second field)
      return [m1, m1];
  }
}

/** Reads the whole file. */
export function readCifp(text: string): CifpData {
  const lines = text.split(/\r?\n/);
  const hdr = lines.find((l) => l.startsWith("HDR04")) ?? "";
  const cycle = /VOLUME (\d{4})/.exec(hdr)?.[1] ?? "?";
  const effective = /EFFECTIVE (\d{1,2} [A-Z]{3} \d{4})/.exec(hdr)?.[1] ?? "";
  const pc = new Map<string, Place>(); // airport|ident (PC, PG, PN, PI)
  const en = new Map<string, Place>(); // ident|region (EA, D, DB)
  const vari = new Map<string, number>();
  const locs = new Map<string, CifpLoc>(); // airport|ident
  const pf: (RawLeg & { field: string; code: string })[] = [];
  for (const l of lines) {
    if (l.length < 100 || l[0] !== "S") continue;
    const sec = l[4];
    if (sec === "P") {
      const field = col(l, 7, 10).trim();
      const sub = l[12];
      if (sub === "A") {
        vari.set(field, variation(col(l, 52, 56)));
      } else if (sub === "C" || sub === "G" || sub === "N") {
        const id = sub === "N" ? col(l, 14, 17).trim() : col(l, 14, 18).trim();
        const la = col(l, 33, 41),
          lo = col(l, 42, 51);
        if (/^[NS]\d{8}$/.test(la) && /^[EW]\d{9}$/.test(lo)) pc.set(`${field}|${id}`, { lat: coord(la), lon: coord(lo) });
      } else if (sub === "I") {
        if (l[21] !== "0" && l[21] !== "1") continue;
        const ident = col(l, 14, 17).trim();
        const la = col(l, 33, 41),
          lo = col(l, 42, 51);
        if (!/^[NS]\d{8}$/.test(la)) continue;
        const decl = variation(col(l, 91, 95));
        const brg = Number(col(l, 52, 55)) / 10;
        const gla = col(l, 56, 64),
          glo = col(l, 65, 74);
        const ang = Number(col(l, 88, 90)) / 100;
        const cat = { "1": "I", "2": "II", "3": "III" }[l[17]!];
        const loc: CifpLoc = {
          ident,
          rwy: col(l, 28, 32).trim().replace(/^RW/, ""),
          lat: coord(la),
          lon: coord(lo),
          crs: (((brg + decl) % 360) + 360) % 360,
          freq: Number(col(l, 23, 27)) * 10,
          ...(cat ? { cat } : {}),
          ...(/^[NS]\d{8}$/.test(gla) && ang > 0
            ? { gs: { lat: coord(gla), lon: coord(glo), elev: Math.round((feet(col(l, 98, 102)) ?? 0) * FT), angle: ang } }
            : {}),
        };
        locs.set(`${field}|${ident}`, loc);
        pc.set(`${field}|${ident}`, { lat: loc.lat, lon: loc.lon });
      } else if (sub === "F") {
        if (l[38] !== "0" && l[38] !== "1") continue;
        const vang = col(l, 103, 106).trim();
        pf.push({
          field,
          code: col(l, 14, 19).trim(),
          rt: l[19]!,
          trans: col(l, 21, 25).trim(),
          seq: Number(col(l, 27, 29)),
          fix: col(l, 30, 34).trim(),
          region: col(l, 35, 36),
          sec: col(l, 37, 38),
          map: l[42] === "M",
          pt: col(l, 48, 49),
          nav: col(l, 51, 54).trim(),
          navSec: col(l, 79, 80),
          crs: col(l, 71, 74),
          altD: l[82]!,
          a1: feet(col(l, 85, 89)),
          a2: feet(col(l, 90, 94)),
          spd: feet(col(l, 100, 102)),
          vang: vang ? Number(vang) / 100 : null,
        });
      }
    } else if ((sec === "E" && l[5] === "A") || (sec === "D" && (l[5] === " " || l[5] === "B"))) {
      // (their continuation number: column 22)
      if (l[21] !== "0" && l[21] !== "1") continue;
      const id = sec === "E" ? col(l, 14, 18).trim() : col(l, 14, 17).trim();
      const region = col(l, 20, 21);
      let la = col(l, 33, 41),
        lo = col(l, 42, 51);
      // (a DME alone: its own place)
      if (!/^[NS]\d{8}$/.test(la)) (la = col(l, 56, 64)), (lo = col(l, 65, 74));
      if (/^[NS]\d{8}$/.test(la) && /^[EW]\d{9}$/.test(lo)) en.set(`${id}|${region}`, { lat: coord(la), lon: coord(lo) });
    }
  }
  // the procedures: their records in order, by airport and code
  const groups = new Map<string, (RawLeg & { field: string; code: string })[]>();
  for (const r of pf) {
    const k = `${r.field}|${r.code}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const report: CifpData["report"] = { procedures: groups.size, kept: 0, left: {}, converted: {}, unplaced: 0, kinds: {} };
  const out = (why: string) => (report.left[why] = (report.left[why] ?? 0) + 1);
  const procs: CifpProc[] = [];
  for (const [, g] of groups) {
    const { field, code } = g[0]!;
    const kind = kindOfLetter(code[0]!);
    if (!kind) {
      out(`kind ${code[0]}`);
      continue;
    }
    const pr = procRunway(code);
    if (!pr) {
      out("circling (no runway)");
      continue;
    }
    const v = vari.get(field) ?? 0;
    const place = (r: RawLeg): Place | null => {
      if (!r.fix) return null;
      if (r.sec === "PC" || r.sec === "PG" || r.sec === "PN" || r.sec === "PI") return pc.get(`${field}|${r.fix}`) ?? null;
      return en.get(`${r.fix}|${r.region}`) ?? pc.get(`${field}|${r.fix}`) ?? null;
    };
    const leg = (r: RawLeg): Leg => {
      const t = PT[r.pt];
      if (!t) report.converted[`${r.pt}→?`] = (report.converted[`${r.pt}→?`] ?? 0) + 1;
      else if (t !== r.pt) report.converted[`${r.pt}→${t}`] = (report.converted[`${r.pt}→${t}`] ?? 0) + 1;
      const p = place(r);
      if (r.fix && !p) report.unplaced++;
      const c = r.crs.trim();
      let crs: number | undefined;
      if (/^\d{4}$/.test(c)) crs = (((Number(c) / 10 + v) % 360) + 360) % 360;
      else if (/^\d{3}T$/.test(c)) crs = Number(c.slice(0, 3));
      const alt = constraint(r.altD, r.a1, r.a2);
      return {
        t: t ?? "TF",
        ...(r.fix ? { fix: r.fix } : {}),
        ...(p ? { lat: p.lat, lon: p.lon } : {}),
        ...(crs !== undefined ? { crs: Math.round(crs * 10) / 10 } : {}),
        ...(alt ? { alt } : {}),
        ...(r.spd ? { spd: Math.round(r.spd * KT) } : {}),
      };
    };
    const sorted = (rs: RawLeg[]) => [...rs].sort((a, b) => a.seq - b.seq);
    const fin = sorted(g.filter((r) => r.rt !== "A"));
    const iMap = fin.findIndex((r) => r.map);
    // (the missed approach: after the missed approach point — else after the runway)
    const cut = iMap >= 0 ? iMap : fin.findIndex((r) => r.sec === "PG");
    if (cut < 0) {
      out("no missed approach point");
      continue;
    }
    const final = fin.slice(0, cut + 1).map(leg);
    const missed = fin.slice(cut + 1).map(leg);
    if (!final.length || final[0]!.lat === undefined) {
      out("final's first fix unplaced");
      continue;
    }
    const names = [...new Set(g.filter((r) => r.rt === "A").map((r) => r.trans))];
    const transitions = names.map((name) => ({ name, legs: sorted(g.filter((r) => r.rt === "A" && r.trans === name)).map(leg) }));
    // (the localizer flown: the final's recommended navaid among the localizers)
    const locRef = fin.find((r) => r.navSec === "PI" && r.nav);
    const loc = locRef ? locs.get(`${field}|${locRef.nav}`) : undefined;
    if ((kind === "ILS" || kind === "LOC" || kind === "LDA" || kind === "SDF" || kind === "IGS") && !loc) {
      out("localizer unknown");
      continue;
    }
    const vang = fin.find((r) => r.vang !== null)?.vang;
    const angle = loc?.gs?.angle ?? (vang ? Math.abs(vang) : undefined);
    const letter = code[0] === "S" || code[0] === "D" ? "V" : code[0] === "Q" ? "N" : code[0] === "P" ? "R" : code[0]!;
    procs.push({
      field,
      code,
      id: `${letter}${pr.rwy}${pr.sfx ? `-${pr.sfx}` : ""}`,
      kind,
      rwy: pr.rwy,
      ...(loc ? { loc } : {}),
      ...(angle ? { angle } : {}),
      transitions,
      final,
      missed,
    });
    report.kept++;
    report.kinds[kind] = (report.kinds[kind] ?? 0) + 1;
  }
  return { cycle, effective, procs, report };
}
