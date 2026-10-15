// The CameraController — the F-35's radar (game/radar.ts, docs/PLAN-AVIATION-AAA.md C1): always on in the air,
// fed by the sources the game registers (a fight's targets, the room's others — the traffic and the wingmen
// later), each giving its things relative to the craft in the local frame (east, north, up [m]); the ground
// between sampled along the line of sight (the Earth's curve in); a fight's lock and seen kept by it; what the HUD
// and the PCD draw.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import { fleet } from "../fleet";
import { Radar, type RadarObject, type RadarOwn, type Track, type V3 } from "../game/radar";
import { t, tf } from "../i18n";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    radarFix: typeof radarFix;
    radarStep: typeof radarStep;
    radarHud: typeof radarHud;
    radarLockNext: typeof radarLockNext;
    radarMode: typeof radarMode;
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

/** The craft's fix for the radar (null: not an F-35 flying in the Earth's air). */
function radarFix(this: CameraController): RadarFix | null {
  if (fleet.active !== "f35" || !this.airFlight.inAir) return null;
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
 *  (the Earth's curve bringing the ground up at its distance — 4/3 of its radius, the air's refraction). */
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
      const losAlt = fix.own.alt + r[2] * k - (dist * dist) / (2 * (4 / 3) * R_EARTH);
      if (losAlt < groundAt(lat, lon)) return true;
    }
    return false;
  };
}

/** A frame of the radar: its sources read, its beam swept, a fight's lock and seen kept by it. */
function radarStep(this: CameraController, dt: number) {
  const fix = this.radarFix();
  if (!fix) {
    // (on the ground, another craft: off — its tracks gone)
    if (this.radar.tracks.size || this.radar.lock) this.radar.reset();
    return;
  }
  this.radarT += dt;
  const objects: RadarObject[] = [];
  for (const src of this.radarSources.values()) for (const o of src(fix)) objects.push(o);
  const masked = maskedBy(fix);
  // (a fight begun: its targets swept at once)
  if (this.radarSweep && objects.length) {
    this.radar.sweepAll(this.radarT, fix.own, objects, masked);
    this.radarSweep = false;
  }
  this.radar.step(dt, this.radarT, fix.own, objects, masked);
  // (a fight: its world's seen and lock the radar's)
  const W = this.combat?.world;
  if (W) {
    W.radarFed = true;
    W.seen = [...this.radar.tracks.values()].filter((T) => !T.datalink && T.id.startsWith("cmb:")).map((T) => Number(T.id.slice(4)));
    const L = this.radar.lock;
    W.lock = L?.startsWith("cmb:") ? Number(L.slice(4)) : null;
  }
}

/** The radar's next lock (Tab): what to say. */
function radarLockNext(this: CameraController): string {
  if (!this.radarFix()) return t("The radar: in the F-35, in the air");
  const id = this.radar.lockNext();
  const T = id ? this.radar.tracks.get(id) : null;
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
 *  height's difference, its way off the nose, its IFF's colour; the mode, the beam; the lock's figures. */
function radarHud(this: CameraController) {
  const R = this.radar;
  const fix = this.radarFix();
  if (!fix) return null;
  const f = fix.own.fwd;
  const psi = Math.atan2(f[0], f[1]);
  const cs = Math.cos(psi),
    sn = Math.sin(psi);
  const hu = (r: V3) => ({ x: r[0] * cs - r[1] * sn, y: r[0] * sn + r[1] * cs });
  const trk = (T: Track) => (Math.hypot(T.v[0], T.v[1]) > 3 ? Math.atan2(T.v[0], T.v[1]) - psi : null);
  const lockT = R.lock ? R.tracks.get(R.lock) : undefined;
  const closure = (T: Track) => {
    const d = Math.hypot(...T.r) || 1;
    return -dot([T.v[0] - fix.own.v[0], T.v[1] - fix.own.v[1], T.v[2] - fix.own.v[2]], [T.r[0] / d, T.r[1] / d, T.r[2] / d]);
  };
  return {
    mode: R.mode,
    beam: R.beam,
    /** the nose's heading [rad] (the picture is turned by it) */
    heading: psi,
    contacts: [...R.tracks.values()].map((T) => ({
      ...hu(T.r),
      dz: T.r[2],
      trk: R.mode === "RWS" && !T.datalink ? null : trk(T),
      air: T.kind === "air",
      alive: true,
      locked: T.id === R.lock,
      seen: !T.datalink,
      name: T.name,
      colour: T.colour ?? IFF_COLOUR[T.iff],
      iff: T.iff,
      datalink: T.datalink,
      id: T.id,
      /** east, north [m] (the TSD's map) */
      e: T.r[0],
      n: T.r[1],
    })),
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
        }
      : null,
  };
}

export function installRadar(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { radarFix, radarStep, radarHud, radarLockNext, radarMode });
}

export { Radar };
