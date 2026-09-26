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
export const BODY_VEC4 = 4;

export const BODY_STAR = 0;
export const BODY_PLANET = 1;
const SURFACES = { ocean: 0, ice: 1, rock: 2, gas: 3 } as const;

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
}

/** The system a scene uses. */
export function sceneSystem(s: Settings): System | null {
  return s.system === "gargantua" ? GARGANTUA_SYSTEM : null;
}

/** Orbits within this radius are traced as spheres; farther bodies are for the lensed points (phase 2). */
const TRACED_RADIUS = 600;

export function sceneBodies(s: Settings, t: number): GpuBody[] {
  const out: GpuBody[] = [];
  if (s.sun) {
    out.push({
      id: "star", pos: starCentre(s, t), radius: s.sunRadius, omega: starOmega(s), parent: -1, kind: BODY_STAR,
      mass: s.sunMass, temperature: s.sunTemp, brightness: s.sunBrightness, surface: 0, seed: 0, light: -1, illum: 0,
    });
  }
  const sys = sceneSystem(s);
  if (!sys) return out;
  const traced = (b: BodyDef) => b.universe === "gargantua" && (b.kind === "planet" || b.kind === "star");
  const index = new Map<string, number>();
  // parents first (a star before its planets)
  const order = sys.bodies.filter(traced).sort((a, b) => (a.parent === "gargantua" ? 0 : 1) - (b.parent === "gargantua" ? 0 : 1));
  for (const b of order) {
    if (out.length >= MAX_BODIES) break;
    const st = bodyState(sys, b.id, t);
    const R = Math.hypot(...st.pos);
    if (R > TRACED_RADIUS) continue;
    const parent = b.parent && b.parent !== "gargantua" ? index.get(b.parent) ?? -1 : -1;
    let pos = st.pos;
    if (parent >= 0) {
      const p = bodyState(sys, b.parent!, t).pos;
      pos = [pos[0] - p[0], pos[1] - p[1], pos[2] - p[2]];
    }
    const lit = b.kind === "planet" ? planetLight(s, sys, b, parent, R) : { light: -1, illum: 0 };
    index.set(b.id, out.length);
    out.push({
      id: b.id, pos, radius: b.radius, omega: meanMotion(sys, b), parent, kind: b.kind === "star" ? BODY_STAR : BODY_PLANET,
      mass: b.kind === "star" ? b.mass : 0, temperature: b.temperature ?? 0, brightness: b.kind === "star" ? 1 : albedo(b),
      surface: b.surface ? SURFACES[b.surface.kind] : 2, seed: out.length * 17.3 + 3.1, ...lit,
    });
  }
  return out;
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
    out.set([b.light, b.illum, 0, 0], o + 12);
  });
}
