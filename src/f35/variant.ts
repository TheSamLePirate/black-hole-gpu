// The F-35's variants (docs/PLAN-AVIATION-AAA.md, M3): the B — short take-off and vertical landing, its lift fan —
// and the C — the carrier's: a wing a half larger (62.1 m², 13.1 m of span: 42.7 and 10.7 the B's), heavier
// (15.8 t empty), more fuel (9 t), a tailhook, no lift fan. Applied to the craft's figures (vessels.ts VESSELS.f35)
// — its mass, its fuel, its wing — when the setting changes; the tanks filled. Its model stays the B's.

import { VESSELS } from "../vessels";

export type F35Variant = "B" | "C";

const B = {
  name: "F-35B",
  empty: 14650,
  fuelKg: 6125,
  wing: { S: 42.7, AR: 2.68 },
  wingtip: [5.36, 1.16, -3.0] as [number, number, number],
};
const C = {
  name: "F-35C",
  empty: 15785,
  fuelKg: 8960,
  wing: { S: 62.1, AR: (13.1 * 13.1) / 62.1 },
  wingtip: [6.55, 1.16, -3.2] as [number, number, number],
};

let applied: F35Variant = "B";

/** The variant flown now. */
export const f35Variant = (): F35Variant => applied;

/** The F-35's figures set to a variant (changed: true — the tanks to be filled for the new one). */
export function applyF35Variant(v: F35Variant): boolean {
  if (v === applied) return false;
  const F = v === "C" ? C : B;
  const V = VESSELS.f35 as unknown as {
    name: string;
    mass: number;
    fuelKg: number;
    wingtip: [number, number, number];
    aero: { wing: { S: number; AR: number } };
  };
  V.name = F.name;
  V.mass = F.empty + 150 + F.fuelKg;
  V.fuelKg = F.fuelKg;
  V.wingtip = F.wingtip;
  V.aero.wing.S = F.wing.S;
  V.aero.wing.AR = F.wing.AR;
  applied = v;
  return true;
}
