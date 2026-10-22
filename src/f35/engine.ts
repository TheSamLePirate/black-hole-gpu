// The F-35B's engine (docs/PLAN-F35.md, F3): the Pratt & Whitney F135-PW-600, an afterburning low-bypass
// turbofan — not a rocket. Its thrust from the air it breathes: the density's lapse with height, the ram
// rise with Mach (more with the afterburner, a supersonic engine's); its fuel burnt by its specific
// consumption (dry ~0.8 lb/lbf/h, afterburning ~2 lb/lbf/h); some 6 t of fuel inside, ~9 minutes of full
// afterburner, three quarters of an hour at full dry power. Pure.

/** An afterburning turbofan's figures (sea level, static). */
export interface TurbofanDef {
  /** its maximum dry ("military") thrust and its full afterburning thrust [N] */
  dry: number;
  wet: number;
  /** its ground idle's share of the dry thrust */
  idle: number;
  /** its specific fuel consumption [kg/(N s)]: dry, and the afterburner's increment over the dry thrust (some 4.5
   *  lb/lbf/h: ~2 over the whole wet thrust) */
  tsfcDry: number;
  tsfcWet: number;
  /** its spool's time constant [s] (idle to military in some three of them) and the afterburner's light-up [s] */
  spool: number;
  light: number;
  /** its dry thrust's change with Mach: 1 + a M + b M² (a low-bypass fighter's, none: −0.18, 0.32 — its ram's
   *  rise; a high-bypass airliner's falls: its fan's momentum drag) */
  ram?: [number, number];
}

/** The F135-PW-600 (the F-35B's: 191 kN wet is the A's; the B's ~176 kN, its dry ~120 kN). */
export const F135: TurbofanDef = {
  dry: 120e3,
  wet: 176e3,
  idle: 0.05,
  // (0.81 and 4.5 lb/lbf/h: 1 lb/lbf/h = 28.33 mg/(N s))
  tsfcDry: 0.81 * 28.33e-6,
  tsfcWet: 4.5 * 28.33e-6,
  spool: 1.1,
  light: 0.6,
};

/** the density's share at the tropopause (11 km, ISA) */
const SIGMA_TROP = 0.2971;
/**
 * The share of its sea-level thrust the engine keeps with the density: σ^0.75 in the troposphere (the air colder
 * as it thins, the engine's pressure ratio up); above the tropopause, the temperature constant, as the density
 * itself (a turbofan's lapse — its ceiling some 50 000 ft, the F-35's published one).
 */
const lapse = (sigma: number) => {
  const s = Math.max(sigma, 0);
  return s >= SIGMA_TROP ? s ** 0.75 : SIGMA_TROP ** 0.75 * (s / SIGMA_TROP);
};

/** Its dry thrust available at full throttle [N]: the density's lapse, the ram's rise past Mach 0.6. */
export function dryThrust(def: TurbofanDef, mach: number, sigma: number): number {
  const M = Math.max(mach, 0);
  const [a, b] = def.ram ?? [-0.18, 0.32];
  return def.dry * lapse(sigma) * (1 + a * M + b * M * M) * (M > 1.6 ? Math.max(0, 1 - (M - 1.6) * 0.8) : 1);
}

/** Its full afterburning thrust [N]: more of a rise with Mach (the afterburner's nozzle flow), past 2 falling. */
export function wetThrust(def: TurbofanDef, mach: number, sigma: number): number {
  const M = Math.max(mach, 0);
  return def.wet * lapse(sigma) * (1 + 0.05 * M + 0.13 * M * M) * (M > 1.8 ? Math.max(0, 1 - (M - 1.8) * 0.9) : 1);
}

/** The afterburner's factor over the dry thrust there (game/jet.ts JET.abThrust's, the F-35's own). */
export function wetRatio(def: TurbofanDef, mach: number, sigma: number): number {
  const d = dryThrust(def, mach, sigma);
  return d > 0 ? wetThrust(def, mach, sigma) / d : 1;
}

/** the dry consumption's rise with the flight's Mach number (a low-bypass turbofan's ram drag: ~1.2× at Mach 0.85) */
export const TSFC_MACH = 0.25;

/**
 * The fuel it burns [kg/s] for a thrust at a Mach number: the throttle's dry share at the dry consumption (rising
 * with the speed — the air taken in at speed costs its momentum), the afterburner's part at its own; a floor at
 * idle (the engine running, the thrust nil).
 */
export function fuelFlow(def: TurbofanDef, thrust: number, dryPart: number, sigma: number, mach = 0): number {
  const idle = 0.12 * Math.max(sigma, 0.1);
  const dry = def.tsfcDry * (1 + TSFC_MACH * Math.max(mach, 0));
  return Math.max(idle, dry * Math.min(thrust, dryPart) + def.tsfcWet * Math.max(thrust - dryPart, 0));
}
