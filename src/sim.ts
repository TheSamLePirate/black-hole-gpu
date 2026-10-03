// The simulation's step, one for everything that moves the scene: the live loop, the automation
// (__bh.step) and the video (renderdialog.ts) run the same code, so a video plays what the live view
// would have — the camera's modes, the ship and its autopilots, the mission, the cinematics, the clock.
//
// Two clocks: the scene's time [M] (the bodies, the disk, the ship's flight: the time warp scales it)
// and the playback clock [s] (seconds of running time: the flames' flicker, the liquid throat's
// waves). Paused, neither moves: nothing the time drives changes and the image converges at once.

import type { CameraController } from "./controls";
import type { Renderer } from "./renderer";
import type { Settings } from "./settings";
import { warpFactor } from "./clock";
import { setSceneTime } from "./wormhole";

/** The flight figures the renderer takes from (controls.ts flightInfo): the re-entry glow. */
type FlightInfo = {
  surface?: { plasma?: { flow: [number, number, number]; level: number } | null; air?: number } | null;
  air?: {
    u: [number, number, number] | null;
    heat: number;
    shield: number;
    hull: number;
    mach: number;
    rho: number;
    glow: [number, number, number] | null;
    inAir: boolean;
    q: number;
    speed: number;
    rolling?: boolean;
  } | null;
} | null;

export class Simulation {
  /** the scene's time [M] */
  time = 0;
  /** the playback clock: seconds of running time [s] */
  play = 0;
  /** the scene's time moved since the last rendered frame */
  timeDirty = false;
  /** the mission (mission.ts), stepped with the camera */
  mission: { update(dt: number): void } | null = null;
  private firedAt = -1e9;
  private lastFired = 0;

  constructor(
    private s: Settings,
    private camera: CameraController,
    private renderer: Renderer,
  ) {}

  /** Sets the scene's time (a preset, a saved game, a date). */
  setTime(t: number) {
    this.time = t;
    this.timeDirty = true;
    setSceneTime(t);
  }

  /**
   * One step of dt seconds: the camera and the ship (their inputs, modes, cinematics), the mission, then
   * the clocks when time runs. Returns true when the camera moved.
   */
  step(dt: number): boolean {
    const s = this.s;
    setSceneTime(this.time); // (an orbiting wormhole mouth: where it is now)
    const moved = this.camera.update(dt, this.time);
    this.mission?.update(dt);
    if (s.animate && s.timeSpeed > 0) {
      this.time = this.camera.shipClock() ?? this.time + dt * s.timeSpeed;
      this.play += dt;
      this.timeDirty = true;
      // the liquid throat's waves: at their own pace while time runs (slower in slow motion)
      if (s.cinematic && s.wormhole && s.waterSpeed > 0) this.renderer.water.clock += dt * s.waterSpeed * Math.min(1, warpFactor(s));
    }
    const f = this.camera.pilot.fired;
    if (f.at !== this.lastFired) {
      this.lastFired = f.at;
      this.firedAt = this.play;
    }
    return moved;
  }

  /**
   * What the renderer draws of the flight, from the simulation's state: the ship where the camera is on
   * it, its flames (what the flight computer fired last) and re-entry glow, the predicted path. Paused,
   * the flames and the glow hold as they were. Returns true when the traced image must be redone.
   */
  applyRender(info: FlightInfo): boolean {
    const s = this.s,
      r = this.renderer,
      c = this.camera;
    let changed = false;
    const path = c.gravity ? c.predictPath() : null;
    if (r.setCameraPath(s.showGeodesic && s.pathInView ? path : null)) changed = true;
    r.shipPose = s.ship ? c.shipPose() : null;
    const flying = c.piloting && !c.cinematic;
    if (!flying) {
      if (r.shipThrust) changed = true;
      r.shipThrust = null;
      r.shipReentry = null;
      r.shipContrails = null;
      r.shake = [0, 0];
      return changed;
    }
    // the air's buffeting: the camera shakes with the dynamic pressure, the plasma, through Mach 1 and
    // on the wheels (not from the outside views' distance)
    const A = info?.air;
    const near = ["cockpit", "cabin", "dorsal", "belly", "rear", "wing", "chase", "quarter"].includes(this.s.shipMount);
    let amp = 0;
    if (A?.inAir && near) {
      const lev = Math.min(Math.max((Math.log10(Math.max(A.heat, 1)) - 4.6) / 1.7, 0), 1);
      amp = 0.0018 * Math.min(A.q / 30000, 1) + 0.0025 * lev + 0.002 * Math.max(0, 1 - Math.abs(A.mach - 1) / 0.15) * Math.min(A.rho, 1);
      if (A.rolling) amp += 0.0008 * Math.min(A.speed / 120, 1);
      if (this.s.shipMount === "cockpit" || this.s.shipMount === "cabin") amp *= 1.6;
    }
    const tt = this.play;
    r.shake =
      amp > 0
        ? [
            amp * (Math.sin(tt * 71.3) * 0.6 + Math.sin(tt * 43.1 + 1.3) * 0.4),
            amp * (Math.sin(tt * 59.7 + 0.7) * 0.6 + Math.sin(tt * 37.9 + 2.1) * 0.4),
          ]
        : [0, 0];
    // the re-entry's look: the plasma, the hot skin (cooling after, out of the air)
    r.shipReentry =
      A && (A.u || A.shield > 700 || A.hull > 700)
        ? {
            u: A.u ?? [0, 0, 1],
            heat: A.u ? A.heat : 0,
            shield: A.shield,
            hull: A.hull,
            mach: A.mach,
            rho: A.rho,
            glow: A.glow ?? [1, 0.45, 0.32],
            time: this.play,
          }
        : null;
    // the condensation trails (kept in the air: paused, as they were)
    r.shipContrails = c.contrailsFrame();
    if (!s.animate) return changed;
    const pl = info?.surface?.plasma;
    r.shipPlasma = pl && pl.level > 0 ? [...pl.flow, pl.level] : [0, 0, 1, 0];
    const fired = c.pilot.fired;
    const firing = this.play - this.firedAt < 0.3 && (fired.throttle > 0.01 || fired.rcs > 0.03 || fired.turn > 0.05);
    const was = r.shipThrust !== null;
    r.shipThrust = firing
      ? {
          throttle: fired.throttle,
          force: fired.force,
          torque: fired.torque,
          air: Math.min((info?.surface?.air ?? 0) / 1.225, 1),
          time: this.play,
        }
      : null;
    if (firing || was) changed = true;
    return changed;
  }
}
