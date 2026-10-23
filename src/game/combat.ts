// The F-35's weapons and its fights (docs/PLAN-F35.md, F10). Pure: a combat area's world in a local frame
// (metres east, north, up from its anchor — a few tens of kilometres: flat), its targets (drones, aggressor
// fighters flown by an AI, a surface-to-air site, trucks, a bunker), its weapons in flight (the 25 mm gun's
// rounds, the AIM-120's and the AIM-9X's missiles flown by proportional navigation, the JDAM glided to its
// point, the enemy's missiles), the countermeasures (flares and chaff decoying what chases), the radar
// (its scan before the nose, its lock), the damage. The controller (controller/combat.ts) feeds it the
// player's state each frame and its triggers; the HUD and the renderer read it.

export type V3 = [number, number, number];

import { roundStep } from "./gunsight";

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const G = 9.80665;
const D = Math.PI / 180;

// ------------------------------------------------------------------------------------ the weapons

export type MissileKind = "aim120" | "aim9x" | "sam" | "r73" | "jsm";

/** A missile's figures: its motor's push [m/s²] and burn [s], its drag (deceleration k v² [1/m]), its turn
 *  limit [g], its navigation constant, its seeker's cone [rad], its fuze's radius [m], its flight's limit [s],
 *  how a decoy draws it off (flares: an infrared seeker; chaff: a radar one), its warhead's damage. */
export interface MissileDef {
  name: string;
  accel: number;
  burn: number;
  drag: number;
  gMax: number;
  nav: number;
  fov: number;
  fuze: number;
  life: number;
  seeker: "ir" | "radar";
  /** the chance a decoy in its cone draws it, per decoy */
  decoy: number;
  damage: number;
  /** its nominal range against a closing target [m] (the shoot cue's) and its least */
  rMax: number;
  rMin: number;
}

export const MISSILES: Record<MissileKind, MissileDef> = {
  // (AIM-120C AMRAAM: Mach 4, some 100 km head-on at height; its own radar in the last 15 km — here its
  // seeker a radar's from the launch, the jet's lock datalinked)
  aim120: {
    name: "AIM-120C",
    accel: 230,
    burn: 8,
    drag: 2.2e-5,
    gMax: 35,
    nav: 4,
    fov: 40 * D,
    fuze: 12,
    life: 75,
    seeker: "radar",
    decoy: 0.18,
    damage: 120,
    rMax: 55_000,
    rMin: 1500,
  },
  // (AIM-9X Sidewinder: an imaging infrared seeker, 90° off the nose with the helmet's cue, 50 g)
  aim9x: {
    name: "AIM-9X",
    accel: 260,
    burn: 5,
    drag: 4e-5,
    gMax: 50,
    nav: 4,
    fov: 60 * D,
    fuze: 8,
    life: 30,
    seeker: "ir",
    decoy: 0.12,
    damage: 110,
    rMax: 14_000,
    rMin: 400,
  },
  // (a surface-to-air missile: an SA-11 class's radar-guided one)
  sam: {
    name: "SA-11",
    accel: 200,
    burn: 12,
    drag: 2e-5,
    gMax: 25,
    nav: 3.5,
    fov: 35 * D,
    fuze: 15,
    life: 70,
    seeker: "radar",
    decoy: 0.3,
    damage: 120,
    rMax: 32_000,
    rMin: 3000,
  },
  // (the Joint Strike Missile — S1, PLAN C6 —: an anti-ship missile carried in the F-35's bays, a turbojet's
  // cruise near 280 m/s for 150 km and more, its imaging seeker on the ship locked, a heavy warhead)
  jsm: {
    name: "JSM",
    accel: 2,
    burn: 700,
    drag: 2.4e-5,
    gMax: 8,
    nav: 3,
    fov: 50 * D,
    fuze: 14,
    life: 700,
    seeker: "radar",
    decoy: 0.05,
    damage: 460,
    rMax: 160_000,
    rMin: 4000,
  },
  // (the aggressors' infrared missile: an R-73 class's)
  r73: {
    name: "R-73",
    accel: 240,
    burn: 5,
    drag: 4.5e-5,
    gMax: 40,
    nav: 3.5,
    fov: 45 * D,
    fuze: 8,
    life: 25,
    seeker: "ir",
    decoy: 0.35,
    damage: 120,
    rMax: 10_000,
    rMin: 400,
  },
};

/** The gun: the GAU-22/A's 25 mm, 3 300 rounds a minute, 1 040 m/s; its rounds' spread [rad], its hit's
 *  radius on a target [m], a round's damage. */
export const GUN = { rounds: 220, rate: 55, muzzle: 1040, spread: 1.6e-3, hitR: 7, damage: 9, life: 3.5 };
/** The JDAM (GBU-32, 1 000 lb): glided to its point by its tail's fins, its blast's radius [m]. */
export const JDAM = { blast: 35, damage: 400, gMax: 3, cd: 4e-5 };

/** A loadout: the weapons carried (the bays' four stations, the gun pod, the wings' two outer ones). */
/** The player's options in a fight (the F-35's settings). */
export interface CombatOptions {
  infinite: boolean;
  invulnerable: boolean;
  /** the aggressors: their turn's g, their reactions, their shots' pace */
  skill: "easy" | "normal" | "ace";
  enemyMissiles: boolean;
  /** a match's (docs/PLAN-RESEAU.md R3): one's own team's craft hurt by one's shots */
  friendlyFire?: boolean;
}
/** Each skill's factors: the g the aggressors pull, the time between their shots, their gun's dispersion. */
export const SKILL = {
  easy: { g: 0.6, reload: 1.8, spread: 2 },
  normal: { g: 1, reload: 1, spread: 1 },
  ace: { g: 1.25, reload: 0.6, spread: 0.6 },
} as const;

export interface Loadout {
  id: "aa" | "ag" | "gun" | "as";
  aim120: number;
  aim9x: number;
  jdam: number;
  /** anti-ship missiles (S1: the "as" load) */
  jsm: number;
  gun: number;
  flares: number;
}
export const LOADOUTS: Record<Loadout["id"], Loadout> = {
  aa: { id: "aa", aim120: 4, aim9x: 2, jdam: 0, jsm: 0, gun: GUN.rounds, flares: 30 },
  ag: { id: "ag", aim120: 2, aim9x: 2, jdam: 2, jsm: 0, gun: GUN.rounds, flares: 30 },
  gun: { id: "gun", aim120: 0, aim9x: 0, jdam: 0, jsm: 0, gun: GUN.rounds, flares: 30 },
  // (anti-ship: two JSMs in the bays, two AMRAAMs and two Sidewinders for the way)
  as: { id: "as", aim120: 2, aim9x: 2, jdam: 0, jsm: 2, gun: GUN.rounds, flares: 30 },
};
/** The mass each adds [kg] (the gun pod with its rounds, a missile, a bomb). */
export const STORE_KG = { aim120: 152, aim9x: 85, jdam: 460, jsm: 416, gunPod: 330 };
export const loadoutMass = (l: Loadout) =>
  l.aim120 * STORE_KG.aim120 + l.aim9x * STORE_KG.aim9x + l.jdam * STORE_KG.jdam + (l.jsm ?? 0) * STORE_KG.jsm + STORE_KG.gunPod;

// ------------------------------------------------------------------------------------ the world's things

export type TargetKind = "drone" | "fighter" | "sam" | "truck" | "bunker" | "airliner" | "ship";

