// The fleet: where each spacecraft is (vessels.ts). One is flown — the camera rides it: its place is the
// camera's (controls.ts gives it here each frame). The others either coast on a Kepler orbit around the
// body they were left near (the Earth: two-body, their attitude held still), or are docked: to the flown
// one, to each other, to the space station. Docked craft form a rigid assembly; its pieces' places follow
// from one of them — the flown one, else the station, else the one the assembly coasts as.
//
// Home frame, M units (lengths, times), velocities in c; the docking links in metres.

import type { Vec3 } from "./physics";
import { keplerProp } from "./system/our-plan";
import { ourState } from "./system/our-side";
import { M_METRES, solarBody } from "./system/solar";
import { issAxes, issOrbit, issTrack } from "./system/iss";
import { dockedFrame, VESSELS, VESSEL_IDS, type VesselId } from "./vessels";
import { cross, dot, lin, sub } from "./math/vec3";

/** A craft's place: centre (the ship frame's origin), velocity, its axes (x left, y up, z nose; unit, home). */
export interface Pose {
  X: Vec3;
  V: Vec3;
  ax: [Vec3, Vec3, Vec3];
  /** how it turns: its angular velocity (home frame) [rad per M of time] */
  w?: Vec3;
  /** its assembly's centre of mass velocity, when it differs from the origin's (a turning assembly) */
  Vc?: Vec3;
}

/**
 * Coasting: its state at a time, around a body — its assembly's centre of mass on a Kepler orbit (`V` its
 * velocity), the assembly turning about it at a steady rate (`w`: no torque, its moment of inertia a
 * scalar), `com` that centre in this craft's frame [m].
 */
export interface FreeState extends Pose {
  t: number;
  ref: string;
  com?: Vec3;
}

/** v turned by the rotation vector r (Rodrigues) */
function rotate(v: Vec3, r: Vec3): Vec3 {
  const th = Math.hypot(...r);
  if (th < 1e-15) return v;
  const k = lin(r, 1 / th, r, 0);
  const c = Math.cos(th),
    s = Math.sin(th);
  return lin(lin(v, c, cross(k, v), s), 1, k, dot(k, v) * (1 - c));
}

/**
 * A docking: b held on a (a craft, or the station) — b's frame in a's: its centre [m] and its axes
 * (columns: b's x, y, z on a's axes); the ports met (indices in VESSELS[…].ports, or the station's).
 */
export interface DockLink {
  a: VesselId | "iss";
  b: VesselId;
  pa: number;
  pb: number;
  c: Vec3;
  ax: [Vec3, Vec3, Vec3];
}

