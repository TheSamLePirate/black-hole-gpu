// Planet-fixed walking. All contact arithmetic is float64 metres; the vessel remains the pilot.
import { WalkingGround } from "./walking-ground";
import type { CameraController } from "../controls";
import type { Vec3 } from "../physics";
import { add, sub, dot, cross, unit, scale, len } from "../math/vec3";
import { bodyAxes, solarBody, M_METRES, M_SECONDS } from "../system/solar";
import { solidBody, groundPointOf, toBodyFixed, fromBodyFixed, heightOverGround, groundVelocity } from "../system/our-surface";
import { planetFrame, toLocal, toGlobal } from "../landing";
import { relief } from "../terrain";
import { body as systemBody, GARGANTUA_SYSTEM } from "../system/bodies";
import { freeCameraKeys } from "../input/bindings";
import { shipToCamera } from "../mounts";
import type { SceneryContact } from "../system/scenery-contact";
import { t } from "../i18n";
import { capsuleInHull, hullDistance, outOfHull, placeHull, type VesselHull } from "./vessel-hull";

/** a jump asked this long before the feet touch down is still made on landing [s] */
export const JUMP_BUFFER_S = 0.15;
/** a jump asked this long after walking off an edge is still made (coyote time) [s] */
export const COYOTE_S = 0.12;
/** how fast the velocity follows the input: on the ground, in the air (a little steering only) [1/s] */
export const GROUND_RESPONSE = 14;
export const AIR_RESPONSE = 2.5;

