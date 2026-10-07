// The flight computer's missions in our solar system (the MISSION tab: plan.ts missionPlan → missionCommit →
// fcExecute), flown from a parking orbit to their end: the Moon (in orbit, a free return home), Mars and
// Jupiter in orbit (months to years: the warp the node autopilot asks, auto warp on), a rendezvous with the
// space station and with the fleet's craft ending docked. Judged: arrived (the sphere, the orbit captured,
// its height against the one asked), the Δv against the plan's, the corrections it took, the time.
import type { Lab } from "../lib/lab";
import { said, scene, type Scenario, type Verdict } from "./helpers";
import { elements, flownSpread, orbInstall, round, spent } from "./orbit";

interface Plan {
  ok: boolean;
  note: string;
  dvTotal?: number;
  burns?: { t: number; dv: number[]; label: string }[];
  arrive?: { body: string; t: number } | null;
  afterText?: string;
}

/** A mission planned (the planner's worker awaited), adopted and executed. */
export async function fly(lab: Lab, spec: Record<string, unknown>): Promise<Plan> {
  await lab.app.waitFor("!__bh.camera.planBusy", 60_000);
  const p = await lab.js<Plan>(`__bh.camera.missionPlan(${JSON.stringify(spec)}).then((r) => JSON.parse(JSON.stringify(r)))`);
  lab.note("plan", `${p.ok ? "" : "FAILED "}${p.note} · ${p.afterText ?? ""} · Δv ${round(p.dvTotal ?? Number.NaN, 10)} m/s`);
  if (!p.ok) return p;
  await lab.js(`(__bh.camera.missionCommit(), __bh.camera.fcExecute(), true)`);
  return p;
}

/** The Ranger in the station's plane at `altKm` (circular), `leadDeg` ahead of the station (behind: < 0). */
export async function besideStation(lab: Lab, altKm: number, leadDeg: number) {
  await lab.js(`(() => {
    const t = __bh.game.now(), iss = __bh.iss.orbit(t), E = __bh.ourState("earth", t);
    const sub = (a, b) => a.map((x, i) => x - b[i]);
    const r = sub(iss.X, E.pos), v = sub(iss.V, E.vel);
    const rl = Math.hypot(...r);
    const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]], hl = Math.hypot(...h);
    const n = h.map((x) => x / hl), rh = r.map((x) => x / rl);
    const th = [n[1] * rh[2] - n[2] * rh[1], n[2] * rh[0] - n[0] * rh[2], n[0] * rh[1] - n[1] * rh[0]];
    const u = (${leadDeg} * Math.PI) / 180;
    const d = rh.map((x, i) => x * Math.cos(u) + th[i] * Math.sin(u)), w = rh.map((x, i) => -x * Math.sin(u) + th[i] * Math.cos(u));
    const Mm = 1476.625 * __bh.settings.massSolar, mu = 3.986004418e14 / 299792458 ** 2 / Mm;
    const R = (6371e3 + ${altKm} * 1e3) / Mm, vc = Math.sqrt(mu / R);
    const X = E.pos.map((x, i) => x + d[i] * R), V = E.vel.map((x, i) => x + w[i] * vc);
    return __bh.game.placeAt({ frame: "ours", X, vel: V, fwd: w, up: d, note: "beside the station's plane" });
  })()`);
  await Bun.sleep(300);
}

