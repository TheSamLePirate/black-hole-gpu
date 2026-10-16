// The CameraController — TARS's hands as the copilot (docs/PLAN-AVIATION-AAA.md, I2): the aircraft about us (the
// radar's picture — the traffic, the room, the wingmen, a fight's —, else the traffic heard), one found by its
// callsign; intercepted, joined in formation; the weapons — chosen, a target locked by its name, the radar's mode,
// fired, the decoys —; the threats watched each frame (game/threats.ts: the calls to say), the picture for TARS.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { MISSILES } from "../game/combat";
import { aspectOf, bearingOf, braa, clockOf, newThreatWatch, type ThreatCall, type ThreatWatch, threatStep } from "../game/threats";
import type { RadarMode } from "../game/radar";
import { t, tf } from "../i18n";
import { unitsOf } from "../ui/unitsys";
import type { WeaponSel } from "./combat";
import { enuAt, placeOf } from "./traffic";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    threatWatch?: { W: ThreatWatch; of: unknown } | null;
    aircraftAround: typeof aircraftAround;
    findAircraft: typeof findAircraft;
    icptOn: typeof icptOn;
    formOnAircraft: typeof formOnAircraft;
    weaponsState: typeof weaponsState;
    weaponSelect: typeof weaponSelect;
    lockOnName: typeof lockOnName;
    radarModeSet: typeof radarModeSet;
    threatsStep: typeof threatsStep;
    threatPicture: typeof threatPicture;
    bogeyDope: typeof bogeyDope;
  }
}

const D = 180 / Math.PI;
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** An aircraft about us: relative to the craft (east, north, up [m]), its velocity; what it is. */
export interface Around {
  id: string;
  name: string;
  /** trf: the real traffic, net: the room's, wng: our wingmen, rwg: the room's wingmen, cmb: a fight's */
  source: string;
  iff: string;
  type?: string;
  reg?: string;
  r: number[];
  v: number[];
  gnd: boolean;
}

/** The aircraft about us, the nearest first: the radar's picture in the F-35 in the air, else the traffic heard. */
function aircraftAround(this: CameraController, maxM = 150_000): Around[] {
  const fix = this.radarFix();
  const trf = new Map(this.trafficNow().map((c) => [c.id, c]));
  let list: Around[];
  if (fix)
    list = this.radarObjects
      .filter((o) => o.kind !== "sea" && (o.kind === "air" || o.id.startsWith("trf:")))
      .map((o) => {
        const src = o.id.slice(0, o.id.indexOf(":"));
        const c = src === "trf" ? trf.get(o.id.slice(4)) : undefined;
        return {
          id: o.id,
          name: o.name,
          source: src,
          iff: o.iff,
          type: c?.type,
          reg: c?.reg,
          r: [...o.r],
          v: [...o.v],
          gnd: o.kind === "ground",
        };
      });
  else {
    const g = this.geoNow();
    if (!g) return [];
    const me = placeOf(g.lat, g.lon, 0, 0, g.alt);
    const L = enuAt(g.lat, g.lon);
    const loc = (w: number[]) => [L.E, L.N, L.U].map((a) => a[0]! * w[0]! + a[1]! * w[1]! + a[2]! * w[2]!);
    list = [...trf.values()].map((c) => ({
      id: `trf:${c.id}`,
      name: c.cs || c.reg || c.id.toUpperCase(),
      source: "trf",
      iff: "neutral",
      type: c.type,
      reg: c.reg,
      r: loc(c.p.map((x, k) => x - me[k]!)),
      v: loc(c.v),
      gnd: c.gnd,
    }));
  }
  return list.filter((a) => Math.hypot(a.r[0]!, a.r[1]!) <= maxM).sort((a, b) => Math.hypot(...a.r) - Math.hypot(...b.r));
}

/** One aircraft by its callsign, registration or name (spaces, case and accents aside; a start enough). */
function findAircraft(this: CameraController, name: string): Around | null {
  const n = fold(name);
  if (!n) return null;
  const all = this.aircraftAround(1e7);
  const keys = (a: Around) => [a.name, a.reg ?? "", a.id.slice(a.id.indexOf(":") + 1)].map(fold);
  return (
    all.find((a) => keys(a).includes(n)) ??
    all.find((a) => keys(a).some((k) => k.length > 2 && (k.startsWith(n) || n.startsWith(k)))) ??
    null
  );
}

