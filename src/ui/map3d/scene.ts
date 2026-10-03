// What the 3D map shows of a universe: its bodies now (place, size, colour, pole, sphere of
// influence), each one's orbit (a turn around its primary, drawn where the primary is now), the
// hierarchy (the focus's breadcrumb) and the light each is lit by.
//
// Our universe: the solar system in the home frame (our mouth at the origin, J2000 ecliptic axes).
// Gargantua's: the flat map of Boyer–Lindquist around the hole (its equator z = 0), or the system's
// centre of mass when the companion star is massive.

import type { Settings } from "../../settings";
import { EPOCH_DATE, SOLAR_BODIES, solarState, eclipticOf, M_SECONDS } from "../../system/solar";
import { GARGANTUA_SYSTEM } from "../../system/bodies";
import { bodyState, meanMotion } from "../../system/ephemeris";
import { barycentre, bodyHill, starCentre, starOmega } from "../../targeting";
import { mouth } from "../../wormhole";
import { isco, horizon, photonOrbits } from "../../physics";
import { OUR_COLOURS } from "../hudkit";
import { issAxes, issOrbit, issTrack } from "../../system/iss";
import { M_METRES, solarBody } from "../../system/solar";
import { fleet } from "../../fleet";
import { keplerProp } from "../../system/our-plan";
import { VESSELS, type VesselId } from "../../vessels";

const CRAFT = ["ranger", "lander", "endurance"] as const;
const isCraftId = (id: string): id is VesselId => (CRAFT as readonly string[]).includes(id);

/** A place in our universe's home frame at t: a body of the solar system's, the space station's, a craft's. */
export function ourPos(id: string, t: number): V3 {
  if (id === "iss") return (issTrack.peek(t)?.X ?? solarState("earth", t).pos) as V3;
  if (isCraftId(id)) return (fleet.pose(id, t)?.X ?? solarState("earth", t).pos) as V3;
  return solarState(id, t).pos as V3;
}
import type { V3 } from "./camera";
import { add, sub } from "../../math/vec3";

export type Universe = "ours" | "gargantua";

export interface MapBody {
  /** the id a click targets (act.select) */
  id: string;
  name: string;
  kind: "star" | "planet" | "moon" | "hole" | "mouth";
  parent: string | null;
  /** place now (the map's frame), radius [M], colour "r, g, b" */
  pos: V3;
  radius: number;
  col: string;
  /** the pole (the equator's normal) */
  pole: V3;
  /** sphere of influence [M] (Infinity: all of it; 0: none) */
  soi: number;
  /** a turn of its orbit around its primary (cached), and the offset that puts it where the primary is now */
  orbit: V3[] | null;
  orbitOff: V3;
  /** the body lighting it (null: itself, or the disk around the hole) */
  light: string | null;
  rings?: { inner: number; outer: number };
  air?: boolean;
  /** a line for the card: period, distance… */
  period?: number;
}

export interface MapScene {
  universe: Universe;
  bodies: MapBody[];
  byId: Map<string, MapBody>;
  /** the system's plane: the ecliptic (ours), the hole's equator (theirs) */
  systemPole: V3;
  /** the in-plane reference direction (the vernal equinox; the map's +x) */
  systemX: V3;
  /** the hole (theirs): horizon, ISCO, photon orbit, disk */
  hole: { rH: number; isco: number; photon: number; disk: boolean; diskOuter: number } | null;
  /** the map's origin offset (the centre of mass, theirs) at a time */
  origin: (t: number) => V3;
}

const Z: V3 = [0, 0, 1];

/**
 * Caches the orbits (a turn each: costly for the solar system's ephemeris), sampled again once the
 * scene's time has moved on by a good fraction of their period — a few a frame at most (a frame's
 * budget), the others keep their previous turn a little longer.
 */
const orbitCache = new Map<string, { at: number; pts: V3[]; q?: V3 }>();
let budget = 0;

