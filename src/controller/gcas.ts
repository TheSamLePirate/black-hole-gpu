// The CameraController — the F-35's Auto-GCAS and Auto-ACAS (game/gcas.ts, A2): ten times a second, the recovery the
// jet would fly foreseen over the terrain along its track (the relief's heights, cached on a grid) and the others in
// the air (the radar's objects: the fight's, the real traffic, the room's, our wingmen) checked for a conflict; the jet
// taken over when it must be — the ground: the wings rolled level, then the pull until climbing and clear; another
// aircraft: away from its side, up or down —, given back with a word. On with the setting (the real aircraft's), always
// in the assisted levels; not in the direct law (no computer to fly it), nor with the gear down, in a formation, an
// approach or on the wheels.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { fleet } from "../fleet";
import { ACAS, acasConflict, type AcasOther, GCAS, gcasMargin, gcasRecovery } from "../game/gcas";
import { t, tf } from "../i18n";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import type { PilotInput } from "../pilot";
import type { CameraController } from "../controls";

const D = Math.PI / 180;
const R_EARTH = 6_371_008.8;

declare module "../controls" {
  interface CameraController {
    /** the room's players flying on our wing now (their slots — ui/netsession.ts) */
    formWithMe?: Set<number>;
    /** the protections' state: the recovery's clearance foreseen [m] and its margin, the fly-up or the escape flying */
    gcas?: {
      at: number;
      clear: number;
      margin: number;
      flyUp: boolean;
      escape: { name: string; up: boolean; quiet: number } | null;
    } | null;
    gcasArmed: typeof gcasArmed;
    gcasStep: typeof gcasStep;
    gcasJet: typeof gcasJet;
  }
}

/** The relief's height at a place [m], on a 250 m grid, kept ten seconds (finer tiles come in meanwhile). */
const cache = new Map<string, number>();
let cacheAt = 0;
export function ground(lat: number, lon: number) {
  const now = performance.now();
  if (now - cacheAt > 10_000) {
    cache.clear();
    cacheAt = now;
  }
  const k = `${Math.round(lat * 444)},${Math.round(lon * 444 * Math.cos(lat * D))}`;
  let z = cache.get(k);
  if (z === undefined) {
    if (cache.size > 30_000) cache.clear();
    z = Math.max(0, groundRelief("earth", bodyFixedOf("earth", lat, lon, 0)));
    cache.set(k, z);
  }
  return z;
}

/** Whether the protections watch now: the F-35 flown as a plane in the air, its computer's law, no gear, no formation
 *  nor approach; the setting on (always in the assisted levels). */
function gcasArmed(this: CameraController): boolean {
  if (fleet.active !== "f35" || !this.airFlight.inAir || this.rolling || this.ourLanded) return false;
  const level = this.assistLevel();
  if (level === "manual" || this.s.f35Law === "direct") return false;
  if (!(this.s.f35AutoProtect ?? true) && level !== "assisted" && level !== "beginner") return false;
  if (this.gearDown || this.form || this.ilsRun || this.trapRun || this.deckRun || this.stovl.on) return false;
  return this.flightModeNow() === "plane" && this.pilot.auto === "none";
}

/** The room's slot a radar track stands for (its craft, or its stand-in in a fight's world), else −1. */
function slotOfTrack(c: CameraController, id: string): number {
  if (id.startsWith("net:")) return Number(id.slice(4));
  if (id.startsWith("cmb:")) return c.combat?.world.target(Number(id.slice(4)))?.peer ?? -1;
  return -1;
}

/** A frame of the protections (ten times a second): the recovery foreseen, the fly-up taken or given back; the
 *  conflicts in the air, the escape begun or ended. */
