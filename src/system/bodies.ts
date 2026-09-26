// The bodies of a scene: a registry (id, parent, universe, kind, mass, radius, orbit, surface) and the
// Gargantua system of the study (ANALYSE-INTEGRATION.md, v4 decisions).
//
// Units: G = c = M = 1, M the hole's mass (10⁸ M☉ here: 1 M = 0.98706 AU, 492.55 s). Masses are GM in
// units of M (a solar mass is 10⁻⁸). Two universes: "gargantua" (Kerr, the flat map of Boyer–Lindquist
// around the hole) and "ours" (the far side of the wormhole: positions in the rep frame of our mouth).

import { SI, units } from "./kerr-orbits";

export type BodyKind = "hole" | "planet" | "star" | "mouth";
export type Universe = "gargantua" | "ours";

export type Orbit =
  /** circular equatorial prograde geodesic of Kerr around the hole, at radius r (M) */
  | { type: "kerr"; r: number; phase: number }
  /** Keplerian circle around the parent (a in M), in the parent's equatorial plane */
  | { type: "kepler"; a: number; phase: number }
  /** fixed (in its universe's frame) */
  | { type: "fixed"; pos: [number, number, number] };

export interface Surface {
  kind: "ocean" | "ice" | "rock" | "gas";
  /** surface gravity [g] */
  gravity: number;
  /** exponential atmosphere: sea-level density [kg/m³], scale height [m] (null: none) */
  atmosphere: { rho0: number; H: number } | null;
}

export interface BodyDef {
  id: string;
  name: string;
  parent: string | null;
  universe: Universe;
  kind: BodyKind;
  /** GM in units of M */
  mass: number;
  /** radius [M] (the throat's radius ρ for a mouth) */
  radius: number;
  orbit: Orbit;
  /** stars: effective temperature [K], luminosity [L☉] */
  temperature?: number;
  luminosity?: number;
  surface?: Surface;
  /** a short line for tooltips */
  note?: string;
}

export interface System {
  name: string;
  massSolar: number;
  spin: number;
  bodies: BodyDef[];
}

/** Body lookup. */
export function body(sys: System, id: string): BodyDef {
  const b = sys.bodies.find((q) => q.id === id);
  if (!b) throw new Error(`no body ${id}`);
  return b;
}

// ------------------------------------------------------------------------------ the Gargantua system
const MASS = 1e8;
const U = units(MASS);
const m = (metres: number) => metres / U.rg; // metres → M
const au = (x: number) => (x * SI.au) / U.rg; // AU → M
const solar = (x: number) => x / MASS; // M☉ → GM in M
const earth = (x: number) => (x * SI.muEarth) / U.mu; // M⊕ → GM in M

/** Radius and mass of a planet of Earth's density with surface gravity g (in g of Earth). */
const earthLike = (g: number) => ({ radius: m(g * SI.earthRadius), mass: earth(g ** 3) });

const miller = earthLike(1.3);
const mann = earthLike(1);
const edmunds = earthLike(1);
/** the K2 dwarf: 0.78 M☉, 0.35 L☉, ≈ 4 900 K, 0.72 R☉; Edmunds at the insolation of the Earth */
const K2 = { m: 0.78, L: 0.35, T: 4900, R: 0.72 };

export const GARGANTUA_SYSTEM: System = {
  name: "Gargantua system",
  massSolar: MASS,
  spin: 0.998,
  bodies: [
    { id: "gargantua", name: "Gargantua", parent: null, universe: "gargantua", kind: "hole", mass: 1, radius: 0, orbit: { type: "fixed", pos: [0, 0, 0] } },
    {
      id: "miller", name: "Miller", parent: "gargantua", universe: "gargantua", kind: "planet", ...miller,
      orbit: { type: "kerr", r: 10, phase: 2.55 },
      surface: { kind: "ocean", gravity: 1.3, atmosphere: { rho0: 1.2, H: 8500 } },
      note: "1 hour here ≈ 1 h 11 min far away (x = 10, a* = 0.998)",
    },
    {
      id: "mann", name: "Mann", parent: "gargantua", universe: "gargantua", kind: "planet", ...mann,
      orbit: { type: "kerr", r: 40, phase: 0.72 },
      surface: { kind: "ice", gravity: 1, atmosphere: { rho0: 0.9, H: 7000 } },
    },
    {
      id: "mouth", name: "Wormhole", parent: "gargantua", universe: "gargantua", kind: "mouth", mass: 0, radius: 0.05,
      orbit: { type: "kerr", r: 300, phase: 5.72 },
      note: "ρ = 0.05 M ≈ 7.4 million km; hypothetical, a test particle",
    },
    {
      id: "k2", name: "Edmunds' star", parent: "gargantua", universe: "gargantua", kind: "star",
      mass: solar(K2.m), radius: m(K2.R * SI.rSun), temperature: K2.T, luminosity: K2.L,
      orbit: { type: "kerr", r: au(2000), phase: 3.9 },
    },
    {
      id: "edmunds", name: "Edmunds", parent: "k2", universe: "gargantua", kind: "planet", ...edmunds,
      orbit: { type: "kepler", a: au(Math.sqrt(K2.L)), phase: 2.2 },
      surface: { kind: "rock", gravity: 1, atmosphere: { rho0: 1.1, H: 8000 } },
    },
    // our side (positions in our mouth's rep frame, M): the Sun at 9.5 AU, Saturn 0.7 AU from the mouth
    { id: "sun", name: "Sun", parent: null, universe: "ours", kind: "star", mass: solar(1), radius: m(SI.rSun), temperature: 5772, luminosity: 1, orbit: { type: "fixed", pos: [au(9.5), 0, 0] } },
    {
      id: "saturn", name: "Saturn", parent: "sun", universe: "ours", kind: "planet", mass: solar(2.8589e-4), radius: m(5.8232e7),
      orbit: { type: "fixed", pos: [au(0.7) * 0.6, au(0.7) * 0.8, 0] },
      surface: { kind: "gas", gravity: 1.065, atmosphere: null },
    },
  ],
};
