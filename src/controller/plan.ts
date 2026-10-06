// The CameraController — rails and the flight plan: nodes, burns, predictions.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { blToCartesian, cameraFrame } from "../camera";
import { horizon, isco, coordToZamo, zamoToCoord, type Vec3 } from "../physics";
import { SYSTEM_BODIES, type Target } from "../settings";
import {
  availableBodies,
  bodyCentre,
  BODY_NAMES,
  type Body,
  bodyVelocity,
  bodyMass,
  bodyRadius,
  bodyHill,
  cameraHome,
  isCraft,
  isOurBody,
  onOurSide,
  ourLook,
  ourTarget,
} from "../targeting";
import { fromZamo, step as geoStep, toZamo } from "../geodesic";
import { engineThrust, fuelOn, loadShare, pressureFactor, tank } from "../engine";
import { followDv, type V3 as KV3 } from "../fc/kepler";
import type { Burn } from "../fc/ops";
import { apsisLeft, circLeft, periodLeft, planeLeft, kHohmann } from "../fc/kerr-ops";
import { GEAR, groundR } from "../landing";
import { toU } from "../pilot";
import {
  dvLocal,
  nodeComponents,
  type KerrGoal,
  orbitNormal,
  planAlign,
  planCircular,
  planeOffset,
  planIntercept,
  planPath,
  planRendezvous,
  type ManeuverNode,
} from "../maneuver";
import { fleet } from "../fleet";
import { VESSELS, type VesselId } from "../vessels";
import { mouth, sphericalFrame } from "../wormhole";
import { circularVelocity } from "../system/geopotential";
import { gravityHome, homeOf, homeToRep, ourState, referenceBody, repToHomeVec } from "../system/our-side";
import { nodeDvHome, predictOurs, type OurPath } from "../system/our-predict";
import type { Arrival, OurPlanResult, PlanNode } from "../system/our-plan";
import { plan as runPlanner } from "../system/plan-client";
import { airDensity as ourAir, gearHeight, groundSpeeds, solidBody } from "../system/our-surface";
import { SOLAR_BODIES, solarBody, solarState } from "../system/solar";
import { issTrack } from "../system/iss";
import { craftPoint, freePort, planIssRendezvous, refineIssNode, rendezvousPoint } from "../system/iss-plan";
import { AU_M, C_MPS, DAY_S, G0, M_METRES, M_SECONDS } from "../units";
import { add as axpy, dot as dot3, lin, sub as sub3 } from "../math/vec3";
import { frameNow } from "../frameclock";
import { t, tf } from "../i18n";

import type { CameraController } from "../controls";
import { add3, clamp, fmtDur } from "./util";

declare module "../controls" {
  interface CameraController {
    rails: typeof rails;
    railsLimit: typeof railsLimit;
    stateNow: typeof stateNow;
    world: typeof world;
    planTransfer: typeof planTransfer;
    planOurs: typeof planOurs;
    missionPlan: typeof missionPlan;
    missionTargets: typeof missionTargets;
    adoptKerr: typeof adoptKerr;
    missionCommit: typeof missionCommit;
    planIss: typeof planIss;
    issRefineTick: typeof issRefineTick;
    ourRefineTick: typeof ourRefineTick;
    goalPlane: typeof goalPlane;
    planAlign: typeof planAlignMethod;
    planeOffsets: typeof planeOffsets;
    addNode: typeof addNode;
    nudgeNode: typeof nudgeNode;
    deleteNode: typeof deleteNode;
    clearPlan: typeof clearPlan;
    refreshPlan: typeof refreshPlan;
    planApplies: typeof planApplies;
    restoreWarp: typeof restoreWarp;
    goalDir: typeof goalDir;
    setNodeWarp: typeof setNodeWarp;
    setHubWarp: typeof setHubWarp;
    releaseHubWarp: typeof releaseHubWarp;
    giveBackWarp: typeof giveBackWarp;
    requestWarp: typeof requestWarp;
    setWarpAuthority: typeof setWarpAuthority;
    runDown: typeof runDown;
    nodeBurn: typeof nodeBurn;
    ourNav: typeof ourNav;
    radialOut: typeof radialOut;
    targetDir: typeof targetDir;
    freeFallAccel: typeof freeFallAccel;
    toZamo: typeof toZamoMethod;
    fromZamo: typeof fromZamoMethod;
    thrustMax: typeof thrustMax;
    pressureThrust: typeof pressureThrust;
    refuel: typeof refuel;
    holeOmega: typeof holeOmega;
  }
}

/**
 * Time warp "on rails": beyond 500 M/s (up to 10⁵ — years of flight in seconds) with the engine
 * off. The warp comes down by itself where the flight needs to be followed — about 1/100 of an
 * orbit per frame around the hole, a few seconds before entering a body's Hill sphere (then 1/100
 * of the local orbit inside it), near the wormhole's mouth, and to 500 while the engine burns —
 * and goes back up to what was asked when it can.
 */
function rails(this: CameraController, cam: ReturnType<typeof cameraFrame>) {
  const s = this.s;
  // the pilot changed the warp: that is the new wish
  if (s.timeSpeed !== this.warpSet) this.warpWant = null;
  const want = this.warpWant ?? s.timeSpeed;
  // (the classic scenes keep their warps: the rails only engage beyond 500 M/s, or in a system)
  if (want <= 500 && s.system === "none") {
    this.warpWant = null;
    this.railsNote = "";
    this.warpSet = s.timeSpeed;
    return;
  }
  const { lim, why } = this.railsLimit(cam);
  // (never below 0.25 M/s — except near the ground, where seconds count; the autopilots' ceilings
  // combine with this one — setHubWarp)
  this.railsCap = Math.max(lim, why === "ground" ? 1e-5 : 0.25);
  const w = Math.min(want, this.railsCap);
  if (w < want) this.warpWant = want;
  else this.warpWant = null;
  // (what holds the warp, shown: in the interface's language)
  this.railsNote = w < want ? t(why) : "";
  s.timeSpeed = w;
  this.warpSet = w;
}

/** How fast time may run here (M/s), and what holds it. */
function railsLimit(this: CameraController, cam: ReturnType<typeof cameraFrame>) {
  const s = this.s;
  let lim = 1e5;
  let why = "";
  const cap = (v: number, w: string) => {
    if (v < lim) (lim = v), (why = w);
  };
  // our universe: a turn of the tightest orbit here in no less than ~2 s
  const nav = this.ourNav(cam);
  if (nav) {
    const g = gravityHome(nav.X, nav.t);
    // (a stable orbit rides the rails at any warp; else a turn of the tightest orbit in ~2 s)
    const onRails = this.pilot.throttle === 0 && this.pilot.accel === 0 && !!this.stableOrbit(nav.X, nav.V, nav.t);
    if (!onRails) cap(Math.max(0.6 * 2 * Math.PI * g.tDyn, 1e-3), BODY_NAMES[nav.ref as Body] ?? nav.ref);
    // near the ground (not on it): a frame covers no more than a fifth of the height left, the last
    // metres at the pace of the last 20 — not a stable orbit's, clear of the ground and the air (over an
    // oblate Earth its height swings ~20 km a turn, its "vertical" speed never nil: once a ×100 ceiling
    // in a 400 km orbit)
    if (!onRails && !this.ourLanded && (solidBody(nav.ref) || ourAir(nav.ref, 0) > 0) && nav.ref !== "sun") {
      const hM = Math.max(gearHeight(nav.ref, nav.X, nav.t), 20);
      const sp = groundSpeeds(nav.ref, nav.X, nav.V, nav.t);
      const vv = Math.abs(sp.vv) / C_MPS + 1e-12;
      cap(Math.max((6 * hM) / M_METRES / vv, 1e-6), "ground");
      // (the landing autopilot coming down: its ~1.2 s response a small part of the time to the
      // ground — not below real time)
      if (this.pilot.auto === "land" && sp.vv < 0) cap(Math.max((0.04 * hM) / M_METRES / vv, 1 / (4.925490947e-6 * s.massSolar)), "ground");
    }
  }
  // (the space station near: it falls by the game's own steps beside the ship — no Kepler rails, a
  // frame's step short against its orbit: ×100)
  if (issTrack.near) cap(100 / M_SECONDS, "the station");
  // (long Crew burns: a higher ceiling — the integrator follows the slow thrust at any warp)
  if (this.pilot.accel > 0 || this.pilot.throttle > 0) cap(s.engine === "crew" ? 5000 : 500, "engine");
  if (cam.region === "hole") {
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    cap(Math.max(6, (60 * 2 * Math.PI * cam.r ** 1.5) / 100), "Gargantua");
    // (a low-thrust transfer holding a circle: the pilot's ~1 s response, a small part of a turn)
    const st = this.pilot.auto === "transfer" ? this.transfer?.stage : undefined;
    if (st === "spiral" && this.transfer && this.transfer.tol !== undefined) {
      const T = this.transfer;
      const rate = 2 * this.thrustMax() * cam.r ** 1.5; // dr/dt of the spiral
      cap(Math.max(0.5, (30 * Math.max(Math.abs(cam.r - T.rs) / 3, (T.tol ?? 0) / 4)) / Math.max(rate, 1e-12)), "end of spiral");
      // (and a frame's push no more than 0.3 % of the orbital speed: where the engine rivals the
      // hole's pull, the orbit's apsis would otherwise jump past the goal in one frame)
      cap(Math.max(0.5, (30 * 0.003 * Math.max(Math.hypot(...cam.beta), 1e-3)) / Math.max(this.thrustMax(), 1e-12)), "spiral");
    }
    if (this.local) {
      // (near the ground: a frame covers no more than a fifth of the height left)
      const { F, L } = this.local;
      const d = Math.hypot(...L.xi);
      const h = Math.max(d - groundR(F, L.xi) - GEAR / F.mPerM, 0);
      const vv = Math.abs((L.w[0] * L.xi[0] + L.w[1] * L.xi[1] + L.w[2] * L.xi[2]) / d) + 1e-12;
      // (the last metres at the pace of the last 20: no Zeno descent)
      const hc = Math.max(h, 20 / F.mPerM);
      if (!L.landed) cap(Math.max((30 * hc) / (5 * vv), 1e-4), "ground");
      // (landing, taking off: the pilot's response, ~1.2 s of warp, a tenth of the time to the ground)
      const pa = this.pilot.auto;
      if ((pa === "land" && !L.landed) || pa === "takeoff")
        cap(Math.max(hc / (12 * Math.max(vv, pa === "takeoff" ? 5 / C_MPS : 0)), 1e-5), "ground");
    }
    if (st === "circ" || st === "wait") cap(Math.max(6, (2 * Math.PI * cam.r ** 1.5) / 24), "circular orbit");
    const V = this.fromZamo(cam, sphericalFrame(X), cam.beta);
    const t = this.nowTime();
    // Approaching a sphere of radius edge around a body (rel: ship − body, dv: relative velocity):
    // a frame never skips more than a third of the gap; and when the straight line ahead enters
    // the sphere, a few seconds of flight before it (a third of the gap per frame under the
    // low-thrust autopilot). A body merely nearby, not approached, holds nothing back.
    const approach = (rel: Vec3, dv: Vec3, edge: number, floor: number, why: string) => {
      const d = Math.hypot(...rel);
      const v = Math.hypot(...dv) + 1e-12;
      if (d <= edge) return;
      cap(Math.max(floor, (10 * (d - edge)) / v), why);
      const closing = -dot3(rel, dv) / d;
      if (!(closing > 0)) return;
      const along = (closing * d) / v; // distance to the closest point of the straight line
      const miss = Math.sqrt(Math.max(0, d * d - along * along));
      if (miss > 2 * edge) return;
      cap(Math.max(floor, (d - edge) / closing / (this.pilot.auto === "transfer" ? 3 / 30 : 4)), why);
    };
    for (const b of availableBodies(s, cam)) {
      if (b === "hole" || b === "barycentre") continue;
      const C = bodyCentre(s, b, t);
      const rel = sub3(X, C);
      const dv = sub3(V, bodyVelocity(s, b, t));
      const d = Math.hypot(...rel);
      if (b === "wormhole") {
        approach(rel, dv, 3 * mouth(s).rGlue, 2, "the wormhole");
        continue;
      }
      const m = bodyMass(s, b);
      if (!(m > 0)) continue;
      const D = Math.hypot(...C);
      const hill = b === "star" ? D * Math.cbrt(m / 3) : bodyHill(s, b, t);
      // (outside: see approach — at worst 1/100 of an orbit at its sphere's edge per frame)
      if (d > hill) approach(rel, dv, hill, (60 * 2 * Math.PI * Math.sqrt(hill ** 3 / m)) / 100, BODY_NAMES[b]);
      // (inside: an orbit around a system body in no less than ~12 s, which the orbit autopilot can
      // follow; the classic scenes' star, 1.7 s)
      else cap((2 * Math.PI * Math.sqrt(Math.max(d, bodyRadius(s, b)) ** 3 / m)) / (b === "star" ? 1.67 : 12), BODY_NAMES[b]);
    }
  }
  return { lim, why };
}

