// The CameraController — docking: the ports, the approach, the contact.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { recorder } from "../game/recorder";
import { gradeDocking } from "../game/report";
import { cameraFrame, setHomePose } from "../camera";
import type { Vec3 } from "../physics";
import { type Body, isCraft } from "../targeting";
import type { MountPose } from "../mounts";
import { fleet, type Pose } from "../fleet";
import { dockedFrame, VESSEL_IDS, VESSELS, type VesselId } from "../vessels";
import { mouth } from "../wormhole";
import { gravityHome, homeOf, ourState, repToHomeVec } from "../system/our-side";
import { issAxes, issTrack, m34apply, m34unapply, partTransforms, station, stationAngles, type M34 } from "../system/iss";
import { stationHulls, vesselHulls, type TriBVH } from "../system/collide";
import { C_MPS, M_METRES, M_SECONDS } from "../units";
import { cross, dot as dot3, lin, sub as sub3 } from "../math/vec3";
import { frameNow } from "../frameclock";

import type { CameraController, DockInfo } from "../controls";
import { onAxesV, unitV } from "./util";

declare module "../controls" {
  interface CameraController {
    dockGeometry: typeof dockGeometry;
    stationCam: typeof stationCam;
    contactPose: typeof contactPose;
    stationContact: typeof stationContact;
    dockCheck: typeof dockCheck;
    linkView: typeof linkView;
    flyDocked: typeof flyDocked;
    undock: typeof undock;
    dockWant: typeof dockWant;
    targetBlocks: typeof targetBlocks;
    ownTurn: typeof ownTurn;
  }
}

/**
 * The free docking ports of the flown assembly (the flown craft's and those docked to it) and of
 * what it can dock to — the space station near it, the other craft within 5 km — now: the nearest
 * pair (or the one asked for: a target, a port of it). For it: the rings' offset along the target
 * port's axis and across it, the closing rate, the drift across, the angle between the two ports'
 * axes (docked, they face each other). Null: nothing within 5 km, or not on our side.
 */
function dockGeometry(this: CameraController, only?: { target: VesselId | "iss"; port?: number }): DockInfo | null {
  const s = this.s;
  const cam = cameraFrame(s);
  const nav = this.ourNav(cam);
  const me = nav ? this.activePoseNow() : null;
  if (!nav || !me) return null;
  const t = nav.t;
  const m = 1 / M_METRES;
  const C = C_MPS;
  // the flown assembly's free ports
  const frames = fleet.posesFrom(fleet.active, me, t);
  if (frames.has("iss")) return null;
  const own: { v: VesselId; k: number; c: Vec3; a: Vec3 }[] = [];
  for (const [v, P] of frames) {
    if (v === "iss") continue;
    const used = fleet.usedPorts(v);
    VESSELS[v].ports.forEach((p, k) => {
      if (!used.has(k)) own.push({ v, k, c: lin(P.X, 1, onAxesV(P.ax, p.centre), m), a: onAxesV(P.ax, p.axis) });
    });
  }
  if (!own.length) return null;
  // what it can dock to: its pose, its turn (the station's: once an orbit), its free ports
  const targets: { id: VesselId | "iss"; title: string; P: Pose; om: Vec3; ports: { k: number; name: string; c: Vec3; a: Vec3 }[] }[] = [];
  if (s.iss && station.ports.length && (!only || only.target === "iss")) {
    const st = issTrack.state(t, nav.X);
    if (st && issTrack.near) {
      const A = issAxes(st.X, st.V, t);
      const E = ourState("earth", t);
      const r = sub3(st.X, E.pos),
        v = sub3(st.V, E.vel);
      const used = fleet.usedPorts("iss");
      targets.push({
        id: "iss",
        title: "ISS",
        P: { X: st.X, V: st.V, ax: A },
        om: lin(cross(r, v), 1 / dot3(r, r), r, 0),
        ports: station.ports.flatMap((p, k) =>
          used.has(k) ? [] : [{ k, name: p.name, c: lin(st.X, 1, onAxesV(A, p.centre), m), a: onAxesV(A, p.axis) }],
        ),
      });
    }
  }
  for (const id of VESSEL_IDS) {
    if (frames.has(id) || (only && only.target !== id)) continue;
    const P = fleet.pose(id, t);
    if (!P || Math.hypot(...sub3(P.X, nav.X)) * M_METRES > 5200) continue;
    const used = fleet.usedPorts(id);
    targets.push({
      id,
      title: VESSELS[id].name,
      P,
      // (its turn as it coasts — the tumbling Endurance's: its ports' points move with it)
      om: P.w ?? [0, 0, 0],
      ports: VESSELS[id].ports.flatMap((p, k) =>
        used.has(k) ? [] : [{ k, name: p.name, c: lin(P.X, 1, onAxesV(P.ax, p.centre), m), a: onAxesV(P.ax, p.axis) }],
      ),
    });
  }
  let best: DockInfo | null = null;
  for (const T of targets) {
    for (const tp of T.ports) {
      if (only?.port !== undefined && only.port !== tp.k) continue;
      for (const op of own) {
        const d = lin(sub3(op.c, tp.c), M_METRES, op.c, 0);
        const along = dot3(d, tp.a);
        const lateral = Math.hypot(...lin(d, 1, tp.a, -along));
        const range = Math.hypot(...d);
        if (best && range >= best.range) continue;
        // (relative to the target's point where the ring is: its turn, if it turns — co-orbiting is at rest)
        const vp = lin(T.P.V, 1, cross(T.om, sub3(op.c, T.P.X)), 1);
        // (the ring's own velocity: the ship's and its turn's — its ring off its roll axis, a turning ship's
        // circles: read as the ship's alone, a drift of ω × r against a still ring held the final back)
        const vring = lin(nav.V, 1, cross(this.ownTurn(me.ax), sub3(op.c, nav.X)), 1);
        const vrel = lin(sub3(vring, vp), C, nav.V, 0);
        const closing = -dot3(vrel, tp.a);
        const angle = (Math.acos(Math.max(-1, Math.min(1, -dot3(op.a, tp.a)))) * 180) / Math.PI;
        // (the turns apart: the flown craft's against the target's [deg/s])
        const spin = (Math.hypot(...sub3(this.ownTurn(me.ax), T.om)) / M_SECONDS) * (180 / Math.PI);
        best = {
          target: T.id,
          title: T.title,
          port: tp.k,
          name: tp.name,
          own: op.v,
          ownPort: op.k,
          range,
          along,
          lateral,
          closing,
          lateralRate: Math.hypot(...lin(vrel, 1, tp.a, -dot3(vrel, tp.a))),
          angle,
          spin,
          docked: false,
          ring: op.c,
          ownAxis: op.a,
          c: tp.c,
          a: tp.a,
          X: me.X,
          sh: me.ax,
          tgt: { X: T.P.X, V: T.P.V },
          A: T.P.ax,
          om: T.om,
          vrel,
        };
      }
    }
  }
  return best;
}

