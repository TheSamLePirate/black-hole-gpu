// The CameraController — the leader's orders (game/orders.ts, docs/PLAN-AVIATION-AAA.md F2): given (the wheel,
// TARS, the HOTAS) — our own formation's notion changed, sent to the room and to our AI wingmen —, heard (a
// human wingman: said and shown; in formation on him, carried out — the formation's shape and spacing, the
// break, the hold over his fix stacked by our place, the way home), and the break's and the hold's own flying
// in the jet's step.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { formReshape, formationLabel } from "./formation";
import { spacingStep } from "../game/formations";
import { gcCourse, gcDist, newPlan } from "../game/flightplan";
import { BREAK_BANK, breakHeading, FLOWN, type Order, type OrderId, ORDERS } from "../game/orders";
import { holdRadius, type Racetrack, racetrackHeading } from "../game/racetrack";
import { wrapPi } from "../game/jet";
import { SITES } from "../game/sites";
import { t, tf, tr } from "../i18n";
import type { PilotInput } from "../pilot";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    flightOrder: typeof flightOrder;
    orderHeard: typeof orderHeard;
    orderStep: typeof orderStep;
    breakStart: typeof breakStart;
    holdStart: typeof holdStart;
    rtbStart: typeof rtbStart;
  }
}

const D = Math.PI / 180;
const R_EARTH = 6_371_008.8;

/** An order's radio call in the language shown (the formation named). */
export function orderCall(o: Order): string {
  return tr(ORDERS[o.id].call).replace("{0}", o.shape ? formationLabel(o.shape) : "");
}

/**
 * An order given as the flight's leader: `shape` for a formation; tighten, loosen our spacing; attack our lock;
 * hold over where we are, inbound on our heading. Our own notion changed, then sent (the room's, our AI
 * wingmen's). What to say: the call.
 */
function flightOrder(this: CameraController, id: OrderId, arg?: string): string {
  const s = this.s;
  const o: Order = { id };
  if (id === "shape") {
    o.shape = (arg as Order["shape"]) ?? s.formShape;
    s.formShape = o.shape!;
  } else if (id === "tighten" || id === "loosen") {
    s.formSpacing = spacingStep(s.formSpacing, id === "tighten" ? -1 : 1);
    o.spacing = s.formSpacing;
  } else if (id === "attack") {
    if (!this.radar.lock) return t("Attack: lock a target first (Tab)");
    o.target = this.radar.lock;
  } else if (id === "hold") {
    const g = this.geoNow();
    if (!g) return t("Hold: in the air");
    o.fix = { lat: g.lat, lon: g.lon };
    o.inbound = g.track;
  }
  if (id === "shape" || id === "rejoin") o.spacing = s.formSpacing;
  for (const sink of this.orderSinks.values()) sink(o);
  // (our AI wingmen: they carry it out, they answer)
  this.wingOrder?.(o);
  return orderCall(o);
}

/**
 * An order heard from `from` (a human leader's, through the room): said; carried out when we fly in formation on
 * him and it is one flown. What to say.
 */
function orderHeard(this: CameraController, o: Order, from: { name: string; slot: number }): string {
  const call = `${from.name} : ${orderCall(o)}`;
  const F = this.form;
  if (!F || F.slot !== from.slot || !FLOWN[o.id]) return call;
  const s = this.s;
  switch (o.id) {
    case "shape":
      if (o.shape) s.formShape = o.shape;
      if (o.spacing) s.formSpacing = o.spacing;
      formReshape(F, { shape: s.formShape, spacing: s.formSpacing });
      break;
    case "tighten":
    case "loosen":
      s.formSpacing = o.spacing ?? spacingStep(s.formSpacing, o.id === "tighten" ? -1 : 1);
      formReshape(F, { spacing: s.formSpacing });
      break;
    case "breakL":
    case "breakR":
      this.formOff();
      this.breakStart(o.id);
      break;
    case "hold":
      if (o.fix && o.inbound !== undefined) {
        this.formOff();
        // (stacked by our place: 300 m above the leader's level for each)
        this.holdStart(o.fix, o.inbound, 300 * ((F.pos ?? 2) - 1));
      }
      break;
    case "rtb":
      this.formOff();
      this.rtbStart();
      break;
  }
  return call;
}

