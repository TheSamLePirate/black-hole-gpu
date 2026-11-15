// The approaches of every runway's end (docs/PLAN-APPROCHES.md §4.1, AP0): the real ILS of FlightGear's nav.dat (GPL, cycle 2013.10 —
// scripts/build-approaches.ts → assets/approaches/v1/, served at approaches/v1/, tiles aligned on the runways') where it has one, and
// at every end an approach built on the runway as FlightGear builds its own (src/Autopilot/route_mgr.cxx createDefaultApproach): its
// IAF, IF and FAF on the extended centreline, the glide intercepted from below. Pure, the same module for the game and the crew's
// console (world/runways.ts's way): no import of the simulator; each fetches the tiles from its own site.
//
// Heights are over the sea [m] (the data's, the runways'); the geoid is the reader's (h + N at the boundary: CLAUDE.md). Courses
// are true [°]. A game's data, not navigation: never for real flight (the FAA's condition on its CIFP, kept for all of them).

import { wgs84Direct, wgs84Inverse } from "../system/ellipsoid";
import { type Airfield, type Runway, runwayTileListeners, tileKey } from "./runways";

export type ApproachKind = "ILS" | "LOC" | "LDA" | "SDF" | "IGS" | "RNAV" | "VOR" | "NDB" | "VIS";
export type ApproachSource = "cifp" | "navdat" | "built";
// (heights over the sea, courses true; the CIFP's magnetic courses turned true by its airport's variation at build time)

/** A leg of a procedure (ARINC 424's path terminators, the few an approach needs). */
export interface Leg {
  t: "IF" | "TF" | "CF" | "DF" | "RF" | "HM" | "CA" | "VA";
  /** the fix it ends at: its name, its place [°] */
  fix?: string;
  lat?: number;
  lon?: number;
  /** a course to fly [° true] */
  crs?: number;
  /** at or above, at or below [m over the sea] (null: none) */
  alt?: [number | null, number | null];
  /** a speed limit [m/s] */
  spd?: number;
}

export interface Approach {
  /** « I31R » (ILS), « L31R » (LOC), « X31R » (LDA/SDF/IGS), « C31R » (built) */
  id: string;
  field: string;
  /** the runway's end (« 31R ») */
  rwy: string;
  kind: ApproachKind;
  source: ApproachSource;
  /** the data's cycle (« 2013.10 ») */
  cycle?: string;
  /** the end's threshold, its elevation [m over the sea], the final course [° true] */
  thr: { lat: number; lon: number; elev: number };
  crs: number;
  /** the glide's slope [°] — the real one, else 3° —, its crossing height over the threshold [m] */
  angle: number;
  tch: number;
  loc?: { lat: number; lon: number; crs: number; freq: number; ident: string; cat?: string; range: number };
  gs?: { lat: number; lon: number; elev: number; angle: number };
  dme?: { lat: number; lon: number };
  markers?: { kind: "O" | "M" | "I"; lat: number; lon: number }[];
  /** the decision height [m over the threshold] and where it comes from */
  dh: { m: number; why: string };
  /** IAF → IF (« vectors » is always possible besides) */
  transitions: Leg[][];
  /** IF → FAF → threshold */
  final: Leg[];
  /** the missed approach: ahead to an altitude, then back to the IF */
  missed: Leg[];
  /** a renumbered runway: its name in the data; the runway's thresholds rebuilt (OurAirports' « approx ») */
  was?: string;
  approx?: boolean;
  /** the localizer's course off the runway's [°] (an offset aid) */
  off?: number;
}

/** A tile's record, as scripts/build-approaches.ts writes it. */
export interface ApproachRecord {
  f: string;
  r: string;
  was?: string;
  k: string;
  id: string;
  fq: number;
  loc: [number, number, number];
  cat?: string;
  rng: number;
  gs?: [number, number, number, number];
  dme?: [number, number];
  mk?: [string, number, number][];
  tie: "n" | "g";
  off: number;
}

/** A leg in a tile: [type, fix, lat, lon, course ° true, at or above m, at or below m, speed m/s] — nulls where none, the trailing
 *  ones dropped. */
export type LegRecord = [
  Leg["t"],
  string?,
  (number | null)?,
  (number | null)?,
  (number | null)?,
  (number | null)?,
  (number | null)?,
  (number | null)?,
];

