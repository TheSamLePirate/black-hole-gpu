// The A320's ground services (docs/PLAN-A320.md, A14 — FlightGear's AircraftConfig/groundservices.xml and its models,
// Models/A320-groundservices.xml): the stairs at the front and rear left doors (the doors opened), the external power
// box (the systems' ground cart: EXT PWR available on the overhead), the fuel truck (refuelling for real, ~1 000 kg a
// minute to the FMS's block fuel or a chosen amount), the catering trucks at the right doors (their boxes rising),
// the chocks (the aircraft held), the de-icing truck (its boom's spray clearing the frost), the baggage belt. Each
// vehicle at FlightGear's own place about the aircraft (its offsets: x aft, y right, z up, heading), drawn by ship.ts
// (assets/traffic/gs-*.bin: scripts/build-a320-services.py). Pure but for the bag it writes.

import type { GroundMeshId } from "../ship";
import type { Props } from "./rig";

type V3 = [number, number, number];

export type ServiceId = "stairs" | "stairsAft" | "gpu" | "fuel" | "catering" | "cateringAft" | "chocks" | "deice" | "belt";
export const SERVICES: { id: ServiceId; name: string }[] = [
  { id: "stairs", name: "Stairs, front door" },
  { id: "stairsAft", name: "Stairs, rear door" },
  { id: "gpu", name: "External power (GPU)" },
  { id: "fuel", name: "Fuel truck" },
  { id: "catering", name: "Catering, front" },
  { id: "cateringAft", name: "Catering, rear" },
  { id: "belt", name: "Baggage belt" },
  { id: "chocks", name: "Chocks" },
  { id: "deice", name: "De-icing" },
];

/** A vehicle drawn: its mesh, its place in the ship's frame [m], its turn about the ship's y [rad]. */
export interface GroundVehicle {
  id: GroundMeshId;
  p: V3;
  yaw: number;
}

/** FlightGear's model frame (x aft, y right, z up) to the ship's (x left, y up, z forward), the belly at y = 0 and
 *  the fuselage's model offset (scripts/build-a320.py to_ship). */
export const fgToShip = (x: number, y: number, z: number): V3 => [-y, z + 2.648, -x];
const D = Math.PI / 180;
/** a vehicle at FlightGear's offsets (its heading's turn: about the up axis, as its model's z) */
const at = (id: GroundMeshId, x = 0, y = 0, z = 0, hdg = 0): GroundVehicle => ({ id, p: fgToShip(x, y, z), yaw: -hdg * D });

/** The pushback tug (FlightGear's Douglas at x −13.80, z −4.24 — A320-common.xml): turned with its tow bar about the
 *  nose gear [deg, > 0 to the right], driven in from 20 m ahead as it connects (attach 0…1). */
export function tugVehicle(bar: number, attach: number): GroundVehicle {
  const pivot: V3 = [0, -1.592, 13.65];
  const a = -bar * D;
  const off = 0.15 + (1 - attach) * 20;
  return { id: "gs-tug", p: [pivot[0] + Math.sin(a) * off, pivot[1], pivot[2] + Math.cos(a) * off], yaw: a };
}

/** The doors (pose.ts: L1, L4, R1, R4, cargo fwd, aft, bulk) each service opens. */
const OPENS: Partial<Record<ServiceId, number[]>> = {
  stairs: [0],
  stairsAft: [1],
  catering: [2],
  cateringAft: [3],
  belt: [4, 5],
};

/** the catering box's rise [s], the refuelling's rate [kg/s], the de-icing's spray [s] */
const RISE_S = 20;
export const FUEL_RATE = 1000 / 60;
const DEICE_S = 90;

export interface ServicesCtx {
  /** on the wheels, the speed over the ground [m/s] */
  onGround: boolean;
  gs: number;
  /** the fuel aboard [kg], the most the tanks take [kg] */
  fuelKg: number;
  fuelMax: number;
}

export class GroundServices {
  readonly on = new Set<ServiceId>();
  /** the catering boxes' rise 0…1, the de-icing's time left [s], the refuelling's target [kg] (none: no refuelling) */
  rise = [0, 0];
  deiceLeft = 0;
  fuelTarget: number | null = null;
  /** the de-icing's work done since it began 0…1 (glass.ts's frost cleared by it) */
  deiced = 0;

  /** A service on or off; its message. */
  toggle(id: ServiceId, c: ServicesCtx, fuelTo?: number | null): string {
    if (this.on.has(id)) {
      this.on.delete(id);
      if (id === "fuel") this.fuelTarget = null;
      return "off";
    }
    if (!c.onGround || c.gs > 1) return "only at rest on the ground";
    this.on.add(id);
    if (id === "fuel") this.fuelTarget = Math.min(fuelTo ?? c.fuelMax, c.fuelMax);
    if (id === "deice") this.deiceLeft = DEICE_S;
    return "on";
  }

