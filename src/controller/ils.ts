// The CameraController — the F-35's ILS approach (game/ils.ts, P4): a runway's landing end chosen (the one named, else
// the nearest; into the wind), the approach flown by the jet's systems — to the initial fix, held there if asked, the
// localizer and the glideslope captured, the gear and flaps out, the flare, the throttle cut, braked to a stop — or
// only shown (the stick taken: the needles stay); its calls; its grade. The arrival's and departure's fixes for a
// flight plan, and its end: the approach engaged as the plan reaches its runway.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { fieldCached, fieldsNear } from "../world/runways";
import { worldRunwaySites, worldSite } from "../world/fieldsite";
import { worldRunwaysNow } from "../world/runways3d";
import { approachSpeed } from "../game/trap";
import {
  arrivalFixes,
  departureFix,
  glideClearance,
  ilsGrade,
  ilsReading,
  type IlsRun,
  type IlsRunway,
  ilsStep,
  newIlsRun,
  runwayId,
} from "../game/ils";
import { geoidDeg } from "../system/geoid";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import { gcDist } from "../game/flightplan";
import { landingEnd, RUNWAY_LENGTH, reciprocal, type Site, SITES } from "../game/sites";
import { fleet } from "../fleet";
import { t, tf } from "../i18n";
import type { PilotInput } from "../pilot";
import { daysOf } from "../system/solar";
import { isAircraft, VESSELS } from "../vessels";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    ilsRun?: (IlsRun & { manual?: boolean }) | null;
    ilsLast?: { rwy: string; score: number; notes: string[]; touch?: IlsRun["touch"] } | null;
    ilsStart: typeof ilsStart;
    ilsRunways: typeof ilsRunways;
    ilsOff: typeof ilsOff;
    ilsJet: typeof ilsJet;
    ilsFrame: typeof ilsFrame;
    ilsInfo: typeof ilsInfo;
    ilsClear: typeof ilsClear;
    routeProcedures: typeof routeProcedures;
  }
}

/** What the calls are said as (in French too: i18n). */
const SAY: Record<string, () => string> = {
  Holding: () => t("ILS: holding at the initial fix"),
  "Localizer captured": () => t("ILS: localizer captured"),
  "Glideslope captured": () => t("ILS: glideslope captured"),
  "Gear down": () => t("ILS: gear down, flaps"),
  Minimums: () => t("Minimums"),
  Flare: () => t("Flare"),
  "Go around": () => t("Go around — the missed approach"),
  Touchdown: () => t("Touchdown"),
};

/** A site's runway as the ILS's (its end landed now: into the wind). */
export function runwayOf(c: CameraController, s: Site): IlsRunway {
  return ilsEnd(landingEnd(s, c.s, daysOf(c.nowTime()), c.weatherReal), s.len);
}

/** A runway's end (a site as given: that threshold, that heading) as the ILS's. */
function ilsEnd(end: Site, len?: number): IlsRunway {
  return {
    name: end.name,
    icao: end.icao,
    lat: end.lat,
    lon: end.lon,
    hdg: end.rwy ?? 0,
    elev: end.elev ?? 0,
    len: len ?? end.len ?? RUNWAY_LENGTH,
    des: end.des?.[0],
  };
}

/** A landing end the approach can take: its number (05, 23L), the ILS's runway, its length [m], whether the wind picks it now. */
export interface IlsChoice {
  id: string;
  rwy: IlsRunway;
  len: number;
  /** the 3° slope's least clearance over the relief [m] (negative: refused) */
  clearM: number;
  wind: boolean;
}

/** The airfield's runways for the ILS (Sam, 5 Nov 2026: « quand il y a deux pistes, permettre de choisir celle de l'ILS »):
 *  the airfield named (ICAO or name) else the nearest within 150 km; each paved runway of 900 m or more (its tile in: its
 *  world airfield), both its ends — the one the wind picks now marked —, the longest runway first; `auto` the end the
 *  approach takes when none is chosen (the longest runway, into the wind). Null: no airfield. */
