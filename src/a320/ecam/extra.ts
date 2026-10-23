// What FlightGear's ECAM defines and never raises (ECAM-messages.nas has them, ECAM-logic.nas not — docs/PLAN-A320.md,
// A11): a single hydraulic system's low pressure, HYD G / B / Y SYS LO PR, as the FCOM has it — the system under
// 1 450 psi while its pair's dual loss is not shown, its engine's pump's line when that pump is selected on, the
// fuel's and the FMS's lines with the green's (the gear's) —, inhibited as the other amber cautions in the take-off's
// and the landing's phases (3–5, 7–8) and with the aircraft at rest (1, 10). Ours, run after the logic.

import type { Fwc } from "./fwc";

export function hydraulicLoPr(F: Fwc): void {
  const { g, M, R } = F;
  const ph = Number(g("ECAM/warning-phase"));
  const quiet = ph === 1 || ph === 10 || (ph >= 3 && ph <= 5) || ph === 7 || ph === 8;
  const lo = (s: string) => Number(g(`systems/hydraulic/${s}-psi`)) < 1450;
  const dual = [M.hydBYloPr, M.hydGBloPr, M.hydGYloPr].some((w) => w.active === 1);
  const sys = [
    {
      w: M.hydGSysLoPr,
      s: "green",
      lines: [M.hydGSysLoPrFuel, M.hydGSysLoPrFmsPred],
      pump: M.hydGSysLoPrEngPump,
      edp: "controls/hydraulic/switches/green-edp",
    },
    { w: M.hydBSysLoPr, s: "blue", lines: [M.hydBSysLoPrFuel, M.hydBSysLoPrFmsPred], pump: null, edp: "" },
    {
      w: M.hydYSysLoPr,
      s: "yellow",
      lines: [M.hydYSysLoPrAccu],
      pump: M.hydYSysLoPrEngPump,
      edp: "controls/hydraulic/switches/yellow-edp",
    },
  ];
  for (const { w, s, lines, pump, edp } of sys) {
    if (w.clearFlag === 0 && !quiet && !dual && lo(s)) {
      w.active = 1;
      for (const l of lines) l.active = l.clearFlag === 0 ? 1 : 0;
      if (pump) {
        if (pump.clearFlag === 0 && Number(g(edp)) === 1) pump.active = 1;
        else R(pump);
      }
    } else {
      R(w);
      for (const l of lines) R(l);
      if (pump) R(pump);
    }
  }
}