/** The ship's state now (Kerr geodesic), or null away from the hole. */
function stateNow(this: CameraController) {
  const cam = cameraFrame(this.s);
  if (cam.region !== "hole") return null;
  return fromZamo(cam.r, cam.theta, cam.phi, cam.beta, this.s.spin, this.nowTime());
}

function world(this: CameraController) {
  // the first burn at least ~8 s away at the current warp: time to turn the ship
  return { a: this.s.spin, lens: this.lens(), lead: 8 * (this.s.animate ? this.s.timeSpeed : 0) };
}

/**
 * Plans a transfer: "orbit" a circular orbit of radius r2 around the hole, "star" a rendezvous with
 * the companion (then station-keeping), "wormhole" a path through the mouth. Returns a message.
 */
function planTransfer(this: CameraController, goal: "orbit" | "star" | "wormhole", r2 = 30, o: { orbitStar?: boolean } = {}): string {
  const s = this.s;
  // (the Crew engine's burns last days: its own guidance, not impulsive nodes)
  if (s.engine === "crew") return this.planLowThrust(goal, r2, !!o.orbitStar);
  this.transfer = null;
  const now = this.stateNow();
  if (!now) return t("Planning works around the black hole");
  let w = this.world();
  // after a planned plane change: the transfer starts from the aligned orbit
  let st = now;
  let pre: ManeuverNode[] = [];
  if (this.plan.kind === "align" && this.plan.nodes.length === 1 && this.plan.nodes[0]!.t > now.t) {
    const after = planPath(now, this.plan.nodes, w, 1)?.states[0];
    if (after) (st = after), (pre = this.plan.nodes), (w = { ...w, lead: 0 });
  }
  let res: { nodes: ManeuverNode[]; note: string } | null = null;
  if (goal === "orbit") {
    const rMin = Math.max(isco(s.spin) * 1.02, horizon(s.spin) + 2);
    res = planCircular(st, Math.max(r2, rMin), w);
    if (!res) return t("No transfer found (inside the photon orbit, or out of reach)");
  } else if (goal === "star") {
    // the companion star, or in a system the targeted body (a planet, Edmunds' star)
    const body: Body =
      s.system !== "none" && s.target !== "hole" && s.target !== "wormhole" && s.target !== "barycentre" ? s.target : "star";
    if (body === "star" && !s.sun) return t("No companion star in this scene: select a body (Tab)");
    const R = bodyRadius(s, body);
    const mB = bodyMass(s, body);
    res = planRendezvous(st, w, {
      centre: (t) => bodyCentre(s, body, t),
      velocity: (t) => bodyVelocity(s, body, t),
      radius: R,
      // an orbit: close in (3.2 radii — well inside the Hill radius, ≈ 0.32 D; the orbit autopilot
      // then holds it against Gargantua's tides), in the sense the ship arrives with
      standoff: (o.orbitStar ? 3.2 : 4) * R,
      orbit: o.orbitStar && mB > 0 ? { mass: mB, n: [0, 0, 1] } : undefined,
    });
    if (!res) return tf("No rendezvous with {0} found", BODY_NAMES[body]);
    s.target = body;
  } else {
    if (!s.wormhole) return t("No wormhole in this scene");
    const m = mouth(s);
    res = planIntercept(st, s.whOrbit ? (t: number) => mouth(s, t).C as Vec3 : (m.C as Vec3), w, 0.25 * m.w.rho, {
      accel: this.thrustMax(),
    });
    if (!res) return t("No path into the mouth found from this orbit");
    s.target = "wormhole";
  }
  const nodes = [...pre, ...res.nodes];
  this.plan = { nodes, path: null, at: 0, note: pre.length ? tf("plane aligned, then {0}", res.note) : res.note };
  this.refreshPlan(true);
  const dv = nodes.reduce((a, n) => a + Math.hypot(...n.dv), 0);
  return nodes.length > 1
    ? tf("Plan: {0} · {1} burns · Δv {2} c", this.plan.note, nodes.length, dv.toFixed(3))
    : tf("Plan: {0} · 1 burn · Δv {1} c", this.plan.note, dv.toFixed(3));
}

/**
 * Our universe: plans a circular orbit around the reference body ("orbit", at altKm), a transfer
 * to the target ("target": then orbit, fly by, or a free return home) or to the wormhole's mouth.
 * The planner works in its worker (seconds of n-body paths); the plan is shown when it answers.
 */
async function planOurs(
  this: CameraController,
  kind: "orbit" | "target" | "wormhole",
  arrival: Arrival,
  altKm: number,
  retKm: number,
): Promise<string> {
  const s = this.s;
  const nav = this.ourNav(cameraFrame(s));
  if (!nav) return t("Planning: in our universe (or around the black hole with PLAN TRANSFER)");
  if (this.planBusy) return t("Planning… (still working on the last one)");
  const target = kind === "wormhole" ? "wormhole" : kind === "orbit" ? nav.ref : String(s.target);
  // (the space station: a rendezvous beside its forward port — iss-plan.ts)
  if (kind === "target" && (s.target === "iss" || isCraft(s.target))) return this.planIss(nav);
  if (kind === "target" && !isOurBody(s.target as Body))
    return t("Transfer: select a body of ours as the target (Tab, or a click on the map)");
  // (the first burn at least a minute away, and ~10 s of the pilot's time at this warp)
  const o = { lead: Math.max(60 / M_SECONDS, 10 * (s.animate ? s.timeSpeed : 0)), mouthR: mouth(s).w.rho, accel: this.thrustMax() };
  this.planBusy = true;
  const gen = ++this.planGen;
  try {
    const res = await runPlanner<OurPlanResult>(
      kind === "orbit"
        ? { kind: "orbit", X: nav.X, V: nav.V, t: nav.t, altM: altKm * 1e3, o }
        : {
            kind: "transfer",
            X: nav.X,
            V: nav.V,
            t: nav.t,
            goal: { kind: "transfer", target, arrival, altM: altKm * 1e3, returnAltM: retKm * 1e3 },
            o,
          },
    );
    if (gen !== this.planGen) return "";
    if ("error" in res) return res.error;
    this.plan = {
      nodes: res.nodes.map((n: PlanNode) => ({ t: n.t, dv: n.dv, then: n.then ?? null, role: n.role, body: n.body })),
      path: null,
      at: 0,
      note: res.note,
    };
    this.ourMission = res.mission;
    this.ourPlanned = res.path;
    if (kind === "wormhole") s.target = "wormhole";
    this.refreshPlan(true);
    const dv = res.nodes.reduce((a, n) => a + Math.hypot(...n.dv), 0) * C_MPS;
    return tf("Plan: {0} · Δv {1}", res.note, dv >= 1000 ? `${(dv / 1000).toFixed(2)} km/s` : `${dv.toFixed(0)} m/s`);
  } finally {
    if (gen === this.planGen) this.planBusy = false;
  }
}

/**
 * The flight computer's MISSION tab: a mission to another body planned — not yet in the plan —,
 * previewed (its path on the maps, its burns, its arrival), then adopted by `missionCommit`.
 * Our side: a transfer to a body (orbit, flyby, free return), the wormhole, a rendezvous with the
 * station or a craft. Gargantua's: a rendezvous with one of its worlds or the companion star (in orbit
 * about it, or beside it), the wormhole. The burns (s from now, m/s) or why not.
 */
async function missionPlan(
  this: CameraController,
  spec: {
    target: string;
    arrival?: Arrival;
    altKm?: number;
    retKm?: number;
    orbit?: boolean;
  },
): Promise<
  | { ok: true; note: string; burns: Burn[]; dvTotal: number; arrive: { body: string; t: number } | null; afterText: string }
  | { ok: false; note: string }