/** A procedure of the FAA's CIFP in a tile (scripts/build-approaches.ts, AP0b): the US's published approaches, whole. */
export interface CifpRecord {
  f: string;
  /** ours (« I28R », « R19R-Z ») and as coded (« R19RZ ») */
  id: string;
  code: string;
  k: ApproachKind;
  r: string;
  /** its runway's name in the CIFP when ours differs (renumbered, or our data without its side letter) */
  was?: string;
  /** the localizer: lat, lon, course ° true, frequency kHz, ident, category */
  loc?: [number, number, number, number, string, string?];
  /** the glide: lat, lon, elevation m, slope ° */
  gs?: [number, number, number, number];
  /** the final's vertical angle [°] */
  va?: number;
  tr: [string, LegRecord[]][];
  fin: LegRecord[];
  ma: LegRecord[];
}

/** A tile's leg back to a leg. */
export function legOf(r: LegRecord): Leg {
  const [t, fix, lat, lon, crs, lo, hi, spd] = r;
  return {
    t,
    ...(fix ? { fix } : {}),
    ...(lat != null && lon != null ? { lat, lon } : {}),
    ...(crs != null ? { crs } : {}),
    ...(lo != null || hi != null ? { alt: [lo ?? null, hi ?? null] as [number | null, number | null] } : {}),
    ...(spd != null ? { spd } : {}),
  };
}

/** A leg to a tile's leg (places to 1e-5°, about a metre). */
export function legRecord(l: Leg): LegRecord {
  const q = (x: number | undefined) => (x === undefined ? null : Math.round(x * 1e5) / 1e5);
  const r: LegRecord = [l.t, l.fix ?? "", q(l.lat), q(l.lon), l.crs ?? null, l.alt?.[0] ?? null, l.alt?.[1] ?? null, l.spd ?? null];
  while (r.length > 1 && (r[r.length - 1] === null || r[r.length - 1] === "")) r.pop();
  return r;
}

const FT = 0.3048;
const NM = 1852;
/** the built procedure's distances and heights, FlightGear's (createDefaultApproach: 12 NM at the threshold + 4 000 ft, 8 NM at
 *  + 2 000 ft, the glide intercepted from below), the IAF a thousand feet lower: a 2.4° descent to the IF, not 4.7° */
export const BUILT = { iafNm: 12, iafFt: 3000, ifNm: 8, ifFt: 2000, tchFt: 50, missedFt: 3000, missedNm: 5 } as const;

/** The decision height by the approach's kind and category [m over the threshold] and why (no free source publishes minima). */
export function decisionHeight(kind: ApproachKind, cat: string | undefined, approx: boolean): { m: number; why: string } {
  if (approx) return { m: 400 * FT, why: "built on a runway rebuilt from its number: 400 ft" };
  if (kind === "ILS") {
    if (cat === "III") return { m: 50 * FT, why: "CAT III: 50 ft" };
    if (cat === "II") return { m: 100 * FT, why: "CAT II: 100 ft" };
    return { m: 200 * FT, why: "CAT I: 200 ft" };
  }
  if (kind === "VIS") return { m: 250 * FT, why: "built: 250 ft" };
  if (kind === "RNAV" && cat === "V") return { m: 250 * FT, why: "RNAV with a vertical path: 250 ft" };
  return { m: 400 * FT, why: `${kind}, no glide: 400 ft` };
}

/** The runway's end named `rwy` of the field: its threshold, the far one, its landing course [° true]. */
export function runwayEnd(
  f: Airfield,
  rwy: string,
): { rw: Runway; thr: Approach["thr"]; crs: number; far: { lat: number; lon: number } } | null {
  const n = (s: string) => s.replace(/^0+(?=\d)/, "").toUpperCase();
  for (const rw of f.runways) {
    if (n(rw.le) === n(rwy))
      return { rw, thr: { lat: rw.lat1, lon: rw.lon1, elev: rw.elev1 || f.elev }, crs: rw.hdg, far: { lat: rw.lat2, lon: rw.lon2 } };
    if (n(rw.he) === n(rwy))
      return {
        rw,
        thr: { lat: rw.lat2, lon: rw.lon2, elev: rw.elev2 || f.elev },
        crs: (rw.hdg + 180) % 360,
        far: { lat: rw.lat1, lon: rw.lon1 },
      };
  }
  return null;
}

/** A point on the final's extended centreline `d` [m] before the threshold (along the course flown back). */
function before(thr: { lat: number; lon: number }, crs: number, d: number) {
  return wgs84Direct(thr.lat, thr.lon, ((crs + 180) * Math.PI) / 180, d);
}

