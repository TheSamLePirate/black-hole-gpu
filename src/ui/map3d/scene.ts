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
import type { V3 } from "./camera";

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
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

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
