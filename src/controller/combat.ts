// The CameraController — a fight flown (docs/PLAN-F35.md, F10; game/combat.ts, game/scenarios.ts): the player's
// state in the fight's frame each frame (its place over the ground, its velocity, its nose), the world stepped,
// the triggers (the gun held on Space — or a HOTAS's trigger —, the weapon chosen released on Enter, the radar's lock on Tab, the weapon
// chosen on =, the countermeasures on −), what happened said and heard, the player's damage, the end (won:
// every target destroyed; lost: shot down, out of time). For the renderer: the aircraft as F-35 instances; for
// the HUD: the targets, the lock, the missiles, the gun's lead, the launch zone, the warnings.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { TANKER } from "./jetmodes";
import { cameraFrame } from "../camera";
import { fleet } from "../fleet";
import { restPose, type F35Pose } from "../f35/model";
import {
  CombatWorld,
  fallPoint,
  isGround,
  launchZone,
  LOADOUTS,
  loadoutMass,
  MISSILES,
  type CombatEvent,
  type CombatOptions,
  type MissileKind,
  type Player,
  type V3,
} from "../game/combat";
import { enu } from "../game/challenges";
import { M_METRES } from "../units";
import { earthView } from "./netcraft";
import { enuAt } from "./traffic";
import { airDensity, finCommand, MISSILE_MESH, MISSILE_SHAPES, missileAxes } from "../game/missile-models";
import { GROUND_MESH, GROUND_UNITS, groundMeshOf, groundPose } from "../game/ground-units";
import { proxyGone, proxyStep, worldIdOf } from "./fightproxy";
import { type GunState, gunFunnel, gunSolution, SIGHT, trackAccel } from "../game/gunsight";
import type { MatchRules } from "../game/match";
import type { Scenario } from "../game/scenarios";
import { t, tf, tr } from "../i18n";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import { store } from "../util/storage";
import type { CameraController } from "../controls";
import type { ShipMeshId } from "../ship";
import type { WreckFall } from "../game/wreckfall";

type Vec3 = [number, number, number];
const D = Math.PI / 180;
const R_EARTH = 6_371_008.8;
const BEST_KEY = "kerr.combat";

declare module "../controls" {
  interface CameraController {
    combatStart: typeof combatStart;
    combatStep: typeof combatStep;
    combatEnd: typeof combatEnd;
    combatTrigger: typeof combatTrigger;
    combatPlayer: typeof combatPlayer;
    combatFocus: typeof combatFocus;
    focusShip: typeof focusShip;
    missileShip: typeof missileShip;
    impactShip: typeof impactShip;
    combatShips: typeof combatShips;
    combatGlares: typeof combatGlares;
    combatHud: typeof combatHud;
  }
}

export type WeaponSel = "aim9x" | "aim120" | "jdam" | "jsm";

export interface CombatState {
  def: Scenario;
  world: CombatWorld;
  weapon: WeaponSel;
  t: number;
  status: "run" | "won" | "lost";
  doneAt: number;
  result: string | null;
  /** the explosions seen: where [frame m], when [s], how big */
  booms: { p: V3; t: number; size: number }[];
  /** the events this frame (the sounds', main.ts's) */
  events: CombatEvent[];
  say: string | null;
  /** the player's state last frame (the HUD's) */
  last: Player | null;
  /** a match's fight (docs/PLAN-RESEAU.md R3, ui/netmatch.ts): its rules the room's, the aggressors run by the
   *  host (not this world, a guest's), its end and the player's respawn the match's */
  net: { host: boolean; rules: MatchRules } | null;
  /** shot down in a match, waiting to fly again: since [s of the fight] */
  downAt: number | null;
  /** shot down in a room (ui/netmatch.ts): our craft out of control to its crash — game/wreckfall.ts, the Earth's
   *  coordinates —, stepped until [s of the fight]; when it ended (crashed, broken up), where in the fight's frame,
   *  the place watched from then (the Earth's); null: none (not over the Earth — the wait alone) */
  fall?: { wreck: WreckFall; last: number; endAt: number | null; at: V3 | null; view: { p: Vec3; fwd: Vec3; up: Vec3 } | null } | null;
  /** the crashes seen — ours, the other players' —: where (the fight's frame), when [s of the fight]: their smoke */
  crashes?: { key: string; p: V3; t: number }[];
  /** the countermeasures dropped this frame (where, how fast, which way up): sent to the others */
  cmOut: { p: V3; v: V3; up: V3 }[];
  /** the last hit of the player's shots, the last kill [s of the fight] (the HUD's hit marker) */
  hitAt: number;
  killAt: number;
  /** the free fight's (ui/netmatch.ts): every craft a target — the outside ones taken in as proxies
   *  (controller/fightproxy.ts: their radar id → the world's id) */
  free?: boolean;
  proxies?: Map<string, number>;
  /** the gun's sight (game/gunsight.ts): the craft's last states (the funnel's), the lock's acceleration measured */
  gun?: { hist: GunState[]; meas: { id: number | null; v: V3 | null; a: V3; t: number } };
}