export interface Target {
  id: number;
  kind: TargetKind;
  name: string;
  p: V3;
  v: V3;
  /** its nose and its top (an aircraft's attitude, for its drawing) */
  fwd: V3;
  up: V3;
  hp: number;
  alive: boolean;
  /** when it was destroyed [s] (its wreck falling, its smoke) */
  diedAt: number;
  /** an aircraft destroyed: out of control — its spin about its nose [rad/s] —, when it hit the ground [s] (its
   *  explosion there; NaN: still falling) */
  wreck?: { spin: number; crashedAt: number };
  /** its radar cross-section [m²] (the detection's range scales with its fourth root) */
  rcs: number;
  /** an aircraft's: its AI's state, its orbit's centre, its weapons left, its next shot's time; a course flown
   *  instead (a mission's airliner: its heading [°], height [m, the frame's], speed [m/s]) or a route (its points,
   *  the next) */
  ai?: {
    mode: "patrol" | "engage" | "defend" | "extend" | "course";
    centre: V3;
    missiles: number;
    nextShot: number;
    speed: number;
    gMax: number;
    course?: { hdg: number; alt: number };
    route?: { pts: V3[]; next: number; loop?: boolean };
    /** its bank at most [rad] (a tanker's 25° — its receivers on its hoses follow it —; else its g's); its roll rate
     *  at most [rad/s] (a tanker's gentle 3°/s: its pods 11 m out rise and fall with its bank) */
    bankMax?: number;
    rollMax?: number;
    /** its course held straight and level, its route left aside until let go (a tanker while it refuels) */
    straight?: boolean;
    /** the lift's part across the path flown now [m/s²]; its bank [rad, + right], its vertical pull [m/s²] (eased
     *  towards the turn asked at its roll and pull rates) */
    lat?: V3;
    phi?: number;
    av?: number;
  };
  /** the mesh it is drawn with (a mission's airliner: "a320t"; else the F-35's) */
  mesh?: string;
  /** neither friend nor foe (a mission's airliner, until it turns hostile); its transponder off */
  neutral?: boolean;
  squawkOff?: boolean;
  /** a SAM site's: its next shot's time, its missiles left */
  site?: { nextShot: number; missiles: number };
  /** another player (docs/PLAN-RESEAU.md R3): his slot — his craft placed each frame from the network, his damage
   *  his own (a hit on him sent to him) */
  peer?: number;
  /** another player shot down, his craft falling out of control to its crash (ui/netmatch.ts — his own fall,
   *  game/wreckfall.ts, placed here from the network), or one of our AI wingmen's wreck (controller/wingmen.ts): its
   *  smoke */
  falling?: boolean;
  /** a target another runs (the host's aggressors on a guest's world): placed from the network, not stepped, a
   *  hit on it sent to the host */
  remote?: boolean;
  /** one of ours (a team-mate): not locked, not hurt unless friendly fire */
  friendly?: boolean;
  /** a craft of the world outside the fight taken in as a target (the free fight's: a real airliner, a ship, a
   *  carrier, another's wingman — its radar id): placed from it each frame, not stepped, not drawn while alive (its
   *  own drawing is), its wreck the fight's */
  proxy?: string;
  /** a remote target's last placing [s of the world] (its smoothing) */
  syncAt?: number;
}

export interface Missile {
  id: number;
  kind: MissileKind;
  /** who fired it: the player ("blue") or a target ("red", its id) */
  owner: "blue" | "red";
  from: number;
  p: V3;
  v: V3;
  t: number;
  /** what it chases: a target's id, the player (−1), a decoy (−2 − its index), nothing (null) */
  target: number | null;
  alive: boolean;
  /** decoys already weighed (each once) */
  seen: Set<number>;
  /** another's (docs/PLAN-RESEAU.md R3): placed from the network, not stepped; its key there */
  remote?: string;
  /** how it ended (PLAN-RADAR-AAA RD8: SPLASH or MISS shown 3 s where it did), the world's time then [s] */
  end?: "splash" | "miss";
  diedAt?: number;
  /** its own time when it lost its target [s] (its self-destruct 6 s on) */
  lostAt?: number;
}

export interface Bomb {
  id: number;
  p: V3;
  v: V3;
  aim: V3;
  alive: boolean;
}

export interface Round {
  p: V3;
  v: V3;
  t: number;
  owner: "blue" | "red";
}

export interface Decoy {
  id: number;
  p: V3;
  v: V3;
  t: number;
  kind: "flare" | "chaff";
}

/** The player as the world sees it: position, velocity [m/s], nose and top (unit), alive, its damage [0 … 100]. */
export interface Player {
  p: V3;
  v: V3;
  fwd: V3;
  up: V3;
}

/** A hit on a target another runs (a player, the host's aggressor): sent to him, applied there. */
export interface NetHit {
  /** the player's slot, or the aggressor's id (the host's) */
  peer?: number;
  target?: number;
  damage: number;
  by: MissileKind | "gun" | "jdam";
  /** an aggressor's (the host's world): a kill no player's */
  ai?: boolean;
}

/** What happened in a step (for the sounds, the voices, the HUD). */
export type CombatEvent =
  | { kind: "launch"; who: "blue" | "red"; missile: MissileKind; id: number }
  | { kind: "hit"; on: number | "player"; by: MissileKind | "gun" | "jdam"; damage: number }
  | { kind: "kill"; target: number; name: string; by: MissileKind | "gun" | "jdam" }
  | { kind: "miss"; missile: number }
  | { kind: "decoyed"; missile: number }
  | { kind: "explode"; p: V3; size: number }
  | { kind: "crash"; target: number; name: string; p: V3 }
  | { kind: "playerDown" };

// ------------------------------------------------------------------------------------ the world

/** A scenario's setup (combat/scenarios in controller/combat.ts): its targets, the player's loadout. */
export interface TargetSpec {
  kind: TargetKind;
  /** east, north [m] from the anchor; height over the ground [m] (an aircraft's) */
  at: [number, number, number];
  hdg?: number;
  speed?: number;
  name?: string;
  /** one of ours (not locked, not hurt, never after the player) */
  friendly?: boolean;
  /** an airliner's way: its route's points (east, north, height over the ground [m]); else its heading held */
  route?: [number, number, number][];
  /** its route flown round and round (a tanker's racetrack) */
  routeLoop?: boolean;
  mesh?: string;
  /** its bank at most [°] (a tanker's: 25), its roll rate at most [°/s] (a tanker's: 3) */
  bankMax?: number;
  rollMax?: number;
}

const SPEC: Record<TargetKind, { hp: number; rcs: number; speed: number; gMax: number; missiles: number }> = {
  drone: { hp: 30, rcs: 0.5, speed: 120, gMax: 3, missiles: 0 },
  fighter: { hp: 100, rcs: 4, speed: 260, gMax: 7.5, missiles: 2 },
  sam: { hp: 150, rcs: 20, speed: 0, gMax: 0, missiles: 4 },
  truck: { hp: 40, rcs: 10, speed: 0, gMax: 0, missiles: 0 },
  bunker: { hp: 300, rcs: 50, speed: 0, gMax: 0, missiles: 0 },
  airliner: { hp: 80, rcs: 40, speed: 220, gMax: 1.4, missiles: 0 },
  // (a frigate — S1 —: under way at 9 m/s, its own surface-to-air missiles)
  ship: { hp: 250, rcs: 5000, speed: 9, gMax: 0, missiles: 6 },
};

