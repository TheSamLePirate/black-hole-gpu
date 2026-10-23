// The F-35's radar, the AN/APG-81 (docs/PLAN-AVIATION-AAA.md, C1): always on in the air, its beam sweeping the
// volume before the nose — a contact seen as the beam crosses it, if it is within the range its size allows, over
// the radar's horizon, not behind the ground, and not in the Doppler notch (looking down, a craft flying across the
// beam has the ground's speed: lost in its clutter) —; its track file (each track refreshed at each crossing,
// carried on between, dropped when missed); its modes — RWS (the contacts alone), TWS (tracked: their speeds,
// their ways), STT (the lock alone, measured continuously, the beam on it); the IFF's answer (a friend's or a
// neutral's transponder within 120 km; an unknown stays unknown until seen — within 3 km before the nose); the
// datalink's tracks (the friends', always known). Pure: the contacts relative to the craft in, the tracks out.

export type V3 = [number, number, number];
const D = Math.PI / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

export type Iff = "friend" | "neutral" | "unknown" | "hostile";
export type RadarMode = "RWS" | "TWS" | "STT";

/** A thing the radar may see, relative to the craft in the local frame (east, north, up [m]); its velocity over
 *  the ground [m/s]. */
export interface RadarObject {
  /** its id, its source's prefix (cmb:, net:, trf:, ais:, wng:) */
  id: string;
  r: V3;
  v: V3;
  /** its radar cross-section [m²] */
  rcs: number;
  kind: "air" | "ground" | "sea";
  /** what it is (the truth: what the IFF and the eyes find out) */
  iff: Iff;
  name: string;
  /** its transponder answers the IFF (a friend's, an airliner's) */
  squawk: boolean;
  /** known already (a fight's briefed targets: hostile from the start) */
  known?: boolean;
  /** shared by the datalink (a friend's craft: its place always known, off the radar) */
  offboard?: boolean;
  /** its own colour (a player's) */
  colour?: string;
  /** what it is (an airliner's type, the tanker's A330 MRTT…): the picture's and the crew's */
  type?: string;
  /** its height over the ground [m] (a craft low over it: in the clutter) */
  agl?: number;
}

/** The craft: its axes (local frame), its velocity [m/s], its height over the sea and over the ground [m]. */
export interface RadarOwn {
  fwd: V3;
  up: V3;
  right: V3;
  v: V3;
  alt: number;
  agl: number;
}

export interface Track {
  id: string;
  r: V3;
  v: V3;
  kind: RadarObject["kind"];
  name: string;
  /** the IFF as known now (unknown until answered or seen) */
  iff: Iff;
  colour?: string;
  /** the last time the radar measured it [s]; how many times */
  seenAt: number;
  hits: number;
  /** from the datalink only (not the radar's own) */
  datalink: boolean;
}

/** A radar's figures (PLAN-RADAR-AAA RD4 — one engine, a spec per craft: the F-35's APG-81, a spacecraft's). */
export interface RadarSpec {
  /** its name (the scope's label) */
  name?: string;
  /** the range on a 5 m² fighter [m] (∝ σ^¼) */
  range5: number;
  /** the scan's half-width and half-height [rad] (π: all about), its sweep's time [s] (one way) */
  az: number;
  el: number;
  sweep: number;
  /** a track dropped when not refreshed this long [s] */
  keep: number;
  /** the Doppler notch [m/s] (0: none — in space, no ground's clutter) */
  notch: number;
  /** the IFF's range [m]; the eyes' (an unknown identified) [m] */
  iffRange: number;
  eyes: number;
  /** the radar's horizon's radius [m] (0: none — the caller hides what a body hides) */
  earth43: number;
  /** off above this speed through the air [m/s] (an entry's plasma about the nose); none: always on */
  maxSpeed?: number;
}

export const APG81: RadarSpec = {
  name: "APG-81",
  /** the range on a 5 m² fighter [m] (∝ σ^¼) */
  range5: 150_000,
  /** the scan's half-width [rad] and its sweep's time [s] (one way) */
  az: 60 * D,
  el: 35 * D,
  sweep: 2,
  /** a track dropped when not refreshed this long [s] (two sweeps and a half) */
  keep: 5,
  /** the Doppler notch: a contact's speed along the beam within this of the ground's [m/s], looking down */
  notch: 30,
  /** the IFF's range [m]; the eyes' (an unknown identified) [m] */
  iffRange: 120_000,
  eyes: 3_000,
  /** the radar's horizon: the Earth's radius ×4/3 (the air's refraction) [m] */
  earth43: (4 / 3) * 6.371e6,
};

/**
 * The Ranger's nose radar (PLAN-RADAR-AAA, RD4's leftover): a smaller set in a spaceplane's nose — its weather and
 * traffic radar, an X band antenna of ≈ 60 % the APG-81's reach (90 km on a 5 m² fighter, ≈ 180 km on an airliner),
 * the same ±60° scan, a narrower ±30° in elevation (a nose shorter than a fighter's), a slower sweep; the transponders'
 * IFF only (no NCTR): an unknown stays so until seen. Off in an entry's plasma (above 1 500 m/s through the air).
 */
