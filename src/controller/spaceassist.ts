// The CameraController — a spacecraft's levels of assistance (docs/PLAN-VAISSEAUX-AAA.md, X0), the F-35's own made
// for the Ranger, the Lander and the Endurance: manual (no SAS: the stick an angular acceleration, a turn kept until
// stopped by hand), realistic (the pilot's SAS, as before), assisted (the SAS always on; near a craft or the station,
// the RCS let go holds the drift against it at nothing), beginner (the same, half the rates); and in any, back to a
// stable craft at a key (⇧X, the F-35's) — the turn stopped, then over a ground a hover, in orbit prograde held.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { fleet } from "../fleet";
import { t } from "../i18n";
import { cameraFrame } from "../camera";
import { dot as dot3 } from "../math/vec3";
import { gearHeight, solidBody } from "../system/our-surface";
import { isAircraft, VESSELS } from "../vessels";
import type { FlightContext, PilotInput } from "../pilot";
import type { CameraController } from "../controls";

const D = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** The levels' figures: the drift held within this range of a craft [m] (assisted, beginner); the RCS full at this
 *  drift [m/s], none below the dead band; the beginner's rates' share; a turn read as stopped [rad/s], held so long
 *  [s] before the recovery's second part; over a ground below this height [m] the recovery hovers; given up after. */
export const SPACE_ASSIST = {
  holdRange: 1000,
  holdRangeBeginner: 2000,
  driftFull: 0.1,
  driftDead: 0.002,
  beginnerRate: 0.5,
  still: 0.2 * D,
  stillFor: 0.5,
  hoverBelow: 3000,
  giveUp: 30,
};

export type SpaceAssistLevel = "manual" | "realistic" | "assisted" | "beginner";

declare module "../controls" {
  interface CameraController {
    /** back to a stable craft (a spacecraft's): since when [s], how long it has been still [s] */
    spaceRecover?: { t: number; still: number } | null;
    /** the level's SAS law this frame (the flight computer's FlightContext.rate), the RCS holding the drift */
    spaceRate?: FlightContext["rate"];
    spaceDrift?: boolean;
    /** the RCS mode (⇧9): the attitude keys turn the craft, or translate it (docking) */
    rcsMode?: "rotate" | "translate";
    spaceAssistStep: typeof spaceAssistStep;
    rcsModeToggle: typeof rcsModeToggle;
    spaceRecoverStart: typeof spaceRecoverStart;
  }
}

/** The rate law of a level: manual direct, assisted and beginner damped (the beginner's slower), realistic the
 *  pilot's (null). Pure. */
export function spaceRateLaw(level: SpaceAssistLevel): FlightContext["rate"] {
  if (level === "manual") return { law: "direct", scale: 1 };
  if (level === "assisted") return { law: "damped", scale: 1 };
  if (level === "beginner") return { law: "damped", scale: SPACE_ASSIST.beginnerRate };
  return null;
}

/**
 * The RCS's translation that holds the drift against a craft at nothing: the relative velocity [m/s] and the
 * ship's axes (x left, y up, z the nose — unit, in the velocity's frame) → the translation keys' share (tx to the
 * right, ty up, tz forward; −1 … 1), full at `driftFull`, nothing within the dead band. Pure.
 */
export function driftHold(vrel: [number, number, number], ax: [number, number, number][]): { tx: number; ty: number; tz: number } {
  const [X, Y, Z] = ax as [[number, number, number], [number, number, number], [number, number, number]];
  if (Math.hypot(...vrel) < SPACE_ASSIST.driftDead) return { tx: 0, ty: 0, tz: 0 };
  const k = 1 / SPACE_ASSIST.driftFull;
  // (the push against the drift: −vrel; the right is −x)
  return {
    tx: clamp(dot3(vrel, X) * k, -1, 1),
    ty: clamp(-dot3(vrel, Y) * k, -1, 1),
    tz: clamp(-dot3(vrel, Z) * k, -1, 1),
  };
}

/** The translation mode's keys (pure): W S (the pitch) up · down, A D (the yaw) left · right, the throttle keys forward
 *  · back — added to the translation keys; the roll kept; the pitch, the yaw and the throttle taken. */
export function translateKeys(inp: PilotInput): PilotInput {
  const c = (x: number) => Math.min(Math.max(x, -1), 1);
  return { ...inp, tx: c(inp.tx + inp.yaw), ty: c(inp.ty - inp.pitch), tz: c(inp.tz + inp.throttle), pitch: 0, yaw: 0, throttle: 0 };
}

/** ⇧9: the RCS mode switched — the attitude keys turning the craft, or translating it. What to say. */
function rcsModeToggle(this: CameraController): string {
  if (isAircraft(fleet.active)) return t("RCS mode: the spacecraft's");
  this.rcsMode = this.rcsMode === "translate" ? "rotate" : "translate";
  return this.rcsMode === "translate"
    ? t("RCS: translation — W S up · down, A D left · right, ⇧ Alt forward · back")
    : t("RCS: rotation — the attitude keys turn the craft");
}

/** Over a solid ground, how high the craft's gear is [m] (Infinity off one, or near none). */
function groundBelow(c: CameraController): number {
  const nav = c.ourNav(cameraFrame(c.s));
  if (!nav || nav.ref === "sun" || !solidBody(nav.ref)) return Infinity;
  return gearHeight(nav.ref, nav.X, nav.t);
}