/**
 * The procedure's legs about a final course and slope: the IAF's transition, IF → FAF (the glide met from below at the IF's
 * height) → the threshold, the missed approach (ahead to the threshold + 3 000 ft, 5 NM past it, then back to the IF).
 */
export function builtLegs(
  rwy: string,
  thr: Approach["thr"],
  crs: number,
  angle: number,
): Pick<Approach, "transitions" | "final" | "missed"> {
  const t = (angle * Math.PI) / 180;
  const ifAlt = thr.elev + BUILT.ifFt * FT;
  const fafD = (BUILT.ifFt * FT - BUILT.tchFt * FT) / Math.tan(t);
  const iaf = before(thr, crs, BUILT.iafNm * NM),
    iff = before(thr, crs, BUILT.ifNm * NM),
    faf = before(thr, crs, fafD);
  const ma = wgs84Direct(thr.lat, thr.lon, (crs * Math.PI) / 180, BUILT.missedNm * NM);
  const r = rwy.replace(/^0+(?=\d)/, "");
  return {
    transitions: [
      [
        { t: "IF", fix: `IA${r}`, ...iaf, alt: [thr.elev + BUILT.iafFt * FT, null] },
        { t: "TF", fix: `IF${r}`, ...iff, alt: [ifAlt, null] },
      ],
    ],
    final: [
      { t: "IF", fix: `IF${r}`, ...iff, alt: [ifAlt, null] },
      { t: "CF", fix: `FF${r}`, ...faf, crs, alt: [ifAlt, ifAlt] },
      { t: "CF", fix: `RW${r}`, ...thr, crs, alt: [thr.elev + BUILT.tchFt * FT, null] },
    ],
    missed: [
      { t: "CA", crs, alt: [thr.elev + BUILT.missedFt * FT, null] },
      { t: "DF", fix: `MA${r}`, ...ma },
      { t: "DF", fix: `IF${r}`, ...iff, alt: [ifAlt, null] },
    ],
  };
}

/** A real localizer's approach: its antenna and course, its glide, the legs built about them (no free procedure outside the US). */
export function realApproach(f: Airfield, r: ApproachRecord, cycle: string): Approach | null {
  const e = runwayEnd(f, r.r);
  if (!e) return null;
  const kind = (["ILS", "LOC", "LDA", "SDF", "IGS"].includes(r.k) ? r.k : "LOC") as ApproachKind;
  const angle = r.gs ? r.gs[3] : 3;
  const crs = r.loc[2];
  const letter = kind === "ILS" ? "I" : kind === "LOC" ? "L" : "X";
  return {
    id: `${letter}${r.r}`,
    field: f.ident,
    rwy: r.r,
    kind,
    source: "navdat",
    cycle,
    thr: e.thr,
    crs,
    angle,
    tch: BUILT.tchFt * FT,
    loc: { lat: r.loc[0], lon: r.loc[1], crs, freq: r.fq, ident: r.id, ...(r.cat ? { cat: r.cat } : {}), range: r.rng },
    ...(r.gs ? { gs: { lat: r.gs[0], lon: r.gs[1], elev: r.gs[2], angle: r.gs[3] } } : {}),
    ...(r.dme ? { dme: { lat: r.dme[0], lon: r.dme[1] } } : {}),
    ...(r.mk ? { markers: r.mk.map(([k, lat, lon]) => ({ kind: k as "O" | "M" | "I", lat, lon })) } : {}),
    dh: decisionHeight(kind, r.cat, e.rw.approx),
    ...builtLegs(r.r, e.thr, crs, angle),
    ...(r.was ? { was: r.was } : {}),
    ...(e.rw.approx ? { approx: true } : {}),
    ...(r.off > 0.5 ? { off: r.off } : {}),
  };
}

/** A published approach of the FAA's CIFP: its own transitions, final and missed approach; its localizer, glide; on our runway's
 *  threshold (the game's runway, the same as drawn). */