/** The intercept engaged on an aircraft by its name (controller/intercept.ts): what to say. */
function icptOn(this: CameraController, name: string): string {
  if (!this.radarFix()) return t("The radar: in the F-35, in the air");
  const a = this.findAircraft(name);
  if (!a) return tf("No aircraft called {0} about us", name);
  const R = this.radar;
  // (locked if the radar sees it; else followed from the picture shared — its transponder, the datalink)
  R.lockOn(a.id);
  if (R.mode === "RWS") R.mode = "TWS";
  if (this.form) this.formOff();
  this.orbitMode = null;
  this.icpt = { id: a.id, name: a.name, phase: "run", seen: null, armed: false, last: null };
  this.s.flightMode = "plane";
  return tf("Intercept: {0} · {1} km", a.name, (Math.hypot(...a.r) / 1000).toFixed(1));
}

/** In formation on an aircraft by its name: a real flight's (controller/traffic.ts), else intercepted to its
 *  shadow. What to say. */
function formOnAircraft(this: CameraController, name: string): string {
  if (!this.radarFix()) return t("The radar: in the F-35, in the air");
  const a = this.findAircraft(name);
  if (!a) return tf("No aircraft called {0} about us", name);
  if (a.source === "trf") {
    // (its formation reads the radar's lock: the track put there even when the beam has not swept it yet)
    const R = this.radar;
    if (!R.lockOn(a.id)) {
      const o = this.radarObjects.find((x) => x.id === a.id);
      if (o)
        R.tracks.set(a.id, {
          id: a.id,
          r: [...o.r],
          v: [...o.v],
          kind: o.kind,
          name: o.name,
          iff: o.iff,
          seenAt: this.radarT,
          hits: 1,
          datalink: false,
        });
      R.lockOn(a.id);
    }
    return this.trafficForm();
  }
  return this.icptOn(name);
}

/** The weapons in a fight: the one chosen, what is left, the lock, the radar's mode and range. */
function weaponsState(this: CameraController) {
  const C = this.combat;
  const R = this.radar;
  const lk = R.lock ? R.tracks.get(R.lock) : null;
  const radar = {
    mode: R.mode,
    lock: lk ? { id: lk.id, name: lk.name, iff: lk.iff, rangeKm: +(Math.hypot(...lk.r) / 1000).toFixed(1) } : null,
    tracks: R.tracks.size,
  };
  if (C?.status !== "run") return { fight: false, radar };
  const W = C.world;
  return {
    fight: true,
    weapon: C.weapon,
    stores: {
      aim120: W.stores.aim120,
      aim9x: W.stores.aim9x,
      jdam: W.stores.jdam,
      jsm: W.stores.jsm,
      gunRounds: W.stores.gun,
      flares: W.stores.flares,
    },
    ranges: {
      aim120: { minKm: MISSILES.aim120.rMin / 1000, maxKm: MISSILES.aim120.rMax / 1000 },
      aim9x: { minKm: MISSILES.aim9x.rMin / 1000, maxKm: MISSILES.aim9x.rMax / 1000 },
    },
    damagePct: Math.round(W.damage),
    targetsLeft: W.targets.filter((q) => q.alive && !q.friendly && !q.neutral).map((q) => q.name),
    radar,
  };
}

/** A weapon chosen (one carried): what to say. */
function weaponSelect(this: CameraController, w: WeaponSel): string {
  const C = this.combat;
  if (C?.status !== "run") return t("No fight running: the weapons are live in a fight or a mission");
  if (C.world.stores[w] <= 0) return tf("No {0} left", w === "jdam" ? "GBU-32 JDAM" : MISSILES[w].name);
  C.weapon = w;
  return tf("Weapon: {0} ({1} left)", w === "jdam" ? "GBU-32 JDAM" : MISSILES[w].name, C.world.stores[w]);
}

/** The radar's lock on a track by its name (or the next one): what to say. */
function lockOnName(this: CameraController, name?: string): string {
  if (!this.radarFix()) return t("The radar: in the F-35, in the air");
  if (!name) return this.combat?.status === "run" ? (this.combatTrigger("lock") ?? "") : this.radarLockNext();
  const R = this.radar;
  const n = fold(name);
  const T =
    [...R.tracks.values()].find((x) => !x.datalink && fold(x.name) === n) ??
    [...R.tracks.values()].find((x) => !x.datalink && fold(x.name).includes(n));
  if (!T) return tf("{0}: not on the radar — not seen yet, or a friend's on the datalink", name);
  R.lockOn(T.id);
  const W = this.combat?.world;
  if (W) W.lock = T.id.startsWith("cmb:") ? Number(T.id.slice(4)) : null;
  return tf("Locked: {0} · {1} km", T.name, (Math.hypot(...T.r) / 1000).toFixed(1));
}

