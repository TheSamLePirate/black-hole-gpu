// The CameraController — the F-35's new autopilot modes (game/jetmodes.ts, A3): the orbit over a point (its heading
// set on the heading hold each frame, the altitude held), the hold on a racetrack over a point (controller/orders.ts),
// the terrain following (its flight path in place of the altitude hold's: the ground ahead cleared by the height
// asked), the rendezvous with a tanker (one set flying its racetrack ahead, friendly, the intercept to its pre-contact
// slot, 50 m behind and 10 m below). The stick's roll lets the orbit and the hold go, its pitch the terrain following
// for as long as it is held.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { altHoldGamma } from "../game/jet";
import { MODES, orbitHeading, tankerTrack, tfGamma } from "../game/jetmodes";
import type { Scenario } from "../game/scenarios";
import { t, tf } from "../i18n";
import type { PilotInput } from "../pilot";
import { ground } from "./gcas";
import type { CameraController } from "../controls";

const D = Math.PI / 180;
const R_EARTH = 6_371_008.8;

declare module "../controls" {
  interface CameraController {
    orbitMode?: { lat: number; lon: number; R: number; dir: 1 | -1 } | null;
    tfAgl?: number | null;
    /** the tanker set and waited for on the radar (its fight's id) */
    tankerPending?: number | null;
    orbitStart: typeof orbitStart;
    tfStart: typeof tfStart;
    tankerStart: typeof tankerStart;
    modesOff: typeof modesOff;
    modesStep: typeof modesStep;
    tfCommand: typeof tfCommand;
    orbitJet: typeof orbitJet;
  }
}

/** Our place's frame: a point `e`, `n` [m] from us. */
function offset(lat: number, lon: number, e: number, n: number) {
  return { lat: lat + n / (D * R_EARTH), lon: lon + e / (D * R_EARTH * Math.cos(lat * D)) };
}

/** The holds engaged on where it flies (the altitude, the heading, the speed). */
function holdsOn(c: CameraController, f: { h: number; hdg: number; V: number }) {
  const m = c.jetModes;
  m.alt ??= Math.round(f.h / 10) * 10;
  m.hdg ??= f.hdg;
  m.spd ??= Math.round(f.V);
}

/** An orbit over a point (`lat`, `lon` — else one `radius` to our right or left, so we fly onto it at once), at
 *  `radius` [m], to the right (dir 1) or the left. What to say. */
function orbitStart(this: CameraController, o: { lat?: number; lon?: number; radius?: number; dir?: 1 | -1 } = {}): string {
  const f = this.jetFigures();
  const g = this.geoNow();
  if (!f || !g) return t("Orbit: in the air");
  // (by default the radius a 40° bank flies at our speed, 4 km at least)
  const R = o.radius ?? Math.max(MODES.orbitR, (f.V * f.V) / (9.80665 * Math.tan(40 * D)));
  const dir = o.dir ?? 1;
  const h = Number.isFinite(f.hdg) ? f.hdg : g.track;
  const c =
    o.lat !== undefined && o.lon !== undefined
      ? { lat: o.lat, lon: o.lon }
      : offset(g.lat, g.lon, Math.cos(h) * R * dir, -Math.sin(h) * R * dir);
  this.holdPat = null;
  this.brk = null;
  this.orbitMode = { ...c, R, dir };
  holdsOn(this, f);
  return tf("Orbit: {0} km, to the {1}", (R / 1000).toFixed(1), dir > 0 ? t("right") : t("left"));
}

/** The terrain following at `agl` [m] (null: off). What to say. */
function tfStart(this: CameraController, agl: number | null): string {
  const f = this.jetFigures();
  if (agl === null) {
    this.tfAgl = null;
    this.jetModes.tf = undefined;
    if (f) this.jetModes.alt = Math.round(f.h / 10) * 10;
    return t("Terrain following off — the altitude held");
  }
  if (!f) return t("Terrain following: in the air");
  this.tfAgl = agl;
  holdsOn(this, f);
  return tf("Terrain following: {0} m over the ground", agl);
}

/** A tanker set flying its racetrack 25 km ahead at 7 000 m, the intercept engaged to its pre-contact slot once the
 *  radar has it. What to say. */
function tankerStart(this: CameraController): string {
  const g = this.geoNow();
  const f = this.jetFigures();
  if (!g || !f) return t("Tanker: in the air");
  const h = Number.isFinite(f.hdg) ? f.hdg : g.track;
  const anchor = offset(g.lat, g.lon, Math.sin(h) * 25_000, Math.cos(h) * 25_000);
  if (!this.combat) {
    const def: Scenario = {
      id: "tanker",
      title: { fr: "Ravitailleur", en: "Tanker" },
      brief: { fr: "", en: "" },
      anchor,
      start: { e: 0, n: 0, agl: f.h, hdg: (h / D + 360) % 360, speed: f.V },
      loadout: "gun",
      targets: [],
      limit: 1e9,
      mission: true,
    };
    this.combatStart(def);
  }
  const W = this.combat!.world;
  const A = this.combat!.def.anchor;
  const toEn = (p: { lat: number; lon: number }): [number, number] => [
    (p.lon - A.lon) * D * R_EARTH * Math.cos(A.lat * D),
    (p.lat - A.lat) * D * R_EARTH,
  ];
  const [e0, n0] = toEn(anchor);
  const track = tankerTrack(h).map(
    ([e, n]) => [e0 + e, n0 + n, Math.max(MODES.tankerH - W.groundZ(e0 + e, n0 + n), 1500)] as [number, number, number],
  );
  const id = W.addTarget({
    kind: "airliner",
    at: [e0, n0, Math.max(MODES.tankerH - W.groundZ(e0, n0), 1500)],
    hdg: (h / D + 360) % 360,
    speed: MODES.tankerV,
    name: "TEXACO 11",
    friendly: true,
    route: track,
    routeLoop: true,
  });
  this.tankerPending = id;
  // (the radar sweeps it at once, as a fight's briefed targets)
  this.radarSweep = true;
  return t("Tanker: TEXACO 11, 25 km ahead at 7 000 m — the rendezvous to pre-contact");
}