  /** Every service gone (the aircraft moving, a new flight). */
  clear() {
    this.on.clear();
    this.fuelTarget = null;
    this.rise = [0, 0];
    this.deiceLeft = 0;
  }

  /**
   * A frame [s]: the services' work — the fuel added [kg] (returned), the catering boxes rising, the de-icing's spray
   * running down — and their state on the systems' bag (FlightGear's services/* and the ground cart, the chocks').
   * The aircraft moving off with any on: they are gone (FlightGear's — the trucks withdrawn).
   */
  step(P: Props, dt: number, c: ServicesCtx): { fuelAdded: number; moved: boolean } {
    let moved = false;
    if (this.on.size && (!c.onGround || c.gs > 1.5)) {
      this.clear();
      moved = true;
    }
    let fuelAdded = 0;
    if (this.on.has("fuel") && this.fuelTarget !== null) {
      fuelAdded = Math.max(0, Math.min(FUEL_RATE * dt, this.fuelTarget - c.fuelKg));
      if (fuelAdded <= 0) this.fuelTarget = null;
    }
    this.rise[0] = Math.min(Math.max(this.rise[0]! + (this.on.has("catering") ? dt : -dt) / RISE_S, 0), 1);
    this.rise[1] = Math.min(Math.max(this.rise[1]! + (this.on.has("cateringAft") ? dt : -dt) / RISE_S, 0), 1);
    if (this.on.has("deice") && this.deiceLeft > 0) {
      this.deiceLeft = Math.max(this.deiceLeft - dt, 0);
      this.deiced = 1 - this.deiceLeft / DEICE_S;
    }
    // (FlightGear's properties: its sounds, its ECAM's, the network's)
    const b = (k: ServiceId) => (this.on.has(k) ? 1 : 0);
    Object.assign(P, {
      "controls/electrical/switches/ground-cart": b("gpu"),
      "services/fuel-truck/enable": b("fuel"),
      "services/fuel-truck/connect": this.fuelTarget !== null ? 1 : 0,
      "services/catering/enable": b("catering"),
      "services/catering-rear/enable": b("cateringAft"),
      "services/catering/position-norm": this.rise[0],
      "services/baggage/enable": b("belt"),
      "services/chocks/enable": b("chocks"),
      "services/deicing_truck/enable": b("deice"),
      "services/deicing_truck/de-ice": this.deiceLeft > 0 && this.on.has("deice") ? 1 : 0,
      "services/stairs/l1": b("stairs"),
      "services/stairs/l4": b("stairsAft"),
    });
    return { fuelAdded, moved };
  }

  /** The doors wanted open (pose.ts's order: L1, L4, R1, R4, cargo fwd, aft, bulk). */
  doors(): number[] {
    const d = [0, 0, 0, 0, 0, 0, 0];
    for (const id of this.on) for (const k of OPENS[id] ?? []) d[k] = 1;
    return d;
  }

  /** The aircraft held by its chocks */
  get chocked() {
    return this.on.has("chocks");
  }

  /** The vehicles to draw, at FlightGear's places (Models/A320-groundservices.xml, A320-common.xml). */
  vehicles(): GroundVehicle[] {
    const v: GroundVehicle[] = [];
    if (this.on.has("fuel")) v.push(at("gs-fuel"));
    if (this.on.has("deice")) v.push(at("gs-deice", -24, 9.5, -4.2, 160));
    // (the catering trucks, their boxes rising 3.11 m to the door — L_T_VolvoFM-4_5m-set.xml)
    const cater = (k: 0 | 1, x: number, y: number, hdg: number) => {
      if (!this.on.has(k ? "cateringAft" : "catering") && this.rise[k]! <= 0) return;
      const box = at("gs-catering-box", x, y, -4.17 + 3.11 * this.rise[k]!, hdg);
      v.push(at("gs-catering", x, y, -4.17, hdg), box);
    };
    cater(0, -14.54, 6.62, 93.412);
    cater(1, 11.2, 6.32, 82);
    if (this.on.has("belt")) v.push(at("gs-belt"));
    if (this.on.has("gpu")) v.push(at("gs-gpu", -17.8, 3.2, 0.55));
    if (this.on.has("chocks"))
      v.push(at("gs-chock-nose", 2.3, 0, 1.2), at("gs-chock-left", -5.95, 1.05, 1.45), at("gs-chock-right", -5.95, -1.05, 1.45));
    if (this.on.has("stairs")) v.push(at("gs-stairs", -14, -0.10833, -0.6, -4.037));
    if (this.on.has("stairsAft")) v.push(at("gs-stairs", 10.2, 0.04962, -0.6, 6.705));
    return v;
  }
}
