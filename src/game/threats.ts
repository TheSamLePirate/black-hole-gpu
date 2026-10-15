// The threats called (docs/PLAN-AVIATION-AAA.md, I2): TARS as the backseater watching the picture — a missile
// launched at us (where from on the clock, how far, what to do: break and flares for a missile, the notch and the
// chaff for a SAM), one closing in, defeated or decoyed; a hostile newly on the radar called by its BRAA (its
// bearing, its range, its altitude, its aspect — hot, flanking, beam, cold), several at once as a group; a bandit
// come within 10 km hot; a SAM site seen; a hit taken, a kill. Each once, the urgent first, a few seconds between
// the rest. Pure: the controller feeds it the frame's picture (relative to the craft, east, north, up [m]).
import { t, tf } from "../i18n";
import type { Units } from "../ui/unitsys";
import type { CombatEvent, MissileKind } from "./combat";
import type { Iff } from "./radar";

type V3 = readonly [number, number, number] | readonly number[];

/** A contact as the watch reads it: relative to the craft, east, north, up [m]; its velocity [m/s]. */
export interface ThreatTrack {
  id: string;
  name: string;
  iff: Iff;
  kind: "air" | "ground" | "sea";
  r: V3;
  v: V3;
}
/** A missile coming for us: its id, kind, place and velocity relative to the craft's frame. */
export interface ThreatMissile {
  id: number;
  kind: MissileKind;
  r: V3;
  v: V3;
}
/** The frame's picture: the time [s], our heading [rad] and velocity, the radar's tracks, the missiles at us, the
 *  fight's events. */
export interface ThreatFrame {
  t: number;
  hdg: number;
  v: V3;
  tracks: ThreatTrack[];
  missiles: ThreatMissile[];
  events: CombatEvent[];
}
export interface ThreatCall {
  text: string;
  /** the voice's (audio/voice.ts: the lower the more urgent) — 1: a missile at us, a hit; 2: the rest */
  priority: 1 | 2;
  kind: "launch" | "close" | "defeated" | "bandit" | "group" | "sam" | "hit" | "kill";
}

export const THREAT = {
  /** a missile closing in called again under this [m] */
  close: 3000,
  /** a bandit called again once within this [m], hot */
  near: 10_000,
  /** between two calls that are not a missile's [s] */
  gap: 3,
  /** a contact gone this long [s] is called again when it comes back */
  forget: 60,
  /** new hostiles within this [s] of each other: one group's call */
  group: 1.5,
};

const D = 180 / Math.PI;
const wrap = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** Where it is on the clock (12 the nose) from our heading [rad]. */
export function clockOf(r: V3, hdg: number): number {
  const brg = Math.atan2(r[0]!, r[1]!);
  const h = Math.round(wrap(brg - hdg) / (Math.PI / 6)) % 12;
  return h === 0 ? 12 : h;
}

/** Its bearing from us [°, 0–359, true]. */
export const bearingOf = (r: V3) => Math.round(wrap(Math.atan2(r[0]!, r[1]!)) * D) % 360;

/** Its aspect: the angle between its track and the line from it to us — hot (towards us), flanking, beam, cold. */
export function aspectOf(r: V3, v: V3): "hot" | "flanking" | "beam" | "cold" {
  const sp = Math.hypot(v[0]!, v[1]!);
  if (sp < 5) return "hot";
  const d = Math.hypot(r[0]!, r[1]!) || 1;
  const c = (-(r[0]! * v[0]!) - r[1]! * v[1]!) / (d * sp);
  const a = Math.acos(Math.max(-1, Math.min(1, c))) * D;
  return a < 30 ? "hot" : a < 70 ? "flanking" : a < 110 ? "beam" : "cold";
}

const ASPECT = () => ({ hot: t("hot"), flanking: t("flanking"), beam: t("beam"), cold: t("cold") });

/** A bandit's BRAA: "045, 32 km, 6 000 m, hot". */
export function braa(r: V3, v: V3, ownAlt: number, u: Units): string {
  const b = String(bearingOf(r)).padStart(3, "0");
  return `${b}, ${u.fDist(Math.hypot(r[0]!, r[1]!, r[2]!), 0)}, ${u.fAlt(Math.round((ownAlt + r[2]!) / 100) * 100)}, ${ASPECT()[aspectOf(r, v)]}`;
}

export interface ThreatWatch {
  /** the missiles called: their kind, whether called close */
  missiles: Map<number, { kind: MissileKind; close: boolean }>;
  /** the contacts called: when last seen, whether called near */
  seen: Map<string, { at: number; near: boolean }>;
  /** when the last call that was not a missile's was made */
  last: number;
  /** the calls waiting their turn */
  queue: ThreatCall[];
  /** new hostiles gathering into a group: their tracks, since when */
  pending: { at: number; tracks: ThreatTrack[] } | null;
  /** the last calls, for TARS's picture */
  log: { t: number; text: string }[];
}