function cachedOrbit(key: string, t0: number, make: () => V3[], maxDt: number): V3[] {
  const c = orbitCache.get(key);
  if (c && (Math.abs(t0 - c.at) < maxDt || budget <= 0)) return c.pts;
  budget--;
  const pts = make();
  orbitCache.set(key, { at: t0, pts });
  return pts;
}

// ------------------------------------------------------------------------------------ ours
export function ourScene(t0: number): MapScene {
  budget = 3;
  const bodies: MapBody[] = [];
  const pos = new Map<string, V3>();
  for (const b of SOLAR_BODIES) pos.set(b.id, solarState(b.id, t0).pos);
  for (const b of SOLAR_BODIES) {
    const P = pos.get(b.id)!;
    const moon = !!b.parent && b.parent !== "sun";
    const parent = b.parent ? SOLAR_BODIES.find((q) => q.id === b.parent)! : null;
    const a = parent ? Math.hypot(...sub(P, pos.get(parent.id)!)) : 0;
    const days = b.circle ? Math.abs(b.circle.period) : b.id === "moon" ? 27.32 : b.elements ? 365.25 * b.elements[0]![0]! ** 1.5 : 0;
    const T = (days * 86400) / M_SECONDS;
    const orbit = parent && T > 0
      ? cachedOrbit(`ours:${b.id}`, t0, () => {
          const pts: V3[] = [];
          const q0 = pos.get(parent.id)!;
          const n = moon ? 96 : 160;
          for (let j = 0; j <= n; j++) {
            const t = t0 + (T * j) / n;
            const p = solarState(b.id, t).pos, q = solarState(parent.id, t).pos;
            pts.push(add(sub(p, q), q0));
          }
          return pts;
        }, T / 40)
      : null;
    // (the orbit cached a while ago: moved to the primary's place now)
    let off: V3 = [0, 0, 0];
    if (orbit && parent) {
      const c = orbitCache.get(`ours:${b.id}`)!;
      off = sub(pos.get(parent.id)!, c.q ?? (c.q = solarState(parent.id, c.at).pos));
    }
    bodies.push({
      id: b.id, name: b.name, kind: b.kind === "star" ? "star" : moon ? "moon" : "planet", parent: b.parent,
      pos: P, radius: b.radius, col: OUR_COLOURS[b.id] ?? "200, 200, 200",
      pole: b.kind === "star" ? Z : eclipticOf(b.pole[0], b.pole[1]),
      soi: parent ? a * (b.mass / parent.mass) ** 0.4 : Infinity,
      orbit, orbitOff: off, light: b.kind === "star" ? null : "sun", rings: b.rings, air: !!b.atmosphere, period: T || undefined,
    });
  }
  bodies.push({
    id: "wormhole", name: "Wormhole", kind: "mouth", parent: "sun", pos: [0, 0, 0], radius: 0.05, col: "200, 140, 255",
    pole: Z, soi: 0, orbit: null, orbitOff: [0, 0, 0], light: null,
  });
  // the space station: its place (SGP4, or near the ship its own fall), a turn of its orbit around the
  // Earth (SGP4: 92 minutes), its orbit's normal for a pole
  const iss = issTrack.peek(t0);
  if (iss) {
    const E = pos.get("earth")!;
    const T = (92.9 * 60) / M_SECONDS;
    const orbit = cachedOrbit("ours:iss", t0, () => {
      const pts: V3[] = [];
      for (let j = 0; j <= 96; j++) {
        const t = t0 + (T * j) / 96;
        const o = issOrbit(t);
        if (o) pts.push(add(sub(o.X as V3, solarState("earth", t).pos as V3), E));
      }
      return pts;
    }, T / 40);
    const c = orbitCache.get("ours:iss")!;
    const off = sub(E, (c.q ??= solarState("earth", c.at).pos as V3));
    const A = issAxes(iss.X, iss.V, t0);
    bodies.push({
      id: "iss", name: "ISS", kind: "moon", parent: "earth", pos: iss.X as V3, radius: 55 / M_METRES, col: "95, 255, 208",
      pole: [-A[1][0], -A[1][1], -A[1][2]], soi: 0, orbit, orbitOff: off, light: "sun", period: T,
    });
  }
  // the fleet's craft not flown (fleet.ts): where they are, a turn of their Kepler orbit around the Earth
  const mu = solarBody("earth")!.mass;
  for (const id of CRAFT) {
    if (fleet.activePose?.() && fleet.flownAssembly().includes(id)) continue;
    const p = fleet.pose(id, t0);
    if (!p) continue;
    const E = pos.get("earth")!;
    const Es = solarState("earth", t0);
    const r0 = sub(p.X as V3, Es.pos as V3), v0 = sub(p.V as V3, Es.vel as V3);
    const eps = (v0[0] ** 2 + v0[1] ** 2 + v0[2] ** 2) / 2 - mu / Math.hypot(...r0);
    if (!(eps < 0)) continue;
    const T = 2 * Math.PI * Math.sqrt((-mu / (2 * eps)) ** 3 / mu);
    const orbit = cachedOrbit(`ours:${id}`, t0, () => {
      const pts: V3[] = [];
      for (let j = 0; j <= 96; j++) {
        const k = keplerProp(mu, r0, v0, (T * j) / 96);
        pts.push(add(k.r as V3, E));
      }
      return pts;
    }, T / 40);
    const c = orbitCache.get(`ours:${id}`)!;
    const off = sub(E, (c.q ??= solarState("earth", c.at).pos as V3));
    const n = [r0[1] * v0[2] - r0[2] * v0[1], r0[2] * v0[0] - r0[0] * v0[2], r0[0] * v0[1] - r0[1] * v0[0]];
    const nl = Math.hypot(...n) || 1;
    bodies.push({
      id, name: VESSELS[id].name, kind: "moon", parent: "earth", pos: p.X as V3, radius: 40 / M_METRES, col: OUR_COLOURS[id] ?? "255, 255, 255",
      pole: [n[0]! / nl, n[1]! / nl, n[2]! / nl], soi: 0, orbit, orbitOff: off, light: "sun", period: T,
    });
  }
  return {
    universe: "ours", bodies, byId: new Map(bodies.map((b) => [b.id, b])), systemPole: Z, systemX: [1, 0, 0], hole: null,
    origin: () => [0, 0, 0],
  };
}

