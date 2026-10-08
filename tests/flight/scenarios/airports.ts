// The airports (PLAN-AEROPORTS A6): the entry autopilot's approaches as the procedures fly them — at night
// (the runway's ICAO lights, A1), going around (A5: by itself at the minima, unstabilised; by the pilot's
// TOGA), and at night in a CAT III fog (150 m: the lights up, the autoland's own minima). Judged as every
// landing (landing.ts), and on the procedure: how many go-arounds, the decision at each minima (the lab's
// telemetry: entry.ga, entry.dh), the last one stabilised.
import { readFileSync } from "node:fs";
import type { WeatherState } from "../../../src/weather";
import type { Lab } from "../lib/lab";
import { oscillations } from "../lib/quality";
import { fly, glide, judge, LIMITS } from "./landing";
import type { Scenario, Verdict } from "./helpers";

const CALM: WeatherState = {
  source: "metar",
  kind: "fair",
  wind: { u10: 2, from: 220, gust: 0, turb: 0, shear: 0 },
  visibility: 30e3,
  fogTop: 0,
  layers: [],
  rain: 0,
  dust: 0,
};

/** The weather fixed (a report's, the same each run), the scene's clock set [UTC, the scene's year]. */
async function setUp(lab: Lab, w: WeatherState, utc?: string) {
  await lab.js(`(() => {
    const w = ${JSON.stringify(w)};
    __bh.settings.weather = "real"; __bh.camera.weatherReal = w; __bh.renderer.weatherReal = w;
    ${utc ? `__bh.game.setDate(${JSON.stringify(utc)});` : ""}
    return true;
  })()`);
}

type Row = {
  t: number;
  rolling?: boolean;
  landed?: boolean;
  air?: { alpha?: number; q?: number; body?: string } | null;
  entry?: { leg?: string | null; ga?: number; dh?: { across: number; dh: number; ga: boolean } | null } | null;
};

/** The procedure as flown (the telemetry's samples): the go-arounds, each decision at the minima, α's
 *  swings in the missed approach and in the approach after it (judged as a whole flight's are: in the air,
 *  the touchdown's last 30 s out). */
function procedure(lab: Lab) {
  const S = readFileSync(`${lab.o.dir}/telemetry.jsonl`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);
  let ga = 0;
  const dh: { across: number; dh: number; ga: boolean }[] = [];
  for (const s of S) {
    ga = Math.max(ga, s.entry?.ga ?? 0);
    const d = s.entry?.dh;
    const last = dh[dh.length - 1];
    if (d && (!last || last.across !== d.across || last.dh !== d.dh)) dh.push(d);
  }
  const td = S.find((s) => s.rolling || s.landed)?.t ?? Number.POSITIVE_INFINITY;
  const air = S.filter((s) => s.air?.body && (s.air?.q ?? 0) > 0.05 && s.t < td - 30 && !s.rolling && !s.landed);
  const swings = (R: Row[]) =>
    oscillations(
      R.map((s) => s.t),
      R.map((s) => s.air?.alpha ?? 0),
      2,
    );
  const missed = air.filter((s) => s.entry?.leg === "missed");
  const lastMissed = missed[missed.length - 1]?.t ?? Number.POSITIVE_INFINITY;
  return { ga, dh, swingsMissed: swings(missed), swingsAfter: swings(air.filter((s) => s.t > lastMissed)) };
}

/** The landing's verdict, then the procedure's: `ga` go-arounds asked, the last decision stabilised. A
 *  go-around's flight judged by parts: α's swings in its missed approach (its pull-up, its level-off) and
 *  in the new approach (a whole approach's limit) — the landing's own count kept the cut-off final's
 *  pull-up, which the touchdown's last 30 s leave out of an approach flown through; its first final off
 *  the corridor and its turns are the procedure's, not faults. */
