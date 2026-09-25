import {
  basis, blToCartesian, cameraFrame, repPose, repToHolePose, setHolePose, setRepPose, switchAnchor, yawPitchRoll,
} from "./camera";
import { horizon, type Vec3 } from "./physics";
import type { Settings } from "./settings";
import { advance, fromZamo, predict, toZamo } from "./geodesic";
import { flyDneg, holeToRep, mouth, radius, repToHole, sphericalFrame, toMouth } from "./wormhole";

type Cinematic = "orbit" | "dive" | "journey" | null;
type PoseKeys = "anchor" | "whL" | "distance" | "inclination" | "azimuth" | "yaw" | "pitch" | "roll";
const POSE_KEYS: PoseKeys[] = ["anchor", "whL", "distance", "inclination", "azimuth", "yaw", "pitch", "roll"];

/**
 * Free-flight keys, by physical position (KeyboardEvent.code) so that they are Z Q S D / A E / W X on
 * a French AZERTY keyboard and W A S D / Q E / Z X on QWERTY. They are reserved for flight: no other
 * shortcut uses them.
 */
export const FLIGHT_KEYS: Record<string, [number, number, number, number]> = {
  // [forward, right, up, roll]
  KeyW: [1, 0, 0, 0], // Z (AZERTY): forward
  KeyS: [-1, 0, 0, 0], // S: backward
  KeyA: [0, -1, 0, 0], // Q (AZERTY): left
  KeyD: [0, 1, 0, 0], // D: right
  KeyE: [0, 0, 1, 0], // E: up
  KeyQ: [0, 0, -1, 0], // A (AZERTY): down
  KeyZ: [0, 0, 0, 1], // W (AZERTY): roll left
  KeyX: [0, 0, 0, -1], // X: roll right
};

/**
 * Camera interaction: orbit / look with momentum, smooth logarithmic zoom, pinch zoom,
 * keyboard, and two cinematic modes:
 *  - orbit: the observer circles the hole (azimuth drift)
 *  - dive: exact free fall from rest at infinity (E = 1, L = Q = 0) integrated in proper time,
 *          seen from the infalling ("rain") frame; ends just outside the horizon.
 *  - journey: through Interstellar's wormhole, from our side to the black hole (or back).
 * Free flight with six degrees of freedom (FLIGHT_KEYS: translations along the camera's axes and roll;
 * right-drag turns the camera about its own axes, without limit) follows straight lines: spatial
 * geodesics of the wormhole metric near it (so it can cross the throat), flat lines near the hole.
 */