const dotV = (a: V3 | Vec3, b: V3 | Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unitV = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A match's rules as the world's options. */
const optsOf = (r: MatchRules): CombatOptions => ({
  infinite: r.infinite,
  invulnerable: r.invulnerable,
  skill: r.skill,
  enemyMissiles: r.enemyMissiles,
  friendlyFire: r.friendlyFire,
});

/** Results kept: the best time of each fight won [s]. */
export function combatBests(): Record<string, { time: number; at: string }> {
  return store.getJSON<Record<string, { time: number; at: string }>>(BEST_KEY, {});
}

/** The ground's height [m above the mean radius] at east, north of an anchor. */
function groundAt(anchor: { lat: number; lon: number }) {
  return (e: number, n: number) => {
    const lat = anchor.lat + n / (D * R_EARTH);
    const lon = anchor.lon + e / (D * R_EARTH * Math.cos(anchor.lat * D));
    return groundRelief("earth", bodyFixedOf("earth", lat, lon, 0));
  };
}

/** A fight begun (the craft already placed at its start — ui/challengepanel.ts). */
function combatStart(this: CameraController, def: Scenario, net: { host: boolean; rules: MatchRules } | null = null) {
  const L = LOADOUTS[def.loadout];
  const world = new CombatWorld(def.targets, L, groundAt(def.anchor));
  // (the F-35's settings: the stores, the damage, the aggressors' skill and missiles — a match's: its rules)
  const s = this.s;
  world.opts = net
    ? optsOf(net.rules)
    : { infinite: s.f35InfiniteAmmo, invulnerable: s.f35Invulnerable, skill: s.f35AiSkill, enemyMissiles: s.f35EnemyMissiles };
  // (a guest's world: the aggressors are the host's — placed from his, a hit on one sent to him)
  if (net && !net.host) world.markRemote();
  this.combat = {
    def,
    world,
    weapon: L.jsm ? "jsm" : L.aim9x ? "aim9x" : L.aim120 ? "aim120" : "jdam",
    t: 0,
    status: "run",
    doneAt: 0,
    result: null,
    booms: [],
    events: [],
    say: tr(def.title),
    last: null,
    net,
    downAt: null,
    cmOut: [],
    hitAt: -1,
    killAt: -1,
  };
  // (the stores' mass on the jet — fleet.ts: the payload)
  fleet.payload.f35 = loadoutMass(L);
  // (its targets on the radar — controller/radar.ts —, briefed: hostile from the start, swept at once)
  this.radarSources.set("cmb", (fix) => {
    const C = this.combat;
    const P = C?.last;
    if (!C || !P) return [];
    const W = C.world;
    return W.targets
      .filter((q) => q.alive && !q.proxy)
      .map((q) => ({
        id: `cmb:${q.id}`,
        // (from the fight's flat frame to ours, exactly — PLAN-RADAR-AAA constat 11)
        r: this.combatToLocal(fix, q.p) as V3,
        v: [...q.v] as V3,
        rcs: q.rcs,
        kind: q.kind === "ship" ? ("sea" as const) : isGround(q) ? ("ground" as const) : ("air" as const),
        iff: q.friendly ? ("friend" as const) : q.neutral ? ("neutral" as const) : ("hostile" as const),
        name: q.name,
        // (what it is — the crew's lists: the tanker an A330 MRTT, the others their kind)
        type: q.name === TANKER ? "A330 MRTT" : String(q.kind ?? "").slice(0, 16),
        squawk: (!!q.friendly || q.kind === "airliner") && !q.squawkOff,
        known: true,
        offboard: !!q.friendly,
        colour: q.peer === undefined ? undefined : q.friendly ? "rgba(110, 200, 255, 1)" : "rgba(255, 140, 110, 1)",
        agl: q.p[2] - W.groundZ(q.p[0], q.p[1]),
      }));
  });
  this.radarSweep = true;
}

function combatEnd(this: CameraController) {
  this.combat = null;
  this.gunBurst = 0;
  this.radarSources.delete("cmb");
  fleet.payload.f35 = 0;
}

/** The player in the fight's frame now: its place (east, north of the anchor; up: over the mean radius — the
 *  ground's own measure), velocity, nose, top. Null: elsewhere. */
function combatPlayer(this: CameraController): Player | null {
  const C = this.combat;
  if (!C) return null;
  const g = this.geoNow();
  const cam = cameraFrame(this.s);
  const fr = this.sfFrame(cam);
  if (!g || !fr) return null;
  const [e, n] = enu(C.def.anchor, g);
  const up = groundRelief("earth", bodyFixedOf("earth", g.lat, g.lon, 0)) + fr.h;
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const E = fr.east as Vec3,
    N = fr.north as Vec3,
    U = fr.up as Vec3;
  const toEnu = (v: Vec3): V3 => [dot(v, E), dot(v, N), dot(v, U)];
  const ax = this.shipAxesLocal(cam).map((a) => fr.fromLocal(a) as Vec3);
  return { p: [e, n, up], v: toEnu(fr.vRel as Vec3), fwd: toEnu(ax[2]!), up: toEnu(ax[1]!) };
}

/** A trigger of the player's: "fire" (the weapon chosen), "lock" (the radar's next), "weapon" (the next one
 *  carried), "cm" (a flare and chaff). What to say. */
function combatTrigger(this: CameraController, what: "fire" | "lock" | "weapon" | "cm"): string | null {
  const C = this.combat;
  if (!C || C.status !== "run") return null;
  const P = this.combatPlayer();
  if (!P) return null;
  const W = C.world;
  if (what === "lock") {
    // (the F-35's radar — controller/radar.ts —: its next track; the world's lock its own at once)
    if (this.radarFix()) {
      const said = this.radarLockNext();
      const L = this.radar.lock;
      W.lock = C.free ? worldIdOf(this, L) : L?.startsWith("cmb:") ? Number(L.slice(4)) : null;
      return said;
    }
    const id = W.cycleLock(P);
    const q = W.target(id);
    return q
      ? tf("Locked: {0} · {1} km", q.name, (Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]) / 1000).toFixed(1))
      : t("Lock dropped");
  }
  if (what === "weapon") {
    const order: WeaponSel[] = ["aim9x", "aim120", "jdam", "jsm"];
    for (let k = 1; k <= order.length; k++) {
      const w = order[(order.indexOf(C.weapon) + k) % order.length]!;
      if (W.stores[w] > 0) {
        C.weapon = w;
        break;
      }
    }
    return tf("Weapon: {0} ({1} left)", C.weapon === "jdam" ? "GBU-32 JDAM" : MISSILES[C.weapon].name, W.stores[C.weapon]);
  }
  if (what === "cm") {
    if (!W.countermeasure(P)) return t("Countermeasures: none left");
    C.cmOut.push({ p: [...P.p], v: [...P.v], up: [...P.up] });
    return null;
  }
  // fire
  if (C.weapon === "jdam") {
    const q = W.target(W.lock);
    // (on a ground unit, its middle — a tower's shaft, not its foot: the bomb went through the building to the ground beside it,
    // its burst seen past it — Sam)
    const gm = q ? groundMeshOf(q) : undefined;
    const aim = q ? ([q.p[0], q.p[1], q.p[2] + (gm ? (GROUND_UNITS[gm].aimH ?? 0) : 0)] as V3) : fallPoint(P, (e, n) => W.groundZ(e, n));
    const b = W.drop(P, aim);
    return b ? tf("JDAM away — {0}", q?.name ?? t("on the fall point")) : t("No JDAM left");
  }
  const kind: MissileKind = C.weapon;
  if (W.stores[kind] <= 0) return tf("No {0} left", MISSILES[kind].name);
  if (kind === "aim120" && W.lock === null) return t("AIM-120: lock a target first (Tab)");
  if (kind === "jsm" && W.target(W.lock)?.kind !== "ship") return t("JSM: lock a ship first (Tab)");
  const m = W.launch(P, kind);
  if (!m) return t("No target for the seeker");
  C.events.push({ kind: "launch", who: "blue", missile: kind, id: m.id });
  return tf("{0} — {1}", kind === "aim120" ? "FOX 3" : kind === "jsm" ? t("JSM away") : "FOX 2", W.target(m.target)?.name ?? "");
}

