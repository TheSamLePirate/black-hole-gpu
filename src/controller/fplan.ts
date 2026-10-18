// The CameraController — a plane's flight plan flown (docs/PLAN-F35.md, F8; game/flightplan.ts): the route
// edited (ui/routepanel.ts), its lateral guidance (LNAV) setting the heading hold's target, its vertical one
// (VNAV) the altitude hold's and the autothrottle's, every frame, through the jet's systems (controller/jet.ts).
// The stick rolled takes LNAV off (the heading then held), pulled or pushed VNAV (the altitude); the plan's
// end reached, the holds keep what they had. The bingo: the fuel home with its reserve, called once crossed.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import { fleet } from "../fleet";
import { cruiseBurn } from "../f35/cruise";
import { bingo, Lnav, newPlan, vnav, type FlightPlan, type LnavOut, type VnavOut } from "../game/flightplan";
import { t, tf } from "../i18n";
import type { PilotInput } from "../pilot";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { toBodyFixed } from "../system/our-surface";
import { M_METRES } from "../units";
import { VESSELS } from "../vessels";
import type { CameraController } from "../controls";

type V3 = [number, number, number];

declare module "../controls" {
  interface CameraController {
    geoNow: typeof geoNow;
    navToggle: typeof navToggle;
    navStep: typeof navStep;
    routeChanged: typeof routeChanged;
    routeBingo: typeof routeBingo;
    routeFlyTo: typeof routeFlyTo;
    routeSetPoint: typeof routeSetPoint;
  }
}

/** The flight plan's state on the controller: the route, the guidance engaged, its last outputs, the bingo said. */
export interface NavState {
  route: FlightPlan;
  lnav: Lnav | null;
  /** LNAV and VNAV engaged */
  on: { l: boolean; v: boolean };
  last: { l: LnavOut | null; v: VnavOut | null };
  bingoSaid: boolean;
  /** a message to say (the sequencing, the end, the bingo): read and cleared by main.ts */
  say: string | null;
}
export const noNav = (): NavState => ({
  route: newPlan(),
  lnav: null,
  on: { l: false, v: false },
  last: { l: null, v: null },
  bingoSaid: false,
  say: null,
});

/** Where the craft is over the Earth: latitude, longitude [°], altitude [m], ground speed [m/s], track [rad]. Null: elsewhere. */
function geoNow(this: CameraController): { lat: number; lon: number; alt: number; gs: number; track: number; vs: number } | null {
  const cam = cameraFrame(this.s);
  const nav = this.ourNav(cam);
  const fr = this.sfFrame(cam);
  if (!nav || nav.ref !== "earth" || !fr) return null;
  const q = toBodyFixed("earth", nav.X, nav.t);
  const g = cartToGeodetic(WGS84_A, WGS84_F, [q[0] * M_METRES, q[1] * M_METRES, q[2] * M_METRES]);
  const v = fr.vRel as V3;
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const ve = dot(v, fr.east as V3),
    vn = dot(v, fr.north as V3);
  return {
    lat: (g.lat * 180) / Math.PI,
    lon: (g.lon * 180) / Math.PI,
    alt: g.h,
    gs: Math.hypot(ve, vn),
    track: (Math.atan2(ve, vn) + 2 * Math.PI) % (2 * Math.PI),
    vs: dot(v, fr.up as V3),
  };
}

/** The route edited: the guidance re-engaged on it (the leg it is on). */
function routeChanged(this: CameraController) {
  const N = this.nav;
  N.bingoSaid = false;
  if (!N.route.wps.length) {
    N.lnav = null;
    N.on = { l: false, v: false };
    return;
  }
  const g = this.geoNow();
  N.lnav = new Lnav(N.route);
  if (g) N.lnav.engage(g, g.track);
}

/** The bingo now [kg] (the route's arrival, or the nearest airfield when none), null: no route. */
function routeBingo(this: CameraController): number | null {
  const R = this.nav.route;
  const g = this.geoNow();
  if (!R.wps.length || !g || !VESSELS[fleet.active].turbofan) return null;
  return bingo(R, g, cruiseBurn);
}

/**
 * "Fly to" a place (the mission map — P2): it put in the plan as the point flown to now — the plan made of here and it
 * when there is none —, direct to it, NAV engaged. What to say.
 */
function routeFlyTo(this: CameraController, name: string, lat: number, lon: number): string {
  const N = this.nav;
  const R = N.route;
  const g = this.geoNow();
  if (!g) return t("NAV: in the air");
  const wp = { name: name.slice(0, 12), lat, lon };
  let at: number;
  if (!R.wps.length) {
    R.wps.push({ name: "PPOS", lat: g.lat, lon: g.lon }, wp);
    at = 1;
  } else {
    at = Math.max(1, Math.min(N.on.l ? (N.lnav?.active ?? R.wps.length) : R.wps.length, R.wps.length));
    R.wps.splice(at, 0, wp);
  }
  this.routeChanged();
  N.lnav?.directTo(at, g);
  const said = N.on.l ? tf("NAV: LNAV {0} to {1}", N.on.v ? "+ VNAV" : "", wp.name) : this.navToggle("l");
  N.lnav?.directTo(at, g);
  return said;
}