export class CameraController {
  cinematic: Cinematic = null;
  /** Input is ignored while disabled (e.g. during an offline render). */
  enabled = true;
  private vAz = 0; // °/s
  private vInc = 0;
  private vYaw = 0;
  private vPitch = 0;
  private targetDistance: number;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragLook = false;
  private lastMove = 0;
  private pinchDist = 0;
  private keys = new Set<string>();
  private codes = new Set<string>();
  private diveSaved: Partial<Settings> | null = null;
  private diveHold = 0;
  private targetL: number;
  /** Game-style flight: pointer locked, the mouse turns the camera, the wheel sets the speed. */
  flyMode = false;
  /** Speed multiplier of free flight (wheel in fly mode). */
  flySpeed = 1;
  /** Gravity: the camera is a massive body following Kerr geodesics; the flight keys thrust. */
  gravity = false;
  /** Current flight velocity in the camera's axes (forward, right, up), in units of the distance scale per second. */
  private flyVel: Vec3 = [0, 0, 0];
  /** Last free-fall prediction for the overlay. */
  path: { pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "wormhole"; at: number } | null = null;
  private pathKey = "";
  /** Proper time elapsed on the camera's clock while gravity is on [M]. */
  properTime = 0;
  private journey: { t: number; dir: "out" | "back"; start: Pick<Settings, PoseKeys> } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private s: Settings,
    private onCinematicChange: (mode: Cinematic) => void,
  ) {
    this.targetDistance = s.distance;
    this.targetL = s.whL;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("dblclick", () => this.resetView());
    document.addEventListener("pointerlockchange", () => {
      this.flyMode = document.pointerLockElement === canvas;
      this.onCinematicChange(this.cinematic);
    });
    // fly mode: the mouse turns the camera like in a game (right = turn right, up = look up)
    document.addEventListener("mousemove", (e) => {
      if (!this.flyMode || !this.enabled) return;
      const k = 0.12 * Math.min(1, this.s.fov / 60);
      this.rotateView(e.movementX * k, -e.movementY * k, 0);
    });
    addEventListener("keydown", (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.metaKey || e.ctrlKey) return;
      this.keys.add(e.key);
      this.codes.add(e.code);
    });
    addEventListener("keyup", (e: KeyboardEvent) => {
      this.keys.delete(e.key);
      this.codes.delete(e.code);
    });
    addEventListener("blur", () => {
      this.keys.clear();
      this.codes.clear();
    });
  }

  /** Call after the distance was changed from elsewhere (GUI, preset). */
  sync() {
    this.targetDistance = this.s.distance;
    this.targetL = this.s.whL;
    this.vAz = this.vInc = this.vYaw = this.vPitch = 0;
  }

  /** The camera orbits the wormhole (its distance is ℓ) rather than the hole. */
  private get aroundWormhole() {
    return this.s.wormhole && this.s.anchor === "wormhole";
  }

  resetView() {
    this.s.yaw = 0;
    this.s.pitch = 0;
    this.s.roll = 0;
    this.vYaw = this.vPitch = 0;
  }

  /**
   * Turns the camera about its own axes (degrees): towards its right, towards its up, and a roll
   * (positive: counter-clockwise). No gimbal limit: looping over the top works.
   */
  rotateView(dRight: number, dUp: number, dRoll: number) {
    const s = this.s;
    const b = basis(s.yaw, s.pitch, s.roll);
    const rot = (a: Vec3, c: Vec3, deg: number): [Vec3, Vec3] => {
      const k = deg * DEG;
      return [lin(a, Math.cos(k), c, Math.sin(k)), lin(c, Math.cos(k), a, -Math.sin(k))];
    };
    let [f, r] = rot(b.fwd, b.right, dRight);
    let u: Vec3;
    [f, u] = rot(f, b.up, dUp);
    [r, u] = rot(r, u, dRoll);
    const e = yawPitchRoll(f, u);
    s.yaw = e.yaw;
    s.pitch = e.pitch;
    s.roll = e.roll;
  }

  setCinematic(mode: Cinematic) {
    if (this.cinematic === "dive" && mode !== "dive") this.endDive();
    if (mode !== "journey") this.journey = null;
    if (mode === "dive" && this.aroundWormhole && !switchAnchor(this.s, "hole")) mode = null;
    if (mode === "journey") this.startJourney();
    this.cinematic = mode;
    if (mode === "dive") {
      const s = this.s;
      this.diveSaved = { distance: s.distance, motion: s.motion, azimuth: s.azimuth, yaw: s.yaw, pitch: s.pitch, roll: s.roll };
      s.motion = "infall";
      s.yaw = s.pitch = s.roll = 0;
      this.diveHold = 0;
    }
    this.onCinematicChange(mode);
  }

  private endDive() {
    if (this.diveSaved) Object.assign(this.s, this.diveSaved);
    this.diveSaved = null;
    this.sync();
  }

  /** Enters/leaves game-style flight (pointer lock; Esc also leaves). */
  setFlyMode(on: boolean) {
    if (on && document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.();
    if (!on && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Gravity on: from now on the camera falls freely (starting at rest w.r.t. the local static observer). */
  setGravity(on: boolean) {
    const s = this.s;
    this.gravity = on;
    this.path = null;
    if (on) {
      if (this.cinematic) this.setCinematic(null);
      s.animate = true;
      s.motion = "geodesic";
      s.velR = s.velT = s.velP = 0;
      this.properTime = 0;
    } else if (s.motion === "geodesic") {
      s.motion = "static";
      s.velR = s.velT = s.velP = 0;
    }
    this.onCinematicChange(this.cinematic);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled || this.flyMode) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragLook = e.button === 2 || e.shiftKey;
    this.vAz = this.vInc = this.vYaw = this.vPitch = 0;
    if (this.pointers.size === 2) this.pinchDist = this.pinchSpan();
    if (this.cinematic === "orbit") this.setCinematic(null);
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    // released after a pause: no fling
    if (performance.now() - this.lastMove > 80) this.vAz = this.vInc = this.vYaw = this.vPitch = 0;
  };

  private pinchSpan() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const now = performance.now();
    const dtEv = Math.max(16, now - this.lastMove) / 1000;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.lastMove = now;

    if (this.pointers.size === 2) {
      const span = this.pinchSpan();
      if (this.pinchDist > 0 && span > 0) this.zoomBy(this.pinchDist / span);
      this.pinchDist = span;
      return;
    }
    const s = this.s;
    // fling velocity: smoothed and capped (°/s)
    const smooth = (v: number, inst: number) => clamp(0.5 * inst + 0.5 * v, -120, 120);
    if (this.dragLook) {
      const k = s.fov / this.canvas.clientHeight; // degrees per CSS pixel
      this.rotateView(-dx * k, dy * k, 0);
      this.vYaw = smooth(this.vYaw, (-dx * k) / dtEv);
      this.vPitch = smooth(this.vPitch, (dy * k) / dtEv);
    } else {
      const k = 0.25 * Math.min(1, s.fov / 45);
      s.azimuth = wrapDeg(s.azimuth - dx * k);
      s.inclination = clamp(s.inclination - dy * k, 0.2, 179.8);
      this.vAz = smooth(this.vAz, (-dx * k) / dtEv);
      this.vInc = smooth(this.vInc, (-dy * k) / dtEv);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!this.enabled) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (this.flyMode) {
      // flight speed, like a game's throttle
      this.flySpeed = clamp(this.flySpeed * Math.exp(-dy * 0.002), 0.05, 30);
      return;
    }
    if (e.altKey) {
      this.s.fov = clamp(this.s.fov * Math.exp(dy * 0.001), 1, 150);
    } else {
      this.zoomBy(Math.exp(dy * 0.0015));
    }
  };

  private zoomBy(f: number) {
    if (this.cinematic === "dive" || this.cinematic === "journey") return;
    if (this.aroundWormhole) {
      // distance to the throat |ℓ| (never through it: fly to cross)
      const lMin = this.lMin();
      const sign = this.targetL < 0 ? -1 : 1;
      this.targetL = sign * clamp(lMin + (Math.abs(this.targetL) - lMin) * f, lMin, 2000);
      return;
    }
    const rMin = horizon(this.s.spin) + 0.05;
    this.targetDistance = clamp(rMin + (this.targetDistance - rMin) * f, rMin, 1000);
  }

  /** Advances momentum, keyboard and cinematics. Returns true when the camera changed. */
  update(dt: number): boolean {
    if (!this.enabled) return false;
    const s = this.s;
    const before = [s.azimuth, s.inclination, s.yaw, s.pitch, s.roll, s.distance, s.fov, s.whL, s.anchor].join();
    const dragging = this.pointers.size > 0;

    // keyboard (held keys)
    const kRate = 60 * dt;
    if (this.flyMode) {
      // arrows turn the camera in flight
      const kx = (this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("ArrowLeft") ? 1 : 0);
      const ky = (this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("ArrowDown") ? 1 : 0);
      if (kx || ky) this.rotateView(kx * kRate, ky * kRate, 0);
    } else {
      if (this.keys.has("ArrowLeft")) s.azimuth = wrapDeg(s.azimuth + kRate);
      if (this.keys.has("ArrowRight")) s.azimuth = wrapDeg(s.azimuth - kRate);
      if (this.keys.has("ArrowUp")) s.inclination = clamp(s.inclination - kRate, 0.2, 179.8);
      if (this.keys.has("ArrowDown")) s.inclination = clamp(s.inclination + kRate, 0.2, 179.8);
    }
    if (this.keys.has("+") || this.keys.has("=")) this.zoomBy(Math.exp(-1.2 * dt));
    if (this.keys.has("-") || this.keys.has("_")) this.zoomBy(Math.exp(1.2 * dt));
    const move: [number, number, number, number] = [0, 0, 0, 0];
    for (const c of this.codes) {
      const m = FLIGHT_KEYS[c];
      if (m) for (let i = 0; i < 4; i++) move[i]! += m[i]!;
    }
    const fast = this.codes.has("ShiftLeft") || this.codes.has("ShiftRight");
    const free = this.cinematic !== "dive" && this.cinematic !== "journey";
    if (move.some((x) => x !== 0) && this.cinematic === "orbit") this.setCinematic(null);
    if (move[3] && free) this.rotateView(0, 0, move[3] * 70 * dt);
    if (this.gravity && free) {
      // free fall along the Kerr geodesic in step with the scene's time; the keys thrust
      const simDt = s.animate ? s.timeSpeed * dt : 0;
      if (simDt > 0) this.fall(simDt, [move[0], move[1], move[2]], fast);
      this.flyVel = [0, 0, 0];
    } else if (free) {
      // kinematic flight with inertia: the velocity eases towards the keys' target (~0.12 s)
      const target = (fast ? 3 : 0.8) * this.flySpeed;
      const ease = 1 - Math.exp(-dt / 0.12);
      for (let i = 0; i < 3; i++) this.flyVel[i]! += (move[i]! * target - this.flyVel[i]!) * ease;
      if (Math.hypot(...this.flyVel) > 1e-3 * this.flySpeed) this.fly(this.flyVel, dt);
      else this.flyVel = [0, 0, 0];
    }

    // momentum (exponential damping)
    if (!dragging) {
      const damp = Math.exp(-4 * dt);
      s.azimuth = wrapDeg(s.azimuth + this.vAz * dt);
      s.inclination = clamp(s.inclination + this.vInc * dt, 0.2, 179.8);
      if (this.vYaw || this.vPitch) this.rotateView(this.vYaw * dt, this.vPitch * dt, 0);
      this.vAz *= damp;
      this.vInc *= damp;
      this.vYaw *= damp;
      this.vPitch *= damp;
      for (const k of ["vAz", "vInc", "vYaw", "vPitch"] as const) if (Math.abs(this[k]) < 0.05) this[k] = 0;
    }

    if (this.cinematic === "orbit") {
      s.azimuth = wrapDeg(s.azimuth + s.cinematicSpeed * dt);
    } else if (this.cinematic === "dive") {
      this.stepDive(dt);
    } else if (this.cinematic === "journey") {
      this.stepJourney(dt);
    } else if (this.aroundWormhole) {
      // smooth zoom towards the target |ℓ| (in log space), on the camera's side of the throat
      if (Math.sign(this.targetL) !== Math.sign(s.whL)) this.targetL = s.whL;
      if (Math.abs(this.targetL - s.whL) < 1e-9) return this.changedSince(before); // (also inside the throat)
      const lMin = this.lMin();
      const sign = s.whL < 0 ? -1 : 1;
      const cur = Math.log(Math.max(Math.abs(s.whL) - lMin, 0) + 1e-3);
      const tgt = Math.log(Math.max(Math.abs(this.targetL) - lMin, 0) + 1e-3);
      const next = cur + (tgt - cur) * (1 - Math.exp(-10 * dt));
      const l = Math.abs(tgt - cur) < 1e-4 ? this.targetL : sign * (lMin + Math.exp(next) - 1e-3);
      if (this.poseAllowed({ ...s, whL: l })) s.whL = l;
      else this.targetL = s.whL;
    } else {
      // smooth zoom towards the target distance (in log space)
      const rMin = horizon(s.spin) + 0.05;
      if (s.distance < rMin) s.distance = rMin;
      const cur = Math.log(s.distance - rMin + 1e-3);
      const tgt = Math.log(Math.max(this.targetDistance, rMin) - rMin + 1e-3);
      const next = cur + (tgt - cur) * (1 - Math.exp(-10 * dt));
      s.distance = Math.abs(tgt - cur) < 1e-4 ? this.targetDistance : rMin + Math.exp(next) - 1e-3;
    }
    return this.changedSince(before);
  }

  private changedSince(before: string) {
    const s = this.s;
    return before !== [s.azimuth, s.inclination, s.yaw, s.pitch, s.roll, s.distance, s.fov, s.whL, s.anchor].join();
  }

  /** Closest approach of the wheel zoom to the throat. */
  private lMin() {
    const w = mouth(this.s).w;
    return w.a + 0.3 * w.rho;
  }

  /** A pose is allowed unless it puts the camera inside the hole's horizon region. */
  private poseAllowed(s: Settings) {
    const cam = cameraFrame(s);
    return cam.region === "throat" || cam.r > horizon(s.spin) + 0.3;
  }

  // ------------------------------------------------------------------------------ free flight
  /**
   * Moves the camera along a direction given in its own axes (forward, right, up) at a speed
   * proportional to the distance to the nearest object, keeping its orientation (parallel transport).
   * Near the wormhole: a spatial geodesic of the Dneg metric (it can cross the throat); near the hole:
   * a straight line. The camera re-anchors to the nearest object.
   */
  private fly(local: Vec3, dt: number) {
    const s = this.s;
    const rH = horizon(s.spin);
    const n = Math.hypot(...local);
    const k = n * dt;
    const c: Vec3 = [local[0] / n, local[1] / n, local[2] / n];
    /** Camera axes in the flat frame of the hole (hole region). */
    const holeAxes = () => {
      const cam = cameraFrame(s);
      const X = blToCartesian(cam.r, cam.theta, cam.phi);
      const f = sphericalFrame(X);
      const w = (v: Vec3) => add3(f.er, f.et, f.ep, v);
      const fw = w(cam.fwd), rt = w(cam.right), up = w(cam.up);
      return { X, r: cam.r, fw, up, d: lin(lin(fw, c[0], rt, c[1]), 1, up, c[2]) };
    };
    if (!s.wormhole) {
      const h = holeAxes();
      const Y = axpy(h.X, h.d, k * Math.min(h.r - rH, 100));
      if (Math.hypot(...Y) < rH + 0.3 || Math.hypot(...Y) > MAX_RANGE) return;
      setHolePose(s, Y, h.fw, h.up);
      s.anchor = "hole";
      this.sync();
      return;
    }
    const m = mouth(s);
    const p = repPose(s);
    const rw = radius(m.w, p.l)[0];
    const toHole = p.l > 0 ? Math.hypot(...repToHole(m, p.l, p.n)) : Infinity;
    const ds = k * Math.min(Math.max(Math.min(rw - 0.5 * m.w.rho, toHole - rH), 0.2 * m.w.rho), 100);
    const nearMouth = p.l <= 0 || rw < toHole;
    if (nearMouth) {
      const right = cross(p.fwd, p.up);
      const d = normalize(lin(lin(p.fwd, c[0], right, c[1]), 1, p.up, c[2]));
      const q = flyDneg(m.w, p.l, p.n, d, [p.fwd, p.up], ds);
      const pose = { l: q.l, n: q.n, fwd: q.vectors[0]!, up: q.vectors[1]! };
      if (radius(m.w, pose.l)[0] > MAX_RANGE) return;
      if (pose.l > 0) {
        const h = repToHolePose(s, pose);
        const dHole = Math.hypot(...h.X);
        if (dHole < rH + 0.3) return;
        if (dHole < radius(m.w, pose.l)[0]) setHolePose(s, h.X, h.fwd, h.up);
        else setRepPose(s, pose);
      } else setRepPose(s, pose);
    } else {
      const h = holeAxes();
      const Y = axpy(h.X, h.d, ds);
      if (Math.hypot(...Y) < rH + 0.3 || Math.hypot(...Y) > MAX_RANGE) return;
      const rep = holeToRep(m, Y);
      if (rep.r < Math.hypot(...Y)) setRepPose(s, { l: rep.l, n: rep.n, fwd: toMouth(m, h.fw), up: toMouth(m, h.up) });
      else setHolePose(s, Y, h.fw, h.up);
    }
    this.sync();
  }

  // ------------------------------------------------------------------------------ gravity
  /**
   * Advances the camera as a massive body by simDt of coordinate time (the scene's time): a Kerr
   * geodesic near the hole (thrust = proper acceleration along the camera's axes), inertial motion
   * along the spatial geodesics of the wormhole metric near the mouth (it has no gravity, g_tt = −1).
   * The orientation is kept fixed with respect to the distant stars (a gyroscope, flat far field).
   */
  private fall(simDt: number, keys: Vec3, fast: boolean) {
    const s = this.s;
    const a = s.spin;
    const kn = Math.hypot(...keys);
    const accel = kn > 0 ? s.thrust * (fast ? 5 : 1) : 0;
    const cam = cameraFrame(s);
    if (cam.region === "hole") {
      const X0 = blToCartesian(cam.r, cam.theta, cam.phi);
      const f0 = sphericalFrame(X0);
      const w0 = (v: Vec3) => add3(f0.er, f0.et, f0.ep, v);
      const dirZ: Vec3 = kn > 0 ? normalize(lin(lin(cam.fwd, keys[0], cam.right, keys[1]), 1, cam.up, keys[2])) : [0, 0, 0];
      const res = advance(fromZamo(cam.r, cam.theta, cam.phi, cam.beta, a), a, simDt, 0.05, accel, dirZ);
      this.properTime += res.tau;
      const st = res.st;
      const X1 = blToCartesian(st.r, st.th, st.ph);
      const f1 = sphericalFrame(X1);
      const vel = add3(f1.er, f1.et, f1.ep, toZamo(st, a));
      setHolePose(s, X1, w0(cam.fwd), w0(cam.up), vel);
      s.motion = "geodesic";
      this.targetDistance = s.distance;
      return;
    }
    // near the wormhole: straight (geodesic) motion at constant speed, thrust changes γβ
    const m = mouth(s);
    const p = repPose(s);
    const right = cross(p.fwd, p.up);
    let v = p.vel;
    if (accel > 0) {
      const d = normalize(lin(lin(p.fwd, keys[0], right, keys[1]), 1, p.up, keys[2]));
      const g = 1 / Math.sqrt(Math.max(1 - (v[0] ** 2 + v[1] ** 2 + v[2] ** 2), 1e-9));
      const U = lin(v, g, d, accel * simDt);
      v = lin(U, 1 / Math.sqrt(1 + U[0] ** 2 + U[1] ** 2 + U[2] ** 2), U, 0);
    }
    const speed = Math.hypot(...v);
    this.properTime += simDt * Math.sqrt(Math.max(1 - speed * speed, 0));
    if (speed < 1e-9) {
      setRepPose(s, { ...p, vel: [0, 0, 0] });
      return;
    }
    const q = flyDneg(m.w, p.l, p.n, lin(v, 1 / speed, v, 0), [p.fwd, p.up], speed * simDt);
    setRepPose(s, { l: q.l, n: q.n, fwd: q.vectors[0]!, up: q.vectors[1]!, vel: lin(q.dir, speed, q.dir, 0) });
    s.motion = "geodesic";
    this.sync();
  }

  /**
   * The camera's future free-fall path (no thrust) in the black hole's frame, for the overlay:
   * recomputed at most 4 times a second. Near the mouth the path is not predicted.
   */
  predictPath() {
    const now = performance.now();
    if (!this.gravity) return (this.path = null);
    const s = this.s;
    // same state (e.g. time paused): same path object, so the renderer keeps converging
    const key = [s.spin, s.anchor, s.distance, s.inclination, s.azimuth, s.whL, s.velR, s.velT, s.velP, s.wormhole, s.whDist, s.whIncl, s.whAzimuth].join();
    if (this.path && (key === this.pathKey || now - this.path.at < 250)) return this.path;
    this.pathKey = key;
    const cam = cameraFrame(s);
    if (cam.region !== "hole") return (this.path = null);
    const st = fromZamo(cam.r, cam.theta, cam.phi, cam.beta, s.spin);
    // up to 0.95 of a turn around the hole: a bound orbit shows almost a full revolution without
    // coming back past the camera (a segment that close would sweep across the whole view)
    const p: { pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "wormhole" } = predict(st, s.spin, clamp(2 * 2 * Math.PI * cam.r ** 1.5, 300, 60000), 480);
    // keep at most 0.95 of a turn around the hole (accumulated angle of the position vector)
    let turned = 0;
    for (let i = 1; i < p.pts.length; i++) {
      const u = p.pts[i - 1]!, v = p.pts[i]!;
      const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
      turned += Math.acos(Math.min(1, Math.max(-1, c)));
      if (turned > 0.95 * 2 * Math.PI) {
        p.pts = p.pts.slice(0, i);
        p.fate = "continues";
        break;
      }
    }
    if (s.wormhole) {
      // the Kerr prediction stops where the path enters the far mouth (beyond: the other universe)
      const m = mouth(s);
      const i = p.pts.findIndex((q) => Math.hypot(q[0] - m.C[0], q[1] - m.C[1], q[2] - m.C[2]) < m.rGlue);
      if (i >= 0) p.pts = p.pts.slice(0, Math.max(i + 1, 2)), p.fate = "wormhole";
    }
    this.path = { ...p, at: now };
    return this.path;
  }

  // ------------------------------------------------------------------------------ journey
  private startJourney() {
    const s = this.s;
    if (!s.wormhole) {
      s.wormhole = true;
      s.anchor = "wormhole";
      s.whL = -8 * mouth(s).w.rho;
    }
    s.motion = "static";
    s.animate = true; // the disk turns and the star moves during the trip
    const dir = repPose(s).l < 0 ? "out" : "back";
    if (dir === "back") switchAnchor(s, "hole");
    const start = Object.fromEntries(POSE_KEYS.map((k) => [k, s[k]])) as Pick<Settings, PoseKeys>;
    this.journey = { t: 0, dir, start };
  }

  /**
   * Out: line up with the mouth on our side, fly radially through the throat (the line that leads
   * to the hole), emerge in the black hole's universe facing it, approach and settle into an orbit.
   * Back: fly to the far mouth, through it, and turn round on our side to look back at the mouth.
   */
  private stepJourney(dt: number) {
    const J = this.journey;
    if (!J) return this.setCinematic(null);
    const s = this.s;
    const m = mouth(s);
    const { rho, a } = m.w;
    J.t += dt;
    const x = Math.min(J.t / Math.max(s.journeyDuration, 1), 1);
    const f1 = 0.22;
    const f2 = 0.58;
    const phase = (lo: number, hi: number) => smoothstep((x - lo) / (hi - lo));
    const asinhL = (l: number) => Math.asinh(l / rho);
    const lOut = m.lGlue * 1.15;
    const st = J.start;
    if (J.dir === "out") {
      const lA = -(a + 6 * rho);
      if (x < f1) {
        const k = phase(0, f1);
        s.anchor = "wormhole";
        s.whL = rho * Math.sinh(lerp(asinhL(st.whL), asinhL(lA), k));
        s.inclination = lerp(st.inclination, 90, k);
        s.azimuth = lerpAngle(st.azimuth, 0, k);
        s.yaw = lerpAngle(st.yaw, 0, k);
        s.pitch = lerp(st.pitch, 0, k);
        s.roll = lerpAngle(st.roll, 0, k);
      } else if (x < f2) {
        const l = rho * Math.sinh(lerp(asinhL(lA), asinhL(lOut), phase(f1, f2)));
        setRepPose(s, { l, n: [1, 0, 0], fwd: [1, 0, 0] });
      } else {
        const k = phase(f2, 1);
        const X0 = repToHole(m, lOut, [1, 0, 0]);
        const f = sphericalFrame(X0);
        s.anchor = "hole";
        // pull back a little to reveal the whole disk, then orbit
        s.distance = Math.exp(lerp(Math.log(f.r), Math.log(Math.max(1.25 * f.r, horizon(s.spin) + 10)), k));
        s.inclination = lerp(f.th / DEG, 81, k);
        s.azimuth = f.ph / DEG + 40 * k;
        s.yaw = 0;
        s.pitch = 0;
      }
      if (x >= 1) {
        this.journey = null;
        this.sync();
        this.setCinematic("orbit");
      }
    } else {
      const lIn = m.lGlue * 1.3;
      const lB = -(a + 10 * rho);
      if (x < f1) {
        const k = phase(0, f1);
        const target = repToHole(m, lIn, [1, 0, 0]);
        const f = sphericalFrame(target);
        s.anchor = "hole";
        s.distance = Math.exp(lerp(Math.log(st.distance), Math.log(f.r), k));
        s.inclination = lerp(st.inclination, f.th / DEG, k);
        s.azimuth = lerpAngle(st.azimuth, f.ph / DEG, k);
        s.yaw = lerpAngle(st.yaw, 180, k);
        s.pitch = lerp(st.pitch, 0, k);
        s.roll = lerpAngle(st.roll, 0, k);
      } else if (x < f2) {
        const l = rho * Math.sinh(lerp(asinhL(lIn), asinhL(lB), phase(f1, f2)));
        setRepPose(s, { l, n: [1, 0, 0], fwd: [-1, 0, 0] });
      } else {
        const k = phase(f2, 1);
        setRepPose(s, { l: rho * Math.sinh(lerp(asinhL(lB), asinhL(lB * 1.4), k)), n: [1, 0, 0], fwd: [-1, 0, 0] });
        s.yaw = lerpAngle(180, 0, k);
      }
      if (x >= 1) {
        this.journey = null;
        this.sync();
        this.setCinematic(null);
      }
    }
  }

  private stepDive(dt: number) {
    const s = this.s;
    const a = s.spin;
    const rH = horizon(a);
    const rEnd = rH + 0.04;
    if (s.distance <= rEnd) {
      this.diveHold += dt;
      if (this.diveHold > 2.5) this.setCinematic(null);
      return;
    }
    // proper-time budget this frame, sub-stepped (RK2) so the plunge stays accurate near r+
    let tau = s.cinematicSpeed * dt;
    const th = (s.inclination * Math.PI) / 180;
    const c2 = Math.cos(th) ** 2;
    const deriv = (r: number) => {
      const sig = r * r + a * a * c2;
      const del = r * r - 2 * r + a * a;
      return {
        dr: -Math.sqrt(2 * r * (r * r + a * a)) / sig, // Σ dr/dτ = −√(2r(r²+a²))
        dphi: (2 * a * r) / (sig * del), // Σ dφ/dτ = 2ar/Δ (frame dragging)
      };
    };
    let r = s.distance;
    let phi = (s.azimuth * Math.PI) / 180;
    while (tau > 0 && r > rEnd) {
      const h = Math.min(tau, 0.02 * (r - rH) + 1e-4);
      const k1 = deriv(r);
      const k2 = deriv(Math.max(r + 0.5 * h * k1.dr, rH + 1e-4));
      r += h * k2.dr;
      phi += h * k2.dphi;
      tau -= h;
    }
    s.distance = Math.max(r, rEnd);
    s.azimuth = wrapDeg((phi * 180) / Math.PI);
    this.targetDistance = s.distance;
  }
}

const DEG = Math.PI / 180;
const MAX_RANGE = 1000; // M: how far free flight may take the camera
const lin = (a: Vec3, ka: number, b: Vec3, kb: number): Vec3 => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};
const axpy = (x: Vec3, v: Vec3, k: number): Vec3 => [x[0] + k * v[0], x[1] + k * v[1], x[2] + k * v[2]];
/** Components c along the frame (e0, e1, e2) → Cartesian vector. */
const add3 = (e0: Vec3, e1: Vec3, e2: Vec3, c: Vec3): Vec3 => [
  e0[0] * c[0] + e1[0] * c[1] + e2[0] * c[2],
  e0[1] * c[0] + e1[1] * c[1] + e2[1] * c[2],
  e0[2] * c[0] + e1[2] * c[1] + e2[2] * c[2],
];
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpAngle = (a: number, b: number, k: number) => a + ((((b - a + 540) % 360) + 360) % 360 - 180) * k;
const smoothstep = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

function wrapDeg(d: number) {
  return ((((d + 360) % 720) + 720) % 720) - 360;
}

export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}
