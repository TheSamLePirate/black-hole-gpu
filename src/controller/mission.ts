// The CameraController — a mission flown (game/mission.ts): its units set in the world (the carriers at sea; the
// aircraft and ground targets in its fight's world — controller/combat.ts —; a real flight taken over: left out of
// the traffic drawn, flown on by the game from where it was), the world read for it each frame, its actions done
// (said, set, turned, its side or its transponder changed), its end and its debrief. In a room, shared: the one who
// began it sends it and its objectives' states (ui/netsession.ts), the others fly it with him.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { CARRIER, type CarrierId } from "../game/carrier";
import { R_EARTH } from "../game/challenges";
import {
  debrief,
  distM,
  type MissionRun,
  type MissionSpec,
  type MissionUnit,
  type MissionWorld,
  missionStep,
  newRun,
  type ObjState,
} from "../game/mission";
import type { Scenario } from "../game/scenarios";
import { MISSILES } from "../game/combat";
import { t, tf } from "../i18n";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";
import type { CameraController } from "../controls";
import { enuAt } from "./traffic";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import { sunHidden } from "../eclipse/earth-moon";
import { utcOf } from "../system/solar";

const D = Math.PI / 180;

/** A unit as set: its fight's target (its id), its carrier's kind, the real flight it was (its hex). */
interface UnitLive {
  spec: MissionUnit;
  target?: number;
  carrier?: CarrierId;
  hex?: string;
}

export interface MissionState {
  run: MissionRun;
  anchor: { lat: number; lon: number };
  units: Map<string, UnitLive>;
  /** the start on a carrier's deck still to make (its deck's map loading) */
  deckStart: string | null;
  /** the real flights to take over, waited for a few seconds (the traffic heard) */
  pending: MissionUnit[];
  wait?: number;
  tried?: number;
  ended: boolean;
  /** shared in a room: we lead it (our objectives the room's), or another does */
  lead: boolean;
  /** a team mission's role flown (its index — S1) */
  role: number;
  /** the carrier qualifications begun by its objectives, the last one ended before it began (S1) */
  quals: Set<string>;
  qualSeen: unknown;
}

/** A mission's states as shared in a room: its objectives', its end. */
export interface MissionShared {
  id: string;
  state: Record<string, ObjState>;
  status: "flying" | "won" | "failed";
  why?: string;
}

declare module "../controls" {
  interface CameraController {
    mission?: MissionState | null;
    missionLast?: { spec: MissionSpec; status: "won" | "failed"; why: string; t: number; brief: ReturnType<typeof debrief> } | null;
    /** what a mission says (its triggers, its objectives): the page shows and speaks it */
    onMissionSay?: (text: string) => void;
    /** a mission's objectives changed or its end (shared in a room: ui/netsession.ts) */
    onMissionState?: (st: MissionShared) => void;
    /** a mission's end (its debrief): the page shows it */
    onMissionEnd?: (last: NonNullable<CameraController["missionLast"]>) => void;
    missionStart: typeof missionStart;
    missionFrame: typeof missionFrame;
    missionAbort: typeof missionAbort;
    missionApply: typeof missionApply;
    missionMarks: typeof missionMarks;
    missionCue: typeof missionCue;
  }
}

const toEn = (a: { lat: number; lon: number }, p: { lat: number; lon: number }): [number, number] => [
  (p.lon - a.lon) * D * R_EARTH * Math.cos(a.lat * D),
  (p.lat - a.lat) * D * R_EARTH,
];
const toLl = (a: { lat: number; lon: number }, e: number, n: number) => ({
  lat: a.lat + n / (D * R_EARTH),
  lon: a.lon + e / (D * R_EARTH * Math.cos(a.lat * D)),
});

/**
 * A mission begun (the craft already placed at its start, its time and weather set — game/tools.ts mission): its
 * fight's world made (empty: its units added as they are set), its units set but the later ones. `lead`: false —
 * another's in a room, joined.
 */
