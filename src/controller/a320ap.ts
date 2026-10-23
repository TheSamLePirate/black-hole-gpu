// The A320's flight guidance flown (docs/PLAN-A320.md, A8): its FMGC (src/a320/fmgc/fmgc.ts — made with its first
// frame) fed each frame with the flight's figures — the air data, the FADEC's limits, the speeds, the ILS tuned (the
// plan's destination's runway, else the nearest's), the plan's lateral guidance (controller/fplan.ts), the sticks —;
// its orders given to the Airbus law (the flight path angle and the bank an autopilot flies), its N1 to the FADEC
// (src/a320/fcs.ts, the next frame), its FMA and flight directors to the displays.

import { CONF, confOf } from "../a320/pose";
import { detentOf } from "../a320/fadec";
import { vs1g } from "../a320/du/data";
import { Fmgc, type FmgcIn, type FmgcOut } from "../a320/fmgc/fmgc";
import { fleet } from "../fleet";
import { t } from "../i18n";
import { ilsReading, type IlsRunway } from "../game/ils";
import type { PilotInput } from "../pilot";
import { findRunway, runwayOf } from "./ils";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    a320FmgcStep(inp: PilotInput, dt: number, onWheels: boolean): FmgcOut | null;
    a320Fmgc: Fmgc | null;
    a320FmgcIn: FmgcIn | null;
    a320FmgcOut: FmgcOut | null;
    a320Ils: IlsRunway | null;
    a320ApKey(what: "ap" | "athr" | "nav"): string;
  }
}

const KT = 1.943844;
const FT = 3.28084;
const D = 180 / Math.PI;

/** The ILS the A320 tunes: its plan's destination's runway — an airfield ending it —, else the nearest within 150 km
 *  (checked again every 20 s). */
function tune(c: CameraController): IlsRunway | null {
  const now = performance.now();
  // (one set by another — the MCDU's RAD NAV, a test —: kept)
  if (c.a320Ils && c.a320Ils !== tuned.rwy) return c.a320Ils;
  if (c.a320Ils && now - tuned.at < 20_000) return c.a320Ils;
  tuned.at = now;
  const end = c.nav.route.wps.at(-1);
  const site = end?.field ? findRunway(c, end.field.icao ?? end.name) : findRunway(c);
  c.a320Ils = tuned.rwy = site ? runwayOf(c, site) : null;
  return c.a320Ils;
}
const tuned: { at: number; rwy: IlsRunway | null } = { at: -Infinity, rwy: null };

