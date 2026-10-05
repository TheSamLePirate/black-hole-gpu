// The CameraController — the flight computer's operations.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import type { Vec3 } from "../physics";
import type { Target } from "../settings";
import { bodyCentre, BODY_NAMES, type Body, bodyVelocity, isCraft } from "../targeting";
import { fuelOn, tank } from "../engine";
import { attitudeFor } from "../entry";
import { siteDir, type Site } from "../game/sites";
import type { SiteTrack } from "../fc/land-ops";
import { elements as kepElements, fromPNR, propagate as kepProp, type V3 as KV3 } from "../fc/kepler";
import type { Burn, FcContext, OpResult } from "../fc/ops";
import { engineTrail, tipTrail, type ContrailSource } from "../contrails";
import {
  kApoapsis,
  kCircularize,
  kerrOrbit,
  kHohmann,
  kInclination,
  kMatchPlane,
  kPeriapsis,
  kResonant,
  type KerrOp,
  type KerrOrbit,
} from "../fc/kerr-ops";
import { issOrbit } from "../system/iss";
import { aeroForces } from "../aero";
import { GEAR, groundR, toGlobal } from "../landing";
import { planPath, type ManeuverNode } from "../maneuver";
import { fleet } from "../fleet";
import { VESSELS, type VesselId } from "../vessels";
import { mouth } from "../wormhole";
import { ourState } from "../system/our-side";
import type { OurPath } from "../system/our-predict";
import { plan as runPlanner } from "../system/plan-client";
import { bodyFixedOf, fromBodyFixed, gearHeight } from "../system/our-surface";
import { solarBody, solarState } from "../system/solar";
import { C_MPS, M_METRES, M_SECONDS } from "../units";
import { cross, dot as dot3, lin, sub as sub3 } from "../math/vec3";
import { frameNow } from "../frameclock";
import { t, tf } from "../i18n";

import type { CameraController } from "../controls";
import { LANDING, clamp, fmtDur, landingProfile, spinAxis, unitV } from "./util";

declare module "../controls" {
  interface CameraController {
    fcContext: typeof fcContext;
    fcSiteTrack: typeof fcSiteTrack;
    fcPreview: typeof fcPreview;
    localTrack: typeof localTrack;
    fcSetPlan: typeof fcSetPlan;
    localPlanNow: typeof localPlanNow;
    fcExecute: typeof fcExecute;
    fcClear: typeof fcClear;
    fcPlan: typeof fcPlan;
    fcAboutHole: typeof fcAboutHole;
    fcKerrInfo: typeof fcKerrInfo;
    fcKerrOp: typeof fcKerrOp;
    fcBudget: typeof fcBudget;
    burnsStep: typeof burnsStep;
    glideAlpha: typeof glideAlpha;
    aglNow: typeof aglNow;
    approach: typeof approach;
    crashed: typeof crashed;
    rolloutSteer: typeof rolloutSteer;
    groundAttitude: typeof groundAttitude;
    entryInfo: typeof entryInfo;
    airInfo: typeof airInfo;
    airVelocity: typeof airVelocity;
    contrailsFrame: typeof contrailsFrame;
    pathAngle: typeof pathAngle;
    attitudeNow: typeof attitudeNow;
    spinPhysical: typeof spinPhysical;
    measureSpin: typeof measureSpin;
    coastCom: typeof coastCom;
  }
}

/**
 * The flight computer's context (fc/ops.ts): the craft about the body of its sphere, SI — our side in
 * the home axes (centred on the body), Gargantua's worlds in their frames made inertial (their turn
 * about their pole added) —, the body's pole, and the target if it goes about the same body (a moon,
 * a craft, the station). Null far from any body.
 */
function fcContext(
  this: CameraController,
): { ctx: FcContext; body: string; bodyName: string; targetName: string | null; universe: "ours" | "gargantua" } | null {
  const s = this.s;
  const cam = cameraFrame(s);
  const c = C_MPS;
  const nav = this.ourNav(cam);
  if (nav) {
    const id = nav.ref;
    const b = solarBody(id);
    if (!b || b.kind === "star") return null;
    const rel = (X: Vec3, V: Vec3) => ({
      r: lin(sub3(X, nav.refPos), M_METRES, X, 0) as KV3,
      v: lin(sub3(V, nav.refVel), c, V, 0) as KV3,
    });
    const ctx: FcContext = {
      mu: b.mass * M_METRES * c * c,
      R: b.radius * M_METRES,
      ...rel(nav.X, nav.V),
      pole: unitV(spinAxis(id)) as KV3,
    };
    const T = s.target as string;
    let st: { X: Vec3; V: Vec3 } | null = null;
    let targetName: string | null = null;
    if (T === "iss") {
      targetName = "ISS";
      const o = id === "earth" ? issOrbit(nav.t) : null;
      if (o) st = o;
    } else if (isCraft(T as Target)) {
      targetName = VESSELS[T as VesselId].name;
      const p = fleet.pose(T as VesselId, nav.t);
      if (p && !fleet.flownAssembly().includes(T as VesselId)) st = { X: p.X, V: p.V };
    } else {
      const tb = solarBody(T);
      targetName = tb ? t(tb.name) : null;
      if (tb && tb.parent === id) {
        const o = ourState(T, nav.t);
        st = { X: o.pos, V: o.vel };
      }
    }
    if (st && targetName) ctx.target = { ...rel(st.X, st.V), name: targetName };
    return { ctx, body: id, bodyName: t(b.name), targetName, universe: "ours" };
  }
  const lf = this.local;
  if (!lf || cam.region !== "hole") return null;
  const { F, L } = lf;
  const Msec = 4.925490947e-6 * s.massSolar;
  const x = lin(L.xi, F.mPerM, L.xi, 0) as KV3;
  const n = F.n / Msec;
  const v = [L.w[0] * c - n * x[1], L.w[1] * c + n * x[0], L.w[2] * c] as KV3;
  return {
    ctx: { mu: F.m * F.mPerM * c * c, R: F.R * F.mPerM, r: x, v, pole: [0, 0, 1] },
    body: F.id,
    bodyName: BODY_NAMES[F.id as Body] ?? F.id,
    targetName: null,
    universe: "gargantua",
  };
}

/**
 * A landing site as the flight computer's LAND tab follows it (fc/land-ops.ts): where it will be in
 * the context's axes (fcContext's: body-centred, not turning — the body turning the site under the
 * orbit: ours on their own axes, Gargantua's worlds with their frame) at dt seconds from now, and the
 * craft's reach across its track (the entry's crossrange: the Ranger's lift ~600 km, the Lander's
 * ~150 km). Null away from its body.
 */
