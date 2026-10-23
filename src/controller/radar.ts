// The CameraController — the F-35's radar (game/radar.ts, docs/PLAN-AVIATION-AAA.md C1): always on in the air,
// fed by the sources the game registers (a fight's targets, the room's others — the traffic and the wingmen
// later), each giving its things relative to the craft in the local frame (east, north, up [m]); the ground
// between sampled along the line of sight (the Earth's curve in); a fight's lock and seen kept by it; what the HUD
// and the PCD draw.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { l16Key } from "../net/link16";
import { tcasAdvise } from "../radar/tcas";
import { worldIdOf } from "./fightproxy";
import { cameraFrame } from "../camera";
import { fleet } from "../fleet";
import { interceptCues } from "../game/intercept";
import { AIR_RADARS, Radar, type RadarObject, type RadarOwn, type RadarSpec, type V3 } from "../game/radar";
import { t, tf } from "../i18n";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import { geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { MISSILES } from "../game/combat";
import { R_EARTH as R_CHAL } from "../game/challenges";
import { buildPicture, type Picture, type PicWeapon, SENSOR, trailSpan } from "../radar/picture";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    radarFix: typeof radarFix;
    airRadar: typeof airRadar;
    radarStep: typeof radarStep;
    radarHud: typeof radarHud;
    radarLockNext: typeof radarLockNext;
    radarMode: typeof radarMode;
    /** a lock asked with no contact yet: until when [the radar's s] the first one is locked as it comes */
    radarLockWant?: number;
    /** the tactical picture this frame (src/radar/picture.ts — PLAN-RADAR-AAA RD2): null away from the Earth's air */
    picture: Picture | null;
    /** the track selected (one for all the pilot's screens — RD9): its id */
    pictureSelected: string | null;
    combatToLocal: typeof combatToLocal;
    pictureStep: typeof pictureStep;
    pictureSelect: typeof pictureSelect;
  }
}

/** The craft as the sources read it: its place (Earth-fixed [m]) and the local frame's axes there (Earth-fixed
 *  units), its latitude and longitude [°], its radar's own (its axes, velocity, heights in the local frame). */
export interface RadarFix {
  p: V3;
  E: V3;
  N: V3;
  U: V3;
  lat: number;
  lon: number;
  own: RadarOwn;
  /** an Earth-fixed place [m] relative to the craft, in the local frame */
  toLocal(q: V3): V3;
}

/** A source of things for the radar: given the craft's fix, its things relative to it (none: an empty list). */
export type RadarSource = (fix: RadarFix) => RadarObject[];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const D = Math.PI / 180;
const R_EARTH = 6.371e6;

/** The radar the craft flown carries, on in the air (game/radar.ts AIR_RADARS — the F-35's APG-81, the Ranger's nose
 *  radar): its spec, or null (another craft, on the ground, out of the air, too fast for it — an entry's plasma). */
function airRadar(this: CameraController): RadarSpec | null {
  const spec = (this.airFlight.inAir && AIR_RADARS[fleet.active]) || null;
  // (the Ranger's in an entry's plasma: off)
  if (spec?.maxSpeed && (this.airFlight.last?.speed ?? 0) > spec.maxSpeed) return null;
  return spec;
}

/** The craft's fix for the radar (null: not an F-35 flying in the Earth's air; `any`: any craft over the Earth — the
 *  picture's). */
function radarFix(this: CameraController, any = false): RadarFix | null {
  if (!any && (fleet.active !== "f35" || !this.airFlight.inAir)) return null;
  const o = this.netOwn();
  const g = this.geoNow();
  const fr = this.sfFrame(cameraFrame(this.s));
  if (!o || !g || !fr) return null;
  const p = o.p as V3;
  const U = unit(p);
  const E = unit(cross([0, 0, 1], U));
  const N = cross(U, E);
  const loc = (w: V3): V3 => [dot(w, E), dot(w, N), dot(w, U)];
  return {
    p,
    E,
    N,
    U,
    lat: g.lat,
    lon: g.lon,
    own: { fwd: loc(o.fwd as V3), up: loc(o.up as V3), right: loc(o.right as V3), v: loc(o.v as V3), alt: g.alt, agl: fr.h },
    toLocal: (q) => loc([q[0] - p[0], q[1] - p[1], q[2] - p[2]]),
  };
}

