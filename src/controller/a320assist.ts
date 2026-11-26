// The A320's assistance (docs/PLAN-A320-VOL-AAA.md W1–W2; Sam, 26 Nov 2026: « réel et assisté pour le cockpit … des modes faciles —
// tout doit marcher avec les vrais appareils de l'A320, mais ces fonctions permettent de décoller, régler le pilote auto, l'ILS…
// facilement »). Two things, each through the A320's own controls — the levers, the side stick's input, the gear, the flap lever, the
// FCU's buttons (the FMGC) —, never around them:
// - **the easy take-off** (`a320EasyTakeoff`, the wheel's, any level): lined up — CONF 1+F, the parking brake off, TOGA; at VR the side
//   stick back until 12° of pitch, then let go (the normal law holds the path); positive climb: gear up; 5 s and 400 ft up: AP1 (the
//   A/THR, armed by TOGA, active once the levers are in CL); at 1 500 ft over the field: the levers to CL; the flaps up at S speed.
// - **the assisted level** (`settings.a320Assist === "assisted"`): the same helpers whenever they apply — gear up at a positive climb
//   after a lift-off, the flaps up past their speeds in the climb, the levers to CL at the thrust reduction height after a TOGA/FLX
//   take-off, AP1 once allowed after a take-off, the ground spoilers armed for a landing (gear down), the levers to idle at 20 ft with
//   the autopilot off. `"realistic"`: none of it (the easy take-off still on demand).

import { fleet } from "../fleet";
import { t } from "../i18n";
import type { PilotInput } from "../pilot";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    /** the easy take-off under way (null: none) — its phase */
    a320To: { phase: "roll" | "rotate" | "climb"; liftAt: number | null; field: number } | null;
    /** the assisted level's take-off helpers since the last lift-off: what was done */
    a320Helped: {
      gearUp: boolean;
      cl: boolean;
      ap: boolean;
      flapsUp: boolean;
      liftAt: number | null;
      notchAt?: number;
      drag?: boolean;
    } | null;
    a320EasyTakeoff(): string;
    a320AssistStep(inp: PilotInput, dt: number): void;
  }
}

const KT = 1.943844;
/** the thrust reduction height over the field [ft] (FlightGear's PERF TAKE OFF default) */
const THR_RED_FT = 1500;
/** AP1 once this high over the field [ft] and this long after the lift-off [s] (the FMGC's own rule: 100 ft, 5 s) */
const AP_FT = 400;
const AP_S = 6;

/** The easy take-off: lined up and still on the wheels — set up and begun (its message). */
function a320EasyTakeoff(this: CameraController): string {
  if (fleet.active !== "a320") return t("Easy take-off: the A320's");
  if (this.a320To) {
    this.a320To = null;
    return t("Easy take-off stopped");
  }
  if (!(this.rolling || this.ourLanded)) return t("Easy take-off: on a runway, lined up");
  // (CONF 1+F — the flap lever's first notch —, the parking brake off, TOGA; the A/THR armed by the levers' detent)
  this.airFlight.cfg.flaps = 0.25;
  this.a320Park = false;
  this.gearDown = true;
  this.pilot.throttle = 1;
  this.a320To = { phase: "roll", liftAt: null, field: this.geoNow()?.alt ?? 0 };
  this.a320Helped = { gearUp: false, cl: false, ap: false, flapsUp: false, liftAt: null };
  return t("Easy take-off: CONF 1+F, TOGA — rotation at VR");
}