function fcSiteTrack(this: CameraController, site: Site): SiteTrack | null {
  const c = this.fcContext();
  if (!c || c.body !== site.body) return null;
  const reach = fleet.active === "ranger" ? 600e3 : 150e3;
  const name = site.name.split(",")[0]!;
  const cam = cameraFrame(this.s);
  const nav = this.ourNav(cam);
  if (nav) {
    const id = nav.ref,
      bf = bodyFixedOf(id, site.lat, site.lon, 0),
      t0 = nav.t;
    return {
      name,
      reach,
      at: (dt) => {
        const t = t0 + dt / M_SECONDS;
        const X = sub3(fromBodyFixed(id, bf, t), solarState(id, t).pos);
        return lin(X, M_METRES, X, 0);
      },
    };
  }
  const lf = this.local;
  if (!lf) return null;
  const F = lf.F;
  const n = F.n / (4.925490947e-6 * this.s.massSolar);
  const d0 = siteDir(site),
    Rm = F.R * F.mPerM;
  return {
    name,
    reach,
    at: (dt) => {
      const a = n * dt;
      return [(d0[0] * Math.cos(a) - d0[1] * Math.sin(a)) * Rm, (d0[0] * Math.sin(a) + d0[1] * Math.cos(a)) * Rm, d0[2] * Rm];
    },
  };
}

/**
 * Previews burns (seconds from now; their parts, m/s), or a mission's planned path; null clears the
 * candidate. The path computed now (the hole's, the worlds') or in the worker (ours).
 */
function fcPreview(
  this: CameraController,
  burns: Burn[] | null,
  note = "",
  o: { ours?: OurPath | null; arrive?: { body: string; t: number } | null } = {},
) {
  const gen = ++this.candGen;
  if (!burns || !burns.length) {
    this.fcCand = null;
    return;
  }
  const s = this.s;
  const cam = cameraFrame(s);
  const c = C_MPS;
  const Msec = 4.925490947e-6 * s.massSolar;
  const key = `${gen}`;
  const nav = this.ourNav(cam);
  if (nav) {
    const nodes = burns.map((b) => ({ t: nav.t + b.t / Msec, dv: [b.dv[0] / c, b.dv[1] / c, b.dv[2] / c] as Vec3 }));
    this.fcCand = { key, note, kind: "ours", t0: nav.t, nodes, ours: o.ours ?? null, arrive: o.arrive ?? null, busy: !o.ours };
    if (o.ours) return;
    const mouthR = mouth(s).w.rho,
      accel = this.thrustMax();
    void runPlanner<OurPath>({ kind: "predictPlan", X: nav.X, V: nav.V, t: nav.t, nodes, mouthR, accel, drag: this.dragPerMass() })
      .then((path) => {
        if (gen !== this.candGen || !this.fcCand || !path || (path as unknown as { error?: string }).error) return;
        this.fcCand.ours = path;
        this.fcCand.busy = false;
      })
      .catch(() => this.fcCand && gen === this.candGen && (this.fcCand.busy = false));
    return;
  }
  if (this.fcAboutHole()) {
    const st = this.stateNow();
    if (!st) return;
    const nodes: ManeuverNode[] = burns.map((b) => ({
      t: st.t + b.t / Msec,
      dv: [b.dv[0] / c, b.dv[1] / c, b.dv[2] / c] as Vec3,
      goal: b.goal,
    }));
    const last = nodes[nodes.length - 1]!.t;
    const tail = Math.max(2 * 2 * Math.PI * st.r ** 1.5, 1.5 * (last - st.t), 600);
    const res = planPath(st, nodes, this.world(), Math.min(tail, 60000));
    this.fcCand = { key, note, kind: "hole", t0: st.t, nodes, kerr: res?.path ?? null, busy: false };
    return;
  }
  // about one of Gargantua's worlds: the burns on its two bodies (the frame made inertial), the path
  // carried onto the hole's map
  const tr = this.localTrack(burns, 1.2);
  if (!tr) return;
  const now = this.nowTime() * Msec;
  const C = this.local!.F.C;
  const rel = { pts: tr.pts.map((q) => sub3(q, C)), times: tr.times, nodeAt: tr.nodeAt, world: this.local!.F.id, rot: tr.rot };
  this.fcCand = {
    key,
    note,
    kind: "local",
    t0: now / Msec,
    nodes: burns.map((b) => ({ t: (now + b.t) / Msec })),
    local: rel,
    busy: false,
  };
}

/**
 * About one of Gargantua's worlds: the path through burns (seconds from now; their parts, m/s) on
 * its two bodies — the world's frame made inertial —, `turns` orbits on after the last, as points on
 * the hole's map: the orbit about the world as it is now (the map does not turn, the world's frame
 * does), at even times [M]. Null away from a world.
 */
function localTrack(
  this: CameraController,
  burns: Burn[],
  turns: number,
  N = 360,
): { pts: Vec3[]; times: number[]; nodeAt: number[]; dt: number; rot: Vec3[] } | null {
  const fc = this.fcContext();
  const lf = this.local;
  if (!fc || !lf || fc.universe !== "gargantua") return null;
  const Msec = 4.925490947e-6 * this.s.massSolar;
  const now = this.nowTime() * Msec;
  const F0 = lf.F;
  const total = burns.length ? burns[burns.length - 1]!.t : 0;
  const el = kepElements(fc.ctx.mu, fc.ctx.r, fc.ctx.v);
  const T = Number.isFinite(el.T) && el.T > 0 ? el.T : 3600;
  const span = total + turns * T;
  const pts: Vec3[] = [],
    times: number[] = [],
    nodeAt: number[] = [],
    rot: Vec3[] = [];
  let r = fc.ctx.r,
    v = fc.ctx.v,
    tPrev = 0,
    k = 0;
  const n = F0.n / Msec;
  for (let j = 0; j <= N; j++) {
    const t = (span * j) / N;
    // (a burn on the way: the state at it, the burn, then on)
    while (k < burns.length && burns[k]!.t <= t) {
      const st = kepProp(fc.ctx.mu, r, v, burns[k]!.t - tPrev);
      r = st.r;
      v = lin(st.v as Vec3, 1, fromPNR(st.r, st.v, burns[k]!.dv) as Vec3, 1) as KV3;
      tPrev = burns[k]!.t;
      nodeAt.push(pts.length);
      k++;
    }
    const q = kepProp(fc.ctx.mu, r, v, t - tPrev);
    // (impact: the path ends on the ground)
    if (Math.hypot(...q.r) < fc.ctx.R) break;
    const xi: Vec3 = [q.r[0] / F0.mPerM, q.r[1] / F0.mPerM, q.r[2] / F0.mPerM];
    pts.push(toGlobal(F0, { xi, w: [0, 0, 0], landed: false }).X);
    times.push((now + t) / Msec);
    // (over the ground: the world's frame turned on by then — its sites and its ground fixed in it)
    const ca = Math.cos(-n * t),
      sa = Math.sin(-n * t);
    rot.push(unitV([q.r[0] * ca - q.r[1] * sa, q.r[0] * sa + q.r[1] * ca, q.r[2]]));
  }
  return pts.length > 1 ? { pts, times, nodeAt, dt: span / N / Msec, rot } : null;
}

