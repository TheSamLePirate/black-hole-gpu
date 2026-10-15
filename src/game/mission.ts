// A mission as data (docs/PLAN-AVIATION-AAA.md, P1): its briefing, where and how it starts (the place, the time, the
// weather, the F-35's variant and stores), the units it sets — carriers, aircraft and ground targets, a real flight
// taken over —, its objectives (reach a place, destroy, escort, protect, identify, land), its triggers (when an
// objective is done, a time, a unit near, a zone entered: something said, a unit appearing, a course changed — a real
// airliner leaving its route —, a side changed, a transponder off, the mission won or failed); its result, its score,
// its debrief. Pure: the world's state each frame in (controller/mission.ts reads it), the actions out. JSON: a link,
// a file, the editor, TARS.

import type { CarrierId } from "./carrier";

export type Side = "hostile" | "friend" | "neutral";
export interface GeoPt {
  lat: number;
  lon: number;
  /** its height over the sea [m] (an aircraft's, a place's) */
  alt?: number;
}
export interface Zone extends GeoPt {
  radius: number;
}

export type UnitKind = "carrier" | "drone" | "fighter" | "sam" | "truck" | "bunker" | "airliner" | "traffic";

export interface MissionUnit {
  id: string;
  kind: UnitKind;
  name?: string;
  /** a carrier's kind */
  carrier?: CarrierId;
  at?: GeoPt;
  hdg?: number;
  speed?: number;
  /** an aircraft's way (an airliner's) */
  route?: GeoPt[];
  side?: Side;
  /** a real flight taken over (kind traffic): its callsign or ICAO hex, else the nearest one; `at` where it is
   *  set when none is heard (offline) */
  match?: { callsign?: string; hex?: string };
  /** set only when a trigger asks for it */
  later?: boolean;
}

interface ObjectiveBase {
  id: string;
  text: string;
  /** not needed to win (its points a bonus) */
  optional?: boolean;
  points?: number;
  /** active once this other objective is done (else from the start) */
  after?: string;
}
export type Objective = ObjectiveBase &
  (
    | { kind: "reach"; at: Zone }
    | { kind: "destroy"; units: string[] }
    | { kind: "escort"; unit: string; until: Zone; within: number }
    | { kind: "protect"; unit: string; seconds: number }
    | { kind: "identify"; unit: string; within: number }
    | { kind: "land"; carrier?: string; at?: Zone }
  );

export type Cond = { done: string } | { time: number } | { near: { unit: string; within: number } } | { enter: Zone };
export type Action =
  | { say: string }
  | { spawn: string }
  /** a unit turned: a heading, a height [m], a speed; or toward a place (its height there) */
  | { course: { unit: string; hdg?: number; alt?: number; speed?: number; to?: GeoPt } }
  | { side: { unit: string; side: Side } }
  | { squawk: { unit: string; off: boolean } }
  | { fail: string }
  | { win: true };
export interface Trigger {
  id: string;
  when: Cond;
  do: Action[];
}

export interface MissionSpec {
  v: 1;
  id: string;
  title: string;
  brief: string;
  start: GeoPt & { hdg: number; speed: number; variant?: "B" | "C"; fuel?: number; loadout?: "aa" | "ag" | "gun"; carrier?: string };
  time?: { localHour?: number; utc?: string };
  weather?: { preset?: string; wind?: 0 | 1 | 2 | 3; clouds?: number; swell?: number };
  units: MissionUnit[];
  objectives: Objective[];
  triggers?: Trigger[];
  /** the time allowed [s] */
  limit?: number;
}