/** The ground's height [m over the mean radius] at a latitude, longitude — on a 500 m grid, kept. */
const groundCache = new Map<string, number>();
function groundAt(lat: number, lon: number): number {
  const k = `${(lat * 222).toFixed(0)},${(lon * 222 * Math.cos(lat * D)).toFixed(0)}`;
  let z = groundCache.get(k);
  if (z === undefined) {
    if (groundCache.size > 20_000) groundCache.clear();
    z = groundRelief("earth", bodyFixedOf("earth", lat, lon, 0));
    groundCache.set(k, z);
  }
  return z;
}

/** Whether the ground hides a point r [m, local frame] from the craft at the fix: the line of sight sampled
 *  against the relief (S1: the Earth's curve was counted twice — a ship at sea level hidden by the sea itself). */
function maskedBy(fix: RadarFix): (r: V3) => boolean {
  return (r) => {
    const d = Math.hypot(r[0], r[1]);
    const n = Math.min(16, Math.max(4, Math.ceil(d / 4000)));
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const e = r[0] * k,
        nn = r[1] * k;
      const lat = fix.lat + nn / (D * R_EARTH);
      const lon = fix.lon + e / (D * R_EARTH * Math.cos(fix.lat * D));
      const dist = d * k;
      // (the line's height over the curved Earth there: its height in our local frame — r's up, the Earth's true
      // curve already in it — plus the surface's drop below that frame at its distance; the air's refraction a
      // little more over a long line, the ray bending with the Earth)
      const losAlt = fix.own.alt + r[2] * k + (dist * dist) / (2 * R_EARTH) + (dist * (d - dist)) / (2 * 4 * R_EARTH);
      if (losAlt < groundAt(lat, lon)) return true;
    }
    return false;
  };
}

/**
 * A point of a fight's flat frame (east, north of its anchor; up over the ellipsoid [m] — controller/combat.ts
 * combatPlayer) from the craft in the local frame: back to its latitude and longitude by the same flat map the fight
 * uses (game/challenges.ts enu), its Earth-fixed point, then the fix's frame — the fight's own truth, exact here
 * (PLAN-RADAR-AAA constat 11: its flat east, north taken for ours turned by the meridians' convergence).
 */
function combatToLocal(this: CameraController, fix: RadarFix, p: readonly number[]): V3 {
  const a = this.combat?.def.anchor;
  if (!a) return [0, 0, 0];
  const lat = a.lat + p[1]! / (D * R_CHAL),
    lon = a.lon + p[0]! / (D * R_CHAL * Math.cos(a.lat * D));
  return fix.toLocal(geodeticToCart(WGS84_A, WGS84_F, lat * D, lon * D, p[2]!) as V3);
}

