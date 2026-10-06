// The harness's own check: three short flights, one per kind (a docking, a landing, an orbit) — run first on
// a machine new to the lab (bun scripts/flightlab.ts run --tags smoke).
import { earthRelief, engage, onRunway, said, scene, type Scenario } from "./helpers";

export const SMOKE: Scenario[] = [
  {
    id: "dock-iss-60m",
    title: "ISS — docking autopilot from 60 m (the scene)",
    tags: ["dock", "ranger", "iss", "smoke"],
    minutes: 3,
    async run(lab) {
      await scene(lab, "Earth: docking to the ISS");
      await engage(lab, "dock");
      const e = await lab.fixed({ until: "T.docked || T.links > 0", maxSim: 1800, maxWall: 300 });
      const msg = said(lab, /Docked to/);
      const v = Number(/· ([\d.]+) m\/s/.exec(msg ?? "")?.[1] ?? Number.NaN);
      return { ok: e.end === "until" && !!msg && v < 0.5, why: msg ?? e.why, metrics: { contactMps: v, simS: lab.T.t } };
    },
  },
  {
    id: "glide-edwards",
    title: "Ranger — glide 80 km out to Edwards, the entry autopilot to a stop",
    tags: ["landing", "ranger", "plane", "runway", "smoke"],
    minutes: 4,
    async run(lab) {
      await earthRelief(lab);
      await lab.js(`(__bh.game.glideTo("Edwards"), true)`);
      const e = await lab.fixed({ until: "T.landed && !T.rolling", maxSim: 900, maxWall: 400 });
      const td = said(lab, /Touchdown/);
      const sink = Number(/([\d.]+) m\/s down/.exec(td ?? "")?.[1] ?? Number.NaN);
      return {
        ok: e.end === "until" && onRunway(lab) && sink < 2.5,
        why: `${e.why} · ${td ?? "no touchdown"} · runway ${JSON.stringify(lab.T.runway)}`,
        metrics: { sinkMps: sink, along: lab.T.runway?.along, across: lab.T.runway?.across },
      };
    },
  },
  {
    id: "circ-auto-ellipse",
    title: "Earth orbit 200 × 600 km — CIRC autopilot",
    tags: ["orbit", "circularize", "ranger", "smoke"],
    minutes: 3,
    async run(lab) {
      await lab.js(`(__bh.game.orbit("earth", { peKm: 200, apKm: 600, inc: 51.6 }), true)`);
      await Bun.sleep(500);
      await engage(lab, "circularize");
      const e = await lab.fixed({ until: `T.auto === "none"`, maxSim: 4 * 3600, maxWall: 300 });
      // (the circle as the autopilot leaves it — the mean one, its J2 swing: the osculating apsides of a
      // circle in a low orbit stand up to ~20 km apart, the oblateness's, not the autopilot's; the
      // orbit family measures the radius flown over a revolution)
      const msg = said(lab, /^Circular:/);
      const [lo, hi] = /([\d.]+) × ([\d.]+) km/
        .exec(msg ?? "")
        ?.slice(1)
        .map(Number) ?? [Number.NaN, Number.NaN];
      return {
        ok: e.end === "until" && !!msg && hi! - lo! < 5,
        why: msg ?? e.why,
        metrics: { lo, hi, pe: lab.T.orbit?.pe, ap: lab.T.orbit?.ap },
      };
    },
  },
];
