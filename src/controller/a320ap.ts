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
import { t, tf } from "../i18n";
import { fromRunway, ILS, ilsReading, type IlsRunway, onRunway, runwayId } from "../game/ils";
import { gcCourse, gcDist } from "../game/flightplan";
import { geoidDeg } from "../system/geoid";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import type { PilotInput } from "../pilot";
import { findRunway, runwayOf, syncRunwayLevel } from "./ils";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    a320FmgcStep(inp: PilotInput, dt: number, onWheels: boolean): FmgcOut | null;
    a320Fmgc: Fmgc | null;
    a320FmgcIn: FmgcIn | null;
    a320FmgcOut: FmgcOut | null;
    a320Ils: IlsRunway | null;
    a320ApKey(what: "ap" | "athr" | "nav"): string;
    a320FcuSet(want: { alt?: number; hdg?: number; spd?: number; ap?: boolean; athr?: boolean }): string;
    a320App: A320App | null;
    a320Approach(W: IlsRunway): string;
    a320ApproachOff(): void;
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
  a320AppStep(this, F, i, onWheels);
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

/** The A320's autopilot as the crew console and TARS set it (controller/jet.ts apSet): the FCU's altitude (over the
 *  sea [m] → feet, by hundreds), heading [rad → °], speed [m/s → kt] — each set and pulled (selected) —; AP1 and the
 *  A/THR engaged or let go as asked, never toggled blindly. What is said. */
function a320FcuSet(this: CameraController, want: { alt?: number; hdg?: number; spd?: number; ap?: boolean; athr?: boolean }): string {
  const F = (this.a320Fmgc ??= new Fmgc());
  const i = this.a320FmgcIn ?? undefined;
  const said: string[] = [];
  if (want.alt !== undefined) {
    F.alt = Math.min(Math.max(Math.round(want.alt / 0.3048 / 100) * 100, 100), 49_000);
    F.altPull(i);
    said.push(tf("FCU altitude {0} ft", F.alt));
  }
  if (want.hdg !== undefined) {
    F.hdgPull(i);
    F.hdg = Math.round(((((want.hdg * 180) / Math.PI) % 360) + 360) % 360) || 360;
    said.push(tf("FCU heading {0}°", String(F.hdg).padStart(3, "0")));
  }
  if (want.spd !== undefined) {
    F.spdPull(i);
    F.spd = Math.min(Math.max(Math.round(want.spd / 0.514444), 100), 399);
    said.push(tf("FCU speed {0} kt", F.spd));
  }
  if (want.ap === true && !F.ap) said.push(this.a320ApKey("ap"));
  if (want.ap === false && F.ap) {
    F.apDisc();
    said.push(t("AP off"));
  }
  if (want.athr === true && !F.athr) said.push(this.a320ApKey("athr"));
  if (want.athr === false && F.athr) said.push(this.a320ApKey("athr"));
  return said.join(" — ") || t("The autopilot as it was");
}

export function installA320Ap(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { a320FmgcStep, a320ApKey, a320Approach, a320ApproachOff, a320FcuSet });
}
void CONF;

// ------------------------------------------------------------------------------------------------ the ILS approach

/** The A320's ILS approach as the controller vectors it (Sam, 5 Nov 2026: the approaches of Toulon-Hyères flown by the
 *  flight lab; the F-35's own procedure is game/ils.ts): the runway's end chosen tuned; `entry` — to a point 22 km out on
 *  the axis, 6 km to the side the craft is on —, `intercept` — aimed at the axis 13 km out (~34°), APPR armed —, `final` — the FMGC's
 *  LOC, G/S, LAND, FLARE, ROLL OUT. The configuration set as a crew sets it, each step once the speed allows; the
 *  touchdown measured on that runway. */
export interface A320App {
  rwy: IlsRunway;
  leg: "entry" | "intercept" | "final";
  side: 1 | -1;
  /** the intercept's altitude [ft over the sea]: 2 000 ft over the threshold, or 1 000 ft over the relief under the legs */
  altFt: number;
  /** the final's safe heights [m over the sea], every 500 m from the threshold out (`safeProfile`) */
  safe: number[];
  touch: { along: number; across: number; vs: number } | null;
}

