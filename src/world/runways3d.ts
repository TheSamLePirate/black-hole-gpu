// The world's runways near the eye made the game's (docs/PLAN-RADAR-AAA.md RD13): every second and a half, the runways
// within 25 km of the camera (src/world/runways.ts — OurAirports') turned into the sites' runway frames
// (game/sites.ts setWorldRunways) — graded, drawn and landed on as the eight sites' are: the relief brought flat to
// their level (sites.ts runwayGrade, trace.wgsl runwayGrade: the gear and the eye alike), their pavement, markings and
// lights (a grass, earth or snow strip plain), no made-up taxiway, apron, terminal or windsock (their airfield's own
// scenery stands there). Their level: the median of the bare relief under them (the sites' own way — A7: the tiles carry
// trees and roofs, the airfield's published height another datum), measured as they come and again at 5 and 20 s
// (the relief's finer tiles arriving), left out of the grading while measured. The water's runways (seaplane bases):
// neither graded nor drawn. The game's own airfields (SITES) keep theirs.

import { bodyFixedOf, groundRelief } from "../system/our-surface";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { EARTH_RUNWAYS, type RunwayFrame, runwayFrame, setWorldRunways, SITES, type Site } from "../game/sites";
import { type Airfield, fieldsNear, type Runway } from "./runways";

/** How far from the eye [m], how many at most (the shader's four nearest drawn of them; the gear's all). */
const REACH = 25_000;
const MAX = 24;
const SURFACE_FLAG: Record<string, number> = { paved: 0, grass: 1, dirt: 2, snow: 4, unknown: 0 };

let lastAt = -1e9;
let lastKey = "";
/** each world runway's frame by its key, kept while it stays near (its level measured once) */
const kept = new Map<string, { frame: RunwayFrame; born: number; measured: number }>();

const keyOf = (f: Airfield, w: Runway) => `${f.ident}:${w.le}/${w.he}`;

/** The game's sites' fields (no world twin drawn over them): their codes, their places. */
const siteNear = (f: Airfield) =>
  SITES.some(
    (s) => s.body === "earth" && s.runway && (s.icao === f.icao || s.icao === f.ident) && Math.hypot(s.lat - f.lat, s.lon - f.lon) < 0.05,
  );

/** A world runway's frame: its le threshold, its heading, its length and half width, its surface and lights. */
function frameOf(f: Airfield, w: Runway): RunwayFrame {
  const site: Site = {
    body: "earth",
    name: `${f.icao || f.ident} ${w.le}`,
    lat: w.lat1,
    lon: w.lon1,
    runway: true,
    rwy: w.hdg,
    icao: f.icao || f.ident,
    elev: Math.round((w.elev1 + w.elev2) / 2),
  };
  const flags = ((SURFACE_FLAG[w.surface] ?? 0) << 1) | 16 | (w.lit ? 32 : 0);
  const fr = runwayFrame(site, Math.max(w.len, 100), Math.max(w.wid / 2, w.surface === "paved" ? 10 : 8), flags);
  fr.world = { field: f.icao || f.ident, measuring: false };
  return fr;
}

/** The level under a runway: the median of the bare relief at 11 points down its axis [m]. */
function measure(fr: RunwayFrame): number {
  fr.world!.measuring = true;
  const hs: number[] = [];
  for (let k = 0; k <= 10; k++) {
    const a = (fr.len * k) / 10;
    const q = [0, 1, 2].map((i) => fr.origin[i]! + fr.along[i]! * a) as [number, number, number];
    // (its geodetic place — WGS84's, not the geocentric angle: 0.19° apart at 43°, twenty kilometres)
    const g = cartToGeodetic(WGS84_A, WGS84_F, q);
    hs.push(groundRelief("earth", bodyFixedOf("earth", (g.lat * 180) / Math.PI, (g.lon * 180) / Math.PI, 0)));
  }
  fr.world!.measuring = false;
  hs.sort((a, b) => a - b);
  const m = hs[5]!;
  // (no relief yet — the sea's 0 everywhere —: the published height kept)
  return hs.every((h) => h === 0) ? fr.elev : Math.round(m * 10) / 10;
}

/**
 * The world's runways about the eye (latitude, longitude [°]) brought in: true when the set graded changed (the
 * renderer's scenery and its uniform refreshed). `now` [ms].
 */
export function worldRunwaysUpdate(lat: number, lon: number, now: number, force = false): boolean {
  if (force) lastAt = -1e9;
  let changed = false;
  // (the levels measured again as the relief comes: at 5 and 20 s)
  for (const k of kept.values())
    if ((k.measured === 0 && now - k.born > 5_000) || (k.measured === 1 && now - k.born > 20_000)) {
      k.frame.elev = k.frame.site.elev = measure(k.frame);
      k.measured++;
      changed = true;
    }
  if (now - lastAt < 1500) return changed;
  lastAt = now;
  const fields = fieldsNear(lat, lon, REACH, (f) => f.kind !== "seaplane" && f.kind !== "heliport" && f.runways.length > 0 && !siteNear(f));
  const want: { f: Airfield; w: Runway; d: number }[] = [];
  for (const f of fields)
    for (const w of f.runways) {
      if (w.surface === "water" || w.len < 200) continue;
      const d = Math.hypot((w.lat1 - lat) * 111_195, (w.lon1 - lon) * 111_195 * Math.cos((lat * Math.PI) / 180));
      want.push({ f, w, d });
    }
  want.sort((a, b) => a.d - b.d);
  const chosen = want.slice(0, MAX);
  const key = chosen.map((x) => keyOf(x.f, x.w)).join(",");
  if (key === lastKey) return changed;
  lastKey = key;
  const next = new Map<string, { frame: RunwayFrame; born: number; measured: number }>();
  for (const { f, w } of chosen) {
    const k = keyOf(f, w);
    const had = kept.get(k);
    if (had) next.set(k, had);
    else {
      const frame = frameOf(f, w);
      next.set(k, { frame, born: now, measured: 0 });
    }
  }
  kept.clear();
  for (const [k, v] of next) kept.set(k, v);
  // (the new ones' levels: measured before they grade — their airfield's together, none grading the others' ground)
  const fresh = [...kept.values()].filter((v) => v.measured === 0 && v.born === now);
  setWorldRunways([...kept.values()].filter((v) => !fresh.includes(v)).map((v) => v.frame));
  for (const v of fresh) v.frame.elev = v.frame.site.elev = measure(v.frame);
  setWorldRunways([...kept.values()].map((v) => v.frame));
  return true;
}

/** The world's runways graded now (tests, the API). */
export function worldRunwaysNow(): RunwayFrame[] {
  return EARTH_RUNWAYS.filter((r) => r.world);
}