/** A frame of the radar: its sources read, its beam swept, a fight's lock and seen kept by it; then the picture. */
function radarStep(this: CameraController, dt: number) {
  if (dt > 0) this.trailT += dt;
  // (the sources read over the Earth whatever the craft — the picture's truth —; the radar itself the craft's own in
  // the air — the F-35's APG-81, the Ranger's nose radar —, its spec changed with the craft: its tracks gone)
  const any = this.radarFix(true);
  const spec = any ? this.airRadar() : null;
  const fix = spec ? any : null;
  if (spec && this.radar.spec !== spec) {
    this.radar.spec = spec;
    this.radar.reset();
  }
  if (!any) {
    if (this.radar.tracks.size || this.radar.lock) this.radar.reset();
    this.radarObjects = [];
    this.picture = null;
    return;
  }
  const objects: RadarObject[] = [];
  for (const src of this.radarSources.values()) for (const o of src(any)) objects.push(o);
  // (the Link 16 — RD12 —: what a teammate's radar holds, held here by the datalink: its place known, its IFF too)
  if (this.l16In.size) {
    const now = performance.now();
    for (const o of objects) {
      const k = l16Key(o.id, this.l16Me, this.l16InMatch);
      const e = k ? this.l16In.get(k) : undefined;
      if (e && now - e.at < 3000 && !o.offboard) o.offboard = true;
    }
    for (const [k, e] of this.l16In) if (now - e.at > 10_000) this.l16In.delete(k);
  }
  this.radarObjects = objects;
  if (!fix) {
    // (on the ground, another craft: off — its tracks gone)
    if (this.radar.tracks.size || this.radar.lock) this.radar.reset();
    this.pictureStep(any, false);
    return;
  }
  this.radarT += dt;
  const masked = maskedBy(fix);
  // (a fight begun: its targets swept at once)
  if (this.radarSweep && objects.length) {
    this.radar.sweepAll(this.radarT, fix.own, objects, masked);
    this.radarSweep = false;
  }
  this.radar.step(dt, this.radarT, fix.own, objects, masked);
  // (a lock asked before any contact: the first one now)
  if (this.radarLockWant !== undefined) {
    if (this.radarT > this.radarLockWant || this.radar.lock) this.radarLockWant = undefined;
    else {
      const id = this.radar.lockNext();
      const T = id ? this.radar.tracks.get(id) : null;
      if (T) {
        this.radarLockWant = undefined;
        this.onPilotMessage?.(tf("Locked: {0} · {1} km", T.name, (Math.hypot(...T.r) / 1000).toFixed(1)));
      }
    }
  }
  // (a fight: its world's seen and lock the radar's)
  const W = this.combat?.world;
  // (the free fight: weapons free — the datalink's tracks locked too, every craft the world's or taken in)
  const free = !!this.combat?.free;
  this.radar.weaponsFree = free;
  if (W) {
    W.radarFed = true;
    W.seen = [...this.radar.tracks.values()]
      .filter((T) => !T.datalink || free)
      .map((T) => (free ? worldIdOf(this, T.id) : T.id.startsWith("cmb:") ? Number(T.id.slice(4)) : null))
      .filter((x): x is number => x !== null);
    const L = this.radar.lock;
    W.lock = free ? worldIdOf(this, L) : L?.startsWith("cmb:") ? Number(L.slice(4)) : null;
  }
  this.pictureStep(fix, true);
}

/** An AMRAAM's own radar on in its last 15 km (PITBULL — the jet's support no longer needed) [m]. */
const PITBULL = 15_000;
/** Our missiles' poles by their id (RD8): our distance to the target at PITBULL (the A-pole), to the splash (the F-pole) [m]. */
const poles = new Map<string, { a?: number; f?: number }>();

/** The picture this frame (src/radar/picture.ts): the sources' truth, the radar's tracks, a fight's missiles and
 *  decoys, merged by id; its place and heading the fix's. */
function pictureStep(this: CameraController, fix: RadarFix, radarOn: boolean) {
  const g = this.geoNow();
  if (!g) {
    this.picture = null;
    return;
  }
  const weapons: PicWeapon[] = [];
  const C = this.combat;
  const W = C?.world;
  if (W && C?.last && C.def.anchor) {
    const tgtId = (k: number | null): string | null => (k === null ? null : k === -1 ? "own" : k <= -2 ? `cm:${-2 - k}` : `cmb:${k}`);
    for (const m of W.missiles) {
      // (the living, and the ended these 3 s: their SPLASH or MISS where they did — RD8)
      const ended = !m.alive && m.end && m.diedAt !== undefined && W.t - m.diedAt < 3;
      if (!m.alive && !ended) continue;
      const M = MISSILES[m.kind];
      weapons.push({
        id: m.remote ? `msl:${m.remote}` : `msl:${m.id}`,
        name: M?.name ?? m.kind,
        kind: "missile",
        r: this.combatToLocal(fix, m.p),
        v: [...m.v] as V3,
        // (another player's in the free fight, or one at us: never ours)
        ours: m.owner === "blue" && m.target !== -1 && !(m.remote && C.free),
        seeker: M?.seeker ?? "radar",
        target: tgtId(m.target),
        motor: m.alive && m.t < (M?.burn ?? 0),
        decoyed: m.target !== null && m.target <= -2,
        ...(ended ? { end: m.end } : {}),
      });
    }
    for (const d of W.decoys)
      weapons.push({
        id: `cm:${d.id}`,
        name: d.kind === "flare" ? "FLARE" : "CHAFF",
        kind: d.kind,
        r: this.combatToLocal(fix, d.p),
        v: [...d.v] as V3,
        ours: true,
        life: Math.max(0, 5 - d.t),
      });
  }
  const R = this.radar;
  const t0 = performance.now();
  this.picture = buildPicture({
    t: this.radarT,
    fix: {
      p: fix.p,
      E: fix.E,
      N: fix.N,
      U: fix.U,
      lat: g.lat,
      lon: g.lon,
      alt: g.alt,
      heading: Math.atan2(fix.own.fwd[0], fix.own.fwd[1]),
      v: fix.own.v,
    },
    objects: this.radarObjects,
    tracks: radarOn ? [...R.tracks.values()] : [],
    lock: radarOn ? R.lock : null,
    selected: this.pictureSelected ?? null,
    weapons,
    mode: radarOn ? R.mode : null,
    beam: radarOn ? R.beam : null,
    irst: fleet.active === "f35",
  });
  // (the TCAS — RD4 —: the transponders heard graded, TCAS II's way; the RAs inhibited low)
  const heard = this.picture.tracks.filter((T) => T.sensors & SENSOR.TCAS && T.side !== "dead");
  this.tcas =
    this.s.tcas === false
      ? []
      : tcasAdvise(
          fix.own.v,
          fix.own.agl,
          heard.map((T) => ({ id: T.id, r: T.rt, v: T.v })),
        );
  for (const a of this.tcas) {
    const T = this.picture.byId.get(a.id)!;
    T.tcas = a.level;
    if (a.sense) T.ra = a.sense;
  }
  // (each track's history — RD7 —, on the trails' own clock)
  this.trails.record(this.picture, this.trailT);
  for (const k of poles.keys()) if (!this.picture.byId.has(k)) poles.delete(k);
  this.pictureMs += (performance.now() - t0 - this.pictureMs) * 0.05;
  // (the selection let go when its track has been gone 3 s — a splash, a contact lost)
  const sel = this.pictureSelected;
  if (sel) {
    if (this.picture.byId.has(sel)) this.pictureSelectedSeen = this.radarT;
    else if (this.radarT - (this.pictureSelectedSeen ?? this.radarT) > 3) this.pictureSelected = null;
  }
}

