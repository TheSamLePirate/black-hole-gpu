// The Ranger's handling and the ground's rules, set from the settings (Game section) each frame:
// the flight code reads them here rather than as constants.

import type { Settings } from "../settings";

export const TUNING = {
  /** attitude control: top turning rate [rad/s], angular acceleration [rad/s²] */
  turnRate: 0.75,
  turnAccel: 1.6,
  /** RCS translation, fraction of the main engine */
  rcs: 0.08,
  /** touch-down speed above which it is a crash [m/s] */
  crashSpeed: 12,
  /** ballistic coefficient m/(C_D A) [kg/m²] */
  ballistic: 900,
};

export function applyTuning(s: Settings) {
  const D = Math.PI / 180;
  TUNING.turnRate = Math.max(1, s.turnRate) * D;
  TUNING.turnAccel = Math.max(1, s.turnAccel) * D;
  TUNING.rcs = Math.max(0, s.rcsFraction);
  TUNING.crashSpeed = Math.max(0.1, s.crashSpeed);
  TUNING.ballistic = Math.max(1, s.ballistic);
}
