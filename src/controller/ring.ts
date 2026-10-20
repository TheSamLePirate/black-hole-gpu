// The CameraController — the Endurance's ring (docs/PLAN-VAISSEAUX-AAA.md, X2a): the whole craft turned about its long
// axis, as in the film, for the crew's weight in its ring's modules (ω² r); ⇧[ ⇧] set the turn by a revolution a
// minute, its thrusters bring it there and hold it (the SAS's roll); the weight and the turn said on the HUD.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { fleet } from "../fleet";
import { t, tf } from "../i18n";
import { VESSELS } from "../vessels";
import type { CameraController } from "../controls";

/** The ring's figures: the turn at most [rpm] (past it the modules' structure is warned), the warning [rpm]; the spin-up
 *  [rad/s²] — 5 rpm in some 50 s, its attitude thrusters on the ring's rim. */
export const RING = { maxRpm: 10, warnRpm: 7, g0: 9.80665, accel: 0.01 };

/** The weight felt in the ring [g] at a turn [rad/s] and a radius [m]. Pure. */
export const ringG = (w: number, r: number) => (w * w * r) / RING.g0;
/** The turn for a weight [rad/s]. Pure. */
export const ringRateFor = (g: number, r: number) => Math.sqrt((g * RING.g0) / r);
export const RPM = (2 * Math.PI) / 60;

declare module "../controls" {
  interface CameraController {
    /** the ring's turn asked [rpm] (null: none held — the SAS's zero) */
    ringRpm?: number | null;
    ringSet: typeof ringSet;
    ringInfo: typeof ringInfo;
  }
}

/** ⇧[ ⇧]: the ring's turn asked a revolution a minute lower or higher (the Endurance flown). What to say. */
function ringSet(this: CameraController, step: number): string {
  const R = VESSELS[fleet.active].ring;
  if (!R) return t("The ring: the Endurance's");
  const now = this.ringRpm ?? Math.abs(this.pilot.omega[2]) / RPM;
  const rpm = Math.min(Math.max(Math.round(now + step), 0), RING.maxRpm);
  this.ringRpm = rpm;
  const g = ringG(rpm * RPM, R.radius);
  return rpm === 0
    ? t("Ring: stopping its turn")
    : tf(
        "Ring: {0} rpm asked — {1} g in its modules{2}",
        rpm,
        g.toFixed(2),
        rpm > RING.warnRpm ? t(" · past its structure's comfort") : "",
      );
}

/** The ring now: its turn [rpm], the weight in its modules [g], the turn asked [rpm] (null: not a ring's craft). */
function ringInfo(this: CameraController): { rpm: number; g: number; asked: number | null } | null {
  const R = VESSELS[fleet.active].ring;
  if (!R) return null;
  const w = Math.abs(this.pilot.omega[2]);
  return { rpm: w / RPM, g: ringG(w, R.radius), asked: this.ringRpm ?? null };
}

export function installRing(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { ringSet, ringInfo });
}