/** A frame of the fight: the gun's trigger, the world stepped with the player, its events, its end. */
function combatStep(this: CameraController, dt: number) {
  const C = this.combat;
  if (!C || !(dt > 0)) return;
  // (the events gathered until main.ts hears them — cleared there; a cap if it never does)
  if (C.events.length > 200) C.events.splice(0, C.events.length - 200);
  C.t += dt;
  if (C.status !== "run") {
    // (over: the wrecks still falling to their crash, its explosion; the end when they are down and their smoke has
    // risen — two minutes and a half at most)
    const P = this.combatPlayer();
    if (P) C.last = P;
    const ev = C.world.stepWrecks(dt);
    C.events.push(...ev);
    for (const e of ev) if (e.kind === "explode") C.booms.push({ p: e.p, t: C.t, size: e.size });
    C.booms = C.booms.filter((b) => C.t - b.t < 8);
    if (C.t - C.doneAt > 20 && !(C.world.falling(45) && C.t - C.doneAt < 150)) this.combatEnd();
    return;
  }
  const P = this.combatPlayer();
  if (!P) return;
  C.last = P;
  const W = C.world;
  // (the settings changed in the fight: taken at once)
  const s = this.s;
  W.opts = C.net
    ? optsOf(C.net.rules)
    : { infinite: s.f35InfiniteAmmo, invulnerable: s.f35Invulnerable, skill: s.f35AiSkill, enemyMissiles: s.f35EnemyMissiles };
  // (shot down in a match: no gun until flying again)
  const burst = this.gunBurst > 0;
  if (burst) this.gunBurst = Math.max(0, this.gunBurst - dt);
  W.firing = C.downAt === null && (this.codes.has("Space") || this.gunTrigger || burst || !!this.jetPadOut?.gun);
  // (the free fight: the outside craft near, and the one locked, in the world as targets)
  proxyStep(this);
  const ev = W.step(dt, P);
  // (an outside craft hit, destroyed: another's wingman's hit his; the real one gone, the room told)
  for (const e of ev) {
    const q = e.kind === "kill" || e.kind === "hit" ? W.target(e.kind === "kill" ? e.target : (e.on as number)) : undefined;
    if (!q?.proxy) continue;
    if (e.kind === "hit") this.onProxyHit?.(q.proxy, e.damage, e.by);
    else {
      proxyGone(this, q.proxy);
      this.onProxyDown?.(q.proxy, q.name);
    }
  }
  // (the gun's sight: the craft's states for the funnel, the lock's turn measured)
  const Gs = (C.gun ??= { hist: [], meas: { id: null, v: null, a: [0, 0, 0], t: 0 } });
  Gs.hist.push({ t: C.t, p: [...P.p], v: [...P.v], fwd: [...P.fwd] });
  while (Gs.hist.length && Gs.hist[0]!.t < C.t - SIGHT.funnelSpan - 0.2) Gs.hist.shift();
  const lk = W.target(W.lock);
  if (Gs.meas.id !== (lk?.id ?? null)) Gs.meas = { id: lk?.id ?? null, v: null, a: [0, 0, 0], t: C.t };
  if (lk?.alive) trackAccel(Gs.meas, lk.v, C.t);
  fleet.payload.f35 = loadoutMass(W.stores);
  C.events.push(...ev);
  for (const e of ev) {
    if (e.kind === "explode") C.booms.push({ p: e.p, t: C.t, size: e.size });
    else if (e.kind === "kill") {
      C.say = tf("Splash — {0}", e.name);
      C.killAt = C.t;
    } else if (e.kind === "hit" && e.on !== "player" && e.damage > 0) C.hitAt = C.t;
    else if (e.kind === "launch" && e.who === "red") C.say = e.missile === "sam" ? t("SAM launch! Defend") : t("Missile launch! Defend");
    else if (e.kind === "hit" && e.on === "player") C.say = tf("Hit — damage {0} %", Math.round(W.damage));
  }
  C.booms = C.booms.filter((b) => C.t - b.t < 8);
  // (a match's fight: its end the match's — the host's call —, the player shot down waits to fly again)
  if (C.net) {
    if (!W.alive && C.downAt === null) {
      C.downAt = C.t;
      C.booms.push({ p: [...P.p], t: C.t, size: 1.5 });
    }
    return;
  }
  // (a mission's fight: its end the mission's — controller/mission.ts —, shot down still lost)
  const won = !C.def.mission && W.targets.every((q) => !q.alive);
  if (!W.alive) {
    C.status = "lost";
    C.doneAt = C.t;
    C.result = tf("{0} — shot down", tr(C.def.title));
    C.say = C.result;
    this.crashed(t("Shot down"));
  } else if (won) {
    C.status = "won";
    C.doneAt = C.t;
    const all = combatBests();
    const best = !all[C.def.id] || C.t < all[C.def.id]!.time;
    if (best) {
      all[C.def.id] = { time: C.t, at: new Date().toISOString() };
      store.set(BEST_KEY, JSON.stringify(all));
    }
    C.result =
      tf("{0} — won in {1}", tr(C.def.title), `${Math.floor(C.t / 60)}:${String(Math.floor(C.t % 60)).padStart(2, "0")}`) +
      (best ? ` · ${t("best")}` : "");
    C.say = C.result;
  } else if (!C.def.mission && C.t > C.def.limit) {
    C.status = "lost";
    C.doneAt = C.t;
    C.result = tf("{0} — out of time", tr(C.def.title));
    C.say = C.result;
  }
}

/** A vector of the fight's frame (east, north, up) on the camera's axes. */
export function enuToCam(c: CameraController, Cm: (v: Vec3 | null) => Vec3 | null): ((v: V3) => Vec3) | null {
  const fr = c.sfFrame(cameraFrame(c.s));
  if (!fr) return null;
  const E = fr.east as Vec3,
    N = fr.north as Vec3,
    U = fr.up as Vec3;
  return (v) => {
    const w: Vec3 = [0, 1, 2].map((k) => E[k]! * v[0] + N[k]! * v[1] + U[k]! * v[2]) as Vec3;
    const l = Math.hypot(...w);
    if (l < 1e-9) return [0, 0, 0];
    const loc = fr.toLocal([w[0] / l, w[1] / l, w[2] / l]);
    return Cm(loc.map((x) => x * l) as Vec3)!;
  };
}

/**
 * (the fight on the globe — Sam, 6 Nov 2026: « le lance-missile glisse sur le sol… est-il bien au sol ? ») A point of the
 * fight's flat frame — east, north of its anchor [m], up over the ellipsoid — placed where it is on the Earth (WGS84: its
 * latitude and longitude the frame's — game/challenges.ts enu's inverse —, its height its own, or a ground unit's the relief
 * drawn under it), from the flown craft on the camera's axes [m]; a direction of the frame turned into the axes at that
 * place. The flat frame's vector taken in the craft's axes had put a unit 5 km off some 30 m from where it stood — the frames
 * part by 0.36° 40 km from the anchor —, sliding as the craft flew, floating or sunk on the 250 m grid's ground.
 */