/** The radar's mode set (RWS, TWS, STT on the lock): what to say. */
function radarModeSet(this: CameraController, m: RadarMode): string {
  const R = this.radar;
  if (m === "STT" && !R.lock) R.lockNext();
  if (m === "STT" && !R.lock) return t("STT: no track to lock");
  R.mode = m;
  return tf("Radar: {0}", m);
}

/** A frame of the threat watch, in a fight: the calls to say (none outside one). */
function threatsStep(this: CameraController): ThreatCall[] {
  const C = this.combat;
  const P = C?.last;
  if (!C || !P || C.status !== "run") {
    this.threatWatch = null;
    return [];
  }
  if (this.threatWatch?.of !== C) this.threatWatch = { W: newThreatWatch(), of: C };
  const R = this.radar;
  const W = C.world;
  const rel = (p: readonly number[]) => [p[0]! - P.p[0], p[1]! - P.p[1], p[2]! - P.p[2]];
  return threatStep(
    this.threatWatch.W,
    {
      t: C.t,
      hdg: Math.atan2(P.fwd[0], P.fwd[1]),
      v: P.v,
      // (the radar's own tracks; without it — another craft — the fight's targets as its world sees them)
      tracks: this.radarFix()
        ? [...R.tracks.values()].filter((T) => !T.datalink)
        : W.targets
            .filter((q) => q.alive && W.seen.includes(q.id))
            .map((q) => ({
              id: `cmb:${q.id}`,
              name: q.name,
              iff: q.friendly ? "friend" : q.neutral ? "neutral" : "hostile",
              kind: q.p[2] - W.groundZ(q.p[0], q.p[1]) < 30 ? "ground" : "air",
              r: rel(q.p),
              v: q.v,
            })),
      missiles: W.missiles
        .filter((m) => m.alive && m.owner === "red" && m.target === -1)
        .map((m) => ({ id: m.id, kind: m.kind, r: rel(m.p), v: m.v })),
      events: C.events,
    },
    this.geoNow()?.alt ?? P.p[2],
    unitsOf(this.s.units),
  );
}

/** The tactical picture for TARS: the missiles at us, the hostiles on the radar by their BRAA, the last calls. */
function threatPicture(this: CameraController) {
  const C = this.combat;
  const P = C?.last;
  const u = unitsOf(this.s.units);
  if (!C || !P) return { fight: false };
  const hdg = Math.atan2(P.fwd[0], P.fwd[1]);
  const rel = (p: readonly number[]) => [p[0]! - P.p[0], p[1]! - P.p[1], p[2]! - P.p[2]];
  const alt = this.geoNow()?.alt ?? P.p[2];
  return {
    fight: true,
    missilesAtUs: C.world.missiles
      .filter((m) => m.alive && m.owner === "red" && m.target === -1)
      .map((m) => {
        const r = rel(m.p);
        return { kind: m.kind, clock: clockOf(r, hdg), dist: u.fDist(Math.hypot(...r)) };
      }),
    hostiles: [...this.radar.tracks.values()]
      .filter((T) => T.iff === "hostile" && !T.datalink)
      .sort((a, b) => Math.hypot(...a.r) - Math.hypot(...b.r))
      .map((T) => ({
        name: T.name,
        kind: T.kind,
        bearing: bearingOf(T.r),
        clock: clockOf(T.r, hdg),
        dist: u.fDist(Math.hypot(...T.r)),
        alt: u.fAlt(alt + T.r[2]),
        aspect: aspectOf(T.r, T.v),
        locked: T.id === this.radar.lock,
      })),
    lastCalls: (this.threatWatch?.W.log ?? []).slice(-6).map((l) => l.text),
    headingDeg: Math.round((((hdg * D) % 360) + 360) % 360),
  };
}

/** The AWACS asked for the nearest bandit (I4 — "bogey dope"): its BRAA, said by Darkstar on the radio. */
function bogeyDope(this: CameraController): string {
  const g = this.geoNow();
  const T = [...this.radar.tracks.values()]
    .filter((x) => x.iff === "hostile" && x.kind === "air")
    .sort((a, b) => Math.hypot(...a.r) - Math.hypot(...b.r))[0];
  const text =
    T && g
      ? tf("Darkstar: bogey dope — {0}, hostile, {1}", braa(T.r, T.v, g.alt, unitsOf(this.s.units)), T.name)
      : t("Darkstar: picture clean");
  this.onRadio?.(text);
  return text;
}

export function installCopilot(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    aircraftAround,
    findAircraft,
    icptOn,
    formOnAircraft,
    weaponsState,
    weaponSelect,
    lockOnName,
    radarModeSet,
    threatsStep,
    threatPicture,
    bogeyDope,
  });
}