/** The flight computer's plan set: our side, as manoeuvre nodes (the map's path, the node autopilot);
 *  about Gargantua's worlds, its own burns. Why not, or null. */
function fcSetPlan(this: CameraController, burns: Burn[], note: string): string | null {
  // (the candidate adopted: the plan's own path from now on)
  this.fcPreview(null);
  const s = this.s;
  const cam = cameraFrame(s);
  const c = C_MPS;
  const Msec = 4.925490947e-6 * s.massSolar;
  const nav = this.ourNav(cam);
  if (nav) {
    const was = this.pilot.auto === "node";
    this.clearPlan();
    this.plan = {
      nodes: burns.map((b) => ({ t: nav.t + b.t / Msec, dv: [b.dv[0] / c, b.dv[1] / c, b.dv[2] / c] as Vec3 })),
      path: null,
      at: 0,
      note,
    };
    this.refreshPlan(true);
    if (was) this.pilot.setAuto("node");
    return null;
  }
  if (this.fcAboutHole()) {
    const st = this.stateNow()!;
    this.clearPlan();
    this.plan = {
      nodes: burns.map((b, i) => ({
        t: st.t + b.t / Msec,
        dv: [b.dv[0] / c, b.dv[1] / c, b.dv[2] / c] as Vec3,
        then: null,
        goal: b.goal,
        label: b.label,
      })),
      path: null,
      at: 0,
      note,
    };
    this.refreshPlan(true);
    return null;
  }
  if (!this.local || cam.region !== "hole") return t("The flight computer: near a body");
  const now = this.nowTime() * Msec;
  this.fcBurns = burns.map((b) => ({ tAbs: now + b.t, dv: b.dv, label: b.label, firing: false, done: 0 }));
  this.fcNote = note;
  this.fcLocalPlan = null;
  return null;
}

function localPlanNow(this: CameraController) {
  if (!this.fcBurns.length || !this.local) return null;
  const P = this.fcPlan();
  if (!P) return null;
  const key = P.burns.map((b) => `${b.dv.join()}@${Math.round(b.t)}`).join(";");
  const now = frameNow();
  const c = this.fcLocalPlan;
  if (c && c.key === key && now - c.at < 1000) return c.v;
  const tr = this.localTrack(P.burns, 1.2);
  const C = this.local.F.C;
  const v = tr ? { pts: tr.pts.map((q) => sub3(q, C)), times: tr.times, nodeAt: tr.nodeAt, world: this.local.F.id, rot: tr.rot } : null;
  this.fcLocalPlan = { at: now, key, v };
  return v;
}

/** Flies the plan: the node autopilot (our side), the flight computer's burns (Gargantua's worlds). */
function fcExecute(this: CameraController): string | null {
  const nav = this.ourNav(cameraFrame(this.s));
  if (nav) {
    if (!this.plan.nodes.length) return t("No burns planned");
    if (this.pilot.auto !== "node") this.pilot.setAuto("node");
    return null;
  }
  if (this.fcAboutHole()) {
    if (!this.plan.nodes.length) return t("No burns planned");
    if (this.pilot.auto !== "node") this.pilot.setAuto("node");
    return null;
  }
  if (!this.fcBurns.length) return t("No burns planned");
  if (this.pilot.auto !== "burns") this.pilot.setAuto("burns");
  return null;
}

function fcClear(this: CameraController) {
  this.clearPlan();
  this.fcBurns = [];
  if (this.pilot.auto === "burns") this.pilot.setAuto("burns");
}

/** The plan as burns (seconds from now). */
function fcPlan(this: CameraController): { burns: Burn[]; note: string; executing: boolean } | null {
  const s = this.s;
  const c = C_MPS;
  const Msec = 4.925490947e-6 * s.massSolar;
  const nav = this.ourNav(cameraFrame(s));
  if (nav) {
    if (!this.plan.nodes.length) return null;
    return {
      burns: this.plan.nodes.map((n, i) => ({
        t: (n.t - nav.t) * Msec,
        dv: [n.dv[0] * c, n.dv[1] * c, n.dv[2] * c] as KV3,
        label: (n as { role?: string }).role ?? tf("node {0}", i + 1),
      })),
      note: this.plan.note,
      executing: this.pilot.auto === "node",
    };
  }
  if (this.fcAboutHole()) {
    const st = this.stateNow();
    // (the node burning kept past its time: a burn is centred on it)
    const nodes = st ? this.plan.nodes.filter((n, i) => n.t > st.t - 1e-9 || (i === 0 && this.nodeBurning)) : [];
    if (!st || !nodes.length) return null;
    return {
      burns: nodes.map((n, i) => ({
        t: (n.t - st.t) * Msec,
        dv: [n.dv[0] * c, n.dv[1] * c, n.dv[2] * c] as KV3,
        label: n.label ?? tf("burn {0}", i + 1),
        goal: n.goal,
      })),
      note: this.plan.note,
      executing: this.pilot.auto === "node",
    };
  }
  if (!this.fcBurns.length) return null;
  const now = this.nowTime() * Msec;
  return {
    burns: this.fcBurns.map((b) => ({ t: b.tAbs - now, dv: b.dv, label: b.label })),
    note: this.fcNote,
    executing: this.pilot.auto === "burns",
  };
}

/** About Gargantua itself (no world's frame, not our side): the hole's operations, on its geodesics. */
function fcAboutHole(this: CameraController): boolean {
  const cam = cameraFrame(this.s);
  return cam.region === "hole" && !this.ourNav(cam) && !this.fcContext();
}

/** The orbit about the hole as its path shows it (once a second, or when a burn changed it), with
 *  the scene's units: seconds and metres per M. */
function fcKerrInfo(this: CameraController): { o: KerrOrbit; t: number; Msec: number; Mm: number; a: number } | null {
  if (!this.fcAboutHole()) return null;
  const st = this.stateNow();
  if (!st) return null;
  const now = frameNow();
  const key = `${st.E.toFixed(9)}|${st.L.toFixed(7)}|${this.s.spin}`;
  const C = this.kerrInfoCache;
  if (!C || C.key !== key || now - C.at > 1000) this.kerrInfoCache = { at: now, key, o: kerrOrbit(st, this.world()), t: st.t };
  const K = this.kerrInfoCache!;
  return { o: K.o, t: st.t, Msec: 4.925490947e-6 * this.s.massSolar, Mm: 1476.625 * this.s.massSolar, a: this.s.spin };
}

/** One of the hole's orbital operations (fc/kerr-ops.ts), as the flight computer shows it: burns in
 *  seconds and m/s, the orbit after on the geodesics. A string: why not. */