> {
  const s = this.s;
  const cam = cameraFrame(s);
  const c = C_MPS;
  const Msec = 4.925490947e-6 * s.massSolar;
  const fail = (note: string) => ({ ok: false as const, note });
  const gen = ++this.planGen;
  this.pendingMission = null;
  const roleName: Record<string, string> = {
    depart: t("departure"),
    circ: t("circularize"),
    mcc: t("correction"),
    capture: t("capture"),
    mccReturn: t("return correction"),
    captureHome: t("capture home"),
    arrive: t("arrival"),
  };
  const burnsOf = (nodes: { t: number; dv: Vec3; role?: string }[], t0: number): Burn[] =>
    nodes.map((n, k) => ({
      t: (n.t - t0) * Msec,
      dv: [n.dv[0] * c, n.dv[1] * c, n.dv[2] * c] as KV3,
      label: roleName[n.role ?? ""] ?? tf("burn {0}", k + 1),
    }));
  const sum = (b: Burn[]) => b.reduce((q, x) => q + Math.hypot(...x.dv), 0);
  const name = (id: string) =>
    id === "wormhole"
      ? t("the wormhole")
      : (BODY_NAMES[id as Body] ??
        (isCraft(id as Target) ? tf("the {0}", VESSELS[id as VesselId].name) : id === "iss" ? t("the ISS") : id));
  const nav = this.ourNav(cam);
  if (nav) {
    const target = spec.target;
    const lead = Math.max(60 / M_SECONDS, 10 * (s.animate ? s.timeSpeed : 0));
    // the station, a craft of the fleet: the rendezvous beside a free docking port
    if (target === "iss" || isCraft(target as Target)) {
      if (nav.ref !== "earth") return fail(t("A rendezvous: from an orbit around the Earth"));
      const craft = isCraft(target as Target) ? (target as VesselId) : null;
      if (craft && freePort(craft) === null) return fail(tf("The {0}: no free docking port", VESSELS[craft].name));
      const point = craft ? craftPoint(craft) : rendezvousPoint;
      const p = planIssRendezvous(
        nav.X,
        nav.V,
        nav.t,
        lead,
        point,
        // (the planner's own English note: the English name)
        craft ? `the ${VESSELS[craft].name}` : "the ISS",
        craft ? `its ${VESSELS[craft].ports[freePort(craft)!]!.name}` : "IDA-2",
      );
      if (!p) return fail(tf("No rendezvous with {0} found in the next day", name(target)));
      if (gen !== this.planGen) return fail("");
      const burns = burnsOf(
        p.nodes.map((n) => ({ t: n.t, dv: n.dv as Vec3, role: n.role })),
        nav.t,
      );
      this.pendingMission = {
        gen,
        note: p.note,
        commit: () => {
          s.target = target as Target;
          this.ourMission = null;
          this.ourPlanned = null;
          this.plan = {
            nodes: p.nodes.map((n) => ({
              t: n.t,
              dv: n.dv,
              then: n.role === "arrive" ? ("dock" as const) : null,
              role: n.role as ManeuverNode["role"],
              body: craft && n.role === "arrive" ? craft : n.body,
            })),
            path: null,
            at: 0,
            note: p.note,
          };
          this.issGoal = { tArrive: p.tArrive, refined: new Map(), body: craft ?? "iss", point };
          this.refreshPlan(true);
        },
      };
      const arrive = { body: craft ?? "iss", t: p.tArrive };
      this.fcPreview(burns, p.note, { arrive });
      return {
        ok: true,
        note: p.note,
        burns,
        dvTotal: sum(burns),
        arrive,
        afterText: tf("Arrival 200 m off {0}'s port in {1}, then the docking autopilot", name(target), fmtDur((p.tArrive - nav.t) * Msec)),
      };
    }
    if (target !== "wormhole" && !isOurBody(target as Body))
      return fail(t("Pick a destination (a body, the station, a craft, the wormhole)"));
    if (target === nav.ref) return fail(tf("Already about {0}: the ORBIT tab's operations", name(target)));
    const arrival = target === "wormhole" ? "flyby" : (spec.arrival ?? "orbit");
    const o = { lead, mouthR: mouth(s).w.rho, accel: this.thrustMax() };
    this.planBusy = true;
    try {
      const res = await runPlanner<OurPlanResult>({
        kind: "transfer",
        X: nav.X,
        V: nav.V,
        t: nav.t,
        goal: { kind: "transfer", target, arrival, altM: (spec.altKm ?? 200) * 1e3, returnAltM: (spec.retKm ?? 200) * 1e3 },
        o,
      });
      if (gen !== this.planGen) return fail("");
      if ("error" in res) return fail(res.error);
      const burns = burnsOf(
        res.nodes.map((n) => ({ t: n.t, dv: n.dv as Vec3, role: n.role })),
        nav.t,
      );
      this.pendingMission = {
        gen,
        note: res.note,
        commit: () => {
          this.issGoal = null;
          this.plan = {
            nodes: res.nodes.map((n: PlanNode) => ({ t: n.t, dv: n.dv, then: n.then ?? null, role: n.role, body: n.body })),
            path: null,
            at: 0,
            note: res.note,
          };
          this.ourMission = res.mission;
          this.ourPlanned = res.path;
          s.target = target as Target;
          this.refreshPlan(true);
        },
      };
      const arrive = { body: target, t: res.mission.tArrive };
      this.fcPreview(burns, res.note, { ours: res.path, arrive });
      const what =
        arrival === "orbit"
          ? tf("into a {0} km orbit", spec.altKm ?? 200)
          : arrival === "flyby"
            ? tf("a flyby at {0} km", spec.altKm ?? 200)
            : tf("round it at {0} km and back home to {1} km", spec.altKm ?? 200, spec.retKm ?? 200);
      return {
        ok: true,
        note: res.note,
        burns,
        dvTotal: sum(burns),
        arrive,
        afterText:
          target === "wormhole"
            ? tf("Into the wormhole's mouth in {0} — the throat crossed", fmtDur((res.mission.tArrive - nav.t) * Msec))
            : tf("Arrival at {0} in {1} — {2}", name(target), fmtDur((res.mission.tArrive - nav.t) * Msec), what),
      };
    } finally {
      if (gen === this.planGen) this.planBusy = false;
    }
  }
  // Gargantua's side: about the hole (or from a world's frame): its own planners on the geodesics
  const st = this.stateNow();
  if (!st) return fail(t("Missions: about the hole or one of its worlds"));
  const w = this.world();
  if (spec.target === "wormhole") {
    if (!s.wormhole) return fail(t("No wormhole in this scene"));
    const m = mouth(s);
    const res = planIntercept(st, s.whOrbit ? (t: number) => mouth(s, t).C as Vec3 : (m.C as Vec3), w, 0.25 * m.w.rho, {
      accel: this.thrustMax(),
    });
    if (!res) return fail(t("No path into the mouth found from this orbit"));
    const burns = burnsOf(res.nodes, st.t);
    this.pendingMission = { gen, note: res.note, commit: () => this.adoptKerr(res.nodes, res.note, "wormhole") };
    this.fcPreview(burns, res.note);
    return {
      ok: true,
      note: res.note,
      burns,
      dvTotal: sum(burns),
      arrive: null,
      afterText: t("Into the mouth — the throat crossed to our side"),
    };
  }
  const body = spec.target as Body;
  if (body === "star" && !s.sun) return fail(t("No companion star in this scene"));
  if (body !== "star" && (s.system === "none" || !bodyRadius(s, body)))
    return fail(t("Pick a destination: one of Gargantua's worlds, the star, the wormhole"));
  const R = bodyRadius(s, body);
  const mB = bodyMass(s, body);
  const orbitIt = spec.orbit !== false && mB > 0;
  const res = planRendezvous(st, w, {
    centre: (t) => bodyCentre(s, body, t),
    velocity: (t) => bodyVelocity(s, body, t),
    radius: R,
    standoff: (orbitIt ? 3.2 : 4) * R,
    orbit: orbitIt ? { mass: mB, n: [0, 0, 1] } : undefined,
  });
  if (!res) return fail(tf("No rendezvous with {0} found", name(body)));
  const burns = burnsOf(res.nodes, st.t);
  const tArr = res.nodes[res.nodes.length - 1]!.t;
  this.pendingMission = { gen, note: res.note, commit: () => this.adoptKerr(res.nodes, res.note, body) };
  const arrive = { body, t: tArr };
  this.fcPreview(burns, res.note, { arrive });
  return {
    ok: true,
    note: res.note,
    burns,
    dvTotal: sum(burns),
    arrive,
    afterText: tf(
      "Arrival at {0} in {1} — {2}",
      name(body),
      fmtDur((tArr - st.t) * Msec),
      orbitIt ? t("then in orbit about it") : t("then beside it, station-keeping"),
    ),
  };
}

/**
 * The MISSION tab's destinations from where the ship is: our side, the planets and moons (grouped by
 * what they orbit), the station and the fleet's craft about the Earth, the wormhole; Gargantua's, its
 * worlds, the companion star, the wormhole — each with how far it is now.
 */
function missionTargets(this: CameraController): {
  universe: "ours" | "gargantua" | null;
  here: string | null;
  list: { id: string; name: string; group: string; far: string }[];
} {
  const s = this.s;
  const cam = cameraFrame(s);
  const nav = this.ourNav(cam);
  const fmt = (m: number) =>
    m >= 1.495978707e10
      ? `${(m / AU_M).toFixed(2)} AU`
      : m >= 1e7
        ? `${Math.round(m / 1e3).toLocaleString("en")} km`
        : `${(m / 1e3).toFixed(0)} km`;
  if (nav) {
    const list: { id: string; name: string; group: string; far: string }[] = [];
    const dist = (X: Vec3) => Math.hypot(...sub3(X, nav.X)) * M_METRES;
    for (const b of SOLAR_BODIES) {
      if (b.kind === "star") continue;
      const group = b.parent === "sun" ? t("Planets") : tf("{0}'s moons", solarBody(b.parent!)?.name ?? b.parent ?? "");
      list.push({ id: b.id, name: b.name, group, far: fmt(dist(solarState(b.id, nav.t).pos)) });
    }
    if (nav.ref === "earth") {
      if (s.iss) list.push({ id: "iss", name: "ISS", group: t("Craft about the Earth"), far: "" });
      for (const id of ["ranger", "lander", "endurance"] as VesselId[]) {
        if (fleet.flownAssembly().includes(id)) continue;
        const p = fleet.pose(id, nav.t);
        if (p) list.push({ id, name: VESSELS[id].name, group: t("Craft about the Earth"), far: fmt(dist(p.X as Vec3)) });
      }
    }
    if (s.wormhole) list.push({ id: "wormhole", name: t("The wormhole"), group: t("Beyond"), far: fmt(Math.hypot(...nav.X) * M_METRES) });
    return { universe: "ours", here: nav.ref, list };
  }
  if (cam.region !== "hole") return { universe: null, here: null, list: [] };
  const list: { id: string; name: string; group: string; far: string }[] = [];
  const X = this.stateNow();
  const at = X
    ? (() => {
        const q = X;
        const sn = Math.sin(q.th);
        return [q.r * sn * Math.cos(q.ph), q.r * sn * Math.sin(q.ph), q.r * Math.cos(q.th)] as Vec3;
      })()
    : null;
  const tNow = this.nowTime();
  const far = (b: Body) => (at ? `${Math.hypot(...sub3(bodyCentre(s, b, tNow), at)).toFixed(1)} M` : "");
  if (s.system !== "none")
    for (const b of SYSTEM_BODIES)
      if (bodyRadius(s, b as Body) > 0)
        list.push({ id: b, name: BODY_NAMES[b as Body] ?? b, group: t("Gargantua's worlds"), far: far(b as Body) });
  if (s.sun) list.push({ id: "star", name: BODY_NAMES.star ?? t("The star"), group: t("The companion"), far: far("star") });
  if (s.wormhole) list.push({ id: "wormhole", name: t("The wormhole"), group: t("Beyond"), far: "" });
  return { universe: "gargantua", here: this.local?.F.id ?? null, list };
}