// ------------------------------------------------------------------------------------ Gargantua's
const THEIR_COLOURS: Record<string, string> = { miller: "120, 210, 225", mann: "215, 228, 245", edmunds: "220, 170, 120", k2: "255, 190, 120" };

export function theirScene(s: Settings, t0: number, cm: boolean): MapScene {
  budget = 4;
  const B = (t: number): V3 => (cm ? barycentre(s, t) : [0, 0, 0]);
  const at = (X: V3, t: number): V3 => sub(X, B(t));
  const bodies: MapBody[] = [];
  const span = (key: string, fn: (t: number) => V3, period: number, n = 160) =>
    cachedOrbit(key, t0, () => Array.from({ length: n + 1 }, (_, j) => {
      const t = t0 + (period * j) / n;
      return at(fn(t), t);
    }), period / 50);
  bodies.push({
    id: "hole", name: "Gargantua", kind: "hole", parent: null, pos: at([0, 0, 0], t0), radius: horizon(s.spin), col: "255, 170, 90",
    pole: Z, soi: Infinity, orbit: null, orbitOff: [0, 0, 0], light: null,
  });
  if (s.sun) {
    const w = Math.max(starOmega(s), 1e-9);
    bodies.push({
      id: "star", name: "Companion star", kind: "star", parent: "hole", pos: at(starCentre(s, t0), t0), radius: s.sunRadius, col: "255, 211, 107",
      pole: Z, soi: s.sunMass > 0 ? bodyHill(s, "star", t0) : 0,
      orbit: span(`star:${s.sunOrbit}:${s.sunRadius}`, (t) => starCentre(s, t), (2 * Math.PI) / w, 180), orbitOff: [0, 0, 0], light: null, period: (2 * Math.PI) / w,
    });
  }
  if (s.system === "gargantua") {
    for (const b of GARGANTUA_SYSTEM.bodies) {
      if (b.universe !== "gargantua" || b.kind === "hole" || b.kind === "mouth") continue;
      const w = meanMotion(GARGANTUA_SYSTEM, b);
      const turn = w > 0 ? (2 * Math.PI) / w : 0;
      const pos = (t: number) => bodyState(GARGANTUA_SYSTEM, b.id, t).pos;
      // (a moon of a star — Edmunds — around its star, drawn where the star is now)
      let orbit: V3[] | null = null;
      let orbitOff: V3 = [0, 0, 0];
      if (turn > 0 && b.parent === "gargantua") orbit = span(`sys:${b.id}`, pos, turn);
      else if (turn > 0 && b.parent) {
        const par = b.parent;
        const rel = cachedOrbit(`sysrel:${b.id}`, t0, () => Array.from({ length: 121 }, (_, j) => {
          const t = t0 + (turn * j) / 120;
          return sub(pos(t), bodyState(GARGANTUA_SYSTEM, par, t).pos);
        }), turn / 20);
        orbit = rel;
        orbitOff = at(bodyState(GARGANTUA_SYSTEM, par, t0).pos, t0);
      }
      bodies.push({
        id: b.id, name: b.name, kind: b.kind === "star" ? "star" : "planet", parent: b.parent === "gargantua" ? "hole" : b.parent,
        pos: at(pos(t0), t0), radius: b.radius, col: THEIR_COLOURS[b.id] ?? "220, 220, 220", pole: Z,
        soi: bodyHill(s, b.id as never, t0), orbit, orbitOff, light: b.kind === "star" ? null : b.parent === "gargantua" ? "hole" : b.parent,
        air: !!b.surface?.atmosphere, period: turn || undefined,
      });
    }
  }
  if (s.wormhole) {
    const m0 = mouth(s, t0);
    const orbit = s.whOrbit && m0.omega > 0 ? span(`mouth:${s.whDist}`, (t) => mouth(s, t).C as V3, (2 * Math.PI) / m0.omega) : null;
    bodies.push({
      id: "wormhole", name: "Wormhole", kind: "mouth", parent: "hole", pos: at(m0.C as V3, t0), radius: m0.rGlue, col: "200, 140, 255",
      pole: Z, soi: 0, orbit, orbitOff: [0, 0, 0], light: null,
    });
  }
  return {
    universe: "gargantua", bodies, byId: new Map(bodies.map((b) => [b.id, b])), systemPole: Z, systemX: [1, 0, 0],
    hole: { rH: horizon(s.spin), isco: isco(s.spin), photon: photonOrbits(s.spin).pro, disk: s.disk, diskOuter: s.diskOuter },
    origin: B,
  };
}