/**
 * The target's docking camera, in the ship's frame: on the nearest port's axis (docked: the one held),
 * 40 cm out from its ring, looking out along it (the ship coming in, centred when on the axis); null
 * away from any (or before the first step's geometry).
 */
function stationCam(this: CameraController): MountPose | null {
  // (the last step's geometry: the ship's axes come from the camera through this very mount)
  const g = this.dockInfo ?? this.dockedView;
  if (!g) return null;
  const m = 1 / M_METRES;
  const toShip = (P: Vec3): Vec3 => {
    const d = lin(sub3(P, g.X), M_METRES, P, 0);
    return [dot3(d, g.sh[0]), dot3(d, g.sh[1]), dot3(d, g.sh[2])];
  };
  const eye = lin(g.c, 1, g.a, 0.4 * m);
  return { eye: toShip(eye), aim: toShip(lin(eye, 1, g.a, 20 * m)) };
}

/** The ship for contacts near the station or another craft: its centre, velocity and axes (home), its time. */
function contactPose(this: CameraController) {
  if (this.docked || this.undocking || !vesselHulls[fleet.active].bvh) return null;
  // (a ring on a port's axis, facing it, within a metre and a half: the docking systems meet — the hull's
  // own collar touches the adapter's 40 cm out, before the capture's 30; the capture or the port's
  // bounce (dockCheck) answers)
  const g = this.dockInfo;
  if (g && g.along < 1.5 && g.along > -0.6 && g.lateral < 0.3 && g.angle < 10) return null;
  const s = this.s;
  const cam = cameraFrame(s);
  const nav = this.ourNav(cam);
  if (!nav) return null;
  const w = mouth(s).w;
  const ax = this.shipAxesLocal({ right: cam.right, up: cam.up, fwd: cam.fwd }).map((a) => unitV(repToHomeVec(w, cam.ell, cam.n, a))) as [
    Vec3,
    Vec3,
    Vec3,
  ];
  return { t: nav.t, X: nav.X, V: nav.V, ax };
}

/**
 * Contact over the step just flown, with the space station and with the craft not docked to the flown
 * one: every hull point's path (in each obstacle part's own frame — the station's arrays turn) against
 * the part, and every vertex of the obstacle near the ship along its path relative to the hull, against
 * the hull. At the first crossing the ship is set back to it (2 cm clear), its velocity against the
 * surface turned back (a third of it) and its slide damped; its spin stopped. A craft hit takes its
 * share of the blow (their masses).
 */