/** A mission's plan about the hole adopted: its nodes, the target. */
function adoptKerr(this: CameraController, nodes: ManeuverNode[], note: string, target: Target) {
  this.transfer = null;
  this.plan = { nodes, path: null, at: 0, note };
  this.s.target = target;
  this.refreshPlan(true);
}

function missionCommit(this: CameraController): string | null {
  const m = this.pendingMission;
  if (!m) return t("No mission previewed");
  this.fcPreview(null);
  this.clearPlan();
  m.commit();
  this.pendingMission = null;
  return null;
}

/**
 * Plans the rendezvous with the station, or with a craft of the fleet (iss-plan.ts): four nodes —
 * departure, two corrections, arrival 200 m off its (free) docking port.
 */
function planIss(this: CameraController, nav: NonNullable<ReturnType<CameraController["ourNav"]>>): string {
  const s = this.s;
  if (nav.ref !== "earth") return t("Rendezvous: from an orbit around the Earth");
  const lead = Math.max(60 / M_SECONDS, 10 * (s.animate ? s.timeSpeed : 0));
  const craft = isCraft(s.target) ? s.target : null;
  if (craft && freePort(craft) === null) return tf("The {0}: no free docking port", VESSELS[craft].name);
  const point = craft ? craftPoint(craft) : rendezvousPoint;
  const name = craft ? `the ${VESSELS[craft].name}` : "the ISS";
  const p = planIssRendezvous(
    nav.X,
    nav.V,
    nav.t,
    lead,
    point,
    name,
    craft ? `its ${VESSELS[craft].ports[freePort(craft)!]!.name}` : "IDA-2",
  );
  if (!p) return tf("No rendezvous with {0} found in the next day", craft ? tf("the {0}", VESSELS[craft].name) : t("the ISS"));
  this.ourMission = null;
  this.ourPlanned = null;
  // (arrived 200 m out: the docking autopilot takes the last of it)
  this.plan = {
    nodes: p.nodes.map((n) => ({
      t: n.t,
      dv: n.dv,
      then: n.role === "arrive" ? ("dock" as const) : null,
      role: n.role as ManeuverNode["role"],
      body: n.body,
    })),
    path: null,
    at: 0,
    note: p.note,
  };
  this.issGoal = { tArrive: p.tArrive, refined: new Map(), body: craft ?? "iss", point };
  if (craft) for (const n of this.plan.nodes) if (n.role === "arrive") n.body = craft;
  this.refreshPlan(true);
  return tf("Plan: {0}", p.note);
}

/**
 * Executing the rendezvous: the next node re-aimed from the ship's real state — a correction twice
 * (when it becomes the next, and at a third of the way to it), the arrival as it nears. Never holds
 * the burn back (the arcs are solved here, at once).
 */
function issRefineTick(
  this: CameraController,
  nav: NonNullable<ReturnType<CameraController["ourNav"]>>,
  node: ManeuverNode,
  burnT: number,
): boolean {
  const g = this.issGoal!;
  if (this.nodeBurning || node.role === "depart") return false;
  const n = g.refined.get(node) ?? 0;
  const toNode = node.t - nav.t;
  const due = n === 0 || (n === 1 && toNode < 0.35 * (node.t - (this.plan.at || nav.t))) || (n < 4 && toNode < 4 * burnT + 30 / M_SECONDS);
  if (!due || toNode < burnT) return false;
  const dv = refineIssNode(nav.X, nav.V, nav.t, node, g.tArrive, g.point);
  g.refined.set(node, n + 1);
  if (!dv) return false;
  // (a correction too small to fly — under 2 cm/s: dropped)
  if (node.role === "mcc" && Math.hypot(...dv) * C_MPS < 0.02 && n > 0) {
    const i = this.plan.nodes.indexOf(node);
    if (i >= 0) {
      this.plan.nodes.splice(i, 1);
      this.onPilotMessage?.(t("Mid-course correction not needed"));
    }
  } else node.dv = dv;
  this.refreshPlan(true);
  return false;
}

/**
 * Executing a mission in our universe: the next node re-aimed from the ship's real state — when it
 * becomes the next one, and closer to it (a correction twice, a capture's periapsis a few times as
 * it nears) — in the planner's worker; a correction no longer needed is dropped.
 * True while a re-aim is under way and the burn is close (the burn waits for it).
 */
function ourRefineTick(
  this: CameraController,
  nav: NonNullable<ReturnType<CameraController["ourNav"]>>,
  node: ManeuverNode,
  burnT: number,
): boolean {
  const m = this.ourMission;
  if (!m || !node.role) return false;
  let st = this.refineState.get(node);
  if (!st) {
    st = { at: -Infinity, n: 0, pending: false };
    this.refineState.set(node, st);
  }
  const toNode = node.t - nav.t;
  const start = toNode - burnT / 2;
  if (st.pending) return start < 3 * Math.max(this.s.timeSpeed, 1e-6);
  if (this.nodeBurning || start < 2 * burnT + 0.02) return false;
  const cheap = node.role === "capture" || node.role === "captureHome" || node.role === "circ" || node.role === "arrive";
  const maxN = cheap ? 8 : 3;
  const due = st.n === 0 || (st.n < maxN && toNode < (cheap ? 0.4 : 0.15) * (node.t - st.at));
  // (a departure: once within a turn of the orbit, the plan's two-body wait now flown)
  if (!due || (node.role === "depart" && st.n === 0 && toNode > 1.2 * this.ourPeriod(nav) && toNode > (0.3 * DAY_S) / M_SECONDS))
    return false;
  st.pending = true;
  st.at = nav.t;
  st.n++;
  const o = { lead: Math.min(Math.max(60 / M_SECONDS, burnT), 0.8 * start), mouthR: mouth(this.s).w.rho, accel: this.thrustMax() };
  const pn: PlanNode = {
    t: node.t,
    dv: node.dv,
    role: node.role,
    body: node.body,
    then: node.then === "circularize" ? "circularize" : undefined,
  };
  const generation = this.predictionGeneration;
  void runPlanner<{ node: PlanNode | null } | { error: string }>({
    kind: "refine",
    X: nav.X,
    V: nav.V,
    t: nav.t,
    mission: m,
    node: pn,
    o,
  }).then((r) => {
    st!.pending = false;
    if (generation !== this.predictionGeneration) return;
    this.lastRefine = { role: node.role!, at: nav.t, result: r };
    const i = this.plan.nodes.indexOf(node);
    if (i < 0 || "error" in r) return;
    if (!r.node) {
      // (no correction needed — now: kept at zero while far, re-aimed nearer its time; dropped at
      // its last look)
      const nav2 = this.ourNav(cameraFrame(this.s));
      const far = nav2 && node.t - nav2.t > (0.5 * 86400) / M_SECONDS && st!.n < 3;
      if (far) node.dv = [0, 0, 0];
      else {
        this.plan.nodes.splice(i, 1);
        this.onPilotMessage?.(node.role === "mccReturn" ? t("Return correction not needed") : t("Mid-course correction not needed"));
      }
    } else {
      node.t = r.node.t;
      node.dv = r.node.dv;
      // (a departure re-aimed onto another meeting: the mission's, for its corrections and capture)
      const M = this.ourMission;
      if (M && r.node.tArrive !== undefined) {
        M.tEnd += r.node.tArrive - M.tArrive;
        M.tArrive = r.node.tArrive;
      }
    }
    this.refreshPlan(true);
  });
  return start < 3 * Math.max(this.s.timeSpeed, 1e-6);
}

/**
 * The plane a goal lives in (normal, flat map): Gargantua's equator — the disk's, and the star's
 * orbit's — or, for the wormhole, the plane through the hole and the mouth nearest the ship's.
 */
function goalPlane(
  this: CameraController,
  goal: "orbit" | "star" | "wormhole",
  st: NonNullable<ReturnType<CameraController["stateNow"]>>,
): { n: Vec3; name: string } | null {
  if (goal !== "wormhole")
    return { n: [0, 0, 1], name: goal === "star" ? t("the star's orbital plane") : t("Gargantua's equatorial plane") };
  if (!this.s.wormhole) return null;
  const C = mouth(this.s).C as Vec3;
  const c = lin(C, 1 / (Math.hypot(...C) || 1), C, 0);
  const h = orbitNormal(st, this.s.spin);
  let n = sub3(h, lin(c, h[0] * c[0] + h[1] * c[1] + h[2] * c[2], c, 0));
  if (Math.hypot(...n) < 1e-6) n = [-c[1], c[0], 0];
  return { n, name: t("the plane of the mouth") };
}

/** Plans a plane change into the goal's plane (a later PLAN TRANSFER starts from there). */
function planAlignMethod(this: CameraController, goal: "orbit" | "star" | "wormhole"): string {
  const st = this.stateNow();
  if (!st) return t("Planning works around the black hole");
  const g = this.goalPlane(goal, st);
  if (!g) return t("No wormhole in this scene");
  const res = planAlign(st, this.world(), g.n, g.name);
  if (!res) return tf("Already in {0}", g.name);
  this.plan = { nodes: res.nodes, path: null, at: 0, note: res.note, kind: "align" };
  this.refreshPlan(true);
  return tf("Plan: {0} · Δv {1} c — PLAN TRANSFER now starts from the new plane", res.note, Math.hypot(...res.nodes[0]!.dv).toFixed(3));
}

/** Angle between the ship's orbit and each goal's plane [°], null away from the hole. */
function planeOffsets(this: CameraController) {
  const st = this.stateNow();
  if (!st) return null;
  const deg = (g: "orbit" | "wormhole") => {
    const p = this.goalPlane(g, st);
    return p ? (planeOffset(st, this.s.spin, p.n) * 180) / Math.PI : null;
  };
  return { orbit: deg("orbit")!, wormhole: deg("wormhole") };
}

