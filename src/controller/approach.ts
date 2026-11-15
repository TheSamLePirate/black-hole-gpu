// The CameraController — the approach chosen (docs/PLAN-APPROCHES.md §4.2–4.3, AP1): the simulation's state « which airfield,
// which runway's end, which approach » (each « auto » or named), with its generation — read by the F-35's ILS and the A320's
// FMGC, the screens, the crew, TARS, `__bh`; changed by one action, `approachSelect`, checked (the field known, the end and the
// approach its own). Resolved when an approach is engaged: the field selected, else the flight plan's destination, else the
// nearest ahead; its end and approach the one picked (game/approach-choice.ts) — the reason said.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)

import { type Asker, type Choice, chooseApproach, chooseField, type Wind } from "../game/approach-choice";
import { glideClearance, type IlsRunway, runwayId } from "../game/ils";
import { RUNWAY_LENGTH, reciprocal, type Site, SITES } from "../game/sites";
import { isAircraft } from "../vessels";
import { fleet } from "../fleet";
import { t, tf } from "../i18n";
import { geoidDeg } from "../system/geoid";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import { daysOf } from "../system/solar";
import { weatherAt, windFromAt } from "../weather";
import { type Approach, approachesFor, approachTileIn, loadApproachTile } from "../world/approaches";
import { type Airfield, fieldByCode, fieldCached, fieldsNear } from "../world/runways";
import type { CameraController } from "../controls";

/** The approach chosen: each part « auto » or named. */
export interface ApproachSel {
  /** the airfield's code */
  field: string | "auto";
  /** the runway's end (« 31R ») */
  rwy: string | "auto";
  /** the approach's id (« I31R », « C31R ») */
  approach: string | "auto";
  entry: "auto" | "straight" | "vectors" | "iaf";
}

export const AUTO_SEL: ApproachSel = { field: "auto", rwy: "auto", approach: "auto", entry: "auto" };

/** What an engaged approach resolved to, with why. */
export interface ApproachResolved {
  field: Airfield;
  approach: Approach;
  /** « selected », « plan », « ahead », « nearest », « named » */
  fieldWhy: string;
  /** the automatic choice, when the end or approach was « auto » */
  choice: Choice | null;
  gen: number;
}

declare module "../controls" {
  interface CameraController {
    approachSel: ApproachSel;
    approachGen: number;
    approachLast: ApproachResolved | null;
    approachSelect: typeof approachSelect;
    approachState: typeof approachState;
    approachResolve: typeof approachResolve;
    approachReason: typeof approachReason;
  }
}

const KT = 0.514444;
/** a craft's runway needs: the least length [m], paved or not, its cross-wind limit [m/s] */
function needs(): { minLen: number; paved: boolean; xwind: number } {
  // (the A320: 2 000 m — Le Bourget's 09/27, 1 854 m, overrun with its ILS taken, the gear broken: 15 Nov 2026)
  if (fleet.active === "a320") return { minLen: 2000, paved: true, xwind: 38 * KT };
  // (the F-35: a conventional landing's runway, any hard surface)
  return { minLen: 1500, paved: true, xwind: 30 * KT };
}

/** The wind at an airfield as the flight has it (calm in fair weather, as landingEnd took it). */
function windAt(c: CameraController, f: { lat: number; lon: number }): Wind {
  if (c.s.weather === "fair") return { from: 0, spd: 0 };
  const days = daysOf(c.nowTime());
  const w = weatherAt(c.s, { body: "earth", lat: f.lat, lon: f.lon }, days, c.weatherReal);
  return { from: windFromAt(w, f, days), spd: w.wind.u10 };
}

function askerOf(c: CameraController): Asker | null {
  const g = c.geoNow();
  if (!g) return null;
  const track = g.gs > 20 ? ((((g.track * 180) / Math.PI) % 360) + 360) % 360 : Number.NaN;
  return { lat: g.lat, lon: g.lon, track, ...needs() };
}

/** A game's own site (sites.ts SITES: one runway, its two ends named) as an airfield: the same choice for all, no tile needed. */
export function siteField(s: Site): Airfield {
  const r = reciprocal(s);
  const hdg = s.rwy ?? 0;
  return {
    ident: s.icao ?? s.name,
    icao: s.icao ?? s.name,
    iata: "",
    name: s.name,
    kind: "large",
    lat: s.lat,
    lon: s.lon,
    elev: s.elev ?? 0,
    city: "",
    scheduled: false,
    runways: [
      {
        le: s.des?.[0] ?? runwayId(hdg),
        he: s.des?.[1] ?? runwayId(hdg + 180),
        lat1: s.lat,
        lon1: s.lon,
        lat2: r.lat,
        lon2: r.lon,
        hdg,
        len: s.len ?? RUNWAY_LENGTH,
        wid: 45,
        surface: "paved",
        lit: true,
        elev1: s.elev ?? 0,
        elev2: r.elev ?? s.elev ?? 0,
        approx: false,
      },
    ],
  };
}

