// The space blocks of the crew's snapshot (PLAN-VAISSEAUX K1 — net/instruments-space.ts): built in the simulator from
// what the flight already knows (its status, its paths, its plan, its systems), the heavy ones (the paths, the bodies)
// only on the snapshot's once-a-second tick. Lengths in km about each body on the home frame's axes.

import { warpFactor } from "../clock";
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import type { RangerStatus } from "../game/status";
import type { InstrumentBody, InstrumentSpace, InstrumentTrajSeg, V3 } from "../net/instruments-space";
import { SPACE_BOUNDS } from "../net/instruments-space";
import { roomCraft } from "../net/spacefleet";
import type { OurPath } from "../system/our-predict";
import { GARGANTUA_SYSTEM } from "../system/bodies";
import { bodyState } from "../system/ephemeris";
import { cartToGeodetic, flatteningOf } from "../system/ellipsoid";
import { SOLAR_BODIES, solarBody, solarState } from "../system/solar";
import { C_MPS, M_METRES, M_SECONDS } from "../units";
import { VESSELS, type VesselId } from "../vessels";
import type { Info } from "./flighthud";
import { LPD } from "../controller/lowthrust";

const KM = M_METRES / 1000;
const KMS = C_MPS / 1000;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** a body's place [M] in the home frame at a time [M] (the wormhole's mouth: the origin) */
function bodyAt(id: string, tm: number): { pos: V3; vel: V3 } {
  if (!solarBody(id)) return { pos: [0, 0, 0], vel: [0, 0, 0] };
  const s = solarState(id, tm);
  return { pos: s.pos as V3, vel: s.vel as V3 };
}

/** A path cut into its spheres' pieces, each about its body [km], times from now [s]; `budget` points in all, shared
 *  by the pieces as their lengths (two at least each) — the room's 16 KB an event. */
export function trajSegments(p: OurPath | null, t: number, budget: number = SPACE_BOUNDS.pts): InstrumentTrajSeg[] {
  if (!p || p.pts.length < 2) return [];
  const runs: { body: string; from: number; to: number }[] = [];
  for (let j = 0; j < p.pts.length; j++) {
    const ref = p.refs[j] ?? "";
    const last = runs.at(-1);
    if (last && last.body === ref) last.to = j;
    else runs.push({ body: ref, from: j, to: j });
  }
  const kept = runs.slice(0, SPACE_BOUNDS.segs);
  const total = kept.reduce((a, r) => a + r.to - r.from + 1, 0);
  return kept.map((run) => {
    const n = run.to - run.from + 1;
    const share = Math.max(2, Math.min(SPACE_BOUNDS.pts, Math.floor((budget * n) / total)));
    const step = Math.max(1, Math.ceil(n / (share - 1)));
    const pts: V3[] = [];
    const ts: number[] = [];
    const take = (j: number) => {
      const b = bodyAt(run.body, p.times[j]!).pos;
      const q = p.pts[j]!;
      pts.push([Math.round((q[0] - b[0]) * KM), Math.round((q[1] - b[1]) * KM), Math.round((q[2] - b[2]) * KM)]);
      ts.push(Math.round(p.times[j]! * M_SECONDS - t));
    };
    for (let j = run.from; j <= run.to; j += step) take(j);
    if ((run.to - run.from) % step !== 0) take(run.to);
    return { body: run.body, pts, t: ts };
  });
}

/** The bodies worth drawing about a sphere: the Sun and its planets, the moons of the body flown about (or of its
 *  planet). */
function bodiesNear(body: string, tm: number): InstrumentBody[] {
  const planet = solarBody(body)?.parent === "sun" || body === "sun" ? body : (solarBody(body)?.parent ?? "");
  return SOLAR_BODIES.filter((b) => b.parent === null || b.parent === "sun" || b.parent === planet)
    .slice(0, SPACE_BOUNDS.bodies)
    .map((b) => {
      const s = bodyAt(b.id, tm);
      return {
        id: b.id,
        r: [Math.round(s.pos[0] * KM), Math.round(s.pos[1] * KM), Math.round(s.pos[2] * KM)] as V3,
        v: [r3(s.vel[0] * KMS), r3(s.vel[1] * KMS), r3(s.vel[2] * KMS)] as V3,
        mu: Math.round(b.mass * M_METRES * C_MPS * C_MPS * 1e-9),
        radius: Math.round(b.radius * KM),
        parent: b.parent ?? "",
      };
    });
}