/** Back to a stable craft (⇧X, TARS) for a spacecraft: over a ground, a hover at once (its own attitude, the pull
 *  held); else the holds and the autopilots off, the engine cut, the turn stopped — then in orbit, prograde held.
 *  What to say. */
function spaceRecoverStart(this: CameraController): string {
  const P = this.pilot;
  if (this.docked) return t("Recovery: docked — the assembly is held");
  if (this.landed || this.rolling) return t("Recovery: on the ground");
  const V = VESSELS[fleet.active];
  if (V.lands && groundBelow(this) < SPACE_ASSIST.hoverBelow) {
    this.spaceRecover = null;
    if (P.auto !== "hover") P.setAuto("hover");
    return t("Recovery: hovering over the ground");
  }
  if (P.hold !== "none") P.setHold(P.hold);
  if (P.auto !== "none") P.setAuto(P.auto);
  P.throttle = 0;
  this.spaceRecover = { t: 0, still: 0 };
  return t("Recovery: stopping the turn");
}

/**
 * A frame of the levels before the flight computer's step: the SAS law to fly (this.spaceRate), the recovery's turn
 * stopped and its end, the drift held near a craft (the translation keys let go). The F-35: nothing — its own
 * (controller/assistlevel.ts).
 */
function spaceAssistStep(this: CameraController, inp: PilotInput, dt: number) {
  this.spaceDrift = false;

  // (the ring stopped, or another craft flown: its hold let go — the roll back to the stick's own pace)
  if (this.ringRpm != null && (!VESSELS[fleet.active].ring || (this.ringRpm === 0 && Math.abs(this.pilot.omega[2]) < 1e-3)))
    this.ringRpm = null;
  // (the Lander's hover calls — controller/craftpanel.ts)
  this.hoverCallStep();
  // (its systems: consumables, failures, a stuck thruster's push — controller/systems.ts)
  this.systemsStep(inp, dt);
  // (station keeping let go: its held point forgotten — controller/stationkeep.ts)
  if (this.pilot.auto !== "keep") this.keepRun = null;
  if (isAircraft(fleet.active)) {
    this.spaceRate = null;
    this.spaceRecover = null;
    return;
  }
  // (the translation mode: the attitude keys and the throttle's translate the craft)
  if (this.rcsMode === "translate") Object.assign(inp, translateKeys(inp));
  // (the powered landing flying to a point: the stick redesignates it — W S forward · back, A D or the translation
  // keys left · right —, Apollo's landing point designator; the craft's attitude the autopilot's)
  this.lpdIn = null;
  const L = this.landRun;
  if (this.pilot.auto === "land" && L && (L.q || L.site)) {
    const fwd = Math.max(-1, Math.min(1, -inp.pitch + inp.tz));
    const right = Math.max(-1, Math.min(1, inp.yaw + inp.tx));
    if (fwd !== 0 || right !== 0) this.lpdIn = { fwd, right };
    inp.pitch = inp.yaw = inp.tx = inp.tz = 0;
  }
  const level = this.assistLevel() as SpaceAssistLevel;
  let rate = spaceRateLaw(level);
  const P = this.pilot;
  const R = this.spaceRecover;
  if (R) {
    // (the stick taken back — moved hard —, or an autopilot or a hold engaged: the recovery let go)
    if (Math.abs(inp.pitch) > 0.5 || Math.abs(inp.yaw) > 0.5 || Math.abs(inp.roll) > 0.5) {
      this.spaceRecover = null;
      this.onPilotMessage?.(t("Recovery: off — the stick"));
    } else if (P.auto !== "none" || P.hold !== "none") this.spaceRecover = null;
    else {
      inp.pitch = inp.yaw = inp.roll = 0;
      rate = { law: "damped", scale: rate?.scale ?? 1 };
      R.t += dt;
      R.still = Math.hypot(...P.omega) < SPACE_ASSIST.still ? R.still + dt : 0;
      if (R.still > SPACE_ASSIST.stillFor) {
        this.spaceRecover = null;
        // (in orbit — out of the air, far from a craft to dock to —: prograde held; near one, the attitude kept, the
        // drift against it held)
        const near = this.dockGeometry();
        if (!this.airFlight.inAir && !near) {
          P.setHold("prograde");
          this.onPilotMessage?.(t("Recovery: stable — prograde held"));
        } else this.onPilotMessage?.(near ? t("Recovery: stable — the drift held") : t("Recovery: stable — the turn stopped"));
      } else if (R.t > SPACE_ASSIST.giveUp) {
        this.spaceRecover = null;
        this.onPilotMessage?.(t("Recovery: given up — the turn could not be stopped"));
      }
    }
  }
  this.spaceRate = rate;
  // the drift held against a craft near (assisted, beginner, a recovery): the translation keys let go, no autopilot
  const holds = level === "assisted" || level === "beginner" || !!this.spaceRecover;
  if (!holds || P.auto !== "none" || this.docked || inp.tx !== 0 || inp.ty !== 0 || inp.tz !== 0) return;
  const g = this.dockGeometry();
  const range = level === "beginner" ? SPACE_ASSIST.holdRangeBeginner : SPACE_ASSIST.holdRange;
  if (!g || g.range > range) return;
  const h = driftHold(g.vrel as [number, number, number], g.sh as [number, number, number][]);
  inp.tx = h.tx;
  inp.ty = h.ty;
  inp.tz = h.tz;
  this.spaceDrift = h.tx !== 0 || h.ty !== 0 || h.tz !== 0;
}

export function installSpaceAssist(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { spaceAssistStep, spaceRecoverStart, rcsModeToggle });
}