export class CombatWorld {
  t = 0;
  targets: Target[] = [];
  missiles: Missile[] = [];
  bombs: Bomb[] = [];
  rounds: Round[] = [];
  decoys: Decoy[] = [];
  /** the player's damage [0 … 100], its stores left, its gun firing */
  damage = 0;
  stores: Loadout;
  firing = false;
  /** the radar: its lock (a target's id) and the targets it sees */
  lock: number | null = null;
  seen: number[] = [];
  /** the craft's own radar keeps the lock and the seen (controller/radar.ts): this world's scan left aside */
  radarFed = false;
  /** the player's options (the F-35's settings): stores never spent, no damage taken, the aggressors' skill,
   *  their missiles and the SAM's fired or not */
  opts: CombatOptions = { infinite: false, invulnerable: false, skill: "normal", enemyMissiles: true };
  /** the hits on targets others run, to send (docs/PLAN-RESEAU.md R3) — taken by the controller */
  netHits: NetHit[] = [];
  private nextId = 1;
  private gunAcc = 0;
  private ground = new Map<string, number>();

  /**
   * @param groundAt the ground's height [m, the frame's] at east, north [m] — sampled on a 250 m grid, kept
   */
  constructor(
    specs: TargetSpec[],
    loadout: Loadout,
    private groundAt: (e: number, n: number) => number,
    private rand: () => number = Math.random,
  ) {
    this.stores = { ...loadout };
    for (const s of specs) this.addTarget(s);
  }

  /** A target set in the world (at its start, or later — a mission's): its id. */
  addTarget(s: TargetSpec): number {
    const S = SPEC[s.kind];
    const air = s.kind === "drone" || s.kind === "fighter" || s.kind === "airliner";
    const h = (s.hdg ?? 0) * D;
    const fwd: V3 = [Math.sin(h), Math.cos(h), 0];
    const p: V3 = [s.at[0], s.at[1], this.groundZ(s.at[0], s.at[1]) + (air ? s.at[2] : 0)];
    const speed = air || s.kind === "ship" ? (s.speed ?? S.speed) : 0;
    const id = this.nextId++;
    const airliner = s.kind === "airliner";
    this.targets.push({
      id,
      kind: s.kind,
      name: s.name ?? s.kind,
      p,
      v: mul(fwd, speed),
      fwd,
      up: [0, 0, 1],
      hp: S.hp,
      alive: true,
      diedAt: NaN,
      rcs: S.rcs,
      friendly: s.friendly,
      mesh: s.mesh ?? (airliner ? "a320t" : undefined),
      ai: air
        ? {
            mode: airliner ? "course" : "patrol",
            centre: [...p],
            missiles: S.missiles,
            nextShot: 20,
            speed,
            gMax: S.gMax,
            course: airliner ? { hdg: s.hdg ?? 0, alt: p[2] } : undefined,
            route: s.route?.length
              ? { pts: s.route.map(([e, n, a]) => [e, n, this.groundZ(e, n) + a] as V3), next: 0, loop: s.routeLoop }
              : undefined,
            bankMax: s.bankMax !== undefined ? s.bankMax * D : undefined,
            rollMax: s.rollMax !== undefined ? s.rollMax * D : undefined,
          }
        : undefined,
      site: s.kind === "sam" || s.kind === "ship" ? { nextShot: 8, missiles: S.missiles } : undefined,
    });
    return id;
  }

  /** An aircraft's course changed (a mission's airliner turned, climbed, sped up — a deviation): its route left. */
  setCourse(id: number, c: { hdg?: number; alt?: number; speed?: number; to?: V3 }) {
    const q = this.targets.find((x) => x.id === id);
    const A = q?.ai;
    if (!q || !A) return;
    const hNow = (Math.atan2(q.v[0], q.v[1]) / D + 360) % 360;
    A.mode = "course";
    A.route = c.to ? { pts: [c.to], next: 0 } : undefined;
    A.course = { hdg: c.hdg ?? A.course?.hdg ?? hNow, alt: c.alt ?? A.course?.alt ?? q.p[2] };
    if (c.speed !== undefined) A.speed = c.speed;
  }

  /** The ground's height [m] at east, north: a 250 m grid's, cached, read between its four nodes (bilinear — the
   *  nearest node's stepped: the floor's pull-ups and a ridge's hiding jumped at each cell's edge). */
  groundZ(e: number, n: number): number {
    const x = e / 250,
      y = n / 250;
    const i = Math.floor(x),
      j = Math.floor(y);
    const fx = x - i,
      fy = y - j;
    const z00 = this.groundNode(i, j),
      z10 = this.groundNode(i + 1, j),
      z01 = this.groundNode(i, j + 1),
      z11 = this.groundNode(i + 1, j + 1);
    return (z00 * (1 - fx) + z10 * fx) * (1 - fy) + (z01 * (1 - fx) + z11 * fx) * fy;
  }

  private groundNode(i: number, j: number): number {
    const k = `${i},${j}`;
    let z = this.ground.get(k);
    if (z === undefined) {
      z = this.groundAt(i * 250, j * 250);
      this.ground.set(k, z);
    }
    return z;
  }

  get alive() {
    return this.damage < 100;
  }

  target(id: number | null) {
    return id === null ? undefined : this.targets.find((q) => q.id === id);
  }

  // ---------------------------------------------------------------------------- the player's triggers

  /** The radar's scan: the targets before the nose (±60°) within its range for their size (an F-35's APG-81:
   *  ~150 km for a fighter's 5 m²), not hidden by the ground (a target over it seen: its height over the ground
   *  over 60 m or the player above it). */
  scan(P: Player) {
    this.seen = this.targets
      .filter((q) => {
        if (!q.alive || q.friendly) return false;
        const r = sub(q.p, P.p);
        const d = len(r);
        const range = 150_000 * (q.rcs / 5) ** 0.25;
        if (d > range) return false;
        if (dot(unit(r), P.fwd) < Math.cos(60 * D)) return false;
        return true;
      })
      .map((q) => q.id);
    if (this.lock !== null && !this.seen.includes(this.lock)) this.lock = null;
  }

  /** The lock moved to the next target seen (nearest first), or dropped at the end. */
  cycleLock(P: Player) {
    const order = this.seen
      .map((id) => this.target(id)!)
      .sort((a, b) => len(sub(a.p, P.p)) - len(sub(b.p, P.p)))
      .map((q) => q.id);
    if (!order.length) return (this.lock = null);
    const i = this.lock === null ? -1 : order.indexOf(this.lock);
    this.lock = i + 1 < order.length ? order[i + 1]! : null;
    return this.lock;
  }

  /** The best missile for the lock (the 9X close and off the nose, the 120 beyond), null: none can. */
  pick(P: Player): MissileKind | null {
    const q = this.target(this.lock);
    if (!q) return this.stores.aim9x > 0 ? "aim9x" : null;
    const d = len(sub(q.p, P.p));
    if (this.stores.aim9x > 0 && d < MISSILES.aim9x.rMax && !isGround(q)) return "aim9x";
    if (this.stores.aim120 > 0 && !isGround(q)) return "aim120";
    return null;
  }

  /** A missile launched at the lock (the 9X: the lock, or what its seeker finds before the nose). */
  launch(P: Player, kind: MissileKind): Missile | null {
    if (kind !== "aim120" && kind !== "aim9x" && kind !== "jsm") return null;
    if (this.stores[kind] <= 0) return null;
    // (the JSM: a ship locked, nothing else)
    if (kind === "jsm" && this.target(this.lock)?.kind !== "ship") return null;
    let tgt = this.lock;
    if (kind === "aim9x" && tgt === null) tgt = this.boresight(P, MISSILES.aim9x.fov / 2, MISSILES.aim9x.rMax);
    // (nothing for its seeker — none locked, none before the nose within reach —: not fired)
    if (tgt === null) return null;
    if (!this.opts.infinite) this.stores[kind]--;
    // (dropped from the bay, or off the rail, at the jet's velocity, a little below)
    const m: Missile = {
      id: this.nextId++,
      kind,
      owner: "blue",
      from: 0,
      p: add(P.p, mul(P.up, -2)),
      v: add(P.v, mul(P.up, -3)),
      t: 0,
      target: tgt,
      alive: true,
      seen: new Set(),
    };
    this.missiles.push(m);
    return m;
  }