export const RANGER_NOSE: RadarSpec = {
  name: "NOSE",
  range5: 90_000,
  az: 60 * D,
  el: 30 * D,
  sweep: 2.5,
  keep: 6,
  notch: 30,
  iffRange: 80_000,
  eyes: 3_000,
  earth43: (4 / 3) * 6.371e6,
  maxSpeed: 1500,
};

/** The radar each craft carries in the air, by its id (none: no air radar — the Lander, the Endurance). */
export const AIR_RADARS: Readonly<Record<string, RadarSpec>> = { f35: APG81, ranger: RANGER_NOSE };

/** The detection range [m] on a cross-section σ [m²]. */
export const detectRange = (rcs: number, spec: RadarSpec = APG81) => spec.range5 * (Math.max(rcs, 1e-4) / 5) ** 0.25;

/** The radar's horizon [m] between two heights over the ground [m]: beyond, the Earth's bulge hides it. */
export const radarHorizon = (h1: number, h2: number, spec: RadarSpec = APG81) =>
  spec.earth43 > 0 ? Math.sqrt(2 * spec.earth43 * Math.max(h1, 0)) + Math.sqrt(2 * spec.earth43 * Math.max(h2, 0)) : Infinity;

/** The angles of a direction off the nose [rad]: across (right +), up (+). */
export function offNose(own: RadarOwn, r: V3): { az: number; el: number } {
  const f = dot(r, own.fwd),
    x = dot(r, own.right),
    y = dot(r, own.up);
  return { az: Math.atan2(x, f), el: Math.atan2(y, Math.hypot(f, x)) };
}

export class Radar {
  mode: RadarMode = "TWS";
  /** the beam's azimuth off the nose [rad], its way */
  beam: number;
  private dir = 1;
  tracks = new Map<string, Track>();
  lock: string | null = null;
  /** weapons free (the free fight in a room): the datalink's tracks locked too — a friend's craft, one's own wingman */
  weaponsFree = false;
  /** identified already (the IFF answered, or seen): the truth known, by id */
  private known = new Map<string, Iff>();
  /** the lock's last measure [s] (lost a second after) */
  private lockAt = 0;

  constructor(public spec: RadarSpec = APG81) {
    this.beam = -spec.az;
  }

  /** Back to its start: no tracks, no lock. */
  reset() {
    this.tracks.clear();
    this.known.clear();
    this.lock = null;
    this.beam = -this.spec.az;
    this.dir = 1;
  }

  /** Whether the radar sees this object now (its range, its horizon, the ground between, the notch). */
  sees(own: RadarOwn, o: RadarObject, masked: (r: V3) => boolean): boolean {
    const d = len(o.r);
    if (d > detectRange(o.rcs, this.spec)) return false;
    if (d > radarHorizon(own.agl, o.agl ?? Math.max(own.agl + o.r[2], 0), this.spec)) return false;
    // (the notch: looking down — the ground behind it — at a craft whose speed along the beam is the ground's)
    if (o.kind === "air") {
      const u: V3 = [o.r[0] / d, o.r[1] / d, o.r[2] / d];
      const lookDown = u[2] < 0 || (o.agl ?? Infinity) < 300;
      if (lookDown && this.spec.notch > 0 && Math.abs(dot(o.v, u)) < this.spec.notch) return false;
    }
    return !masked(o.r);
  }