const ENTRY_ALONG = 22_000;
const ENTRY_OFF = 6_000;
const INTERCEPT_ALONG = 13_000;

/** The highest ground under the approach's legs [m over the sea]: the axis from 4 to 26 km out, 7 km either side. */
function legsGround(W: IlsRunway): number {
  let top = 0;
  for (let d = 4000; d <= 26_000; d += 1000)
    for (let x = -7000; x <= 7000; x += 1000) {
      const p = fromRunway(W, -d, x);
      top = Math.max(top, groundRelief("earth", bodyFixedOf("earth", p.lat, p.lon, 0)) - geoidDeg(p.lat, p.lon));
    }
  return top;
}

/** The final's safe heights [m over the sea], every 500 m out to 30 km: the highest ground within 2 km round each point of
 *  the axis — behind it, beside it, ahead of it towards the runway —, 150 m over it (some 500 ft). */
function safeProfile(W: IlsRunway): number[] {
  const ground = (d: number) => {
    let top = 0;
    for (let a = d - 2000; a <= d + 2000; a += 500)
      for (let x = -2000; x <= 2000; x += 1000) {
        const p = fromRunway(W, -Math.max(a, 0), x);
        top = Math.max(top, groundRelief("earth", bodyFixedOf("earth", p.lat, p.lon, 0)) - geoidDeg(p.lat, p.lon));
      }
    return top;
  };
  const out: number[] = [];
  for (let d = 0; d <= 30_000; d += 500) out.push(ground(d) + 150);
  return out;
}
const safeAt = (A: A320App, d: number) => {
  const k = Math.min(Math.max(d / 500, 0), A.safe.length - 1);
  const i = Math.floor(k);
  return Math.max(A.safe[i]!, A.safe[Math.min(i + 1, A.safe.length - 1)]!);
};

function a320Approach(this: CameraController, W: IlsRunway): string {
  const g = this.geoNow();
  if (!g) return t("ILS: in the air");
  this.a320Fmgc ??= new Fmgc();
  this.a320Ils = W;
  this.ilsRun = null;
  const o = onRunway(W, g);
  const altFt = Math.ceil(Math.max(W.elev * FT + 2000, legsGround(W) * FT + 1000) / 100) * 100;
  this.a320App = { rwy: W, leg: "entry", side: o.across >= 0 ? 1 : -1, altFt, safe: safeProfile(W), touch: null };
  return tf("ILS approach: {0}, {1} km", `${W.icao ?? W.name} ${runwayId(W.hdg, W.des)}`, Math.round(gcDist(g, W) / 1000));
}

function a320ApproachOff(this: CameraController) {
  const F = this.a320Fmgc;
  if (F?.apprArm) F.apprToggle();
  this.a320App = null;
}

const wrap360 = (a: number) => ((a % 360) + 360) % 360;

