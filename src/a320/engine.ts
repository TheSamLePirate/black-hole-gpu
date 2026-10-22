// The A320-214's engines (docs/PLAN-A320.md, A3 — a first cut until the FADEC's tables are read): two CFM56-5B4/P,
// 27 000 lbf each at take-off (FlightGear's Engines/cfm56-5b4_1.xml), high-bypass — their thrust falls with the
// speed (the fan's momentum drag), no afterburner. Pure.

import type { TurbofanDef } from "../f35/engine";

/** Both CFM56-5B4s as one: sea level, static. */
export const CFM56_PAIR: TurbofanDef = {
  dry: 2 * 120.1e3,
  wet: 2 * 120.1e3,
  idle: 0.06,
  // (0.36 lb/lbf/h at sea level, static — 0.55 at cruise with the speed's rise: TSFC_MACH)
  tsfcDry: 0.4 * 28.33e-6,
  tsfcWet: 0.4 * 28.33e-6,
  // (a big fan's inertia: idle to take-off power in some 6 s)
  spool: 2.2,
  light: 0,
  ram: [-0.55, 0.25],
};