/** A manual node, `after` M from now (default: a tenth of an orbit), or its Δv / time nudged. */
function addNode(this: CameraController, after?: number) {
  // our universe: a tenth of a turn around the reference body ahead (or `after`)
  const cam = cameraFrame(this.s);
  // (the first node: the plan belongs to the universe it is placed in)
  if (!this.plan.nodes.length) this.plan.universe = nodeUniverse(this.s, cam);
  const nav = this.ourNav(cam);
  if (nav) {
    const period = this.ourPeriod(nav);
    const t = nav.t + (after ?? Math.max(0.1 * period, 8 * this.s.timeSpeed, 0.2));
    this.plan.nodes.push({ t, dv: [0, 0, 0] });
    this.plan.nodes.sort((a, b) => a.t - b.t);
    this.plan.note = tf("manual node");
    this.plan.kind = undefined;
    this.refreshPlan(true);
    return;
  }
  const st = this.stateNow();
  if (!st) return;
  const t = st.t + (after ?? Math.max(30, 0.1 * 2 * Math.PI * st.r ** 1.5, 8 * this.s.timeSpeed));
  this.plan.nodes.push({ t, dv: [0, 0, 0] });
  this.plan.nodes.sort((a, b) => a.t - b.t);
  this.plan.note = tf("manual node");
  this.plan.kind = undefined;
  this.refreshPlan(true);
}

function nudgeNode(this: CameraController, i: number, dv: Vec3, dt = 0) {
  const n = this.plan.nodes[i];
  if (!n) return;
  this.plan.kind = undefined;
  n.dv = [n.dv[0] + dv[0], n.dv[1] + dv[1], n.dv[2] + dv[2]];
  n.t = Math.max(this.nowTime() + 1, n.t + dt);
  this.refreshPlan(true);
}

function deleteNode(this: CameraController, i: number) {
  this.plan.nodes.splice(i, 1);
  if (!this.plan.nodes.length) this.clearPlan();
  else this.refreshPlan(true);
}

function clearPlan(this: CameraController) {
  this.issGoal = null;
  this.plan = { nodes: [], path: null, at: 0, note: "" };
  this.ourMission = null;
  this.ourPlanned = null;
  this.transfer = null;
  this.warpAfter = null;
  if (this.pilot.auto === "transfer") this.pilot.setAuto("transfer");
  if (this.pilot.auto === "node") this.pilot.setAuto("node");
  this.restoreWarp();
}

/**
 * The universe whose frame a node placed here is in: ours on our side of the throat's centre (the home
 * frame, ourNav), else Gargantua's. It matches the tunnel's exits (±a) outside the tunnel; inside it,
 * where both frames meet, manoeuvres are suspended before their universe is looked at.
 */
const nodeUniverse = (s: CameraController["s"], cam: ReturnType<typeof cameraFrame>) => (onOurSide(s, cam) ? "ours" : "gargantua");

/**
 * Whether the plan's manoeuvres apply where the ship is: they belong to the universe they were planned
 * in — stamped with the first node (a planner's whole plan: as it is first looked at), forgotten with
 * the last, so that an emptied plan takes the universe of the next node added.
 */
function planApplies(this: CameraController, cam: ReturnType<typeof cameraFrame>) {
  const P = this.plan;
  const here = nodeUniverse(this.s, cam);
  if (!P.nodes.length) P.universe = undefined;
  else P.universe ??= here;
  return P.universe === here;
}

/** The path through the nodes, from the current state (at most 3 times a second). */
function refreshPlan(this: CameraController, force = false) {
  const P = this.plan;
  const now = frameNow();
  const frame = cameraFrame(this.s);
  const applies = this.planApplies(frame);
  if (!P.nodes.length) {
    this.ourPlan = null;
    return (P.path = null);
  }
  if (!applies || (frame.region === "throat" && (Math.abs(frame.ell) <= mouth(this.s).w.a || !this.ourNav(frame)))) {
    this.ourPlan = null;
    return (P.path = null);
  }
  // (at most 3 times a second — less when a prediction costs more than a few ms)
  if (!force && now - P.at < Math.max(330, 8 * this.planCost)) return P.path;
  P.at = now;
  // our universe: the path through the nodes by the Newtonian predictor (the hole's map: none)
  const nav = this.ourNav(cameraFrame(this.s));
  if (nav) {
    let nodes = P.nodes.filter((n) => n.t > nav.t - 1e-6);
    if (this.nodeBurning && this.pilot.auto === "node" && nodes[0]) {
      const n0 = nodes[0];
      const total = Math.hypot(...(this.burnFollow ?? n0.dv));
      const left = Math.max(0, total - this.nodeDone);
      nodes = [{ ...n0, t: nav.t, dv: lin(n0.dv, left / Math.max(total, 1e-15), n0.dv, 0) }, ...nodes.slice(1)];
    }
    const m = this.ourMission;
    // (a mission: its whole span; the first burn days away in a low orbit — beyond what the map's
    // prediction reaches — the planner's own path)
    // (before the departure: the planner's own path — from a low orbit, months of it are more than
    // a frame can predict)
    if (m && this.ourPlanned && nodes[0]?.role === "depart") {
      this.ourPlan = this.ourPlanned;
      return (P.path = null);
    }
    const mouthR = mouth(this.s).w.rho,
      accel = this.thrustMax();
    const list = nodes.map((n) => ({ t: n.t, dv: n.dv }));
    // (every node behind the ship — passed, not flown: the plan's path is the free one)
    if (!list.length) {
      this.ourPlan = null;
      return (P.path = null);
    }
    if (m) {
      // (a mission: the flight's own step — the display's path is the one flown)
      const span = { tMax: Math.max(m.tEnd - nav.t, 0) * 1.1 + (0.3 * DAY_S) / M_SECONDS, maxSteps: 6000, step: 0.025 };
      const t0 = performance.now();
      this.ourPlan = predictOurs(nav.X, nav.V, nav.t, list, { mouthR, accel, ...span, drag: this.dragPerMass() });
      this.planCost = performance.now() - t0;
      return (P.path = null);
    }
    // hand-made nodes: the far path (a turn of the orbit after the last burn — days to the Moon)
    // in the planner's worker, kept while the nodes stay as they are; meanwhile — a node just made
    // or pulled — a short one here, to the last node and half an hour on (the map continues it
    // with conics until the far one comes)
    const key = JSON.stringify(list);
    const far = this.farPlan;
    if (far && far.key === key) this.ourPlan = far.path;
    else {
      const t0 = performance.now();
      const last = list[list.length - 1]!.t;
      this.ourPlan = predictOurs(nav.X, nav.V, nav.t, list, {
        mouthR,
        accel,
        tMax: Math.max(last - nav.t, 0) + 1800 / M_SECONDS,
        maxSteps: 3000,
        drag: this.dragPerMass(),
      });
      this.planCost = performance.now() - t0;
    }
    if (!this.farBusy && (!far || far.key !== key || now - far.at > 2000)) {
      this.farBusy = true;
      const generation = this.predictionGeneration;
      runPlanner<OurPath>({ kind: "predictPlan", X: nav.X, V: nav.V, t: nav.t, nodes: list, mouthR, accel, drag: this.dragPerMass() })
        .then((path) => {
          if (generation !== this.predictionGeneration) return;
          if (!path || (path as unknown as { error?: string }).error) return;
          this.farPlan = { key, path, at: frameNow() };
          // (still these nodes: shown at once)
          if (
            this.plan.nodes.length &&
            JSON.stringify(this.plan.nodes.filter((n) => n.t > path.times[0]! - 1e-6).map((n) => ({ t: n.t, dv: n.dv }))) === key
          )
            this.ourPlan = path;
        })
        .finally(() => {
          if (generation === this.predictionGeneration) this.farBusy = false;
        });
    }
    return (P.path = null);
  }
  this.ourPlan = null;
  const st = this.stateNow();
  if (!st) return (P.path = null);
  // drop nodes left behind (missed or done)
  const last = P.nodes[P.nodes.length - 1]!;
  // (a rendezvous ends at the body: the station-keeping autopilot takes over there)
  const tail =
    last.then === "approach"
      ? last.t - st.t + 40
      : last.then === "orbit"
        ? last.t - st.t + 2 * Math.PI * Math.sqrt((4 * this.s.sunRadius) ** 3 / Math.max(this.s.sunMass, 1e-3))
        : Math.max(2 * 2 * Math.PI * st.r ** 1.5, 1.5 * (last.t - st.t), 600);
  // mid-burn: what is left of the first node's Δv, now
  let nodes = P.nodes;
  if (this.nodeBurning && this.pilot.auto === "node" && this.burnDir) {
    const n0 = nodes[0]!;
    const total = Math.hypot(...n0.dv);
    const left = Math.max(0, total - this.nodeDone);
    const dv =
      this.s.engine === "crew"
        ? lin(n0.dv, left / Math.max(total, 1e-12), n0.dv, 0)
        : nodeComponents(st, this.s.spin, lin(this.burnDir, left, this.burnDir, 0));
    nodes = [{ ...n0, t: st.t, dv }, ...nodes.slice(1)];
  }
  const res = planPath(
    st,
    nodes.filter((n) => n.t > st.t - 1),
    this.world(),
    Math.min(tail, 60000),
  );
  P.path = res?.path ?? null;
  // through the wormhole's mouth: the path ends in the throat (the flat map knows nothing beyond)
  if (P.path && this.s.wormhole) {
    const m = mouth(this.s);
    const d = P.path.pts.map((q) => Math.hypot(...sub3(q, m.C as Vec3)));
    const j0 = d.findIndex((x) => x < m.rGlue);
    if (j0 >= 0) {
      let j = j0;
      while (j + 1 < d.length && d[j + 1]! < d[j]!) j++;
      if (d[j]! < m.w.rho) P.path = { pts: P.path.pts.slice(0, j + 1), times: P.path.times.slice(0, j + 1), fate: "wormhole" };
    }
  }
  return P.path;
}

function restoreWarp(this: CameraController) {
  if (this.userWarp !== null) this.s.timeSpeed = this.userWarp;
  this.userWarp = null;
  this.nodeWarpWant = null;
  this.nodeWarpSet = NaN;
  this.nodeWarp = "";
  this.nodeBurning = false;
  this.nodeDone = 0;
  this.burnDir = null;
  this.burnFollow = null;
}

/**
 * An autopilot's ceiling on the warp, this frame — whoever flies. Under the hub's authority the warp is
 * the ceiling; under the pilot's (WARP: YOU) it is the pilot's own, never above it: their wish is kept
 * while held (hubWarpWant) and given back once no ceiling holds it (flyShip). Every ceiling of the frame
 * combines — the others, the rails' —, in any order: none relaxes another.
 */