/** A planet's or a moon's mission into orbit: arrived, captured, its circle's height against the one asked. */
function toOrbit(
  id: string,
  title: string,
  target: string,
  altKm: number,
  o: { minutes: number; maxSim: number; maxWall: number; tags?: string[]; delayS?: number; date?: number },
): Scenario {
  return {
    id,
    title,
    tags: ["mission", "fc", "ranger", target, ...(o.tags ?? [])],
    minutes: o.minutes,
    async run(lab): Promise<Verdict> {
      // (a date of its own: the same mission every run — at the page's own time, each run flew another)
      if (o.date) await scene(lab, "game:artemis", o.date);
      await orbInstall(lab);
      // (the plan from later on the orbit: another family of paths — the page loaded later on the mini, its
      // plan arrived 4.3 days on, not 3.3, and its correction aimed into the Moon)
      if (o.delayS)
        await lab.js(
          `(() => { __bh.freeze(true); __bh.game.warp(100); for (let i = 0; i < ${Math.round(o.delayS / (100 / 30))}; i++) __bh.step(1 / 30); __bh.game.warp(1); __bh.freeze(false); return true; })()`,
        );
      await lab.js(`(__bh.settings.autoWarp = true, true)`);
      const sp0 = await spent(lab);
      const p = await fly(lab, { target, arrival: "orbit", altKm });
      if (!p.ok) return { ok: false, why: `no plan: ${p.note}` };
      const t0 = lab.T.t ?? 0;
      const e = await lab.fixed({
        until: `T.soi === ${JSON.stringify(target)} && T.nodes === 0 && T.auto === "none"`,
        maxSim: o.maxSim,
        maxWall: o.maxWall,
        fail: `T.soi !== ${JSON.stringify(target)} && T.nodes === 0 && T.auto === "none"`,
      });
      const dv = (await spent(lab)) - sp0;
      const e1 = await elements(lab);
      const fl = e.end === "until" ? await flownSpread(lab, 1, 20) : null;
      const mid = fl ? (fl.lo + fl.hi) / 2 : Number.NaN;
      const fixes = lab.events.filter((x) => x.kind === "pilot" && /correction|re-aim|Re-aimed/i.test(x.text)).length;
      const metrics = {
        planDv: round(p.dvTotal ?? Number.NaN, 10),
        dvSpent: round(dv, 10),
        dvOverPct: round((100 * (dv - (p.dvTotal ?? Number.NaN))) / (p.dvTotal ?? Number.NaN), 10),
        flightDays: round(((e.T.t ?? 0) - t0) / 86400, 100),
        planDays: p.arrive ? round((p.arrive.t * (lab.T.t / lab.T.tM) - t0) / 86400, 100) : null,
        endRp: e1?.rp,
        endRa: e1?.ra,
        flownLo: fl?.lo,
        flownHi: fl?.hi,
        spreadKm: fl?.spread,
        heightErrKm: round(mid - altKm, 10),
        corrections: fixes,
      };
      const ok =
        e.end === "until" &&
        e1?.body === target &&
        !!fl &&
        Math.abs(mid - altKm) <= Math.max(5, 0.02 * altKm) &&
        fl.spread <= Math.max(5, 0.03 * altKm);
      return {
        ok,
        why: `${e.why} · ${target} ${fl?.lo}–${fl?.hi} km (asked ${altKm}) · Δv ${round(dv, 1)} / plan ${round(p.dvTotal ?? 0, 1)} m/s`,
        metrics,
      };
    },
  };
}

/** A rendezvous planned with the station or a craft, flown to 200 m, then the docking autopilot to the capture. */
async function rendezvousDock(lab: Lab, target: string, maxWall = 500): Promise<Verdict> {
  await orbInstall(lab);
  const sp0 = await spent(lab);
  const p = await fly(lab, { target });
  if (!p.ok) return { ok: false, why: `no plan: ${p.note}` };
  const e = await lab.fixed({ until: `T.docked || T.links > 0 || (T.auto === "none" && T.nodes === 0)`, maxSim: 2 * 86400, maxWall });
  const dv = (await spent(lab)) - sp0;
  const msg = said(lab, /^Docked to/);
  const d = await lab.js<{ lateral: number; angle: number; speed: number } | null>("__orb.dock()");
  const arrived = lab.events.find((x) => x.kind === "pilot" && /docking autopilot takes over/i.test(x.text));
  const metrics = {
    planDv: round(p.dvTotal ?? Number.NaN, 10),
    dvSpent: round(dv, 10),
    contactMps: d ? round(d.speed, 1000) : null,
    contactLateralM: d ? round(d.lateral, 1000) : null,
    contactAngleDeg: d ? round(d.angle, 100) : null,
    arriveS: arrived ? round(arrived.t - (lab.events[0]?.t ?? 0), 1) : null,
    totalS: round((e.T.t ?? 0) - (lab.events[0]?.t ?? 0), 1),
  };
  const ok = !!msg && !!d && d.speed <= 0.2 && d.lateral <= 0.1 && d.angle <= 2;
  return { ok, why: `${msg ?? e.why} · Δv ${round(dv, 1)} / plan ${round(p.dvTotal ?? 0, 1)} m/s`, metrics };
}