/** A spec checked and its defaults set — what is wrong said (null: none). */
export function checkMission(x: unknown): { spec: MissionSpec | null; errors: string[] } {
  const errors: string[] = [];
  const m = x as MissionSpec;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const geo = (g: GeoPt | undefined, what: string) => {
    if (!g || !num(g.lat) || !num(g.lon) || Math.abs(g.lat) > 90 || Math.abs(g.lon) > 180)
      errors.push(`${what}: a latitude and a longitude`);
  };
  if (!m || typeof m !== "object") return { spec: null, errors: ["not a mission"] };
  if (typeof m.title !== "string" || !m.title) errors.push("a title");
  if (!m.start) errors.push("a start");
  else {
    geo(m.start, "start");
    if (!num(m.start.hdg) || !num(m.start.speed)) errors.push("start: a heading and a speed");
  }
  const units = Array.isArray(m.units) ? m.units : [];
  const ids = new Set<string>();
  for (const u of units) {
    if (!u?.id || ids.has(u.id)) errors.push(`unit ${u?.id ?? "?"}: an id of its own`);
    ids.add(u?.id);
    if (u.kind !== "traffic" && u.kind !== "carrier") geo(u.at, `unit ${u.id}`);
    if (u.kind === "carrier" && !u.carrier) errors.push(`unit ${u.id}: which carrier`);
  }
  const objectives = Array.isArray(m.objectives) ? m.objectives : [];
  if (!objectives.length) errors.push("an objective at least");
  const oids = new Set(objectives.map((o) => o.id));
  for (const o of objectives) {
    const refs: string[] =
      o.kind === "destroy"
        ? o.units
        : o.kind === "escort" || o.kind === "protect" || o.kind === "identify"
          ? [o.unit]
          : o.kind === "land" && o.carrier
            ? [o.carrier]
            : [];
    for (const r of refs) if (!ids.has(r)) errors.push(`objective ${o.id}: no unit ${r}`);
    if (o.after && !oids.has(o.after)) errors.push(`objective ${o.id}: no objective ${o.after}`);
    if (o.kind === "reach") geo(o.at, `objective ${o.id}`);
  }
  for (const tr of m.triggers ?? [])
    for (const a of tr.do ?? []) {
      const u = "spawn" in a ? a.spawn : "course" in a ? a.course.unit : "side" in a ? a.side.unit : "squawk" in a ? a.squawk.unit : null;
      if (u && !ids.has(u)) errors.push(`trigger ${tr.id}: no unit ${u}`);
    }
  if (errors.length) return { spec: null, errors };
  return {
    spec: {
      ...m,
      v: 1,
      id: m.id || m.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      brief: m.brief ?? "",
      units,
      objectives,
      triggers: m.triggers ?? [],
    },
    errors,
  };
}

// ------------------------------------------------------------------------------------ the run

export type ObjState = "waiting" | "active" | "done" | "failed";

export interface MissionRun {
  spec: MissionSpec;
  t: number;
  state: Record<string, ObjState>;
  /** when each was done [s] */
  doneAt: Record<string, number>;
  /** the triggers fired */
  fired: Set<string>;
  /** an escort's time beyond its distance [s]; a protect's start [s] */
  apart: Record<string, number>;
  since: Record<string, number>;
  status: "flying" | "won" | "failed";
  why: string;
  /** what was said, in order */
  log: { t: number; text: string }[];
}

export const newRun = (spec: MissionSpec): MissionRun => ({
  spec,
  t: 0,
  state: Object.fromEntries(spec.objectives.map((o) => [o.id, o.after ? "waiting" : "active"])),
  doneAt: {},
  fired: new Set(),
  apart: {},
  since: {},
  status: "flying",
  why: "",
  log: [],
});

/** The world as the mission reads it each frame. */
export interface MissionWorld {
  own: GeoPt & { alt: number; landed: boolean; lost: boolean };
  /** a unit's state (null: not set, or gone): its place, alive */
  unit(id: string): { lat: number; lon: number; alt: number; alive: boolean } | null;
  /** the carrier (a unit's id) we stand on (null: none) */
  onCarrier: string | null;
}

/** The great-circle distance between two places [m] (and their heights' difference, when both). */
export function distM(a: GeoPt, b: GeoPt, withHeight = false): number {
  const D = Math.PI / 180;
  const s = Math.sin(((b.lat - a.lat) * D) / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(((b.lon - a.lon) * D) / 2) ** 2;
  const h = 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(s)));
  return withHeight && a.alt !== undefined && b.alt !== undefined ? Math.hypot(h, a.alt - b.alt) : h;
}

/** What the mission does this frame: actions for the world (said, set, turned …). */
export type Out = Action | { done: string } | { failedObj: string };

/** How long an escort may be farther than its distance [s] before it fails. */
const ESCORT_GRACE = 30;

/**
 * A frame of the mission: its objectives judged, its triggers fired, its end. The actions to take (the said, the set,
 * the turned; each objective done or failed) out.
 */