function fcKerrOp(
  this: CameraController,
  kind: "circ" | "ap" | "pe" | "hohmann" | "inc" | "res" | "plane",
  x?: number | "now" | "pe" | "ap",
): OpResult | string {
  if (!this.fcAboutHole()) return t("About Gargantua itself (away from its worlds)");
  const st = this.stateNow();
  if (!st) return t("About Gargantua itself");
  const s = this.s;
  const w = this.world();
  const D = Math.PI / 180;
  let r: KerrOp;
  if (kind === "circ") r = kCircularize(st, w, (x as "now" | "pe" | "ap") ?? "ap");
  else if (kind === "ap") r = kApoapsis(st, w, x as number);
  else if (kind === "pe") r = kPeriapsis(st, w, x as number);
  else if (kind === "hohmann") r = kHohmann(st, w, x as number);
  else if (kind === "inc") r = kInclination(st, w, (x as number) * D);
  else if (kind === "res") r = kResonant(st, w, x as number);
  else {
    // the target's plane: a world's (or the companion's) orbit about the hole
    const body = s.target as Body;
    if (s.system === "none" && body !== "star") return t("No target in this scene");
    if (s.target === "hole" || s.target === "wormhole" || s.target === "barycentre")
      return t("Target a world or the star (a click on the map)");
    if (body === "star" && !s.sun) return t("No companion star in this scene");
    const n = cross(bodyCentre(s, body, st.t), bodyVelocity(s, body, st.t));
    if (Math.hypot(...n) < 1e-12) return t("The target has no orbit's plane");
    r = kMatchPlane(st, w, n, tf("{0}'s plane", BODY_NAMES[body]));
  }
  const c = C_MPS;
  const Msec = 4.925490947e-6 * s.massSolar;
  if (!r.ok) return { ok: false, note: r.note, burns: [], dvTotal: 0 };
  const burns: Burn[] = r.nodes.map((n, i) => ({
    t: (n.t - st.t) * Msec,
    dv: [n.dv[0] * c, n.dv[1] * c, n.dv[2] * c] as KV3,
    label:
      kind === "circ" || (kind === "hohmann" && i === 1)
        ? t("circularize")
        : kind === "hohmann"
          ? t("transfer")
          : kind === "inc" || kind === "plane"
            ? t("plane change")
            : kind === "ap"
              ? t("apoapsis")
              : kind === "pe"
                ? t("periapsis")
                : kind === "res"
                  ? t("resonance")
                  : tf("burn {0}", i + 1),
    goal: n.goal,
  }));
  const a = r.after;
  const afterText = a
    ? a.fate === "horizon"
      ? t("After: into the horizon")
      : a.fate === "escape"
        ? tf("After: an escape (periapsis {0} M)", a.rp.toFixed(2))
        : tf(
            "After: Pe {0} M · Ap {1} M · i {2}° · period {3}",
            a.rp.toFixed(2),
            a.ra.toFixed(2),
            (a.inc / D).toFixed(2),
            fmtDur(a.T * Msec),
          ) +
          (a.advance ? ` · ${tf("the periapsis {0}° on a turn", (a.advance / D).toFixed(1))}` : "") +
          (a.prograde ? "" : ` · ${t("retrograde")}`)
    : undefined;
  // (a burn a good part of an orbit long — the hole's are, at its scale —: flown to its goal, but the
  // orbit's other side moves with it)
  const acc = this.fcBudget().accel;
  const T = r.after?.T ?? kerrOrbit(st, w).T;
  const long = acc > 0 && Number.isFinite(T) ? Math.max(...burns.map((b) => Math.hypot(...b.dv) / acc)) / (T * Msec) : 0;
  const warn =
    long > 0.2 ? ` · ⚠ ${tf("a burn {0} % of an orbit long: flown to its goal, the other side moves", (long * 100).toFixed(0))}` : "";
  return {
    ok: true,
    note: r.note,
    burns,
    dvTotal: burns.reduce((q, b) => q + Math.hypot(...b.dv), 0),
    afterText: afterText && afterText + warn,
  };
}

/** The propellant's Δv left [m/s] (no gauge: a full tank's), the acceleration at full thrust [m/s²]. */
function fcBudget(this: CameraController): { dv: number; accel: number } {
  const s = this.s;
  const c = C_MPS;
  // (no gauge: the propellant is not counted)
  const left = fuelOn(s) ? tank(s, this.spent).left * c : Infinity;
  return { dv: left, accel: (this.thrustMax() * c * c) / (1476.625 * s.massSolar) };
}

/**
 * The flight computer's burns flown about one of Gargantua's worlds: each pointed at its time — its
 * prograde, normal and radial parts at the orbit then (two bodies about the world: its frame made
 * inertial) — and fired until its Δv is given (the proper acceleration's), the time sped up between.
 */
function burnsStep(this: CameraController, cam: ReturnType<typeof cameraFrame>): { nose: Vec3; up: Vec3; throttle?: number } | null {
  const s = this.s;
  const P = this.pilot;
  const say = (t: string) => {
    P.setAuto("none");
    this.onPilotMessage?.(t);
    return null;
  };
  const B = this.fcBurns[0];
  if (!B) return say(tf("Flight computer: {0} — done", this.fcNote || t("the plan")));
  const fr = this.entryFrame(cam);
  const fc = this.fcContext();
  if (!fr || !fc) return say(t("Flight computer: away from the world — the burns dropped"));
  const Msec = 4.925490947e-6 * s.massSolar;
  const now = fr.now;
  const thr = (this.thrustMax() * C_MPS ** 2) / (1476.625 * s.massSolar);
  const size = Math.hypot(...B.dv);
  const burnT = thr > 0 ? size / thr : 0;
  // the burn's direction where the craft is then (the inertial frame's: its parts as the orbit then)
  const wait = Math.max(B.tAbs - burnT / 2 - now, 0);
  const at = kepProp(fc.ctx.mu, fc.ctx.r, fc.ctx.v, Math.max(B.tAbs - now, 0));
  const dir = unitV(fromPNR(at.r, at.v, B.dv) as Vec3);
  const att = { nose: fr.toLocal(dir), up: fr.toLocal(unitV(fc.ctx.r as Vec3)) };
  if (!B.firing) {
    this.setHubWarp((wait > 40 ? Math.min(1000, Math.max((wait - 25) / 3, 1)) : 1) / Msec);
    // (assisted: the pilot lighting it in the last half burn before its start starts it)
    if (wait <= 0 || (P.assist && P.throttle > 0.02 && wait < burnT / 2)) {
      B.firing = true;
      B.done = 0;
      this.setHubWarp(1 / Msec);
      this.onPilotMessage?.(tf("Burn {0}: {1} m/s", B.label, size.toFixed(1)));
    }
    return att;
  }
  this.setHubWarp(1 / Msec);
  // (assisted: done within what a hand cuts — 0.2 % or 10 cm/s — and once the engine is cut)
  const tol = P.assist ? Math.max(2e-3 * size, 0.1) : 0;
  if (B.done >= size - tol && (!P.assist || P.throttle <= 0.01)) {
    this.fcBurns.shift();
    this.onPilotMessage?.(tf("Burn {0} done ({1} m/s)", B.label, B.done.toFixed(1)));
    return att;
  }
  return { ...att, throttle: B.done >= size - tol ? 0 : Math.min(1, Math.max((size - B.done) / Math.max(thr * 0.5, 1e-9), 0.05)) };
}

