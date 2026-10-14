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
import { planetFrame, toLocal, toGlobal, type PlanetFrame } from "../landing";
import { relief } from "../terrain";
import { body as systemBody, GARGANTUA_SYSTEM } from "../system/bodies";
import { freeCameraKeys } from "../input/bindings";
import { shipToCamera } from "../mounts";
import type { SceneryContact } from "../system/scenery-contact";
import { t } from "../i18n";
import { capsuleInHull, hullDistance, outOfHull, placeHull, type VesselHull } from "./vessel-hull";
import { damp, fbm, Spring3, type V3 } from "../cine/rig";
import { cartToGeodetic, flatteningOf } from "../system/ellipsoid";
import { azimuthDeg, localAxes } from "../game/geo";

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
  /** the view's pivot (body-fixed [m]: it lags the head — the view saved where it was) */
  pivot?: Vec3;
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
  /** a stone of the living ground in the way of the capsule at q (radius [m]) — the renderer's (its boulders) */
  obstacles: (q: Vec3, radius: number) => boolean = () => false;
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
  /** the view's pivot following the head with a little lag (body-fixed), the lens's run factor, a landing's
   *  jolt (its strength, decaying) and its clock [s] */
  private camPivot = new Spring3();
  private runFov = 1;
  private jolt = 0;
  private camClock = 0;
  /** the view's place [the walk's metres] as last placed (the free camera taken over from it) */
  private camQ: Vec3 | null = null;
  constructor(private c: CameraController) {}
  /** the Gargantua world's frame walked on at a time (one a step: the height's samples, the sub-steps, the camera
   *  read it many times — each built anew allocated, 32 times for the camera's march alone) */
  private frameMemo: { body: string; t: number; a: number; m: number; F: PlanetFrame } | null = null;
  private planet(time = this.lastTime): PlanetFrame {
    const s = this.c.s,
      k = this.frameMemo;
    if (k && k.body === this.body && k.t === time && k.a === s.spin && k.m === s.massSolar) return k.F;
    const F = planetFrame(this.body, time, s.spin, s.massSolar);
    this.frameMemo = { body: this.body, t: time, a: s.spin, m: s.massSolar, F };
    return F;
  }
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
    const F = this.planet(this.lastTime);
    return len(q) - F.R * F.mPerM - relief(F.surf, unit(q), F.R * F.mPerM);
  }
  ground(q: Vec3) {
    return add(q, this.up(q), -this.height(q));
  }
  world(q: Vec3, time = this.lastTime) {
    if (this.ours) return fromBodyFixed(this.body, scale(q, 1 / M_METRES), time);
    const F = this.planet(time);
    return toGlobal(F, { xi: scale(q, 1 / F.mPerM), w: [0, 0, 0], landed: true }).X;
  }
  private worldVector(v: Vec3, time = this.lastTime): Vec3 {
    if (this.ours) {
      const A = bodyAxes(solarBody(this.body)!, time);
      return add(add(scale(A[0], v[0]), A[1], v[1]), A[2], v[2]);
    }
    return unit(sub(this.world(add(this.q, v, 100), time), this.world(this.q, time)));
  }
  /** `restoring`: a save's point taken as it is (he may stand on a deck, a roof, the vessel — not projected on the
   *  ground under it), no event to TARS, the save's own time kept. */
  private prepare(body: string, ours: boolean, q: Vec3, forward: Vec3, restoring = false): string | null {
    try {
      if (
        ours
          ? !solidBody(body)
          : !systemBody(GARGANTUA_SYSTEM, body).surface ||
            systemBody(GARGANTUA_SYSTEM, body).surface!.kind === "gas" ||
            (systemBody(GARGANTUA_SYSTEM, body).surface!.kind === "ocean" && body !== "miller")
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
    this.shipCache = { at: -1, frame: null, hull: null };
    // (set between frames — a placing, a load, TARS —: the scene's clock, the instant the vessel was put at; the
    // controller's own was the last frame's, months off after a date jumped)
    this.lastTime = this.c.viewTime();
    const foot = restoring ? q : this.ground(q);
    if (ours && this.surface(body, foot) === null) {
      Object.assign(this, prev);
      return t("The ground is still loading: try again in a moment.");
    }
    // (over the water, held by a deck or the vessel — a save restored on a bridge, a ship —: not in it)
    if (ours && this.surface(body, foot) === false && !(restoring && this.heldAt(foot))) {
      Object.assign(this, prev);
      return t("The exit is in the water.");
    }
    if ((ours && body === "earth" && this.contact()?.at(foot).blocked) || this.vesselBlocked(foot)) {
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
    this.camPivot.reset();
    this.jolt = 0;
    this.runFov = 1;
    this.accumulator = 0;
    this.drive = null;
    this.c.keys.clear();
    this.c.codes.clear();
    this.c.pilot.throttle = 0;
    this.c.pilot.auto = "none";
    this.c.pilot.hold = "none";
    // (out on foot, the time runs as a walker's; a save restored keeps its own — paused, sped up)
    if (!restoring) {
      this.c.s.animate = true;
      this.c.s.timeSpeed = 1 / (this.ours ? M_SECONDS : 4.925490947e-6 * this.c.s.massSolar);
    }
    this.placeView(this.lastTime, 0);
    this.lastError = null;
    if (!restoring) this.onEvent("disembarked", body);
    return null;
  }
  start(body: string, lat = 0, lon = 0) {
    this.lastTime = this.c.viewTime();
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
  /** On foot at a body-fixed point [m] facing `forward` (body-fixed) — out of another player's craft at its door
   *  (docs/PLAN-RESEAU.md R5). */
  startAt(body: string, q: Vec3, forward: Vec3) {
    this.lastTime = this.c.viewTime();
    return this.prepare(body, true, q, forward);
  }
  /** `forcedBody`: the body known from the placement (the panel's On foot mode) — a Gargantua-world
   *  landing is a hole-frame pose without a landed state, the inference would fail. */
  disembark(forcedBody?: string) {
    if (this.active) return null;
    const c = this.c,
      w = c.rigWorld();
    if (!w || !c.piloting) return this.fail(t("Fly a landed vessel first."));
    const body = forcedBody ?? c.ourLanded?.body ?? (c.landed ? c.local?.F.id : undefined);
    if (!body) return this.fail(t("Land the vessel before going out."));
    const h = c.airInfo?.();
    if (h && h.speed > 0.5) return this.fail(t("The vessel must be almost still."));
    this.lastTime = c.viewTime();
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
    const t = this.c.viewTime(),
      C = shipToCamera(this.c.shipPose(), this.c.s.shipLookYaw, this.c.s.shipLookPitch).S;
    const axes: [Vec3, Vec3, Vec3] = [w.right, w.up, w.fwd];
    const rightWorld = add(add(scale(axes[0], C[0][0]), axes[1], C[1][0]), axes[2], C[2][0]);
    const local = (X: Vec3) =>
      this.ours ? scale(toBodyFixed(this.body, X, t), M_METRES) : scale(toLocal(this.planet(t), X, [0, 0, 0]).xi, this.metres());
    // (not walking — the exits sought for a disembarking —: the vessel's frame read now, not a last walk's)
    if (!this.active) this.shipCache = { at: -1, frame: null, hull: null };
    const hull = this.shipNow().hull;
    const point = (side: number) => {
      const q = this.ground(local(add(w.X, rightWorld, (side * this.accessOffset()) / this.metres())));
      // (a hatch estimated inside the hull — a wide craft —: out of its box, sideways, the astronaut's waist clear;
      // the walk's own test — the hull's triangles when known —: an exit the walk would refuse is never offered)
      if (hull && this.vesselBlocked(q)) {
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
    const f = this.shipFrame(),
      vessel = vesselHulls[this.c.s.vessel],
      bounds = vessel?.bvh ? { lo: vessel.lo, hi: vessel.hi } : this.hullBounds();
    return f && bounds ? placeHull(f.origin, f.axes, bounds.lo, bounds.hi) : null;
  }
  /**
   * The landed vessel's frame in the walk's metres: its origin (the ship's own, rigWorld's X) and its axes (x left,
   * y up, z nose) — from its pose now, through the same conversion as the walk's points (the body's turn, a
   * Gargantua world's proper frame). Null: no vessel landed on this body.
   */
  shipFrame(): { origin: Vec3; axes: [Vec3, Vec3, Vec3] } | null {
    if (!this.c.piloting || !(this.c.ourLanded || this.c.landed)) return null;
    if ((this.c.ourLanded?.body ?? this.c.local?.F.id) !== this.body) return null;
    const w = this.c.rigWorld();
    if (!w || w.ours !== this.ours) return null;
    // (walking, in the frame's step: the ship's clock; set out between frames: the scene's)
    const time = this.active ? this.c.nowTime() : this.c.viewTime(),
      m = this.metres(),
      S = shipToCamera(this.c.shipPose(), this.c.s.shipLookYaw, this.c.s.shipLookPitch).S;
    // (a ship-frame vector in the world: its camera components, on the camera's world axes)
    const world = (v: Vec3): Vec3 => {
      const c = S.map((row) => dot(row, v));
      return add(add(scale(w.right, c[0]!), w.up, c[1]!), w.fwd, c[2]!);
    };
    const local = this.walkOf(time);
    const origin = local(w.X);
    const axes = ([0, 1, 2] as const).map((k) => {
      const e: Vec3 = [0, 0, 0];
      e[k] = 1;
      return unit(sub(local(add(w.X, world(e), 1 / m)), origin));
    }) as [Vec3, Vec3, Vec3];
    return { origin, axes };
  }
  /** A world point (M) in the walk's metres at time t: body-fixed on our worlds, a Gargantua world's proper frame. */
  private walkOf(time: number) {
    if (this.ours) return (X: Vec3) => scale(toBodyFixed(this.body, X, time), M_METRES);
    const F = this.planet(time),
      m = this.metres();
    return (X: Vec3) => scale(toLocal(F, X, [0, 0, 0]).xi, m);
  }
  private shipCache: { at: number; frame: ReturnType<PlanetCharacter["shipFrame"]>; hull: VesselHull | null } = {
    at: -1,
    frame: null,
    hull: null,
  };
  /** the vessel's frame and box this frame (computed once a frame: it stands still on the ground) */
  private shipNow() {
    if (this.shipCache.at !== this.age) {
      const frame = this.shipFrame();
      this.shipCache = { at: this.age, frame, hull: frame ? this.vesselHull() : null };
    }
    return this.shipCache;
  }
  /** the vessel's box this frame (the grass under it, the exits, the state) */
  hullNow() {
    return this.shipNow().hull;
  }
  /** Does the segment a → b pass within margin [m] of the vessel's box (a cheap test before its triangles)? */
  private lineNearShip(a: Vec3, b: Vec3, margin: number) {
    const h = this.shipNow().hull;
    if (!h) return false;
    for (let i = 0; i <= 8; i++) if (hullDistance(h, add(a, sub(b, a), i / 8)) < margin + len(sub(b, a)) / 16) return true;
    return false;
  }
  /** A walk point in the vessel's frame [m] (null: no vessel). */
  private toShip(p: Vec3): Vec3 | null {
    const f = this.shipNow().frame;
    if (!f) return null;
    const d = sub(p, f.origin);
    return [dot(d, f.axes[0]), dot(d, f.axes[1]), dot(d, f.axes[2])];
  }
  /** The surface wind where he walks (the weather's at the landed vessel: speed [m/s], from [°]); null: unknown. */
  wind(): { speed: number; from: number } | null {
    return this.ours && this.body === "earth" ? this.c.windNow : null;
  }
  /** How high the feet stand at p over the ground or what holds them (a bridge's deck, a roof) [m]. */
  private standing(p: Vec3, radius = 0.05, step = 0.4) {
    const h = this.height(p);
    const object = this.ours && this.body === "earth" ? this.contact()?.at(p, radius, 1.8, step) : null;
    const scenery = object && Number.isFinite(object.support) ? Math.min(h, -object.support) : h;
    return Math.min(scenery, this.vesselSupport(p));
  }
  /** Something holds the feet at p other than the ground: a bridge's deck, a roof, the vessel's back. */
  private heldAt(p: Vec3) {
    const object = this.ours && this.body === "earth" ? this.contact()?.at(p, 0.05, 1.8, 0.4) : null;
    return (!!object && Number.isFinite(object.support)) || Number.isFinite(this.vesselSupport(p));
  }
  /**
   * How high p stands over the landed vessel's top under it [m] — a wing, the hull's back — within a step up
   * (0.4 m) or a short drop (0.5 m); Infinity: none there. Its triangles (the first crossing down), else its box.
   */
  private vesselSupport(p: Vec3) {
    const f = this.shipNow().frame;
    if (!f) return Infinity;
    const up = this.up(p),
      vessel = vesselHulls[this.c.s.vessel];
    if (vessel?.bvh) {
      const a = this.toShip(add(p, up, 0.4))!,
        b = this.toShip(add(p, up, -0.5))!;
      if ([0, 1, 2].some((k) => Math.max(a[k]!, b[k]!) < vessel.lo[k]! || Math.min(a[k]!, b[k]!) > vessel.hi[k]!)) return Infinity;
      const hit = vessel.bvh.segment(a, b);
      return hit ? 0.9 * hit.t - 0.4 : Infinity;
    }
    const h = this.shipNow().hull;
    if (!h) return Infinity;
    const d = sub(p, h.centre);
    if (Math.abs(dot(d, h.axes[0])) > h.half[0] || Math.abs(dot(d, h.axes[2])) > h.half[2]) return Infinity;
    const above = dot(d, h.axes[1]) - h.half[1];
    return above > -0.4 && above < 0.5 ? above : Infinity;
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
    return this.c.s.vessel === "endurance" ? 75 : this.c.s.vessel === "lander" ? 13 : this.c.s.vessel === "f35" ? 8 : 9;
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
  /** The walk ended. `keepView`: the walker's camera stays out as the spectator (the Free camera mode, no cut). */
  stop(o: { keepView?: boolean } = {}) {
    const walking = this.active;
    this.groundPatch.clear();
    this.active = false;
    this.drive = null;
    this.jumpBuffer = 0;
    this.drag = null;
    // (nobody walking: the spectator out is not the walker's — left as it is)
    if (walking && !o.keepView) this.c.spectator = null;
    else if (walking && this.c.spectator) {
      // (the walker's camera goes on free where it stands: the follow's offset and the glide out of the ship set
      // when the walk began — never advanced while walking — cut it back to that stale view of the ship. Its
      // following kept as it was, its offset taken from where it is now: unfollowed, it stayed still in space while
      // the world turned under it — the ground gone from below the tripod in seconds)
      this.c.specGlide = null;
      const eye = this.camQ;
      if (this.c.spectatorFollow && eye) this.c.specRebase = (time) => this.world(eye, time) as [number, number, number];
    }
    this.c.keys.clear();
    this.c.codes.clear();
  }
  private fail(reason: string) {
    this.lastError = reason;
    this.onEvent("unavailable", reason);
    return reason;
  }
  /** The held movement let go (a touch pad's finger lifted): the walk slows as it would, a jump asked stays. */
  releaseMove() {
    this.drive = null;
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
      const above = this.standing(this.q, 0.3, 0.25);
      if (Math.abs(above - 0.012) > 0.01) this.q = add(this.q, this.up(), 0.012 - above);
    }
    const codes = this.c.enabled ? this.c.codes : new Set<string>();
    let f = 0,
      r = 0;
    const keys = freeCameraKeys();
    for (const code of codes) {
      const v = keys[code];
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
    const proper = this.ours ? 1 : 1 / this.planet(time).ut;
    this.accumulator += Math.min(dt, 0.1) * proper;
    while (this.accumulator >= 1 / 120) {
      this.integrate(1 / 120, f, r, fast);
      this.accumulator -= 1 / 120;
    }
    this.placeView(time, dt);
    this.cpuMs = performance.now() - began;
    return true;
  }
  /**
   * The astronaut standing at q would meet the landed vessel: a capsule against its hull's real triangles (its
   * BVH), else — its mesh not read yet — against its box (vesselHull).
   */
  private vesselBlocked(q: Vec3, radius = 0.3, height = 1.8) {
    if (!this.shipNow().frame) return false;
    const vessel = vesselHulls[this.c.s.vessel];
    if (!vessel?.bvh) return this.inHull(q, radius, height);
    const up = this.up(q);
    const a = this.toShip(add(q, up, Math.min(radius, height / 2)))!,
      b = this.toShip(add(q, up, Math.max(height - radius, height / 2)))!;
    if ([0, 1, 2].some((k) => Math.max(a[k]!, b[k]!) + radius < vessel.lo[k]! || Math.min(a[k]!, b[k]!) - radius > vessel.hi[k]!))
      return false;
    return vessel.bvh.capsule(a, b, radius);
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
    const free = (q: Vec3) =>
      !contact?.at(q).blocked && this.surface(this.body, q) !== false && !this.vesselBlocked(q) && !(contact && this.obstacles(q, 0.3));
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
    // (what he stands on: the ground, a deck, a roof, the vessel's back)
    const floor = this.standing(target, 0.3, 0.25),
      slope = floor - this.standing(this.q, 0.3, 0.25);
    if (this.grounded && -slope > Math.max(0.025, len(sub(target, this.q)))) target = this.q; // steep upward step: do not climb vertical terrain
    const g = this.ours
      ? (solarBody(this.body)!.mass / (len(this.q) / M_METRES) ** 2) * (299792458 ** 2 / M_METRES)
      : (this.planet(this.lastTime).m / (len(this.q) / this.metres()) ** 2) * (299792458 ** 2 / this.metres());
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
    const horizontal = target;
    target = add(target, up, this.vertical * dt);
    // (moving up or down, stopped at an underside or a crown — not crossed after the horizontal query; come down
    // on something that blocks without holding him (a crown), he rests there, free to jump off it: its own
    // coyote time renewed — what holds him (the ground, a deck, a roof, the vessel) lands him below)
    let perched = false;
    if (
      this.vertical !== 0 &&
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
      perched = this.vertical < 0;
      this.vertical = 0;
    }
    const above = this.standing(target, 0.3, 0.25);
    // (a jump leaving the ground is not a landing: only coming down, or walking over the ground)
    if ((above <= 0.02 && this.vertical <= 0) || (this.grounded && above < 0.25)) {
      target = add(target, up, -above + 0.012);
      if (!this.grounded) {
        // (the legs give on landing: a damped spring, deeper the faster the fall)
        this.dipRate = Math.min(this.dipRate, -Math.min(2, 0.6 * Math.abs(this.vertical)));
        // (the camera jolted, harder the faster the fall)
        this.jolt = Math.max(this.jolt, Math.min(1, Math.abs(this.vertical) / 6));
        this.onEvent("landed", this.body);
      }
      this.grounded = true;
      this.vertical = 0;
      this.airTime = 0;
    } else {
      this.grounded = false;
      this.airTime = perched ? 0 : this.airTime + dt;
    }
    this.dipRate += (-120 * this.dip - 22 * this.dipRate) * dt;
    this.dip = Math.max(-0.15, Math.min(0, this.dip + this.dipRate * dt));
    // (the speed along the ground: the gait's pace — a fall or a jump does not walk)
    const step = sub(target, this.q);
    this.speed = len(sub(step, scale(up, dot(step, up)))) / dt;
    this.q = target;
    // (the stride's phase with the ground covered, not the pace asked: against a wall the legs stop)
    this.phase += this.speed * dt * 3;
  }
  private placeView(time: number, dt: number) {
    const sp = this.c.spectator;
    if (!sp) return;
    Object.assign(sp.s, this.c.s, { ship: false, rotation: "free", lookAt: false, telescope: false });
    sp.s.fov = this.c.s.fov * this.runFov;
    const up = this.up(),
      f = tangent(up, add(scale(this.heading, Math.cos(this.yaw)), cross(this.heading, up), Math.sin(this.yaw)));
    // (the third person's camera, as a game's: over the right shoulder, the pivot following the head with a
    // little lag — its height dipping with the legs on a landing —, the lens a little wider running, a landing's
    // jolt)
    const s = this.c.s;
    const right = unit(cross(f, up));
    const head = add(add(this.q, up, 1.35 + 0.8 * this.dip), right, s.characterShoulder ?? 0);
    // (no time: where it was — a save restored —, else on the head)
    const target = (
      dt > 0 ? this.camPivot.step(head as V3, 0.07, dt) : (this.camPivot.x ?? (this.camPivot.reset(head as V3), head))
    ) as Vec3;
    this.camClock += dt;
    this.jolt = damp(this.jolt, 0, 0.25, dt);
    const running = this.grounded && this.speed > 0.5 * ((s.walkSpeed ?? 1.4) + (s.runSpeed ?? 4)) ? 1 : 0;
    this.runFov = damp(this.runFov, s.cineDynamicFov === false ? 1 : 1 + 0.07 * running, 0.4, dt);
    const shake = this.jolt * 0.035;
    const pitch = this.pitch + shake * fbm(this.camClock, 11, 3.3);
    const away = add(scale(f, -Math.cos(pitch)), up, Math.sin(pitch));
    let reach = this.distance;
    // (the vessel's triangles only when the camera's line passes its box at all: a box test for the whole line)
    const nearShip = this.lineNearShip(target, add(target, away, this.distance), 0.6);
    const contact = this.ours && this.body === "earth" ? this.contact() : null;
    const blocked = (d: number) => {
      const p = add(target, away, d);
      return this.height(p) < 0.2 || !!contact?.at(p, 0.2, 0.1, 0).blocked || (nearShip && this.vesselBlocked(p, 0.2, 0.4));
    };
    // (half-metre steps, the one before a hit looked at again: the quarter metre's reach for half the samples)
    for (let d = 0.5; d < this.distance + 0.25; d += 0.5) {
      const at = Math.min(d, this.distance);
      if (blocked(at)) {
        const hit = at > 0.25 && blocked(at - 0.25) ? at - 0.25 : at;
        reach = Math.max(0.3, hit - 0.3);
        break;
      }
    }
    this.camDistance = reach < this.camDistance ? reach : this.camDistance + (reach - this.camDistance) * (1 - Math.exp(-dt * 8));
    const q = add(target, away, this.camDistance);
    this.camQ = q;
    // (the view's clock: the instant it is placed for — the scene's after this step —; left where the walk
    // began, its own reads — the ground under it for ⇧T's tripod, the sky's events from here — read the Earth of
    // then, kilometres from the Earth drawn)
    sp.time = time;
    if (this.ours) {
      const X = this.world(q, time);
      sp.rigPlace(true, X, unit(sub(this.world(target, time), X)), this.worldVector(up, time), groundVelocity(this.body, X, time));
    } else {
      // (the place and the velocity at once; the proper body axes read from the eye's place and velocity, not its
      // orientation: placed there first any way round — the sphere's axes —, then turned)
      const F = this.planet(time);
      const at = toGlobal(F, { xi: scale(q, 1 / F.mPerM), w: [0, 0, 0], landed: true }),
        X = at.X,
        sf = sphericalFrame(X);
      sp.rigPlace(false, X, sf.et, sf.er, at.V);
      const axes = properBodyAxes(F, cameraFrame(sp.s));
      const world = (v: Vec3): Vec3 => {
        const z = [0, 1, 2].map((i) => axes.reduce((sum, a, j) => sum + a[i]! * v[j]!, 0)) as Vec3;
        return add(add(scale(sf.er, z[0]), sf.et, z[1]), sf.ep, z[2]);
      };
      sp.rigPlace(false, X, world(unit(sub(target, q))), world(up), at.V);
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
        F = this.planet(this.lastTime);
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
          ...(this.camPivot.x ? { pivot: [...this.camPivot.x] as Vec3 } : {}),
        }
      : null;
  }
  restore(s: CharacterSave) {
    // (a save loaded is not a new exit: no event to TARS; its point as saved — on a roof, a deck, the vessel)
    const err = this.prepare(s.body, s.ours, s.q, s.forward, true);
    if (!err) {
      this.q = [...s.q];
      this.heading = tangent(this.up(), s.heading ?? s.forward);
      this.yaw = s.yaw;
      this.pitch = s.pitch;
      this.distance = s.distance;
      this.vertical = s.vertical;
      // (what he stood on: the ground, a deck, a roof, the vessel — the ground's height alone landed him again
      // from a roof, a jolt and a "landed")
      this.grounded = Math.abs(this.standing(this.q, 0.3, 0.25)) < 0.1;
      // (restored in the air: no coyote jump there)
      this.airTime = this.grounded ? 0 : COYOTE_S;
      this.camPivot.reset(s.pivot ? ([...s.pivot] as V3) : null);
      this.placeView(this.c.viewTime(), 0);
    }
    return err;
  }
  /**
   * Where the explorer stands, as a map and a compass read it: the latitude and longitude [°] (the Earth's
   * geodetic), the height above the datum and above the ground [m], the datum's radius [m], the azimuths [°] he
   * faces and the camera looks along, his speed [m/s]. Null: not walking.
   */
  place() {
    if (!this.active) return null;
    const deg = 180 / Math.PI;
    const q = this.q;
    let lat: number, lon: number, altM: number, radiusM: number;
    if (this.ours) {
      radiusM = solarBody(this.body)!.radius * M_METRES;
      const g = cartToGeodetic(radiusM, flatteningOf(this.body), q);
      [lat, lon, altM] = [g.lat * deg, g.lon * deg, g.h];
    } else {
      const F = this.planet(this.lastTime);
      radiusM = F.R * F.mPerM;
      const r = len(q);
      [lat, lon, altM] = [Math.asin(q[2] / r) * deg, Math.atan2(q[1], q[0]) * deg, r - radiusM];
    }
    const up = this.up();
    const look = tangent(up, add(scale(this.heading, Math.cos(this.yaw)), cross(this.heading, up), Math.sin(this.yaw)));
    return {
      body: this.body,
      lat,
      lon,
      altM,
      aglM: this.height(),
      radiusM,
      headingDeg: azimuthDeg(up, tangent(up, this.heading)),
      viewDeg: azimuthDeg(up, look),
      speedMs: this.speed,
    };
  }
  /**
   * Where a point of our universe stands in the walker's sky (home frame, its position [M]): its azimuth from the
   * north and its elevation above the local horizontal [°] — the compass's marks (the Sun, the Moon, the target).
   * Null: walking on Gargantua's side (another sky), or not walking.
   */
  skyAzEl(P: Vec3): { az: number; el: number } | null {
    if (!this.active || !this.ours) return null;
    const up = this.up();
    const { east, north } = localAxes(up);
    const W = this.world(this.q);
    const dir = unit(sub(P, W));
    const [e, n, u] = [east, north, up].map((v) => dot(dir, this.worldVector(v as Vec3)));
    return { az: ((Math.atan2(e!, n!) * 180) / Math.PI + 360) % 360, el: (Math.asin(Math.max(-1, Math.min(1, u!))) * 180) / Math.PI };
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
