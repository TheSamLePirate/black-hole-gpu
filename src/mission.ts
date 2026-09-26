// The Interstellar mission, flown by the Ranger's own systems from start to finish: from our side of
// the wormhole, through it, into orbit around Gargantua, a plane change into the companion star's
// orbital plane, a transfer to the star and an orbit around it. Each phase uses what a pilot would —
// the engine, the attitude holds, the autopilots, the flight planner's nodes — and the camera moves
// between the ship's attach points like a film's cuts. The script only decides when; the physics
// (Kerr geodesics, the star's pull, finite burns) does the rest.

import { cameraFrame } from "./camera";
import type { CameraController } from "./controls";
import { shipToCamera, type Mount } from "./mounts";
import { zamo, type Vec3 } from "./physics";
import { circularSpeed, type Hold } from "./pilot";
import type { Settings } from "./settings";
import { toMouth, mouth } from "./wormhole";

export const MISSION_PRESET = "Interstellar: wormhole to Gargantua";

interface Phase {
  key: string;
  /** the caption: a title and a line */
  title: string;
  line: () => string;
  enter?: () => void;
  /** true when the phase is over */
  step: (dt: number) => boolean;
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export class Mission {
  active = false;
  private i = -1;
  /** wall seconds in the phase (the video steps them at its own rate) */
  private t = 0;
  private phases: Phase[];
  private vExit = 0.2;
  private rExit = 21;
  private note = "";
  /** the camera director: turn the view on its mount towards a body (eased), or back to the mount's */
  private aim: "hole" | "star" | null = null;
  /** how far the view turns towards it (1: centred; less keeps the ship in the frame) */
  private aimK = 0.6;
  private geodesic = true;
  /** the hull's lighting: on our side of the wormhole only starlight falls on it — a film light there,
   *  eased back to the physical lighting on arrival */
  private light = 1;
  private lightTo = 1;
  private mark = 0;
  private el: HTMLElement;
  private shown = "";
  onStart?: () => void;
  onEnd?: () => void;

  constructor(private s: Settings, private cam: CameraController, private say: (t: string) => void) {
    this.el = document.createElement("div");
    this.el.className = "mission-caption";
    this.el.innerHTML = "<small></small><b></b><span></span>";
    document.body.append(this.el);
    const P = cam.pilot;
    const info = () => cam.flightInfo();
    const region = () => cameraFrame(s).region;
    const mount = (m: Mount) => (s.shipMount = m);
    const hold = (h: Hold) => (P.hold = h);
    const warp = (w: number) => (s.timeSpeed = w);
    this.phases = [
      {
        key: "start",
        title: "Endurance · Ranger 1",
        line: () => "Our side of the wormhole — Gargantua waits on the other side",
        enter: () => {
          mount("quarter");
          warp(2);
          hold("radialIn");
        },
        step: () => this.t > 5,
      },
      {
        key: "ignition",
        title: "Main engine",
        line: () => `Accelerating to ${this.vExit.toFixed(2)} c towards the throat`,
        enter: () => {
          mount("wing");
          P.throttle = 1;
        },
        step: () => {
          if (info().speed < this.vExit) return false;
          P.throttle = 0;
          return this.t > 2;
        },
      },
      {
        key: "throat",
        title: "The wormhole",
        line: () => "Through the throat: a sphere, 1.5 M across",
        enter: () => {
          mount("chase");
          hold("prograde");
          warp(7);
        },
        step: () => region() === "hole" && this.t > 1,
      },
      {
        key: "arrival",
        title: "Gargantua",
        line: () => `The other side · r = ${info().r.toFixed(1)} M · circularizing`,
        enter: () => {
          mount("quarter");
          warp(5);
          P.setAuto("circularize");
          hold("prograde");
          this.aim = "hole"; // the reveal: the view turns to Gargantua
          this.lightTo = this.light; // the disk's light now
        },
        step: () => {
          const i = info();
          const settled = Number.isFinite(i.wantSpeed) && Math.abs(i.speed - i.wantSpeed) < 2e-3 && Math.abs(i.vr) < 2e-3;
          if (!(settled && this.t > 4) && this.t < 10) return false;
          P.auto = "none";
          return true;
        },
      },
      {
        // this orbit comes back through the mouth one turn later: up, clear of the gluing sphere
        key: "raise",
        title: "Orbit raise",
        line: () => this.note,
        enter: () => {
          const r2 = Math.ceil(Math.hypot(...(mouth(s).C as Vec3)) + mouth(s).rGlue + 4);
          const msg = cam.planTransfer("orbit", r2);
          this.note = cam.plan.nodes.length ? `${noteOf(cam.plan.note)} — clear of the wormhole's mouth` : msg;
          if (!cam.plan.nodes.length) return;
          P.setAuto("node");
          hold("prograde");
          mount("quarter");
        },
        step: () => {
          this.burnCameras("chase", "quarter");
          this.aim = "hole";
          this.aimK = info().plan?.burning ? 0.55 : 0.5;
          if (P.auto === "node") return false;
          // (then the circularize autopilot, a few seconds)
          if (!this.mark) this.mark = this.t;
          if (this.t - this.mark < 5) return false;
          this.mark = 0;
          P.auto = "none";
          return true;
        },
      },
      {
        key: "orbit",
        title: "In orbit around Gargantua",
        line: () => {
          const i = info();
          return `r = ${i.r.toFixed(1)} M · ${(i.speed).toFixed(3)} c · one hour here, ${(1 / i.dtau).toFixed(2)} hours far away`;
        },
        enter: () => {
          hold("prograde"); // (flying forwards: the best views, the wings in the orbital plane)
          warp(22);
        },
        step: () => {
          this.aim = this.t < 6 ? "hole" : null;
          if (this.t > 6 && s.shipMount === "quarter") mount("dorsal");
          return this.t > 13;
        },
      },
      {
        key: "align",
        title: "Plane change",
        line: () => this.note,
        enter: () => {
          const msg = cam.planAlign("star");
          this.note = cam.plan.nodes.length ? noteOf(cam.plan.note) : "Already in the star's orbital plane";
          if (!cam.plan.nodes.length) return;
          this.say(msg);
          P.setAuto("node");
          hold("prograde");
          mount("quarter");
        },
        step: () => {
          this.burnCameras("chase", "quarter");
          this.aim = info().plan?.burning ? "hole" : null;
          this.aimK = 0.35;
          return P.auto !== "node";
        },
      },
      {
        key: "transfer",
        title: "Transfer to the companion star",
        line: () => this.note,
        enter: () => {
          const msg = cam.planTransfer("star", 30, { orbitStar: true });
          this.note = cam.plan.nodes.length ? noteOf(cam.plan.note) : msg;
          this.say(msg);
          if (!cam.plan.nodes.length) return;
          P.setAuto("node");
          hold("prograde");
          mount("quarter");
        },
        step: () => {
          this.burnCameras("chase", "quarter");
          const i = info();
          // the departure burn looks back at Gargantua, the arrival one at the star
          this.aim = i.plan?.burning ? (i.plan.nodes.length > 1 ? "hole" : "star") : null;
          this.aimK = 0.4;
          return P.auto !== "node";
        },
      },
      {
        key: "star",
        title: "In orbit around the companion star",
        line: () => {
          const i = info();
          return `${(i.targetDist ?? 0).toFixed(1)} M from its centre · Gargantua ${i.r.toFixed(0)} M away`;
        },
        enter: () => {
          if (P.auto !== "orbit") P.setAuto("orbit");
          hold("prograde");
          mount("quarter");
          warp(12);
        },
        step: () => {
          // prograde around the star: the view turns to it now and then
          this.aim = this.t < 8 || this.t > 15 ? "star" : null;
          if (this.t > 8 && s.shipMount === "quarter") mount("belly");
          if (this.t > 15 && s.shipMount === "belly") mount("chase");
          return this.t > 24;
        },
      },
    ];
  }

  /** Starts from the Interstellar scene (already applied): the Ranger on our side of the wormhole. */
  start() {
    const s = this.s;
    s.ship = true;
    s.wormhole = true;
    s.sun = true;
    s.target = "wormhole";
    this.cam.setPilot(true);
    this.geodesic = s.showGeodesic;
    this.light = s.shipLight;
    s.shipLight = this.lightTo = Math.max(12, this.light);
    s.showGeodesic = false; // (the film: no path drawn in the view)
    this.aim = null;
    this.aimK = 0.6;
    const m = mouth(s);
    // leave the far mouth moving along the orbit's tangent, where it meets the gluing sphere at right
    // angles to the radius: a nearly circular orbit around Gargantua on arrival
    const C = m.C as Vec3;
    const D = Math.hypot(...C);
    const Ch: Vec3 = [C[0] / D, C[1] / D, C[2] / D];
    const t0 = norm(cross([0, 0, 1], Ch)); // prograde, around the spin axis
    const sa = Math.min(m.rGlue / D, 0.6);
    const dir = norm([t0[0] * Math.sqrt(1 - sa * sa) - Ch[0] * sa, t0[1] * Math.sqrt(1 - sa * sa) - Ch[1] * sa, t0[2] * Math.sqrt(1 - sa * sa) - Ch[2] * sa]);
    const X: Vec3 = [C[0] + dir[0] * m.rGlue, C[1] + dir[1] * m.rGlue, C[2] + dir[2] * m.rGlue];
    this.rExit = Math.hypot(...X);
    const th = Math.acos(X[2] / this.rExit);
    this.vExit = circularSpeed(this.rExit, s.spin, true, zamo(this.rExit, th, s.spin)) ?? 0.2;
    // the same direction in the mouth's frame (rep): on our side, heading for the throat along it
    const n = toMouth(m, dir);
    const up = toMouth(m, [0, 0, 1]);
    const top = norm(cross(cross(n, up), n)); // ⟂ n, towards the spin axis
    this.cam.placeShipRep(-16, n, [n[0] * 0.02, n[1] * 0.02, n[2] * 0.02], n, top);
    this.active = true;
    this.onStart?.();
    this.i = -1;
    this.next();
  }

  stop(why?: string) {
    if (!this.active) return;
    this.active = false;
    this.s.showGeodesic = this.geodesic;
    this.s.shipLight = this.light;
    this.cam.setLook(0, 0);
    this.el.classList.remove("on");
    this.shown = "";
    if (why) this.say(why);
    this.onEnd?.();
  }

  /** The caption shown (step, title, line), for the automation (a video's subtitles). */
  get captionText(): [string, string, string] {
    const [a, b, c] = this.el.children as unknown as HTMLElement[];
    return this.el.classList.contains("on") ? [a!.textContent ?? "", b!.textContent ?? "", c!.textContent ?? ""] : ["", "", ""];
  }

  /** Phase name, for the HUD and the automation. */
  get phase() {
    return this.active ? this.phases[this.i]?.key ?? "" : "";
  }

  /**
   * The camera director: eases the view on its mount so that the chosen body comes into the frame
   * (most of the way there, the ship still in the foreground), or back to the mount's own view.
   */
  private direct(dt: number) {
    const s = this.s;
    let yaw = 0, pitch = 0;
    if (this.aim) {
      const i = this.cam.flightInfo();
      const c = this.aim === "hole" ? i.dirs.radialIn : i.dirs.target;
      if (c) {
        // camera → ship components (rows of S: the camera's axes in the ship's frame), then the
        // mount's own view (no look)
        const S = i.S;
        const v: Vec3 = [0, 1, 2].map((j) => c[0] * S[0]![j]! + c[1] * S[1]![j]! + c[2] * S[2]![j]!) as Vec3;
        const S0 = shipToCamera(this.cam.shipPose(), 0, 0).S;
        const b = S0.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) as Vec3;
        yaw = (Math.atan2(b[0], b[2]) * 180) / Math.PI;
        pitch = (Math.atan2(b[1], Math.hypot(b[0], b[2])) * 180) / Math.PI;
        // most of the way: the body a little off-centre, towards the ship
        yaw *= this.aimK;
        // (never down through the hull)
        pitch = Math.min(Math.max(pitch * this.aimK, -8), 60);
      }
    }
    const k = 1 - Math.exp(-dt / 1.1);
    const y = s.shipLookYaw + (yaw - s.shipLookYaw) * k;
    const p = s.shipLookPitch + (pitch - s.shipLookPitch) * k;
    if (Math.abs(y - s.shipLookYaw) + Math.abs(p - s.shipLookPitch) > 1e-3 || (!this.aim && (s.shipLookYaw || s.shipLookPitch))) {
      this.cam.setLook(Math.abs(y) < 0.05 && !this.aim ? 0 : y, Math.abs(p) < 0.05 && !this.aim ? 0 : p);
    }
  }