function globeMap(c: CameraController): {
  pos: (p: V3, onGround?: boolean, lift?: number) => Vec3;
  dir: (at: V3, v: V3) => Vec3;
} | null {
  const C = c.combat;
  const E = C ? earthView(c) : null;
  if (!C || !E) return null;
  const a = C.def.anchor;
  const ll = (p: V3) => [a.lat + p[1] / (D * R_EARTH), a.lon + p[0] / (D * R_EARTH * Math.cos(a.lat * D))] as const;
  const toCam = (w: readonly number[]) => E.toCam(E.toHome([w[0]!, w[1]!, w[2]!]));
  return {
    pos: (p, onGround = false, lift = 0) => {
      const [lat, lon] = ll(p);
      const h = (onGround ? groundRelief("earth", bodyFixedOf("earth", lat, lon, 0)) : p[2]) + lift;
      const X = bodyFixedOf("earth", lat, lon, h);
      return toCam([X[0] * M_METRES - E.p0[0]!, X[1] * M_METRES - E.p0[1]!, X[2] * M_METRES - E.p0[2]!]);
    },
    dir: (at, v) => {
      const [lat, lon] = ll(at);
      const L = enuAt(lat, lon);
      return toCam([0, 1, 2].map((k) => L.E[k]! * v[0] + L.N[k]! * v[1] + L.U[k]! * v[2]));
    },
  };
}

/**
 * A point of the fight where it is on the globe (globeMap), as east, north, up components [m] from the flown craft in the
 * local axes there (sfFrame's) — the smoke's and the contrails' frame (controller/computer.ts); null: no Earth view (the flat
 * frame's difference then).
 */
export function combatEnu(c: CameraController, p: V3, onGround = false, lift = 0): V3 | null {
  const G = globeMap(c);
  const cam = cameraFrame(c.s);
  const fr = c.sfFrame(cam);
  if (!G || !fr) return null;
  const v = G.pos(p, onGround, lift);
  const loc = [0, 1, 2].map((k) => cam.right[k]! * v[0] + cam.up[k]! * v[1] + cam.fwd[k]! * v[2]) as Vec3;
  const w = fr.fromLocal(loc);
  const d = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  return [d(w, fr.east), d(w, fr.north), d(w, fr.up)];
}

/** The camera's axes as a mapping of local vectors (telemetry's C). */
function camMap(c: CameraController) {
  const cam = cameraFrame(c.s);
  const d = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (v: Vec3 | null): Vec3 | null => v && [d(v, cam.right as Vec3), d(v, cam.up as Vec3), d(v, cam.fwd as Vec3)];
}

/** The fight's aircraft for the renderer: each an F-35 (the aggressors', the drones' — the only fighter mesh
 *  there is), its place from the flown craft and its axes on the camera's, gear up, its surfaces at rest;
 *  within 30 km, alive or falling. */
