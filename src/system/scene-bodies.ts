// The bodies the tracer draws as spheres (≤ MAX_BODIES), at the frame's time: the companion star of
// the classic scenes, or the planets and stars of a registered system. Their places are computed here
// in float64 at "now"; the GPU only turns them by Ω·Δt for the (small) retarded time along each ray,
// so the absolute time never reaches the GPU in float32.

import type { Settings } from "../settings";
import { starCentre, starOmega } from "../targeting";
import { GARGANTUA_SYSTEM, type BodyDef, type System } from "./bodies";
import { bodyState, meanMotion, type Vec3 } from "./ephemeris";

export const MAX_BODIES = 8;
/** vec4s per body in the GPU buffer */
export const BODY_VEC4 = 6;

export const BODY_STAR = 0;
export const BODY_PLANET = 1;
const SURFACES = { ocean: 0, ice: 1, rock: 2, gas: 3 } as const;
/** a gas giant drawn from its map (Saturn) */
export const SURFACE_MAPPED = 4;

export interface GpuBody {
  id: string;
  /** centre now (parent −1), or offset from the parent's centre now */
  pos: Vec3;
  radius: number;
  /** turning rate about the spin axis of its circle (around the hole, or around its parent) */
  omega: number;
  parent: number;
  kind: number;
  /** GM [M] (light bending, the grav. shift of its own light) */
  mass: number;
  /** stars: photosphere temperature [K], brightness; planets: albedo, surface type */
  temperature: number;
  brightness: number;
  surface: number;
  seed: number;
  /** planets: what lights them (a body index, −1: Gargantua's disk) and the irradiance factor E/(πB) */
  light: number;
  illum: number;
  /** 0 traced (sphere, or spread over the pixel when smaller), 1 beyond the traced region (met on the
   *  rays' straight way out), 2 our universe (home coordinates, through our end of the wormhole) */
  where: number;
  /** planets: the direction its light comes from and its colour temperature [K], measured by its
   *  light probe (black-hole frame) */
  lightDir?: Vec3;
  lightT?: number;
  /** rings: inner, outer radii (its radii), pole */
  rings?: { inner: number; outer: number; pole: Vec3 };
}

/** The system a scene uses. */
export function sceneSystem(s: Settings): System | null {
  return s.system === "gargantua" ? GARGANTUA_SYSTEM : null;
}

/** Orbits within this radius are traced (the rays are integrated that far); farther bodies are met on
 *  the escaped rays' straight way out. */
export const TRACED_RADIUS = 600;

export function sceneBodies(s: Settings, t: number): GpuBody[] {
  const out: GpuBody[] = [];
  if (s.sun) {
    out.push({
      id: "star", pos: starCentre(s, t), radius: s.sunRadius, omega: starOmega(s), parent: -1, kind: BODY_STAR,
      mass: s.sunMass, temperature: s.sunTemp, brightness: s.sunBrightness, surface: 0, seed: 0, light: -1, illum: 0, where: 0,
    });
  }
  const sys = sceneSystem(s);
  if (!sys) return out;
  const traced = (b: BodyDef) => b.kind === "planet" || b.kind === "star";
  const index = new Map<string, number>();
  // parents first (a star before its planets)
  const order = sys.bodies.filter(traced).sort((a, b) => depth(a) - depth(b));
  for (const b of order) {
    if (out.length >= MAX_BODIES) break;
    const st = bodyState(sys, b.id, t);
    const ours = b.universe === "ours";
    // our side: fixed places (home coordinates of our mouth), met on the rays leaving our end
    const where = ours ? 2 : Math.hypot(...st.pos) > TRACED_RADIUS ? 1 : 0;
    const parent = !ours && b.parent && b.parent !== "gargantua" ? index.get(b.parent) ?? -1 : -1;
    // (our side: a planet lit by its star, both fixed)
    const host = ours && b.parent ? index.get(b.parent) : undefined;
    let pos = st.pos;
    if (parent >= 0) {
      const p = bodyState(sys, b.parent!, t).pos;
      pos = [pos[0] - p[0], pos[1] - p[1], pos[2] - p[2]];
    }
    let lit = b.kind === "planet" && !ours ? planetLight(s, sys, b, parent, Math.hypot(...st.pos)) : { light: -1, illum: 0 };
    if (b.kind === "planet" && host !== undefined) {
      const h = out[host]!;
      const d = Math.hypot(st.pos[0] - h.pos[0], st.pos[1] - h.pos[1], st.pos[2] - h.pos[2]);
      lit = { light: host, illum: (h.radius / d) ** 2 };
    }
    index.set(b.id, out.length);
    out.push({
      id: b.id, pos, radius: b.radius, omega: meanMotion(sys, b), parent, kind: b.kind === "star" ? BODY_STAR : BODY_PLANET,
      mass: b.kind === "star" ? b.mass : 0, temperature: b.temperature ?? 0, brightness: b.kind === "star" ? 1 : albedo(b),
      surface: b.map ? SURFACE_MAPPED : b.surface ? SURFACES[b.surface.kind] : 2, seed: out.length * 17.3 + 3.1, ...lit, where,
      rings: b.rings,
    });
  }
  return out;
}