function a320FmgcStep(this: CameraController, inp: PilotInput, dt: number, onWheels: boolean): FmgcOut | null {
  const A = this.a320;
  const g = this.geoNow();
  const L = this.airFlight.last;
  // (at rest on the ground the air's figures may not be there yet: zero)
  if (!A || !g) return null;
  const F = (this.a320Fmgc ??= new Fmgc());
  const att = this.attitudeNow() as { heading?: number };
  // (the speed its ADRs give — a pitot iced: the FMGC flies what it reads — failures.ts AdrSet)
  const adr = this.a320AdrOut?.cpt;
  const ias = adr?.valid ? adr.ias : Math.sqrt((2 * (L?.out.q ?? 0)) / 1.225) * KT;
  const mach = L?.out.mach ?? 0;
  const lever = this.pilot.throttle;
  const flapLever = Math.round((this.airFlight.cfg.flaps ?? 0) * 4);
  const ci = confOf(flapLever, ias, onWheels);
  const mass = fleet.massProps().mass;
  const vs1 = vs1g(mass, ci);
  const agl = this.airFlight.cfg.agl !== undefined ? (this.airFlight.cfg.agl - 1.59) * FT : null;
  const R = tune(this);
  const r = R ? ilsReading(R, { lat: g.lat, lon: g.lon, alt: g.alt }) : null;
  const lim = A.limits;
  const route = this.nav.route.wps;
  const lo = this.nav.last.l;
  const hdg = ((((att.heading ?? g.track) * D) % 360) + 360) % 360;
  // (the take-off's runway: the heading when the levers went forward on the ground)
  if (onWheels && detentOf(lever) >= 4 && takeoff.hdg === null) takeoff.hdg = hdg;
  if (!onWheels || detentOf(lever) < 4) takeoff.hdg = onWheels ? null : takeoff.hdg;
  const gsKt = g.gs * KT;
  const i: FmgcIn = {
    dt,
    ias,
    mach,
    tas: (L?.speed ?? 0) * KT,
    alt: g.alt * FT,
    vs: g.vs * FT * 60,
    ra: agl !== null && agl < 2500 ? Math.max(agl, 0) : null,
    hdg,
    trk: gsKt > 30 ? (((g.track * D) % 360) + 360) % 360 : hdg,
    gs: gsKt,
    fpa: g.gs > 1 ? Math.atan2(g.vs, g.gs) * D : 0,
    onGround: onWheels,
    lever,
    detent: detentOf(lever),
    flex: A.flexOn || (onWheels && A.flexTemp !== null),
    flapLever,
    gearDown: this.gearDown,
    vls: vs1 * (ci === 0 ? 1.28 : 1.23),
    vmax: ci === 0 ? 350 : [350, 230, 215, 200, 185, 177][ci]!,
    greenDot: 2 * (mass / 1000) + 85,
    s: vs1g(mass, 1) * 1.23,
    f: vs1g(mass, 3) * 1.26,
    v2: Math.max(vs1g(mass, Math.max(ci, 1)) * 1.13, 120),
    alphaFloor: A.alphaFloor,
    n1: lim
      ? { idle: lim.idle, clb: lim.clb, mct: lim.mct, flex: lim.flex, toga: lim.toga, now: A.engines[0].n1 }
      : { idle: 20, clb: 85, mct: 90, flex: 90, toga: 95, now: A.engines[0].n1 },
    // (the runway tuned within 30 km: its course and the distance off its centreline [m, right +] — the roll out's —,
    // the beams' deviations where they reach)
    ils:
      r && (r.locIn || r.gsIn || Math.hypot(r.along, r.across) < 30_000)
        ? { loc: r.locIn ? r.loc : null, gs: r.gsIn ? r.gs : null, course: R!.hdg, dme: r.dme / 1.852, across: r.across }
        : null,
    lnav: route.length >= 2 && lo && !lo.done ? { hdg: (((lo.hdg * D) % 360) + 360) % 360, active: route[lo.active]?.name ?? "" } : null,
    cstr: null,
    stick: [inp.pitch, inp.roll],
    rwyHdg: takeoff.hdg,
    accelAgl: 1500,
    gw: mass,
    elev: agl !== null ? g.alt * FT - agl : (R?.elev ?? 0) * FT,
  };
  this.a320FmgcIn = i;
  const out = F.step(i);
  // (RETARD: the levers back to idle, as the pilot would)
  if (out.retard) this.pilot.throttle = 0;
  this.a320FmgcOut = out;
  return out;
}
const takeoff: { hdg: number | null } = { hdg: null };

/** The keys on the A320: the autopilot (AP1), the autothrust, NAV (the plan's guidance: HDG pushed, AP1 with it). */
function a320ApKey(this: CameraController, what: "ap" | "athr" | "nav"): string {
  const F = (this.a320Fmgc ??= new Fmgc());
  const i = this.a320FmgcIn ?? undefined;
  if (what === "athr") {
    F.athrToggle();
    return F.athr ? t("A/THR on") : t("A/THR off");
  }
  if (what === "nav") {
    if (this.nav.route.wps.length < 2) return t("NAV: no flight plan — make one (the plan's panel)");
    F.hdgPush();
    if (!F.ap) F.ap1Toggle(i);
    return F.lat === "NAV" ? t("NAV engaged") : t("NAV armed");
  }
  F.ap1Toggle(i);
  if (F.ap) return t("AP1 engaged");
  return i && !i.onGround && F.ap1 === false && (i.ra ?? 1e9) < 100 ? t("AP1: 100 ft up, 5 s after the lift-off") : t("AP off");
}

export function installA320Ap(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { a320FmgcStep, a320ApKey });
}
void CONF;