const gameSites = () => SITES.filter((x) => x.body === "earth" && x.runway && x.rwy !== undefined && !x.reverse);
const siteNamed = (code: string) => {
  const n = code.trim().toLowerCase();
  return gameSites().find((x) => x.icao?.toLowerCase() === n || x.name.toLowerCase() === n) ?? null;
};

/** The airfields made from a game's site (siteField): their own runway is all they have — no tile waited for. */
const fromSite = new WeakSet<Airfield>();

/**
 * An airfield by its code: in the world's tiles already, else a game's site so named — the world's own fetched meanwhile, and
 * its approaches, for the next time —, else fetched (then `ready` called back).
 */
function fieldNamed(code: string, ready: () => void): Airfield | null | "loading" {
  const f = fieldCached(code);
  if (f) return f;
  const site = siteNamed(code);
  if (site) {
    const sf = siteField(site);
    fromSite.add(sf);
    void fieldByCode(code).then((x) => x && loadApproachTile(x.lat, x.lon));
    return sf;
  }
  void fieldByCode(code).then((x) => x && ready());
  return "loading";
}

/**
 * The approach chosen, changed: by the wheel, the maps, the crew, TARS, the flight plan (`by` names it). Checked — the airfield
 * known (fetched when it is not in yet), its end and approach its own —; the generation counted. What to say.
 */
function approachSelect(this: CameraController, sel: Partial<ApproachSel>, by = "pilot"): string {
  const next: ApproachSel = { ...this.approachSel, ...sel };
  // (another airfield: its end and approach back to « auto » unless given with it)
  if (sel.field !== undefined && sel.field !== this.approachSel.field) {
    if (sel.rwy === undefined) next.rwy = "auto";
    if (sel.approach === undefined) next.approach = "auto";
  }
  if (next.field !== "auto") {
    const f = fieldNamed(next.field, () => this.approachSelect(sel, by));
    if (f === "loading") return tf("Approach: {0} — its data coming", next.field);
    if (!f) return tf("Approach: no airfield {0}", next.field);
    next.field = f.icao || f.ident;
    void loadApproachTile(f.lat, f.lon);
    const list = approachesFor(f);
    if (next.rwy !== "auto" && !list.some((a) => endOf(a.rwy) === endOf(next.rwy)))
      return tf("Approach: {0} has no runway {1}", next.field, next.rwy);
    if (next.approach !== "auto") {
      const a = list.find((x) => x.id === next.approach.toUpperCase());
      if (!a) return tf("Approach: {0} has no approach {1}", next.field, next.approach);
      next.rwy = a.rwy;
    }
  } else if (next.rwy !== "auto" || next.approach !== "auto") return t("Approach: an airfield first");
  this.approachSel = next;
  this.approachGen++;
  return this.approachReason(by);
}

const endOf = (s: string) => s.replace(/^0+(?=\d)/, "").toUpperCase();

/** The approach chosen said: « Auto », or the field, end and approach named. */
function approachReason(this: CameraController, by = ""): string {
  const s = this.approachSel;
  const what =
    s.field === "auto"
      ? t("automatic")
      : s.approach !== "auto"
        ? `${s.field} ${s.approach}`
        : s.rwy !== "auto"
          ? tf("{0} runway {1}", s.field, s.rwy)
          : tf("{0}, its runway automatic", s.field);
  return by ? tf("Approach: {0} ({1})", what, by) : tf("Approach: {0}", what);
}

/** The state as every screen reads it: the selection, its generation, the last resolution (field, end, approach, source, why). */
function approachState(this: CameraController) {
  const L = this.approachLast;
  return {
    sel: { ...this.approachSel },
    gen: this.approachGen,
    resolved: L
      ? {
          field: L.field.icao || L.field.ident,
          rwy: L.approach.rwy,
          approach: L.approach.id,
          kind: L.approach.kind,
          source: L.approach.source,
          fieldWhy: L.fieldWhy,
          why: L.choice?.why ?? null,
          gen: L.gen,
        }
      : null,
  };
}

/**
 * The approach to fly now: the airfield (`name` given, else the one selected, else the flight plan's destination, else the
 * nearest ahead within 150 km), its end and approach (`runway` given, else selected, else the automatic choice) — as the ILS's
 * runway (its threshold, the final's course, its elevation). « loading »: its data coming (`ready` called once it is in).
 */