/** The chain of primaries of a body, from the top: ["sun", "earth", "moon"]. */
export function lineage(sc: MapScene, id: string): MapBody[] {
  const out: MapBody[] = [];
  let b = sc.byId.get(id);
  for (let guard = 0; b && guard < 6; guard++) {
    out.unshift(b);
    b = b.parent ? sc.byId.get(b.parent) : undefined;
  }
  return out;
}

/** The date of a scene time (our side's calendar). */
export const dateOf = (t: number) => new Date(EPOCH_DATE + t * M_SECONDS * 1000);

/** Where a body of the map is at a time (the map's frame) — for the preview's trails. */
export function bodyPosAt(sc: MapScene, s: Settings, id: string, t: number): V3 | null {
  if (sc.universe === "ours") {
    if (id === "wormhole") return [0, 0, 0];
    return SOLAR_BODIES.some((b) => b.id === id) || id === "iss" || isCraftId(id) ? ourPos(id, t) : null;
  }
  const o = sc.origin(t);
  if (id === "hole") return sub([0, 0, 0], o);
  if (id === "star") return s.sun ? sub(starCentre(s, t), o) : null;
  if (id === "wormhole") return s.wormhole ? sub(mouth(s, t).C as V3, o) : null;
  return GARGANTUA_SYSTEM.bodies.some((b) => b.id === id) ? sub(bodyState(GARGANTUA_SYSTEM, id, t).pos, o) : null;
}