  /** A target near the nose (within the cone, the range): the nearest, null: none. */
  boresight(P: Player, cone: number, range: number): number | null {
    let best: Target | null = null,
      bd = Infinity;
    for (const q of this.targets) {
      if (!q.alive || isGround(q) || q.friendly) continue;
      const r = sub(q.p, P.p);
      const d = len(r);
      if (d < range && dot(unit(r), P.fwd) > Math.cos(cone) && d < bd) (best = q), (bd = d);
    }
    return best?.id ?? null;
  }

  /** A JDAM released towards a point (the lock's, or where it would fall unguided). */
  drop(P: Player, aim: V3): Bomb | null {
    if (this.stores.jdam <= 0) return null;
    if (!this.opts.infinite) this.stores.jdam--;
    const b: Bomb = { id: this.nextId++, p: add(P.p, mul(P.up, -1.5)), v: [...P.v], aim, alive: true };
    this.bombs.push(b);
    return b;
  }

  /** Countermeasures: a flare and a chaff bundle out behind. */
  countermeasure(P: Player) {
    if (this.stores.flares <= 0) return false;
    if (!this.opts.infinite) this.stores.flares--;
    for (const kind of ["flare", "chaff"] as const)
      this.decoys.push({ id: this.nextId++, p: add(P.p, mul(P.fwd, -6)), v: add(mul(P.v, 0.85), mul(P.up, -15)), t: 0, kind });
    return true;
  }

  // ---------------------------------------------------------------------------- the step

  /** A step of the world [s] with the player as it is: what happened. */
  step(dt: number, P: Player): CombatEvent[] {
    const ev: CombatEvent[] = this.later;
    this.later = [];
    if (!(dt > 0)) return ev;
    this.t += dt;
    if (!this.radarFed) this.scan(P);
    this.stepGun(dt, P);
    this.stepAi(dt, P, ev);
    // (the ships under way on their heading, on the sea)
    for (const q of this.targets)
      if (q.kind === "ship" && q.alive && !q.proxy) {
        q.p = add(q.p, mul(q.v, dt));
        q.p[2] = this.groundZ(q.p[0], q.p[1]);
      }
    this.stepMissiles(dt, P, ev);
    this.stepBombs(dt, ev);
    this.stepRounds(dt, P, ev);
    for (const d of this.decoys) {
      d.t += dt;
      d.v = add(mul(d.v, 1 - 0.6 * dt), [0, 0, -G * dt * (d.kind === "flare" ? 0.6 : 0.15)]);
      d.p = add(d.p, mul(d.v, dt));
    }
    this.decoys = this.decoys.filter((d) => d.t < 5);
    // (a ship lost: settling into the sea)
    for (const q of this.targets) if (!q.alive && q.kind === "ship" && this.t - q.diedAt < 60) q.p[2] -= 0.4 * dt;
    // (the dead: an aircraft's wreck out of control to the ground — game/combat.ts wreckStep —, its explosion there)
    for (const q of this.targets) if (!q.alive && q.ai && q.wreck && Number.isNaN(q.wreck.crashedAt)) this.wreckStep(q, dt, ev);
    return ev;
  }

  /**
   * A destroyed aircraft out of control: its wings no longer lifting, it falls — the air's drag to some 170 m/s down —,
   * its nose dropping to where it goes and rolling round it; on the ground (or the sea) it explodes, once.
   */
  /** events seen between steps (a remote wreck's crash), given with the next step's */
  private later: CombatEvent[] = [];

  private wreckStep(q: Target, dt: number, ev: CombatEvent[]) {
    const W = q.wreck!;
    const vt = 170;
    const sp = Math.hypot(...q.v);
    q.v = add(q.v, add([0, 0, -G * dt], mul(q.v, (-G * sp * dt) / (vt * vt))));
    q.p = add(q.p, mul(q.v, dt));
    // (the nose to the way it goes, a second's lag; the roll about it)
    const vd = unit(q.v);
    const k = Math.min(dt / 1.2, 1);
    const f = unit(add(mul(q.fwd, 1 - k), mul(vd, k)));
    const right = unit(cross(f, q.up));
    const up0 = unit(cross(right, f));
    const a = W.spin * dt;
    q.fwd = f;
    q.up = unit(add(mul(up0, Math.cos(a)), mul(right, Math.sin(a))));
    const gz = this.groundZ(q.p[0], q.p[1]);
    if (q.p[2] <= gz) {
      q.p[2] = gz;
      q.v = [0, 0, 0];
      W.crashedAt = this.t;
      ev.push({ kind: "explode", p: [...q.p], size: 2.5 });
      ev.push({ kind: "crash", target: q.id, name: q.name, p: [...q.p] });
    }
  }

  /** The fight over (won, lost): only the wrecks still falling stepped — to their crash. */
  stepWrecks(dt: number): CombatEvent[] {
    const ev: CombatEvent[] = this.later;
    this.later = [];
    if (!(dt > 0)) return ev;
    this.t += dt;
    for (const q of this.targets) if (!q.alive && q.ai && q.wreck && Number.isNaN(q.wreck.crashedAt)) this.wreckStep(q, dt, ev);
    return ev;
  }

  /** A wreck still falling, or one crashed — a ship sunk — less than `smoke` seconds ago (its explosion, its smoke). */
  falling(smoke = 0): boolean {
    return this.targets.some(
      (q) =>
        (q.wreck && (Number.isNaN(q.wreck.crashedAt) || this.t - q.wreck.crashedAt < smoke)) ||
        (q.kind === "ship" && !q.alive && this.t - q.diedAt < smoke),
    );
  }

  /** A target's damage share (0 untouched … 1 destroyed). */
  damageOf(q: Target): number {
    return q.alive ? Math.min(Math.max(1 - q.hp / SPEC[q.kind].hp, 0), 1) : 1;
  }

  private stepGun(dt: number, P: Player) {
    if (!this.firing || this.stores.gun <= 0) {
      this.gunAcc = 0;
      return;
    }
    this.gunAcc += dt * GUN.rate;
    while (this.gunAcc >= 1 && this.stores.gun > 0) {
      this.gunAcc -= 1;
      if (!this.opts.infinite) this.stores.gun--;
      // (the pod's line: along the nose, a little dispersion)
      const s = GUN.spread;
      const right = unit(cross(P.fwd, P.up));
      const dir = unit(add(P.fwd, add(mul(right, (this.rand() - 0.5) * 2 * s), mul(P.up, (this.rand() - 0.5) * 2 * s))));
      this.rounds.push({ p: add(P.p, mul(P.fwd, 8)), v: add(P.v, mul(dir, GUN.muzzle)), t: this.gunAcc / GUN.rate, owner: "blue" });
    }
  }

