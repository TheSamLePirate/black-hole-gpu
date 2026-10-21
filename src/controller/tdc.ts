// The CameraController — the designation cursor (TDC, input/tdc.ts — PLAN-RADAR-AAA constat 29): each frame, in the
// air with a radar (the F-35's, the Ranger's nose radar), held by the pad (its two bumpers), a HOTAS's button or a key
// bound to it (input/bindings.ts `tdc`); slewed by the pad's right stick, a HOTAS's slew (the RCS's translation axes —
// a throttle's mini-stick) or its look hat, the arrows; on the screen the game says is in use (`tdcWhere`, main.ts: the
// PCD's page looked at in the F-35's cockpit, else the HUD's scope). Designated (the pad's A, the « designate »
// binding): what is under it picked as a click would (`tdcPick`, main.ts).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { heldCode } from "../input/bindings";
import { slewOf, type TdcScreen } from "../input/tdc";
import type { Commands } from "../input/axes";
import { t } from "../i18n";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    tdcStep: typeof tdcStep;
    tdcDesignate: typeof tdcDesignate;
    /** the screen the cursor stands on now (main.ts): the PCD's page looked at, the HUD's scope; null: none shown */
    tdcWhere?: () => TdcScreen | null;
    /** what is under the cursor picked on that screen (main.ts): what to say */
    tdcPick?: (where: TdcScreen, x: number, y: number) => string | null;
  }
}

/** A frame of the cursor: held, slewed, on its screen — or off. */
function tdcStep(this: CameraController, dt: number, pc: Commands | null) {
  const J = this.jetPadOut;
  const k = (c: string) => this.codes.has(c);
  const held = !!J?.tdc || !!pc?.held.has("tdc") || k(heldCode("tdc"));
  const can = held && this.piloting && !this.spectator && !!this.airRadar();
  const ax = pc?.axes;
  const where = can ? (this.tdcWhere?.() ?? null) : null;
  const slew = slewOf(J?.tdc ? J.tdcSlew : null, ax ? [ax.rcsX ?? 0, ax.rcsY ?? 0] : null, ax ? [ax.lookX ?? 0, ax.lookY ?? 0] : null, [
    (k("ArrowRight") ? 1 : 0) - (k("ArrowLeft") ? 1 : 0),
    (k("ArrowUp") ? 1 : 0) - (k("ArrowDown") ? 1 : 0),
  ]);
  this.tdc.step(can && !!where, slew, dt, where);
}

/** The pad's A, the « designate » binding: what is under the cursor picked; what to say. */
function tdcDesignate(this: CameraController): string {
  const T = this.tdc;
  if (!T.on || !T.screen) return t("Designate: hold the cursor (TDC) first — the pad's bumpers, its HOTAS button");
  return this.tdcPick?.(T.screen, T.x, T.y) ?? "";
}

export function installTdc(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { tdcStep, tdcDesignate });
}