function setHubWarp(this: CameraController, ceiling: number) {
  const s = this.s;
  this.hubWarpLimit = Math.min(this.hubWarpLimit ?? Infinity, ceiling);
  const cap = Math.min(this.hubWarpLimit, this.railsCap);
  // (first held: the pilot's warp as they asked for it — the rails may have held it lower already)
  if (s.autoWarp) this.hubWarpWant = null;
  else this.hubWarpWant ??= this.warpWant ?? s.timeSpeed;
  this.warpWant = null; // (held here: the rails must not give it back above the ceiling)
  s.timeSpeed = this.warpSet = s.autoWarp ? cap : Math.min(this.hubWarpWant!, cap);
}

/** The pilot's own warp the autopilots' ceilings held, given back: the rails take it as the wish. */
function releaseHubWarp(this: CameraController) {
  if (this.hubWarpWant === null) return;
  this.s.timeSpeed = this.hubWarpWant;
  this.hubWarpWant = null;
  this.warpWant = null;
}

/**
 * An autopilot done gives the warp back: under the hub's authority, `w` (the warp it kept for the
 * pilot, or real time); under the pilot's, their own wish its ceilings held.
 */
function giveBackWarp(this: CameraController, w: number) {
  if (!this.s.autoWarp) return this.releaseHubWarp();
  this.s.timeSpeed = this.warpSet = w;
  this.warpWant = null;
}

/**
 * The pilot's warp, asked for with the keys or the time bar (main.ts): the scene runs at it now, never
 * above the autopilots' ceiling — under the pilot's authority, the wish such a ceiling keeps (that of
 * a manoeuvre executing: its own) and gives back. A crossing's warp asked for is kept beyond the throat.
 */
function requestWarp(this: CameraController, speed: number) {
  const s = this.s;
  const engaged = this.pilot.auto !== "none";
  if (!s.autoWarp && this.pilot.auto === "node") this.nodeWarpWant = speed;
  else if (!s.autoWarp && this.hubWarpWant !== null) this.hubWarpWant = speed;
  this.crossingWarp = false;
  this.warpWant = null;
  s.timeSpeed = this.warpSet = Math.min(speed, engaged ? (this.hubWarpLimit ?? Infinity) : Infinity);
  if (this.pilot.auto === "node") this.nodeWarpSet = s.timeSpeed;
}

/**
 * Who sets the warp while an autopilot flies (the hub card's WARP, the time bar's AUTO): the hub, or the
 * pilot below its ceilings — from the warp as it runs now.
 */
function setWarpAuthority(this: CameraController, auto: boolean) {
  this.s.autoWarp = auto;
  this.hubWarpWant = null;
  this.nodeWarpWant = null;
  if (this.hubWarpLimit !== null && this.pilot.auto !== "none" && this.pilot.auto !== "node") this.setHubWarp(this.hubWarpLimit);
}

/** A goal burn's direction (local): along the velocity still to gain to a circle, or its sense. */
function goalDir(this: CameraController, node: ManeuverNode, cam: ReturnType<typeof cameraFrame>, total: number): Vec3 {
  const g = node.goal!;
  if ("plane" in g) {
    const st = this.stateNow();
    return st ? planeLeft(st, this.world(), g.plane).dir : dvLocal(cam.beta, node.dv);
  }
  if ("circ" in g) {
    const st = this.stateNow();
    const d = st && circLeft(st, this.world());
    if (d && Math.hypot(...d) > 1e-12) return dvLocal(cam.beta, d);
    return dvLocal(cam.beta, node.dv);
  }
  return dvLocal(cam.beta, [g.dir * total, 0, 0]);
}

/**
 * The warp while a manoeuvre executes: the autopilot's (auto warp), or the pilot's — chosen live
 * with the warp keys — never above the autopilot's: a coast faster than that would pass the burn's
 * start, a burn faster would overshoot its Δv.
 */
function setNodeWarp(this: CameraController, auto: number) {
  const s = this.s;
  // (the frame's other ceilings too: none relaxed)
  const cap = (this.hubWarpLimit = Math.min(this.hubWarpLimit ?? Infinity, auto));
  if (s.autoWarp) this.nodeWarpWant = null;
  else {
    // (the pilot changed the warp since the last frame: that is the new choice; auto warp just
    // turned off, or the manoeuvre just begun: the warp as it stands — the pilot's, never the
    // autopilot's ceiling taken for their wish)
    if (this.nodeWarpWant === null || s.timeSpeed !== this.nodeWarpSet) this.nodeWarpWant = s.timeSpeed;
  }
  const want = this.nodeWarpWant;
  const w = want === null ? cap : Math.min(want, cap);
  s.timeSpeed = this.nodeWarpSet = w;
  this.nodeWarp = want === null ? "auto" : want > cap * (1 + 1e-9) ? "held" : "manual";
}

/**
 * Our universe: the Δv [c] a Crew engine still gives once cut now — its thrust runs down over its spool
 * time (8 m/s of the Ranger's at full thrust), in real time at any warp. A burn's cutoff, flown or cued,
 * comes that much early.
 */
function runDown(this: CameraController): number {
  const s = this.s;
  if (s.engine !== "crew" || !this.ourNav(cameraFrame(s))) return 0;
  return this.pilot.engineNow * this.thrustMax() * VESSELS[fleet.active].spool * (1 / (4.925490947e-6 * s.massSolar));
}

/** Gargantua's side: each arrival node's last distance to the mouth's sphere [M] (nodeBurn). */
const arriveGap = new WeakMap<ManeuverNode, number>();

/** Our universe: the velocity still to gain to the mean circle where the craft is, about its reference body (home, c). */
function circleGain(nav: NonNullable<ReturnType<CameraController["ourNav"]>>): Vec3 {
  const rel = sub3(nav.V, nav.refVel);
  const c = circularVelocity(nav.ref, solarBody(nav.ref)!.mass, sub3(nav.X, nav.refPos), rel, nav.t);
  return sub3(c.v, rel);
}

/**
 * Executing the next node: warp towards it, point along its burn, fire so that the burn is centred
 * on its time, stop when its Δv is delivered; then the next one, or the plan's last manoeuvre
 * (circularize, station-keeping).
 */