function combatShips(this: CameraController): {
  id: ShipMeshId;
  rel: Vec3;
  axes: [Vec3, Vec3, Vec3];
  jet?: F35Pose;
  hidden: boolean;
  fins?: number[];
  motor?: { level: number; air: number };
  ground?: { yaw: number; pitch: number; left: number; burnt: number };
  far?: boolean;
}[] {
  const C = this.combat;
  const P = C?.last;
  if (!C || !P) return [];
  const M = enuToCam(this, camMap(this));
  if (!M) return [];
  // (each placed on the globe — globeMap —; the flat frame's mapping where the Earth's view is not there)
  const G = globeMap(this);
  const pose: F35Pose = { ...restPose(), gear: 0, canopy: 0 };
  const out: {
    id: ShipMeshId;
    rel: Vec3;
    axes: [Vec3, Vec3, Vec3];
    jet?: F35Pose;
    hidden: boolean;
    fins?: number[];
    motor?: { level: number; air: number };
    ground?: { yaw: number; pitch: number; left: number; burnt: number };
    far?: boolean;
  }[] = [];
  for (const q of C.world.targets) {
    // (an outside craft taken in: its own drawing while alive — its wreck the fight's)
    if (!q.ai || (q.proxy && q.alive)) continue;
    // (a wreck: drawn as it falls, gone in its explosion as it hits the ground; else 20 s after it died)
    if (!q.alive && (q.wreck ? q.wreck.crashedAt < C.world.t - 0.4 || C.world.t - q.diedAt > 240 : C.world.t - q.diedAt > 20)) continue;
    const r: V3 = [q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]];
    if (Math.hypot(...r) > 60_000) continue;
    // (the craft's axes: x its left — up × nose —, y its top, z its nose)
    const f = q.fwd,
      u = q.up;
    const left: V3 = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]];
    // (behind a ridge: the line of sight under the ground somewhere along it)
    let hidden = false;
    for (let k = 1; k < 16 && !hidden; k++) {
      const s = k / 16;
      const x = P.p[0] + r[0] * s,
        y = P.p[1] + r[1] * s;
      hidden = P.p[2] + r[2] * s < C.world.groundZ(x, y);
    }
    out.push({
      id: (q.mesh ?? "f35") as ShipMeshId,
      rel: G ? G.pos(q.p) : M(r),
      axes: G ? [G.dir(q.p, left), G.dir(q.p, u), G.dir(q.p, f)] : [M(left), M(u), M(f)],
      jet: pose,
      hidden,
    });
    // (a tanker refuelling us: its hoses, its pods' lights, our probe — controller/aar.ts)
    if (this.aar?.tanker === q.id && q.alive && !hidden) out.unshift(...this.aarShips(P, M));
  }
  // (the missiles in flight within 30 km, the nearest first — ours, the aggressors', the SAMs', another's in a room: their
  // bodies, their fins as the servos follow the guidance's command, their motors while they burn — game/missile-models.ts)
  const msl: typeof out = [];
  const W = C.world;
  const near = W.missiles
    .filter((m) => m.alive)
    .map((m) => ({ m, r: [m.p[0] - P.p[0], m.p[1] - P.p[1], m.p[2] - P.p[2]] as V3 }))
    .filter((e) => Math.hypot(...e.r) < 30_000)
    .sort((a, b) => Math.hypot(...a.r) - Math.hypot(...b.r))
    .slice(0, 12);
  for (const { m, r } of near) {
    const id = MISSILE_MESH[m.kind];
    const shape = MISSILE_SHAPES[id];
    const axes = missileAxes(m.v, m.lat);
    const speed = Math.hypot(...m.v);
    const rho = airDensity(m.p[2]);
    // (the servos: a first-order lag of 40 ms on the command)
    const cmd = finCommand(shape, axes, m.lat, speed, rho, m.t);
    const dt = m.finAt === undefined ? 1 : Math.max(W.t - m.finAt, 0);
    const k = Math.min(1, dt / 0.04);
    m.fin = (m.fin ?? cmd).map((f, i) => f + (cmd[i]! - f) * k);
    m.finAt = W.t;
    let hidden = false;
    for (let s = 1; s < 16 && !hidden; s++) {
      const f = s / 16;
      hidden = P.p[2] + r[2] * f < W.groundZ(P.p[0] + r[0] * f, P.p[1] + r[1] * f);
    }
    const burn = MISSILES[m.kind].burn;
    const level = m.t < burn ? Math.min(1, m.t / 0.15) : 0;
    msl.push({
      id,
      rel: G ? G.pos(m.p) : M(r),
      axes: G ? [G.dir(m.p, axes[0]), G.dir(m.p, axes[1]), G.dir(m.p, axes[2])] : [M(axes[0]), M(axes[1]), M(axes[2])],
      hidden,
      fins: m.fin,
      motor: level > 0 ? { level, air: rho / 1.225 } : undefined,
    });
  }
  // (the bombs falling within 25 km: the GBU-32's body, its tail kit's fins steering it as its guidance asks)
  for (const b of W.bombs.filter((x) => x.alive).slice(-6)) {
    const r: V3 = [b.p[0] - P.p[0], b.p[1] - P.p[1], b.p[2] - P.p[2]];
    if (Math.hypot(...r) > 25_000) continue;
    const shape = MISSILE_SHAPES["msl-gbu32"];
    const axes = missileAxes(b.v, b.lat);
    const cmd = finCommand(shape, axes, b.lat, Math.hypot(...b.v), airDensity(b.p[2]), W.t);
    const k = Math.min(1, (b.finAt === undefined ? 1 : Math.max(W.t - b.finAt, 0)) / 0.05);
    b.fin = (b.fin ?? cmd).map((f, i) => f + (cmd[i]! - f) * k);
    b.finAt = W.t;
    msl.push({
      id: "msl-gbu32",
      rel: G ? G.pos(b.p) : M(r),
      axes: G ? [G.dir(b.p, axes[0]), G.dir(b.p, axes[1]), G.dir(b.p, axes[2])] : [M(axes[0]), M(axes[1]), M(axes[2])],
      hidden: false,
      fins: b.fin,
    });
  }
  // (the ground units within 25 km — the war mode's SAM launchers, tanks, trucks, bunkers —, the nearest sixteen: on the ground,
  // their turret turned onto us while they engage, the launcher's arm raised, the missiles it has left on its rails, a wreck
  // burnt out — game/ground-units.ts)
  const gnd: typeof out = [];
  const units = W.targets
    .filter((q) => GROUND_MESH[q.kind] && !q.proxy && (q.alive || W.t - q.diedAt < 600))
    .map((q) => ({ q, r: [q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]] as V3 }))
    .filter((e) => Math.hypot(...e.r) < 25_000)
    .sort((a, b) => Math.hypot(...a.r) - Math.hypot(...b.r))
    .slice(0, 16);
  for (const { q, r } of units) {
    const id = groundMeshOf(q)!;
    const shape = GROUND_UNITS[id];
    const f: V3 = [q.fwd[0], q.fwd[1], 0];
    const fl = Math.hypot(f[0], f[1]) || 1;
    const fwd: V3 = [f[0] / fl, f[1] / fl, 0];
    const left: V3 = [-fwd[1], fwd[0], 0];
    const d = Math.hypot(...r);
    // (engaging: alive, within its reach — a SAM's, a tank's 4 km)
    const reach = q.kind === "sam" ? MISSILES.sam.rMax : q.kind === "tank" ? 4000 : 0;
    const threat: [number, number] | null = q.alive && d < reach ? [-r[0], -r[1]] : null;
    const dt = q.gpose ? Math.max(W.t - q.gpose.at, 0) : 0;
    const g = groundPose(
      shape,
      Math.atan2(fwd[0], fwd[1]),
      threat,
      q.gpose,
      dt,
      q.site?.missiles ?? shape.rails,
      q.alive ? null : W.t - q.diedAt,
    );
    q.gpose = { yaw: g.yaw, pitch: g.pitch, at: W.t };
    let hidden = false;
    for (let s = 1; s < 16 && !hidden; s++) {
      const k = s / 16;
      hidden = P.p[2] + (r[2] + 2) * k < W.groundZ(P.p[0] + r[0] * k, P.p[1] + r[1] * k);
    }
    // (on the ground drawn — the relief's own height under it, on the globe)
    gnd.push({
      id,
      // (hidden where the image holds something nearer — a ridge, a hill: the relief hides what stands behind it)
      far: true,
      rel: G ? G.pos(q.p, true) : M(r),
      axes: G ? [G.dir(q.p, left), G.dir(q.p, [0, 0, 1]), G.dir(q.p, fwd)] : [M(left), M([0, 0, 1]), M(fwd)],
      hidden,
      ground: g,
    });
  }
  // (the bombs' craters within 15 km, the nearest twelve: scorched ground and its rim, on the relief drawn)
  const cr = W.craters
    .map((k) => ({ k, d: Math.hypot(k.p[0] - P.p[0], k.p[1] - P.p[1]) }))
    .filter((e) => e.d < 15_000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 12);
  for (const { k } of cr) {
    const r: V3 = [k.p[0] - P.p[0], k.p[1] - P.p[1], k.p[2] - P.p[2]];
    gnd.push({
      id: "gu-crater",
      far: true,
      rel: G ? G.pos(k.p, true) : M(r),
      axes: G ? [G.dir(k.p, [1, 0, 0]), G.dir(k.p, [0, 0, 1]), G.dir(k.p, [0, 1, 0])] : [M([1, 0, 0]), M([0, 0, 1]), M([0, 1, 0])],
      hidden: false,
      ground: { yaw: 0, pitch: 0, left: 0, burnt: 0 },
    });
  }
  return [...out.slice(0, 16), ...msl, ...gnd];
}

/**
 * A fight's decoys as the eye sees them (PLAN-RADAR-AAA RD8a — the renderer's lamps' glare, ship.wgsl lampVs): each
 * flare a burning star — lit in a tenth of a second, white-hot, flickering, dying over its last second and a half —,
 * each chaff bundle's first seconds a silver glint as it blooms; the nearest first, within 30 km, ours, the
 * aggressors', the others' in a room alike (game/combat.ts decoys). Their smoke: the trails (computer.ts).
 */