/** A break: the hard turn 90° off our heading to its side, the afterburner lit; then the heading held. */
function breakStart(this: CameraController, id: "breakL" | "breakR"): string {
  const f = this.jetFigures();
  if (!f || !Number.isFinite(f.hdg)) return t("The break: in the air");
  this.holdPat = null;
  const m = this.jetModes;
  m.alt ??= Math.round(f.h / 10) * 10;
  this.brk = { hdg: breakHeading(f.hdg, id) };
  m.hdg = this.brk.hdg;
  m.bankMax = BREAK_BANK;
  m.spd = null;
  m.ab = true;
  this.pilot.throttle = 1;
  return tr(ORDERS[id].call);
}

/** The hold: the racetrack over a fix, inbound on a course, `above` [m] over our level now (a stack). */
function holdStart(this: CameraController, fix: { lat: number; lon: number }, inbound: number, above = 0): string {
  const f = this.jetFigures();
  if (!f) return t("Hold: in the air");
  this.brk = null;
  const m = this.jetModes;
  m.bankMax = undefined;
  m.alt = Math.round((f.h + above) / 10) * 10;
  m.spd ??= Math.round(f.V);
  m.ab = false;
  const R: Racetrack = { inbound, leg: 8000, radius: holdRadius(Math.max(f.V, 120)) };
  this.holdPat = { fix, R };
  m.hdg = f.hdg;
  return tf("Holding — inbound {0}°", String(Math.round(((inbound / D) % 360) + 360) % 360).padStart(3, "0"));
}

/** Home: a plan direct to the nearest airfield, LNAV and VNAV engaged. */
function rtbStart(this: CameraController): string {
  const g = this.geoNow();
  if (!g) return t("RTB: in the air");
  this.brk = null;
  this.holdPat = null;
  this.jetModes.bankMax = undefined;
  const fields = SITES.filter((x) => x.body === "earth" && x.runway);
  let best = fields[0]!,
    bd = Infinity;
  for (const x of fields) {
    const d = gcDist(g, x);
    if (d < bd) (bd = d), (best = x);
  }
  const R = newPlan();
  R.wps = [
    { name: "HERE", lat: g.lat, lon: g.lon },
    { name: best.icao ?? best.name, lat: best.lat, lon: best.lon, field: { icao: best.icao, elev: best.elev ?? 0, rwy: best.rwy } },
  ];
  this.nav.route = R;
  this.nav.on = { l: false, v: false };
  this.routeChanged();
  this.navToggle("both");
  return tf("RTB — {0}, {1} km, course {2}°", best.icao ?? best.name, Math.round(bd / 1000), Math.round(gcCourse(g, best) / D));
}

/**
 * A frame of the break and the hold, in the jet's step before the guidance: the break's heading held at its hard
 * bank until it is reached; the hold's heading set on its racetrack. The stick's roll lets them go.
 */
function orderStep(this: CameraController, inp: PilotInput, f: { h: number; hdg: number; V: number }) {
  const m = this.jetModes;
  m.order = this.brk ? "BRK" : this.holdPat ? "HOLD" : undefined;
  if (!this.brk && !this.holdPat) return;
  if (inp.roll !== 0) {
    this.brk = null;
    this.holdPat = null;
    m.bankMax = undefined;
    return;
  }
  if (this.brk) {
    m.hdg = this.brk.hdg;
    if (Number.isFinite(f.hdg) && Math.abs(wrapPi(f.hdg - this.brk.hdg)) < 8 * D) {
      // (the turn done: the afterburner out, the speed held, the bank back to the holds')
      this.brk = null;
      m.bankMax = undefined;
      m.ab = false;
      m.spd = Math.round(f.V);
      this.jetAthr.reset();
      this.jetCws.thr = this.pilot.throttle;
    }
    return;
  }
  const H = this.holdPat!;
  const g = this.geoNow();
  if (!g) return;
  const e = (g.lon - H.fix.lon) * D * R_EARTH * Math.cos(H.fix.lat * D),
    n = (g.lat - H.fix.lat) * D * R_EARTH;
  m.hdg = racetrackHeading(H.R, [e, n], Math.max(f.V, 100) * 10).hdg;
}

export function installOrders(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { flightOrder, orderHeard, orderStep, breakStart, holdStart, rtbStart });
}