/** NAV engaged or let go (the key, the display's button): LNAV and VNAV, the autopilot and the autothrottle with them. */
function navToggle(this: CameraController, what: "both" | "l" | "v" = "both"): string {
  const N = this.nav;
  if (!N.route.wps.length) return t("NAV: no flight plan — make one (the plan's panel)");
  const m = this.jetModes;
  const f = this.jetFigures();
  if (!f || this.rolling) return t("NAV: in the air");
  const was = what === "v" ? N.on.v : N.on.l;
  if (was) {
    if (what !== "v") N.on.l = false;
    if (what !== "l") N.on.v = false;
    return what === "v" ? t("VNAV off — altitude held") : t("NAV off — heading and altitude held");
  }
  // (the holds engaged first: NAV moves their targets)
  if (m.alt === null && m.hdg === null) this.jetToggle("ap");
  if (m.spd === null && !m.ab) this.jetToggle("athr");
  if (!N.lnav) this.routeChanged();
  else {
    const g = this.geoNow();
    if (g && !N.on.l) N.lnav.engage(g, g.track);
  }
  if (what !== "v") N.on.l = true;
  if (what !== "l") N.on.v = true;
  const W = N.route.wps[N.lnav?.active ?? 0];
  return tf("NAV: LNAV {0} to {1}", N.on.v ? "+ VNAV" : "", W?.name ?? "—");
}

/**
 * A frame of the guidance, in jetStep before the holds' commands: the stick taking LNAV or VNAV off, then the
 * heading, the altitude and the speed of the holds set from the plan. The bingo checked.
 */
function navStep(this: CameraController, inp: PilotInput, f: { h: number; hdg: number; V: number }) {
  const N = this.nav;
  const m = this.jetModes;
  // (the bingo crossed: said once — the fuel home with its reserve)
  const T = VESSELS[fleet.active].turbofan;
  if (T && N.route.wps.length && !N.bingoSaid) {
    const b = this.routeBingo();
    const fuel = fleet.fuel[fleet.active] ?? 0;
    if (b !== null && fuel < b) {
      N.bingoSaid = true;
      N.say = tf("BINGO — {0} kg left, {1} kg takes you home", Math.round(fuel), Math.round(b));
    }
  }
  // (the guidance run with a plan, engaged or not: the displays' active point, its distance, the cross-track)
  if (!N.route.wps.length) return;
  if (!N.lnav) this.routeChanged();
  if (!N.lnav) return;
  if ((N.on.l || N.on.v) && (m.alt === null || m.hdg === null)) N.on = { l: false, v: false };
  if (inp.roll !== 0 && N.on.l) {
    N.on.l = false;
    N.say = t("LNAV off — the stick: heading held");
  }
  if (inp.pitch !== 0 && N.on.v) {
    N.on.v = false;
    N.say = t("VNAV off — the stick: altitude held");
  }
  const g = this.geoNow();
  if (!g) return;
  const o = N.lnav.step(g, g.gs, g.track, Number.isFinite(f.hdg) ? f.hdg : g.track);
  N.last.l = o;
  if (!o) return;
  if (!N.on.l && !N.on.v) return;
  if (o.passed >= 0) {
    const nx = N.route.wps[o.active];
    N.say = tf("{0} passed — {1} next", N.route.wps[o.passed]?.name ?? "", nx?.name ?? "");
    // (the arrival's initial fix passed — P4: the plan's end flown as an ILS approach to its runway)
    const end = N.route.wps.at(-1);
    if (/^IAF\d\d$/.test(N.route.wps[o.passed]?.name ?? "") && end?.field && N.on.l) {
      N.on = { l: false, v: false };
      N.say = this.ilsStart(end.field.icao ?? end.name);
      return;
    }
  }
  if (o.done) {
    N.on = { l: false, v: false };
    N.say = tf("{0}: the flight plan's end — heading and altitude held", N.route.wps.at(-1)?.name ?? "");
    return;
  }
  if (N.on.l) m.hdg = o.hdg;
  const v = vnav(N.route, o.active, o.dist, f.h, g.gs);
  N.last.v = v;
  if (v && N.on.v) {
    m.alt = v.alt;
    // (the speed managed, unless the pilot set one with the throttle keys)
    if (m.spd !== null && inp.throttle === 0) m.spd = v.spd;
  }
}

/**
 * A waypoint changed in place (the crew's orders — docs/PLAN-CREW-ACTIONS.md A2): moved (geodetic latitude, longitude
 * [°]), its altitude [m] or speed [m/s] constraint set, or cleared (null); its name, its airfield kept unless moved
 * off it. The guidance follows at once, the active point kept. What was done.
 */
function routeSetPoint(
  this: CameraController,
  index: number,
  patch: { lat?: number; lon?: number; alt?: number | null; spd?: number | null },
): string {
  const R = this.nav.route;
  const w = R.wps[index];
  if (!w) throw new Error(tf("No waypoint {0} — {1} in the plan", index, R.wps.length));
  if (patch.lat !== undefined && patch.lon !== undefined) {
    w.lat = Math.max(-90, Math.min(90, patch.lat));
    w.lon = Math.abs(patch.lon) <= 180 ? patch.lon : ((((patch.lon + 180) % 360) + 360) % 360) - 180;
    // (moved off its airfield: a plain point now)
    delete w.field;
  }
  if (patch.alt === null) delete w.alt;
  else if (patch.alt !== undefined) w.alt = Math.max(0, Math.min(20_000, patch.alt));
  if (patch.spd === null) delete w.spd;
  else if (patch.spd !== undefined) w.spd = Math.max(30, Math.min(700, patch.spd));
  const active = this.nav.lnav?.active ?? null;
  this.routeChanged();
  const g = this.geoNow();
  // (the point flown to kept: a change ahead of it does not send the guidance back to the start)
  if (active !== null && g && this.nav.lnav && active < R.wps.length && this.nav.lnav.active !== active) this.nav.lnav.directTo(active, g);
  return tf("{0} changed", w.name);
}

export function installFplan(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { geoNow, navToggle, navStep, routeChanged, routeBingo, routeFlyTo, routeSetPoint });
}