function missionStart(this: CameraController, spec: MissionSpec, o: { lead?: boolean; role?: number } = {}) {
  if (this.mission) this.missionAbort();
  const anchor = { lat: spec.start.lat, lon: spec.start.lon };
  const role = spec.roles?.length ? Math.min(Math.max(o.role ?? 0, 0), spec.roles.length - 1) : 0;
  const loadout = spec.roles?.[role]?.start?.loadout ?? spec.start.loadout ?? "aa";
  const def: Scenario = {
    id: `mission:${spec.id}`,
    title: { fr: spec.title, en: spec.title },
    brief: { fr: spec.brief, en: spec.brief },
    anchor,
    start: { e: 0, n: 0, agl: spec.start.alt ?? 1500, hdg: spec.start.hdg, speed: spec.start.speed },
    loadout,
    targets: [],
    limit: spec.limit ?? 1e9,
    mission: true,
  };
  this.combatStart(def);
  this.mission = {
    run: newRun(spec),
    anchor,
    units: new Map(),
    deckStart: spec.start.carrier ?? null,
    pending: [],
    ended: false,
    lead: o.lead ?? true,
    role,
    quals: new Set(),
    qualSeen: this.qualLast ?? null,
  };
  for (const u of spec.units) if (!u.later) spawnUnit(this, u);
}

/** How long a real flight is waited for [s] before its unit is set where the mission says. */
const TRAFFIC_WAIT = 8;

/** A unit set in the world (a real flight not heard yet: waited for, unless `last`). */
function spawnUnit(c: CameraController, u: MissionUnit, last = false) {
  const M = c.mission;
  if (!M || M.units.has(u.id)) return;
  const live: UnitLive = { spec: u };
  M.units.set(u.id, live);
  if (u.kind === "carrier") {
    const kind = u.carrier ?? "ford";
    c.carrierSpawn(kind, { lat: u.at?.lat, lon: u.at?.lon, heading: u.hdg, speed: u.speed });
    live.carrier = kind;
    return;
  }
  const W = c.combat?.world;
  if (!W) return;
  let at = u.at;
  let hdg = u.hdg ?? 0;
  let speed = u.speed;
  let name = u.name ?? u.id;
  let mesh: string | undefined;
  // (a real flight: the one asked — by its callsign or hex — or the nearest heard; taken over where it is now)
  if (u.kind === "traffic") {
    const list = c.trafficNow();
    const want = (u.match?.callsign ?? "").trim().toUpperCase();
    const g0 = c.geoNow();
    const own = g0 ? geodeticToCart(WGS84_A, WGS84_F, g0.lat * D, g0.lon * D, g0.alt) : null;
    const pick =
      list.find((x) => (want && x.cs.trim().toUpperCase() === want) || (u.match?.hex && x.id === u.match.hex)) ??
      (u.match?.callsign || u.match?.hex || !own
        ? null
        : list.filter((x) => !x.gnd && x.alt > 3000 && dist2(x.p, own) < 250e3 ** 2).sort((a, b) => dist2(a.p, own) - dist2(b.p, own))[0]);
    if (!pick && !last && c.s.traffic) {
      M.units.delete(u.id);
      if (!M.pending.includes(u)) M.pending.push(u);
      return;
    }
    if (pick) {
      const g = cartToGeodetic(WGS84_A, WGS84_F, pick.p as [number, number, number]);
      at = { lat: g.lat / D, lon: g.lon / D, alt: pick.alt };
      const f = enuAt(g.lat / D, g.lon / D);
      const ve = dot(pick.v, f.E);
      const vn = dot(pick.v, f.N);
      hdg = (Math.atan2(ve, vn) / D + 360) % 360;
      speed = Math.hypot(ve, vn);
      name = pick.cs.trim() || pick.id;
      mesh = pick.mesh ?? undefined;
      live.hex = pick.id;
      // (the room's: the same flight taken over on every page)
      u.match = { ...u.match, hex: pick.id };
      c.trafficTaken ??= new Set();
      c.trafficTaken.add(pick.id);
    }
    if (!at) return;
  }
  if (!at) return;
  const [e, n] = toEn(M.anchor, at);
  const kind = u.kind === "traffic" ? "airliner" : u.kind;
  // (a ship: on the sea, under way — S1)
  const air = kind === "drone" || kind === "fighter" || kind === "airliner";
  live.target = W.addTarget({
    kind,
    at: [e, n, air ? Math.max(300, (at.alt ?? 3000) - W.groundZ(e, n)) : 0],
    hdg,
    speed,
    name,
    friendly: u.side === "friend",
    route: u.route?.map((p) => {
      const [pe, pn] = toEn(M.anchor, p);
      // (its heights over the sea: the fight's routes over the ground)
      return [pe, pn, Math.max(300, (p.alt ?? at!.alt ?? 3000) - W.groundZ(pe, pn))] as [number, number, number];
    }),
    mesh: kind === "airliner" ? (mesh ?? "a320t") : undefined,
  });
  const q = W.targets.find((x) => x.id === live.target);
  if (q) q.neutral = u.side === "neutral" || (u.side === undefined && kind === "airliner");
}