/** The two clocks since the flight began (the Relativity view's time gone by on the Earth): taken together at the
 *  start — again when the proper time goes back (a new flight: controller/rotation.ts) —; the room's clock set forward
 *  (a date chosen, a scene's) not counted: its jump beyond what the craft's clock and its pace allow taken out. */
export function clocksStep(
  K: { t: number; tau: number; lastT: number; lastTau: number } | null,
  t: number,
  tau: number,
  dtau: number,
): { t: number; tau: number; lastT: number; lastTau: number } {
  if (!K || tau < K.lastTau - 1e-6 || t < K.t) return { t, tau, lastT: t, lastTau: tau };
  const dRoom = t - K.lastT,
    expect = (tau - K.lastTau) / Math.max(dtau, 1e-6);
  const shift = dRoom > expect * 1.5 + 5 ? dRoom - expect : 0;
  return { t: K.t + shift, tau: K.tau, lastT: t, lastTau: tau };
}

/** The space blocks now; `heavy` the once-a-second tick (the paths, the bodies). */
export function crewSpace(
  c: CameraController,
  i: Info,
  status: RangerStatus | null,
  t: number,
  heavy: boolean,
  /** the light delay played for the ground stations: the room's, its owner's (AUDIT-CREW priority 6) */
  lightDelay: "real" | "tenth" | "off" = c.s.netLightDelay,
): InstrumentSpace {
  const id = fleet.active as VesselId;
  const V = VESSELS[id];
  const out: InstrumentSpace = {
    craft: {
      id,
      kind: id === "f35" ? "jet" : "spacecraft",
      name: V.name,
      lands: V.lands,
      ring: !!V.ring,
      // (landed, in orbit, a Kerr orbit…, and where: the console's « posé », its Gargantua side)
      ...(status ? { status: status.status, where: status.soi } : {}),
    },
  };
  const tm = t / M_SECONDS;
  const body = status?.soi ?? i.ref ?? "";
  const B = solarBody(body);
  if (B && i.X && i.V && i.region !== "hole") {
    const b = bodyAt(body, tm);
    out.state = {
      body,
      r: [r1((i.X[0] - b.pos[0]) * KM), r1((i.X[1] - b.pos[1]) * KM), r1((i.X[2] - b.pos[2]) * KM)],
      v: [r3((i.V[0] - b.vel[0]) * KMS), r3((i.V[1] - b.vel[1]) * KMS), r3((i.V[2] - b.vel[2]) * KMS)],
      mu: Math.round(B.mass * M_METRES * C_MPS * C_MPS * 1e-9),
      radius: Math.round(B.radius * KM * 10) / 10,
      soi: Math.round((status?.soiKm ?? Number.POSITIVE_INFINITY) as number),
    };
  }
  if (heavy && i.region !== "hole") {
    out.traj = {
      free: trajSegments(i.ourFree, t, 96),
      plan: trajSegments(i.ourPlan, t, 72),
      fate: i.ourFree?.fate ?? "",
      hit: i.ourFree?.hit ?? "",
    };
    if (body) out.bodies = bodiesNear(body, tm);
    // (the room's other spacecraft about the same body, within its sphere — N6)
    if (out.state) {
      const b = bodyAt(body, tm);
      const lim = Number.isFinite(out.state.soi) ? out.state.soi : 2e6;
      out.others = roomCraft
        .list()
        .map((o) => ({
          name: o.name,
          colour: o.colour,
          vessel: o.vessel,
          r: [r1((o.X[0] - b.pos[0]) * KM), r1((o.X[1] - b.pos[1]) * KM), r1((o.X[2] - b.pos[2]) * KM)] as V3,
        }))
        .filter((o) => Math.hypot(...o.r) < lim)
        .slice(0, SPACE_BOUNDS.others);
    }
  }
  const nodes = i.plan?.nodes ?? [];
  out.nodes = nodes.slice(0, SPACE_BOUNDS.nodes).map((n) => ({
    in: Math.round(n.t * M_SECONDS - t),
    dv: [r1(n.dv[0] * C_MPS), r1(n.dv[1] * C_MPS), r1(n.dv[2] * C_MPS)],
    role: n.role ?? "",
  }));
  out.burn = i.plan?.burning && nodes[0] ? { left: r1(Math.hypot(...nodes[0].dv) * C_MPS) } : null;
  {
    const dv = id === "f35" ? Number.NaN : c.fcBudget().dv;
    const prop = id === "f35" ? null : (c.propellantOf(id)?.share ?? null);
    out.budget = { dv: Number.isFinite(dv) ? Math.round(dv) : null, prop: prop === null ? null : r3(prop) };
  }
  const tg = status?.target;
  // (a station's, a craft's place for the map — a body's is in its bodies)
  const tp = tg && !solarBody(tg.id) && out.state && i.targetPos ? i.targetPos : null;
  const tb = tp ? bodyAt(out.state!.body, tm).pos : null;
  out.target = tg
    ? {
        ...(tp && tb ? { r: [r1((tp[0] - tb[0]) * KM), r1((tp[1] - tb[1]) * KM), r1((tp[2] - tb[2]) * KM)] as V3 } : {}),
        id: tg.id,
        name: tg.name,
        dist: Math.round(tg.distKm * 1000),
        rate: r1(tg.rate),
        ca: Math.round(tg.caKm * 1000),
        caIn: Math.round(tg.caIn),
      }
    : null;
  const S = i.systems;
  out.sysx = S
    ? {
        battery: r3(S.battery / Math.max(S.batteryKWh, 1e-9)),
        kwh: S.batteryKWh,
        balance: r1(S.balanceKW),
        o2h: r1(S.o2Hours),
        scrub: r1(S.scrubDays),
        crew: S.crew,
        failures: S.failures.map((f) => ({ kind: f.kind, fixing: f.fixing, ticks: [...(c.sysTicks.get(`f:${f.kind}`) ?? [])].sort() })),
      }
    : null;
  if (!Number.isFinite(c.metT0)) c.metT0 = t;
  // (the two clocks since the flight began: the proper time starts again at each flight — controller/rotation.ts —, the
  // room's does not; their start taken together, again when the proper time goes back)
  const tau = c.properTime * M_SECONDS;
  c.crewClock0 = clocksStep(c.crewClock0, t, tau, i.dtau);
  const since = t - c.crewClock0.t;
  out.time = {
    warp: warpFactor(c.s),
    room: Math.round(t),
    dtau: r3(i.dtau),
    tau: Math.round(tau),
    met: Math.max(0, Math.round(t - c.metT0)),
    since: Math.round(since),
    lag: r1(since - (tau - c.crewClock0.tau)),
  };
  // the attitude: the flown craft's nose and up (its pose's axes, home frame — the HUD's S is the camera's)
  const pose = i.region !== "hole" ? c.activePoseNow() : null;
  out.att = pose
    ? {
        nose: [r3(pose.ax[2][0]), r3(pose.ax[2][1]), r3(pose.ax[2][2])],
        up: [r3(pose.ax[1][0]), r3(pose.ax[1][1]), r3(pose.ax[1][2])],
      }
    : null;
  // the docking's geometry within 5 km of a port (the COAS's axes: across along the craft's right and up)
  const D = i.region !== "hole" ? c.dockGeometry() : null;
  if (D && D.range < 5000) {
    const d = [D.ring[0] - D.c[0], D.ring[1] - D.c[1], D.ring[2] - D.c[2]].map((x) => x * M_METRES) as V3;
    const al = d[0] * D.a[0] + d[1] * D.a[1] + d[2] * D.a[2];
    const lat: V3 = [d[0] - al * D.a[0], d[1] - al * D.a[1], d[2] - al * D.a[2]];
    // (the craft's right: its nose × its up — the navball's)
    const up = D.sh[1],
      nz = D.sh[2];
    const right: V3 = [nz[1] * up[2] - nz[2] * up[1], nz[2] * up[0] - nz[0] * up[2], nz[0] * up[1] - nz[1] * up[0]];
    out.dock = {
      target: D.title,
      port: D.name,
      range: r1(D.range),
      along: r1(D.along),
      latX: r1(lat[0] * right[0] + lat[1] * right[1] + lat[2] * right[2]),
      latY: r1(lat[0] * up[0] + lat[1] * up[1] + lat[2] * up[2]),
      closing: r3(D.closing),
      latRate: r3(D.lateralRate),
      angle: r1(D.angle),
      spin: r1(D.spin),
      docked: D.docked,
      phase: c.dockAuto?.phase ?? "",
    };
  } else if (i.region === "hole" && fleet.links.some((l) => l.a === id || l.b === id)) {
    // (Gargantua's side: no geometry in its frame — but docked it is, and to whom)
    const l = fleet.links.find((q) => q.a === id || q.b === id)!;
    const other = l.a === id ? l.b : l.a;
    const name = other === "iss" ? "ISS" : (VESSELS[other as VesselId]?.name ?? String(other));
    out.dock = {
      target: name,
      port: "",
      range: 0,
      along: 0,
      latX: 0,
      latY: 0,
      closing: 0,
      latRate: 0,
      angle: 0,
      spin: 0,
      docked: true,
      phase: "",
    };
  } else out.dock = null;
  // the powered descent: a craft that lands, near a solid ground (landed, in its air, suborbital, or under 60 km)
  const st = status?.status ?? "";
  if (V.lands && status && i.surface && (st === "landed" || st === "flight" || st === "suborbital" || status.altKm < 60)) {
    const agl = Number.isFinite(i.surface.alt) ? i.surface.alt : null;
    const vz = Number.isFinite(status.vVert) ? status.vVert : 0;
    const vh = Math.sqrt(Math.max(0, status.speed * status.speed - vz * vz));
    const lp = i.lpd;
    out.desc = {
      agl: agl === null ? null : r1(agl),
      vz: r1(vz),
      vh: r1(vh),
      hover: c.pilot.auto === "hover",
      auto: c.pilot.auto,
      ttg: agl !== null && vz < -0.3 && st !== "landed" ? Math.round(agl / -vz) : null,
      lpd: lp ? { dist: Math.round(lp.dist), reach: Math.round(Math.max(LPD.minReach, agl ?? 0)) } : null,
    };
  } else out.desc = null;
  // the landing point: the site flown to, or the point designated (the LPD)
  const L = c.landRun;
  const LB = L ? solarBody(L.body) : null;
  if (L?.site) out.land = { body: L.body, name: L.site.name, lat: L.site.lat, lon: L.site.lon, moved: false };
  else if (L?.q && LB) {
    const g = cartToGeodetic(LB.radius, flatteningOf(L.body), L.q);
    out.land = { body: L.body, name: "", lat: r3((g.lat * 180) / Math.PI), lon: r3((g.lon * 180) / Math.PI), moved: !!i.lpd?.moved };
  } else out.land = null;
  // (the light's time to the Earth: our side only — behind the wormhole, no live link)
  const earth = bodyAt("earth", tm).pos;
  out.link =
    i.region === "hole"
      ? { light: 0, cut: true }
      : i.X
        ? (() => {
            const light = (Math.hypot(i.X[0] - earth[0], i.X[1] - earth[1], i.X[2] - earth[2]) * M_METRES) / C_MPS;
            const k = lightDelay === "off" ? 0 : lightDelay === "tenth" ? 0.1 : 1;
            return { light: r1(light), delay: Math.round(light * k * 100) / 100, cut: false };
          })()
        : null;
  if (V.ring) {
    const R = c.ringInfo();
    out.ring = R ? { rpm: r1(R.rpm), g: r3(R.g) } : null;
    out.ports = V.ports.map((p, k) => {
      const l = fleet.links.find((q) => (q.a === id && q.pa === k) || (q.b === id && q.pb === k));
      const other = l ? (l.a === id ? l.b : l.a) : null;
      return { name: p.name, docked: other ? (other === "iss" ? "ISS" : VESSELS[other as VesselId].name) : "" };
    });
  }
  out.kerr = status?.kerr ? { r: r3(status.kerr.r), E: r3(status.kerr.E), L: r3(status.kerr.L) } : null;
  // Gargantua's side: the hole, its worlds, the craft and its path on the flat map [M] (the K3 map's)
  if (heavy && i.region === "hole") {
    const sys = GARGANTUA_SYSTEM;
    const q = (v: readonly number[]): V3 => [r3(v[0]!), r3(v[1]!), r3(v[2]!)];
    const pts = c.path?.pts ?? [];
    const step = Math.max(1, Math.ceil(pts.length / SPACE_BOUNDS.pts));
    out.hole = {
      spin: sys.spin,
      bodies: sys.bodies
        .filter((b) => b.universe === "gargantua")
        .map((b) => ({
          id: b.id,
          r: q(bodyState(sys, b.id, tm).pos),
          radius: b.radius,
          orbit: b.orbit.type === "kerr" ? b.orbit.r : b.orbit.type === "kepler" ? b.orbit.a : 0,
        })),
      craft: i.X ? q(i.X) : null,
      path: pts.filter((_, k) => k % step === 0).map(q),
      fate: c.path?.fate ?? "",
    };
  }
  return out;
}
