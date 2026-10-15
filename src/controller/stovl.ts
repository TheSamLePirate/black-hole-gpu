// The CameraController — the F-35B's STOVL mode (docs/PLAN-F35.md, F4, src/f35/stovl.ts): the conversion (⇧B:
// the lift fan's doors opening, its clutch engaged, the roll posts' doors), the swivelling nozzle — scheduled
// down as the craft slows, then flown by the hover law —, the thrust's direction and its boost, the hover law
// below 65 m/s (the stick a speed over the ground, the throttle a vertical speed, let go: held in place).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import { fleet } from "../fleet";
import { f35Variant } from "../f35/variant";
import { hoverStep, STOVL, thrustDir, type HoverCmd } from "../f35/stovl";
import { t, tf } from "../i18n";
import { unitsFor } from "../ui/unitsys";
import type { PilotInput } from "../pilot";
import { C_MPS } from "../units";
import type { CameraController } from "../controls";

type Vec3 = [number, number, number];

declare module "../controls" {
  interface CameraController {
    stovlToggle: typeof stovlToggle;
    stovlStep: typeof stovlStep;
  }
}

/** The F-35B's STOVL state: the mode asked, the conversion 0…1, the nozzle's swivel 0…1, the lift fan's turn
 *  [rad] and its clutch 0…1, the hover law flying (its held commands), what it said last. */
export interface StovlState {
  on: boolean;
  conv: number;
  swivel: number;
  fan: number;
  clutch: number;
  hover: boolean;
  cmd: HoverCmd | null;
  vz: number;
  heavy: boolean;
  /** a swivel held 0…1 (a short take-off's schedule — controller/deckland.ts): the hover law not engaged meanwhile */
  hold?: number | null;
}
export const noStovl = (): StovlState => ({
  on: false,
  conv: 0,
  swivel: 0,
  fan: 0,
  clutch: 0,
  hover: false,
  cmd: null,
  vz: 0,
  heavy: false,
});

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const toward = (x: number, to: number, rate: number, dt: number) => x + clamp(to - x, -rate * dt, rate * dt);

/** ⇧B: the STOVL mode on or off (below 250 kt — 129 m/s —, the F-35B only). What to say. */
function stovlToggle(this: CameraController): string {
  if (fleet.active !== "f35" || f35Variant() !== "B") return t("STOVL: the F-35B's");
  const S = this.stovl;
  const v = this.airFlight.last?.speed ?? 0;
  if (!S.on && v > STOVL.vConvert) return tf("STOVL: below {0}", unitsFor(this.s).fSpd(STOVL.vConvert));
  S.on = !S.on;
  if (S.on) this.jetModes.ab = false;
  return S.on ? t("STOVL mode: converting — the lift fan engaging") : t("STOVL mode off: conventional flight");
}

/**
 * A frame of the STOVL mode: the conversion, the swivel, the fan; under 65 m/s the hover law flies (the
 * attitude, the throttle and the swivel its own; the stick and the throttle keys its commands — the input
 * given back to the pilot then holds none). The thrust's direction on the ship's axes (none: along the nose).
 */
function stovlStep(
  this: CameraController,
  cam: ReturnType<typeof cameraFrame>,
  inp: PilotInput,
  dt: number,
): { thrustDir: Vec3 | undefined; vtol: { nose: Vec3; up: Vec3; throttle: number } | undefined; inp: PilotInput } {
  const S = this.stovl;
  if (fleet.active !== "f35") {
    if (S.on || S.conv > 0) this.stovl = { ...this.stovl, ...{ on: false, conv: 0, swivel: 0, clutch: 0, hover: false, cmd: null } };
    return { thrustDir: undefined, vtol: undefined, inp };
  }
  const d = clamp(dt, 0, 0.25);
  // (the doors open first, the fan's clutch engages through the conversion's last 40 %)
  S.conv = toward(S.conv, S.on ? 1 : 0, 1 / STOVL.convert, d);
  S.clutch = clamp((S.conv - 0.6) / 0.4, 0, 1);
  // (the lift fan's turn, drawn: its rpm with the engine's)
  S.fan = (S.fan + d * 2 * Math.PI * 4.3 * S.clutch * (0.25 + 0.75 * this.pilot.engineNow)) % (2 * Math.PI * 64);
  const v = this.airFlight.last?.speed ?? 0;
  if (!S.on || S.conv < 0.95 || (S.hold ?? null) !== null) S.hover = false;
  else if (!S.hover && v < STOVL.vHover) S.hover = true;
  else if (S.hover && v > STOVL.vRelease) S.hover = false;
  let swivel = 0;
  let vtol: { nose: Vec3; up: Vec3; throttle: number } | undefined;
  let out = inp;
  if (S.hover) {
    const fr = this.sfFrame(cam);
    if (fr) {
      const north = fr.north,
        east = fr.east,
        up = fr.up;
      if (!S.cmd) {
        const nose = fr.fromLocal(this.shipAxesLocal(cameraFrame(this.s))[2]);
        const hd = [0, 1, 2].map((k) => nose[k]! - up[k]! * (nose[0] * up[0] + nose[1] * up[1] + nose[2] * up[2])) as Vec3;
        const heading = Math.atan2(
          hd[0] * east[0] + hd[1] * east[1] + hd[2] * east[2],
          hd[0] * north[0] + hd[1] * north[1] + hd[2] * north[2],
        );
        const hl = Math.hypot(...hd) || 1;
        S.cmd = { fwd: (fr.vRel[0] * hd[0] + fr.vRel[1] * hd[1] + fr.vRel[2] * hd[2]) / hl, side: 0, heading };
      }
      // (a deck's recovery flying: its velocity over the ground and its heading — controller/deckland.ts)
      const dk = this.deckHover(inp);
      if (dk) {
        S.cmd.want = dk.want;
        S.cmd.heading = dk.heading;
      } else if (S.cmd.want) {
        S.cmd.want = undefined;
        S.cmd.fwd = 0;
        S.cmd.side = 0;
      }
      const mass = fleet.massProps().mass;
      const toMs2 = C_MPS ** 2 / (1476.625 * this.s.massSolar);
      const o = hoverStep(
        {
          dt: d,
          pitch: inp.pitch,
          roll: inp.roll,
          throttle: inp.throttle,
          yaw: inp.yaw,
          v: fr.vRel,
          grav: fr.grav,
          air: fr.air,
          up,
          north,
          east,
          h: fr.h,
          onGround: !!this.rolling || !!this.ourLanded,
          mass,
          thrustMax: this.thrustMax() * toMs2 * mass * this.jetThrust(),
        },
        S.cmd,
      );
      swivel = o.swivel;
      S.vz = o.vz;
      S.heavy = o.heavy;
      vtol = { nose: fr.toLocal(o.nose), up: fr.toLocal(o.up), throttle: o.throttle };
      out = { ...inp, pitch: 0, roll: 0, yaw: 0, throttle: 0 };
    }
  } else {
    S.cmd = null;
    // (converted, flying conventionally: the nozzle partly down as it slows — the semi-jet-borne transition; a short
    // take-off's own schedule held)
    if (S.on) swivel = (S.hold ?? clamp((105 - v) / 50, 0, 0.7)) * S.conv;
  }
  // (the nozzle's bearings turn at their own rate: 95° in some 2.5 s)
  S.swivel = toward(S.swivel, swivel, 0.4, d);
  const dir = S.conv > 0 || S.swivel > 0 ? thrustDir(S.swivel, S.clutch) : undefined;
  return { thrustDir: dir, vtol, inp: out };
}

export function installStovl(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { stovlToggle, stovlStep });
}