/**
 * A track selected (PLAN-RADAR-AAA RD9 — a click on any radar, on the view; the crew's, TARS's): the one target of all
 * the pilot's screens, designated — its card, its BRAA —, not locked. A second click on the one selected locks it (a
 * radar track: TWS, the beam sweeping on); a click in the void lets the selection go (the lock stays). What to say.
 */
function pictureSelect(this: CameraController, id: string | null, how: "click" | "order" = "click"): string {
  const P = this.picture;
  if (id === null) {
    if (this.pictureSelected === null) return "";
    this.pictureSelected = null;
    return t("Selection cleared");
  }
  const T = P?.byId.get(id);
  if (!T) return t("No such track");
  const km = (Math.hypot(...T.r) / 1000).toFixed(1);
  if (this.pictureSelected === id && how === "click") {
    const R = this.radar;
    if (R.lock === id) return tf("Locked: {0} · {1} km", T.name, km);
    if (R.tracks.has(id) && R.lockOn(id)) {
      if (R.mode === "RWS") R.mode = "TWS";
      return tf("Locked: {0} · {1} km", T.name, km);
    }
    return tf("{0}: not a radar track — the radar cannot lock it", T.name);
  }
  this.pictureSelected = id;
  this.pictureSelectedSeen = this.radarT;
  return tf("Selected: {0} · {1} km", T.name, km);
}

/** The radar's next lock (Tab): the track selected if the radar holds it, else the next; what to say. */
function radarLockNext(this: CameraController): string {
  if (!this.airRadar() || !this.radarFix(true)) return t("The radar: in the air, in the F-35 or the Ranger");
  // (a track selected — a click, the crew's —: locked first)
  const sel = this.pictureSelected;
  if (sel && this.radar.lock !== sel && this.radar.tracks.has(sel) && this.radar.lockOn(sel)) {
    if (this.radar.mode === "RWS") this.radar.mode = "TWS";
    const T = this.radar.tracks.get(sel)!;
    return tf("Locked: {0} · {1} km", T.name, (Math.hypot(...T.r) / 1000).toFixed(1));
  }
  const had = this.radar.lock;
  const id = this.radar.lockNext();
  const T = id ? this.radar.tracks.get(id) : null;
  if (!T && !had) {
    // (no contact yet — a fight just begun, a place just taken: its first sweep not done —: the beam swept at once,
    // the first contact locked as it comes, within 3 s; a Tab pressed then was lost, "Lock dropped")
    this.radarLockWant = this.radarT + 3;
    this.radarSweep = true;
    return t("Radar: searching — the first contact locked");
  }
  this.radarLockWant = undefined;
  if (!T) return t("Lock dropped");
  return tf("Locked: {0} · {1} km", T.name, (Math.hypot(...T.r) / 1000).toFixed(1));
}