function ilsRunways(this: CameraController, name?: string): { field: string; auto: IlsChoice; ends: IlsChoice[] } | null {
  const site = findRunway(this, name);
  if (!site) return null;
  const f = site.icao ? fieldCached(site.icao) : null;
  const sites = f ? worldRunwaySites(f) : [];
  // (the game's own field: its runway first, unless the world's list has it already — the same threshold)
  const near = (a: Site, b: Site) => Math.abs(a.lat - b.lat) < 2e-3 && Math.abs(a.lon - b.lon) < 2e-3;
  if (!sites.some((x) => near(x, site) || near(reciprocal(x), site))) sites.unshift(site);
  const days = daysOf(this.nowTime());
  const choice = (end: Site, len: number | undefined, wind: Site): IlsChoice => {
    const rwy = ilsEnd(end, len);
    return {
      id: runwayId(rwy.hdg, rwy.des),
      rwy,
      len: rwy.len,
      clearM: Math.round(glideClearanceOf(rwy).minM),
      wind: near(wind, end) && Math.abs((((wind.rwy ?? 0) - (end.rwy ?? 0) + 540) % 360) - 180) < 30,
    };
  };
  const ends: IlsChoice[] = [];
  for (const x of sites) {
    const w = landingEnd(x, this.s, days, this.weatherReal);
    ends.push(choice(x, x.len, w), choice(reciprocal(x), x.len, w));
  }
  const autoRwy = runwayOf(this, site);
  const auto = ends.find(
    (e) =>
      Math.abs(e.rwy.lat - autoRwy.lat) < 2e-3 && Math.abs(e.rwy.lon - autoRwy.lon) < 2e-3 && e.id === runwayId(autoRwy.hdg, autoRwy.des),
  ) ?? {
    id: runwayId(autoRwy.hdg, autoRwy.des),
    rwy: autoRwy,
    len: autoRwy.len,
    clearM: Math.round(glideClearanceOf(autoRwy).minM),
    wind: true,
  };
  return { field: site.icao ?? site.name, auto, ends };
}

/** A runway asked by its number — « 13 », « RWY 05 », « piste 31 », « 23L » — among the choices: that end; a runway by both
 *  numbers (« 13/31 ») or one end of it, the end the wind picks. Null: none such. */
export function pickRunway(ends: IlsChoice[], asked: string): IlsChoice | null {
  const norm = (x: string) => x.replace(/^0+(?=\d)/, "").toUpperCase();
  const parts = asked
    .toUpperCase()
    .replace(/RWY|PISTE|RUNWAY/g, "")
    .split(/[/\-\s]+/)
    .filter(Boolean)
    .map(norm);
  if (!parts.length) return null;
  if (parts.length === 1) return ends.find((e) => norm(e.id) === parts[0]) ?? null;
  // (both ends named: that runway, its end into the wind)
  const of = ends.filter((e) => parts.includes(norm(e.id)));
  return of.find((e) => e.wind) ?? of[0] ?? null;
}

/** The runway named (ICAO or name), else the nearest within 150 km. */
export function findRunway(c: CameraController, name?: string): Site | null {
  const fields = SITES.filter((x) => x.body === "earth" && x.runway && x.rwy !== undefined);
  if (name) {
    const n = name.trim().toLowerCase();
    const site =
      fields.find((x) => x.icao?.toLowerCase() === n || x.name.toLowerCase() === n) ??
      fields.find((x) => x.name.toLowerCase().includes(n)) ??
      null;
    if (site) return site;
    // (any airfield of the world by its code — its tile in: the flight plan's, the maps' —, its longest paved runway)
    const f = fieldCached(name);
    return f ? worldSite(f) : null;
  }
  const g = c.geoNow();
  if (!g) return null;
  let best: Site | null = null,
    bd = 150_000;
  for (const x of fields) {
    const d = gcDist(g, x);
    if (d < bd) (bd = d), (best = x);
  }
  // (the world's airfields with a paved runway of 1 800 m nearer)
  for (const f of fieldsNear(g.lat, g.lon, Math.min(bd, 150_000), (x) => x.runways.some((w) => w.surface === "paved" && w.len >= 1800))) {
    const s = worldSite(f);
    if (!s) continue;
    const d = gcDist(g, s);
    if (d < bd) (bd = d), (best = s);
  }
  return best;
}