export function cifpApproach(f: Airfield, r: CifpRecord, cycle: string): Approach | null {
  const e = runwayEnd(f, r.r);
  if (!e) return null;
  const fin = r.fin.map(legOf);
  // (the final's course: the localizer's, else the last leg's to the runway, else the runway's)
  const lastCrs = [...fin].reverse().find((l) => l.crs !== undefined)?.crs;
  const crs = r.loc ? r.loc[2] : (lastCrs ?? e.crs);
  const angle = r.gs ? r.gs[3] : (r.va ?? 3);
  const cat = r.loc?.[5] ?? (r.k === "RNAV" && r.va ? "V" : undefined);
  return {
    id: r.id,
    field: f.ident,
    rwy: r.r,
    kind: r.k,
    source: "cifp",
    cycle,
    thr: e.thr,
    crs,
    angle,
    tch: BUILT.tchFt * FT,
    ...(r.loc
      ? {
          loc: {
            lat: r.loc[0],
            lon: r.loc[1],
            crs: r.loc[2],
            freq: r.loc[3],
            ident: r.loc[4],
            ...(r.loc[5] ? { cat: r.loc[5] } : {}),
            range: 18,
          },
        }
      : {}),
    ...(r.gs ? { gs: { lat: r.gs[0], lon: r.gs[1], elev: r.gs[2], angle: r.gs[3] } } : {}),
    dh: decisionHeight(r.k, cat, e.rw.approx),
    transitions: r.tr.map(([, legs]) => legs.map(legOf)),
    final: fin,
    missed: r.ma.map(legOf),
    ...(r.was ? { was: r.was } : {}),
    ...(e.rw.approx ? { approx: true } : {}),
  };
}

/** The approach built for an end without a real aid (or beside it): the runway's axis, a 3° glide. */
export function builtApproach(f: Airfield, rwy: string): Approach | null {
  const e = runwayEnd(f, rwy);
  if (!e) return null;
  return {
    id: `C${rwy}`,
    field: f.ident,
    rwy,
    kind: "VIS",
    source: "built",
    thr: e.thr,
    crs: e.crs,
    angle: 3,
    tch: BUILT.tchFt * FT,
    dh: decisionHeight("VIS", undefined, e.rw.approx),
    ...builtLegs(rwy, e.thr, e.crs, 3),
    ...(e.rw.approx ? { approx: true } : {}),
  };
}

/** Which ends land (not water, not a heliport's pad): both ends of each runway. */
const landable = (rw: Runway) => rw.surface !== "water";

/**
 * Every approach of a field: at each end of each runway its real ones (ILS first, the highest category first) then the one built
 * for it — every end has at least one. `records`: the field's records from its tile.
 */
export function approachesOf(
  f: Airfield,
  records: readonly ApproachRecord[],
  cycle = "2013.10",
  cifp: readonly CifpRecord[] = [],
  cifpCycle = "",
): Approach[] {
  const out: Approach[] = [];
  const rank = (a: Approach) =>
    ({ ILS: 0, LOC: 1, LDA: 2, SDF: 2, IGS: 2, RNAV: 3, VOR: 4, NDB: 5, VIS: 6 })[a.kind] * 10 - (a.loc?.cat?.length ?? 0);
  for (const rw of f.runways.filter(landable))
    for (const end of [rw.le, rw.he]) {
      if (!end) continue;
      // (the FAA's published ones first — current, whole —; nav.dat's for a kind the CIFP does not have at that end)
      const pub = cifp
        .filter((r) => r.f === f.ident && r.r === end)
        .map((r) => cifpApproach(f, r, cifpCycle))
        .filter((a): a is Approach => !!a);
      const kinds = new Set(pub.map((a) => a.kind));
      const real = records
        .filter((r) => r.f === f.ident && r.r === end)
        .map((r) => realApproach(f, r, cycle))
        .filter((a): a is Approach => !!a && !kinds.has(a.kind));
      out.push(...[...pub, ...real].sort((a, b) => rank(a) - rank(b)));
      const b = builtApproach(f, end);
      if (b) out.push(b);
    }
  return out;
}

/** A tile's records and its data's cycle. */
export function decodeApproachTile(json: { v: number; src?: { navdat?: string; cifp?: string }; a?: ApproachRecord[]; p?: CifpRecord[] }): {
  cycle: string;
  records: ApproachRecord[];
  cifpCycle: string;
  cifp: CifpRecord[];
} {
  return { cycle: json.src?.navdat ?? "2013.10", records: json.a ?? [], cifpCycle: json.src?.cifp ?? "", cifp: json.p ?? [] };
}

// ---------------------------------------------------------------------------------------------------- the tiles, on demand