export interface CharacterSave {
  body: string;
  ours: boolean;
  q: Vec3;
  forward: Vec3;
  heading?: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
  vertical: number;
}
export interface CharacterFrame {
  origin: Vec3;
  axes: [Vec3, Vec3, Vec3];
  sunOrigin: Vec3;
  q: Vec3;
  body: string;
  ours: boolean;
  speed: number;
  phase: number;
  grounded: boolean;
  /** off the ground (a jump, a fall): the gait stops, the stride held */
  airborne: boolean;
  /** the landing's give: how far the body sinks on its legs this instant [m, ≤ 0] */
  dip: number;
  time: number;
}
export const tangent = (up: Vec3, f: Vec3): Vec3 => {
  const v = sub(f, scale(up, dot(f, up)));
  return len(v) > 1e-7 ? unit(v) : unit(cross(Math.abs(up[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0], up));
};
export class PlanetCharacter {
  readonly groundPatch = new WalkingGround();
  terrainRevision: () => number = () => 0;
  active = false;
  body = "earth";
  ours = true;
  q: Vec3 = [0, 0, 0];
  forward: Vec3 = [0, 1, 0];
  yaw = 0;
  pitch = 0.2;
  distance = 4.5;
  age = 0;
  vertical = 0;
  speed = 0;
  grounded = true;
  phase = 0;
  velocity: Vec3 = [0, 0, 0];
  contact: () => SceneryContact | null = () => null;
  surface: (body: string, q: Vec3) => boolean | null = () => true;
  /** the flown vessel's box in its own frame (x left, y up, z nose) [m]: the renderer's mesh, gear out; null: unknown */
  hullBounds: () => { lo: Vec3; hi: Vec3 } | null = () => null;
  onEvent: (kind: string, detail: string) => void = () => {};
  lastError: string | null = null;
  cpuMs = 0;
  private accumulator = 0;
  /** the jump asked and not yet made: how long it still waits for the ground [s] */
  private jumpBuffer = 0;
  /** the time since the feet last touched the ground [s] */
  private airTime = 0;
  /** the landing's give [m] and its rate [m/s] (a damped spring) */
  private dip = 0;
  private dipRate = 0;
  private drive: { forward: number; right: number; run: boolean; remaining: number } | null = null;
  private drag: { id: number; x: number; y: number } | null = null;
  private lastTime = 0;
  private heading: Vec3 = [0, 1, 0];
  private camDistance = 4.5;
  constructor(private c: CameraController) {}
  metres() {
    return this.ours ? M_METRES : 1476.625 * this.c.s.massSolar;
  }
  up(q = this.q) {
    if (!this.ours || this.body !== "earth") return unit(q);
    const a = solarBody("earth")!.radius * M_METRES,
      b = a * (1 - 1 / 298.257223563);
    return unit([q[0] / (a * a), q[1] / (a * a), q[2] / (b * b)]);
  }
  height(q = this.q) {
    if (this.ours && this.body === "earth") {
      const h = this.groundPatch.sample(q);
      if (h !== null) return h;
    }
    return this.rawHeight(q);
  }
  rawHeight(q = this.q) {
    if (this.ours) return heightOverGround(this.body, scale(q, 1 / M_METRES));
    const F = planetFrame(this.body, this.lastTime, this.c.s.spin, this.c.s.massSolar);
    return len(q) - F.R * F.mPerM - relief(F.surf, unit(q), F.R * F.mPerM);
  }
  ground(q: Vec3) {
    return add(q, this.up(q), -this.height(q));
  }
  world(q: Vec3, time = this.lastTime) {
    if (this.ours) return fromBodyFixed(this.body, scale(q, 1 / M_METRES), time);
    const F = planetFrame(this.body, time, this.c.s.spin, this.c.s.massSolar);
    return toGlobal(F, { xi: scale(q, 1 / F.mPerM), w: [0, 0, 0], landed: true }).X;
  }
  private worldVector(v: Vec3, time = this.lastTime): Vec3 {
    if (this.ours) {
      const A = bodyAxes(solarBody(this.body)!, time);
      return add(add(scale(A[0], v[0]), A[1], v[1]), A[2], v[2]);
    }
    return unit(sub(this.world(add(this.q, v, 100), time), this.world(this.q, time)));
  }
  private prepare(body: string, ours: boolean, q: Vec3, forward: Vec3): string | null {
    try {
      if (
        ours
          ? !solidBody(body)
          : !systemBody(GARGANTUA_SYSTEM, body).surface || ["gas", "ocean"].includes(systemBody(GARGANTUA_SYSTEM, body).surface!.kind)
      )
        return t("You cannot walk on this surface.");
    } catch {
      return t("Unknown body, or no solid surface.");
    }
    const prev = { body: this.body, ours: this.ours, q: this.q };
    this.body = body;
    this.ours = ours;
    this.q = q;
    this.groundPatch.clear();
    this.hullCache = { at: -1, hull: null };
    this.lastTime = this.c.nowTime();
    const foot = this.ground(q);
    if (ours && this.surface(body, foot) === null) {
      Object.assign(this, prev);
      return t("The ground is still loading: try again in a moment.");
    }
    if (ours && this.surface(body, foot) === false) {
      Object.assign(this, prev);
      return t("The exit is in the water.");
    }
    if ((ours && body === "earth" && this.contact()?.at(foot).blocked) || this.inHull(foot)) {
      Object.assign(this, prev);
      return t("The exit is blocked.");
    }
    this.q = foot;
    if (ours && body === "earth") this.groundPatch.build(foot, this.up(), (p) => this.rawHeight(p), this.terrainRevision());
    this.forward = tangent(this.up(), forward);
    this.heading = [...this.forward];
    if (!this.c.spectator) {
      if (!this.c.startSpectator()) {
        // Exploration on foot is also available from the free camera, without a piloted vessel.
        const C = this.c.constructor as typeof CameraController;
        this.c.spectator = new C(
          this.c.canvas,
          { ...this.c.s, ship: false, rotation: "free", lookAt: false, telescope: false },
          () => {},
          true,
        );
      }
    }
    this.active = true;
    this.vertical = 0;
    this.speed = 0;
    this.velocity = [0, 0, 0];
    this.grounded = true;
    this.airTime = 0;
    this.jumpBuffer = 0;
    this.dip = this.dipRate = 0;
    this.yaw = 0;
    this.pitch = 0.2;
    this.distance = this.camDistance = this.c.s.characterDistance;
    this.accumulator = 0;
    this.drive = null;
    this.c.keys.clear();
    this.c.codes.clear();
    this.c.pilot.throttle = 0;
    this.c.pilot.auto = "none";
    this.c.pilot.hold = "none";
    this.c.s.animate = true;
    this.c.s.timeSpeed = 1 / (this.ours ? M_SECONDS : 4.925490947e-6 * this.c.s.massSolar);
    this.placeView(this.lastTime, 0);
    this.lastError = null;
    this.onEvent("disembarked", body);
    return null;
  }
  start(body: string, lat = 0, lon = 0) {
    this.lastTime = this.c.nowTime();
    if (solarBody(body) && !solidBody(body)) return this.fail(t("You cannot walk on this surface."));
    if (solidBody(body)) return this.prepare(body, true, scale(groundPointOf(body, lat, lon, 0), M_METRES), [0, 0, 1]);
    try {
      const F = planetFrame(body, this.lastTime, this.c.s.spin, this.c.s.massSolar);
      const a = (lat * Math.PI) / 180,
        b = (lon * Math.PI) / 180;
      return this.prepare(
        body,
        false,
        scale([Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)], F.R * F.mPerM),
        [0, 0, 1],
      );
    } catch {
      return t("This surface cannot be walked on.");
    }
  }
  disembark() {
    if (this.active) return null;
    const c = this.c,
      w = c.rigWorld();
    if (!w || !c.piloting) return this.fail(t("Fly a landed vessel first."));
    const body = c.ourLanded?.body ?? (c.landed ? c.local?.F.id : undefined);
    if (!body) return this.fail(t("Land the vessel before going out."));
    const h = c.airInfo?.();
    if (h && h.speed > 0.5) return this.fail(t("The vessel must be almost still."));
    this.lastTime = c.nowTime();
    let f: Vec3;
    if (w.ours) {
      const A = bodyAxes(solarBody(body)!, this.lastTime);
      f = A.map((a) => dot(a, w.fwd)) as Vec3;
    } else f = [0, 1, 0];
    const previousBody = this.body,
      previousOurs = this.ours;
    this.body = body;
    this.ours = w.ours;
    const points = this.accessPoints();
    this.body = previousBody;
    this.ours = previousOurs;
    // Aircraft clearance at its actual scale; the access follows this same point while boarding.
    for (const point of points) {
      const err = this.prepare(body, w.ours, point, f);
      if (!err) return null;
    }
    return this.fail(t("No clear, solid exit near the vessel."));
  }
  private accessPoints(): Vec3[] {
    const w = this.c.rigWorld();
    if (!w || w.ours !== this.ours) return [];
    const t = this.c.nowTime(),
      C = shipToCamera(this.c.shipPose(), this.c.s.shipLookYaw, this.c.s.shipLookPitch).S;
    const axes: [Vec3, Vec3, Vec3] = [w.right, w.up, w.fwd];
    const rightWorld = add(add(scale(axes[0], C[0][0]), axes[1], C[1][0]), axes[2], C[2][0]);
    const local = (X: Vec3) =>
      this.ours
        ? scale(toBodyFixed(this.body, X, t), M_METRES)
        : scale(toLocal(planetFrame(this.body, t, this.c.s.spin, this.c.s.massSolar), X, [0, 0, 0]).xi, this.metres());
    const hull = this.vesselHull();
    const point = (side: number) => {
      const q = this.ground(local(add(w.X, rightWorld, (side * this.accessOffset()) / this.metres())));
      // (a hatch estimated inside the hull — a wide craft —: out of its box, sideways, the astronaut's waist clear)
      if (hull && capsuleInHull(hull, q, this.up(q))) {
        const up = this.up(q),
          away = tangent(up, sub(local(add(w.X, rightWorld, side / this.metres())), local(w.X)));
        return this.ground(add(outOfHull(hull, add(q, up, 0.9), away, 0.6), up, -0.9));
      }
      return q;
    };
    return [point(1), point(-1)];
  }
  /**
   * The flown vessel's box on the body, in the walk's metres (its mesh's, gear out: the renderer's), from its
   * pose now — null: no vessel landed on this body, or its mesh not known yet.
   */
  vesselHull(): VesselHull | null {
    const bounds = this.hullBounds();
    if (!bounds || !this.c.piloting || !(this.c.ourLanded || this.c.landed)) return null;
    if ((this.c.ourLanded?.body ?? this.c.local?.F.id) !== this.body) return null;
    const w = this.c.rigWorld();
    if (!w || w.ours !== this.ours) return null;
    const time = this.c.nowTime(),
      m = this.metres(),
      pose = shipToCamera(this.c.shipPose(), this.c.s.shipLookYaw, this.c.s.shipLookPitch);
    const cam: [Vec3, Vec3, Vec3] = [w.right, w.up, w.fwd];
    // (a ship-frame vector in the world: its camera components, on the camera's world axes)
    const world = (v: Vec3): Vec3 => {
      const c = pose.S.map((row) => dot(row, v));
      return add(add(scale(cam[0], c[0]!), cam[1], c[1]!), cam[2], c[2]!);
    };
    const origin = add(add(add(w.X, cam[0], pose.t[0] / m), cam[1], pose.t[1] / m), cam[2], pose.t[2] / m);
    const local = (X: Vec3) =>
      this.ours
        ? scale(toBodyFixed(this.body, X, time), M_METRES)
        : scale(toLocal(planetFrame(this.body, time, this.c.s.spin, this.c.s.massSolar), X, [0, 0, 0]).xi, m);
    const o = local(origin);
    // (the axes through the same conversion as the points: the body's turn, a world's own frame)
    const axes = ([0, 1, 2] as const).map((k) => {
      const e: Vec3 = [0, 0, 0];
      e[k] = 1;
      return unit(sub(local(add(origin, world(e), 1 / m)), o));
    }) as [Vec3, Vec3, Vec3];
    return placeHull(o, axes, bounds.lo, bounds.hi);
  }
  private hullCache: { at: number; hull: VesselHull | null } = { at: -1, hull: null };
  /** the vessel's box this step (computed once per frame: the vessel stands still on the ground) */
  private hullNow() {
    if (this.hullCache.at !== this.age) this.hullCache = { at: this.age, hull: this.vesselHull() };
    return this.hullCache.hull;
  }
  /** The surface wind where he walks (the weather's at the landed vessel: speed [m/s], from [°]); null: unknown. */
  wind(): { speed: number; from: number } | null {
    return this.ours && this.body === "earth" ? this.c.windNow : null;
  }
  /** How high the feet stand at p over the ground or what holds them (a bridge's deck, a roof) [m]. */
  private standing(p: Vec3) {
    const h = this.height(p);
    const object = this.ours && this.body === "earth" ? this.contact()?.at(p, 0.05, 1.8, 0.4) : null;
    return object && Number.isFinite(object.support) ? Math.min(h, -object.support) : h;
  }
  /**
   * The ground's rise at x metres to the astronaut's right and z ahead of him, over the ground under him [m]: where
   * his feet's IK puts each foot on a slope (character-model.ts placeFeet).
   */
  groundRise(x: number, z: number) {
    const up = this.up(),
      right = unit(cross(this.forward, up));
    return this.standing(this.q) - this.standing(add(add(this.q, right, x), this.forward, z));
  }
  /** The astronaut standing at q would be inside the vessel's hull. */
  inHull(q: Vec3, radius = 0.3, height = 1.8) {
    const h = this.hullNow();
    return !!h && capsuleInHull(h, q, this.up(q), radius, height);
  }
  private accessOffset() {
    return this.c.s.vessel === "endurance" ? 75 : this.c.s.vessel === "lander" ? 13 : 9;
  }
  accessDistance() {
    if ((this.c.ourLanded?.body ?? this.c.local?.F.id) !== this.body) return Infinity;
    const points = this.accessPoints();
    return points.length ? Math.min(...points.map((p) => len(sub(this.q, p)))) : Infinity;
  }
  board() {
    if (!this.active) return null;
    if (!this.c.piloting || !(this.c.ourLanded || this.c.landed)) return this.fail(t("The vessel must be landed."));
    if (this.accessDistance() > 3) return this.fail(t("Come closer to the vessel's hatch (3 m)."));
    if ((this.c.airInfo?.()?.speed ?? 0) > 0.5) return this.fail(t("The vessel is moving too fast."));
    this.stop();
    this.onEvent("boarded", this.c.s.vessel);
    return null;
  }
  toggle() {
    return this.active ? this.board() : this.disembark();
  }
  stop() {
    this.groundPatch.clear();
    this.active = false;
    this.drive = null;
    this.jumpBuffer = 0;
    this.drag = null;
    this.c.spectator = null;
    this.c.keys.clear();
    this.c.codes.clear();
  }
  private fail(reason: string) {
    this.lastError = reason;
    this.onEvent("unavailable", reason);
    return reason;
  }
  releaseInput() {
    this.drive = null;
    this.jumpBuffer = 0;
    this.drag = null;
    this.velocity = [0, 0, 0];
  }
  move(forward: number, right: number, seconds: number, run = false) {
    if (!this.active) return this.fail(t("The astronaut is not on foot."));
    this.drive = {
      forward: Math.max(-1, Math.min(1, forward)),
      right: Math.max(-1, Math.min(1, right)),
      remaining: Math.max(0, Math.min(10, seconds)),
      run,
    };
    return null;
  }
  /** A jump: made now on the ground (or just off an edge), else as soon as the feet touch down (within JUMP_BUFFER_S). */
  jump() {
    if (this.active) this.jumpBuffer = JUMP_BUFFER_S;
  }
  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(-0.15, Math.min(1.2, this.pitch + dy * 0.006));
  }
  pointer(e: PointerEvent, kind: "down" | "move" | "up") {
    if (kind === "down") {
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.c.canvas.setPointerCapture(e.pointerId);
    } else if (kind === "up") this.drag = null;
    else if (this.drag?.id === e.pointerId) {
      this.orbit(e.clientX - this.drag.x, e.clientY - this.drag.y);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    }
  }
  zoom(delta: number) {
    this.distance = Math.max(2.2, Math.min(8, this.distance * Math.exp(delta * 0.001)));
  }
  step(dt: number, time: number, pad: CameraController["padFrame"]) {
    if (!this.active) return false;
    const began = performance.now();
    this.lastTime = time;
    this.age += dt;
    if (this.ours && this.body === "earth") this.groundPatch.build(this.q, this.up(), (p) => this.rawHeight(p), this.terrainRevision());
    if (this.grounded) {
      const h = this.height();
      const object = this.ours && this.body === "earth" ? this.contact()?.at(this.q) : null;
      const above = object && Number.isFinite(object.support) ? Math.min(h, -object.support) : h;
      if (Math.abs(above - 0.012) > 0.01) this.q = add(this.q, this.up(), 0.012 - above);
    }
    const codes = this.c.enabled ? this.c.codes : new Set<string>();
    let f = 0,
      r = 0;
    for (const code of codes) {
      const v = freeCameraKeys()[code];
      if (v) {
        f += v[0];
        r += v[1];
      }
    }
    if (this.drive && this.c.enabled) {
      f += this.drive.forward;
      r += this.drive.right;
      this.drive.remaining -= dt;
      if (this.drive.remaining <= 0) this.drive = null;
    }
    if (pad) {
      f += pad.move[0];
      r += pad.move[1];
      this.orbit(-pad.look[0] * dt * 180, pad.look[1] * dt * 180);
    }
    const fast = codes.has("ShiftLeft") || codes.has("ShiftRight") || !!pad?.fast || !!this.drive?.run;
    const proper = this.ours ? 1 : 1 / planetFrame(this.body, time, this.c.s.spin, this.c.s.massSolar).ut;
    this.accumulator += Math.min(dt, 0.1) * proper;
    while (this.accumulator >= 1 / 120) {
      this.integrate(1 / 120, f, r, fast);
      this.accumulator -= 1 / 120;
    }
    this.placeView(time, dt);
    this.cpuMs = performance.now() - began;
    return true;
  }
  private integrate(dt: number, f: number, r: number, run: boolean) {
    const up = this.up(),
      cam = tangent(up, add(scale(this.heading, Math.cos(this.yaw)), cross(this.heading, up), Math.sin(this.yaw)));
    const right = unit(cross(cam, up)),
      n = Math.max(1, Math.hypot(f, r));
    const pace = run ? this.c.s.runSpeed : this.c.s.walkSpeed;
    const desired = add(scale(cam, (f / n) * pace), right, (r / n) * pace);
    // (in the air: the momentum kept, a little steering)
    this.velocity = add(this.velocity, sub(desired, this.velocity), 1 - Math.exp(-dt * (this.grounded ? GROUND_RESPONSE : AIR_RESPONSE)));
    const speed = len(this.velocity);
    if (speed > 0.05) {
      this.forward = tangent(up, add(this.forward, sub(unit(this.velocity), this.forward), 1 - Math.exp(-dt * 12)));
    }
    let target = add(this.q, this.velocity, dt);
    const contact = this.ours && this.body === "earth" ? this.contact() : null;
    const free = (q: Vec3) => !contact?.at(q).blocked && this.surface(this.body, q) !== false && !this.inHull(q);
    if (!free(target)) {
      // Slide along one tangent component when the full capsule step hits a facade, a trunk or the hull.
      target = this.q;
      for (const v of [scale(cam, dot(this.velocity, cam)), scale(right, dot(this.velocity, right)), [0, 0, 0] as Vec3]) {
        const q = add(this.q, v, dt);
        if (free(q)) {
          target = q;
          break;
        }
      }
    }
    const floor = this.height(target),
      slope = floor - this.height(this.q);
    if (this.grounded && -slope > Math.max(0.025, len(sub(target, this.q)))) target = this.q; // steep upward step: do not climb vertical terrain
    const g = this.ours
      ? (solarBody(this.body)!.mass / (len(this.q) / M_METRES) ** 2) * (299792458 ** 2 / M_METRES)
      : (planetFrame(this.body, this.lastTime, this.c.s.spin, this.c.s.massSolar).m / (len(this.q) / this.metres()) ** 2) *
        (299792458 ** 2 / this.metres());
    // (a jump asked a little early, or just after walking off an edge, is still made)
    if (this.jumpBuffer > 0 && (this.grounded || (this.airTime < COYOTE_S && this.vertical <= 0))) {
      this.vertical = this.c.s.jumpSpeed;
      this.grounded = false;
      this.jumpBuffer = 0;
      this.airTime = COYOTE_S;
      this.onEvent("jump", this.body);
    }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (!this.grounded) this.vertical -= g * dt;
    target = add(target, up, this.vertical * dt);
    let above = this.height(target);
    const object = contact?.at(target, 0.3, 1.8, 0.25);
    if (object && Number.isFinite(object.support)) above = Math.min(above, -object.support);
    if (above <= 0.02 || (this.grounded && above < 0.25)) {
      target = add(target, up, -above + 0.012);
      if (!this.grounded) {
        // (the legs give on landing: a damped spring, deeper the faster the fall)
        this.dipRate = Math.min(this.dipRate, -Math.min(2, 0.6 * Math.abs(this.vertical)));
        this.onEvent("landed", this.body);
      }
      this.grounded = true;
      this.vertical = 0;
      this.airTime = 0;
    } else {
      this.grounded = false;
      this.airTime += dt;
    }
    this.dipRate += (-120 * this.dip - 22 * this.dipRate) * dt;
    this.dip = Math.max(-0.15, Math.min(0, this.dip + this.dipRate * dt));
    // (the speed along the ground: the gait's pace — a fall or a jump does not walk)
    const step = sub(target, this.q);
    this.speed = len(sub(step, scale(up, dot(step, up)))) / dt;
    this.q = target;
    this.phase += speed * dt * 3;
  }
  private placeView(time: number, dt: number) {
    const sp = this.c.spectator;
    if (!sp) return;
    Object.assign(sp.s, this.c.s, { ship: false, rotation: "free", lookAt: false, telescope: false });
    const up = this.up(),
      f = tangent(up, add(scale(this.heading, Math.cos(this.yaw)), cross(this.heading, up), Math.sin(this.yaw))),
      target = add(this.q, up, 1.35);
    const away = add(scale(f, -Math.cos(this.pitch)), up, Math.sin(this.pitch));
    let reach = this.distance;
    for (let d = 0.25; d <= this.distance; d += 0.25) {
      const p = add(target, away, d);
      const hull = this.hullNow();
      if (
        this.height(p) < 0.2 ||
        (this.ours && this.body === "earth" && this.contact()?.at(p, 0.2, 0.1, 0).blocked) ||
        (hull && hullDistance(hull, p) < 0.25)
      ) {
        reach = Math.max(0.3, d - 0.3);
        break;
      }
    }
    this.camDistance = reach < this.camDistance ? reach : this.camDistance + (reach - this.camDistance) * (1 - Math.exp(-dt * 8));
    const q = add(target, away, this.camDistance),
      X = this.world(q, time),
      look = unit(sub(this.world(target, time), X)),
      U = this.worldVector(up, time);
    sp.rigPlace(this.ours, X, look, U, this.ours ? groundVelocity(this.body, X, time) : [0, 0, 0]);
    sp.sync();
  }
  frame(): CharacterFrame | null {
    if (!this.active) return null;
    const v = this.c.spectator?.rigWorld();
    if (!v) return null;
    const project = (p: Vec3): Vec3 => [dot(v.right, p), dot(v.up, p), dot(v.fwd, p)];
    const origin = project(scale(sub(this.world(this.q), v.X), this.metres()));
    const up = this.up(),
      right = unit(cross(this.forward, up));
    return {
      origin,
      axes: [right, up, this.forward].map((p) => project(this.worldVector(p))) as [Vec3, Vec3, Vec3],
      sunOrigin: this.world(this.q),
      q: this.q,
      body: this.body,
      ours: this.ours,
      speed: this.speed,
      phase: this.phase,
      grounded: this.grounded,
      airborne: !this.grounded,
      dip: this.dip,
      time: this.lastTime,
    };
  }
  snapshot(): CharacterSave | null {
    return this.active
      ? {
          body: this.body,
          ours: this.ours,
          q: [...this.q],
          forward: [...this.forward],
          heading: [...this.heading],
          yaw: this.yaw,
          pitch: this.pitch,
          distance: this.distance,
          vertical: this.vertical,
        }
      : null;
  }
  restore(s: CharacterSave) {
    const err = this.prepare(s.body, s.ours, s.q, s.forward);
    if (!err) {
      this.q = [...s.q];
      this.heading = tangent(this.up(), s.heading ?? s.forward);
      this.yaw = s.yaw;
      this.pitch = s.pitch;
      this.distance = s.distance;
      this.vertical = s.vertical;
      this.grounded = Math.abs(this.height()) < 0.1;
      this.placeView(this.c.nowTime(), 0);
    }
    return err;
  }
  state() {
    return {
      active: this.active,
      body: this.body,
      ours: this.ours,
      positionM: [...this.q],
      speedMs: this.speed,
      verticalMs: this.vertical,
      grounded: this.grounded,
      heightM: this.active ? this.height() : null,
      accessDistanceM: this.active ? this.accessDistance() : null,
      airborneS: this.grounded ? 0 : this.airTime,
      dipM: this.dip,
      hull: (() => {
        const h = this.active ? this.hullNow() : null;
        return h ? { distanceM: hullDistance(h, this.q), half: [...h.half] } : null;
      })(),
      cpuMs: this.cpuMs,
      groundPatch: {
        ready: this.groundPatch.ready,
        gridSize: this.groundPatch.size,
        bytes: this.groundPatch.values.byteLength,
        cpuMs: this.groundPatch.cpuMs,
      },
      error: this.lastError,
    };
  }
}