  private stepRounds(dt: number, P: Player, ev: CombatEvent[]) {
    for (const r of this.rounds) {
      const p0 = r.p;
      // (its fall and its drag: the gun's sight counts on the same — game/gunsight.ts)
      roundStep(r, dt);
      r.t += dt;
      // (a hit: the segment flown passing within the hit radius of a target — or of the player, a red round)
      const hitOn = (c: V3, R: number) => segDist(p0, r.p, c) < R;
      if (r.owner === "blue") {
        for (const q of this.targets)
          if (q.alive && !(q.friendly && !this.opts.friendlyFire) && hitOn(q.p, isGround(q) ? 12 : GUN.hitR)) {
            this.damageTarget(q, GUN.damage, "gun", ev);
            r.t = Infinity;
            break;
          }
      } else if (hitOn(P.p, GUN.hitR)) {
        this.hurtPlayer(GUN.damage * 0.8, "gun", ev);
        r.t = Infinity;
      } else
        for (const q of this.targets)
          if (q.peer !== undefined && q.alive && hitOn(q.p, GUN.hitR)) {
            // (an aggressor's round on another player — the host's world: sent to him)
            this.damageTarget(q, GUN.damage * 0.8, "gun", ev, true);
            r.t = Infinity;
            break;
          }
      if (r.p[2] < this.groundZ(r.p[0], r.p[1])) r.t = Infinity;
    }
    this.rounds = this.rounds.filter((r) => r.t < GUN.life);
  }

  private damageTarget(q: Target, dmg: number, by: MissileKind | "gun" | "jdam", ev: CombatEvent[], fromAi = false) {
    // (another's craft, another's aggressor: the hit seen here — its marker —, applied by him)
    if (q.peer !== undefined || q.remote) {
      if (q.friendly && !this.opts.friendlyFire && !fromAi) return;
      this.netHits.push({ peer: q.peer, target: q.remote ? q.id : undefined, damage: dmg, by, ai: fromAi || undefined });
      ev.push({ kind: "hit", on: q.id, by, damage: dmg });
      return;
    }
    q.hp -= dmg;
    ev.push({ kind: "hit", on: q.id, by, damage: dmg });
    if (q.hp <= 0 && q.alive) {
      q.alive = false;
      q.diedAt = this.t;
      ev.push({ kind: "kill", target: q.id, name: q.name, by });
      // (an aircraft: the hit's burst, then out of control to its crash — wreckStep; the ground's at once)
      ev.push({ kind: "explode", p: [...q.p], size: q.ai ? 0.5 : q.kind === "bunker" || q.kind === "ship" ? 3 : 2 });
      if (q.ai) q.wreck = { spin: (this.rand() < 0.5 ? -1 : 1) * (1.2 + 2 * this.rand()), crashedAt: Number.NaN };
      if (this.lock === q.id) this.lock = null;
    }
  }

  /** A hit on the player from another (docs/PLAN-RESEAU.md R3): taken as one of the world's own. */
  hurt(dmg: number, by: MissileKind | "gun" | "jdam"): CombatEvent[] {
    const ev: CombatEvent[] = [];
    this.hurtPlayer(dmg, by === "jdam" ? "gun" : by, ev);
    return ev;
  }

  /** Another's decoys (his flare and chaff, where he dropped them): our missiles may chase them too. */
  addDecoys(p: V3, v: V3, up: V3 = [0, 0, 1]) {
    for (const kind of ["flare", "chaff"] as const)
      this.decoys.push({ id: this.nextId++, p: [...p], v: add(mul(v, 0.85), mul(up, -15)), t: 0, kind });
  }

  /** A hit on one of this world's own targets from another (a guest's shot at the host's aggressor). */
  hitTarget(id: number, dmg: number, by: MissileKind | "gun" | "jdam"): CombatEvent[] {
    const ev: CombatEvent[] = [];
    const q = this.target(id);
    if (q && q.alive && q.peer === undefined && !q.remote) this.damageTarget(q, dmg, by, ev);
    return ev;
  }

  /** The player back in the fight (a match's respawn): his damage gone, his stores as loaded. */
  respawn(loadout: Loadout) {
    this.damage = 0;
    this.stores = { ...loadout };
    this.lock = null;
    this.firing = false;
  }

  /**
   * The other players as targets (docs/PLAN-RESEAU.md R3): each placed where the network says, his team-mates
   * friendly; those gone removed. Their ids: 10 000 + their slot.
   */
  setPeers(list: { slot: number; name: string; p: V3; v: V3; fwd: V3; up: V3; alive: boolean; friendly: boolean; falling?: boolean }[]) {
    const ids = new Set(list.map((x) => 10_000 + x.slot));
    // (the players gone dropped — our AI wingmen, peers of a negative slot, are setWingmen's)
    this.targets = this.targets.filter((q) => q.peer === undefined || q.peer < 0 || ids.has(q.id));
    for (const x of list) {
      const id = 10_000 + x.slot;
      let q = this.target(id);
      if (!q) {
        q = {
          id,
          kind: "fighter",
          name: x.name,
          p: x.p,
          v: x.v,
          fwd: x.fwd,
          up: x.up,
          hp: 100,
          alive: x.alive,
          diedAt: NaN,
          rcs: 4,
          peer: x.slot,
        };
        this.targets.push(q);
      }
      if (q.alive && !x.alive) q.diedAt = this.t;
      Object.assign(q, { name: x.name, p: x.p, v: x.v, fwd: x.fwd, up: x.up, alive: x.alive, friendly: x.friendly, falling: !!x.falling });
      if (!q.alive && this.lock === id) this.lock = null;
    }
  }

  /**
   * Our AI wingmen in the fight (controller/wingmen.ts, F3): each a team-mate the aggressors go after (a peer of
   * a negative slot: −2 for Two…), placed each frame, a hit on it kept in netHits for its own damage. Their ids:
   * 20 000 + their place.
   */
  setWingmen(list: { k: number; name: string; p: V3; v: V3; fwd: V3; up: V3; alive: boolean; falling?: boolean }[]) {
    const ids = new Set(list.map((x) => 20_000 + x.k));
    this.targets = this.targets.filter((q) => !(q.peer !== undefined && q.peer < 0) || ids.has(q.id));
    for (const x of list) {
      const id = 20_000 + x.k;
      let q = this.target(id);
      if (!q) {
        q = {
          id,
          kind: "fighter",
          name: x.name,
          p: x.p,
          v: x.v,
          fwd: x.fwd,
          up: x.up,
          hp: 100,
          alive: x.alive,
          diedAt: NaN,
          rcs: 4,
          peer: -x.k,
        };
        this.targets.push(q);
      }
      if (q.alive && !x.alive) q.diedAt = this.t;
      Object.assign(q, { p: x.p, v: x.v, fwd: x.fwd, up: x.up, alive: x.alive, friendly: true, falling: !!x.falling });
    }
  }

  /** A missile fired by one of ours that is not the player (an AI wingman): its own stores counted by it. */
  launchFrom(from: { p: V3; v: V3; up: V3 }, kind: MissileKind, target: number, fromId: number): Missile {
    const m: Missile = {
      id: this.nextId++,
      kind,
      owner: "blue",
      from: fromId,
      p: add(from.p, mul(from.up, -2)),
      v: add(from.v, mul(from.up, -3)),
      t: 0,
      target,
      alive: true,
      seen: new Set(),
    };
    this.missiles.push(m);
    return m;
  }

