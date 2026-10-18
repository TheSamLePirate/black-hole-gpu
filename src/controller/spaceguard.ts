// The CameraController — a spacecraft's automatic protections (docs/PLAN-VAISSEAUX-AAA.md, X1b; game/spaceguard.ts):
// the ground foreseen on the engines (a caution, then the hover), the keep-out sphere of the station or a craft
// (a caution, then station keeping). They act in the assisted levels, in the realistic one with their setting on,
// never in the manual one — warned always. Not under an autopilot (it flies), not docked or landed.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { fleet } from "../fleet";
import { groundGuard, type GuardLevel, kosGuard } from "../game/spaceguard";
import { TUNING } from "../game/tuning";
import { tf } from "../i18n";
import { dot as dot3, lin, sub as sub3 } from "../math/vec3";
import { G0, M_METRES } from "../units";
import { VESSELS } from "../vessels";
import type { CameraController } from "../controls";

export interface SpaceGuard {
  kind: "ground" | "kos";
  /** warn: the caution; act: it took over (or would, were it allowed — then a warning only) */
  level: GuardLevel;
  /** whether it may act now (the level, the setting) */
  armed: boolean;
  /** the descent [m/s] or the closing [m/s], the height [m] or the range [m], what it allows */
  rate: number;
  dist: number;
  limit: number;
}

declare module "../controls" {
  interface CameraController {
    /** the protections' word this frame (the HUD's alerts), null: nothing foreseen */
    spaceGuard?: SpaceGuard | null;
    /** what the protections took over for, while their autopilot still flies it (the alert kept until it is stable) */
    guardTook?: SpaceGuard | null;
    spaceGuardStep: typeof spaceGuardStep;
  }
}

/** A frame of the protections: what is foreseen, and — armed — the autopilot that saves it engaged. */
function spaceGuardStep(this: CameraController) {
  this.spaceGuard = null;
  const P = this.pilot;
  // (taken over: said while its autopilot flies — until the descent or the closing is tamed)
  const took = this.guardTook;
  if (took) {
    const flying = P.auto === (took.kind === "ground" ? "hover" : "keep");
    const sf = took.kind === "ground" ? (this.surfaceInfo() as { vVert?: number } | null) : null;
    const tame = took.kind === "ground" ? Math.abs(sf?.vVert ?? 0) < 1 : (this.hubNote.drift ?? 0) < 0.05;
    if (flying && !tame) {
      this.spaceGuard = took;
      return;
    }
    this.guardTook = null;
  }
  if (fleet.active === "f35" || P.auto !== "none" || this.docked || this.landed || this.rolling) return;
  const level = this.assistLevel();
  const armed = level === "assisted" || level === "beginner" || (level === "realistic" && this.s.spaceAutoProtect !== false);
  // the ground: on the engines — not a plane flying on its wings (its own GPWS)
  const winged = this.flightModeNow() === "plane" && this.airFlight.inAir && (this.airFlight.last?.out.q ?? 0) > 300;
  if (VESSELS[fleet.active].lands && !winged) {
    const sf = this.surfaceInfo() as { alt?: number; vVert?: number; twr?: number; gLocal?: number; landed?: boolean } | null;
    if (sf && !sf.landed && sf.alt !== undefined && sf.alt < 5000) {
      const vDown = -(sf.vVert ?? 0);
      const r = groundGuard(sf.alt, vDown, sf.twr ?? 0, (sf.gLocal ?? 0) * G0, TUNING.crashSpeed);
      if (r.level !== "none") {
        this.spaceGuard = { kind: "ground", level: r.level, armed, rate: vDown, dist: sf.alt, limit: r.stop };
        if (r.level === "act" && armed) {
          this.guardTook = this.spaceGuard;
          P.setAuto("hover");
          this.onPilotMessage?.(tf("Auto-protection: the ground at {0} m/s — hovering", vDown.toFixed(0)));
        }
        return;
      }
    }
  }
  // the keep-out sphere of the station or a craft
  const g = this.dockGeometry();
  if (!g || g.range > 200) return;
  const d = lin(sub3(g.ring, g.c), M_METRES, g.ring, 0);
  const dl = Math.hypot(...d);
  const closing = dl > 0 ? -dot3(g.vrel, d) / dl : 0;
  const k = kosGuard(g.range, closing);
  if (k.level === "none") return;
  this.spaceGuard = { kind: "kos", level: k.level, armed, rate: closing, dist: g.range, limit: k.limit };
  if (k.level === "act" && armed) {
    this.guardTook = this.spaceGuard;
    this.keepRun = null;
    P.setAuto("keep");
    this.onPilotMessage?.(tf("Auto-protection: closing at {0} m/s inside 200 m — holding", closing.toFixed(1)));
  }
}

export function installSpaceGuard(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { spaceGuardStep });
}