/**
 * The angle of attack a glide asks: the lift that turns the path onto the climb angle wanted —
 * m (g cos γ + V k (γ_ref − γ) − V γ̇ d) / cos bank — from the lift the wing gives now at the angle it has
 * (its slope), eased over a few tenths of a second; slower than ~1.25 × the stall's, the nose
 * lowered. Low (1.5 km), the time back to real.
 */
function glideAlpha(
  this: CameraController,
  R: NonNullable<CameraController["entryRun"]>,
  gRef: number,
  gam: number,
  gdot: number,
  sp: number,
  bank: number,
  agl: number,
  dt: number,
  stall: number,
  prot: number,
  gdotRef = 0,
): number {
  const LA = this.airFlight.last;
  const m = fleet.massProps().mass;
  const g = 9.81;
  const k = agl < 80 ? 1.6 : 0.8;
  // (the reference's own turn fed forward — gdotRef —, the damping on what departs from it)
  const need = (m * (g * Math.cos(gam) + sp * (gdotRef + k * (gRef - gam) - 0.6 * (gdot - gdotRef)))) / Math.max(Math.cos(bank), 0.5);
  // (the angle whose lift — signed, the craft's own aerodynamics in the air it is in — is that:
  // Newton's steps from the angle it has)
  let want = R.alpha;
  let vStall = 0;
  if (LA && LA.air.rho > 0 && sp > 1) {
    const A = VESSELS[fleet.active].aero;
    const lift = (al: number) => {
      const o = aeroForces(A, [0, -sp * Math.sin(al), sp * Math.cos(al)], LA.air, [0, 0, 0], this.airFlight.cfg);
      return o.F[1] * Math.cos(al) + o.F[2] * Math.sin(al);
    };
    for (let i = 0; i < 3; i++) {
      const l0 = lift(want),
        l1 = lift(want + 0.01);
      const slope = (l1 - l0) / 0.01;
      if (!(slope > 1e-6)) break;
      want = clamp(want + (need - l0) / slope, -0.05, stall);
    }
    // (the stall's speed here: the lift at the stall's angle grows as the speed squared)
    const ls = lift(stall);
    if (ls > 0) vStall = sp * Math.sqrt((m * g) / ls);
  }
  // (the speed kept — `prot` × the stall's: the energy the flare needs, ×1.1 in it; slower, the nose down, the path
  // given up rather than the wing)
  want -= 0.01 * Math.max(prot * vStall - sp, 0);
  const a = R.alpha + (clamp(want, 0, stall) - R.alpha) * Math.min(1, dt / 0.35);
  if (agl < 1500) {
    const Msec = 4.925490947e-6 * this.s.massSolar;
    if (this.pilot.auto !== "none") this.setHubWarp(1 / Msec);
    else this.s.timeSpeed = this.warpSet = Math.min(this.s.timeSpeed, 1 / Msec);
  }
  return clamp(a, 0, stall);
}

/** The gear's height over the ground below — its relief: our worlds', Gargantua's (h: over the sphere,
 *  the fallback) [m]. */
function aglNow(this: CameraController, cam: ReturnType<typeof cameraFrame>, h: number): number {
  const nav = this.ourNav(cam);
  if (nav) return Math.max(gearHeight(nav.ref, nav.X, nav.t), 0);
  const lf = this.local;
  if (lf) return Math.max((Math.hypot(...lf.L.xi) - groundR(lf.F, lf.L.xi)) * lf.F.mPerM - GEAR, 0);
  return Math.max(h - GEAR, 0);
}

/**
 * The Ranger's approach to a runway: the axis intercepted well before the final's start (12 km before
 * the threshold, ~3.5 km up) — or, from too close, flown to it and turned there; then the final — the bank against the cross-track error and
 * its rate, a steep glide path (as the Shuttle's, 18°) to an aim point 2 km short, the flare to a
 * shallow one, the touchdown on the centreline, the wheels and the brakes after.
 */