function combatGlares(this: CameraController): { rel: Vec3; r: number; rgb: Vec3 }[] {
  const C = this.combat;
  const P = C?.last;
  if (!C || !P) return [];
  const M = enuToCam(this, camMap(this));
  if (!M) return [];
  const G = globeMap(this);
  const out: { rel: Vec3; r: number; rgb: Vec3; d: number }[] = [];
  const t = C.world.t;
  // (a ground unit destroyed — the war mode —: its fireball, a white flash swelling to an orange ball in half a second, dark
  // red as it lifts and cools over three; then the fire in its wreck, flickering, a minute — its smoke: controller/computer.ts)
  for (const q of C.world.targets) {
    if (q.alive || !GROUND_MESH[q.kind] || q.proxy) continue;
    const age = t - q.diedAt;
    if (!(age >= 0 && age < 60)) continue;
    const r: V3 = [q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]];
    const d = Math.hypot(...r);
    if (d > 30_000) continue;
    const big = q.kind === "bunker" ? 2 : q.kind === "sam" ? 1.5 : 1;
    if (age < 3.5) {
      const k = Math.min(age / 0.08, 1) * (1 - Math.min(Math.max((age - 0.6) / 2.9, 0), 1));
      const hot = Math.max(0, 1 - age / 0.5);
      const rad = big * (4 + 14 * Math.min(age / 0.5, 1) + 4 * age);
      const lift = 2 + 6 * age;
      out.push({
        rel: G ? G.pos(q.p, true, lift) : M([r[0], r[1], r[2] + lift]),
        r: rad,
        // (orange through most of it, white only at its first instants — at the first try's strength its whole disc burnt white)
        rgb: [(16 + 24 * hot) * k, (6.5 + 14 * hot) * k, (1.6 + 8 * hot) * k],
        d,
      });
    }
    if (age > 0.4) {
      const fl = 0.7 + 0.3 * Math.sin(29 * t + q.id) * Math.sin(17 * t + 2.1 * q.id);
      const w = fl * Math.min((age - 0.4) / 0.5, 1) * (1 - Math.min(Math.max((age - 40) / 20, 0), 1));
      out.push({ rel: G ? G.pos(q.p, true, 1.6) : M([r[0], r[1], r[2] + 1.6]), r: 1.6 * big, rgb: [14 * w, 6 * w, 1.6 * w], d });
    }
  }
  for (const q of C.world.decoys) {
    const r: V3 = [q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]];
    const d = Math.hypot(...r);
    if (d > 30_000) continue;
    if (q.kind === "flare") {
      const k = Math.min(q.t / 0.1, 1) * (1 - Math.min(Math.max((q.t - 3.5) / 1.5, 0), 1));
      if (k <= 0) continue;
      const fl = 0.8 + 0.2 * Math.sin(37 * t + q.id * 1.7) * Math.sin(23 * t + q.id);
      const w = k * fl;
      out.push({ rel: G ? G.pos(q.p) : M(r), r: 0.6, rgb: [26 * w, 20 * w, 11 * w], d });
    } else if (q.t < 2) {
      const tw = 0.5 + 0.5 * Math.sin(53 * t + q.id * 2.3);
      const w = (1 - q.t / 2) * tw;
      out.push({ rel: G ? G.pos(q.p) : M(r), r: 0.3, rgb: [2.2 * w, 2.3 * w, 2.6 * w], d });
    }
  }
  return out
    .sort((a, b) => a.d - b.d)
    .slice(0, 24)
    .map(({ rel, r, rgb }) => ({ rel, r, rgb }));
}

/** What the HUD draws of the fight: the targets (their place on the camera's axes, their kind, locked,
 *  seen), the missiles, the gun's lead, the launch zone, the bomb's fall point, the warnings, the stores. */
function combatHud(this: CameraController, Cm: (v: Vec3 | null) => Vec3 | null) {
  const C = this.combat;
  const P = C?.last;
  if (!C || !P) return null;
  const M = enuToCam(this, Cm);
  if (!M) return null;
  const W = C.world;
  const rel = (p: V3): V3 => [p[0] - P.p[0], p[1] - P.p[1], p[2] - P.p[2]];
  const lockT = W.target(W.lock);
  const threats = W.missiles.filter((m) => m.alive && m.owner === "red" && m.target === -1);
  // (the gun's: where to shoot — the lock's velocity and its turn over the rounds' flight —, its funnel, its tracers)
  const meas = C.gun?.meas;
  const lead =
    lockT && lockT.alive && !isGround(lockT)
      ? gunSolution(P, { p: lockT.p, v: lockT.v, a: meas && meas.id === lockT.id ? meas.a : null })
      : null;
  const span = lockT?.kind === "drone" ? 3.5 : 10.7;
  const funnel = C.gun ? gunFunnel(C.gun.hist, C.t, P.p) : [];
  const zone = lockT && C.weapon !== "jdam" ? launchZone(C.weapon, P, lockT) : null;
  // (heading up: the radar's frame — x right, y ahead [m], a track turned from the nose's heading)
  const psi = Math.atan2(P.fwd[0], P.fwd[1]);
  const cs = Math.cos(psi),
    sn = Math.sin(psi);
  const hu = (r: V3) => ({ x: r[0] * cs - r[1] * sn, y: r[0] * sn + r[1] * cs });
  const trk = (v: V3) => (Math.hypot(v[0], v[1]) > 3 ? Math.atan2(v[0], v[1]) - psi : null);
  // (the shot's cue: a missile in its zone and its seeker's cone — the 9X's helmet-cued 60°, the 120's radar 60°
  // —; the gun's: the lead within 15 mrad of the nose, the target within 1.2 km)
  const off = lockT ? Math.acos(Math.min(1, Math.max(-1, dotV(unitV(rel(lockT.p)), P.fwd)))) : Math.PI;
  const shoot = !!zone && zone.inRange && W.stores[C.weapon] > 0 && off < (60 * Math.PI) / 180;
  const leadErr = lead ? Math.acos(Math.min(1, Math.max(-1, dotV(lead.dir, P.fwd)))) : Math.PI;
  const gunHot = !!lead && !!lockT && lead.inRange && leadErr < 0.015 && W.stores.gun > 0;
  return {
    shoot,
    gunHot,
    infinite: W.opts.infinite,
    /** the hit marker: a hit of the player's this quarter second, a kill this second */
    hitMark: (C.t - C.killAt < 1 ? "kill" : C.t - C.hitAt < 0.25 ? "hit" : null) as "hit" | "kill" | null,
    down: C.downAt !== null,
    radar: {
      contacts: W.targets
        .filter((q) => q.alive || W.t - q.diedAt < 3)
        .map((q) => {
          const r = rel(q.p);
          return {
            ...hu(r),
            dz: r[2],
            trk: trk(q.v),
            // (its speed over the ground [m/s]: a crew's picture carries it on between two snapshots)
            spd: Math.round(Math.hypot(q.v[0], q.v[1])),
            air: !isGround(q),
            alive: q.alive,
            locked: q.id === W.lock,
            seen: W.seen.includes(q.id),
            name: q.name,
            side: q.friendly ? ("friend" as const) : q.neutral ? ("neutral" as const) : ("hostile" as const),
            // (another player: a team-mate's blue, an enemy's red)
            colour:
              q.peer === undefined
                ? undefined
                : q.friendly
                  ? "rgba(110, 200, 255, 1)"
                  : q.id === W.lock
                    ? "rgba(255, 70, 60, 1)"
                    : "rgba(255, 140, 110, 1)",
          };
        }),
      missiles: W.missiles.filter((m) => m.alive).map((m) => ({ ...hu(rel(m.p)), trk: trk(m.v), red: m.owner === "red" })),
      decoys: W.decoys.map((d) => ({ ...hu(rel(d.p)), kind: d.kind, age: d.t })),
    },
    title: tr(C.def.title),
    t: C.t,
    limit: C.def.limit,
    status: C.status,
    result: C.result,
    weapon: C.weapon,
    stores: { ...W.stores },
    damage: W.damage,
    firing: W.firing,
    targets: W.targets
      .filter((q) => q.alive || W.t - q.diedAt < 3)
      .map((q) => ({
        d: M(rel(q.p)),
        dist: Math.hypot(...rel(q.p)),
        name: q.name,
        kind: q.kind,
        alive: q.alive,
        locked: q.id === W.lock,
        seen: W.seen.includes(q.id),
        ground: isGround(q),
        friendly: q.friendly,
        closing:
          -(rel(q.p)[0] * (q.v[0] - P.v[0]) + rel(q.p)[1] * (q.v[1] - P.v[1]) + rel(q.p)[2] * (q.v[2] - P.v[2])) /
          Math.max(Math.hypot(...rel(q.p)), 1),
      })),
    missiles: W.missiles
      .filter((m) => m.alive)
      .map((m) => ({ d: M(rel(m.p)), dist: Math.hypot(...rel(m.p)), red: m.owner === "red", motor: m.t < MISSILES[m.kind].burn })),
    rounds: W.rounds.slice(-60).map((r) => M(rel(r.p))),
    /** the tracers: each fifth round a streak (its place, where it was 40 ms before) */
    tracers: W.rounds
      .filter((r) => r.owner === "blue")
      .slice(-80)
      .filter((_, k) => k % 5 === 0)
      .map((r) => [M(rel(r.p)), M(rel([r.p[0] - r.v[0] * 0.04, r.p[1] - r.v[1] * 0.04, r.p[2] - r.v[2] * 0.04]))] as [Vec3, Vec3]),
    /** the funnel: the stream's two edges a wingspan apart (the lock's, a fighter's), the nearest first */
    funnel: funnel
      .slice()
      .reverse()
      .map((f) => {
        const los = unitV(rel(f.p));
        const side = unitV([los[1], -los[0], 0]);
        const e = (k: number): V3 => [f.p[0] + side[0] * k, f.p[1] + side[1] * k, f.p[2]];
        return { l: M(rel(e(-span / 2))), r: M(rel(e(span / 2))), range: f.range };
      }),
    /** the gun's solution: the range, the rounds' time of flight, within the reach */
    gun: lead ? { range: lead.range, tof: lead.tof, inRange: lead.inRange } : null,
    booms: C.booms.map((b) => ({ d: M(rel(b.p)), dist: Math.hypot(...rel(b.p)), age: C.t - b.t, size: b.size })),
    lead: lead ? M(lead.dir) : null,
    zone,
    fall: C.weapon === "jdam" && W.stores.jdam > 0 ? M(rel(fallPoint(P, (e, n) => W.groundZ(e, n)))) : null,
    threats: threats.map((m) => ({ d: M(rel(m.p)), dist: Math.hypot(...rel(m.p)) })),
    gunReady: W.stores.gun > 0,
  };
}