const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** a frame's vector (its components) on the axes A (home) */
const onAxes = (A: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => lin(lin(A[0], v[0], A[1], v[1]), 1, A[2], v[2]);
/** a home vector's components on the axes A */
const inAxes = (A: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [dot(v, A[0]), dot(v, A[1]), dot(v, A[2])];

export class Fleet {
  /** the craft flown */
  active: VesselId = "ranger";
  /** the coasting ones (not flown, not docked to something that carries them) */
  free: Partial<Record<VesselId, FreeState>> = {};
  links: DockLink[] = [];
  /** the flown craft's place now (controls.ts) */
  activePose: (() => (Pose & { t: number }) | null) | null = null;

  /** The craft (and the station) docked together with id, id included. */
  assembly(id: VesselId | "iss"): (VesselId | "iss")[] {
    const out = new Set<VesselId | "iss">([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const l of this.links) {
        if (out.has(l.a) !== out.has(l.b)) {
          out.add(l.a);
          out.add(l.b);
          grew = true;
        }
      }
    }
    return [...out];
  }

  /** The flown craft's assembly (the station left out): its craft. */
  flownAssembly(): VesselId[] {
    return this.assembly(this.active).filter((v): v is VesselId => v !== "iss");
  }

  /** Whether the flown craft's assembly is held by the station. */
  heldByStation() {
    return this.assembly(this.active).includes("iss");
  }

  /** The station's pose at t (its centre, velocity and axes; LVLH), or null. */
  private stationPose(t: number): Pose | null {
    const st = issTrack.peek(t) ?? issOrbit(t);
    if (!st) return null;
    return { X: st.X, V: st.V, ax: issAxes(st.X, st.V, t) };
  }

  /** A coasting craft's pose at t: Kepler around its body, its attitude held. */
  private coast(f: FreeState, t: number): Pose {
    const mu = solarBody(f.ref)?.mass ?? solarBody("earth")!.mass;
    const B0 = ourState(f.ref, f.t),
      B1 = ourState(f.ref, t);
    const w = f.w ?? [0, 0, 0];
    const com = f.com ?? [0, 0, 0];
    // the centre of mass on its orbit; the axes turned about it
    const C0 = lin(f.X, 1, onAxes(f.ax, com), 1 / M_METRES);
    const k = keplerProp(mu, sub(C0, B0.pos), sub(f.V, B0.vel), t - f.t);
    const C = lin(B1.pos, 1, k.r, 1),
      Vc = lin(B1.vel, 1, k.v, 1);
    const r = lin(w, t - f.t, w, 0);
    const ax = f.ax.map((a) => rotate(a, r)) as [Vec3, Vec3, Vec3];
    const X = lin(C, 1, onAxes(ax, com), -1 / M_METRES);
    return { X, V: lin(Vc, 1, cross(w, sub(X, C)), 1), ax, w, Vc };
  }

  /**
   * A craft's pose at t (null: unknown — the flown one's before the controller gave it, the station's
   * when it is not known). The flown one's own is the controller's, at its time.
   */
  pose(id: VesselId, t: number, fromStation = false): Pose | null {
    const group = this.assembly(id);
    // the root: the flown craft, else the station, else the one the assembly coasts as (fromStation: the
    // station even with the flown craft in the assembly — where the station carries it)
    let root: VesselId | "iss" | null = null;
    let P: Pose | null = null;
    // (the flown craft's place: the camera's — while it is flown; left, it coasts as the others)
    const flown = group.includes(this.active) && !(fromStation && group.includes("iss")) ? (this.activePose?.() ?? null) : null;
    if (flown) {
      root = this.active;
      P = flown;
    } else if (group.includes("iss")) {
      root = "iss";
      P = this.stationPose(t);
    } else {
      const anchor = group.find((g) => g !== "iss" && this.free[g as VesselId]) as VesselId | undefined;
      if (anchor) {
        root = anchor;
        P = this.coast(this.free[anchor]!, t);
      }
    }
    if (!root || !P) return null;
    return (this.posesFrom(root, P, t).get(id) as Pose | undefined) ?? null;
  }

  /**
   * The places of an assembly's pieces from one of them (its pose at t): the links walked from it — the
   * station's frame turning (a point of it moves with ω × r), the craft's held still against each other.
   */
  posesFrom(root: VesselId | "iss", P: Pose, t: number): Map<VesselId | "iss", Pose> {
    const seen = new Set<VesselId | "iss">([root]);
    const poses = new Map<VesselId | "iss", Pose>([[root, P]]);
    const queue: (VesselId | "iss")[] = [root];
    let om: Vec3 | null = null;
    if (root === "iss") {
      const E = ourState("earth", t);
      const r = sub(P.X, E.pos),
        v = sub(P.V, E.vel);
      om = lin(cross(r, v), 1 / dot(r, r), r, 0);
    }
    while (queue.length) {
      const u = queue.shift()!;
      const Pu = poses.get(u)!;
      for (const l of this.links) {
        const fwd = l.a === u && !seen.has(l.b);
        const back = l.b === u && !seen.has(l.a);
        if (!fwd && !back) continue;
        const w = fwd ? l.b : l.a;
        let X: Vec3, ax: [Vec3, Vec3, Vec3];
        if (fwd) {
          X = lin(Pu.X, 1, onAxes(Pu.ax, l.c), 1 / M_METRES);
          ax = l.ax.map((c) => onAxes(Pu.ax, c)) as [Vec3, Vec3, Vec3];
        } else {
          // (a's frame in b's: the inverse — the axes transposed, the centre −Rᵀ c)
          const Rt: [Vec3, Vec3, Vec3] = [0, 1, 2].map((i) => [l.ax[0][i]!, l.ax[1][i]!, l.ax[2][i]!]) as [Vec3, Vec3, Vec3];
          const c = lin(onAxes(Rt, l.c), -1, l.c, 0);
          X = lin(Pu.X, 1, onAxes(Pu.ax, c), 1 / M_METRES);
          ax = Rt.map((col) => onAxes(Pu.ax, col)) as [Vec3, Vec3, Vec3];
        }
        // (a rigid assembly: each point's velocity the root's plus the turn's, ω × r)
        const spin = om ?? P.w ?? null;
        const V = spin ? lin(P.V, 1, cross(spin, sub(X, P.X)), 1) : Pu.V;
        poses.set(w, { X, V, ax: ax.map(unit) as [Vec3, Vec3, Vec3], w: om ?? P.w, Vc: P.Vc });
        seen.add(w);
        queue.push(w);
      }
    }
    return poses;
  }

  /** The ports a craft's links hold (their indices). */
  usedPorts(id: VesselId | "iss"): Set<number> {
    const used = new Set<number>();
    for (const l of this.links) {
      if (l.a === id) used.add(l.pa);
      if (l.b === id) used.add(l.pb);
    }
    return used;
  }

  /** Every craft but the flown one (or, none flown, all of them), where it is at t. */
  others(t: number, all = false): { id: VesselId; pose: Pose }[] {
    const out: { id: VesselId; pose: Pose }[] = [];
    for (const id of VESSEL_IDS) {
      if (id === this.active && !all) continue;
      const p = this.pose(id, t);
      if (p) out.push({ id, pose: p });
    }
    return out;
  }

  /** An assembly's mass [kg], its centre of mass and moment of inertia (a scalar: Σ m (k² + d²)) in one
   *  of its craft's frame [m] (the flown one's by default). */
  massProps(root: VesselId = this.active): { mass: number; com: Vec3; inertia: number; own: number } {
    const me = VESSELS[root];
    const own = me.mass * me.gyr * me.gyr;
    const group = this.assembly(root).filter((v) => v !== "iss");
    if (group.length < 2) return { mass: me.mass, com: me.com, inertia: own, own };
    // each piece's frame in the flown one's (the links walked from it)
    const frames = new Map<VesselId, { c: Vec3; ax: [Vec3, Vec3, Vec3] }>([
      [
        root,
        {
          c: [0, 0, 0],
          ax: [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
        },
      ],
    ]);
    const queue: VesselId[] = [root];
    while (queue.length) {
      const u = queue.shift()!;
      const F = frames.get(u)!;
      for (const l of this.links) {
        if (l.a === "iss") continue;
        const fwd = l.a === u && !frames.has(l.b);
        const back = l.b === u && !frames.has(l.a as VesselId);
        if (!fwd && !back) continue;
        const w = (fwd ? l.b : l.a) as VesselId;
        let c: Vec3, ax: [Vec3, Vec3, Vec3];
        if (fwd) {
          c = l.c;
          ax = l.ax;
        } else {
          const Rt: [Vec3, Vec3, Vec3] = [0, 1, 2].map((i) => [l.ax[0][i]!, l.ax[1][i]!, l.ax[2][i]!]) as [Vec3, Vec3, Vec3];
          c = lin(onAxes(Rt, l.c), -1, l.c, 0);
          ax = Rt;
        }
        frames.set(w, { c: lin(F.c, 1, onAxes(F.ax, c), 1), ax: ax.map((v) => onAxes(F.ax, v)) as [Vec3, Vec3, Vec3] });
        queue.push(w);
      }
    }
    let mass = 0;
    let com: Vec3 = [0, 0, 0];
    for (const [id, F] of frames) {
      const v = VESSELS[id];
      mass += v.mass;
      com = lin(com, 1, lin(F.c, 1, onAxes(F.ax, v.com), 1), v.mass);
    }
    com = lin(com, 1 / mass, com, 0);
    let inertia = 0;
    for (const [id, F] of frames) {
      const v = VESSELS[id];
      const d = sub(lin(F.c, 1, onAxes(F.ax, v.com), 1), com);
      inertia += v.mass * (v.gyr * v.gyr + dot(d, d));
    }
    return { mass, com, inertia, own };
  }

  /** Sets a craft coasting from a pose (the body it coasts around: the Earth near it, else the Sun). */
  /** Sets a craft coasting: its pose, its assembly's centre-of-mass velocity `Vc` (default: its own
   *  velocity), the assembly's turn and that centre in its frame [m]. */
  setFree(id: VesselId, p: Pose, t: number, com: Vec3 = [0, 0, 0]) {
    const E = ourState("earth", t);
    const near = Math.hypot(...sub(p.X, E.pos)) * M_METRES < 1.5e9;
    const w = p.w && Math.hypot(...p.w) > 0 ? p.w : undefined;
    this.free[id] = { X: p.X, V: p.Vc ?? p.V, ax: p.ax, w, com, t, ref: near ? "earth" : "sun" };
  }

  /** A link's other craft frame relative to one: b's centre and axes in a's frame, from their poses. */
  static relative(a: Pose, b: Pose): { c: Vec3; ax: [Vec3, Vec3, Vec3] } {
    return { c: inAxes(a.ax, lin(sub(b.X, a.X), M_METRES, b.X, 0)), ax: b.ax.map((v) => inAxes(a.ax, v)) as [Vec3, Vec3, Vec3] };
  }

  /** Serialised for the URL / a saved scene. */
  toJSON() {
    return { free: this.free, links: this.links };
  }
}

export const fleet = new Fleet();

/**
 * The fleet's start near the Earth (a scene's): the Endurance on a circular orbit 800 km up, the Lander
 * on one 500 km up, both in the space station's plane (a rendezvous needs no change of plane) — the
 * Lander 25° ahead of the station, the Endurance 40° behind it; flying along their velocity, their top
 * to the zenith. The craft flown keeps its own place; the Ranger, when it is not flown, docked on the
 * Endurance's fore port (as in the film).
 */
export function fleetStart(t: number, active: VesselId): Record<VesselId, Pose> {
  fleet.active = active;
  fleet.free = {};
  fleet.links = [];
  const mu = solarBody("earth")!.mass;
  const E = ourState("earth", t);
  const iss = issOrbit(t);
  // (the station's plane, or 51.6° from the equator)
  let e1: Vec3, h: Vec3;
  if (iss) {
    e1 = unit(sub(iss.X, E.pos));
    h = unit(cross(sub(iss.X, E.pos), sub(iss.V, E.vel)));
  } else {
    const i = (51.6 * Math.PI) / 180;
    e1 = [1, 0, 0];
    h = [0, -Math.sin(i), Math.cos(i)];
  }
  const e2 = cross(h, e1);
  const R = solarBody("earth")!.radius;
  const circ = (altKm: number, du: number): Pose => {
    const r = R + (altKm * 1e3) / M_METRES;
    const u = (du * Math.PI) / 180;
    const rh = lin(e1, Math.cos(u), e2, Math.sin(u));
    const vh = lin(e1, -Math.sin(u), e2, Math.cos(u));
    const z = vh,
      y = rh,
      x = cross(y, z);
    return { X: lin(E.pos, 1, rh, r), V: lin(E.vel, 1, vh, Math.sqrt(mu / r)), ax: [x, y, z] };
  };
  const end = circ(800, -40),
    lan = circ(500, 25);
  if (active !== "endurance") fleet.setFree("endurance", end, t);
  if (active !== "lander") fleet.setFree("lander", lan, t);
  // (the Ranger on the Endurance's fore port, its rear hatch in, its top along the Endurance's)
  const host = VESSELS.endurance.ports[0]!,
    guest = VESSELS.ranger.ports[0]!;
  const { c, ax } = dockedFrame(guest, host, [0, 1, 0]);
  if (active !== "ranger") fleet.links.push({ a: "endurance", b: "ranger", pa: 0, pb: 0, c, ax });
  const ran: Pose = {
    X: lin(end.X, 1, onAxes(end.ax, c), 1 / M_METRES),
    V: end.V,
    ax: ax.map((v) => onAxes(end.ax, v)) as [Vec3, Vec3, Vec3],
  };
  return { endurance: end, lander: lan, ranger: ran };
}