function approach(
  this: CameraController,
  fr: NonNullable<ReturnType<CameraController["entryFrame"]>>,
  R: NonNullable<CameraController["entryRun"]>,
  site: Site,
  va: Vec3,
  up: Vec3,
  h: number,
  dt: number,
  cam: ReturnType<typeof cameraFrame>,
) {
  const D = Math.PI / 180;
  const T = fr.place(site);
  const tu = fr.env.normal?.(T) ?? unitV(T);
  // (the site's north: the body's pole on it — ours: the spin axis; Gargantua's worlds: their z)
  const nav = this.ourNav(cam);
  const pole: Vec3 = nav ? unitV(spinAxis(fr.body)) : [0, 0, 1];
  const north = unitV(lin(pole, 1, tu, -dot3(pole, tu)));
  const east = cross(north, tu);
  const hd = (site.rwy ?? 0) * D;
  const along = lin(north, Math.cos(hd), east, Math.sin(hd));
  const rgt = cross(along, tu);
  const x = fr.s.x;
  const rel = sub3(x, T);
  const sAl = dot3(rel, along); // (negative before the threshold)
  const xt = dot3(rel, rgt);
  const sp = Math.hypot(...va);
  const agl = this.aglNow(cam, h);
  const vh = unitV(lin(va, 1, up, -dot3(va, up)));
  const gam = Math.asin(clamp(dot3(va, up) / Math.max(sp, 1e-9), -1, 1));
  const gdot = R.gPrev !== null && dt > 0 ? (gam - R.gPrev) / dt : 0;
  R.gPrev = gam;
  // (the final: within 6 km of the axis, heading down it — the turn onto it at the final's start
  // leaves the craft a turn's diameter off, ~4 km at 120 m/s: joined from there, not sent back to the
  // start behind it to turn again, and again)
  const onFinal = sAl > -16e3 && Math.abs(xt) < 6e3 && dot3(vh, along) > 0.5;
  let bank: number,
    gRef: number,
    gdotRef = 0;
  if (!onFinal) {
    // (far enough back: the axis joined — the course turned onto it as the offset closes, atan(xt/L)
    // off it, L about a turn's radius: no overshoot. Down the runway but wide: to the final's start.
    // Against it, closer: a circuit — downwind, a turn's diameter off the axis on the craft's side,
    // then abeam the final's start the turn towards the axis, rolled out on it. A glide path to
    // 3.5 km over the final's start along the way still to fly.)
    const L0 = Math.max(6e3, (0.8 * Math.min(sp, 350) ** 2) / (9.81 * Math.tan(0.6)));
    const far = sAl < -(12e3 + 0.5 * Math.abs(xt) + L0);
    const dn = dot3(vh, along);
    let tdir: Vec3 | null = null,
      dGo: number;
    bank = 0;
    if (far) {
      const off = Math.min(Math.atan2(Math.abs(xt), L0), 1.4);
      tdir = lin(along, Math.cos(off), rgt, -Math.sign(xt) * Math.sin(off));
      dGo = -12e3 - sAl + 0.5 * Math.abs(xt);
      R.side = undefined;
      R.turning = false;
      R.leg = "join";
    } else if (dn >= 0.5) {
      const toA = sub3(lin(T, 1, along, -12e3), x);
      tdir = unitV(lin(toA, 1, up, -dot3(toA, up)));
      // (and the turn onto the axis there: an arc of ~8 km radius)
      dGo = Math.hypot(...lin(toA, 1, up, -dot3(toA, up))) + 8e3 * Math.acos(clamp(dot3(tdir, along), -1, 1));
      R.side = undefined;
      R.turning = false;
      R.leg = "toStart";
    } else {
      // (the side kept once chosen: the turn crosses nothing, rolled out on the axis)
      const side = (R.side ??= Math.sign(xt) || 1);
      const Dd = clamp((2 * sp * sp) / (9.81 * Math.tan(0.6)), 4e3, 8e3);
      // (turned early when the height left would no longer bring the craft round the turn and down
      // the final to the runway — a glide ratio of 5.5, the turn's height counted: from a short final)
      const hNeed = (Math.max(-sAl, 0) + 500 + (Math.PI * Dd) / 2) / 5.5;
      if (!R.turning && sAl < -3e3 && agl < hNeed) R.turning = true;
      R.leg = sAl > -12e3 && !R.turning ? "downwind" : "turn";
      if (sAl > -12e3 && !R.turning) {
        // downwind: the line a turn's diameter off the axis joined (atan(e / 3 km), 40° at most)
        const e = xt - side * Dd;
        const off = Math.min(Math.atan2(Math.abs(e), 3000), 0.7);
        tdir = lin(along, -Math.cos(off), rgt, -Math.sign(e) * Math.sin(off));
        dGo = sAl + 12e3 + 0.5 * Math.abs(e) + (Math.PI * Dd) / 2;
      } else {
        // abeam the final's start (or sooner, low): the turn towards the axis, all the way round
        R.turning = true;
        bank = 0.6 * side;
        dGo = (Math.acos(clamp(dn, -1, 1)) * Dd) / 2;
      }
    }
    if (tdir) {
      const dpsi = Math.atan2(-dot3(cross(vh, tdir), up), dot3(vh, tdir));
      bank = clamp(1.4 * dpsi, -0.6, 0.6);
    }
    gRef = clamp(-Math.atan2(Math.max(agl - 3500, 0), Math.max(dGo, 1500)), -0.35, -0.035);
  } else {
    R.side = undefined;
    R.turning = false;
    R.leg = "final";
    // (the final: the axis joined — the course to it atan(xt / 3 km) off the runway's, 40° at most:
    // the offset closed in ~20 s once near, a turn's width away from it in ~40 —, held; steep to
    // 300 m, then the flare)
    const dpsi = Math.atan2(dot3(vh, rgt), dot3(vh, along));
    const want = -Math.min(Math.max(Math.atan2(xt, 3000), -0.7), 0.7);
    // (held down to 15 m — a crosswind drifts the craft off the axis in the last seconds otherwise —,
    // faded to the wings level at the touchdown)
    bank = clamp(-1.2 * (dpsi - want), -0.5, 0.5) * (agl < 15 ? agl / 15 : 1);
    // (the height down a profile to the touchdown aimed, 450 m past the threshold — landing.ts-free:
    // landingProfile below —, its slope followed and the height's error closed over ~4 s)
    const L = landingProfile(sAl, agl, sp, R.gOuter);
    if (L.freeze && R.gOuter === undefined) R.gOuter = L.fix;
    gRef = clamp(Math.atan(L.slope) + clamp((L.h - agl) / (Math.max(sp, 50) * 4), -0.12, 0.12), -0.35, 0.05);
    // (the last metres: the sink eased to a touchdown a real gear takes — 0.8 m/s plus the height over
    // 2.5 s, whatever the parabola's tracking left: ~1 m/s at the wheels, not 4)
    if (L.phase === "flare" || agl < 15) gRef = Math.max(gRef, -Math.asin(Math.min((0.8 + agl / 2.5) / Math.max(sp, 1), 0.5)));
    // (the slope's turn ahead — the pull-up, the flare —: its rate fed forward, half a second on)
    gdotRef = (Math.atan(landingProfile(sAl + sp * 0.5, agl, sp, L.fix).slope) - Math.atan(L.slope)) / 0.5;
    R.flareTau = L.phase === "flare" ? 1 : undefined;
    R.prof = { phase: L.phase, aim: L.aim, td: LANDING.td, h: L.h };
  }
  if (!onFinal) {
    R.gOuter = undefined;
    R.prof = undefined;
  }
  R.app = { along: sAl, across: xt, final: onFinal, agl, speed: sp, gRef, gam };
  const stall = (VESSELS[fleet.active].aero.wing?.stall ?? 0.35) - 0.05;
  R.alpha = this.glideAlpha(
    R,
    gRef,
    gam,
    gdot,
    sp,
    bank,
    agl,
    dt,
    stall,
    onFinal && R.flareTau !== undefined ? 1.1 : agl > 600 ? 1.6 : 1.35,
    gdotRef,
  );
  // (the air brake: the speed held down the steep slope, then bled on the shallow one)
  const vT = !onFinal ? 230 : R.prof && R.prof.phase !== "outer" ? 130 : 160;
  this.airBrake = clamp((sp - vT) / 50, 0, 1);
  // (the nose on the motion through the air, the wind's crab: the track kept by the bank, not by a slip;
  // the crab kicked out in the last 12 m — the nose onto the runway's track, the wheels touching straight)
  const vAir = this.airVelocity(va);
  const k = onFinal && agl < 12 ? 1 - agl / 12 : 0;
  const ax = attitudeFor(fr.s.x, lin(vAir, 1 - k, va, k), R.alpha, bank, fr.env.normal?.(fr.s.x));
  return { nose: fr.toLocal(ax[2]), up: fr.toLocal(ax[1]) };
}

/** A ground-relative velocity [m/s, the entry frame's axes] made relative to the air: the wind taken off. */
function airVelocity(this: CameraController, va: Vec3): Vec3 {
  const w = this.windHome;
  return w ? sub3(va, [w[0] * C_MPS, w[1] * C_MPS, w[2] * C_MPS]) : va;
}

/** A crash (the damage on): the craft lost. */
function crashed(this: CameraController, why: string) {
  if (!this.s.damage || this.airFlight.failure) return;
  this.airFlight.failure = why;
  this.onCraftLost?.(why);
}

/**
 * The rollout after an autopilot's landing: the nose wheel steered along the runway — the course back
 * to its axis atan(xt / 150 m), 8° at most —, 4° a second at most; the pilot's yaw takes it over.
 */