function gcasStep(this: CameraController, dt: number) {
  if (!this.gcasArmed()) {
    if (this.gcas?.flyUp || this.gcas?.escape) this.onPilotMessage?.(t("Auto-GCAS: off"));
    this.gcas = null;
    return;
  }
  const S = (this.gcas ??= { at: 0, clear: Infinity, margin: 0, flyUp: false, escape: null });
  S.at += dt;
  if (S.at < 0.1) return;
  S.at = 0;
  const g = this.geoNow();
  const L = this.airFlight.last;
  if (!g || !L) return;
  const bank = (this.attitudeNow() as { bank?: number }).bank ?? 0;
  const gamma = Math.atan2(g.vs, Math.max(g.gs, 1));
  // the ground: the recovery along the track over the relief
  const trk = g.track;
  const along = (x: number) =>
    ground(g.lat + (x * Math.cos(trk)) / (D * R_EARTH), g.lon + (x * Math.sin(trk)) / (D * R_EARTH * Math.cos(g.lat * D)));
  const r = gcasRecovery({ alt: g.alt, gamma, bank, V: L.speed }, along);
  // (level from here: the ground's highest within the next 12 s under our height — the fly-up given back only once
  // a level-off clears it too, not to pull again over the same ridge)
  const levelClear = () => {
    let top = 0;
    for (let x = 0; x <= L.speed * 12; x += 250) top = Math.max(top, along(x));
    return g.alt - top;
  };
  S.clear = r.clear;
  S.margin = gcasMargin(L.speed);
  if (!S.flyUp && r.clear < S.margin) {
    S.flyUp = true;
    S.escape = null;
    this.onRadio?.(t("Auto-GCAS: fly up"));
  } else if (S.flyUp && gamma > 3 * D && Math.abs(bank) < 20 * D && r.clear > GCAS.release * S.margin && levelClear() > S.margin) {
    S.flyUp = false;
    // (an altitude held below — the autopilot's —: the one reached now, not back down into the ground)
    const m = this.jetModes;
    if (m.alt !== null && m.alt < g.alt) m.alt = Math.round(g.alt / 10) * 10;
    this.onPilotMessage?.(t("Auto-GCAS: recovered — yours"));
  }
  if (S.flyUp) return;
  // the others in the air: their closest approach
  const own = this.radarFix()?.own;
  if (!own) return;
  const others: AcasOther[] = (this.radarObjects ?? [])
    // (our own wingmen and the room's in formation with us — their close slots flown on purpose — left out, as the
    // real one's formation logic does)
    .filter(
      (o) =>
        o.kind === "air" &&
        !o.id.startsWith("wng:") &&
        !o.id.startsWith("rwg:") &&
        // (our AI wingmen in a fight are its world's craft too — cmb:, their peer below 0)
        !(o.id.startsWith("cmb:") && (this.combat?.world.target(Number(o.id.slice(4)))?.peer ?? 0) < 0) &&
        // (the aircraft joined on purpose — an intercept's shadow, a tanker's pre-contact —: not a conflict)
        !(this.icpt && this.icpt.id === o.id && this.icpt.phase !== "run" && this.icpt.phase !== "turn") &&
        // (the tanker refuelling us behind its hose — controller/aar.ts —: close on purpose)
        !(this.aar?.stage === "hose" && o.id === `cmb:${this.aar.tanker}`) &&
        // (a room's player flying on our wing — he said so: his place in our formation —, his craft or its stand-in in
        // a fight: close on purpose, never a conflict to climb away from — the free fight's frame gave him a few m/s)
        !this.formWithMe?.has(slotOfTrack(this, o.id)) &&
        // (a guided lesson's craft — I3: the leader flown on, the drone shot at —: close on purpose)
        !(this.course?.target !== undefined && o.id === `cmb:${this.course.target}` && this.course.id !== "intercept"),
    )
    .map((o) => ({ id: o.id, name: o.name, r: o.r, vRel: [o.v[0] - own.v[0], o.v[1] - own.v[1], o.v[2] - own.v[2]] }));
  // (escaping: kept on until the closest approach foreseen is twice the conflict's — not let go at its edge)
  const k = acasConflict(others, S.escape ? 2 * ACAS.miss : ACAS.miss);
  if (k && !S.escape) {
    // (away from its side: up when it will pass below — or level and we are not low —, else down)
    // (the TCAS's RA on that craft — RD4 —: its sense, the one said aloud, flown)
    const ra = this.tcas.find((a) => a.id === k.id && a.sense)?.sense;
    const up = ra ? ra === "climb" : k.above < 0 || (Math.abs(k.above) < 30 && g.alt - along(0) > 600);
    S.escape = { name: k.name, up, quiet: 0 };
    this.onRadio?.(tf("Auto-ACAS: {0} — {1}", k.name, up ? t("climb") : t("descend")));
  } else if (S.escape) {
    S.escape.quiet = k ? 0 : S.escape.quiet + 0.1;
    if (S.escape.quiet > 1.5) {
      // (an altitude held the other side of the escape — the autopilot's —: the one reached, not back at it)
      const m = this.jetModes;
      if (m.alt !== null && (S.escape.up ? m.alt < g.alt : m.alt > g.alt)) m.alt = Math.round(g.alt / 10) * 10;
      S.escape = null;
      this.onPilotMessage?.(t("Auto-ACAS: clear of conflict — yours"));
    }
  }
}

/** The jet's systems with a protection flying: the fly-up (the wings level first — no pull through a steep bank —,
 *  then up), the escape (wings level, up or down). Null: none. */
function gcasJet(this: CameraController, inp: PilotInput): { gamma: number; bank: number; spd: number; acc: number } | null {
  const S = this.gcas;
  if (!S || (!S.flyUp && !S.escape)) return null;
  // (the stick the protection's while it flies — the real one's paddle switch is the way out: the setting here)
  inp.pitch = inp.roll = inp.yaw = 0;
  const L = this.airFlight.last;
  const V = L?.speed ?? 200;
  const bank = (this.attitudeNow() as { bank?: number }).bank ?? 0;
  const g = this.geoNow();
  const gamma = g ? Math.atan2(g.vs, Math.max(g.gs, 1)) : 0;
  if (S.flyUp) return { gamma: Math.abs(bank) > 60 * D ? gamma : GCAS.climb, bank: 0, spd: Math.max(V, 150), acc: V < 150 ? 2 : 0 };
  const e = S.escape!;
  return { gamma: e.up ? ACAS.escape : -ACAS.escape, bank: 0, spd: V, acc: 0 };
}

export function installGcas(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { gcasArmed, gcasStep, gcasJet });
}

/** The relief's heights forgotten (a test's ground changed). */
export const gcasForget = () => cache.clear();
