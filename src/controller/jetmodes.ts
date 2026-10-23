// The CameraController — the F-35's new autopilot modes (game/jetmodes.ts, A3): the orbit over a point (its heading
// set on the heading hold each frame, the altitude held), the hold on a racetrack over a point (controller/orders.ts),
// the terrain following (its flight path in place of the altitude hold's: the ground ahead cleared by the height
// asked), the rendezvous with a tanker (one set flying its racetrack ahead — an A330 MRTT's hoses under its wings —,
// friendly, the intercept to the observation slot behind the hose given, then the refuelling: controller/aar.ts). The
// stick's roll lets the orbit and the hold go, its pitch the terrain following for as long as it is held.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { AAR, type AarSide } from "../game/aar";
import { altHoldGamma } from "../game/jet";
import { MODES, orbitHeading, tankerTrack, tfGamma } from "../game/jetmodes";
import type { Scenario } from "../game/scenarios";
import { t, tf } from "../i18n";
import type { PilotInput } from "../pilot";
import { fleet } from "../fleet";
import { ground } from "./gcas";
import type { CameraController } from "../controls";

const D = Math.PI / 180;
const R_EARTH = 6_371_008.8;

declare module "../controls" {
  interface CameraController {
    orbitMode?: { lat: number; lon: number; R: number; dir: 1 | -1 } | null;
    tfAgl?: number | null;
    /** the tanker set and waited for on the radar (its fight's id); the hose asked */
    tankerPending?: number | null;
    tankerSide?: AarSide;
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

/** the tanker's callsign */
export const TANKER = "TEXACO 11";

/** The observation slot behind a hose (the intercept's: our craft there, the probe some 45 m behind the basket). */
export const observation = (side: AarSide) => ({ right: (side === "left" ? -1 : 1) * AAR.pod.x - 1, back: 45, up: -8 });

/**
 * A tanker set flying its racetrack 25 km ahead at 7 000 m (`near`: 1.5 km ahead at our height, on our heading — a
 * practice's), the intercept engaged to the observation slot behind its hose (`side`) once the radar has it, the
 * refuelling then (controller/aar.ts). One already flying: that one joined again. Again while refuelling: off. What to
 * say.
 */
function tankerStart(this: CameraController, o: { near?: boolean; side?: AarSide } = {}): string {
  const g = this.geoNow();
  const f = this.jetFigures();
  if (!g || !f) return t("Tanker: in the air");
  if (fleet.active !== "f35") return t("Tanker: the F-35's");
  if ((this.aar || this.tankerPending != null) && o.near === undefined && o.side === undefined) {
    this.tankerPending = null;
    if (this.icpt) this.icptOff();
    this.aarOff();
    return t("Refuelling off");
  }
  const side = o.side ?? "right";
  // (one flying already: joined again)
  const old = this.combat?.world.targets.find((x) => x.alive && x.friendly && x.name === TANKER);
  if (old) {
    this.tankerPending = old.id;
    this.tankerSide = side;
    this.aarBegin(old.id, TANKER, side);
    this.radarSweep = true;
    return tf("Tanker: {0} — the rendezvous to its {1}", TANKER, side === "left" ? t("left hose") : t("right hose"));
  }
  const h = Number.isFinite(f.hdg) ? f.hdg : g.track;
  const ahead = o.near ? 1500 : 25_000;
  const anchor = offset(g.lat, g.lon, Math.sin(h) * ahead, Math.cos(h) * ahead);
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
  // (its height: 7 000 m — near, ours —, 1 500 m over the ground at least)
  const hAt = (e: number, n: number) => Math.max((o.near ? f.h : MODES.tankerH) - W.groundZ(e, n), 1500);
  // (its racetrack wide enough for its turns at 25° of bank — a 9 km radius at its speed —, its legs 40 km)
  const track = tankerTrack(h, 20_000, 40_000).map(([e, n]) => [e0 + e, n0 + n, hAt(e0 + e, n0 + n)] as [number, number, number]);
  const id = W.addTarget({
    kind: "airliner",
    mesh: "mrtt",
    at: [e0, n0, hAt(e0, n0)],
    hdg: (h / D + 360) % 360,
    speed: MODES.tankerV,
    name: TANKER,
    friendly: true,
    route: track,
    routeLoop: true,
    bankMax: 25,
    rollMax: 3,
  });
  this.tankerPending = id;
  this.tankerSide = side;
  this.aarBegin(id, TANKER, side);
  // (the radar sweeps it at once, as a fight's briefed targets)
  this.radarSweep = true;
  return o.near
    ? tf("Tanker: {0}, 1.5 km ahead at your height — the rendezvous to its {1}", TANKER, side === "left" ? t("left hose") : t("right hose"))
    : tf("Tanker: {0}, 25 km ahead at 7 000 m — the rendezvous to its {1}", TANKER, side === "left" ? t("left hose") : t("right hose"));
}

/** The modes let go. */
function modesOff(this: CameraController): string {
  this.orbitMode = null;
  this.tfAgl = null;
  this.jetModes.tf = undefined;
  this.tankerPending = null;
  if (this.aar) {
    if (this.icpt) this.icptOff();
    this.aarOff();
    return t("Orbit, terrain following and refuelling off");
  }
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
        slot: observation(this.tankerSide ?? "right"),
        slotName: tf("Behind {0}'s {1} — observation", o.name, this.tankerSide === "left" ? t("left hose") : t("right hose")),
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