/**
 * The ILS approach engaged: on the runway named (ICAO or name — else the nearest within 150 km), its end into the
 * wind; `hold`: laps in the hold at the initial fix first (Infinity: until cleared). What to say.
 */
function ilsStart(
  this: CameraController,
  name?: string,
  o: { hold?: number; rwy?: IlsRunway; base?: boolean; runway?: string } = {},
): string {
  if (!isAircraft(fleet.active)) return t("ILS: the F-35, the A320");
  const g = this.geoNow();
  if (!g || this.rolling || this.ourLanded) return t("ILS: in the air");
  const site = o.rwy ? null : findRunway(this, name);
  if (!site && !o.rwy) return name ? tf("ILS: no runway called {0}", name) : t("ILS: no runway within 150 km");
  if (this.form) this.formOff();
  if (this.icpt) this.icptOff();
  this.trapRun = null;
  this.deckRun = null;
  this.holdPat = null;
  this.brk = null;
  if (this.stovl.on) this.stovl.on = false;
  if (this.pilot.auto !== "none") this.pilot.setAuto(this.pilot.auto);
  this.pilot.auto = "none";
  this.nav.on = { l: false, v: false };
  // (a visual circuit's base and final — `base`: from the downwind, round onto the centreline)
  let W = o.rwy ?? runwayOf(this, site!);
  // (a runway chosen — its number: the airfield's other runway, or the other end —, among the airfield's)
  if (!o.rwy && o.runway) {
    const ch = this.ilsRunways(name ?? site!.icao ?? site!.name);
    const pick = ch ? pickRunway(ch.ends, o.runway) : null;
    if (!pick) return tf("ILS: no runway {0} at {1}", o.runway, site!.icao ?? site!.name);
    W = pick.rwy;
  }
  // (the slope over the relief: one that runs into the ground refused; a thin margin flown, said)
  const clear = o.base ? null : glideClearanceOf(W);
  const id = `${W.icao ?? W.name} ${runwayId(W.hdg, W.des)}`;
  if (clear && clear.minM < 0)
    return tf("ILS {0}: the 3° slope runs into the relief {1} km out — refused", id, (clear.atM / 1000).toFixed(1));
  const warn = clear?.thin
    ? ` — ${tf("the relief {0} m under the slope {1} km out", Math.round(clear.minM), (clear.atM / 1000).toFixed(1))}`
    : "";
  // (the A320 flies its own: its FMGC tuned on that runway, vectored to the localizer, APPR armed — controller/a320ap.ts)
  if (fleet.active === "a320") {
    const said = this.a320Approach(W);
    this.onRadio?.(tf("{0} approach: cleared ILS {1}", W.icao ?? W.name, runwayId(W.hdg, W.des)));
    return said + warn;
  }
  this.ilsRun = newIlsRun(W, o.hold ?? 0, o.base);
  this.onRadio?.(
    o.base
      ? tf("{0} tower: cleared to land, runway {1}", W.icao ?? W.name, runwayId(W.hdg, W.des))
      : o.hold
        ? tf("{0} approach: hold at the initial fix, expect the ILS {1}", W.icao ?? W.name, runwayId(W.hdg, W.des))
        : tf("{0} approach: cleared ILS {1}", W.icao ?? W.name, runwayId(W.hdg, W.des)),
  );
  return tf("ILS approach: {0}, {1} km", id, Math.round(gcDist(g, W) / 1000)) + warn;
}

/** A world runway's level as measured (src/world/runways3d.ts: the median of the bare relief under it, as the relief
 *  came) followed by the ILS's own — the same runway: its airfield, its axis within 10° either way, a threshold within
 *  its length. (Any runway of the airfield was taken before: at Toulon-Hyères the ILS 13 read 05/23's level, which
 *  crosses it — its slope aimed at another runway's level, 17 m off on the coarse relief: the F-35 bounced 200 m high
 *  and its gear broke off the runway — the flight lab, 5 Nov 2026.) */