/**
 * What a fight's eye is on now (the replay's lens, the view "On the target"): the target of our missile in flight (the
 * last fired), else an aircraft shot down — falling, or crashed less than 8 s ago —, a ship sunk less than 30 s ago,
 * else the lock. Its place in the fight's frame, what it is.
 */
function combatFocus(this: CameraController): { p: V3; kind: "missile" | "wreck" | "ship" | "lock"; id: number } | null {
  const C = this.combat;
  if (!C) return null;
  const W = C.world;
  const m = W.missiles.filter((x) => x.alive && x.owner === "blue" && (x.target ?? -1) >= 0).sort((a, b) => b.id - a.id)[0];
  const mt = m && W.target(m.target);
  if (mt) return { p: [...mt.p] as V3, kind: "missile", id: mt.id };
  const wreck = W.targets
    .filter((q) => q.wreck && (Number.isNaN(q.wreck.crashedAt) || W.t - q.wreck.crashedAt < 8))
    .sort((a, b) => b.diedAt - a.diedAt)[0];
  if (wreck) return { p: [...wreck.p] as V3, kind: "wreck", id: wreck.id };
  // (our bomb falling: on what it is aimed at; a ground unit destroyed under 15 s ago: on its wreck — the war mode's)
  const bomb = W.bombs.filter((b) => b.alive).at(-1);
  if (bomb) {
    const q = W.targets.find((x) => x.alive && Math.hypot(x.p[0] - bomb.aim[0], x.p[1] - bomb.aim[1]) < 30);
    return { p: [...bomb.aim] as V3, kind: "wreck", id: q?.id ?? -1 };
  }
  const gone = W.targets.filter((q) => isGround(q) && !q.alive && W.t - q.diedAt < 15).sort((a, b) => b.diedAt - a.diedAt)[0];
  if (gone) return { p: [...gone.p] as V3, kind: "wreck", id: gone.id };
  // (another player shot down — ui/netmatch.ts —: his craft falling, his crash less than 8 s ago)
  const fallen = W.targets.filter((q) => q.peer !== undefined && q.falling).sort((a, b) => b.diedAt - a.diedAt)[0];
  if (fallen) return { p: [...fallen.p] as V3, kind: "wreck", id: fallen.id };
  const crash = (C.crashes ?? []).filter((x) => x.key !== "me" && C.t - x.t < 8).sort((a, b) => b.t - a.t)[0];
  if (crash) return { p: [...crash.p] as V3, kind: "wreck", id: -1 };
  const ship = W.targets.filter((q) => q.kind === "ship" && !q.alive && W.t - q.diedAt < 30).sort((a, b) => b.diedAt - a.diedAt)[0];
  if (ship) return { p: [...ship.p] as V3, kind: "ship", id: ship.id };
  const lk = W.target(W.lock);
  return lk?.alive ? { p: [...lk.p] as V3, kind: "lock", id: lk.id } : null;
}

/** The fight's focus on the flown craft's axes (x left, y top, z nose) [m] and the world's up there; null: none. */
/** (the views on the fight read the craft's axes — shipAxesLocal —, which read the view's pose: its mount's place — mountTarget
 *  —, which for these views reads them: a placing made with no pose drawn yet — a flyAt with the lens on the target — ran that
 *  round for ever, the page's stack overflowed. The pose drawn last read instead, and a reentrant call none.) */