function nodeBurn(
  this: CameraController,
  cam: ReturnType<typeof cameraFrame>,
  dt: number,
  dtau: number,
): { dir: Vec3; throttle: number; far?: boolean } | null {
  const s = this.s;
  const P = this.plan;
  const node = P.nodes[0];
  const nav = this.ourNav(cam);
  const applies = this.planApplies(cam);
  if (node && cam.region === "throat" && Math.abs(cam.ell) <= mouth(s).w.a && !(node.role === "arrive" && node.body === "wormhole")) {
    this.pilot.setAuto("node");
    this.restoreWarp();
    this.onPilotMessage?.(t("Flight plan suspended: manoeuvres are unavailable inside the tunnel"));
    return null;
  }
  if (node && !applies && !(node.role === "arrive" && node.body === "wormhole")) {
    this.pilot.setAuto("node");
    this.restoreWarp();
    this.onPilotMessage?.(t("Flight plan suspended: its manoeuvres belong to the other universe"));
    return null;
  }
  if (!node || (cam.region !== "hole" && !nav)) {
    // (a mission into the wormhole, its throat now under way: arrived — the warp that crosses it
    // kept, the plan done)
    if (node?.role === "arrive" && node.body === "wormhole") {
      const v = Math.hypot(...cam.beta);
      this.userWarp = Math.max(this.userWarp ?? 0, Math.min((24 * mouth(s).w.rho) / Math.max(v, 1e-9) / 20, 1e4));
      P.nodes = [];
      this.ourMission = null;
      this.ourPlanned = null;
      this.missionHold = false;
      this.traversing = this.crossingWarp = true;
    }
    this.pilot.setAuto("node");
    this.restoreWarp();
    return null;
  }
  // (Gargantua's side, a correction on the way to the mouth: aimed as it comes — from the path flown,
  // all the bodies' pulls in —, the arrival's time with it)
  if (
    !nav &&
    node.role === "mcc" &&
    node.body === "wormhole" &&
    !this.nodeBurning &&
    !this.kerrAimed.has(node) &&
    node.t - this.nowTime() < 30
  ) {
    this.kerrAimed.add(node);
    const st = this.stateNow();
    const fix =
      st && s.wormhole
        ? planIntercept(st, (t: number) => mouth(s, t).C as Vec3, this.world(), 0.25 * mouth(s).w.rho, {
            at: Math.max(node.t, st.t + 1),
            fine: true,
            accel: this.thrustMax(),
          })
        : null;
    node.dv = fix ? fix.nodes[0]!.dv : [0, 0, 0];
    if (fix) node.t = fix.nodes[0]!.t;
    const arrive = P.nodes[P.nodes.length - 1];
    const fa = fix?.nodes[fix.nodes.length - 1];
    if (arrive?.role === "arrive" && fa?.role === "arrive") {
      // (the corrections still to come kept at their share of the coast left: the arrival moves with each)
      for (const q of P.nodes)
        if (q !== node && q.role === "mcc" && arrive.t > node.t) q.t = node.t + ((q.t - node.t) * (fa.t - node.t)) / (arrive.t - node.t);
      arrive.t = fa.t;
    }
    this.refreshPlan(true);
  }
  // (Gargantua's side, the arrival at the mouth: kept ahead of the craft until the throat takes it — its
  // time where the mouth's sphere is reached at the speed flown, the coast's warp slowing to it —, not
  // flown as a burn of nothing at the planned instant, a little short of the mouth, the plan then over)
  if (!nav && node.role === "arrive" && node.body === "wormhole" && s.wormhole && cam.region === "hole") {
    const m = mouth(s, this.nowTime());
    const d = Math.hypot(...sub3(blToCartesian(cam.r, cam.theta, cam.phi), m.C as Vec3)) - m.rGlue;
    const was = arriveGap.get(node);
    arriveGap.set(node, d);
    // (going away from it: missed — the plan ends, said)
    if (was !== undefined && d > was && d > m.rGlue) {
      P.nodes = [];
      this.pilot.setAuto("node");
      this.restoreWarp();
      this.onPilotMessage?.(tf("The wormhole's mouth missed by {0} M", (d + m.rGlue).toFixed(2)));
      return null;
    }
    // (a moment beyond it: never reached as a burn, the throat's own branch above takes the craft)
    node.t = this.nowTime() + Math.max(d, 0) / Math.max(Math.hypot(...cam.beta), 1e-3) + 1;
  }
  // (our side, the arrival at the mouth: as Gargantua's — kept ahead of the craft, the coast's warp
  // bringing it in, until the mouth's reach takes it (no home frame there: the throat's own branch above
  // hands the crossing's warp over); going away from it: missed, the plan ended at real time. It was once
  // flown as a burn of nothing at its planned instant, short of the mouth, the plan over at ×1)
  if (nav && node.role === "arrive" && node.body === "wormhole" && s.wormhole && node.t - this.nowTime() < 1) {
    const d = Math.hypot(...sub3(nav.X, ourTarget(s, "wormhole" as Body, nav.t).pos));
    const was = arriveGap.get(node);
    arriveGap.set(node, d);
    if (was !== undefined && d > was) {
      P.nodes = [];
      this.pilot.setAuto("node");
      this.restoreWarp();
      s.timeSpeed = this.warpSet = 1 / (4.925490947e-6 * s.massSolar);
      this.onPilotMessage?.(tf("The wormhole's mouth missed by {0} M", d.toFixed(2)));
      return null;
    }
    node.t = this.nowTime() + 1 + d / Math.max(Math.hypot(...nav.V), 1e-9);
  }
  // (the pilot's warp before the plan, given back after it: their own, if an autopilot's ceiling held it)
  if (this.userWarp === null) {
    this.releaseHubWarp();
    this.userWarp = s.timeSpeed;
  }
  // (our universe: the burn follows the orbital frame — the node's impulse as that burn delivers it,
  // a turn of the velocity flown as its arc (fc/kepler.ts followDv); fixed as the burn starts)
  const ndv: Vec3 = nav
    ? this.nodeBurning && this.burnFollow
      ? this.burnFollow
      : followDv(node.dv as KV3, Math.hypot(...sub3(nav.V, nav.refVel)))
    : node.dv;
  const total = Math.hypot(...ndv);
  // (our universe, a node that ends in a circle — the CIRC's, a mission's capture —: flown to that circle
  // where the craft is, the velocity still to gain to it steered as the burn goes (geopotential.ts
  // meanCircular), not the planned impulse: the planner's two bodies miss the oblateness's pull — 15 % of
  // a circularization from 200 × 600 km, which the trim then had to take back; a burn the pilot flies by
  // hand keeps its planned impulse — the cue cuts it, the trim does the rest)
  const toCircle = nav && !this.pilot.assist && node.then === "circularize" ? circleGain(nav) : null;
  const left = toCircle ? Math.hypot(...toCircle) : Math.max(0, total - this.nodeDone);
  // (the burn keeps the direction it had when it started: fixed in the local frame, not turning
  // with the velocity it changes)
  // (a Crew burn lasts a good part of an orbit: it follows the orbital frame — prograde, normal,
  // radial turn with the ship — and is centred on the node, a finite burn)
  // (our universe: the burn follows the orbital frame of the reference body, as a Crew burn)
  // (a goal burn about the hole follows the prograde — or the retrograde —, as its estimate has it)
  const follow = s.engine === "crew" || !!nav || (!!node.goal && !nav);
  const dir = toCircle
    ? nav!.toRep(toCircle)
    : this.nodeBurning && this.burnDir && !follow
      ? this.burnDir
      : nav
        ? nav.toRep(nodeDvHome(nav.X, nav.V, nav.t, ndv))
        : node.goal
          ? this.goalDir(node, cam, total)
          : dvLocal(cam.beta, node.dv);
  const dl = Math.hypot(...dir) || 1;
  const aMax = Math.max(this.thrustMax(), 1e-9);
  const burnT = total / aMax / Math.max(dtau, 1e-3); // coordinate duration of the whole burn
  // (our universe, a mission's node: re-aimed as it nears — the burn waits for an answer due)
  const hold = nav ? (this.issGoal ? this.issRefineTick(nav, node, burnT) : this.ourRefineTick(nav, node, burnT)) : false;
  const toNode = node.t - this.nowTime();
  const start = toNode - burnT / 2;
  // (assisted: the pilot flies the burn — lit a little early, it starts then; the warp no faster than
  // a pilot follows: the last seconds before it, and the burn itself, over 20 s at least, in real time)
  const assisted = this.pilot.assist;
  const realTime = 1 / (4.925490947e-6 * s.massSolar);
  if (!this.nodeBurning && (start <= 0 || (assisted && this.pilot.throttle > 0.02 && start < burnT / 2)) && !hold) {
    if (this.missionHold && this.pilot.hold === "prograde") this.pilot.hold = "none";
    this.missionHold = false;
    this.nodeBurning = true;
    this.burnDir = lin(dir, 1 / dl, dir, 0);
    this.burnFollow = nav ? ndv : null;
  }
  // (a goal burn about the hole: what is left is what the path still needs — re-estimated a few
  // times a second)
  let goalLeft: number | null = null;
  // (a goal burn's throttle where its thrust does little: a plane change away from the nodes)
  let goalGate = 1;
  if (this.nodeBurning && !nav && node.goal && "plane" in node.goal) {
    const st = this.stateNow();
    const pl = st ? planeLeft(st, this.world(), node.goal.plane) : null;
    goalLeft = pl ? pl.left : 0;
    goalGate = pl ? clamp((pl.eff - 0.55) / 0.3, 0, 1) : 1;
    // (a long turn costs more than the node's impulse, spread over the orbit)
    if (this.nodeDone > 2.5 * total) goalLeft = 0;
  } else if (this.nodeBurning && !nav && node.goal && "circ" in node.goal) {
    const st = this.stateNow();
    const d = st && circLeft(st, this.world());
    goalLeft = d ? Math.hypot(...d) : 0;
    if (this.nodeDone > 1.5 * total) goalLeft = 0;
  } else if (this.nodeBurning && !nav && node.goal) {
    const goal = node.goal as Extract<KerrGoal, { apsis: number } | { period: number }>;
    {
      const G = this.goalRem;
      const tw = frameNow();
      if (!G || G.node !== node || tw - G.at > 250) {
        const st = this.stateNow();
        const guess = G && G.node === node ? Math.max(G.rem - (this.nodeDone - G.done), 0) : left;
        if (st)
          this.goalRem = {
            node,
            rem:
              "period" in goal
                ? periodLeft(st, this.world(), goal, Math.max(guess, 0.02 * total))
                : apsisLeft(st, this.world(), goal, Math.max(guess, 0.02 * total)),
            at: tw,
            done: this.nodeDone,
          };
      }
      const H = this.goalRem;
      goalLeft = H && H.node === node ? Math.max(H.rem - (this.nodeDone - H.done), 0) : left;
      // (runaway: no more than thrice the plan's — a burn longer than the orbit spirals, and costs more)
      if (this.nodeDone > 3 * total) goalLeft = 0;
    }
  }
  if (this.nodeBurning) {
    // burn: about 2 s of the pilot's time for the whole burn (warp adapted); a Crew burn, ~10 s
    let w = follow ? Math.min(Math.max(burnT / 10, 0.05), 5000) : Math.min(Math.max(burnT / 2, 0.05), 200);
    // (a goal burn's end slowed: its last part over ~3 s, the path re-estimated meanwhile)
    if (goalLeft !== null) w = Math.min(w, Math.max(goalLeft / aMax / Math.max(dtau, 1e-3) / 3, 0.05));
    // (our universe: the end of a burn slowed down — a frame gives at most half of what is left —
    // to cut it within a cm/s: 1 m/s at the Earth's departure is ~1 000 km at the Moon)
    // (a Crew engine answers its throttle with a lag: cut now, it still gives its thrust over its spool
    // time — 8 m/s of the Ranger's at full thrust —; our universe's burns are cut that much early, and
    // done once it has run down)
    const tail = nav ? this.runDown() : 0;
    // (the engine cut, running down: in real time — its tail is what it is, at any warp)
    if (nav)
      w = Math.min(w, Math.max((left - tail) / (2 * aMax * Math.max(dt * dtau, 1e-6)), tail > 0 && left <= tail ? realTime : 0.0005));
    const lft = goalLeft ?? left;
    if (assisted) {
      const rest = lft / aMax / Math.max(dtau, 1e-3);
      w = Math.min(w, Math.max(burnT / 20, realTime), Math.max(rest / 4, realTime));
    }
    this.setNodeWarp(w);
    const perFrame = aMax * s.timeSpeed * dt * dtau;
    // (done: within a thousandth of the node's Δv — our universe's burns are km/s, 10⁻⁵ c: there,
    // within a cm/s; assisted, within what a hand cuts — 0.2 % or 10 cm/s — and the engine cut)
    // (the cue to cut comes as early as the engine's run-down: cut at the cue, the run-down gives the rest)
    const cut = assisted && lft - tail <= Math.max(2e-3 * total, nav ? 0.1 / C_MPS : 1e-6);
    const done = assisted
      ? cut && this.pilot.throttle <= 0.01
      : (toCircle
          ? left <= 0.02 / C_MPS
          : nav
            ? left <= Math.max(3e-11, 1e-6 * total)
            : lft <= Math.max(Math.min(1e-5, 1e-3 * total), 0.02 * perFrame)) ||
        lft < 1e-12 ||
        // (the engine run down, a few cm/s from the end: the last of it is the trim's)
        (!!nav && this.pilot.engineNow < 1e-3 && left <= (toCircle ? 0.3 : 0.05) / C_MPS);
    if (done) {
      this.goalRem = null;
      P.nodes.shift();
      this.nodeDone = 0;
      this.nodeBurning = false;
      this.burnDir = null;
      this.burnFollow = null;
      // (a circularization a long burn left off its radius: a Hohmann's correction, its burns short)
      const g = node.goal;
      if (g && "circ" in g && g.trim && !P.nodes.length && !nav) {
        const st = this.stateNow();
        if (st && Math.abs(st.r - g.circ) > 0.005 * g.circ) {
          const fix = kHohmann(st, this.world(), g.circ);
          if (fix.ok) {
            P.nodes = fix.nodes.map((n, i) => ({
              ...n,
              label: i ? t("circularize (correction)") : t("correction"),
              goal: n.goal && "circ" in n.goal ? { circ: n.goal.circ } : n.goal,
            }));
            P.note = `${P.note} — ${tf("correction to {0} M", g.circ.toFixed(2))}`;
            this.onPilotMessage?.(
              tf(
                "Circular at {0} M: a correction to {1} M ({2} km/s)",
                st.r.toFixed(2),
                g.circ.toFixed(2),
                (fix.nodes.reduce((q, n) => q + Math.hypot(...n.dv), 0) * 299792.458).toFixed(0),
              ),
            );
            this.refreshPlan(true);
            return null;
          }
        }
      }
      // (the pilot's warp before the plan between its nodes — not a choice of the pilot's —, no faster
      // than this frame's ceiling: the frame's step is still to fly, before the next node's coast sets
      // its own warp — at the pilot's, it once flew minutes past a burn's ceiling in one step)
      s.timeSpeed = this.nodeWarpSet = P.nodes.length ? Math.min(this.userWarp!, this.hubWarpLimit ?? Infinity) : this.userWarp;
      if (!P.nodes.length) {
        const then = node.then ?? null;
        // (into the wormhole: the throat is months wide at this speed — a warp that crosses it in
        // ~20 s is kept, not the pilot's real time)

        this.ourMission = null;
        this.ourPlanned = null;
        this.issGoal = null;
        this.missionHold = false;
        this.userWarp = null;
        P.path = null;
        this.pilot.auto = "none";
        // (a circularization after the node: the trim where it is — the pilot's run kept, else a new one)
        if (then === "circularize") this.ourCirc = this.ourCirc ? { ...this.ourCirc, mode: "trim" } : { mode: "trim", spent0: this.spent };
        if (then) this.pilot.setAuto(then);
        if (then === "dock") this.onPilotMessage?.(t("At the ISS — the docking autopilot takes over"));
        else if (node.role === "arrive")
          this.onPilotMessage?.(
            node.body === "wormhole"
              ? t("Into the wormhole's throat — Gargantua's side at its end")
              : tf("{0} passed", BODY_NAMES[node.body as Body] ?? node.body ?? ""),
          );
        else
          this.onPilotMessage?.(
            then
              ? tf(
                  "Manoeuvre done — {0}",
                  then === "circularize"
                    ? t("circularizing")
                    : then === "orbit"
                      ? tf("in orbit around {0}", this.s.target === "star" ? t("the star") : BODY_NAMES[this.s.target])
                      : t("station-keeping"),
                )
              : t("Manoeuvre done"),
          );
      } else this.refreshPlan(true);
      return null;
    }
    return {
      dir: lin(dir, 1 / dl, dir, 0),
      throttle: cut ? 0 : goalGate * Math.min(1, Math.max(lft - tail, 0) / Math.max(perFrame, 1e-12)),
    };
  }
  // coast: warp so that the burn's start comes in ~2.5 s, slower once close (the nose is already
  // on the burn: it turns while coasting)
  const coast = start - 20;
  let w = coast > 0 ? Math.min(Math.max(coast / 2.5, 4), 1e5) : Math.min(Math.max(start / 1.5, 3), 12);
  // (our universe: seconds matter — a burn of minutes in a low orbit; the warp down to real time)
  // (a short burn — a correction of a few m/s — is approached at ×5 at least, not in real time)
  if (nav)
    w = coast > 0 ? Math.min(Math.max(start / 3, 0.002), 1e5) : Math.max(Math.min(start / 2, w), burnT * M_SECONDS > 30 ? 0.002 : 0.01);
  if (hold) w = Math.min(w, Math.max(start / 4, 0.002));
  // (assisted: the ignition's last seconds in real time — its countdown followed)
  if (assisted) w = Math.min(w, Math.max(start / 8, realTime));
  // (a long coast rides the rails, held back near bodies like any flight)
  if (s.system !== "none" || w > 500) w = Math.min(w, Math.max(this.railsLimit(cam).lim, 3));
  this.setNodeWarp(w);
  // (our universe, a mission's cruise: the SAS on prograde until the next manoeuvre nears — ten
  // minutes, or a few burn lengths — then onto the burn; a hold the pilot chose is kept)
  const far = nav ? start > Math.max(600 / M_SECONDS, 3 * burnT) : start > 60;
  if (nav) {
    // (assisted: the pilot's attitude, none set for it)
    if (far && this.pilot.hold === "none" && !this.pilot.assist) {
      this.pilot.hold = "prograde";
      this.missionHold = true;
    } else if (!far && this.missionHold && this.pilot.hold === "prograde") {
      this.pilot.hold = "none";
      this.missionHold = false;
    }
  }
  return { dir: lin(dir, 1 / dl, dir, 0), throttle: 0, far };
}

