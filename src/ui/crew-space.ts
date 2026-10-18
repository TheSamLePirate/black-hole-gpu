// The space blocks of the crew's snapshot (PLAN-VAISSEAUX K1 — net/instruments-space.ts): built in the simulator from
// what the flight already knows (its status, its paths, its plan, its systems), the heavy ones (the paths, the bodies)
// only on the snapshot's once-a-second tick. Lengths in km about each body on the home frame's axes.

import { warpFactor } from "../clock";
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import type { RangerStatus } from "../game/status";
import type { InstrumentBody, InstrumentSpace, InstrumentTrajSeg, V3 } from "../net/instruments-space";
import { SPACE_BOUNDS } from "../net/instruments-space";
import type { OurPath } from "../system/our-predict";
import { SOLAR_BODIES, solarBody, solarState } from "../system/solar";
import { C_MPS, M_METRES, M_SECONDS } from "../units";
import { VESSELS, type VesselId } from "../vessels";
import type { Info } from "./flighthud";

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
      const p = bodyAt(b.id, tm).pos;
      return {
        id: b.id,
        r: [Math.round(p[0] * KM), Math.round(p[1] * KM), Math.round(p[2] * KM)] as V3,
        radius: Math.round(b.radius * KM),
        parent: b.parent ?? "",
      };
    });
}

/** The space blocks now; `heavy` the once-a-second tick (the paths, the bodies). */
export function crewSpace(c: CameraController, i: Info, status: RangerStatus | null, t: number, heavy: boolean): InstrumentSpace {
  const id = fleet.active as VesselId;
  const V = VESSELS[id];
  const out: InstrumentSpace = {
    craft: { id, kind: id === "f35" ? "jet" : "spacecraft", name: V.name, lands: V.lands, ring: !!V.ring },
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
  }
  const nodes = i.plan?.nodes ?? [];
  out.nodes = nodes.slice(0, SPACE_BOUNDS.nodes).map((n) => ({
    in: Math.round(n.t * M_SECONDS - t),
    dv: [r1(n.dv[0] * C_MPS), r1(n.dv[1] * C_MPS), r1(n.dv[2] * C_MPS)],
    role: n.role ?? "",
  }));
  out.burn = i.plan?.burning && nodes[0] ? { left: r1(Math.hypot(...nodes[0].dv) * C_MPS) } : null;
  const tg = status?.target;
  out.target = tg
    ? {
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
        failures: S.failures.map((f) => ({ kind: f.kind, fixing: f.fixing })),
      }
    : null;
  out.time = { warp: warpFactor(c.s), room: Math.round(t), dtau: r3(i.dtau), tau: Math.round(c.properTime * M_SECONDS) };
  // (the light's time to the Earth: our side only — behind the wormhole, no live link)
  const earth = bodyAt("earth", tm).pos;
  out.link =
    i.region === "hole"
      ? { light: 0, cut: true }
      : i.X
        ? { light: r1((Math.hypot(i.X[0] - earth[0], i.X[1] - earth[1], i.X[2] - earth[2]) * M_METRES) / C_MPS), cut: false }
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
  return out;
}