/** A frame: the easy take-off's and the assisted level's helpers, through the A320's own controls. */
function a320AssistStep(this: CameraController, inp: PilotInput, dt: number) {
  if (fleet.active !== "a320") {
    this.a320To = null;
    return;
  }
  void dt;
  const i = this.a320FmgcIn;
  const F = this.a320Fmgc;
  const onWheels = !!(this.rolling || this.ourLanded);
  const ias = i?.ias ?? Math.sqrt((2 * (this.airFlight.last?.out.q ?? 0)) / 1.225) * KT;
  const ra = i?.ra ?? 0;
  const vsFpm = i?.vs ?? 0;
  const pitchDeg = ((this.attitudeNow().pitch ?? 0) * 180) / Math.PI;
  const now = this.nowTime() * 4.925490947e-6 * this.s.massSolar;
  const assisted = this.s.a320Assist === "assisted";
  const To = this.a320To;
  // the easy take-off's roll and rotation: the side stick back at VR until 12° of pitch, then let go
  if (To) {
    const vr = F?.fms.vr ?? 135;
    if (To.phase === "roll" && ias >= vr) To.phase = "rotate";
    if (To.phase === "rotate") {
      if (pitchDeg < 12) inp.pitch = Math.max(inp.pitch, 0.45);
      if (!onWheels && To.liftAt === null) To.liftAt = now;
      if (To.liftAt !== null && (pitchDeg >= 12 || now - To.liftAt > 4)) To.phase = "climb";
    }
    // (a rejected one: the levers to idle by the pilot — stopped)
    if (onWheels && To.phase === "roll" && this.pilot.throttle < 0.5) this.a320To = null;
  }
  // the take-off helpers: the easy take-off's, or the assisted level's after any lift-off
  const H = (this.a320Helped ??= { gearUp: false, cl: false, ap: false, flapsUp: false, liftAt: null });
  if (onWheels) {
    // (on the wheels again: the next lift-off's helpers fresh)
    if (H.liftAt !== null) Object.assign(H, { gearUp: false, cl: false, ap: false, flapsUp: false, liftAt: null });
    return;
  }
  if (H.liftAt === null) H.liftAt = now;
  if (!To && !assisted) return;
  const tookOff = this.pilot.throttle >= 0.75;
  // (positive climb: gear up)
  if (!H.gearUp && vsFpm > 300 && ra > 30 && this.gearDown) {
    this.gearDown = false;
    H.gearUp = true;
  }
  // (AP1 once the FMGC allows it)
  if (!H.ap && F && !F.ap && ra > AP_FT && now - H.liftAt > AP_S && (To || assisted)) {
    this.a320ApKey("ap");
    H.ap = true;
  }
  // (the thrust reduction: the levers to CL — the A/THR active)
  if (!H.cl && tookOff && ra > THR_RED_FT) {
    this.pilot.throttle = 0.6;
    if (F && !F.athr) this.a320ApKey("athr");
    H.cl = true;
  }
  // (the flaps up past S — ~210 kt at the default mass —, a notch at a time: F then S)
  const lever = Math.round((this.airFlight.cfg.flaps ?? 0) * 4);
  // (the climb's only — the approach's notches come down with the speed: before 26 Nov 2026 the two fought at 220 kt)
  const climbing = !F || F.phase === "takeoff" || F.phase === "climb" || F.phase === "go around";
  if (climbing && lever > 0 && ra > 1000 && ias > (lever >= 2 ? 185 : 210)) this.airFlight.cfg.flaps = (lever - 1) / 4;
  if (lever === 0) H.flapsUp = true;
  if (To && H.gearUp && H.cl && H.flapsUp) this.a320To = null;
  // (the assisted level's approach — W2, 26 Nov 2026: before, only the game's own approach set the A320 up; flown on its plan's
  // published approach with APPR armed it came to the runway clean, gear up): a notch at a time as the speed comes down to each
  // configuration's — 1 under green dot + 10 kt, 2 under S + 10, the gear at the glide's capture or under 2 000 ft, 3 under F + 10
  // with the gear down, FULL under F with the glide captured —, a notch every 4 s at most, as a crew calls them
  if (assisted && F && i && F.phase === "approach" && !onWheels) {
    // (APPR pressed in the approach phase — DECEL passed —, the ILS tuned: LOC and G/S armed, NAV flown on to the localizer)
    if (!F.apprArm && i.ils && F.lat === "NAV" && !F.lat.startsWith("LOC")) F.apprToggle();
    const glide = F.vert === "G/S*" || F.vert === "G/S" || F.vert === "LAND";
    if (this.gearDown === false && (glide || ra < 2000) && lever >= 2) this.gearDown = true;
    // (the autobrake armed with the gear: LO — as the game's own approach arms it)
    if (this.gearDown && this.a320 && !this.a320.autobrake) this.a320.autobrake = 1;
    H.notchAt ??= -1e9;
    if (now - H.notchAt > 4) {
      const want =
        lever === 0 && ias < i.greenDot + 10
          ? 1
          : lever === 1 && ias < i.s + 10
            ? 2
            : lever === 2 && this.gearDown && ias < i.f + 10
              ? 3
              : lever === 3 && glide && ias < i.f
                ? 4
                : lever;
      if (want !== lever) {
        this.airFlight.cfg.flaps = want / 4;
        H.notchAt = now;
      }
    }
  }
  // (the assisted level's speed brakes: out while the managed descent asks for them — MORE DRAG, too fast over its path —, in again
  // once it no longer does, and always with the flaps at 3 or more; the crew's own use of them left alone otherwise)
  if (assisted && F) {
    const want = F.moreDrag && lever < 3 ? 1 : 0;
    if (want) {
      this.airBrake = 1;
      H.drag = true;
    } else if (H.drag) {
      this.airBrake = 0;
      H.drag = false;
    }
  }
  // (the assisted level's landing: the ground spoilers armed with the gear down; idle at 20 ft hand-flown)
  if (assisted && this.gearDown && ra < 2000) this.groundSpoilers = true;
  // (a landing only: the approach phase, the levers under FLX/TOGA, a real sink — at the rotation the radio altimeter reads under 20 ft
  // and the gear's spring a few ft/min down: a take-off flown at the assisted level was put to idle at its lift-off, 26 Nov 2026)
  if (assisted && F && !F.ap && F.phase === "approach" && !tookOff && this.gearDown && ra < 20 && ra > 0 && vsFpm < -100)
    this.pilot.throttle = 0;
}

export function installA320Assist(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { a320EasyTakeoff, a320AssistStep });
}