function a320AppStep(c: CameraController, F: Fmgc, i: FmgcIn, onWheels: boolean) {
  const A = c.a320App;
  const g = A ? c.geoNow() : null;
  if (!A || !g) return;
  const W = A.rwy;
  syncRunwayLevel(W);
  c.a320Ils = W;
  const o = onRunway(W, g);
  // (on the wheels: the touchdown measured once; stopped, the approach over — its grade where the F-35's is kept)
  if (onWheels) {
    if (!A.touch) A.touch = { along: o.along, across: o.across, vs: g.vs };
    if (g.gs < 15) {
      const T = A.touch;
      const notes: string[] = [];
      let score = 20;
      if (T.vs < -3) (score -= 6), notes.push("hard");
      else if (T.vs < -1.8) (score -= 2), notes.push("firm");
      if (Math.abs(T.across) > 10) (score -= 6), notes.push("off the centreline");
      else if (Math.abs(T.across) > 5) (score -= 2), notes.push("a little off the centreline");
      if (T.along < 150 || T.along > 900) (score -= 4), notes.push("out of the touchdown zone");
      const rwy = `${W.icao ?? W.name} ${runwayId(W.hdg, W.des)}`;
      c.ilsLast = { rwy, score: Math.max(score, 0), notes, touch: T as never };
      c.onPilotMessage?.(
        tf(
          "ILS {0}: {1}/20 — touchdown {2} m in, {3} m off the centreline",
          rwy,
          Math.max(score, 0),
          Math.round(T.along),
          T.across.toFixed(1),
        ),
      );
      c.a320App = null;
    }
    return;
  }
  if (/^(LOC|LAND|FLARE|ROLL)/.test(F.lat)) A.leg = "final";
  const onSlope = /^(G\/S|LAND|FLARE|ROLL)/.test(F.vert);
  // (on the localizer without the glideslope near the runway — high over it, never under the beam —: round again)
  if (A.leg === "final" && !onSlope && o.along > -4000) {
    A.leg = "entry";
    A.side = o.across >= 0 ? 1 : -1;
    if (F.apprArm) F.apprToggle();
  }
  if (!F.athr) F.athrToggle();
  if (!F.ap) F.ap1Toggle(i);
  if (A.leg !== "final") {
    let hdg = W.hdg;
    if (A.leg === "entry") {
      const E = fromRunway(W, -ENTRY_ALONG, A.side * ENTRY_OFF);
      const placed = o.along < -14_000 && o.along > -45_000 && Math.sign(o.across) === A.side && Math.abs(o.across) < 9000;
      if (gcDist(g, E) < 1500 || placed) A.leg = "intercept";
      else hdg = gcCourse(g, E) * D;
    }
    if (A.leg === "intercept") {
      // (aimed at the axis 13 km out — closed on the place, not a fixed heading the drift would bend —, within 45° of the
      // course: some 34° from the entry point)
      const P = fromRunway(W, -INTERCEPT_ALONG, 0);
      const off = ((gcCourse(g, P) * D - W.hdg + 540) % 360) - 180;
      hdg = W.hdg + Math.max(-45, Math.min(45, off));
      // (through the axis without the capture, or past the final fix: round again from the side it is on)
      if ((Math.sign(o.across) === -A.side && Math.abs(o.across) > 2000) || o.along > -ILS.faf + 2000) {
        A.leg = "entry";
        A.side = o.across >= 0 ? 1 : -1;
      }
    }
    if (F.lat !== "HDG") F.hdgPull(i);
    F.hdg = Math.round(wrap360(hdg)) || 360;
    if (!F.apprArm) F.apprToggle();
  }
  // (the altitude: the entry's, high enough over the whole box; from the intercept on, stepped down under the glideslope —
  // 60 m below the beam where the craft is, its capture from below as the FMGC flies it —, never under the segment's safe
  // height (the relief 2 km round and ahead, 150 m over it). The entry's alone left the A320 280 m over the beam at the
  // localizer over Toulon-Hyères' hills: no glideslope, the runway overflown — the flight lab, 5 Nov 2026)
  if (!onSlope) {
    let ft = A.altFt;
    if (A.leg !== "entry") {
      const d = Math.max(-o.along, 0);
      const below = W.elev + (d + ILS.gpi) * Math.tan((ILS.glide * Math.PI) / 180) - 60;
      ft = Math.min(A.altFt, Math.max(below, safeAt(A, d)) * FT);
    }
    ft = Math.ceil(ft / 100) * 100;
    F.alt = ft;
    if (!/^(OP|EXP|G\/S|LAND|FLARE|ALT\*|CLB|DES)/.test(F.vert) && Math.abs(i.alt - ft) > 250) F.altPull(i);
  }
  // (the configuration, a step at a time as the speed allows: CONF 1 within 35 km, 2 on the intercept, the gear on the
  // glideslope or within 12 km, 3 with the gear, FULL inside the final fix)
  const lever = Math.round((c.airFlight.cfg.flaps ?? 0) * 4);
  const out = -o.along;
  let want = lever;
  if (lever < 1 && out < 35_000 && i.ias < 225) want = 1;
  else if (lever === 1 && A.leg !== "entry" && out < 26_000 && i.ias < 210) want = 2;
  else if (lever === 2 && c.gearDown && out < 14_000 && i.ias < 195) want = 3;
  else if (lever === 3 && out < ILS.faf && i.ias < 181) want = 4;
  if (want !== lever) c.airFlight.cfg.flaps = want / 4;
  if (!c.gearDown && (F.vert.startsWith("G/S") || out < 12_000) && i.ias < 230) c.gearDown = true;
}
