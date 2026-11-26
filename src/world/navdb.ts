// The navigation database (docs/PLAN-A320-VOL-AAA.md N1): the world's radio aids, named fixes and airways (scripts/build-navdb.ts →
// assets/nav/v1, FlightGear's Navaids, cycle 2013.10, GPL v2 or later — assets/nav/README.md), in the runways' 5° tiles. Fetched a tile at
// a time and kept (the 60 last used); an ident found anywhere through idents.json (its tiles), the nearest to a reference place kept —
// idents repeat across the world (a fix « ABC » in three countries). Airways expanded from a fix to another along their segments, the
// tiles they cross fetched as the way goes. What the MCDU resolves (a point typed, an airway's VIA/TO), what the ND draws (WPT, VOR.D,
// NDB), what the radios tune.

import { tileKey, tilesAround } from "./runways";

export type NavKind = "V" | "VD" | "VT" | "N" | "D" | "FIX";

/** A navigation point: a radio aid or a fix. */
export interface NavPoint {
  id: string;
  kind: NavKind;
  lat: number;
  lon: number;
  /** a radio aid's frequency [kHz] (a VOR's 116 300; an NDB's 396) */
  freq?: number;
  name?: string;
}

/** An airway's segment (both ways unless the data say otherwise: the data carry no direction here). */
export interface AirwaySeg {
  /** the airways it belongs to (several share a segment) */
  names: string[];
  a: NavPoint;
  b: NavPoint;
  /** 1 low, 2 high; its base and top [ft] */
  level: number;
  base: number;
  top: number;
}

interface Tile {
  aids: NavPoint[];
  fixes: NavPoint[];
  segs: AirwaySeg[];
  used: number;
}

let base = "nav/v1/";
/** Where the tiles are fetched (relative to the page; the tests' own). */
export function setNavBase(url: string) {
  base = url.endsWith("/") ? url : `${url}/`;
}

const tiles = new Map<string, Tile>();
const pending = new Map<string, Promise<Tile | null>>();
let clock = 0;
let index: Record<string, [number, number, number]> | null = null;
let indexP: Promise<Record<string, [number, number, number]> | null> | null = null;
let idents: Record<string, string[]> | null = null;
let identsP: Promise<Record<string, string[]> | null> | null = null;

const json = <T>(url: string): Promise<T | null> =>
  fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null);

async function getIndex() {
  if (index) return index;
  indexP ??= json<{ tiles: Record<string, [number, number, number]> }>(`${base}index.json`).then((j) => (index = j?.tiles ?? null));
  const I = await indexP;
  if (!I) indexP = null;
  return I;
}

async function getIdents() {
  if (idents) return idents;
  identsP ??= json<Record<string, string[]>>(`${base}idents.json`).then((j) => (idents = j));
  const I = await identsP;
  if (!I) identsP = null;
  return I;
}

type RawAid = [string, string, number, number, number, string];
type RawFix = [string, number, number];
type RawSeg = [string, string, number, number, string, number, number, number, number, number];

/** A tile's points and segments (fetched once, kept; an empty square: null). */
export async function navTile(key: string): Promise<Tile | null> {
  const t = tiles.get(key);
  if (t) {
    t.used = ++clock;
    return t;
  }
  const I = await getIndex();
  if (!I?.[key]) return null;
  let p = pending.get(key);
  if (!p) {
    p = json<{ n: RawAid[]; f: RawFix[]; a: RawSeg[] }>(`${base}t${key}.json`).then((j) => {
      pending.delete(key);
      if (!j) return null;
      const T: Tile = {
        aids: j.n.map(([id, kind, lat, lon, freq, name]) => ({ id, kind: kind as NavKind, lat, lon, freq, name })),
        fixes: j.f.map(([id, lat, lon]) => ({ id, kind: "FIX" as const, lat, lon })),
        segs: j.a.map(([names, ai, alat, alon, bi, blat, blon, level, b, top]) => ({
          names: names.split("-"),
          a: { id: ai, kind: "FIX" as const, lat: alat, lon: alon },
          b: { id: bi, kind: "FIX" as const, lat: blat, lon: blon },
          level,
          base: b * 100,
          top: top * 100,
        })),
        used: ++clock,
      };
      tiles.set(key, T);
      if (tiles.size > 60) {
        const old = [...tiles.entries()].sort((x, y) => x[1].used - y[1].used)[0]!;
        tiles.delete(old[0]);
      }
      return T;
    });
    pending.set(key, p);
  }
  return p;
}