  /** The host's aggressors on a guest's world: their state from the network (they are not stepped here). */
  setRemoteTargets(list: { id: number; p: V3; v: V3; fwd: V3; up: V3; alive: boolean }[]) {
    for (const x of list) {
      const q = this.target(x.id);
      if (!q) continue;
      q.remote = true;
      if (q.alive && !x.alive) {
        q.diedAt = this.t;
        if (q.ai) q.wreck = { spin: 0, crashedAt: Number.NaN };
      }
      // (smoothed: carried on by its velocity since the last frame, eased onto the host's sample over a quarter second
      // — its attitude too —: ten samples a second and the network's jitter no longer jumps; a big gap taken at once)
      const dt = this.t - (q.syncAt ?? -1e9);
      if (q.alive && x.alive && dt > 0 && dt < 1 && len(sub(x.p, q.p)) < 300) {
        const a = 1 - Math.exp(-dt / 0.25);
        const b = 1 - Math.exp(-dt / 0.15);
        const p = add(q.p, mul(x.v, dt));
        q.p = add(p, mul(sub(x.p, p), a));
        q.v = x.v;
        q.fwd = unit(add(q.fwd, mul(sub(x.fwd, q.fwd), b)));
        q.up = unit(add(q.up, mul(sub(x.up, q.up), b)));
        q.alive = x.alive;
      } else Object.assign(q, { p: x.p, v: x.v, fwd: x.fwd, up: x.up, alive: x.alive });
      q.syncAt = this.t;
      // (the host's wreck falling here as there: its crash seen — its explosion — as it reaches the ground)
      if (q.wreck && Number.isNaN(q.wreck.crashedAt) && q.p[2] <= this.groundZ(q.p[0], q.p[1]) + 2) {
        q.wreck.crashedAt = this.t;
        this.later.push({ kind: "explode", p: [...q.p], size: 2.5 }, { kind: "crash", target: q.id, name: q.name, p: [...q.p] });
      }
    }
  }

  /** Every aggressor here run by another (a guest's world): none stepped, each hit sent. */
  markRemote() {
    for (const q of this.targets) if (q.peer === undefined) q.remote = true;
  }

  /**
   * The others' missiles in flight (docs/PLAN-RESEAU.md R3): drawn, warned of when chasing the player — not
   * stepped here (their shooter's world guides and fuzes them). Those no longer sent removed.
   */
  setRemoteMissiles(list: { key: string; kind: MissileKind; p: V3; v: V3; atMe: boolean; red: boolean; target?: number | null }[]) {
    const keys = new Set(list.map((m) => m.key));
    this.missiles = this.missiles.filter((m) => !m.remote || keys.has(m.remote));
    for (const x of list) {
      let m = this.missiles.find((y) => y.remote === x.key);
      if (!m) {
        m = {
          id: this.nextId++,
          kind: x.kind,
          owner: x.red ? "red" : "blue",
          from: 0,
          p: x.p,
          v: x.v,
          t: 0,
          target: null,
          alive: true,
          seen: new Set(),
          remote: x.key,
        };
        this.missiles.push(m);
      }
      // (its target: the player — warned —, or an aggressor here — which defends against it)
      Object.assign(m, { p: x.p, v: x.v, target: x.atMe ? -1 : (x.target ?? null), alive: true });
    }
  }

  /** Our missiles flying (ours, and the aggressors' on the host's world): to send. `peerOf`: a target id → its slot. */
  ownMissiles(): Missile[] {
    return this.missiles.filter((m) => m.alive && !m.remote);
  }

  private hurtPlayer(dmg: number, by: MissileKind | "gun", ev: CombatEvent[]) {
    if (!this.alive) return;
    if (this.opts.invulnerable) {
      ev.push({ kind: "hit", on: "player", by, damage: 0 });
      return;
    }
    this.damage = Math.min(100, this.damage + dmg);
    ev.push({ kind: "hit", on: "player", by, damage: dmg });
    if (!this.alive) ev.push({ kind: "playerDown" });
  }

  /** Where a missile's target is now (a target, the player, a decoy), null: lost. */
  private aimOf(m: Missile, P: Player): { p: V3; v: V3 } | null {
    if (m.target === null) return null;
    if (m.target === -1) return P;
    if (m.target <= -2) {
      const d = this.decoys.find((q) => q.id === -2 - m.target!);
      return d ? d : null;
    }
    const q = this.target(m.target);
    return q && q.alive ? q : null;
  }

  private stepMissiles(dt: number, P: Player, ev: CombatEvent[]) {
    for (const m of this.missiles) {
      if (!m.alive) continue;
      // (another's: carried along its velocity until its next sample)
      if (m.remote) {
        m.p = add(m.p, mul(m.v, dt));
        continue;
      }
      const M = MISSILES[m.kind];
      m.t += dt;
      // (its seeker looks at the decoys in its cone, each once: one may draw it off)
      for (const d of this.decoys) {
        if (m.seen.has(d.id) || (d.kind === "flare") !== (M.seeker === "ir") || m.target === null || m.target <= -2) continue;
        if (dot(unit(sub(d.p, m.p)), unit(m.v)) < Math.cos(M.fov / 2)) continue;
        m.seen.add(d.id);
        if (this.rand() < M.decoy) {
          m.target = -2 - d.id;
          ev.push({ kind: "decoyed", missile: m.id });
        }
      }
      const tg = this.aimOf(m, P);
      // (its target lost — out of its cone, its decoy burnt out —: it destroys itself 6 s on, a MISS)
      if (tg) m.lostAt = undefined;
      else m.lostAt ??= m.t;
      let a: V3 = [0, 0, 0];
      if (tg) {
        // proportional navigation: a = N Vc (Ω × u) — the line of sight's turn rate, the closing speed
        const r = sub(tg.p, m.p);
        const vr = sub(tg.v, m.v);
        const R2 = Math.max(dot(r, r), 1);
        const omega = mul(cross(r, vr), 1 / R2);
        const vc = -dot(r, vr) / Math.sqrt(R2);
        a = mul(cross(omega, unit(m.v)), M.nav * Math.max(vc, 50));
        // (the seeker's cone: the target out of it, the lock lost)
        if (dot(unit(r), unit(m.v)) < Math.cos(M.fov) && m.t > 1) m.target = null;
        // (the fuze: the closest point within the step under its radius)
        const close = segDist(m.p, add(m.p, mul(sub(m.v, tg.v), dt)), tg.p);
        if (close < M.fuze) {
          m.alive = false;
          m.end = "splash";
          m.diedAt = this.t;
          ev.push({ kind: "explode", p: [...m.p], size: 0.6 });
          if (m.target === -1) this.hurtPlayer(M.damage * (1 - (close / M.fuze) * 0.4), m.kind, ev);
          else if (m.target !== null && m.target > 0) {
            const q = this.target(m.target);
            if (q) this.damageTarget(q, M.damage * (1 - (close / M.fuze) * 0.4), m.kind, ev, m.owner === "red");
          }
          continue;
        }
      }
      // (the JSM skims the sea: 30 m over it until its last 5 km — its height held, the line of sight's pull upwards
      // or downwards left out —, then onto the ship)
      if (m.kind === "jsm" && tg && len(sub(tg.p, m.p)) > 5000) {
        const zT = this.groundZ(m.p[0], m.p[1]) + 30;
        a = [a[0], a[1], 1.5 * (zT - m.p[2]) - 2 * m.v[2]];
      }
      // (gravity compensated while guided; the turn limited; the motor, the drag)
      const amax = M.gMax * G;
      const al = len(a);
      if (al > amax) a = mul(a, amax / al);
      const u = unit(m.v);
      const thrust = m.t < M.burn ? M.accel : 0;
      const sp = len(m.v);
      const acc = add(add(a, mul(u, thrust - M.drag * sp * sp)), [0, 0, tg ? 0 : -G]);
      m.v = add(m.v, mul(acc, dt));
      m.p = add(m.p, mul(m.v, dt));
      if (
        m.t > M.life ||
        (m.t > M.burn && len(m.v) < 200) ||
        (m.lostAt !== undefined && m.t - m.lostAt > LOST_DESTRUCT) ||
        m.p[2] < this.groundZ(m.p[0], m.p[1])
      ) {
        m.alive = false;
        m.end = "miss";
        m.diedAt = this.t;
        ev.push({ kind: "miss", missile: m.id });
        if (m.p[2] < this.groundZ(m.p[0], m.p[1]) + 5) ev.push({ kind: "explode", p: [...m.p], size: 0.5 });
      }
    }
    this.missiles = this.missiles.filter((m) => m.alive || m.t < M_KEEP);
  }