function rolloutSteer(this: CameraController, upL: Vec3, dt: number, yawIn: number, lock?: number) {
  const site = this.rollSite;
  const cam = cameraFrame(this.s);
  const fr = site ? this.entryFrame(cam) : null;
  if (!site || !fr || Math.abs(yawIn) > 0.05) {
    this.rollSite = null;
    return;
  }
  const D = Math.PI / 180;
  const T = fr.place(site);
  const tu = fr.env.normal?.(T) ?? unitV(T);
  const pole = unitV(spinAxis(fr.body));
  const north = unitV(lin(pole, 1, tu, -dot3(pole, tu)));
  const east = cross(north, tu);
  const hd = (site.rwy ?? 0) * D;
  const along = lin(north, Math.cos(hd), east, Math.sin(hd));
  const rgt = cross(along, tu);
  const xt = dot3(sub3(fr.s.x, T), rgt);
  const w = clamp(Math.atan2(xt, 150), -8 * D, 8 * D);
  const want = lin(along, Math.cos(w), rgt, -Math.sin(w));
  const toC = (v: Vec3): Vec3 => [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)];
  const U = unitV(toC(upL)),
    W0 = toC(fr.toLocal(want));
  const W = unitV(lin(W0, 1, U, -dot3(W0, U)));
  const S = this.shipMatrix();
  const Z: Vec3 = [S[0][2]!, S[1][2]!, S[2][2]!];
  const Zh = unitV(lin(Z, 1, U, -dot3(Z, U)));
  const a = Math.atan2(dot3(cross(Zh, W), U), dot3(Zh, W));
  // (rolling backwards or across: not a rollout)
  if (Math.abs(a) > 60 * D) {
    this.rollSite = null;
    return;
  }
  // (a gear of its own: the nose wheel steered onto the line — a turn about the ship's up the other way
  // from the wheel's left; without, the heading turned to it)
  if (lock !== undefined) {
    this.noseSteer = -clamp(1.5 * a, -lock, lock);
    return;
  }
  const simS = this.s.timeSpeed * dt * 4.925490947e-6 * this.s.massSolar;
  const step = clamp(a, -4 * D * simS, 4 * D * simS);
  if (Math.abs(step) > 1e-7) this.rotateC(lin(U, step, U, 0));
  this.pilot.omega[1] = 0;
}

function groundAttitude(this: CameraController, up: Vec3) {
  const cam = cameraFrame(this.s);
  const toC = (v: Vec3): Vec3 => [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)];
  const S = this.shipMatrix();
  const col = (i: number): Vec3 => [S[0][i]!, S[1][i]!, S[2][i]!];
  const X = col(0),
    Z = col(2);
  const u = unitV(toC(up));
  const pitch = Math.asin(clamp(dot3(Z, u), -1, 1));
  const D = Math.PI / 180;
  const want = clamp(pitch, -3 * D, 15 * D);
  // (about the ship's x — its left: a positive turn lowers the nose)
  if (Math.abs(want - pitch) > 1e-6) {
    this.rotateC(lin(X, pitch - want, X, 0));
    this.pilot.omega[0] = 0;
  }
  const S2 = this.shipMatrix();
  const Y2: Vec3 = [S2[0][1]!, S2[1][1]!, S2[2][1]!],
    Z2: Vec3 = [S2[0][2]!, S2[1][2]!, S2[2][2]!];
  const u2 = unitV(lin(u, 1, Z2, -dot3(u, Z2)));
  const ra = Math.atan2(dot3(cross(Y2, u2), Z2), dot3(Y2, u2));
  if (Math.abs(ra) > 1e-6) this.rotateC(lin(Z2, ra, Z2, 0));
  this.pilot.omega[2] = 0;
}

/** The entry autopilot, for the map: its phase, the site (its place, body-centred home axes [M]), the
 *  guidance's predicted fall (likewise), its bank and miss. Null when off. */
function entryInfo(this: CameraController) {
  const R = this.entryRun;
  if (!R) return null;
  const cam = cameraFrame(this.s);
  const nav = this.ourNav(cam);
  const fr = this.entryFrame(cam);
  if (!fr) return null;
  const k = nav ? 1 / M_METRES : 1;
  const toMap = (x: Vec3): Vec3 => lin(x, k, x, 0);
  const path = R.guid?.last?.path.map((x) => toMap(x as Vec3)) ?? null;
  // (the site from here: the distance over the ground [m], and how far off the heading to it the
  // velocity runs [rad, > 0: the site to the left])
  let range = NaN,
    dpsi = NaN;
  if (R.site) {
    const up = fr.env.normal?.(fr.s.x) ?? unitV(fr.s.x);
    const place = fr.place(R.site);
    const pu = fr.env.normal?.(place) ?? unitV(place);
    range = Math.acos(clamp(dot3(up, pu), -1, 1)) * fr.env.R;
    const va = sub3(fr.s.v, fr.env.ground(fr.s.x));
    const vh = unitV(lin(va, 1, up, -dot3(va, up)));
    const tdir = unitV(lin(pu, 1, up, -dot3(pu, up)));
    dpsi = Math.atan2(-dot3(cross(vh, tdir), up), dot3(vh, tdir));
  }
  return {
    phase: R.phase,
    range,
    dpsi,
    body: fr.body,
    site: R.site ? { name: R.site.name, X: toMap(fr.place(R.site)) } : null,
    path,
    bank: R.bank,
    miss: R.guid?.lastMiss ?? null,
    tBurn: R.phase === "wait" ? R.tBurn - fr.now : null,
    dv: R.dv,
    plan: R.plan ?? null,
    ours: !!nav,
    app: R.app ?? null,
  };
}

/** The flown craft in the air, for the displays: the flow (q, Mach, α, β), the heat, the skin, the load. */
function airInfo(this: CameraController) {
  const A = this.airFlight;
  const L = A.last;
  const V = VESSELS[fleet.active].aero;
  return {
    inAir: A.inAir,
    q: L?.out.q ?? 0,
    mach: L?.out.mach ?? 0,
    alpha: L?.out.alpha ?? 0,
    beta: L?.out.beta ?? 0,
    heat: L?.out.heat ?? 0,
    u: L?.u ?? null,
    rho: L?.air.rho ?? 0,
    glow: L?.air.gas.glow ?? null,
    lift: L?.out.L ?? 0,
    drag: L?.out.D ?? 0,
    stalled: L?.out.stalled ?? false,
    h: L?.h ?? NaN,
    speed: L?.speed ?? 0,
    airT: L?.air.T ?? NaN,
    shield: A.skin.shield,
    hull: A.skin.hull,
    shieldMax: V.shield?.tMax ?? 0,
    hullMax: V.hull.tMax,
    g: A.g,
    gMax: V.gMax,
    gPeak: A.gPeak,
    margins: A.margins(),
    failure: A.failure,
    damage: this.s.damage,
    body: A.body,
    rolling: !!this.rolling || !!this.local?.L.rolling,
    mode: this.flightModeNow(),
    antigrav: this.s.antigrav,
    flaps: A.cfg.flaps ?? 0,
    brake: A.cfg.brake ?? 0,
    gear: !!A.cfg.gear,
    // (the wind there: its speed [m/s], where it blows from [°])
    wind: this.windNow,
    sf: this.sfCmd ? { ...this.sfCmd } : null,
    ...this.attitudeNow(),
    // (the wing's incidences, for the HUD's angle-of-attack cues: the stall; the best lift-to-drag —
    // where the induced drag equals the zero-lift one, C_L = √(C_D0 π AR e))
    stallA: V.wing?.stall ?? null,
    bestA: V.wing ? Math.sqrt((V.cdA0 / V.wing.S) * Math.PI * V.wing.AR * V.wing.e) / V.wing.cla : null,
  };
}