export const MISSIONS_FC: Scenario[] = [
  toOrbit("mission-moon-orbit", "Mission — Earth orbit to a 100 km orbit about the Moon", "moon", 100, {
    minutes: 8,
    maxSim: 8 * 86400,
    maxWall: 600,
    // (its correction 43 m/s: flown 0.9° off once — the planner's finite burn not the flight's —, the pass 16 km)
    date: Date.UTC(2026, 9, 6, 6),
  }),
  toOrbit("mission-moon-orbit-late", "Mission — Earth orbit to a 100 km orbit about the Moon, planned 273 s later", "moon", 100, {
    minutes: 8,
    maxSim: 8 * 86400,
    maxWall: 600,
    delayS: 273,
    date: Date.UTC(2026, 9, 7, 12),
  }),
  {
    id: "mission-moon-free-return",
    title: "Mission — round the Moon on a free return (Artemis II: the pass at 7 000 km), home to a 200 km orbit",
    tags: ["mission", "fc", "ranger", "moon", "earth"],
    minutes: 10,
    async run(lab): Promise<Verdict> {
      await orbInstall(lab);
      const sp0 = await spent(lab);
      const p = await fly(lab, { target: "moon", arrival: "freeReturn", altKm: 7000, retKm: 200 });
      if (!p.ok) return { ok: false, why: `no plan: ${p.note}` };
      // (the lowest pass at the Moon, then the perigee home before the capture)
      await lab.js(`(__orb.track.on = true, __orb.track.lo = Infinity, __orb.track.hi = -Infinity, __orb.track.body = "moon", true)`);
      const e1 = await lab.fixed({ until: `T.soi === "earth" && window.__orb.track.lo < 1e8`, maxSim: 10 * 86400, maxWall: 500 });
      const moon = await lab.js<{ lo: number }>("({ lo: __orb.track.lo })");
      await lab.js(`(__orb.track.lo = Infinity, __orb.track.hi = -Infinity, __orb.track.body = "earth", true)`);
      const e = await lab.fixed({ until: `T.soi === "earth" && T.nodes === 0 && T.auto === "none"`, maxSim: 10 * 86400, maxWall: 500 });
      const home = await lab.js<{ lo: number }>("(__orb.track.on = false, { lo: __orb.track.lo })");
      const dv = (await spent(lab)) - sp0;
      const fl = e.end === "until" ? await flownSpread(lab, 1, 20) : null;
      const mid = fl ? (fl.lo + fl.hi) / 2 : Number.NaN;
      const metrics = {
        planDv: round(p.dvTotal ?? Number.NaN, 10),
        dvSpent: round(dv, 10),
        moonPassKm: round(moon.lo, 10),
        perigeeKm: round(home.lo, 10),
        circleLo: fl?.lo,
        circleHi: fl?.hi,
        spreadKm: fl?.spread,
        flightDays: round(((e.T.t ?? 0) - (lab.events[0]?.t ?? 0)) / 86400, 100),
      };
      const ok =
        e1.end === "until" &&
        e.end === "until" &&
        Math.abs(home.lo - 200) <= 20 &&
        Math.abs(moon.lo - 7000) <= 100 &&
        !!fl &&
        Math.abs(mid - 200) <= 20;
      return {
        ok,
        why: `Moon pass ${metrics.moonPassKm} km · perigee ${metrics.perigeeKm} km · home ${fl?.lo}–${fl?.hi} km · Δv ${round(dv, 1)} / ${round(p.dvTotal ?? 0, 1)}`,
        metrics,
      };
    },
  },
  toOrbit("mission-mars-orbit", "Mission — Earth orbit to a 300 km orbit about Mars", "mars", 300, {
    minutes: 15,
    maxSim: 3 * 365 * 86400,
    maxWall: 900,
    tags: ["long"],
  }),
  toOrbit("mission-jupiter-orbit", "Mission — Earth orbit to an orbit about Jupiter", "jupiter", 100000, {
    minutes: 20,
    maxSim: 6 * 365 * 86400,
    maxWall: 1200,
    tags: ["long"],
  }),
  {
    id: "mission-iss-rendezvous-dock",
    title: "Mission — the ISS from 400 km, 60° behind it: rendezvous, then docked",
    tags: ["mission", "fc", "ranger", "iss", "dock"],
    minutes: 6,
    async run(lab) {
      await besideStation(lab, 400, -60);
      await lab.js(`(__bh.game.target("iss"), true)`);
      return rendezvousDock(lab, "iss");
    },
  },
  {
    id: "mission-endurance-rendezvous-dock",
    title: "Mission — the Endurance (800 km) from 400 km: rendezvous, then docked",
    tags: ["mission", "fc", "ranger", "endurance", "dock"],
    minutes: 8,
    async run(lab) {
      await scene(lab, "Earth: the Endurance, 800 km up");
      await lab.js(`(__bh.settings.vessel = "ranger", true)`);
      await lab.fixed({ until: `T.vessel === "ranger"`, maxSim: 10, maxWall: 30 });
      await lab.js(`(__bh.camera.undock(), true)`);
      await besideStation(lab, 400, 30);
      await lab.js(`(__bh.game.target("endurance"), true)`);
      return rendezvousDock(lab, "endurance", 700);
    },
  },
  {
    id: "mission-lander-rendezvous-dock",
    title: "Mission — the Lander (500 km) from 400 km: rendezvous, then docked to its dorsal hatch",
    tags: ["mission", "fc", "ranger", "lander", "dock"],
    minutes: 8,
    async run(lab) {
      await scene(lab, "Earth: the Lander, 500 km up");
      await lab.js(`(__bh.settings.vessel = "ranger", true)`);
      await lab.fixed({ until: `T.vessel === "ranger"`, maxSim: 10, maxWall: 30 });
      await lab.js(`(__bh.camera.undock(), true)`);
      await besideStation(lab, 400, -20);
      await lab.js(`(__bh.game.target("lander"), true)`);
      return rendezvousDock(lab, "lander", 700);
    },
  },
];