let base = "approaches/v1/";
/** Where the tiles are fetched (relative to the page: the game's root, the crew's ../). */
export function setApproachesBase(url: string) {
  base = url.endsWith("/") ? url : `${url}/`;
}
const tiles = new Map<string, ReturnType<typeof decodeApproachTile> & { used: number }>();
const pending = new Map<string, Promise<void>>();
let clock = 0;
/** a tile arrived: what shows approaches redraws */
export const approachesEvents = { onLoad: (_key: string) => {} };
let index: Record<string, number> | null = null;
let indexP: Promise<void> | null = null;
/** the index's fetch failed at [ms]: not asked again for 30 s (the maps ask every frame) — and never kept as « no tile has
 *  approaches »: before 15 Nov 2026 a first ask offline, or before the server answered, marked every tile empty for the session */
let indexFailedAt: number | null = null;

/** The failed fetches forgotten: asked again at once (the network back; a test's own fetch put in after another's failed). */
export function approachesRetry() {
  indexFailedAt = null;
}

/** The tile of a place fetched (once; a tile without real approaches is none to fetch). */
export async function loadApproachTile(lat: number, lon: number): Promise<void> {
  return loadApproachKey(tileKey(lat, lon));
}

// (fetched with the runways' own tile: there before an approach is asked — PLAN-APPROCHES AP1; the map, the radar load them)
runwayTileListeners.add((key) => void loadApproachKey(key));

async function loadApproachKey(key: string): Promise<void> {
  if (tiles.has(key)) return;
  if (!index && indexFailedAt !== null && performance.now() - indexFailedAt < 30_000) return;
  indexP ??= fetch(`${base}index.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { tiles?: Record<string, number> }) => {
      index = j?.tiles ?? {};
      indexFailedAt = null;
    })
    .catch(() => {
      indexFailedAt = performance.now();
      indexP = null;
    });
  await indexP;
  // (the index not in — its fetch failed —: the tile not known either way, asked again later)
  if (!index) return;
  if (!index[key]) {
    tiles.set(key, { cycle: "", records: [], cifpCycle: "", cifp: [], used: ++clock });
    return;
  }
  const p =
    pending.get(key) ??
    fetch(`${base}t${key}.json`)
      .then((r) => (r.ok ? r.json() : { v: 1, a: [] }))
      .then((j) => {
        tiles.set(key, { ...decodeApproachTile(j), used: ++clock });
        // (the least recently used dropped past 64 tiles)
        if (tiles.size > 64) {
          const old = [...tiles].sort((a, b) => a[1].used - b[1].used)[0]!;
          tiles.delete(old[0]);
        }
        approachesEvents.onLoad(key);
      })
      .catch(() => {})
      .finally(() => pending.delete(key));
  pending.set(key, p);
  await p;
}

/** Whether a place's tile is in (fetched, or known to have none) — or the index failed (offline): its built approaches flown
 *  meanwhile, the real ones asked again later. */
export function approachTileIn(lat: number, lon: number): boolean {
  return tiles.has(tileKey(lat, lon)) || (!index && indexFailedAt !== null);
}

/** A field's approaches with its tile's real ones when it is in (the built ones only, until it comes). */
export function approachesFor(f: Airfield): Approach[] {
  const t = tiles.get(tileKey(f.lat, f.lon));
  if (t) t.used = ++clock;
  return approachesOf(
    f,
    t?.records.filter((r) => r.f === f.ident) ?? [],
    t?.cycle || "2013.10",
    t?.cifp.filter((r) => r.f === f.ident) ?? [],
    t?.cifpCycle ?? "",
  );
}

/** The same, its tile awaited. */
export async function approachesForAsync(f: Airfield): Promise<Approach[]> {
  await loadApproachTile(f.lat, f.lon);
  return approachesFor(f);
}

/** An approach's source said short (« ILS · nav.dat 2013 », « built »), for every screen that lists it. */
export function sourceLabel(a: Approach): string {
  if (a.source === "built") return "built";
  if (a.source === "cifp") return `FAA CIFP ${a.cycle ?? ""}`.trim();
  return `nav.dat ${(a.cycle ?? "").slice(0, 4)}`.trim();
}

/** Distance and initial course from a place to an approach's threshold [m, ° true]. */
export function toThreshold(a: Approach, lat: number, lon: number): { d: number; crs: number } {
  const g = wgs84Inverse(lat, lon, a.thr.lat, a.thr.lon);
  return { d: g.d, crs: ((((g.az * 180) / Math.PI) % 360) + 360) % 360 };
}

/** The credit to show where real approaches are listed. */
export const APPROACHES_CREDIT = "nav.dat 2013.10 (Robin A. Peel, GPL, via FlightGear)";