export function missionStep(R: MissionRun, W: MissionWorld, dt: number): Out[] {
  const out: Out[] = [];
  if (R.status !== "flying") return out;
  R.t += dt;
  const S = R.spec;
  const fail = (why: string) => {
    R.status = "failed";
    R.why = why;
    out.push({ fail: why });
  };
  if (W.own.lost) {
    fail("the aircraft lost");
    return out;
  }
  // the objectives
  for (const o of S.objectives) {
    const st = R.state[o.id];
    if (st === "waiting" && o.after && R.state[o.after] === "done") R.state[o.id] = "active";
    if (R.state[o.id] !== "active") continue;
    let done = false;
    let failed: string | null = null;
    switch (o.kind) {
      case "reach":
        done =
          distM(W.own, o.at) < o.at.radius && (o.at.alt === undefined || Math.abs(W.own.alt - o.at.alt) < Math.max(150, o.at.radius / 4));
        break;
      case "destroy":
        done = o.units.every((u) => W.unit(u)?.alive === false);
        break;
      case "identify": {
        const u = W.unit(o.unit);
        if (u?.alive === false) failed = "destroyed before it was identified";
        else if (u) done = distM(W.own, u, true) < o.within;
        break;
      }
      case "escort": {
        const u = W.unit(o.unit);
        if (!u || !u.alive) failed = "the escorted aircraft lost";
        else {
          const far = distM(W.own, u, true) > o.within;
          R.apart[o.id] = far ? (R.apart[o.id] ?? 0) + dt : 0;
          if (R.apart[o.id]! > ESCORT_GRACE) failed = "too far from the escorted aircraft";
          done = distM(u, o.until) < o.until.radius;
        }
        break;
      }
      case "protect": {
        const u = W.unit(o.unit);
        R.since[o.id] ??= R.t - dt;
        if (u?.alive === false) failed = "the protected unit lost";
        else done = R.t - R.since[o.id]! >= o.seconds;
        break;
      }
      case "land":
        done = W.own.landed && (o.carrier ? W.onCarrier === o.carrier : o.at ? distM(W.own, o.at) < o.at.radius : true);
        break;
    }
    if (failed) {
      R.state[o.id] = "failed";
      out.push({ failedObj: o.id });
      if (!o.optional) fail(`${o.text}: ${failed}`);
    } else if (done) {
      R.state[o.id] = "done";
      R.doneAt[o.id] = R.t;
      out.push({ done: o.id });
    }
    if (R.status !== "flying") return out;
  }
  // the triggers
  for (const tr of S.triggers ?? []) {
    if (R.fired.has(tr.id)) continue;
    const w = tr.when;
    const go =
      "done" in w
        ? R.state[w.done] === "done"
        : "time" in w
          ? R.t >= w.time
          : "near" in w
            ? (() => {
                const u = W.unit(w.near.unit);
                return !!u && distM(W.own, u, true) < w.near.within;
              })()
            : distM(W.own, w.enter) < w.enter.radius;
    if (!go) continue;
    R.fired.add(tr.id);
    for (const a of tr.do) {
      if ("say" in a) R.log.push({ t: R.t, text: a.say });
      if ("fail" in a) return fail(a.fail), out;
      if ("win" in a) {
        R.status = "won";
        out.push(a);
        return out;
      }
      out.push(a);
    }
  }
  // the end: the objectives needed all done; the time out
  if (S.objectives.filter((o) => !o.optional).every((o) => R.state[o.id] === "done")) {
    R.status = "won";
    out.push({ win: true });
  } else if (S.limit && R.t > S.limit) fail("out of time");
  return out;
}

/** The score and debrief of a run: each objective's points (100 by default; an optional one's a bonus), a time bonus
 *  within the limit; out of 20 as the flight report's, its letter. */
export function debrief(R: MissionRun): {
  score: number;
  of: number;
  twenty: number;
  letter: string;
  lines: { text: string; state: ObjState; at?: number; points: number }[];
} {
  const lines = R.spec.objectives.map((o) => {
    const p = o.points ?? 100;
    return { text: o.text, state: R.state[o.id]!, at: R.doneAt[o.id], points: R.state[o.id] === "done" ? p : 0 };
  });
  const of = R.spec.objectives.filter((o) => !o.optional).reduce((s, o) => s + (o.points ?? 100), 0);
  let score = lines.reduce((s, l) => s + l.points, 0);
  if (R.status === "won" && R.spec.limit) score += Math.round(((R.spec.limit - R.t) / R.spec.limit) * 0.2 * of);
  if (R.status === "failed") score = Math.round(score * 0.5);
  const twenty = Math.max(0, Math.min(20, Math.round((score / Math.max(of, 1)) * 200) / 10));
  const letter = twenty >= 17 ? "A" : twenty >= 14 ? "B" : twenty >= 11 ? "C" : twenty >= 8 ? "D" : "F";
  return { score, of, twenty, letter, lines };
}