const depth = (b: BodyDef) => (b.parent === null || b.parent === "gargantua" ? 0 : 1);

/**
 * Our end of the wormhole seen from far on Gargantua's side: the mean radiance of the throat's disk
 * over our Sun's surface radiance — the throat maps our whole sky onto its disk, and the Sun covers
 * (R☉/d☉)²/4 of it — and the Sun's temperature. Null without a system that has a Sun on our side.
 */
export function throatLight(s: Settings): { factor: number; temperature: number } | null {
  const sys = sceneSystem(s);
  const sun = sys?.bodies.find((b) => b.universe === "ours" && b.kind === "star");
  if (!sun || sun.orbit.type !== "fixed") return null;
  const d = Math.hypot(...sun.orbit.pos);
  return { factor: (sun.radius / d) ** 2 / 4, temperature: sun.temperature ?? 5772 };
}

function albedo(b: BodyDef) {
  switch (b.surface?.kind) {
    case "ice": return 0.7;
    case "ocean": return 0.2; // shallow water over a pale bed
    case "gas": return 0.5;
    default: return 0.25;
  }
}

/**
 * What lights a planet: its host star (E/(πB) = (R★/d)², the star's surface brightness B), or, around
 * the hole, the accretion disk seen from the planet: E/(πB_disk) ≈ the disk's apparent area over π
 * (its face, foreshortened, plus the lensed images that hug the shadow — a first estimate until the
 * light probes of phase 5 measure it).
 */
function planetLight(s: Settings, sys: System, b: BodyDef, parent: number, r: number) {
  if (parent >= 0 && b.orbit.type === "kepler") {
    const host = sys.bodies.find((q) => q.id === b.parent)!;
    return { light: parent, illum: (host.radius / b.orbit.a) ** 2 };
  }
  const rOut = Math.max(s.diskOuter, 2);
  const rIn = 2;
  const face = (rOut * rOut - rIn * rIn) / (r * r); // disk area / r² (solid angle of the face-on disk)
  // (the face-on area, plus its lensed images wrapped around the shadow: × 1.5, roughly)
  return { light: -1, illum: Math.min(0.75 * face, 1) };
}

/** Packs the bodies into the GPU layout (BODY_VEC4 vec4s each). */
export function packBodies(list: GpuBody[], out: Float32Array) {
  out.fill(0);
  list.slice(0, MAX_BODIES).forEach((b, k) => {
    const o = k * BODY_VEC4 * 4;
    out.set([b.pos[0], b.pos[1], b.pos[2], b.radius], o);
    out.set([b.omega, b.parent, b.kind, b.mass], o + 4);
    out.set([b.temperature, b.brightness, b.surface, b.seed], o + 8);
    out.set([b.light, b.illum, b.where, b.rings?.outer ?? 0], o + 12);
    out.set(b.lightDir ? [...b.lightDir, b.lightT ?? 1] : [0, 0, 0, 0], o + 16);
    if (b.rings) out.set([...b.rings.pole, b.rings.inner], o + 20);
  });
}