/** The great circle's distance [m] (spherical: a ranking, not a navigation). */
export function navDist(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const D = Math.PI / 180;
  const s = Math.sin(((b.lat - a.lat) * D) / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(((b.lon - a.lon) * D) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** A point by its ident, the nearest to `near` among those of that name (an aid preferred over a fix at the same place); null: none. */
export async function navFind(id: string, near: { lat: number; lon: number }): Promise<NavPoint | null> {
  const I = await getIdents();
  const keys = I?.[id.toUpperCase()] ?? [];
  let best: NavPoint | null = null,
    bestD = Infinity;
  for (const k of keys) {
    const T = await navTile(k);
    if (!T) continue;
    for (const p of [...T.aids, ...T.fixes]) {
      if (p.id !== id.toUpperCase()) continue;
      // (a VOR before a fix or a DME alone at the same place — EVX's DME stands 300 m off its VORTAC, the airways' point)
      const d = navDist(near, p) + (p.kind === "FIX" ? 1 : p.kind === "D" ? 2000 : 0);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

/** A point by its ident from what is in already (the MCDU's typing is synchronous): the nearest to `near` among the tiles loaded; the
 *  index and the ident's tiles asked when missing — null meanwhile (« NOT IN DATA BASE » once, found the next time). */
export function navFindSync(id: string, near: { lat: number; lon: number }): NavPoint | null {
  const want = id.toUpperCase();
  if (!idents) {
    void getIdents();
    return null;
  }
  let best: NavPoint | null = null,
    bestD = Infinity;
  for (const k of idents[want] ?? []) {
    const T = tiles.get(k);
    if (!T) {
      void navTile(k);
      continue;
    }
    for (const p of [...T.aids, ...T.fixes]) {
      if (p.id !== want) continue;
      const d = navDist(near, p) + (p.kind === "FIX" ? 1 : p.kind === "D" ? 2000 : 0);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

/** The index of idents asked ahead (the A320 flown: its MCDU's points found at the first typing). */
export function navWarm(lat: number, lon: number) {
  void getIdents();
  void navLoadAround(lat, lon, 600e3);
}

/** The points within r [m] of a place, of the kinds asked, from the tiles already in (the ND's layers: none fetched in its frame —
 *  `navLoadAround` asks them). */
export function navNear(lat: number, lon: number, r: number, kinds: (k: NavKind) => boolean): NavPoint[] {
  const out: NavPoint[] = [];
  for (const k of tilesAround(lat, lon, r)) {
    const T = tiles.get(k);
    if (!T) continue;
    for (const p of kinds("FIX") ? [...T.aids, ...T.fixes] : T.aids) if (kinds(p.kind) && navDist({ lat, lon }, p) <= r) out.push(p);
  }
  return out;
}

/** The tiles about a place fetched (for the ND's layers and the searches near it). */
export function navLoadAround(lat: number, lon: number, r: number): Promise<unknown> {
  return Promise.all(tilesAround(lat, lon, r).map(navTile));
}

/** the same point: its ident, within 2 km (an aid's DME beside it, a fix moved a little between the files) */
const same = (p: NavPoint, q: NavPoint) => p.id === q.id && navDist(p, q) < 2000;

/** An airway's points from `from` to the point named `to` along it — `from` first, `to` last; null: `from` not on that airway, or `to`
 *  not reached along it within 300 segments. */
export async function airwayLegs(name: string, from: NavPoint, to: string): Promise<NavPoint[] | null> {
  const awy = name.toUpperCase();
  const target = to.toUpperCase();
  // (a breadth-first walk along the airway's segments, both ways, the tiles fetched as it goes)
  const segsAt = async (p: NavPoint) => {
    const T = await navTile(tileKey(p.lat, p.lon));
    return (T?.segs ?? []).filter((s) => s.names.includes(awy) && (same(s.a, p) || same(s.b, p)));
  };
  const prev = new Map<string, NavPoint | null>();
  const key = (p: NavPoint) => `${p.id}|${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`;
  prev.set(key(from), null);
  let frontier: NavPoint[] = [from];
  for (let step = 0; step < 300 && frontier.length; step++) {
    const next: NavPoint[] = [];
    for (const p of frontier) {
      for (const s of await segsAt(p)) {
        const q = same(s.a, p) ? s.b : s.a;
        if (prev.has(key(q))) continue;
        prev.set(key(q), p);
        if (q.id === target) {
          const path: NavPoint[] = [q];
          for (let c = prev.get(key(q)); c; c = prev.get(key(c)) ?? null) path.unshift(c);
          return path;
        }
        next.push(q);
      }
    }
    frontier = next;
  }
  return null;
}

/** A point's own record (its kind, its frequency) when it is a radio aid at that place — an airway's segment names only fixes. */
export async function navResolve(p: NavPoint): Promise<NavPoint> {
  const T = await navTile(tileKey(p.lat, p.lon));
  return T?.aids.find((a) => same(a, p)) ?? p;
}