/**
 * The condensation trails this frame: drawn on from the main engines (their exhaust, when the air is
 * cold enough for it to freeze — contrails.ts) and the Ranger's wingtips (pulling hard in moist air),
 * carried with the air, aged; handed over in the ship's frame for the renderer. Null: none.
 */
function contrailsFrame(this: CameraController): { data: Float32Array<ArrayBuffer>; n: number } | null {
  const cam = cameraFrame(this.s);
  const fr = this.s.ship ? this.entryFrame(cam) : null;
  if (!fr || !fr.env.atm) {
    if (this.contrails.trails.length) this.contrails.clear();
    return null;
  }
  const x = fr.s.x;
  const ax = this.shipAxesLocal(cam).map((a) => fr.fromLocal(a)) as [Vec3, Vec3, Vec3];
  // (a ship-frame point in the body's frame)
  const at = (q: Vec3): Vec3 => [0, 1, 2].map((k) => x[k]! + ax[0][k]! * q[0] + ax[1][k]! * q[1] + ax[2][k]! * q[2]) as Vec3;
  const src: ContrailSource[] = [];
  const LA = this.airFlight.last;
  const V = VESSELS[fleet.active];
  if (LA && LA.air.rho > 0) {
    const f = this.pilot.fired;
    const thr = performance.now() - f.at < 300 ? f.throttle : 0;
    const e = engineTrail(thr, LA.air.rho, LA.air.T, LA.air.gas.R);
    // (from a little behind each exit: the exhaust condenses as it mixes)
    if (e > 0) V.jets.forEach((J, i) => J.main && src.push({ key: `e${i}`, p: at(lin(J.p, 1, J.d, 2)), kind: 0, str: e }));
    const wing = V.aero.wing;
    if (fleet.active === "ranger" && wing && LA.out.q > 0) {
      const t = tipTrail(Math.abs(LA.out.L) / (LA.out.q * wing.S), LA.air.rho, LA.air.T, LA.speed);
      if (t > 0) for (const sx of [1, -1]) src.push({ key: `t${sx}`, p: at([4.1 * sx, 0.44, -0.3]), kind: 1, str: t });
    }
  }
  this.contrails.step(fr.now, fr.body, fr.env.carry, src);
  const n = this.contrails.view(fr.now, x, ax, this.contrailBuf);
  return n ? { data: this.contrailBuf, n } : null;
}

/** The flight path's angle over the local horizon [rad] (0 away from a body). */
function pathAngle(this: CameraController, cam: ReturnType<typeof cameraFrame>): number {
  const fr = this.sfFrame(cam);
  const v = fr ? Math.hypot(...fr.vRel) : 0;
  return fr && v > 0 ? Math.asin(clamp(dot3(fr.vRel, fr.up) / v, -1, 1)) : 0;
}

/** The flown craft's attitude over the ground below: pitch, bank (right: +), heading [rad]. */
function attitudeNow(this: CameraController): { pitch: number; bank: number; heading: number } | Record<string, never> {
  const cam = cameraFrame(this.s);
  const fr = this.sfFrame(cam);
  if (!fr) return {};
  const ax = this.shipAxesLocal(cam).map((a) => fr.fromLocal(a));
  const [X, Y, Z] = ax as [Vec3, Vec3, Vec3];
  return {
    pitch: Math.asin(clamp(dot3(Z, fr.up), -1, 1)),
    bank: Math.atan2(dot3(X, fr.up), dot3(Y, fr.up)),
    heading: Math.atan2(dot3(Z, fr.east), dot3(Z, fr.north)),
  };
}

/** The flown craft's angular velocity, ship frame, right-handed [rad/s of its time] (the pilot's
 *  rates are the other way round; in the air they run on the craft's clock). */
function spinPhysical(this: CameraController): Vec3 {
  return [-this.pilot.omega[0], -this.pilot.omega[1], -this.pilot.omega[2]];
}

function measureSpin(this: CameraController) {
  const P = this.activePoseNow();
  if (!P) {
    this.spin = null;
    return;
  }
  const S = this.spin;
  if (S && P.t > S.t) {
    // (the rotation from the last axes to these: Σ eᵢ × R eᵢ = 2 sin θ k, Σ eᵢ·R eᵢ = 1 + 2 cos θ)
    let v: Vec3 = [0, 0, 0];
    let tr = 0;
    for (let i = 0; i < 3; i++) {
      v = lin(v, 1, cross(S.ax[i]!, P.ax[i]!), 0.5);
      tr += dot3(S.ax[i]!, P.ax[i]!);
    }
    const sn = Math.hypot(...v);
    const th = Math.atan2(sn, (tr - 1) / 2);
    const w = sn > 1e-12 ? lin(v, th / sn / (P.t - S.t), v, 0) : ([0, 0, 0] as Vec3);
    const k = 0.3;
    this.spin = { ax: P.ax, t: P.t, w: lin(S.w, 1 - k, w, k) };
  } else if (!S || P.t < S.t) this.spin = { ax: P.ax, t: P.t, w: [0, 0, 0] };
}

/** The flown assembly's centre of mass for coasting: its own (an assembly), else the craft's origin —
 *  a lone craft turns about it as flown. */
function coastCom(this: CameraController): Vec3 {
  return fleet.flownAssembly().length > 1 ? fleet.massProps().com : [0, 0, 0];
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installComputer(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    fcContext,
    fcSiteTrack,
    fcPreview,
    localTrack,
    fcSetPlan,
    localPlanNow,
    fcExecute,
    fcClear,
    fcPlan,
    fcAboutHole,
    fcKerrInfo,
    fcKerrOp,
    fcBudget,
    burnsStep,
    glideAlpha,
    aglNow,
    approach,
    crashed,
    rolloutSteer,
    groundAttitude,
    entryInfo,
    airInfo,
    airVelocity,
    contrailsFrame,
    pathAngle,
    attitudeNow,
    spinPhysical,
    measureSpin,
    coastCom,
  });
}
