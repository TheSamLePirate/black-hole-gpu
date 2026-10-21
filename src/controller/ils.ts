// The CameraController — the F-35's ILS approach (game/ils.ts, P4): a runway's landing end chosen (the one named, else
// the nearest; into the wind), the approach flown by the jet's systems — to the initial fix, held there if asked, the
// localizer and the glideslope captured, the gear and flaps out, the flare, the throttle cut, braked to a stop — or
// only shown (the stick taken: the needles stay); its calls; its grade. The arrival's and departure's fixes for a
// flight plan, and its end: the approach engaged as the plan reaches its runway.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { fieldCached, fieldsNear } from "../world/runways";
import { worldSite } from "../world/fieldsite";
import { worldRunwaysNow } from "../world/runways3d";
import { approachSpeed } from "../game/trap";
import { arrivalFixes, departureFix, ilsGrade, ilsReading, type IlsRun, type IlsRunway, ilsStep, newIlsRun, runwayId } from "../game/ils";
import { gcDist } from "../game/flightplan";
import { landingEnd, RUNWAY_LENGTH, type Site, SITES } from "../game/sites";
import { fleet } from "../fleet";
import { t, tf } from "../i18n";
import type { PilotInput } from "../pilot";
import { daysOf } from "../system/solar";
import { VESSELS } from "../vessels";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    ilsRun?: (IlsRun & { manual?: boolean }) | null;
    ilsLast?: { rwy: string; score: number; notes: string[]; touch?: IlsRun["touch"] } | null;
    ilsStart: typeof ilsStart;
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
  const end = landingEnd(s, c.s, daysOf(c.nowTime()), c.weatherReal);
  return {
    name: end.name,
    icao: end.icao,
    lat: end.lat,
    lon: end.lon,
    hdg: end.rwy ?? 0,
    elev: end.elev ?? 0,
    len: s.len ?? RUNWAY_LENGTH,
  };
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
function ilsStart(this: CameraController, name?: string, o: { hold?: number; rwy?: IlsRunway; base?: boolean } = {}): string {
  if (fleet.active !== "f35") return t("ILS: the F-35");
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
  const W = o.rwy ?? runwayOf(this, site!);
  this.ilsRun = newIlsRun(W, o.hold ?? 0, o.base);
  const id = `${W.icao ?? W.name} ${runwayId(W.hdg)}`;
  this.onRadio?.(
    o.base
      ? tf("{0} tower: cleared to land, runway {1}", W.icao ?? W.name, runwayId(W.hdg))
      : o.hold
        ? tf("{0} approach: hold at the initial fix, expect the ILS {1}", W.icao ?? W.name, runwayId(W.hdg))
        : tf("{0} approach: cleared ILS {1}", W.icao ?? W.name, runwayId(W.hdg)),
  );
  return tf("ILS approach: {0}, {1} km", id, Math.round(gcDist(g, W) / 1000));
}

/** Cleared out of the hold: the approach begun. */
function ilsClear(this: CameraController): string {
  const R = this.ilsRun;
  if (!R) return t("ILS: no approach flown");
  R.hold = 0;
  return tf("Cleared ILS {0}", runwayId(R.rwy.hdg));
}

function ilsOff(this: CameraController, why?: string) {
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
  if (fleet.active !== "f35") return this.ilsOff();
  // (a world runway's level measured as the relief came — src/world/runways3d.ts —: the ILS's own followed, its
  // heights read over the ground the gear meets)
  if (R.rwy.icao) {
    const W = worldRunwaysNow().find((r) => r.world?.field === R.rwy.icao && gcDist(r.site, R.rwy) < r.len + 200);
    if (W && Math.abs(W.elev - R.rwy.elev) > 0.05) R.rwy.elev = W.elev;
  }
  const out = R.manual ? (guide(this, R), null) : guide(this, R);
  if (out?.idle || R.phase === "rollout" || R.phase === "done") {
    if (!R.manual) this.pilot.throttle = 0;
  }
  if (R.phase === "done") {
    const G = ilsGrade(R);
    this.ilsLast = { rwy: `${R.rwy.icao ?? R.rwy.name} ${runwayId(R.rwy.hdg)}`, score: G.score, notes: G.notes, touch: R.touch };
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
  const R = this.ilsRun;
  const g = R ? this.geoNow() : null;
  if (!R || !g) return null;
  const r = ilsReading(R.rwy, g);
  return {
    id: `ILS ${runwayId(R.rwy.hdg)} ${R.rwy.icao ?? ""}`.trim(),
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
  const strip = (name: string) => /^(IAF|FAF|DEP)\d\d$/.test(name);
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
  Object.assign(C.prototype, { ilsStart, ilsOff, ilsJet, ilsFrame, ilsInfo, ilsClear, routeProcedures });
}