export function syncRunwayLevel(rwy: IlsRunway) {
  if (!rwy.icao) return;
  const same = (h: number) => {
    const d = Math.abs((((h - rwy.hdg) % 180) + 180) % 180);
    return Math.min(d, 180 - d) < 10;
  };
  const W = worldRunwaysNow().find(
    (r) => r.world?.field === rwy.icao && same(r.site.rwy ?? Number.NaN) && gcDist(r.site, rwy) < r.len + 200,
  );
  if (W && Math.abs(W.elev - rwy.elev) > 0.05) rwy.elev = W.elev;
}

/** The glideslope's clearance over the Earth's relief as the physics knows it (its heights over the ellipsoid less the
 *  geoid: over the sea) — game/ils.ts glideClearance. */
export function glideClearanceOf(W: IlsRunway) {
  return glideClearance(W, (lat, lon) => Math.max(groundRelief("earth", bodyFixedOf("earth", lat, lon, 0)) - geoidDeg(lat, lon), 0));
}

/** Cleared out of the hold: the approach begun. */
function ilsClear(this: CameraController): string {
  const R = this.ilsRun;
  if (!R) return t("ILS: no approach flown");
  R.hold = 0;
  return tf("Cleared ILS {0}", runwayId(R.rwy.hdg, R.rwy.des));
}

function ilsOff(this: CameraController, why?: string) {
  if (this.a320App) this.a320ApproachOff();
  if (!this.ilsRun) return;
  this.ilsRun = null;
  if (why) this.onPilotMessage?.(why);
}

/** The approach's speed for the jet now [m/s] (its mass on its wing at the approach's incidence). */
const vAppOf = () => approachSpeed(fleet.massProps().mass, VESSELS.f35.aero!.wing!.S) + 4;

/** The approach this frame (worked out once a frame). */
let memo: { at: number; out: ReturnType<typeof ilsStep> } | null = null;
function guide(c: CameraController, R: IlsRun) {
  const now = c.nowTime();
  if (memo && memo.at === now) return memo.out;
  const g = c.geoNow();
  if (!g) return null;
  const dt = memo ? Math.min(Math.max((now - memo.at) * 4.925490947e-6 * c.s.massSolar, 0), 0.25) : 0;
  const onGround = !!(c.rolling || c.ourLanded || (c.gearLast?.contact ?? 0) > 0);
  const out = ilsStep(R, { lat: g.lat, lon: g.lon, alt: g.alt, trk: g.track, gs: g.gs, vs: g.vs, onGround }, vAppOf(), dt);
  memo = { at: now, out };
  if (out?.call) c.onRadio?.(SAY[out.call]?.() ?? out.call);
  return out;
}

/** The jet's systems with the approach flown: its flight path, bank and speed; the gear and flaps set. The stick or the
 *  throttle take it back — the needles stay. */
function ilsJet(this: CameraController, inp: PilotInput): { gamma: number; bank: number; spd: number; acc: number } | null {
  const R = this.ilsRun;
  if (!R || R.manual) return null;
  if (inp.pitch !== 0 || inp.roll !== 0 || inp.throttle !== 0) {
    R.manual = true;
    this.onPilotMessage?.(t("ILS: the autopilot off — the needles still shown"));
    return null;
  }
  const out = guide(this, R);
  if (!out) return null;
  if (out.gear && !this.gearDown) this.gearDown = true;
  if (!out.gear && this.gearDown && R.phase === "missed") this.gearDown = false;
  this.airFlight.cfg.flaps = out.flaps;
  return { gamma: out.gamma, bank: out.bank, spd: out.idle ? 0 : out.spd, acc: 0 };
}

/** A frame of the approach outside the jet's step: the flare's throttle cut, on the wheels the rollout braked to a
 *  stop (the throttle at 0 sets the brakes), its end graded. */
function ilsFrame(this: CameraController) {
  const R = this.ilsRun;
  if (!R) return;
  if (!isAircraft(fleet.active)) return this.ilsOff();
  // (a world runway's level measured as the relief came — src/world/runways3d.ts —: the ILS's own followed, its
  // heights read over the ground the gear meets)
  syncRunwayLevel(R.rwy);
  const out = R.manual ? (guide(this, R), null) : guide(this, R);
  if (out?.idle || R.phase === "rollout" || R.phase === "done") {
    if (!R.manual) this.pilot.throttle = 0;
  }
  if (R.phase === "done") {
    const G = ilsGrade(R);
    this.ilsLast = { rwy: `${R.rwy.icao ?? R.rwy.name} ${runwayId(R.rwy.hdg, R.rwy.des)}`, score: G.score, notes: G.notes, touch: R.touch };
    const T = R.touch;
    this.onPilotMessage?.(
      tf(
        "ILS {0}: {1}/20 — touchdown {2} m in, {3} m off the centreline",
        this.ilsLast.rwy,
        G.score,
        Math.round(T?.along ?? 0),
        (T?.across ?? 0).toFixed(1),
      ),
    );
    this.ilsRun = null;
  }
}