function approachResolve(
  this: CameraController,
  o: { name?: string; runway?: string; ready?: () => void } = {},
): { W: IlsRunway; resolved: ApproachResolved } | { say: string } | "loading" {
  if (!isAircraft(fleet.active)) return { say: t("ILS: the F-35, the A320") };
  const asker = askerOf(this);
  if (!asker) return { say: t("ILS: in the air") };
  const S = this.approachSel;
  const ready = o.ready ?? (() => {});
  let f: Airfield | null = null,
    fieldWhy = "named";
  const named = o.name ?? (S.field !== "auto" ? S.field : this.nav.route?.wps.at(-1)?.field?.icao);
  if (named) {
    const x = fieldNamed(named, ready);
    if (x === "loading") return "loading";
    f = x;
    fieldWhy = o.name ? "named" : S.field !== "auto" ? "selected" : "plan";
    if (!f) return { say: tf("ILS: no runway called {0}", named) };
  } else {
    const N = needs();
    const near = fieldsNear(asker.lat, asker.lon, 150_000, (x) =>
      x.runways.some((w) => w.len >= N.minLen && (!N.paved || w.surface === "paved")),
    );
    // (the game's own sites too, those the world's tiles in have not)
    for (const site of gameSites())
      if (!near.some((x) => x.icao === site.icao)) {
        const sf = siteField(site);
        fromSite.add(sf);
        near.push(sf);
      }
    const c = chooseField(near, asker);
    if (!c) return { say: t("ILS: no runway within 150 km") };
    f = c.f;
    fieldWhy = c.ahead ? "ahead" : "nearest";
  }
  // (its real approaches: their tile fetched first — once; until then the built ones would be all it has. A game's site not
  // waited for: its own runway is the one it has)
  // (its real approaches' tile comes with the runways' — world/approaches.ts —; not in yet: asked, and the approach flown now
  // with what is known — an engagement never left waiting: a recipe, TARS, the wheel engage at once)
  if (!approachTileIn(f.lat, f.lon) && !fromSite.has(f)) void loadApproachTile(f.lat, f.lon);
  let list = approachesFor(f);
  const runway =
    o.runway ?? (f.icao === S.field || f.ident === S.field ? (S.approach !== "auto" ? null : S.rwy !== "auto" ? S.rwy : null) : null);
  const approachId = !o.runway && (f.icao === S.field || f.ident === S.field) && S.approach !== "auto" ? S.approach : null;
  let choice: Choice | null = null;
  let a: Approach | undefined;
  if (approachId) a = list.find((x) => x.id === approachId);
  else if (runway) {
    list = list.filter((x) => endOf(x.rwy) === endOf(runway));
    if (!list.length) return { say: tf("ILS: no runway {0} at {1}", runway, f.icao || f.ident) };
    choice = chooseApproach(f, list, asker, windAt(this, f), thinOver(f));
    a = choice?.a;
  } else {
    choice = chooseApproach(f, list, asker, windAt(this, f), thinOver(f));
    a = choice?.a;
  }
  if (!a) return { say: tf("ILS: no runway at {0}", f.icao || f.ident) };
  const resolved: ApproachResolved = { field: f, approach: a, fieldWhy, choice, gen: this.approachGen };
  this.approachLast = resolved;
  return { resolved, W: runwayOfApproach(f, a) };
}

/** The approach's runway frame for the ILS (its threshold, final course, level, the runway's length). */
function runwayOfApproach(f: Airfield, a: Approach): IlsRunway {
  const rw = f.runways.find((r) => r.le === a.rwy || r.he === a.rwy);
  return {
    name: f.name,
    icao: f.icao || f.ident,
    lat: a.thr.lat,
    lon: a.thr.lon,
    hdg: a.crs,
    elev: a.thr.elev,
    len: rw?.len ?? 2500,
    des: a.rwy,
  };
}

/** The ground's height over the sea at a place [m] (the relief over the ellipsoid less the geoid; the sea 0). */
export const groundMsl = (lat: number, lon: number) =>
  Math.max(groundRelief("earth", bodyFixedOf("earth", lat, lon, 0)) - geoidDeg(lat, lon), 0);

/** A field's built approach whose glideslope is not clear of the relief known (game/ils.ts glideClearance « thin »). */
const thinOver = (f: Airfield) => (a: Approach) => glideClearance(runwayOfApproach(f, a), groundMsl).thin;

/** The resolution's reason said: « LFML ILS 31R — head wind 6 m/s, CAT I », « LFTH 23 built — the nearest ahead ». */
export function sayResolved(r: ApproachResolved, units: { fSpd: (v: number) => string }): string {
  const a = r.approach;
  const code = r.field.icao || r.field.ident;
  const head = a.kind === "VIS" ? tf("{0} {1} built", code, a.rwy) : `${code} ${a.kind} ${a.rwy}`;
  const w = r.choice?.why;
  const parts: string[] = [];
  if (w?.wind) parts.push(tf("head wind {0}", units.fSpd(w.wind.head)));
  if (a.loc?.cat) parts.push(`CAT ${a.loc.cat}`);
  if (r.fieldWhy === "plan") parts.push(t("the plan's destination"));
  else if (r.fieldWhy === "ahead") parts.push(t("the nearest ahead"));
  return parts.length ? `${head} — ${parts.join(", ")}` : head;
}

export function installApproach(C: { prototype: CameraController }) {
  // (the state's first values on the prototype: each controller's own once it changes — approachSelect sets new objects)
  Object.assign(C.prototype, { approachSel: AUTO_SEL, approachGen: 0, approachLast: null });
  Object.assign(C.prototype, { approachSelect, approachState, approachResolve, approachReason });
}
