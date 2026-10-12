import { cameraFrame } from "../camera";
import { properBodyAxes } from "../system/local-patch";
import { sphericalFrame } from "../wormhole";
import { vesselHulls } from "../system/collide";
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
  onEvent: (kind: string, detail: string) => void = () => {};
  lastError: string | null = null;
  cpuMs = 0;
  private accumulator = 0;
  private jumpPending = false;
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
          : !systemBody(GARGANTUA_SYSTEM, body).surface ||
            systemBody(GARGANTUA_SYSTEM, body).surface!.kind === "gas" ||
            (systemBody(GARGANTUA_SYSTEM, body).surface!.kind === "ocean" && body !== "miller")
      )
        return "Cette surface ne permet pas la marche.";
    } catch {
      return "Corps inconnu ou surface non solide.";
    }
    const prev = { body: this.body, ours: this.ours, q: this.q };
    this.body = body;
    this.ours = ours;
    this.q = q;
    this.groundPatch.clear();
    this.lastTime = this.c.nowTime();
    const foot = this.ground(q);
    if (ours && this.surface(body, foot) === null) {
      Object.assign(this, prev);
      return "Chargement des données de sol : réessayez dans un instant.";
    }
    if (ours && this.surface(body, foot) === false) {
      Object.assign(this, prev);
      return "Le point de sortie est dans l’eau.";
    }
    if (ours && body === "earth" && this.contact()?.at(foot).blocked) {
      Object.assign(this, prev);
      return "Le point de sortie est obstrué.";
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
    if (solarBody(body) && !solidBody(body)) return this.fail("Cette surface ne permet pas la marche.");
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
      return "Surface non marchable.";
    }
  }
  /** `forcedBody`: the body known from the placement (the panel's On foot mode) — a Gargantua-world
   *  landing is a hole-frame pose without a landed state, the inference would fail. */
  disembark(forcedBody?: string) {
    if (this.active) return null;
    const c = this.c,
      w = c.rigWorld();
    if (!w || !c.piloting) return this.fail("Il faut piloter un vaisseau posé.");
    const body = forcedBody ?? c.ourLanded?.body ?? (c.landed ? c.local?.F.id : undefined);
    if (!body) return this.fail("Posez le vaisseau avant de sortir.");
    const h = c.airInfo?.();
    if (h && h.speed > 0.5) return this.fail("Le vaisseau doit être presque immobile.");
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
    return this.fail("Aucune sortie dégagée et solide près du vaisseau.");
  }
  private accessPoints(): Vec3[] {
    const w = this.c.rigWorld();
    if (!w || w.ours !== this.ours) return [];
    const t = this.c.nowTime(),
      C = shipToCamera(this.c.shipPose(), this.c.s.shipLookYaw, this.c.s.shipLookPitch).S;
    const axes: [Vec3, Vec3, Vec3] = [w.right, w.up, w.fwd];
    const rightWorld = add(add(scale(axes[0], C[0][0]), axes[1], C[1][0]), axes[2], C[2][0]);
    const point = (side: number) => {
      const X = add(w.X, rightWorld, (side * this.accessOffset()) / this.metres());
      const q = this.ours
        ? scale(toBodyFixed(this.body, X, t), M_METRES)
        : scale(toLocal(planetFrame(this.body, t, this.c.s.spin, this.c.s.massSolar), X, [0, 0, 0]).xi, this.metres());
      return this.ground(q);
    };
    return [point(1), point(-1)];
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
    if (!this.c.piloting || !(this.c.ourLanded || this.c.landed)) return this.fail("Le vaisseau doit être posé.");
    if (this.accessDistance() > 3) return this.fail("Approchez-vous de l’accès du vaisseau (3 m).");
    if ((this.c.airInfo?.()?.speed ?? 0) > 0.5) return this.fail("Le vaisseau se déplace trop vite.");
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
    this.jumpPending = false;
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
    this.jumpPending = false;
    this.drag = null;
    this.velocity = [0, 0, 0];
  }
  move(forward: number, right: number, seconds: number, run = false) {
    if (!this.active) return this.fail("Le personnage n’est pas à pied.");
    this.drive = {
      forward: Math.max(-1, Math.min(1, forward)),
      right: Math.max(-1, Math.min(1, right)),
      remaining: Math.max(0, Math.min(10, seconds)),
      run,
    };
    return null;
  }
  jump() {
    if (this.active && this.grounded) this.jumpPending = true;
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
  private vesselBlocked(q: Vec3, radius = 0.3, height = 1.8) {
    const hull = vesselHulls[this.c.s.vessel],
      pose = this.c.activePoseNow();
    if (!hull.bvh || !pose || !this.c.piloting) return false;
    const w = this.c.rigWorld();
    if (!w || w.ours !== this.ours) return false;
    const S = shipToCamera(this.c.shipPose(), this.c.s.shipLookYaw, this.c.s.shipLookPitch).S;
    const local = (p: Vec3): Vec3 => {
      const d = scale(sub(this.world(p), pose.X), this.metres());
      const cam = [dot(d, w.right), dot(d, w.up), dot(d, w.fwd)];
      return [0, 1, 2].map((i) => S[0][i]! * cam[0]! + S[1][i]! * cam[1]! + S[2][i]! * cam[2]!) as Vec3;
    };
    const a = local(add(q, this.up(), Math.min(radius, height / 2))),
      b = local(add(q, this.up(), Math.max(height - radius, height / 2)));
    if ([0, 1, 2].some((k) => Math.max(a[k]!, b[k]!) + radius < hull.lo[k]! || Math.min(a[k]!, b[k]!) - radius > hull.hi[k]!)) return false;
    return hull.bvh.capsule(a, b, radius);
  }
  private integrate(dt: number, f: number, r: number, run: boolean) {
    const up = this.up(),
      cam = tangent(up, add(scale(this.heading, Math.cos(this.yaw)), cross(this.heading, up), Math.sin(this.yaw)));
    const right = unit(cross(cam, up)),
      n = Math.max(1, Math.hypot(f, r));
    const pace = run ? this.c.s.runSpeed : this.c.s.walkSpeed;
    const desired = add(scale(cam, (f / n) * pace), right, (r / n) * pace);
    this.velocity = add(this.velocity, sub(desired, this.velocity), 1 - Math.exp(-dt * 14));
    const speed = len(this.velocity);
    if (speed > 0.05) {
      this.forward = tangent(up, add(this.forward, sub(unit(this.velocity), this.forward), 1 - Math.exp(-dt * 12)));
    }
    let target = add(this.q, this.velocity, dt);
    const contact = this.ours && this.body === "earth" ? this.contact() : null;
    if (contact?.at(target).blocked || this.vesselBlocked(target) || this.surface(this.body, target) === false) {
      // Slide along one tangent component when the full capsule step hits a facade/trunk.
      target = this.q;
      for (const v of [scale(cam, dot(this.velocity, cam)), scale(right, dot(this.velocity, right)), [0, 0, 0] as Vec3]) {
        const q = add(this.q, v, dt);
        if (!contact?.at(q).blocked && !this.vesselBlocked(q) && this.surface(this.body, q) !== false) {
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
    if (this.jumpPending && this.grounded) {
      this.vertical = this.c.s.jumpSpeed;
      this.grounded = false;
      this.jumpPending = false;
      this.onEvent("jump", this.body);
    }
    if (!this.grounded) this.vertical -= g * dt;
    const horizontal = target;
    target = add(target, up, this.vertical * dt);
    // A jump must stop at an underside/crown, not cross it after the horizontal collision query.
    if (
      (contact?.at(target).blocked || this.vesselBlocked(target)) &&
      !contact?.at(horizontal).blocked &&
      !this.vesselBlocked(horizontal)
    ) {
      let lo = 0,
        hi = 1;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        const q = add(horizontal, up, this.vertical * dt * mid);
        if (contact?.at(q).blocked || this.vesselBlocked(q)) hi = mid;
        else lo = mid;
      }
      target = add(horizontal, up, this.vertical * dt * lo);
      this.vertical = 0;
    }
    let above = this.height(target);
    const object = contact?.at(target, 0.3, 1.8, 0.25);
    if (object && Number.isFinite(object.support)) above = Math.min(above, -object.support);
    if (above <= 0.02 || (this.grounded && above < 0.25)) {
      target = add(target, up, -above + 0.012);
      if (!this.grounded) this.onEvent("landed", this.body);
      this.grounded = true;
      this.vertical = 0;
    } else this.grounded = false;
    this.speed = len(sub(target, this.q)) / dt;
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
      if (
        this.height(p) < 0.2 ||
        (this.ours && this.body === "earth" && this.contact()?.at(p, 0.2, 0.1, 0).blocked) ||
        this.vesselBlocked(p, 0.2, 0.4)
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
    const velocity = this.ours
      ? groundVelocity(this.body, X, time)
      : toGlobal(planetFrame(this.body, time, this.c.s.spin, this.c.s.massSolar), {
          xi: scale(q, 1 / this.metres()),
          w: [0, 0, 0],
          landed: true,
        }).V;
    sp.rigPlace(this.ours, X, look, U, velocity);
    if (!this.ours) {
      const cam = cameraFrame(sp.s),
        F = planetFrame(this.body, time, this.c.s.spin, this.c.s.massSolar);
      const axes = properBodyAxes(F, cam),
        sf = sphericalFrame(X);
      const world = (v: Vec3): Vec3 => {
        const z = [0, 1, 2].map((i) => axes.reduce((sum, a, j) => sum + a[i]! * v[j]!, 0)) as Vec3;
        return add(add(scale(sf.er, z[0]), sf.et, z[1]), sf.ep, z[2]);
      };
      sp.rigPlace(false, X, world(unit(sub(target, q))), world(up), velocity);
    }
    sp.sync();
  }
  frame(): CharacterFrame | null {
    if (!this.active) return null;
    const v = this.c.spectator?.rigWorld();
    if (!v) return null;
    const project = (p: Vec3): Vec3 => [dot(v.right, p), dot(v.up, p), dot(v.fwd, p)];
    let origin = project(scale(sub(this.world(this.q), v.X), this.metres()));
    let bodyProject = (p: Vec3) => project(this.worldVector(p));
    if (!this.ours) {
      const cam = cameraFrame(this.c.spectator!.s),
        F = planetFrame(this.body, this.lastTime, this.c.s.spin, this.c.s.massSolar);
      const axes = properBodyAxes(F, cam);
      bodyProject = (p: Vec3): Vec3 => {
        const z = [0, 1, 2].map((i) => axes.reduce((sum, a, j) => sum + a[i]! * p[j]!, 0)) as Vec3;
        return [dot(z, cam.right), dot(z, cam.up), dot(z, cam.fwd)];
      };
      origin = bodyProject(sub(this.q, scale(toLocal(F, v.X, [0, 0, 0]).xi, F.mPerM)));
    }
    const up = this.up(),
      right = unit(cross(this.forward, up));
    return {
      origin,
      axes: [right, up, this.forward].map(bodyProject) as [Vec3, Vec3, Vec3],
      sunOrigin: this.world(this.q),
      q: this.q,
      body: this.body,
      ours: this.ours,
      speed: this.speed,
      phase: this.phase,
      grounded: this.grounded,
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
