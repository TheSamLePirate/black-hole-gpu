// The F-35's weapons and its fights (docs/PLAN-F35.md, F10). Pure: a combat area's world in a local frame
// (metres east, north, up from its anchor — a few tens of kilometres: flat), its targets (drones, aggressor
// fighters flown by an AI, a surface-to-air site, trucks, a bunker), its weapons in flight (the 25 mm gun's
// rounds, the AIM-120's and the AIM-9X's missiles flown by proportional navigation, the JDAM glided to its
// point, the enemy's missiles), the countermeasures (flares and chaff decoying what chases), the radar
// (its scan before the nose, its lock), the damage. The controller (controller/combat.ts) feeds it the
// player's state each frame and its triggers; the HUD and the renderer read it.

export type V3 = [number, number, number];

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

export type MissileKind = "aim120" | "aim9x" | "sam" | "r73";

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
  id: "aa" | "ag" | "gun";
  aim120: number;
  aim9x: number;
  jdam: number;
  gun: number;
  flares: number;
}
export const LOADOUTS: Record<Loadout["id"], Loadout> = {
  aa: { id: "aa", aim120: 4, aim9x: 2, jdam: 0, gun: GUN.rounds, flares: 30 },
  ag: { id: "ag", aim120: 2, aim9x: 2, jdam: 2, gun: GUN.rounds, flares: 30 },
  gun: { id: "gun", aim120: 0, aim9x: 0, jdam: 0, gun: GUN.rounds, flares: 30 },
};
/** The mass each adds [kg] (the gun pod with its rounds, a missile, a bomb). */
export const STORE_KG = { aim120: 152, aim9x: 85, jdam: 460, gunPod: 330 };
export const loadoutMass = (l: Loadout) => l.aim120 * STORE_KG.aim120 + l.aim9x * STORE_KG.aim9x + l.jdam * STORE_KG.jdam + STORE_KG.gunPod;

// ------------------------------------------------------------------------------------ the world's things

export type TargetKind = "drone" | "fighter" | "sam" | "truck" | "bunker";

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
  /** its radar cross-section [m²] (the detection's range scales with its fourth root) */
  rcs: number;
  /** an aircraft's: its AI's state, its orbit's centre, its weapons left, its next shot's time */
  ai?: { mode: "patrol" | "engage" | "defend" | "extend"; centre: V3; missiles: number; nextShot: number; speed: number; gMax: number };
  /** a SAM site's: its next shot's time, its missiles left */
  site?: { nextShot: number; missiles: number };
  /** another player (docs/PLAN-RESEAU.md R3): his slot — his craft placed each frame from the network, his damage
   *  his own (a hit on him sent to him) */
  peer?: number;
  /** a target another runs (the host's aggressors on a guest's world): placed from the network, not stepped, a
   *  hit on it sent to the host */
  remote?: boolean;
  /** one of ours (a team-mate): not locked, not hurt unless friendly fire */
  friendly?: boolean;
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
}