const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const dist2 = (a: readonly number[], b: readonly number[]) => (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;

/** The world as the mission reads it now. */
function worldOf(c: CameraController, M: MissionState): MissionWorld {
  const g = c.geoNow();
  const W = c.combat?.world;
  const carriers = c.carrierNow();
  const deckKind = c.ourLanded?.deck?.pl.key ?? null;
  const air = c.airFlight.last?.speed ?? 0;
  // (its height in the fight's frame, as its units': over the ground's own measure)
  const P = c.combat?.last;
  return {
    own: {
      lat: g?.lat ?? M.anchor.lat,
      lon: g?.lon ?? M.anchor.lon,
      alt: P ? P.p[2] : (g?.alt ?? 0),
      agl: P && W ? P.p[2] - W.groundZ(P.p[0], P.p[1]) : undefined,
      landed: !!c.ourLanded || (!!c.rolling && air < 15),
      lost: !!c.airFlight.failure || c.combat?.status === "lost",
    },
    // (S1: the display's formation, the qualification ended since it began)
    wingmenInPlace: (c.wing?.list ?? []).filter((w) => w.alive && w.dist < 40).length,
    qual: c.qualLast && c.qualLast !== M.qualSeen ? { qual: c.qualLast.id, qualified: c.qualLast.qualified, gpa: c.qualLast.gpa } : null,
    // (S2: the Sun's share hidden where we fly — the ephemeris asked only by an eclipse's objective)
    sunHidden:
      g && M.run.spec.objectives.some((o) => o.kind === "eclipse" && M.run.state[o.id] === "active")
        ? sunHidden(g.lat * D, g.lon * D, g.alt, utcOf(c.nowTime()))
        : undefined,
    unit(id) {
      const L = M.units.get(id);
      if (!L) return null;
      if (L.carrier) {
        const k = carriers.find((x) => x.sp.kind === L.carrier);
        return k ? { lat: k.P.lat, lon: k.P.lon, alt: CARRIER[L.carrier].deck, alive: true } : null;
      }
      const q = W?.targets.find((x) => x.id === L.target);
      if (!q) return null;
      const ll = toLl(M.anchor, q.p[0], q.p[1]);
      return { ...ll, alt: q.p[2], alive: q.alive };
    },
    onCarrier: deckKind ? ([...M.units.entries()].find(([, L]) => L.carrier === deckKind)?.[0] ?? null) : null,
  };
}

/** A frame of the mission (after the fight's): its start on a deck made, the world read, its actions done, its end. */
function missionFrame(this: CameraController, dt: number) {
  const M = this.mission;
  if (!M || M.ended || !(dt > 0)) return;
  // (a start on a carrier's deck: once its deck's map is in)
  if (M.deckStart) {
    const L = M.units.get(M.deckStart);
    if (L?.carrier && this.carrierLand(L.carrier).startsWith("On")) M.deckStart = null;
    else return;
  }
  // (the real flights to take over: waited for — the mission not begun until they are set)
  if (M.pending.length) {
    M.wait = (M.wait ?? 0) + dt;
    if (M.wait - (M.tried ?? -1) < 1) return;
    M.tried = M.wait;
    const P = M.pending.splice(0);
    for (const u of P) spawnUnit(this, u, M.wait > TRAFFIC_WAIT);
    if (M.pending.length) return;
  }
  // (a carrier qualification asked by an active objective: begun once — S1)
  for (const o of M.run.spec.objectives)
    if (o.kind === "qual" && M.run.state[o.id] === "active" && !M.quals.has(o.id)) {
      M.quals.add(o.id);
      this.qualStart(o.qual, { auto: o.auto ?? false, passes: o.passes });
    }
  // (in a room each judges it on his own world, what one has done shared to all — missionApply)
  const outs = missionStep(M.run, worldOf(this, M), dt);
  const W = this.combat?.world;
  const target = (id: string) => {
    const L = M.units.get(id);
    return L?.target !== undefined ? W?.targets.find((x) => x.id === L.target) : undefined;
  };
  for (const o of outs) {
    if ("say" in o) this.onMissionSay?.(o.say);
    else if ("spawn" in o) {
      const u = M.run.spec.units.find((x) => x.id === o.spawn);
      if (u) spawnUnit(this, u);
    } else if ("course" in o) {
      const q = target(o.course.unit);
      if (q && W) {
        const k = o.course;
        const to = k.to ? toEn(M.anchor, k.to) : null;
        W.setCourse(q.id, {
          hdg: k.hdg,
          alt: k.alt,
          speed: k.speed,
          to: to ? [to[0], to[1], Math.max(k.to!.alt ?? q.p[2], W.groundZ(to[0], to[1]) + 300)] : undefined,
        });
      }
    } else if ("side" in o) {
      const q = target(o.side.unit);
      if (q) {
        q.friendly = o.side.side === "friend";
        q.neutral = o.side.side === "neutral";
      }
    } else if ("squawk" in o) {
      const q = target(o.squawk.unit);
      if (q) q.squawkOff = o.squawk.off;
    } else if ("done" in o) {
      const ob = M.run.spec.objectives.find((x) => x.id === o.done);
      if (ob) this.onMissionSay?.(tf("Objective done: {0}", ob.text));
    } else if ("failedObj" in o) {
      const ob = M.run.spec.objectives.find((x) => x.id === o.failedObj);
      if (ob) this.onMissionSay?.(tf("Objective failed: {0}", ob.text));
    }
  }
  if (outs.some((o) => "done" in o || "failedObj" in o) || M.run.status !== "flying") share(this, M);
  if (M.run.status !== "flying") end(this, M);
}

const share = (c: CameraController, M: MissionState) =>
  c.onMissionState?.({ id: M.run.spec.id, state: { ...M.run.state }, status: M.run.status, why: M.run.why || undefined });

/** The mission ended: its debrief kept and shown, its fight and its takeovers let go. */
function end(c: CameraController, M: MissionState) {
  M.ended = true;
  const R = M.run;
  const brief = debrief(R);
  c.missionLast = { spec: R.spec, status: R.status === "won" ? "won" : "failed", why: R.why, t: R.t, brief };
  c.onMissionSay?.(R.status === "won" ? tf("Mission accomplished: {0}", R.spec.title) : tf("Mission failed: {0}", R.why || R.spec.title));
  c.onMissionEnd?.(c.missionLast);
  release(c, M, R.status === "won" ? "won" : "lost");
}

/** Its takeovers given back, its swell, its fight ended — over (won, lost): wound down as a fight's end is, the
 *  wrecks falling to their crash, a ship sinking in its smoke (controller/combat.ts); given up: at once. */
function release(c: CameraController, M: MissionState, over?: "won" | "lost") {
  for (const L of M.units.values()) if (L.hex) c.trafficTaken?.delete(L.hex);
  if (M.run.spec.weather?.swell) c.seaSwell = null;
  const C = c.combat;
  if (C?.def.mission && over && C.status === "run" && C.world.falling(45)) {
    C.status = over;
    C.doneAt = C.t;
    C.result = M.run.spec.title;
  } else if (C?.def.mission) c.combatEnd();
  c.mission = null;
}

/** The mission let go (said). */
function missionAbort(this: CameraController) {
  const M = this.mission;
  if (!M) return;
  release(this, M);
  this.onMissionSay?.(t("Mission abandoned"));
}

/** Another's states of a shared mission applied: an objective he has done or failed ours too, his end ours. */
function missionApply(this: CameraController, st: MissionShared) {
  const M = this.mission;
  if (!M || M.ended || M.run.spec.id !== st.id) return;
  for (const [k, v] of Object.entries(st.state)) {
    const was = M.run.state[k];
    if (was === undefined || was === "done" || was === "failed" || (v !== "done" && v !== "failed")) continue;
    M.run.state[k] = v;
    if (v === "done") M.run.doneAt[k] = M.run.t;
    const ob = M.run.spec.objectives.find((x) => x.id === k);
    if (ob) this.onMissionSay?.(tf(v === "done" ? "Objective done: {0}" : "Objective failed: {0}", ob.text));
  }
  if ((st.status === "won" || st.status === "failed") && M.run.status === "flying") {
    M.run.status = st.status;
    M.run.why = st.why ?? "";
    end(this, M);
  }
}

/** What a mission shows on a map (the mission map, the TSD — P2): its places, its units, its threats. */
export interface MissionMark {
  kind: "zone" | "threat" | "hostile" | "friend" | "neutral" | "carrier" | "dead";
  lat: number;
  lon: number;
  /** a zone's, a threat's radius [m] */
  r?: number;
  /** a unit's heading [°] */
  hdg?: number;
  label: string;
  /** a unit's id, the objective a zone is */
  unit?: string;
  obj?: string;
  state?: ObjState;
  air?: boolean;
}

/** The marks of the mission flown now (none: none). */
function missionMarks(this: CameraController): MissionMark[] {
  const M = this.mission;
  if (!M) return [];
  const out: MissionMark[] = [];
  const R = M.run;
  const W = worldOf(this, M);
  const objOf = (unit: string) =>
    R.spec.objectives.find(
      (o) =>
        R.state[o.id] === "active" &&
        ("unit" in o ? o.unit === unit : o.kind === "destroy" ? o.units.includes(unit) : o.kind === "land" && o.carrier === unit),
    );
  // (the places: the zones to reach, the escort's end, a landing's)
  for (const o of R.spec.objectives) {
    // (a route's gates: the next ones)
    if (o.kind === "route" && R.state[o.id] !== "done")
      o.gates.slice(R.apart[o.id] ?? 0).forEach((z, i) =>
        out.push({
          kind: "zone",
          lat: z.lat,
          lon: z.lon,
          r: z.radius,
          label: `${o.text} ${(R.apart[o.id] ?? 0) + i + 1}`,
          obj: o.id,
          state: R.state[o.id],
        }),
      );
    const z = o.kind === "reach" || o.kind === "show" ? o.at : o.kind === "escort" ? o.until : o.kind === "land" ? o.at : undefined;
    if (z && R.state[o.id] !== "done")
      out.push({ kind: "zone", lat: z.lat, lon: z.lon, r: z.radius, label: o.text, obj: o.id, state: R.state[o.id] });
  }
  // (the units: where they are now, their side; a SAM's reach)
  const Wc = this.combat?.world;
  for (const [id, L] of M.units) {
    const u = W.unit(id);
    if (!u) continue;
    const ob = objOf(id);
    const q = L.target !== undefined ? Wc?.targets.find((x) => x.id === L.target) : undefined;
    const label = q?.name ?? L.spec.name ?? id;
    if (L.carrier) {
      const k = this.carrierNow().find((x) => x.sp.kind === L.carrier);
      out.push({
        kind: "carrier",
        lat: u.lat,
        lon: u.lon,
        hdg: k ? (k.sp.heading * 180) / Math.PI : undefined,
        label,
        unit: id,
        obj: ob?.id,
      });
      continue;
    }
    if (!u.alive) {
      out.push({ kind: "dead", lat: u.lat, lon: u.lon, label, unit: id });
      continue;
    }
    const kind = q?.friendly ? "friend" : q?.neutral ? "neutral" : "hostile";
    const air = !!q?.ai;
    out.push({
      kind,
      lat: u.lat,
      lon: u.lon,
      hdg: q ? (Math.atan2(q.v[0], q.v[1]) * 180) / Math.PI : undefined,
      label,
      unit: id,
      obj: ob?.id,
      air,
    });
    if (q?.site && q.site.missiles > 0) out.push({ kind: "threat", lat: u.lat, lon: u.lon, r: MISSILES.sam.rMax, label, unit: id });
  }
  return out;
}

/** Where the mission leads now (the HUD's cue — P2): its first active objective's place or unit — its name, where it
 *  is, its height over the sea [m]. Null: none. */
function missionCue(this: CameraController): { name: string; lat: number; lon: number; alt: number } | null {
  const M = this.mission;
  if (!M || M.deckStart) return null;
  const R = M.run;
  const W = worldOf(this, M);
  const ground = (lat: number, lon: number) => Math.max(0, groundRelief("earth", bodyFixedOf("earth", lat, lon, 0)));
  for (const o of R.spec.objectives) {
    if (R.state[o.id] !== "active") continue;
    const unit = (id: string) => {
      const u = W.unit(id);
      return u?.alive ? { name: o.text, lat: u.lat, lon: u.lon, alt: u.alt } : null;
    };
    if (o.kind === "reach" || o.kind === "show")
      return { name: o.text, lat: o.at.lat, lon: o.at.lon, alt: o.at.alt ?? ground(o.at.lat, o.at.lon) };
    if (o.kind === "route") {
      const g = o.gates[R.apart[o.id] ?? 0];
      if (g)
        return {
          name: `${o.text} ${(R.apart[o.id] ?? 0) + 1}/${o.gates.length}`,
          lat: g.lat,
          lon: g.lon,
          alt: g.alt ?? ground(g.lat, g.lon),
        };
    }
    if (o.kind === "destroy") {
      for (const id of o.units) {
        const c = unit(id);
        if (c) return c;
      }
      continue;
    }
    if (o.kind === "escort") {
      const u = unit(o.unit);
      // (close by it: the escort's end)
      if (u && distM(W.own, u) > o.within) return u;
      return { name: o.text, lat: o.until.lat, lon: o.until.lon, alt: o.until.alt ?? ground(o.until.lat, o.until.lon) };
    }
    if (o.kind === "identify" || o.kind === "protect") {
      const c = unit(o.unit);
      if (c) return c;
      continue;
    }
    if (o.kind === "land") {
      if (o.carrier) {
        const c = unit(o.carrier);
        if (c) return c;
      }
      if (o.at) return { name: o.text, lat: o.at.lat, lon: o.at.lon, alt: ground(o.at.lat, o.at.lon) };
    }
  }
  return null;
}

export function installMission(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { missionStart, missionFrame, missionAbort, missionApply, missionMarks, missionCue });
}