/** The radar's next mode (RWS → TWS → STT): what to say. */
function radarMode(this: CameraController): string {
  const m = this.radar.nextMode();
  return tf("Radar: {0}", m);
}

const IFF_COLOUR: Record<string, string> = {
  friend: "rgba(110, 200, 255, 1)",
  neutral: "rgba(235, 240, 245, 0.95)",
  unknown: "rgba(255, 215, 80, 1)",
  hostile: "rgba(255, 100, 80, 1)",
};

/** The radar's picture for the HUD's scope and the PCD's TSD: each track heading up (x right, y ahead [m]), its
 *  height's difference, its way off the nose, its IFF's colour; the mode, the beam; the lock's figures — read from the
 *  tactical picture (PLAN-RADAR-AAA RD2: the tracks the radar and the datalink hold, the same ids the crew gets). */
function radarHud(this: CameraController) {
  const R = this.radar;
  const spec = this.airRadar();
  const fix = spec ? this.radarFix(true) : null;
  const P = this.picture;
  if (!fix || !P || !spec) return null;
  const f = fix.own.fwd;
  const psi = Math.atan2(f[0], f[1]);
  const cs = Math.cos(psi),
    sn = Math.sin(psi);
  const hu = (r: V3) => ({ x: r[0] * cs - r[1] * sn, y: r[0] * sn + r[1] * cs });
  const trk = (T: { v: V3 }) => (Math.hypot(T.v[0], T.v[1]) > 3 ? Math.atan2(T.v[0], T.v[1]) - psi : null);
  const lockT = R.lock ? P.byId.get(R.lock) : undefined;
  const closure = (T: { r: V3; v: V3 }) => {
    const d = Math.hypot(...T.r) || 1;
    return -dot([T.v[0] - fix.own.v[0], T.v[1] - fix.own.v[1], T.v[2] - fix.own.v[2]], [T.r[0] / d, T.r[1] / d, T.r[2] / d]);
  };
  // (a chaff bloom its first 2.5 s, in RWS and the real assistance or none: a false track — an unknown echo, as a
  // jet's —, RD8)
  const falseChaff = (T: (typeof P.tracks)[number]) =>
    T.kind === "chaff" &&
    R.mode === "RWS" &&
    (this.s.f35Assist === "realistic" || this.s.f35Assist === "manual") &&
    !!(T.sensors & SENSOR.RADAR) &&
    5 - (T.cm?.life ?? 0) < 2.5;
  return {
    /** the radar's name (APG-81, NOSE), its scan's half-width [rad] */
    name: spec.name ?? "",
    az: spec.az,
    mode: R.mode,
    beam: R.beam,
    /** the nose's heading [rad] (the picture is turned by it) */
    heading: psi,
    contacts: P.tracks
      .filter(
        (T) =>
          (T.sensors & (SENSOR.RADAR | SENSOR.DATALINK) && T.kind !== "missile" && T.kind !== "flare" && T.kind !== "chaff") ||
          falseChaff(T) ||
          // (the TCAS's traffic, close enough to matter — RD4 —: on the scope too, its diamond)
          (!!T.tcas && T.tcas !== "other"),
      )
      .map((T) => {
        if (T.kind === "chaff") T = { ...T, kind: "air", iff: "unknown", name: "", colour: undefined };
        const tcasOnly = !(T.sensors & (SENSOR.RADAR | SENSOR.DATALINK));
        const dl = !tcasOnly && !(T.sensors & SENSOR.RADAR);
        // (its history — RD7 —: east, north of us [m], the span the settings show, its age [s])
        const span = trailSpan({ kind: T.kind, locked: T.id === R.lock, selected: T.id === this.pictureSelected }, this.s);
        const hist =
          span > 0 && T.hist
            ? T.hist
                .filter((q) => this.trailT - q.t <= span)
                .map((q) => {
                  const e = (q.lon - P.fix.lon) * 111_195 * Math.cos((P.fix.lat * Math.PI) / 180),
                    n = (q.lat - P.fix.lat) * 111_195;
                  return { ...hu([e, n, 0]), e, n, age: this.trailT - q.t, span };
                })
            : undefined;
        return {
          hist,
          ...hu(T.r),
          dz: T.r[2],
          trk: R.mode === "RWS" && !dl ? null : trk(T),
          air: T.kind === "air",
          alive: true,
          // (the lock and the selection as they are now — a lock taken since the picture was built shows at once)
          locked: T.id === R.lock,
          selected: T.id === this.pictureSelected,
          seen: !dl,
          name: T.name,
          colour: T.colour ?? IFF_COLOUR[T.iff],
          iff: T.iff,
          datalink: dl,
          state: T.state,
          id: T.id,
          /** the TCAS's grading (RD4); heard by it alone (no radar's track: not on the FCR); the civil traffic */
          tcas: T.tcas,
          tcasOnly,
          traffic: T.side === "traffic",
          /** east, north [m] (the TSD's map) */
          e: T.r[0],
          n: T.r[1],
        };
      }),
    // (the missiles — RD8 —: heading up as the tracks, their way, the one at us, their target's place and time to go,
    // drawn off by a decoy, how they ended)
    // (what the DAS holds — RD4 —: the aircraft, the missiles, the flares about, by their heat; the band's)
    das: P.tracks
      .filter((T) => T.sensors & SENSOR.DAS && T.kind !== "chaff")
      .map((T) => ({ ...hu(T.r), dz: T.r[2], kind: T.kind, iff: T.iff, atUs: T.msl?.target === "own", trk: trk(T), id: T.id })),
    // (ours always — their own datalink —, the others' only as a sensor holds them: the DAS's motor, the radar)
    missiles: P.tracks
      .filter((T) => T.kind === "missile" && T.msl && (T.msl.ours || T.sensors !== 0))
      .map((T) => {
        const M = T.msl!;
        const tg = M.target === "own" ? null : M.target ? P.byId.get(M.target) : undefined;
        const tp = M.target === "own" ? { x: 0, y: 0 } : tg ? hu(tg.rt) : null;
        // (ours by radar: PITBULL in its last 15 km, the A-pole then, the F-pole where it ended)
        let pole = poles.get(T.id);
        const pitbull =
          M.ours &&
          M.seeker === "radar" &&
          !M.end &&
          !!tg &&
          Math.hypot(T.rt[0] - tg.rt[0], T.rt[1] - tg.rt[1], T.rt[2] - tg.rt[2]) < PITBULL;
        if (M.ours && (pitbull || M.end)) {
          if (!pole) poles.set(T.id, (pole = {}));
          if (pitbull && pole.a === undefined && tg) pole.a = Math.hypot(...tg.rt);
          if (M.end && pole.f === undefined) pole.f = Math.hypot(...T.rt);
        }
        return {
          pitbull,
          apole: pole?.a ?? null,
          fpole: pole?.f ?? null,
          ...hu(T.r),
          id: T.id,
          trk: trk(T),
          red: !M.ours,
          atUs: M.target === "own",
          decoyed: M.decoyed,
          end: M.end,
          tti: M.tti,
          tx: tp?.x ?? null,
          ty: tp?.y ?? null,
          name: T.name,
        };
      }),
    lock: lockT
      ? {
          id: lockT.id,
          name: lockT.name,
          iff: lockT.iff,
          r: [...lockT.r] as V3,
          v: [...lockT.v] as V3,
          range: Math.hypot(...lockT.r),
          closure: closure(lockT),
          /** its altitude [m over the sea] */
          alt: fix.own.alt + lockT.r[2],
          /** its heading, its ground speed */
          hdg: (Math.atan2(lockT.v[0], lockT.v[1]) + 2 * Math.PI) % (2 * Math.PI),
          gs: Math.hypot(lockT.v[0], lockT.v[1]),
          /** the intercept's cues (game/intercept.ts): the collision course, the pursuit, the aspect, the merge */
          icpt: interceptCues(lockT.r, lockT.v, fix.own.v),
        }
      : null,
  };
}

export function installRadar(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    radarFix,
    airRadar,
    radarStep,
    radarHud,
    radarLockNext,
    radarMode,
    combatToLocal,
    pictureStep,
    pictureSelect,
  });
}

export { Radar };