  private stepBombs(dt: number, ev: CombatEvent[]) {
    for (const b of this.bombs) {
      if (!b.alive) continue;
      // (its fins steer it onto the point by proportional navigation — the line of sight's turn rate —, gravity's
      // pull across its path offset: it glides; no push along its path)
      const r = sub(b.aim, b.p);
      const vr = mul(b.v, -1);
      const R2 = Math.max(dot(r, r), 1);
      const omega = mul(cross(r, vr), 1 / R2);
      const vc = -dot(r, vr) / Math.sqrt(R2);
      const u = unit(b.v);
      const gp = sub([0, 0, G] as V3, mul(u, u[2] * G));
      let a: V3 = add(mul(cross(omega, u), 3 * Math.max(vc, 30)), gp);
      const sp = len(b.v);
      const al = len(a);
      if (al > JDAM.gMax * G) a = mul(a, (JDAM.gMax * G) / al);
      b.v = add(b.v, mul(add(add(a, [0, 0, -G]), mul(b.v, -JDAM.cd * sp)), dt));
      b.p = add(b.p, mul(b.v, dt));
      const gz = this.groundZ(b.p[0], b.p[1]);
      if (b.p[2] <= gz) {
        b.alive = false;
        b.p[2] = gz;
        ev.push({ kind: "explode", p: [...b.p], size: 3 });
        for (const q of this.targets) {
          const d = len(sub(q.p, b.p));
          if (q.alive && d < JDAM.blast) this.damageTarget(q, JDAM.damage * (1 - d / JDAM.blast) + 20, "jdam", ev);
        }
      }
    }
    this.bombs = this.bombs.filter((b) => b.alive);
  }

  /** The aggressors: patrol an orbit, engage the player in its range — pursuit, a lead for the gun —, defend
   *  against a missile chasing (beam it, decoys), fire their missiles and their gun; the SAM site fires on what
   *  flies over 150 m above the ground within its reach. */
  private stepAi(dt: number, Pl: Player, ev: CombatEvent[]) {
    // (the players it may go after: this one — while alive — and the others in a match; the nearest)
    const players: { p: V3; v: V3; ref: number }[] = [
      ...(this.alive ? [{ p: Pl.p, v: Pl.v, ref: -1 }] : []),
      ...this.targets.filter((q) => q.peer !== undefined && q.alive).map((q) => ({ p: q.p, v: q.v, ref: q.id })),
    ];
    const nearest = (from: V3) => {
      let best = players[0] ?? null,
        bd = Infinity;
      for (const x of players) {
        const d = len(sub(x.p, from));
        if (d < bd) (best = x), (bd = d);
      }
      return best;
    };
    for (const q of this.targets) {
      if (!q.alive || q.remote || q.peer !== undefined || q.proxy) continue;
      const T = nearest(q.p);
      if (!T) continue;
      const P = T;
      if (q.site) {
        const r = sub(P.p, q.p);
        const d = len(r);
        const agl = P.p[2] - this.groundZ(P.p[0], P.p[1]);
        if (
          this.opts.enemyMissiles &&
          q.site.missiles > 0 &&
          this.t > q.site.nextShot &&
          d < MISSILES.sam.rMax &&
          d > MISSILES.sam.rMin &&
          agl > 150
        ) {
          q.site.missiles--;
          q.site.nextShot = this.t + 25;
          const m: Missile = {
            id: this.nextId++,
            kind: "sam",
            owner: "red",
            from: q.id,
            p: add(q.p, [0, 0, 5]),
            v: mul(unit(add(unit(r), [0, 0, 0.6])), 60),
            t: 0,
            target: T.ref,
            alive: true,
            seen: new Set(),
          };
          this.missiles.push(m);
          ev.push({ kind: "launch", who: "red", missile: "sam", id: m.id });
        }
        continue;
      }
      const A = q.ai;
      if (!A) continue;
      const r = sub(P.p, q.p);
      const d = len(r);
      // (a missile chasing it: defend — beam it and decoy)
      const threat = this.missiles.find((m) => m.alive && m.owner === "blue" && m.target === q.id && len(sub(m.p, q.p)) < 12_000);
      // (engaged within 40 km, left beyond 45: no flicker between the two at the edge)
      if (q.kind === "fighter" && !q.friendly)
        A.mode = threat ? "defend" : d < (A.mode === "engage" ? 45_000 : 40_000) ? "engage" : "patrol";
      let want: V3;
      if (A.mode === "course") {
        // (a course: its heading and height — or its route's next point, the last held —, no fight; held straight
        // and level when asked — a tanker refuelling: its route's turns put off)
        const R = A.route;
        if (A.straight) {
          const h = Math.hypot(q.fwd[0], q.fwd[1]) || 1;
          want = [q.fwd[0] / h, q.fwd[1] / h, 0];
        } else if (R && R.next < R.pts.length) {
          const to = sub(R.pts[R.next]!, q.p);
          if (len([to[0], to[1], 0]) < 1500) R.next++;
          if (R.next >= R.pts.length && R.loop) R.next = 0;
          const tgt = R.pts[Math.min(R.next, R.pts.length - 1)]!;
          const dd = sub(tgt, q.p);
          want = unit([dd[0], dd[1], clamp(dd[2] / Math.max(len([dd[0], dd[1], 0]), 3000), -0.12, 0.12)]);
        } else {
          const C0 = A.course ?? { hdg: (Math.atan2(q.v[0], q.v[1]) / D + 360) % 360, alt: q.p[2] };
          const hh = C0.hdg * D;
          want = unit([Math.sin(hh), Math.cos(hh), clamp((C0.alt - q.p[2]) / 3000, -0.1, 0.1)]);
        }
      } else if (A.mode === "defend" && threat) {
        // (perpendicular to the missile's line, level, a decoy each second and a half)
        const los = unit(sub(threat.p, q.p));
        const side = unit(cross(los, [0, 0, 1]));
        want = dot(side, q.fwd) > 0 ? side : mul(side, -1);
        if (Math.floor(this.t / 1.5) !== Math.floor((this.t - dt) / 1.5))
          this.decoys.push({ id: this.nextId++, p: [...q.p], v: mul(q.v, 0.8), t: 0, kind: threat.kind === "aim9x" ? "flare" : "chaff" });
      } else if (A.mode === "engage") {
        // (lead pursuit: where the player will be in a time of flight of the gun's rounds)
        const tof = clamp(d / 900, 0, 1.5);
        want = unit(sub(add(P.p, mul(P.v, tof)), q.p));
        // (its missile: the player before its nose within reach)
        const off = Math.acos(clamp(dot(unit(r), q.fwd), -1, 1));
        if (
          this.opts.enemyMissiles &&
          A.missiles > 0 &&
          this.t > A.nextShot &&
          d < MISSILES.r73.rMax * 0.8 &&
          d > MISSILES.r73.rMin &&
          off < 25 * D
        ) {
          A.missiles--;
          A.nextShot = this.t + 18 * SKILL[this.opts.skill].reload;
          const m: Missile = {
            id: this.nextId++,
            kind: "r73",
            owner: "red",
            from: q.id,
            p: add(q.p, mul(q.up, -2)),
            v: [...q.v],
            t: 0,
            target: T.ref,
            alive: true,
            seen: new Set(),
          };
          this.missiles.push(m);
          ev.push({ kind: "launch", who: "red", missile: "r73", id: m.id });
        }
        // (its gun: within 900 m, the player within 3° of its line)
        if (d < 900 && off < 3 * D && Math.floor(this.t * 20) !== Math.floor((this.t - dt) * 20))
          this.rounds.push({
            p: add(q.p, mul(q.fwd, 8)),
            v: add(
              q.v,
              mul(unit(add(q.fwd, [0, 1, 2].map(() => (this.rand() - 0.5) * 0.01 * SKILL[this.opts.skill].spread) as V3)), GUN.muzzle),
            ),
            t: 0,
            owner: "red",
          });
      } else {
        // (patrol: a circle of 5 km about its centre, its height held)
        const c = sub(A.centre, q.p);
        const tang = unit(cross([0, 0, 1], unit([c[0], c[1], 0])));
        const radial = len([c[0], c[1], 0]) - 5000;
        want = unit(add(mul(tang, -1), mul(unit([c[0], c[1], 0]), clamp(radial / 3000, -1, 1))));
        want = unit([want[0], want[1], clamp((A.centre[2] - q.p[2]) / 1500, -0.3, 0.3)]);
      }
      // (never into the ground: 300 m over it held)
      const floor = this.groundZ(q.p[0], q.p[1]) + 300;
      if (q.p[2] < floor) want = unit([want[0], want[1], Math.max(want[2], 0.5)]);
      // (turned towards it as a pilot flies: the angle to it closed over a second or three — not this frame's angle
      // over this frame's time, which shook with the frame rate —, at its g at most; its lift — the weight's part
      // across its path and the turn's pull — rolled towards the one asked at its roll rate and pulled at its pull
      // rate: the bank eased in and out, never snapped at a route's corner or a change of mind; the path following
      // the bank; its speed held)
      const sp = Math.max(len(q.v), 60);
      const u = unit(q.v);
      const turn = sub(want, mul(u, dot(want, u)));
      const tl = len(turn);
      const gm = A.gMax * SKILL[this.opts.skill].g * G;
      const agile = A.gMax >= 7 ? 1 : A.gMax >= 3 ? 0.55 : 0.3;
      const roll = Math.min((agile >= 1 ? 180 : agile > 0.5 ? 90 : 15) * D, A.rollMax ?? Infinity);
      const ang = Math.acos(clamp(dot(want, u), -1, 1));
      const aWant: V3 = tl > 1e-6 ? mul(unit(turn), Math.min(gm, (sp * ang) / (1.2 / agile))) : [0, 0, 0];
      // (the bank asked — the horizontal pull over the weight and the vertical pull —, rolled to at its roll rate;
      // the vertical pull eased at its pull rate; the horizontal one the bank's: g tan φ)
      const hz = Math.hypot(u[0], u[1]);
      const right: V3 = hz > 1e-6 ? [u[1] / hz, -u[0] / hz, 0] : [1, 0, 0];
      const upP = unit(cross(right, u));
      const aH = dot(aWant, right),
        aV = dot(aWant, upP);
      const wt = G * Math.max(upP[2], 0.2);
      const bMax = A.bankMax ?? 80 * D;
      const phiWant = clamp(Math.atan2(aH, Math.max(wt + aV, 0.3 * G)), -bMax, bMax);
      const phi = (A.phi ?? 0) + clamp(phiWant - (A.phi ?? 0), -roll * dt, roll * dt);
      const pull = (gm / 0.6) * agile * dt;
      const av = (A.av ?? 0) + clamp(aV - (A.av ?? 0), -pull, pull);
      A.phi = phi;
      A.av = av;
      const lat = add(mul(right, (wt + av) * Math.tan(phi)), mul(upP, av));
      A.lat = lat;
      const speed = sp + clamp(A.speed - sp, -10 * dt, 10 * dt);
      const nu = unit(add(u, mul(lat, dt / sp)));
      q.v = mul(nu, speed);
      q.p = add(q.p, mul(q.v, dt));
      // (its attitude: the nose along its path, banked into the turn — the lift's tilt)
      q.fwd = nu;
      q.up = unit(add(add([0, 0, G], lat), mul(nu, -dot(add([0, 0, G], lat), nu))));
    }
  }
}

