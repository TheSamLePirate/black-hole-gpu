// The CameraController — refuelling between docked craft (docs/PLAN-VAISSEAUX-AAA.md, X2b; game/propellant.ts): the
// flown craft's tank filled from what it is docked to — the Endurance first (its tank holds 22 Rangers'), else the
// fullest; the docking panel's REFUEL, TARS, the crew.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { fleet } from "../fleet";
import { fuelOn } from "../engine";
import { propellantKg, transfer } from "../game/propellant";
import { t, tf } from "../i18n";
import { VESSELS, type VesselId } from "../vessels";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    refuelFromDocked: typeof refuelFromDocked;
    propellantOf: typeof propellantOf;
  }
}

/** A craft's propellant now: its mass [kg] and share of its tank (null: not counted — no tanks, an aircraft). */
function propellantOf(this: CameraController, id: VesselId): { kg: number; share: number } | null {
  const T = fleet.tanks;
  if (!T || VESSELS[id].fuelKg) return null;
  const p = propellantKg(VESSELS[id].mass, T, fleet.spent[id] ?? 0);
  return { kg: p.kg, share: p.full > 0 ? p.kg / p.full : 0 };
}

/** The flown craft's tank filled from a craft docked to it (the Endurance first, else the fullest). What to say. */
function refuelFromDocked(this: CameraController): string {
  if (!fuelOn(this.s) || !fleet.tanks) return t("Refuel: the propellant is not counted in this scene");
  const me = fleet.active;
  const mine = this.propellantOf(me);
  if (!mine) return t("Refuel: a rocket's tank");
  const partners = fleet.assembly(me).filter((v): v is VesselId => v !== me && v !== "iss" && !VESSELS[v as VesselId].fuelKg);
  if (!partners.length) return t("Refuel: docked to a craft of the fleet first (the Endurance holds the most)");
  const giver =
    partners.find((v) => VESSELS[v].ring) ?? partners.sort((a, b) => (this.propellantOf(b)?.kg ?? 0) - (this.propellantOf(a)?.kg ?? 0))[0]!;
  const r = transfer(
    fleet.tanks,
    { mass: VESSELS[giver].mass, spent: fleet.spent[giver] ?? 0 },
    { mass: VESSELS[me].mass, spent: fleet.spent[me] ?? 0 },
  );
  if (r.kg < 1)
    return mine.share > 0.999 ? t("Refuel: the tank is full") : tf("Refuel: the {0} has nothing left to give", VESSELS[giver].name);
  fleet.spent[giver] = r.fromSpent;
  fleet.spent[me] = r.toSpent;
  const left = this.propellantOf(giver)!;
  return tf(
    "Refuelled from the {0}: {1} t — the {0} at {2} %",
    VESSELS[giver].name,
    (r.kg / 1000).toFixed(1),
    Math.round(left.share * 100),
  );
}

export function installRefuel(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { refuelFromDocked, propellantOf });
}