function withProcedure(lab: Lab, v: Verdict, ga: number): Verdict {
  const p = procedure(lab);
  const last = p.dh[p.dh.length - 1];
  const checks: [string, boolean][] = [
    [`${p.ga} go-around(s), ${ga} asked`, p.ga === ga],
    [
      `the last minima stabilised (${last ? `${last.across} m off the axis, ${last.dh} m off the profile` : "none seen"})`,
      !!last && !last.ga,
    ],
  ];
  if (ga > 0)
    checks.push(
      [`α swings in the missed approach ${p.swingsMissed} ≤ 3`, p.swingsMissed <= 3],
      [`α swings in the new approach ${p.swingsAfter} ≤ ${LIMITS.alphaSwings.glide}`, p.swingsAfter <= LIMITS.alphaSwings.glide],
    );
  const skip = ga > 0 ? /^(final corridor|α swings|bank reversals)/ : null;
  const why = v.ok
    ? []
    : v.why
        .replace(/^✗ /, "")
        .split(" · ")
        .filter((s) => !skip?.test(s));
  const bad = [...why, ...checks.filter(([, ok]) => !ok).map(([s]) => s)];
  return {
    ok: !bad.length,
    why: bad.length
      ? `✗ ${bad.join(" · ")}`
      : `${v.ok ? v.why : `✓ touchdown ${v.metrics?.sinkMps} m/s down, ${Number(v.metrics?.acrossTdM).toFixed(1)} m off the axis`} · ${checks.map(([s]) => s).join(" · ")}`,
    metrics: { ...v.metrics, goArounds: p.ga, minima: JSON.stringify(p.dh), swingsMissed: p.swingsMissed, swingsAfter: p.swingsAfter },
  };
}

export const AIRPORTS: Scenario[] = [
  {
    id: "airport-edwards-night",
    title: "Ranger — Edwards at night (01:00 local): the nominal hand-over, the runway's lights, landed",
    tags: ["landing", "glide", "ranger", "plane", "runway", "airport", "night"],
    minutes: 6,
    async run(lab) {
      await setUp(lab, CALM, "2067-01-01T09:00");
      await glide(lab, "Edwards", 80, 25, 750, 0);
      const e = await fly(lab, { maxSim: 1200, maxWall: 700 });
      return withProcedure(lab, await judge(lab, e, "glide", 0), 0);
    },
  },
  {
    id: "airport-edwards-goaround",
    title: "Ranger — Edwards, a late sidestep: 5 km out, 300 m off the axis — unstabilised at the minima, the go-around, landed",
    tags: ["landing", "glide", "ranger", "plane", "runway", "airport", "go-around"],
    minutes: 8,
    async run(lab) {
      await setUp(lab, CALM);
      await glide(lab, "Edwards", 5, 0.6, 165, 0, { acrossKm: 0.3 });
      const e = await fly(lab, { maxSim: 1500, maxWall: 800 });
      const v = await judge(lab, e, "glide", 0);
      return withProcedure(lab, v, 1);
    },
  },
  {
    id: "airport-edwards-toga",
    title: "Ranger — Edwards, full throttle 3 km out (TOGA): the missed approach flown, a new approach, landed",
    tags: ["landing", "glide", "ranger", "plane", "runway", "airport", "go-around"],
    minutes: 8,
    async run(lab) {
      await setUp(lab, CALM);
      await glide(lab, "Edwards", 80, 25, 750, 0);
      const e0 = await lab.fixed({
        until: `T.entry && T.entry.leg === "final" && T.entry.app && T.entry.app.along > -3000`,
        maxSim: 600,
        maxWall: 300,
      });
      if (e0.end !== "until") return { ok: false, why: `✗ no final 3 km out (${e0.end}: ${e0.why})`, metrics: {} };
      // (full throttle on the autopilot's approach: the key's own path — main.ts throttleFull)
      const toga = await lab.js<boolean>("__bh.camera.goAround()");
      if (!toga) return { ok: false, why: "✗ TOGA refused", metrics: {} };
      const e = await fly(lab, { maxSim: 1500, maxWall: 800 });
      const v = await judge(lab, e, "glide", 0);
      return withProcedure(lab, v, 1);
    },
  },
  {
    id: "airport-bourget-cat3-night",
    title: "Ranger — Le Bourget at night in a CAT III fog: 150 m, its top 60 m, a deck at 100 m — the lights, the autoland",
    tags: ["landing", "glide", "ranger", "plane", "runway", "airport", "night", "weather"],
    minutes: 6,
    async run(lab) {
      await setUp(
        lab,
        {
          ...CALM,
          kind: "fog",
          wind: { u10: 1, from: 270, gust: 0, turb: 0, shear: 0 },
          visibility: 150,
          fogTop: 60,
          layers: [{ base: 100, top: 700, cover: 1 }],
        },
        "2067-01-01T01:00",
      );
      await glide(lab, "Bourget", 80, 25, 750, 0);
      const e = await fly(lab, { maxSim: 1200, maxWall: 700 });
      return withProcedure(lab, await judge(lab, e, "glide", 0), 0);
    },
  },
];