/** What the HUD shows of the approach: the runway, the needles (dots), the distance, its phase. Null: none flown. */
function ilsInfo(
  this: CameraController,
): { id: string; loc: number | null; gs: number | null; dme: number; phase: string; auto: boolean } | null {
  // (the A320's: its own approach, the FMGC's modes as its phase)
  const A = this.a320App;
  if (A) {
    const g = this.geoNow();
    if (!g) return null;
    const r = ilsReading(A.rwy, g);
    const F = this.a320Fmgc;
    return {
      id: `ILS ${runwayId(A.rwy.hdg, A.rwy.des)} ${A.rwy.icao ?? ""}`.trim(),
      loc: r.locIn ? r.loc : null,
      gs: r.gsIn ? r.gs : null,
      dme: r.dme,
      phase: A.leg === "final" ? `${F?.lat ?? ""}/${F?.vert ?? ""}` : A.leg,
      auto: !!F?.ap,
    };
  }
  const R = this.ilsRun;
  const g = R ? this.geoNow() : null;
  if (!R || !g) return null;
  const r = ilsReading(R.rwy, g);
  return {
    id: `ILS ${runwayId(R.rwy.hdg, R.rwy.des)} ${R.rwy.icao ?? ""}`.trim(),
    loc: r.locIn ? r.loc : null,
    gs: r.gsIn ? r.gs : null,
    dme: r.dme,
    phase: R.phase,
    auto: !R.manual,
  };
}

/**
 * The flight plan's procedures (P4): its first point an airfield — the departure's fix after it (6 km down its runway,
 * 900 m up) —; its last an airfield — the arrival's (the initial and final fixes on its axis, into the wind). Its end
 * then hands over to the ILS (controller/fplan.ts). What was added.
 */
function routeProcedures(this: CameraController): string {
  const W = this.nav.route.wps;
  if (W.length < 2) return t("Procedures: a plan from an airfield or to one");
  const added: string[] = [];
  const strip = (name: string) => /^(IAF|FAF|DEP)\d\d[LCR]?$/.test(name);
  this.nav.route.wps = W.filter((w) => !strip(w.name));
  const P = this.nav.route.wps;
  // (the game's own field, else a world airfield's by its code — its tile in: PLAN-RADAR-AAA RD13)
  const siteOf = (w: (typeof P)[number]) => {
    if (!w.field) return undefined;
    const own = SITES.find(
      (s) => s.body === "earth" && s.runway && (s.icao === w.field!.icao || Math.hypot(s.lat - w.lat, s.lon - w.lon) < 0.02),
    );
    if (own) return own;
    const f = w.field.icao ? fieldCached(w.field.icao) : null;
    return (f && worldSite(f)) || undefined;
  };
  const first = siteOf(P[0]!);
  if (first) {
    const d = departureFix(runwayOf(this, first));
    P.splice(1, 0, { name: d.name, lat: d.lat, lon: d.lon, alt: d.alt });
    added.push(d.name);
  }
  const last = siteOf(P[P.length - 1]!);
  if (last) {
    const fx = arrivalFixes(runwayOf(this, last));
    P.splice(P.length - 1, 0, ...fx.map((f) => ({ name: f.name, lat: f.lat, lon: f.lon, alt: f.alt })));
    added.push(...fx.map((f) => f.name));
  }
  this.routeChanged();
  return added.length ? tf("Procedures: {0}", added.join(", ")) : t("Procedures: a plan from an airfield or to one");
}

export function installIls(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { ilsStart, ilsRunways, ilsOff, ilsJet, ilsFrame, ilsInfo, ilsClear, routeProcedures });
}