function stationContact(this: CameraController, p0: NonNullable<ReturnType<CameraController["contactPose"]>>) {
  const p1 = this.contactPose();
  if (!p1) return;
  const hull = vesselHulls[fleet.active];
  const R = hull.radius;
  // the obstacles: each with its parts (a hierarchy in its rest frame, the part's frame → the
  // obstacle's at t0 and t1), its frame (home axes, centre) at t0 and t1, its velocity field at t1
  interface Obstacle {
    id: VesselId | "iss";
    parts: { bvh: TriBVH; M0: M34; M1: M34 }[];
    A0: [Vec3, Vec3, Vec3];
    A1: [Vec3, Vec3, Vec3];
    X0: Vec3;
    X1: Vec3;
    V1: Vec3;
    om: Vec3;
  }
  const obstacles: Obstacle[] = [];
  if (issTrack.near && stationHulls.length && station.joints.length) {
    const i0 = issTrack.state(p0.t, p0.X),
      i1 = issTrack.state(p1.t, p1.X);
    if (i0 && i1 && Math.hypot(...sub3(p1.X, i1.X)) * M_METRES < 75 + R) {
      const T0 = partTransforms(station.joints, stationAngles(p0.t, i0.X, i0.V)),
        T1 = partTransforms(station.joints, stationAngles(p1.t, i1.X, i1.V));
      const E = ourState("earth", p1.t);
      const r = sub3(i1.X, E.pos),
        v = sub3(i1.V, E.vel);
      obstacles.push({
        id: "iss",
        parts: stationHulls.flatMap((bvh, k) => (bvh ? [{ bvh, M0: T0[k]!, M1: T1[k]! }] : [])),
        A0: issAxes(i0.X, i0.V, p0.t),
        A1: issAxes(i1.X, i1.V, p1.t),
        X0: i0.X,
        X1: i1.X,
        V1: i1.V,
        om: lin(cross(r, v), 1 / dot3(r, r), r, 0),
      });
    }
  }
  const I34: M34 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0, 0, 0],
  ] as unknown as M34;
  for (const id of VESSEL_IDS) {
    if (fleet.flownAssembly().includes(id)) continue;
    const h = vesselHulls[id];
    if (!h.bvh) continue;
    const q0 = fleet.pose(id, p0.t),
      q1 = fleet.pose(id, p1.t);
    if (!q0 || !q1 || Math.hypot(...sub3(p1.X, q1.X)) * M_METRES > h.radius + R + 50) continue;
    obstacles.push({ id, parts: [{ bvh: h.bvh, M0: I34, M1: I34 }], A0: q0.ax, A1: q1.ax, X0: q0.X, X1: q1.X, V1: q1.V, om: [0, 0, 0] });
  }
  if (!obstacles.length) return;
  let best: { t: number; n: Vec3; o: Obstacle } | null = null;
  for (const o of obstacles) {
    const toO = (A: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [dot3(v, A[0]), dot3(v, A[1]), dot3(v, A[2])];
    // the ship in the obstacle's frame [m]: its centre, its axes (columns)
    const c0 = toO(o.A0, lin(sub3(p0.X, o.X0), M_METRES, p0.X, 0)),
      c1 = toO(o.A1, lin(sub3(p1.X, o.X1), M_METRES, p1.X, 0));
    const R0 = p0.ax.map((a) => toO(o.A0, a)) as [Vec3, Vec3, Vec3],
      R1 = p1.ax.map((a) => toO(o.A1, a)) as [Vec3, Vec3, Vec3];
    const place = (c: Vec3, Rm: [Vec3, Vec3, Vec3], q: Vec3): Vec3 => lin(lin(c, 1, Rm[0], q[0]), 1, lin(Rm[1], q[1], Rm[2], q[2]), 1);
    const local = (c: Vec3, Rm: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => {
      const d = sub3(v, c);
      return [dot3(d, Rm[0]), dot3(d, Rm[1]), dot3(d, Rm[2])];
    };
    const sweep = Math.hypot(...sub3(c1, c0));
    for (const { bvh, M0, M1 } of o.parts) {
      // (the part's box against the ship's swept sphere, in its rest frame)
      const [lo, hi] = bvh.bounds();
      const cm = m34unapply(M1, lin(c0, 0.5, c1, 0.5));
      const rr = R + sweep;
      let away = false;
      for (let a = 0; a < 3; a++) if (cm[a]! + rr < lo[a]! || cm[a]! - rr > hi[a]!) away = true;
      if (away) continue;
      // the hull's points along their paths, against the part
      for (const q of hull.points) {
        const a = m34unapply(M0, place(c0, R0, q)),
          b = m34unapply(M1, place(c1, R1, q));
        const h = bvh.segment(a, b);
        if (h && (!best || h.t < best.t)) {
          const n = m34apply(M1, h.n, 0);
          const mv = sub3(b, a);
          best = { t: h.t, n: dot3(m34apply(M1, mv, 0), n) > 0 ? lin(n, -1, n, 0) : n, o };
        }
      }
      // the part's vertices near the ship, along their paths relative to the hull, against it
      for (const vi of bvh.verticesNear(cm, rr)) {
        const pv: Vec3 = [bvh.pos[3 * vi]!, bvh.pos[3 * vi + 1]!, bvh.pos[3 * vi + 2]!];
        const a = local(c0, R0, m34apply(M0, pv)),
          b = local(c1, R1, m34apply(M1, pv));
        // (outside the hull's box all along: nothing to meet)
        const L = hull.lo,
          H = hull.hi;
        let out = false;
        for (let q = 0; q < 3; q++) if (Math.max(a[q]!, b[q]!) < L[q]! - 0.05 || Math.min(a[q]!, b[q]!) > H[q]! + 0.05) out = true;
        if (out) continue;
        const h = hull.bvh!.segment(a, b);
        if (h && (!best || h.t < best.t)) {
          // (the ship pushed along the vertex's motion relative to it)
          const mv = lin(lin(R1[0], b[0] - a[0], R1[1], b[1] - a[1]), 1, R1[2], b[2] - a[2]);
          let n = lin(lin(R1[0], h.n[0], R1[1], h.n[1]), 1, R1[2], h.n[2]);
          if (dot3(n, mv) < 0) n = lin(n, -1, n, 0);
          best = { t: h.t, n, o };
        }
      }
    }
    // (back to the ship's frame of reference: c0, c1 for the set-back)
    if (best && best.o === o) ((best as { c0?: Vec3; c1?: Vec3 }).c0 = c0), ((best as { c1?: Vec3 }).c1 = c1);
  }
  if (!best) return;
  const hit = best as { t: number; n: Vec3; o: Obstacle; c0: Vec3; c1: Vec3 };
  const o = hit.o;
  const s = this.s;
  const cam = cameraFrame(s);
  const w = mouth(s).w;
  const toHome = (v: Vec3): Vec3 => lin(lin(o.A1[0], v[0], o.A1[1], v[1]), 1, o.A1[2], v[2]);
  // set back along the step to the contact, 2 cm clear of the surface
  const back = lin(lin(sub3(hit.c1, hit.c0), -(1 - hit.t), hit.c0, 0), 1, hit.n, 0.02);
  const X = lin(p1.X, 1, toHome(back), 1 / M_METRES);
  // the velocity against the obstacle's surface where it is (the station turning: ω × r)
  const Vo = lin(o.V1, 1, cross(o.om, sub3(X, o.X1)), 1);
  const N = toHome(hit.n);
  const vrel = sub3(p1.V, Vo);
  const vn = dot3(vrel, N);
  let V = p1.V;
  if (vn < 0) {
    // (a craft coasting takes its share: the blow split by the masses; the station, docked craft: none)
    const mMe = fleet.massProps().mass;
    const free = o.id !== "iss" && !fleet.assembly(o.id).includes("iss");
    const mO = free ? fleet.assembly(o.id).reduce((a, v) => a + (v === "iss" ? 0 : VESSELS[v as VesselId].mass), 0) : Infinity;
    const kMe = Number.isFinite(mO) ? mO / (mMe + mO) : 1;
    const vt = lin(vrel, 1, N, -vn);
    // (the closing speed turned back by a third, the slide damped — relative to the obstacle)
    const dvRel = lin(lin(N, -1.3 * vn, vt, -0.3), 1, [0, 0, 0], 0);
    V = lin(p1.V, 1, dvRel, kMe);
    if (free) {
      const Q = fleet.pose(o.id as VesselId, p1.t);
      const anchor = fleet.assembly(o.id).find((v) => v !== "iss" && fleet.free[v as VesselId]) as VesselId | undefined;
      if (Q && anchor) {
        const QA = fleet.pose(anchor, p1.t)!;
        fleet.setFree(anchor, { X: QA.X, V: lin(QA.Vc ?? QA.V, 1, dvRel, -(1 - kMe)), ax: QA.ax, w: QA.w }, p1.t, fleet.free[anchor]?.com);
      }
    }
  }
  setHomePose(s, X, unitV(repToHomeVec(w, cam.ell, cam.n, cam.fwd)), unitV(repToHomeVec(w, cam.ell, cam.n, cam.up)), V);
  this.pilot.omega = [0, 0, 0];
  this.sync();
  const now = performance.now();
  if (now - this.lastContactMsg > 1500) {
    this.lastContactMsg = now;
    this.onPilotMessage?.(`Contact with the ${o.id === "iss" ? "ISS" : VESSELS[o.id].name} · ${(Math.abs(vn) * C_MPS).toFixed(2)} m/s`);
  }
}

/**
 * After each step: the docking aid's figures, and the capture — the rings within 30 cm, slower than
 * 0.5 m/s, the ports' axes facing within 10°: a link (fleet.ts) — the flown assembly and what it docks
 * to one rigid assembly, their momenta shared; on a port too fast or off its axis, a bounce.
 */
function dockCheck(this: CameraController) {
  const D = this.dockAuto;
  const g = this.dockGeometry(this.pilot.auto === "dock" && D ? { target: D.target, port: D.port } : undefined);
  this.dockInfo = g && g.range < 5000 ? g : null;
  this.dockedView = this.linkView();
  if (!g || this.docked) return;
  // (just undocked: no capture until the rings are a metre clear)
  if (this.undocking) {
    if (g.range < 1) return;
    this.undocking = false;
  }
  const speed = Math.hypot(...g.vrel);
  // (closing in, or at rest against it: not on the rebound)
  // (and turning together: within 3°/s of the target's turn — a craft met still against the tumbling
  // Endurance's hub, its ring turning 18°/s against the port, does not latch)
  const capture =
    g.along < 0.3 && g.along > -0.6 && g.lateral < 0.3 && g.angle < 10 && g.spin < SPIN_MAX && speed < 0.5 && g.closing > -0.02;
  const s = this.s;
  const cam = cameraFrame(s);
  const nav = this.ourNav(cam);
  if (!nav) return;
  const w = mouth(s).w;
  if (!capture && g.along < 0.05 && g.along > -2 && g.lateral < 1.5) {
    // against the port too fast, or off its axis: it bounces (a third of its closing speed back), the
    // ring set back on the port's face — no passing through
    const va = dot3(g.vrel, g.a); // [m/s], < 0: towards the target
    if (va < 0) {
      const V = lin(nav.V, 1, g.a, (-1.3 * va) / C_MPS);
      const X = lin(nav.X, 1, g.a, (0.05 - g.along) / M_METRES);
      setHomePose(s, X, unitV(repToHomeVec(w, cam.ell, cam.n, cam.fwd)), unitV(repToHomeVec(w, cam.ell, cam.n, cam.up)), V);
      this.sync();
      // (what failed of the capture's terms — each said, none taken for another: the angle once named
      // for a ring come in too far)
      const why =
        speed >= 0.5
          ? `${speed.toFixed(2)} m/s — 0.5 at most`
          : g.lateral >= 0.3
            ? `${g.lateral.toFixed(2)} m off its axis — 0.3 at most`
            : g.angle >= 10
              ? `the ports ${g.angle.toFixed(0)}° apart — 10 at most`
              : g.spin >= SPIN_MAX
                ? `turning ${g.spin.toFixed(1)}°/s against it — ${SPIN_MAX} at most`
                : g.along <= -0.6
                  ? `${(-g.along).toFixed(2)} m into the port — 0.6 at most`
                  : `moving away at ${(-g.closing).toFixed(2)} m/s`;
      this.onPilotMessage?.(`Bounced off the ${g.title}'s port · ${why}`);
    }
    return;
  }
  if (!capture) return;
  // captured: the rings together, the axes facing, the roll kept — the craft whose port it is held on
  // the target's (its frame in the target's)
  const t = nav.t;
  const host = g.target === "iss" ? station.ports[g.port]! : VESSELS[g.target].ports[g.port]!;
  const guest = VESSELS[g.own].ports[g.ownPort]!;
  const ownPose = fleet.posesFrom(fleet.active, this.activePoseNow()!, t).get(g.own)!;
  const toT = (v: Vec3): Vec3 => [dot3(v, g.A[0]), dot3(v, g.A[1]), dot3(v, g.A[2])];
  const { c, ax } = dockedFrame(guest, host, toT(ownPose.ax[1]));
  // (the momenta shared: the assembly's velocity, the target coasting — the station holds what docks to it)
  const mMe = fleet.massProps().mass;
  const tgtGroup = g.target === "iss" ? [] : fleet.assembly(g.target);
  const held = g.target === "iss" || tgtGroup.includes("iss");
  const mT = tgtGroup.reduce((a, v) => a + (v === "iss" ? 0 : VESSELS[v as VesselId].mass), 0);
  const tgtPose = g.target === "iss" ? null : fleet.pose(g.target, t);
  // (their turns shared too: the assembly's the inertia-weighted mean of the two — the flown assembly's and
  // the target's, each about its own centre: the tumbling Endurance keeps turning with the Ranger on it)
  const wMe = this.ownTurn(ownPose.ax);
  const wT = tgtPose?.w ?? ([0, 0, 0] as Vec3);
  const iMe = fleet.massProps().inertia;
  const iT = g.target === "iss" ? 0 : fleet.massProps(g.target).inertia;
  const wAll = held ? null : lin(wMe, iMe / (iMe + iT), wT, iT / (iMe + iT));
  fleet.links.push({ a: g.target, b: g.own, pa: g.port, pb: g.ownPort, c, ax });
  for (const v of fleet.assembly(fleet.active)) if (v !== "iss") delete fleet.free[v as VesselId];
  if (!held && tgtPose) {
    // the flown craft where the link puts it, from the target (it does not jump)
    const V = lin(nav.V, mMe / (mMe + mT), tgtPose.V, mT / (mMe + mT));
    const P = fleet.posesFrom(g.target, { X: tgtPose.X, V, ax: tgtPose.ax }, t).get(fleet.active)!;
    this.placeOnPose({ X: P.X, V, ax: P.ax });
    // (the assembly turning: the pilot's rates — per second of its clock, the other way round from the
    // right-hand rule — on the flown craft's axes)
    if (wAll && Math.hypot(...wAll) > 0) this.pilot.omega = P.ax.map((a) => -dot3(wAll, a) * s.timeSpeed) as Vec3;
  } else if (held) {
    // held by the station: at once where it carries the craft, at its port's velocity — not the approach's
    // until the next frame's hold: a craft let go before it (undocked at once) once kept the 9 cm/s it
    // came in with, ran back into the port past the springs' 5 cm/s and bounced
    const P = fleet.pose(fleet.active, t, true);
    if (P) this.placeOnPose({ X: P.X, V: P.V, ax: P.ax });
  }
  this.pilot.auto = "none";
  this.pilot.throttle = 0;
  if (!wAll) this.pilot.omega = [0, 0, 0];
  this.dockInfo = null;
  // (the target now part of the assembly: the body it orbits instead)
  if (fleet.flownAssembly().includes(s.target as VesselId)) this.selectTarget(nav.ref as Body);
  this.onPilotMessage?.(
    `Docked to the ${g.title} · ${g.name}${g.own !== fleet.active ? ` (the ${VESSELS[g.own].name}'s ${guest.name})` : ""} · ${speed.toFixed(2)} m/s`,
  );
  // (the docking's report — game/report.ts —: the capture's figures graded)
  const S = recorder.samples;
  this.onFlightReport?.(
    gradeDocking({
      target: g.title,
      port: g.name,
      closing: speed,
      lateral: g.lateral,
      angle: g.angle,
      spin: g.spin,
      dv: this.spent * C_MPS,
      flightS: S.length > 1 ? S[S.length - 1]!.t - S[0]!.t : Number.NaN,
    }),
  );
}

/** The port the flown craft holds (its first link), and its place: the station's camera's view. */
function linkView(this: CameraController): { c: Vec3; a: Vec3; X: Vec3; sh: [Vec3, Vec3, Vec3] } | null {
  const me = fleet.active;
  const l = fleet.links.find((q) => q.a === me || q.b === me);
  if (!l) return null;
  const P = this.activePoseNow();
  if (!P) return null;
  const t = P.t;
  const other = l.a === me ? l.b : l.a;
  const k = l.a === me ? l.pb : l.pa;
  let Q: { X: Vec3; ax: [Vec3, Vec3, Vec3] } | null = null;
  if (other === "iss") {
    const st = issTrack.peek(t);
    if (st) Q = { X: st.X, ax: issAxes(st.X, st.V, t) };
  } else Q = (this.docked ? fleet.pose(other, t, true) : fleet.posesFrom(me, P, t).get(other)) ?? null;
  if (!Q) return null;
  const port = other === "iss" ? station.ports[k] : VESSELS[other as VesselId].ports[k];
  if (!port) return null;
  return {
    c: lin(Q.X, 1, onAxesV(Q.ax as [Vec3, Vec3, Vec3], port.centre), 1 / M_METRES),
    a: onAxesV(Q.ax as [Vec3, Vec3, Vec3], port.axis),
    X: P.X,
    sh: P.ax,
  };
}

/** Held by the station: the flown craft where the station carries it (its centre, axes, velocity), for this frame. */
function flyDocked(this: CameraController, dt: number) {
  const s = this.s;
  const t0 = this.nowTime();
  const simDt = s.animate ? s.timeSpeed * dt : 0;
  const t1 = t0 + simDt;
  const cam = cameraFrame(s);
  const w = mouth(s).w;
  const iss = issTrack.state(t1, homeOf(w, cam.ell, cam.n));
  const P = iss ? fleet.pose(fleet.active, t1, true) : null;
  if (!P) return this.undock();
  const S = this.shipMatrix();
  const camAx = (k: number) => lin(lin(P.ax[0], S[k]![0], P.ax[1], S[k]![1]), 1, P.ax[2], S[k]![2]);
  setHomePose(s, P.X, unitV(camAx(2)), unitV(camAx(1)), P.V);
  s.motion = "geodesic";
  this.pilot.omega = [0, 0, 0];
  this.properTime += simDt;
  this.shipTime = t1;
  this.sync();
  this.dockCheck();
}

/**
 * Lets the flown craft go of what it is docked to (its own links; the springs push it 5 cm/s away
 * from the first port): what is left coasts (or stays on the station), as its own assembly.
 */
function undock(this: CameraController) {
  const me = fleet.active;
  const mine = fleet.links.filter((l) => l.a === me || l.b === me);
  if (!mine.length) return;
  const s = this.s;
  const cam = cameraFrame(s);
  const nav = this.ourNav(cam);
  const P = this.activePoseNow();
  if (!nav || !P) {
    fleet.links = fleet.links.filter((l) => !mine.includes(l));
    return;
  }
  const t = nav.t;
  const held = this.docked;
  // every craft's place before (the station carrying them, or the flown one)
  const before = new Map<VesselId, Pose>();
  for (const v of VESSEL_IDS) {
    const q = held ? fleet.pose(v, t, true) : fleet.pose(v, t);
    if (q) before.set(v, q);
  }
  // the push: away from the first port held (the flown craft's own port's axis, reversed)
  const l0 = mine[0]!;
  const myPort = VESSELS[me].ports[l0.a === me ? l0.pa : l0.pb]!;
  const out = onAxesV(P.ax, myPort.axis);
  fleet.links = fleet.links.filter((l) => !mine.includes(l));
  this.undocking = true;
  // (the pieces left: each assembly without the flown craft nor the station coasts as one of them)
  for (const v of VESSEL_IDS) {
    if (v === me) continue;
    const group = fleet.assembly(v);
    if (group.includes(me) || group.includes("iss") || group.some((q) => q !== "iss" && fleet.free[q as VesselId])) continue;
    const q = before.get(v);
    if (!q) continue;
    // (turning with the assembly: about the pieces' own centre of mass, its velocity the rigid one there)
    const com = fleet.assembly(v).length > 1 ? fleet.massProps(v).com : ([0, 0, 0] as Vec3);
    const C = lin(q.X, 1, onAxesV(q.ax, com), 1 / M_METRES);
    const Vc = q.w ? lin(q.V, 1, cross(q.w, sub3(C, q.X)), 1) : q.V;
    fleet.setFree(v, { X: q.X, V: Vc, ax: q.ax, w: q.w }, t, com);
  }
  const V = lin(P.V, 1, out, -0.05 / C_MPS);
  setHomePose(s, P.X, unitV(repToHomeVec(mouth(s).w, cam.ell, cam.n, cam.fwd)), unitV(repToHomeVec(mouth(s).w, cam.ell, cam.n, cam.up)), V);
  this.sync();
  if (this.pilot.auto === "dock") this.pilot.auto = "none";
  const names = mine.map((l) => (l.a === me ? l.b : l.a)).map((v) => (v === "iss" ? "the ISS" : `the ${VESSELS[v as VesselId].name}`));
  this.onPilotMessage?.(`Undocked from ${names.join(" and ")}`);
}

/**
 * The last of a rendezvous, flown on the thrusters alone (the flown assembly's free port facing the
 * target's — the main engine would push it off the axis):
 *  - off the axis: to a point on it (30 – 200 m out); if the target stands in the way (lines a hull's
 *    width apart cast against it), round it first — on a sphere about its centre, stepping towards the
 *    axis;
 *  - in the approach corridor (a cone about the axis): closing at 0.08 m/s + 1.2 % of the distance
 *    (3 m/s at most — 0.1 m/s at the contact), the offset across the axis taken out as it closes;
 *  - 10 m out: a hold until the ring is within 10 cm of the axis, the ports within 2° and the drift
 *    still; then the final approach, to the capture (dockCheck) — docked, it lets go.
 * The relative motion is the target's frame's (the station's turns: its point where the ring is), the
 * tide between them (and the station's turn's pull) fed forward. The warp: ×10 beyond 150 m, ×5
 * beyond 40, ×2 beyond 4, real time for the last 4 m (with auto warp; otherwise the pilot's, no higher).
 */
function dockWant(
  this: CameraController,
  nav: NonNullable<ReturnType<CameraController["ourNav"]>>,
  say: (t: string) => null,
  out: (v: Vec3, ff?: Vec3) => { beta: Vec3; ff: Vec3 },
): { beta: Vec3; ff: Vec3 } | null {
  const s = this.s;
  if (!this.dockAuto) {
    // (the target's port if it is in reach, else the nearest)
    const want = s.target === "iss" || isCraft(s.target) ? (s.target as VesselId | "iss") : null;
    const g0 = (want ? this.dockGeometry({ target: want }) : null) ?? this.dockGeometry();
    if (!g0 || g0.range > 3000)
      return say("Docking: within 3 km of a free port — the ISS's, a craft's (a PLAN with it as the target brings the ship 200 m off it)");
    this.dockAuto = {
      target: g0.target,
      port: g0.port,
      phase: "",
      att: null,
      warp: s.timeSpeed,
      set: NaN,
      corridor: false,
      final: false,
      blocked: false,
      checked: -1e9,
    };
    this.onPilotMessage?.(
      `Docking autopilot · the ${g0.title}'s ${g0.name} · ${g0.range < 1000 ? `${g0.range.toFixed(0)} m` : `${(g0.range / 1000).toFixed(2)} km`}`,
    );
  }
  const D = this.dockAuto;
  const g = this.dockGeometry({ target: D.target, port: D.port });
  if (!g) return say(`Docking: the ${D.target === "iss" ? "ISS" : VESSELS[D.target].name} is out of reach`);
  const C = C_MPS;
  const a = g.a,
    A = g.A;
  // the attitude: the own port's axis against the target's, the top to the target's up (the station's
  // zenith; a craft's own top) — a rotation from two pairs of directions
  const sh = g.sh;
  const toMe = (v: Vec3): Vec3 => [dot3(v, sh[0]), dot3(v, sh[1]), dot3(v, sh[2])];
  const pa = unitV(toMe(g.ownAxis));
  let ua: Vec3 = Math.abs(pa[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  ua = unitV(lin(ua, 1, pa, -dot3(ua, pa)));
  let ub0 = D.target === "iss" ? lin(A[2], -1, A[2], 0) : A[1];
  if (Math.abs(dot3(ub0, a)) > 0.7) ub0 = D.target === "iss" ? A[0] : A[2];
  const pb = lin(a, -1, a, 0);
  const ub = unitV(lin(ub0, 1, pb, -dot3(ub0, pb)));
  const wa = cross(pa, ua),
    wb = cross(pb, ub);
  const R = (v: Vec3): Vec3 => {
    const x = dot3(v, pa),
      y = dot3(v, ua),
      z = dot3(v, wa);
    return lin(lin(pb, x, ub, y), 1, wb, z);
  };
  const loc = (v: Vec3) => unitV(nav.toRep(v));
  // (and the target's turn, carried as the pilot's rates on the ship's axes — per second of its clock, the
  // other way round from the right-hand rule: ownTurn's —, flown ahead of the attitude's error: the
  // tumbling Endurance's 18°/s, chased on the error alone, were never caught — the roll's error went
  // round past 180° and the pilot turned back)
  D.att = { nose: loc(R([0, 0, 1])), up: loc(R([0, 1, 0])), rate: sh.map((x) => -dot3(g.om, x) * s.timeSpeed) as Vec3 };
  // the ring against the port [m]; the target's point there, its motion and pull
  const along = g.along,
    lat = g.lateral;
  const d = lin(sub3(g.ring, g.c), M_METRES, a, 0);
  const latv = lin(d, 1, a, -along);
  const om = g.om;
  // (the target's point followed: on its port's axis, abeam the ring — not where the ring is: off the axis
  // of a craft turning about it, that point circles, and the Ranger following it 5 m out spent all its
  // thrusters' push on the circle's pull (ω²r: 0.5 m/s² at 18°/s), never nearer; the axis stays put)
  const rho = sub3(lin(g.c, 1, a, Math.max(along, 0) / M_METRES), g.tgt.X);
  const Vp = lin(g.tgt.V, 1, cross(om, rho), 1);
  const ff = lin(sub3(gravityHome(g.tgt.X, nav.t).acc, gravityHome(nav.X, nav.t).acc), 1, cross(om, cross(om, rho)), 1);
  // the warp: by the range (the pilot's own, if lower, without auto warp)
  const real = 1 / M_SECONDS;
  const cap = (g.range > 150 ? 10 : g.range > 40 ? 5 : g.range > 4 ? 2 : 1) * real;
  this.setHubWarp(cap);
  D.set = s.timeSpeed;
  // (the lateral gain within what the velocity loop follows at this warp: damped)
  const Ts = 1.2 * s.timeSpeed * M_SECONDS;
  // (0.15 at most: at 0.08 the orbit's relative drift held a ring 10 cm off the axis at contact — at the
  // IDSS's limit; the velocity loop follows twice that at real time)
  const kLat = Math.min(0.15, 0.3 / Math.max(Ts, 1e-3));
  const cone = 1 + 0.15 * Math.max(along, 0);
  D.corridor = along > -0.5 && lat < (D.corridor ? 1.5 : 1) * cone;
  let want: Vec3; // relative to the target's point [m/s]
  if (D.corridor) {
    let vc = Math.min(3, 0.08 + 0.012 * Math.max(along, 0));
    // 10 m out: held until on the axis, the ports facing, the drift still (and kept so)
    const aligned = D.final ? lat < 0.2 && g.angle < 5 : lat < 0.1 && g.angle < 2 && g.lateralRate < 0.04;
    D.final = along < 12 && aligned;
    if (along < 12 && !aligned) vc = Math.max(Math.min(vc, 0.05 * (along - 10)), -0.1);
    // (the last metres: slower while the ring is more than 4 cm off the axis — its alignment given time
    // before the contact, not met at the capture's edge)
    if (D.final && along < 3) vc *= Math.min(Math.max((0.1 - lat) / 0.06, 0.25), 1);
    D.phase = along >= 12 ? "APPROACH" : D.final ? "FINAL" : "HOLD 10 m";
    let vl = lin(latv, -kLat, latv, 0);
    const vll = Math.hypot(...vl);
    if (vll > 0.4) vl = lin(vl, 0.4 / vll, vl, 0);
    want = lin(a, -vc, vl, 1);
  } else {
    D.final = false;
    // to the axis: a point on it, round the target if it stands in the way
    const S = Math.min(Math.max(along, 30), 200);
    const G = lin(g.c, 1, a, S / M_METRES);
    const now = frameNow();
    if (now - D.checked > 250) {
      D.checked = now;
      D.blocked = this.targetBlocks(D.target, g.ring, G, nav.t, g);
    }
    let P = G;
    if (D.blocked) {
      const Rm = D.target === "iss" ? 130 : vesselHulls[D.target].radius + 60;
      const Rs = Rm / M_METRES;
      const u = unitV(sub3(g.ring, g.tgt.X)),
        gd = unitV(sub3(lin(g.c, 1, a, Rm / M_METRES), g.tgt.X));
      const th = Math.acos(Math.max(-1, Math.min(1, dot3(u, gd))));
      const step = Math.min(th, (30 * Math.PI) / 180);
      // (u turned towards gd by the step, in their plane)
      const w0 = lin(gd, 1, u, -dot3(gd, u));
      const wl = Math.hypot(...w0);
      const w = wl > 1e-9 ? lin(u, Math.cos(step), w0, Math.sin(step) / wl) : u;
      P = lin(g.tgt.X, 1, w, Rs);
    }
    const to = lin(sub3(P, g.ring), M_METRES, P, 0);
    const dist = Math.hypot(...to);
    const sp = Math.min(3, Math.sqrt(2 * 0.03 * dist), 0.1 * dist);
    want = dist > 1e-6 ? lin(to, sp / dist, to, 0) : [0, 0, 0];
    D.phase = D.blocked
      ? D.target === "iss"
        ? "AROUND THE STATION"
        : `AROUND THE ${VESSELS[D.target].name.toUpperCase()}`
      : "TO THE AXIS";
  }
  // (the ring's motion is the ship's and its own turn's: turning with the tumbling Endurance, the Ranger's
  // ring, 1.1 m off its roll axis, circles — the ship's velocity is the ring's wanted less ω × r, its
  // acceleration less the circle's pull; without, held 10 m out, the ring stayed 1.3 m off the axis)
  const wOwn = this.ownTurn(sh);
  const rr = sub3(g.ring, nav.X);
  return out(lin(lin(Vp, 1, want, 1 / C), 1, cross(wOwn, rr), -1), lin(ff, 1, cross(wOwn, cross(wOwn, rr)), -1));
}

/**
 * Whether the ship going straight from p to q (its ring; home frame) would meet what it docks to:
 * five lines — its own and four a hull's radius about it — cast against the station's parts as they
 * are now, or the craft's hull.
 */
function targetBlocks(this: CameraController, target: VesselId | "iss", p: Vec3, q: Vec3, t: number, g: DockInfo): boolean {
  const A = g.A;
  const toT = (P: Vec3): Vec3 => {
    const d = lin(sub3(P, g.tgt.X), M_METRES, P, 0);
    return [dot3(d, A[0]), dot3(d, A[1]), dot3(d, A[2])];
  };
  const a = toT(p),
    b = toT(q);
  const dir = unitV(sub3(b, a));
  const e1 = unitV(cross(dir, Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const e2 = cross(dir, e1);
  const R = Math.max(vesselHulls[fleet.active].radius, 5) + 3;
  const offs: Vec3[] = [[0, 0, 0], lin(e1, R, e1, 0), lin(e1, -R, e1, 0), lin(e2, R, e2, 0), lin(e2, -R, e2, 0)];
  if (target !== "iss") {
    const bvh = vesselHulls[target].bvh;
    return !!bvh && offs.some((o) => bvh.segment(lin(a, 1, o, 1), lin(b, 1, o, 1)) !== null);
  }
  if (!stationHulls.length || !station.joints.length) return false;
  const st = issTrack.peek(t);
  if (!st) return false;
  const T = partTransforms(station.joints, stationAngles(t, st.X, st.V));
  return stationHulls.some(
    (bvh, k) => bvh && offs.some((o) => bvh.segment(m34unapply(T[k]!, lin(a, 1, o, 1)), m34unapply(T[k]!, lin(b, 1, o, 1))) !== null),
  );
}

/** The turns apart a capture allows [deg/s]. */
export const SPIN_MAX = 3;

/**
 * The flown craft's turn (home, rad per M): the pilot's rates — per second of its clock, the other way
 * round from the right-hand rule (fleet.ts switchVessel's) — on its axes `ax`.
 */
function ownTurn(this: CameraController, ax: [Vec3, Vec3, Vec3]): Vec3 {
  const k = -1 / Math.max(this.s.timeSpeed, 1e-30);
  const o = this.pilot.omega;
  return lin(lin(ax[0], k * o[0], ax[1], k * o[1]), 1, ax[2], k * o[2]);
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installDocking(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    dockGeometry,
    stationCam,
    contactPose,
    stationContact,
    dockCheck,
    linkView,
    flyDocked,
    undock,
    dockWant,
    targetBlocks,
    ownTurn,
  });
}