/**
 * Our universe: the ship in the home frame, and the body its orbital directions refer to (the
 * smallest sphere of influence it is in): place, velocity, and those as local (rep) vectors.
 */
function ourNav(this: CameraController, cam: ReturnType<typeof cameraFrame>) {
  const s = this.s;
  if (!onOurSide(s, cam) || s.system !== "gargantua") return null;
  const t = this.nowTime();
  const w = mouth(s).w;
  const X = homeOf(w, cam.ell, cam.n);
  const V = repToHomeVec(w, cam.ell, cam.n, cam.beta);
  const ref = referenceBody(X, t);
  const st = ourState(ref, t);
  const R = sub3(X, st.pos);
  const toRep = (v: Vec3) => homeToRep(w, cam.ell, cam.n, v);
  const Rr = toRep(R);
  return { X, V, ref, refPos: st.pos, refVel: st.vel, refVelRep: toRep(st.vel), radial: lin(Rr, 1 / Math.hypot(...Rr), Rr, 0), toRep, t };
}

function radialOut(this: CameraController, cam: ReturnType<typeof cameraFrame>): Vec3 | null {
  if (cam.region === "hole") return [1, 0, 0];
  const nav = this.ourNav(cam);
  if (nav) return nav.radial;
  // in the throat region: away from the throat (increasing |ℓ|)
  return lin(cam.n, Math.sign(cam.ell) || 1, cam.n, 0);
}

/** Direction of the selected target, local components (the flat map's straight line). */
function targetDir(this: CameraController, cam: ReturnType<typeof cameraFrame>): Vec3 | null {
  const s = this.s;
  if (onOurSide(s, cam)) return ourLook(s, cam, sub3(ourTarget(s, s.target, this.nowTime()).pos, cameraHome(s, cam)));
  if (cam.region !== "hole") return null;
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  const f = sphericalFrame(X);
  // where the body is seen: its position when the light left it (retarded time, flat estimate)
  const t0 = this.nowTime();
  let C = s.target === "hole" ? ([0, 0, 0] as Vec3) : bodyCentre(s, s.target, t0);
  if (s.target !== "hole") {
    for (let k = 0; k < 3; k++) C = bodyCentre(s, s.target, t0 - Math.hypot(...sub3(C, X)));
  }
  const d = sub3(C, X);
  const l = Math.hypot(...d);
  if (l < 1e-9) return null;
  // seen from the moving ship: relativistic aberration (towards the motion), as the tracer draws it
  const n: Vec3 = [dot3(d, f.er) / l, dot3(d, f.et) / l, dot3(d, f.ep) / l];
  const b = cam.beta;
  const b2 = dot3(b, b);
  if (b2 < 1e-12) return n;
  const g = 1 / Math.sqrt(1 - b2);
  const bn = dot3(n, b) / Math.sqrt(b2);
  const w = axpy(axpy(n, b, g), b, ((g - 1) * bn) / Math.sqrt(b2));
  return lin(w, 1 / Math.hypot(...w), w, 0);
}

/** Coordinate acceleration of the 4-velocity in free fall (local components): what gravity does to us. */
function freeFallAccel(this: CameraController, cam: ReturnType<typeof cameraFrame>, beta: Vec3 = cam.beta): Vec3 {
  if (cam.region !== "hole") return [0, 0, 0];
  const a = this.s.spin;
  const st = fromZamo(cam.r, cam.theta, cam.phi, beta, a, this.nowTime());
  const h = Math.max(1e-4, 2e-4 * (cam.r - horizon(a)));
  const U0 = toU(beta);
  const U1 = toU(toZamo(geoStep(st, a, h, this.lens()), a));
  return lin(sub3(U1, U0), 1 / h, U0, 0);
}

/** A coordinate velocity (flat map, Cartesian) as the ZAMO at the camera measures it, and back. */
function toZamoMethod(this: CameraController, cam: ReturnType<typeof cameraFrame>, f: ReturnType<typeof sphericalFrame>, W: Vec3): Vec3 {
  return coordToZamo([dot3(W, f.er), dot3(W, f.et), dot3(W, f.ep)], cam.r, cam.theta, cam.zamo);
}

function fromZamoMethod(this: CameraController, cam: ReturnType<typeof cameraFrame>, f: ReturnType<typeof sphericalFrame>, b: Vec3): Vec3 {
  return add3(f.er, f.et, f.ep, zamoToCoord(b, cam.r, cam.theta, cam.zamo));
}

/** The engine's maximum proper acceleration now [c²/M]: none once the tank is empty. */
function thrustMax(this: CameraController) {
  const s = this.s;
  if (fuelOn(s) && tank(s, this.spent).empty) return 0;
  // (the craft flown: its own engines' force — a share of the crew setting's at full tanks —, over its
  // assembly's mass now: the craft docked to it pushed along, the propellant burnt lightening it; in the
  // air, the ambient pressure on the nozzle's exit taken off)
  const V = VESSELS[fleet.active];
  const a = (engineThrust(s) * V.accel * V.mass * this.pressureThrust()) / fleet.massProps().mass;
  // (and no more than its structure bears — 85 % of its load limit, the engine throttled back as the
  // propellant burnt lightens the craft: a long low-thrust transfer at 2 g once reached 9.7 g, the
  // Ranger broken up; the Cinema engine's fictional thousands of g are borne by nothing — engine.ts)
  if (loadShare(s) <= 0) return a;
  return Math.min(a, (0.85 * V.aero.gMax * G0 * 1476.625 * s.massSolar) / C_MPS ** 2);
}

/** The main engine's thrust over its vacuum thrust here: the ambient pressure on its exit (engine.ts). */
function pressureThrust(this: CameraController) {
  if (this.s.engine !== "crew") return 1;
  const A = this.airFlight.last?.air;
  if (!A || !(A.rho > 0)) return 1;
  // (p = ρ R T, the gas's own constant)
  const p = A.rho * (A.gas?.R ?? 287.05) * A.T;
  return pressureFactor(VESSELS[fleet.active].slThrust, p);
}

/** Fills the tank again. */
function refuel(this: CameraController) {
  this.spent = 0;
}

/** Angular rate of a circular orbit around the hole through C (the frame a body there turns with). */
function holeOmega(this: CameraController, C: Vec3) {
  return 1 / (Math.hypot(...C) ** 1.5 + Math.abs(this.s.spin));
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installPlan(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    rails,
    railsLimit,
    stateNow,
    world,
    planTransfer,
    planOurs,
    missionPlan,
    missionTargets,
    adoptKerr,
    missionCommit,
    planIss,
    issRefineTick,
    ourRefineTick,
    goalPlane,
    planAlign: planAlignMethod,
    planeOffsets,
    addNode,
    nudgeNode,
    deleteNode,
    clearPlan,
    refreshPlan,
    planApplies,
    restoreWarp,
    goalDir,
    setNodeWarp,
    setHubWarp,
    releaseHubWarp,
    giveBackWarp,
    requestWarp,
    setWarpAuthority,
    runDown,
    nodeBurn,
    ourNav,
    radialOut,
    targetDir,
    freeFallAccel,
    toZamo: toZamoMethod,
    fromZamo: fromZamoMethod,
    thrustMax,
    pressureThrust,
    refuel,
    holeOmega,
  });
}