let focusDepth = 0;
function focusShip(this: CameraController): { q: Vec3; up: Vec3; size: number } | null {
  if (focusDepth) return null;
  focusDepth++;
  try {
    return focusShipOf(this);
  } finally {
    focusDepth--;
  }
}
function focusShipOf(c: CameraController): { q: Vec3; up: Vec3; size: number } | null {
  const self = c;
  const F = self.combatFocus();
  const P = self.combat?.last;
  const cam = cameraFrame(self.s);
  const fr = self.sfFrame(cam);
  if (!F || !P || !fr) return null;
  const d = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const ax = self
    .shipAxesLocal(cam, self.drawnMatrix())
    .map((a) => fr.fromLocal(a))
    .map((a) => [d(a, fr.east), d(a, fr.north), d(a, fr.up)] as Vec3);
  const r: Vec3 = [F.p[0] - P.p[0], F.p[1] - P.p[1], F.p[2] - P.p[2]];
  // (how much of the world to frame about it [m]: a ship's length, an aircraft's span — with room)
  const tq = self.combat!.world.target(F.id);
  const big = tq?.kind;
  const size = big === "ship" ? 300 : big === "airliner" ? 140 : 60;
  // (on the globe where it is drawn — globeMap; a ground unit on the relief drawn —: the lens on the flat frame's place had
  // framed the ground tens of metres beside it)
  const G = globeMap(self);
  if (G) {
    const S = self.drawnMatrix();
    const toShip = (v: Vec3): Vec3 => [0, 1, 2].map((i) => v[0] * S[0]![i]! + v[1] * S[1]![i]! + v[2] * S[2]![i]!) as Vec3;
    const ground = (tq ? isGround(tq) && !!GROUND_MESH[tq.kind] : false) || (F.kind === "wreck" && !tq?.ai);
    return { q: toShip(G.pos(F.p, ground)), up: toShip(G.dir(F.p, [0, 0, 1])), size };
  }
  return { q: [d(r, ax[0]!), d(r, ax[1]!), d(r, ax[2]!)], up: [ax[0]![2], ax[1]![2], ax[2]![2]], size };
}

/**
 * (the missile's view — mounts.ts "missile") Our last missile in flight on the flown craft's axes (x left, y top, z nose) [m]:
 * its place, its nose, the world's up there; just after it ends — its splash, its miss — held 2.5 s where it did, its nose
 * as it was. Null: none fired, or ended long ago.
 */
function missileShip(this: CameraController): { q: Vec3; fwd: Vec3; up: Vec3; alive: boolean } | null {
  if (focusDepth) return null;
  focusDepth++;
  try {
    return missileShipOf(this);
  } finally {
    focusDepth--;
  }
}
function missileShipOf(self: CameraController): { q: Vec3; fwd: Vec3; up: Vec3; alive: boolean } | null {
  const C = self.combat;
  const P = C?.last;
  if (!C || !P) return null;
  const W = C.world;
  // (our last weapon: a missile — held 2.5 s where it ended —, or a bomb falling — once it has hit, none: the view on the target, its
  // explosion in it)
  const mis = W.missiles
    .filter((x) => x.owner === "blue" && !x.remote && (x.alive || (x.diedAt !== undefined && W.t - x.diedAt < 2.5)))
    .sort((a, b) => Number(b.alive) - Number(a.alive) || b.id - a.id)[0];
  const bomb = W.bombs.filter((b) => b.alive).sort((a, b) => b.id - a.id)[0];
  const m = bomb && (!mis || !mis.alive || bomb.id > mis.id) ? { p: bomb.p, v: bomb.v, lat: bomb.lat, alive: true } : mis;
  // (where it was last seen in flight: the view's orbit about it once it has hit — impactShip)
  if (m?.alive) lastWeapon = { p: [...m.p] as V3, t: W.t, ground: !!bomb && m.p === bomb.p };
  const cam = cameraFrame(self.s);
  const fr = self.sfFrame(cam);
  if (!m || !fr) return null;
  const d = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const ax = self
    .shipAxesLocal(cam, self.drawnMatrix())
    .map((a) => fr.fromLocal(a))
    .map((a) => [d(a, fr.east), d(a, fr.north), d(a, fr.up)] as Vec3);
  const on = (v: ArrayLike<number>): Vec3 => [d(v, ax[0]!), d(v, ax[1]!), d(v, ax[2]!)];
  const r: Vec3 = [m.p[0] - P.p[0], m.p[1] - P.p[1], m.p[2] - P.p[2]];
  const nose = missileAxes(m.v, m.lat)[2];
  // (on the globe, as it is drawn — globeMap —: a vector on the camera's axes into the craft's, through the pose drawn last)
  const G = globeMap(self);
  if (G) {
    const S = self.drawnMatrix();
    const toShip = (c: Vec3): Vec3 => [0, 1, 2].map((i) => c[0] * S[0]![i]! + c[1] * S[1]![i]! + c[2] * S[2]![i]!) as Vec3;
    return { q: toShip(G.pos(m.p)), fwd: toShip(G.dir(m.p, nose)), up: toShip(G.dir(m.p, [0, 0, 1])), alive: m.alive };
  }
  return { q: on(r), fwd: on(nose), up: [ax[0]![2], ax[1]![2], ax[2]![2]], alive: m.alive };
}

/** our last weapon in flight, its place and the world's time then (the weapon's view's orbit after its impact) */
let lastWeapon: { p: V3; t: number; ground: boolean } | null = null;
/** the orbit's length about the impact [s] (then the view back behind the craft) */
export const IMPACT_ORBIT_S = 7;

/**
 * (the weapon's view after its impact — Sam: « quand le missile touche, la vue passe autour de la cible, puis revient au F-35 »)
 * Where our last weapon ended, on the craft's axes (x left, y top, z nose) [m] with the world's east, north and up there, and
 * how long ago [s]; null: none in the last IMPACT_ORBIT_S, or one still in flight.
 */
function impactShip(this: CameraController): { q: Vec3; e: Vec3; n: Vec3; up: Vec3; age: number } | null {
  const C = this.combat;
  const L = lastWeapon;
  if (!C || !L || focusDepth) return null;
  const W = C.world;
  const age = W.t - L.t;
  if (!(age >= 0 && age < IMPACT_ORBIT_S)) return null;
  if (W.bombs.some((b) => b.alive) || W.missiles.some((x) => x.owner === "blue" && x.alive)) return null;
  const G = globeMap(this);
  if (!G) return null;
  focusDepth++;
  try {
    const S = this.drawnMatrix();
    const toShip = (c: Vec3): Vec3 => [0, 1, 2].map((i) => c[0] * S[0]![i]! + c[1] * S[1]![i]! + c[2] * S[2]![i]!) as Vec3;
    return {
      q: toShip(G.pos(L.p, L.ground)),
      e: toShip(G.dir(L.p, [1, 0, 0])),
      n: toShip(G.dir(L.p, [0, 1, 0])),
      up: toShip(G.dir(L.p, [0, 0, 1])),
      age,
    };
  } finally {
    focusDepth--;
  }
}

export function installCombat(Ctl: { prototype: CameraController }) {
  Object.assign(Ctl.prototype, {
    combatStart,
    combatStep,
    combatEnd,
    combatTrigger,
    combatPlayer,
    combatShips,
    combatGlares,
    combatHud,
    combatFocus,
    focusShip,
    missileShip,
    impactShip,
  });
}
