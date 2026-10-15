// The CameraController — the aerobatic figures (game/aerobatics.ts): one flown by its program before the player
// (the demonstration: the stick, the throttle, the afterburner, the law the program's), or flown by the player and
// followed by the same program's milestones, judged at its end. The craft read in a local frame fixed at the
// figure's start (east, north, up), its axes there.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import {
  type AeroState,
  FIGURES,
  type FigureId,
  type FigureMarks,
  figureStep,
  gammaOf,
  judgeFigure,
  newMem,
  type PilotMem,
} from "../game/aerobatics";
import { cameraFrame } from "../camera";
import { t, tf } from "../i18n";
import type { PilotInput } from "../pilot";
import { fleet } from "../fleet";
import { VESSELS } from "../vessels";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    aeroState: typeof aeroState;
    aeroStart: typeof aeroStart;
    aeroStep: typeof aeroStep;
    aeroStop: typeof aeroStop;
  }
}

type V3 = [number, number, number];

/** A figure flown: its program's memory, its trace, its result. */
export interface AeroRun {
  id: FigureId;
  /** demo: the program flies it; judge: the player does, followed */
  mode: "demo" | "judge";
  mem: PilotMem;
  /** the local frame: its origin (Earth-fixed [m]) and axes (east, north, up) */
  o: V3;
  E: V3;
  N: V3;
  U: V3;
  /** waiting for the entry (the player's), flying, done */
  status: "armed" | "fly" | "done";
  t: number;
  tr: AeroState[];
  result: FigureMarks | null;
  /** what to say this frame (the cues, the result) */
  say: string | null;
  /** the law before the figure (a demonstration's spin sets the direct one, put back after) */
  law0: "normal" | "direct";
  /** the place in the air's frame [m] (the air's own motion through the figure integrated) */
  pa: V3;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The craft as a figure reads it (null: not flying in the Earth's air). `run` gives its local frame. */
function aeroState(this: CameraController, run: Pick<AeroRun, "o" | "E" | "N" | "U" | "t" | "pa">): AeroState | null {
  const o = this.netOwn();
  const L = this.airFlight.last;
  if (!o || !L || !this.airFlight.inAir) return null;
  const loc = (w: V3): V3 => [dot(w, run.E), dot(w, run.N), dot(w, run.U)];
  const rel: V3 = [o.p[0] - run.o[0], o.p[1] - run.o[1], o.p[2] - run.o[2]];
  const fbw = VESSELS[fleet.active].fbw;
  const w = this.pilot.omega;
  return {
    t: run.t,
    p: loc(rel),
    v: loc(o.v as V3),
    pa: [...run.pa],
    fwd: loc(o.fwd as V3),
    up: loc(o.up as V3),
    right: loc(o.right as V3),
    V: L.speed,
    alpha: L.out.alpha,
    nz: L.out.F[1] / (fleet.massProps().mass * 9.80665),
    agl: this.sfFrame(cameraFrame(this.s))?.h ?? L.h,
    // (the controller's rates: x pitch up, y yaw right, z roll left)
    p_: -w[2],
    q: w[0],
    r: w[1],
    gMax: fleet.active === "f35" ? (this.gearDown ? Math.min(4, this.s.f35GLimit) : this.s.f35GLimit) : (fbw?.gMax ?? 5),
    gMin: fbw?.gMin ?? -2,
  };
}

/** A figure begun: flown by its program (demo), or armed for the player — judged once its entry is met. */
function aeroStart(this: CameraController, id: FigureId, mode: "demo" | "judge"): string {
  const o = this.netOwn();
  if (!o || !this.airFlight.inAir || fleet.active !== "f35") return t("The figures: in the F-35, in the air");
  const U = unit(o.p as V3);
  const E = unit(cross([0, 0, 1], U));
  const N = cross(U, E);
  this.aero = {
    id,
    mode,
    mem: newMem(),
    o: o.p as V3,
    E,
    N,
    U,
    status: mode === "demo" ? "fly" : "armed",
    t: 0,
    tr: [],
    result: null,
    say: null,
    law0: this.s.f35Law,
    pa: [0, 0, 0],
  };
  // (the jet's holds and the computer's autopilot off: the program's stick, or the player's)
  this.jetModes = { alt: null, hdg: null, spd: null, ab: false };
  if (this.pilot.auto !== "none") this.pilot.setAuto(this.pilot.auto);
  const F = FIGURES[id];
  this.aero.say =
    mode === "demo"
      ? tf("{0} — watch: {1}", t(F.name), t(F.cues[0]!))
      : tf("{0} — entry: {1} m/s ±{2}, {3} m over the ground; {4}", t(F.name), F.entry.v, F.entry.vTol, F.entry.agl, t(F.cues[0]!));
  return this.aero.say;
}

/** The figure let go (said when `why`), the law put back. */
function aeroStop(this: CameraController, why?: string) {
  const A = this.aero;
  if (!A) return;
  this.s.f35Law = A.law0;
  this.aero = null;
  if (why) this.onPilotMessage?.(why);
}

/**
 * A frame of the figure, with the pilot's input `inp` (its stick replaced in a demonstration): its state traced,
 * its program stepped — flown, or followed —, its end judged.
 */
function aeroStep(this: CameraController, inp: PilotInput, dt: number) {
  const A = this.aero;
  if (!A || A.status === "done" || !(dt > 0)) return;
  A.t += dt;
  const s = this.aeroState(A);
  if (!s) return this.aeroStop(t("Figure abandoned — not in the air"));
  const F = FIGURES[A.id];
  if (A.status === "armed") {
    // (the player's entry: the speed in its window, high enough, the wings and the path level)
    const okV = Math.abs(s.V - F.entry.v) <= F.entry.vTol;
    const okLevel = Math.abs(s.right[2]) < 0.17 && s.up[2] > 0.9 && Math.abs(gammaOf(s)) < 0.17;
    if (!(okV && s.agl >= F.entry.agl && okLevel)) return;
    if (F.entry.law !== this.s.f35Law) {
      if (A.t > 0.5 && !A.say) A.say = F.entry.law === "direct" ? t("This figure: in the direct law") : t("This figure: on the F-35's law");
      return;
    }
    // (begun: the frame and the clock from here)
    const o = this.netOwn()!;
    A.o = o.p as V3;
    A.t = 0;
    A.pa = [0, 0, 0];
    A.status = "fly";
    A.say = tf("{0} — go: {1}", t(F.name), t(F.cues[0]!));
    return;
  }
  // (the air's frame: the motion through the air — the craft's axes times its air's direction — integrated)
  const L = this.airFlight.last!;
  const u = L.u;
  for (let k = 0; k < 3; k++) A.pa[k]! += (-u[0] * s.right[k]! + u[1] * s.up[k]! + u[2] * s.fwd[k]!) * L.speed * dt;
  A.tr.push(s);
  const phase = A.mem.phase;
  const cmd = figureStep(A.id, s, A.mem);
  s.phase = phase;
  if (A.mem.phase !== phase && F.cues[A.mem.phase]) A.say = t(F.cues[A.mem.phase]!);
  if (A.mode === "demo" && cmd) {
    inp.pitch = cmd.pitch;
    inp.roll = cmd.roll;
    inp.yaw = cmd.yaw;
    inp.throttle = 0;
    this.pilot.throttle = cmd.throttle;
    this.jetModes.ab = cmd.ab;
    if (cmd.ab) this.pilot.throttle = 1;
    if (cmd.law) this.s.f35Law = cmd.law;
    this.airBrake = cmd.brake ?? 0;
  }
  const lapsed = A.t > 2.5 * F.par;
  if (cmd && !lapsed) return;
  // (flown — or lapsed —: judged)
  A.status = "done";
  this.s.f35Law = A.law0;
  if (A.mode === "demo") {
    this.jetModes.ab = false;
    this.airBrake = 0;
  }
  A.result = lapsed ? null : judgeFigure(A.id, A.tr);
  A.say = A.result
    ? tf(
        "{0}: {1}/20{2}",
        t(F.name),
        A.result.score.toFixed(1),
        A.result.notes.length ? ` — ${A.result.notes.map((n) => t(n)).join(" · ")}` : "",
      )
    : tf("{0}: lapsed — too long", t(F.name));
}

export function installAerobatics(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { aeroState, aeroStart, aeroStep, aeroStop });
}
