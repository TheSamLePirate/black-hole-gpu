// The CameraController — a fight flown (docs/PLAN-F35.md, F10; game/combat.ts, game/scenarios.ts): the player's
// state in the fight's frame each frame (its place over the ground, its velocity, its nose), the world stepped,
// the triggers (the gun held on Space — or a HOTAS's trigger —, the weapon chosen released on Enter, the radar's lock on Tab, the weapon
// chosen on =, the countermeasures on −), what happened said and heard, the player's damage, the end (won:
// every target destroyed; lost: shot down, out of time). For the renderer: the aircraft as F-35 instances; for
// the HUD: the targets, the lock, the missiles, the gun's lead, the launch zone, the warnings.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import { fleet } from "../fleet";
import { restPose, type F35Pose } from "../f35/model";
import {
  CombatWorld,
  fallPoint,
  gunLead,
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
import type { MatchRules } from "../game/match";
import type { Scenario } from "../game/scenarios";
import { t, tf, tr } from "../i18n";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import { store } from "../util/storage";
import type { CameraController } from "../controls";

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
    combatShips: typeof combatShips;
    combatHud: typeof combatHud;
  }
}

export type WeaponSel = "aim9x" | "aim120" | "jdam";

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
  /** the countermeasures dropped this frame (where, how fast, which way up): sent to the others */
  cmOut: { p: V3; v: V3; up: V3 }[];
  /** the last hit of the player's shots, the last kill [s of the fight] (the HUD's hit marker) */
  hitAt: number;
  killAt: number;
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
    weapon: L.aim9x ? "aim9x" : L.aim120 ? "aim120" : "jdam",
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
}

function combatEnd(this: CameraController) {
  this.combat = null;
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
    const id = W.cycleLock(P);
    const q = W.target(id);
    return q
      ? tf("Locked: {0} · {1} km", q.name, (Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]) / 1000).toFixed(1))
      : t("Lock dropped");
  }
  if (what === "weapon") {
    const order: WeaponSel[] = ["aim9x", "aim120", "jdam"];
    for (let k = 1; k <= 3; k++) {
      const w = order[(order.indexOf(C.weapon) + k) % 3]!;
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
    const aim = q ? ([...q.p] as V3) : fallPoint(P, (e, n) => W.groundZ(e, n));
    const b = W.drop(P, aim);
    return b ? tf("JDAM away — {0}", q?.name ?? t("on the fall point")) : t("No JDAM left");
  }
  const kind: MissileKind = C.weapon;
  if (W.stores[kind] <= 0) return tf("No {0} left", MISSILES[kind].name);
  if (kind === "aim120" && W.lock === null) return t("AIM-120: lock a target first (Tab)");
  const m = W.launch(P, kind);
  if (!m) return t("No target for the seeker");
  C.events.push({ kind: "launch", who: "blue", missile: kind, id: m.id });
  return tf("{0} — {1}", kind === "aim120" ? "FOX 3" : "FOX 2", W.target(m.target)?.name ?? "");
}

/** A frame of the fight: the gun's trigger, the world stepped with the player, its events, its end. */
function combatStep(this: CameraController, dt: number) {
  const C = this.combat;
  if (!C || !(dt > 0)) return;
  // (the events gathered until main.ts hears them — cleared there; a cap if it never does)
  if (C.events.length > 200) C.events.splice(0, C.events.length - 200);
  C.t += dt;
  if (C.status !== "run") {
    if (C.t - C.doneAt > 20) this.combatEnd();
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
  W.firing = C.downAt === null && (this.codes.has("Space") || this.gunTrigger);
  const ev = W.step(dt, P);
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
  const won = W.targets.every((q) => !q.alive);
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
  } else if (C.t > C.def.limit) {
    C.status = "lost";
    C.doneAt = C.t;
    C.result = tf("{0} — out of time", tr(C.def.title));
    C.say = C.result;
  }
}

/** A vector of the fight's frame (east, north, up) on the camera's axes. */
function enuToCam(c: CameraController, Cm: (v: Vec3 | null) => Vec3 | null): ((v: V3) => Vec3) | null {
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

/** The camera's axes as a mapping of local vectors (telemetry's C). */
function camMap(c: CameraController) {
  const cam = cameraFrame(c.s);
  const d = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (v: Vec3 | null): Vec3 | null => v && [d(v, cam.right as Vec3), d(v, cam.up as Vec3), d(v, cam.fwd as Vec3)];
}

/** The fight's aircraft for the renderer: each an F-35 (the aggressors', the drones' — the only fighter mesh
 *  there is), its place from the flown craft and its axes on the camera's, gear up, its surfaces at rest;
 *  within 30 km, alive or falling. */
function combatShips(this: CameraController): { id: "f35"; rel: Vec3; axes: [Vec3, Vec3, Vec3]; jet: F35Pose; hidden: boolean }[] {
  const C = this.combat;
  const P = C?.last;
  if (!C || !P) return [];
  const M = enuToCam(this, camMap(this));
  if (!M) return [];
  const pose: F35Pose = { ...restPose(), gear: 0, canopy: 0 };
  const out: { id: "f35"; rel: Vec3; axes: [Vec3, Vec3, Vec3]; jet: F35Pose; hidden: boolean }[] = [];
  for (const q of C.world.targets) {
    if (!q.ai) continue;
    if (!q.alive && C.world.t - q.diedAt > 20) continue;
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
    out.push({ id: "f35", rel: M(r), axes: [M(left), M(u), M(f)], jet: pose, hidden });
  }
  return out.slice(0, 12);
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
  const lead = lockT && lockT.alive && !isGround(lockT) ? gunLead(P, lockT) : null;
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
  const gunHot = !!lead && !!lockT && Math.hypot(...rel(lockT.p)) < 1200 && leadErr < 0.015 && W.stores.gun > 0;
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
            air: !isGround(q),
            alive: q.alive,
            locked: q.id === W.lock,
            seen: W.seen.includes(q.id),
            name: q.name,
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
    booms: C.booms.map((b) => ({ d: M(rel(b.p)), dist: Math.hypot(...rel(b.p)), age: C.t - b.t, size: b.size })),
    lead: lead ? M(lead.dir) : null,
    zone,
    fall: C.weapon === "jdam" && W.stores.jdam > 0 ? M(rel(fallPoint(P, (e, n) => W.groundZ(e, n)))) : null,
    threats: threats.map((m) => ({ d: M(rel(m.p)), dist: Math.hypot(...rel(m.p)) })),
    gunReady: W.stores.gun > 0,
  };
}

export function installCombat(Ctl: { prototype: CameraController }) {
  Object.assign(Ctl.prototype, { combatStart, combatStep, combatEnd, combatTrigger, combatPlayer, combatShips, combatHud });
}