const M_KEEP = 120;
/** A missile with no target this long destroys itself [s]. */
const LOST_DESTRUCT = 6;

/** Whether a target sits on the ground (a site, a vehicle, a building). */
export const isGround = (q: Target) => !q.ai && q.peer === undefined;

/** The least distance from c to the segment a → b. */
export function segDist(a: V3, b: V3, c: V3): number {
  const ab = sub(b, a);
  const L = dot(ab, ab);
  const k = L > 0 ? clamp(dot(sub(c, a), ab) / L, 0, 1) : 0;
  return len(sub(add(a, mul(ab, k)), c));
}

/** The gun's lead: where to put the pipper — the target's place after the rounds' time of flight, their fall
 *  allowed for — as a direction from the player (unit), the time of flight [s]; null: out of the gun's reach. */
export function gunLead(P: Player, q: { p: V3; v: V3 }): { dir: V3; tof: number } | null {
  let tof = len(sub(q.p, P.p)) / GUN.muzzle;
  for (let k = 0; k < 4; k++) {
    const fut = add(q.p, mul(sub(q.v, P.v), tof));
    tof = len(sub(fut, P.p)) / (GUN.muzzle * (1 - 0.12 * tof));
  }
  if (tof > 2.2) return null;
  const fut = add(q.p, mul(sub(q.v, P.v), tof));
  // (the rounds fall ½ g t²: aimed that much above)
  return { dir: unit(add(sub(fut, P.p), [0, 0, 0.5 * G * tof * tof])), tof };
}

/** A missile's launch zone against a target: its range now [m], its reach (closing speed allowed for) and its
 *  least; in range when between them. */
export function launchZone(
  kind: MissileKind,
  P: Player,
  q: { p: V3; v: V3 },
): { range: number; rMax: number; rMin: number; inRange: boolean } {
  const M = MISSILES[kind];
  const r = sub(q.p, P.p);
  const range = len(r);
  const closing = -dot(unit(r), sub(q.v, P.v));
  // (a closing target: farther; a fleeing one: much nearer — its reach scaled by the closing speed)
  // (the JSM: a cruise missile's reach — its turbojet's, not the launch's energy)
  const rMax = kind === "jsm" ? M.rMax : M.rMax * clamp(0.45 + closing / 700, 0.25, 1.4) * clamp(0.6 + P.p[2] / 20_000, 0.6, 1.3);
  return { range, rMax, rMin: M.rMin, inRange: range < rMax && range > M.rMin };
}

/** Where an unguided fall from the player would strike (the bomb's CCIP), the ground at `groundZ`: a few
 *  steps of a fall with drag. */
export function fallPoint(P: Player, groundZ: (e: number, n: number) => number): V3 {
  let p: V3 = [...P.p],
    v: V3 = [...P.v];
  for (let k = 0; k < 6000; k++) {
    const sp = len(v);
    v = add(v, mul(add([0, 0, -G], mul(v, -JDAM.cd * sp)), 0.02));
    p = add(p, mul(v, 0.02));
    if (p[2] <= groundZ(p[0], p[1])) break;
  }
  return p;
}