const SPEC: Record<TargetKind, { hp: number; rcs: number; speed: number; gMax: number; missiles: number }> = {
  drone: { hp: 30, rcs: 0.5, speed: 120, gMax: 3, missiles: 0 },
  fighter: { hp: 100, rcs: 4, speed: 260, gMax: 7.5, missiles: 2 },
  sam: { hp: 150, rcs: 20, speed: 0, gMax: 0, missiles: 4 },
  truck: { hp: 40, rcs: 10, speed: 0, gMax: 0, missiles: 0 },
  bunker: { hp: 300, rcs: 50, speed: 0, gMax: 0, missiles: 0 },
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
    for (const s of specs) {
      const S = SPEC[s.kind];
      const air = s.kind === "drone" || s.kind === "fighter";
      const h = (s.hdg ?? 0) * D;
      const fwd: V3 = [Math.sin(h), Math.cos(h), 0];
      const p: V3 = [s.at[0], s.at[1], this.groundZ(s.at[0], s.at[1]) + (air ? s.at[2] : 0)];
      const speed = air ? (s.speed ?? S.speed) : 0;
      this.targets.push({
        id: this.nextId++,
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
        ai: air ? { mode: "patrol", centre: [...p], missiles: S.missiles, nextShot: 20, speed, gMax: S.gMax } : undefined,
        site: s.kind === "sam" ? { nextShot: 8, missiles: S.missiles } : undefined,
      });
    }
  }

  /** The ground's height [m] at east, north (a 250 m grid's, cached). */
  groundZ(e: number, n: number): number {
    const k = `${Math.round(e / 250)},${Math.round(n / 250)}`;
    let z = this.ground.get(k);
    if (z === undefined) {
      z = this.groundAt(Math.round(e / 250) * 250, Math.round(n / 250) * 250);
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
    if (kind === "aim120" ? this.stores.aim120 <= 0 : kind === "aim9x" ? this.stores.aim9x <= 0 : true) return null;
    let tgt = this.lock;
    if (kind === "aim9x" && tgt === null) tgt = this.boresight(P, MISSILES.aim9x.fov / 2, MISSILES.aim9x.rMax);
    // (nothing for its seeker — none locked, none before the nose within reach —: not fired)
    if (tgt === null) return null;
    if (!this.opts.infinite) {
      if (kind === "aim120") this.stores.aim120--;
      else this.stores.aim9x--;
    }
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
    const ev: CombatEvent[] = [];
    if (!(dt > 0)) return ev;
    this.t += dt;
    this.scan(P);
    this.stepGun(dt, P);
    this.stepAi(dt, P, ev);
    this.stepMissiles(dt, P, ev);
    this.stepBombs(dt, ev);
    this.stepRounds(dt, P, ev);
    for (const d of this.decoys) {
      d.t += dt;
      d.v = add(mul(d.v, 1 - 0.6 * dt), [0, 0, -G * dt * (d.kind === "flare" ? 0.6 : 0.15)]);
      d.p = add(d.p, mul(d.v, dt));
    }
    this.decoys = this.decoys.filter((d) => d.t < 5);
    // (the dead: falling — an aircraft's wreck — and gone after a while)
    for (const q of this.targets)
      if (!q.alive && q.ai && q.p[2] > this.groundZ(q.p[0], q.p[1])) {
        q.v = add(q.v, [0, 0, -G * dt]);
        q.p = add(q.p, mul(q.v, dt));
      }
    return ev;
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
      r.v = add(r.v, [0, 0, -G * dt]);
      r.v = mul(r.v, 1 - 2.5e-4 * len(r.v) * dt);
      r.p = add(r.p, mul(r.v, dt));
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
      ev.push({ kind: "explode", p: [...q.p], size: q.ai ? 1 : q.kind === "bunker" ? 3 : 2 });
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
  setPeers(list: { slot: number; name: string; p: V3; v: V3; fwd: V3; up: V3; alive: boolean; friendly: boolean }[]) {
    const ids = new Set(list.map((x) => 10_000 + x.slot));
    this.targets = this.targets.filter((q) => q.peer === undefined || ids.has(q.id));
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
      Object.assign(q, { name: x.name, p: x.p, v: x.v, fwd: x.fwd, up: x.up, alive: x.alive, friendly: x.friendly });
      if (!q.alive && this.lock === id) this.lock = null;
    }
  }

  /** The host's aggressors on a guest's world: their state from the network (they are not stepped here). */
  setRemoteTargets(list: { id: number; p: V3; v: V3; fwd: V3; up: V3; alive: boolean }[]) {
    for (const x of list) {
      const q = this.target(x.id);
      if (!q) continue;
      q.remote = true;
      if (q.alive && !x.alive) q.diedAt = this.t;
      Object.assign(q, { p: x.p, v: x.v, fwd: x.fwd, up: x.up, alive: x.alive });
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
          ev.push({ kind: "explode", p: [...m.p], size: 0.6 });
          if (m.target === -1) this.hurtPlayer(M.damage * (1 - (close / M.fuze) * 0.4), m.kind, ev);
          else if (m.target !== null && m.target > 0) {
            const q = this.target(m.target);
            if (q) this.damageTarget(q, M.damage * (1 - (close / M.fuze) * 0.4), m.kind, ev, m.owner === "red");
          }
          continue;
        }
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
      if (m.t > M.life || (m.t > M.burn && len(m.v) < 200) || m.p[2] < this.groundZ(m.p[0], m.p[1])) {
        m.alive = false;
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
      if (!q.alive || q.remote || q.peer !== undefined) continue;
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
      if (q.kind === "fighter") A.mode = threat ? "defend" : d < 40_000 ? "engage" : "patrol";
      let want: V3;
      if (A.mode === "defend" && threat) {
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
      // (turned towards it at its g at most, its speed held)
      const sp = Math.max(len(q.v), 60);
      const u = unit(q.v);
      const turn = sub(want, mul(u, dot(want, u)));
      const tl = len(turn);
      const rate = Math.min((A.gMax * SKILL[this.opts.skill].g * G) / sp, tl > 1e-6 ? Math.acos(clamp(dot(want, u), -1, 1)) / dt : 0);
      const nu = tl > 1e-6 ? unit(add(u, mul(unit(turn), rate * dt))) : u;
      const speed = sp + clamp(A.speed - sp, -10 * dt, 10 * dt);
      q.v = mul(nu, speed);
      q.p = add(q.p, mul(q.v, dt));
      // (its attitude: the nose along its path, banked into the turn — the lift's tilt)
      const lat = tl > 1e-6 ? mul(unit(turn), rate * speed) : [0, 0, 0];
      q.fwd = nu;
      q.up = unit(add(add([0, 0, G], lat as V3), mul(nu, -dot(add([0, 0, G], lat as V3), nu))));
    }
  }
}

const M_KEEP = 120;

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
  const rMax = M.rMax * clamp(0.45 + closing / 700, 0.25, 1.4) * clamp(0.6 + P.p[2] / 20_000, 0.6, 1.3);
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