  /**
   * A frame of the radar: the beam swept on (or held on the lock), the objects it crosses measured, the tracks
   * carried on, aged, dropped; the IFF answered; the datalink's taken. `t` the time [s].
   */
  step(dt: number, t: number, own: RadarOwn, objects: RadarObject[], masked: (r: V3) => boolean) {
    if (!(dt > 0)) return;
    const byId = new Map(objects.map((o) => [o.id, o]));
    // (the tracks carried on: their place by their relative motion — TWS's and STT's; RWS keeps them still)
    for (const T of this.tracks.values())
      if (this.mode !== "RWS" || T.datalink) for (let k = 0; k < 3; k++) T.r[k] = T.r[k]! + (T.v[k]! - own.v[k]!) * dt;
    const measure = (o: RadarObject, datalink: boolean) => {
      const T = this.tracks.get(o.id);
      const iff = this.iffOf(o, own);
      if (T) {
        T.r = [...o.r];
        T.v = this.mode === "RWS" && !datalink ? [0, 0, 0] : [...o.v];
        T.seenAt = t;
        T.hits++;
        T.iff = iff;
        T.datalink = datalink && T.datalink;
        T.colour = o.colour;
      } else
        this.tracks.set(o.id, {
          id: o.id,
          r: [...o.r],
          v: this.mode === "RWS" && !datalink ? [0, 0, 0] : [...o.v],
          kind: o.kind,
          name: o.name,
          iff,
          colour: o.colour,
          seenAt: t,
          hits: 1,
          datalink,
        });
    };
    // the datalink: the friends' craft, always known
    for (const o of objects) if (o.offboard) measure(o, true);
    if (this.mode === "STT" && this.lock) {
      // (the beam on the lock: measured each frame while it is in the scan's cone and seen)
      const o = byId.get(this.lock);
      const a = o ? offNose(own, o.r) : null;
      if (o && a && Math.abs(a.az) <= this.spec.az && Math.abs(a.el) <= this.spec.el && this.sees(own, o, masked)) {
        measure(o, false);
        this.lockAt = t;
        this.beam = a.az;
      } else if (t - this.lockAt > 1) this.unlock();
    } else {
      // (the beam swept across: the objects whose azimuth it passed this frame measured)
      const b0 = this.beam;
      let b1 = b0 + ((this.dir * (2 * this.spec.az)) / this.spec.sweep) * dt;
      if (b1 > this.spec.az || b1 < -this.spec.az) {
        b1 = clamp(b1, -this.spec.az, this.spec.az);
        this.dir = -this.dir;
      }
      this.beam = b1;
      const lo = Math.min(b0, b1),
        hi = Math.max(b0, b1);
      for (const o of objects) {
        if (o.offboard) continue;
        const a = offNose(own, o.r);
        if (a.az < lo || a.az > hi || Math.abs(a.el) > this.spec.el) continue;
        if (this.sees(own, o, masked)) measure(o, false);
      }
      // (the lock kept by its track in TWS: lost with it)
      if (this.lock && !this.tracks.has(this.lock)) this.lock = null;
    }
    // the tracks the radar no longer refreshes: dropped (the datalink's when it no longer sends them)
    for (const [id, T] of this.tracks) {
      // (the datalink's: dropped when it no longer sends it — the thing gone, or no one sharing it any more)
      const stale = T.datalink ? !byId.get(id)?.offboard : t - T.seenAt > this.spec.keep;
      if (stale) {
        this.tracks.delete(id);
        if (this.lock === id) this.unlock();
      }
    }
  }

  /** A whole sweep at once (a fight begun: its briefed targets swept before the first frame's beam reaches them). */
  sweepAll(t: number, own: RadarOwn, objects: RadarObject[], masked: (r: V3) => boolean) {
    const b = this.beam,
      d = this.dir;
    this.beam = -this.spec.az;
    this.dir = 1;
    this.step(this.spec.sweep, t, own, objects, masked);
    this.beam = b;
    this.dir = d;
  }

  /** The IFF as the craft knows it now: answered (a transponder within its range), seen (close before the nose),
   *  briefed — else unknown. Once known, kept. */
  private iffOf(o: RadarObject, own: RadarOwn): Iff {
    const was = this.known.get(o.id);
    if (was) return was;
    const d = len(o.r);
    const seen = d < this.spec.eyes && dot(o.r, own.fwd) / Math.max(d, 1) > Math.cos(40 * D);
    const answered = o.squawk && d < this.spec.iffRange && (o.iff === "friend" || o.iff === "neutral");
    if (o.known || o.offboard || answered || seen) {
      this.known.set(o.id, o.iff);
      return o.iff;
    }
    return "unknown";
  }

  /** The lock moved to the next radar track (nearest first, the datalink's left out), or dropped at the end. */
  lockNext(): string | null {
    const order = [...this.tracks.values()]
      .filter((T) => !T.datalink || this.weaponsFree)
      .sort((a, b) => len(a.r) - len(b.r))
      .map((T) => T.id);
    if (!order.length) return this.unlock();
    const i = this.lock === null ? -1 : order.indexOf(this.lock);
    this.lock = i + 1 < order.length ? order[i + 1]! : null;
    this.lockAt = 0;
    if (this.lock && this.mode === "RWS") this.mode = "TWS";
    return this.lock;
  }

  /** A track locked by its id (the radar's own track); false if none. */
  lockOn(id: string): boolean {
    const T = this.tracks.get(id);
    if (!T || (T.datalink && !this.weaponsFree)) return false;
    this.lock = id;
    this.lockAt = 0;
    return true;
  }

  unlock(): null {
    this.lock = null;
    if (this.mode === "STT") this.mode = "TWS";
    return null;
  }

  /** The modes in turn: RWS → TWS → STT (on the lock, or the nearest track) → RWS. */
  nextMode(): RadarMode {
    if (this.mode === "RWS") this.mode = "TWS";
    else if (this.mode === "TWS") {
      if (!this.lock) this.lockNext();
      this.mode = this.lock ? "STT" : "RWS";
    } else {
      this.unlock();
      this.mode = "RWS";
    }
    return this.mode;
  }
}
