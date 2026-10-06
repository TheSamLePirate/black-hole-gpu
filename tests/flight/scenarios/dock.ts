// The docking autopilot, flown and graded (docs/FLIGHTLAB.md): to the space station from 3 km, off its axis
// and turned away; to the Endurance's two hub ports (the aft one from behind, the Ranger facing away); to the
// Lander's dorsal hatch; undocked and docked again. Judged at the capture (docking.ts dockCheck's geometry):
// the closing speed (≤ 0.2 m/s), the ring off the axis (≤ 0.1 m), the ports' axes (≤ 2°), no bounce, the
// time it took and the thrusters' Δv.
import type { Lab } from "../lib/lab";
import { engage, said, scene, type Scenario, type Verdict } from "./helpers";
import { orbInstall, round, spent } from "./orbit";

/** The Ranger off the station's IDA-2: `distM` out on its axis, `offset` [m] in the station's axes, turned `yawDeg` about its top. */
async function nearStation(lab: Lab, distM: number, offset: [number, number, number] = [0, 0, 0], yawDeg = 0) {
  await scene(lab, "Earth: docking to the ISS");
  await lab.js(`(() => {
    const p = __bh.iss.start(__bh.game.now(), ${distM}, ${JSON.stringify(offset)});
    const a = (${yawDeg} * Math.PI) / 180, u = p.up, f = p.fwd;
    const x = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]];
    const fwd = f.map((q, i) => q * Math.cos(a) + x[i] * Math.sin(a));
    return __bh.game.placeAt({ frame: "ours", X: p.X, vel: p.vel, fwd, up: u, note: "off the station" });
  })()`);
  await lab.js(`(__bh.game.target("iss"), true)`);
}

/** The Ranger flown from the Endurance's fore port, let go, then `distM` out on a craft's port (offset: its axes). */
async function rangerNear(lab: Lab, sceneName: string, target: string, distM: number, offset: [number, number, number] = [0, 0, 0]) {
  await scene(lab, sceneName);
  await lab.js(`(__bh.settings.vessel = "ranger", true)`);
  await lab.fixed({ until: `T.vessel === "ranger"`, maxSim: 10, maxWall: 30 });
  await lab.js(`(__bh.camera.undock(), true)`);
  await lab.fixed({ until: "false", maxSim: 2, maxWall: 10 });
  const why = await lab.js<string | null>(`__bh.camera.placeNearPort(${JSON.stringify(target)}, ${distM}, ${JSON.stringify(offset)})`);
  if (why) throw new Error(why);
  await lab.js(`(__bh.game.target(${JSON.stringify(target)}), true)`);
}

/** The docking autopilot engaged, flown to the capture; the contact measured. */
async function dockRun(lab: Lab, o: { maxSim?: number; port?: number } = {}): Promise<Verdict> {
  await orbInstall(lab);
  const sp0 = await spent(lab);
  const t0 = lab.T.t ?? 0;
  await engage(lab, "dock");
  const start = said(lab, /^Docking autopilot/);
  const e = await lab.fixed({
    until: "T.docked || T.links > 0",
    maxSim: o.maxSim ?? 3600,
    maxWall: 400,
    fail: `T.auto !== "dock" && !T.docked && !(T.links > 0)`,
  });
  const msg = said(lab, /^Docked to/);
  const d = await lab.js<{ lateral: number; angle: number; speed: number; port: number } | null>("__orb.dock()");
  const dv = (await spent(lab)) - sp0;
  const holds = lab.events.filter((x) => x.kind === "phase" && /dock: .* → HOLD/.test(x.text)).length;
  const metrics = {
    contactMps: d ? round(d.speed, 1000) : null,
    contactLateralM: d ? round(d.lateral, 1000) : null,
    contactAngleDeg: d ? round(d.angle, 100) : null,
    port: d?.port ?? null,
    dockS: round((e.T.t ?? 0) - t0, 1),
    dvRcs: round(dv, 100),
    holds,
  };
  const portOk = o.port === undefined || d?.port === o.port;
  const ok = !!msg && !!d && d.speed <= 0.2 && d.lateral <= 0.1 && d.angle <= 2 && portOk;
  return { ok, why: `${start ?? ""} → ${msg ?? e.why}${portOk ? "" : ` · port ${d?.port}, not ${o.port}`}`, metrics };
}

export const DOCK: Scenario[] = [
  {
    id: "dock-iss-3km",
    title: "Dock — the ISS from 2.9 km on the axis",
    tags: ["dock", "ranger", "iss"],
    minutes: 4,
    async run(lab) {
      await nearStation(lab, 2900);
      return dockRun(lab);
    },
  },
  {
    id: "dock-iss-offset-120m",
    title: "Dock — the ISS from 300 m, 120 m off its axis",
    tags: ["dock", "ranger", "iss"],
    minutes: 4,
    async run(lab) {
      await nearStation(lab, 300, [100, 60, 0]);
      return dockRun(lab);
    },
  },
  {
    id: "dock-iss-yawed-60m",
    title: "Dock — the ISS from 60 m, the Ranger turned 70° away",
    tags: ["dock", "ranger", "iss"],
    minutes: 3,
    async run(lab) {
      await nearStation(lab, 60, [3, -2, 0], 70);
      return dockRun(lab);
    },
  },
  {
    id: "dock-endurance-fore",
    title: "Dock — the Endurance's fore hub port from 150 m",
    tags: ["dock", "ranger", "endurance"],
    minutes: 4,
    async run(lab) {
      await rangerNear(lab, "Earth: the Endurance, 800 km up", "endurance", 150);
      return dockRun(lab, { port: 0 });
    },
  },
  {
    id: "dock-endurance-aft",
    title: "Dock — the Endurance's aft hub port from behind, the Ranger facing away",
    tags: ["dock", "ranger", "endurance"],
    minutes: 4,
    async run(lab) {
      // (the fore port's place, 150 m out, moved past the hull to 150 m beyond the aft port)
      await rangerNear(lab, "Earth: the Endurance, 800 km up", "endurance", 150, [8, 0, -335]);
      return dockRun(lab, { port: 1 });
    },
  },
  {
    id: "dock-lander-dorsal",
    title: "Dock — the Lander's dorsal hatch from 120 m",
    tags: ["dock", "ranger", "lander"],
    minutes: 4,
    async run(lab) {
      await rangerNear(lab, "Earth: the Lander, 500 km up", "lander", 120, [10, 0, 5]);
      return dockRun(lab);
    },
  },
  {
    id: "dock-iss-undock-redock",
    title: "Dock — the ISS: docked, undocked, a minute's drift, docked again",
    tags: ["dock", "ranger", "iss", "undock"],
    minutes: 4,
    async run(lab) {
      await nearStation(lab, 60);
      const first = await dockRun(lab);
      if (!first.ok) return { ...first, why: `first docking: ${first.why}` };
      await lab.js(`(__bh.camera.undock(), true)`);
      await lab.fixed({ until: "false", maxSim: 60, maxWall: 30 });
      const away = await lab.js<number | null>("__bh.camera.dockInfo?.range ?? null");
      lab.events.splice(0, lab.events.length, ...lab.events.filter((x) => !/^Docked to/.test(x.text)));
      const second = await dockRun(lab);
      return {
        ...second,
        why: `undocked ${round(away ?? Number.NaN, 10)} m away · ${second.why}`,
        metrics: { ...second.metrics, firstContactMps: first.metrics?.contactMps },
      };
    },
  },
];
