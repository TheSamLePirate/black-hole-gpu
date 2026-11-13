// « Release the controls » on an aircraft (audit 2026-11-10, FX-06): one action, the same promise on every craft — you have
// the controls. The key (Backspace), the pause's item and TARS's `release` all go through main.ts's releaseControls, which let go
// the mission, the hold and the spacecraft's autopilot, and then this: on an aircraft the approach (ILS, the deck's), the runway's
// take-off run, the formation, the intercept, the refuelling, the orbit and the terrain following, the flight plan's NAV, and the
// autopilot's holds and the autothrottle (the A320's through its FCU). Before 13 Nov 2026 an F-35's AP, A/THR and NAV flew on
// after the key — and it said « In the air — by hand ».
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import { t } from "../i18n";
import { isAircraft } from "../vessels";

declare module "../controls" {
  interface CameraController {
    releaseAircraft: typeof releaseAircraft;
  }
}

/** Every mode flying the aircraft let go; what was let go (empty: nothing was engaged, or not an aircraft). */
function releaseAircraft(this: CameraController): string[] {
  if (!isAircraft(fleet.active)) return [];
  const let_: string[] = [];
  if (this.ilsRun || this.a320App) {
    this.ilsOff();
    let_.push(t("approach"));
  }
  if (this.deckRun) {
    this.deckOff();
    let_.push(t("deck approach"));
  }
  if (this.rwyRun) {
    this.rwyRun = null;
    let_.push(t("take-off run"));
  }
  if (this.form) {
    this.formOff();
    let_.push(t("formation"));
  }
  if (this.icpt) {
    this.icptOff();
    let_.push(t("intercept"));
  }
  if (this.orbitMode || this.tfAgl != null || this.aar || this.tankerPending) {
    this.modesOff();
    let_.push(t("orbit, terrain following, refuelling"));
  }
  if (this.nav.on.l || this.nav.on.v) {
    this.nav.on = { l: false, v: false };
    let_.push(t("NAV"));
  }
  const m = this.jetModes;
  if (m.alt !== null || m.hdg !== null || m.spd !== null || m.ab) {
    this.apSet({ ap: false, athr: false });
    let_.push(t("autopilot and autothrottle"));
  }
  return let_;
}

export function installRelease(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { releaseAircraft });
}
