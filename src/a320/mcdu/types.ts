// The A320's MCDUs' contract (docs/PLAN-A320.md, A9): what a MCDU is asked (its keys — FlightGear's mcdu.button,
// lskbutton, rskbutton, pagebutton, arrowbutton —, the computer's keyboard in its keyboard mode) and what it works on
// (the host: the FMS's data, the FMGC, the game's flight plan, the place, the weights, the airfields).

import type { Airfield } from "../../world/runways";
import type { FlightPlan } from "../../game/flightplan";
import type { Fmgc } from "../fmgc/fmgc";
import type { Fms } from "../fmgc/fms";

export interface McduHost {
  fms: Fms;
  fmgc(): Fmgc | null;
  /** the game's flight plan (edited in place, then routeChanged()) and the active waypoint's index */
  route(): FlightPlan;
  routeChanged(): void;
  activeWp(): number;
  /** DIR TO a waypoint of the plan (its index) or a place: the plan made to go there from here */
  directTo(index: number): void;
  /** where the aircraft is (geodetic, [°], [m]), its ground speed [m/s], on the ground */
  geo(): { lat: number; lon: number; alt: number; gs: number } | null;
  onGround(): boolean;
  /** an airfield by its code (OurAirports: ICAO, IATA) — null: unknown */
  field(code: string): Airfield | null;
  /** the gross weight [kg], the fuel on board [kg] */
  gwKg(): number;
  fobKg(): number;
  /** the time now (UTC) */
  now(): Date;
}

/** What a MCDU's keys are: FlightGear's names (MCDU.nas). */
export type McduKey =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z"
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "."
  | "/"
  | "PLUSMINUS"
  | "SP"
  | "CLR"
  | "OVFY";

/** A MCDU: its state machine and its picture. */
export interface McduApi {
  /** a key of the keyboard (letters, digits, the scratchpad's) */
  button(k: string): void;
  /** a line select key: L or R, 1…6 */
  lsk(side: "L" | "R", n: number): void;
  /** a page key: FlightGear's names — "dir", "prog", "perf", "init", "data", "f-pln", "radnav", "fuel-pred",
   *  "sec-fpln", "atc", "mcdu", "airport" */
  page(name: string): void;
  /** the slew keys */
  arrow(dir: "left" | "right" | "up" | "down"): void;
  /** typed on the computer's keyboard (its keyboard mode) */
  type(text: string): void;
  /** its picture on a canvas of w × h px (its screen's: 1024 × 864) */
  render(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, w: number, h: number): void;
}