  private next() {
    this.i++;
    this.t = 0;
    this.aim = null;
    this.aimK = 0.6;
    const ph = this.phases[this.i];
    if (!ph) return this.finish();
    ph.enter?.();
  }

  private finish() {
    this.active = false;
    this.s.showGeodesic = this.geodesic;
    this.s.shipLight = this.light;
    this.cam.setLook(0, 0);
    this.caption("Mission complete", "The Ranger keeps its orbit — take the controls whenever you like");
    setTimeout(() => {
      if (!this.active) this.el.classList.remove("on");
    }, 6000);
    this.onEnd?.();
  }

  /** During a node's burn, one attach point; while coasting, another. */
  private burnCameras(burn: Mount, coast: Mount) {
    const b = !!this.cam.flightInfo().plan?.burning;
    const want = b ? burn : coast;
    if (this.s.shipMount !== want && this.t > 0.5) this.s.shipMount = want;
  }

  update(dt: number) {
    if (!this.active) return;
    const ph = this.phases[this.i];
    if (!ph) return;
    if (!this.s.animate) return; // paused: the mission waits
    this.t += dt;
    this.direct(dt);
    if (this.s.shipLight !== this.lightTo) {
      const l = this.lightTo + (this.s.shipLight - this.lightTo) * Math.exp(-dt / 1.5);
      this.s.shipLight = Math.abs(l - this.lightTo) < 0.01 ? this.lightTo : l;
    }
    if (!this.s.ship || !this.cam.piloting) return this.stop("Mission stopped");
    // past the throat, the mission lives in Gargantua's universe
    const past = this.phases.findIndex((p) => p.key === "arrival");
    if (this.i >= past && cameraFrame(this.s).region !== "hole") return this.stop("Mission stopped: back in the wormhole");
    this.caption(ph.title, ph.line(), `${this.i + 1} / ${this.phases.length}`);
    if (ph.step(dt)) this.next();
  }

  private caption(title: string, line: string, step = "") {
    const key = [title, line, step].join("|");
    if (key === this.shown) return;
    this.shown = key;
    const [st, b, sp] = this.el.children as unknown as HTMLElement[];
    st!.textContent = step ? `Mission · ${step}` : "Mission";
    b!.textContent = title;
    sp!.textContent = line;
    this.el.classList.add("on");
  }
}

/** A planner note, as a caption line. */
function noteOf(n: string) {
  return n.charAt(0).toUpperCase() + n.slice(1);
}