/** The modes let go. */
function modesOff(this: CameraController): string {
  this.orbitMode = null;
  this.tfAgl = null;
  this.jetModes.tf = undefined;
  this.tankerPending = null;
  return t("Orbit and terrain following off");
}

/**
 * A frame of the modes, in the jet's step after the holds' orders: the orbit's heading set; the tanker locked and
 * intercepted once the radar sees it; the terrain following shown.
 */
function modesStep(this: CameraController, inp: PilotInput, f: { h: number; hdg: number; V: number }) {
  const m = this.jetModes;
  m.tf = this.tfAgl ?? undefined;
  // (the tanker: on the radar, locked, intercepted to its pre-contact slot)
  if (this.tankerPending != null) {
    const key = `cmb:${this.tankerPending}`;
    // (a friend's: shared by the datalink — not locked by the radar, followed from the picture: controller/intercept.ts)
    const o = this.radarObjects.find((x) => x.id === key);
    if (o) {
      this.tankerPending = null;
      this.orbitMode = null;
      if (this.form) this.formOff();
      this.icpt = {
        id: key,
        name: o.name,
        phase: "run",
        seen: null,
        armed: false,
        last: null,
        slot: MODES.preContact,
        slotName: tf("Pre-contact on {0} — 50 m behind, 10 m below", o.name),
      };
      this.s.flightMode = "plane";
      this.onPilotMessage?.(tf("Rendezvous: {0} · {1} km", o.name, (Math.hypot(...o.r) / 1000).toFixed(1)));
    }
  }
  const O = this.orbitMode;
  if (!O) return;
  if (inp.roll !== 0) {
    this.orbitMode = null;
    this.onPilotMessage?.(t("Orbit off — the stick"));
    return;
  }
  m.order = "ORBIT";
}

/**
 * The orbit flown (the jet's step, as a formation's): far, the heading onto the circle; on it, the bank the circle
 * asks at our speed (V² / g R), bent by the radius's gap and the radial speed; the altitude and speed held.
 */
function orbitJet(
  this: CameraController,
  f: { h: number; hdg: number; V: number },
): { gamma: number; bank: number; spd: number; acc: number } | null {
  const O = this.orbitMode;
  const g = O ? this.geoNow() : null;
  if (!O || !g) return null;
  const m = this.jetModes;
  const p: [number, number] = [(g.lon - O.lon) * D * R_EARTH * Math.cos(O.lat * D), (g.lat - O.lat) * D * R_EARTH];
  const r = Math.hypot(p[0], p[1]);
  const v: [number, number] = [g.gs * Math.sin(g.track), g.gs * Math.cos(g.track)];
  const rdot = (p[0] * v[0] + p[1] * v[1]) / Math.max(r, 1);
  let bank: number;
  if (r > 2 * O.R) {
    const want = orbitHeading(p, O.R, O.dir);
    bank = Math.max(-MODES.orbitBank, Math.min(MODES.orbitBank, 2 * Math.atan2(Math.sin(want - g.track), Math.cos(want - g.track))));
  } else {
    const ff = Math.atan2(g.gs * g.gs, 9.80665 * O.R);
    bank = O.dir * Math.max(0, Math.min(MODES.orbitBank, ff + 0.0006 * (r - O.R) + 0.02 * rdot));
  }
  m.alt ??= Math.round(f.h / 10) * 10;
  m.spd ??= Math.round(f.V);
  return { gamma: altHoldGamma(f.h, m.alt, f.V), bank, spd: m.spd, acc: 0 };
}

/** The terrain following's flight path now [rad] (null: not engaged), in place of the altitude hold's. */
function tfCommand(this: CameraController, f: { h: number; V: number }): number | null {
  const agl = this.tfAgl;
  const g = agl != null ? this.geoNow() : null;
  if (agl == null || !g) return null;
  const trk = g.track;
  const along = (x: number) =>
    ground(g.lat + (x * Math.cos(trk)) / (D * R_EARTH), g.lon + (x * Math.sin(trk)) / (D * R_EARTH * Math.cos(g.lat * D)));
  // (the altitude hold kept on where it flies: the terrain following let go, it holds that)
  this.jetModes.alt = Math.round(f.h / 10) * 10;
  return tfGamma(g.alt, f.V, agl, along);
}

export function installJetModes(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { orbitStart, tfStart, tankerStart, modesOff, modesStep, tfCommand, orbitJet });
}
