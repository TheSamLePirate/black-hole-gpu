// The propellant of each craft of the fleet (docs/PLAN-VAISSEAUX-AAA.md, X2b), from the rapidity its engines spent
// (fleet.spent) and the scene's tanks (exhaust speed, mass ratio — engine.ts): its mass left [kg], and moved from one
// docked craft to another (the Endurance refuelling the Ranger and the Lander). Pure.

export interface Tanks {
  exhaust: number;
  massRatio: number;
}

/** A craft's propellant left [kg] (its full mass, the rapidity spent), and its tank's whole [kg]. */
export function propellantKg(mass: number, T: Tanks, spent: number): { kg: number; full: number } {
  const dry = 1 / Math.max(T.massRatio, 1);
  const budget = T.exhaust * Math.log(Math.max(T.massRatio, 1));
  const left = Math.exp(-Math.min(Math.max(spent, 0), budget) / T.exhaust);
  return { kg: Math.max(0, mass * (left - dry)), full: mass * (1 - dry) };
}

/** The rapidity spent that leaves a craft `kg` of propellant (its full mass). */
export function spentFor(mass: number, T: Tanks, kg: number): number {
  const dry = 1 / Math.max(T.massRatio, 1);
  const frac = Math.min(Math.max(dry + kg / mass, dry), 1);
  return Math.max(0, -T.exhaust * Math.log(frac));
}

/**
 * Propellant moved from a craft to another (their full masses, their rapidities spent): as much as asked (all the
 * room left by default), no more than the giver has nor the taker holds. The new rapidities and the mass moved [kg].
 */
export function transfer(
  T: Tanks,
  from: { mass: number; spent: number },
  to: { mass: number; spent: number },
  kg = Number.POSITIVE_INFINITY,
): { fromSpent: number; toSpent: number; kg: number } {
  const a = propellantKg(from.mass, T, from.spent);
  const b = propellantKg(to.mass, T, to.spent);
  const moved = Math.max(0, Math.min(kg, a.kg, b.full - b.kg));
  return { fromSpent: spentFor(from.mass, T, a.kg - moved), toSpent: spentFor(to.mass, T, b.kg + moved), kg: moved };
}