export const newThreatWatch = (): ThreatWatch => ({
  missiles: new Map(),
  seen: new Map(),
  last: -1e9,
  queue: [],
  pending: null,
  log: [],
});

/** A frame of the watch: the calls to make now. `alt`: ours [m over the sea]. */
export function threatStep(W: ThreatWatch, F: ThreatFrame, alt: number, u: Units): ThreatCall[] {
  const out: ThreatCall[] = [];
  const dist = (r: V3) => Math.hypot(r[0]!, r[1]!, r[2]!);
  // the missiles at us: a launch called at once, its way to defend; closing in, again
  for (const m of F.missiles) {
    const k = W.missiles.get(m.id);
    const d = dist(m.r);
    const clock = clockOf(m.r, F.hdg);
    if (!k) {
      W.missiles.set(m.id, { kind: m.kind, close: d < THREAT.close });
      // (the side to break to: towards it, its line across our tail)
      const right = clock <= 6 && clock !== 12;
      out.push({
        kind: "launch",
        priority: 1,
        text:
          m.kind === "sam"
            ? tf("SAM launch, {0} o'clock, {1} — notch it, chaff", clock, u.fDist(d, 0))
            : right
              ? tf("Missile launch, {0} o'clock, {1} — break right, flares", clock, u.fDist(d, 0))
              : tf("Missile launch, {0} o'clock, {1} — break left, flares", clock, u.fDist(d, 0)),
      });
    } else if (!k.close && d < THREAT.close) {
      k.close = true;
      out.push({ kind: "close", priority: 1, text: tf("Missile {0} o'clock, close — break now!", clock) });
    }
  }
  // the fight's events: our missiles' fates, a hit, a kill
  for (const e of F.events) {
    if ((e.kind === "decoyed" || e.kind === "miss") && W.missiles.has(e.missile)) {
      W.missiles.delete(e.missile);
      W.queue.push({ kind: "defeated", priority: 2, text: e.kind === "decoyed" ? t("Missile decoyed") : t("Missile defeated") });
    } else if (e.kind === "hit" && e.on === "player" && e.damage > 0)
      out.push({ kind: "hit", priority: 1, text: tf("We're hit — damage {0} %", Math.round(e.damage)) });
    else if (e.kind === "kill") W.queue.push({ kind: "kill", priority: 2, text: tf("Splash one — {0}", e.name) });
  }
  // (a missile no longer at us and not ended by an event: forgotten quietly)
  const live = new Set(F.missiles.map((m) => m.id));
  for (const id of W.missiles.keys()) if (!live.has(id)) W.missiles.delete(id);
  // the hostiles on the radar: new ones gathered for a moment (a group), a bandit close and hot, a SAM site
  for (const T of F.tracks) {
    if (T.iff !== "hostile") continue;
    const s = W.seen.get(T.id);
    const d = dist(T.r);
    if (!s || F.t - s.at > THREAT.forget) {
      W.seen.set(T.id, { at: F.t, near: d < THREAT.near });
      if (T.kind === "air") {
        W.pending ??= { at: F.t, tracks: [] };
        W.pending.tracks.push(T);
      } else
        W.queue.push({
          kind: "sam",
          priority: 2,
          text: tf("{0}, {1} o'clock, {2}", T.name, clockOf(T.r, F.hdg), u.fDist(d, 0)),
        });
      continue;
    }
    s.at = F.t;
    if (T.kind === "air" && !s.near && d < THREAT.near && aspectOf(T.r, T.v) === "hot") {
      s.near = true;
      W.queue.push({ kind: "bandit", priority: 2, text: tf("Bandit close, {0} o'clock, {1}, hot", clockOf(T.r, F.hdg), u.fDist(d, 1)) });
    }
  }
  if (W.pending && F.t - W.pending.at >= THREAT.group) {
    const G = W.pending.tracks.sort((a, b) => dist(a.r) - dist(b.r));
    const n = G[0]!;
    W.queue.push(
      G.length === 1
        ? { kind: "bandit", priority: 2, text: tf("Bandit, {0}", braa(n.r, n.v, alt, u)) }
        : { kind: "group", priority: 2, text: tf("{0} bandits, nearest {1}", G.length, braa(n.r, n.v, alt, u)) },
    );
    W.pending = null;
  }
  // the rest in turn, a few seconds apart (the urgent ones above go at once)
  if (W.queue.length && F.t - W.last >= THREAT.gap) {
    out.push(W.queue.shift()!);
    W.last = F.t;
  }
  for (const c of out) W.log.push({ t: F.t, text: c.text });
  if (W.log.length > 20) W.log.splice(0, W.log.length - 20);
  return out;
}
