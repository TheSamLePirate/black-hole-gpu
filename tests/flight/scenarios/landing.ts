// The Ranger's landings on a runway, by the entry autopilot: from a 400 km orbit — the deorbit planned in the
// worker, the wait, the burn, the entry, the glide, the final, the touchdown, the rollout to a stop — at the
// runways of SITES and at several inclinations (one with the site far off the ground track: the cross-range's
// edge), in still air and in wind; and the glide alone (glideTo), from high and low energy, off the runway's
// line. The long parts at fixed steps; the final and the touchdown live in some, as a player watches them.
// Judged on the landing (stopped on the runway, one touchdown, its sink rate and its offset from the
// centreline) and on how it flew (the assistants' corridors, α's oscillations, the load, the bank's reversals).
import { readFileSync } from "node:fs";
import type { ChunkEnd, Lab } from "../lib/lab";
import { quality } from "../lib/quality";
import { earthRelief, engage, onRunway, type Scenario, type Verdict } from "./helpers";

/** What AAA asks of a landing: the limits each scenario is judged against (a check per line in `why`). */
export const LIMITS = {
  /** the touchdown's sink rate [m/s]: in calm or light wind, in a strong one (wind 2, its gusts) */
  sink: { calm: 1, strong: 1.8 },
  /** the touchdown's offset from the centreline [m] */
  across: 5,
  /** the share of the time in each assistant's corridor [%] */
  corridor: 85,
  /** α's oscillations in flight of more than 2° (reversals with another within 15 s; the flare's last 30 s out);
   *  in a strong gusty wind (wind 2, a storm's turbulence) the gusts' own swings on top: 3 more */
  alphaSwings: { glide: 6, entry: 12, gusty: 3 },
  /** the load factor's peak [g] */
  g: { glide: 2.5, entry: 3 },
  /** the commanded bank's reversals of more than 15° */
  bankReversals: { glide: 4, entry: 8 },
};

/** The touchdowns as they happen (page side): the message, the runway's offset at that moment. */
export async function watchTouchdowns(lab: Lab) {
  await lab.js(`(() => {
    const c = __bh.camera, prev = c.onPilotMessage;
    window.__td = [];
    c.onPilotMessage = (t) => {
      if (/^Touchdown/.test(String(t))) {
        // (the runway's view anew: its cache is kept a tenth of a wall second — at fixed steps, many
        // seconds of flight: the offset read was the final's turn's, 450 m)
        c.runwayCache = null;
        const w = c.runwayView?.();
        window.__td.push({ text: String(t), along: w?.along ?? null, across: w?.across ?? null });
      }
      prev?.(t);
    };
    return true;
  })()`);
}

/** The Ranger in a 400 km orbit, the site chosen (glideTo sets it: then the orbit), the wind; entry engaged. */
async function fromOrbit(lab: Lab, site: string, inc: number, wind: number, o: { warp?: number; raan?: number } = {}) {
  await earthRelief(lab);
  await lab.js(`(() => {
    const c = __bh.camera;
    __bh.settings.wind = ${wind};
    __bh.game.glideTo(${JSON.stringify(site)});
    const st = c.entrySite;
    __bh.game.orbit("earth", { altKm: 400, inc: ${inc}${o.raan !== undefined ? `, raan: ${o.raan}` : ""} });
    c.entrySite = st;
    ${o.warp ? `__bh.game.warp(${o.warp});` : ""}
    return st.name;
  })()`);
  await watchTouchdowns(lab);
  await engage(lab, "entry");
}

/** The glide alone: glideTo's start, the wind. */
export async function glide(
  lab: Lab,
  site: string,
  dist: number,
  alt: number,
  speed: number,
  wind: number,
  off: { acrossKm?: number; headingDeg?: number } = {},
) {
  await earthRelief(lab);
  await lab.js(`(__bh.settings.wind = ${wind}, true)`);
  await watchTouchdowns(lab);
  await lab.js(`(__bh.game.glideTo(${JSON.stringify(site)}, ${dist}, ${alt}, ${speed}, ${JSON.stringify(off)}), true)`);
}

const STOPPED = "T.landed && !T.rolling";

/**
 * Flown to a stop: fixed steps all the way, or fixed to the final (2.5 km up on it) and live from there —
 * the final, the touchdown and the rollout at the page's own pace —, or live all the way ("all"): the page's
 * own frame loop from the orbit, as a player flies it, the autopilot speeding up the long waits itself.
 */
export async function fly(lab: Lab, o: { live?: boolean | "all"; maxSim: number; maxWall: number }): Promise<ChunkEnd> {
  if (!o.live) return lab.fixed({ until: STOPPED, maxSim: o.maxSim, maxWall: o.maxWall });
  if (o.live === "all") return lab.live({ until: STOPPED, maxWall: o.maxWall });
  const e = await lab.fixed({
    until: `(T.entry && T.entry.leg === "final" && T.entry.app && T.entry.app.agl < 2500) || T.landed`,
    maxSim: o.maxSim,
    maxWall: o.maxWall,
  });
  if (e.end !== "until") return e;
  return lab.live({ until: STOPPED, maxWall: 400 });
}

/** The verdict: the landing's checks, then the flight's quality (its graphs saved, measured). */
export async function judge(lab: Lab, e: ChunkEnd, kind: "glide" | "entry", wind: number): Promise<Verdict> {
  const td = ((await lab.js(`window.__td ?? []`).catch(() => [])) ?? []) as { text: string; along: number | null; across: number | null }[];
  await lab.saveGraphs();
  const q = quality(lab.o.dir);
  const first = td[0];
  const sink = Number(/([-\d.]+) m\/s down/.exec(first?.text ?? "")?.[1] ?? Number.NaN);
  const sinkMax = wind >= 2 ? LIMITS.sink.strong : LIMITS.sink.calm;
  const swingMax = LIMITS.alphaSwings[kind] + (wind >= 2 ? LIMITS.alphaSwings.gusty : 0);
  // (the offset at the touchdown: the first sample on the wheels — the runway's view read within the
  // touchdown's own step is the camera's stale one, 100 m off what the telemetry shows)
  const onWheels = readFileSync(`${lab.o.dir}/telemetry.jsonl`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { rolling?: boolean; landed?: boolean; runway?: { across: number } | null })
    .find((S) => (S.rolling || S.landed) && S.runway);
  const across = onWheels?.runway?.across ?? Number.NaN;
  const hard = lab.events.find((x) => x.kind === "pilot" && /Hard landing|collapsed|tipped/.test(x.text));
  const checks: [string, boolean][] = [
    [`flown to a stop (${e.end}: ${e.why})`, e.end === "until"],
    [`stopped on the runway ${JSON.stringify(lab.T.runway)}`, onRunway(lab)],
    [`${td.length} touchdown(s)`, td.length === 1],
    [`sink ${sink} m/s ≤ ${sinkMax}`, sink <= sinkMax],
    [`across ${across?.toFixed?.(1)} m ≤ ${LIMITS.across}`, Math.abs(across) <= LIMITS.across],
    [`no hard landing${hard ? `: ${hard.text}` : ""}`, !hard],
    [`final corridor ${q.q_corridor_glide_pct ?? "—"} % ≥ ${LIMITS.corridor}`, (q.q_corridor_glide_pct ?? 0) >= LIMITS.corridor],
    [`α swings ${q.q_alphaSwings} ≤ ${swingMax}`, (q.q_alphaSwings ?? 0) <= swingMax],
    [`g ${q.q_gMax} ≤ ${LIMITS.g[kind]}`, (q.q_gMax ?? 0) <= LIMITS.g[kind]],
    [`bank reversals ${q.q_bankReversals} ≤ ${LIMITS.bankReversals[kind]}`, (q.q_bankReversals ?? 0) <= LIMITS.bankReversals[kind]],
  ];
  if (kind === "entry")
    checks.push([
      `entry corridor ${q.q_corridor_entry_pct ?? "—"} % ≥ ${LIMITS.corridor}`,
      (q.q_corridor_entry_pct ?? 0) >= LIMITS.corridor,
    ]);
  const bad = checks.filter(([, ok]) => !ok).map(([s]) => s);
  return {
    ok: !bad.length,
    why: bad.length ? `✗ ${bad.join(" · ")}` : `✓ ${first?.text} · across ${across?.toFixed?.(1)} m · ${JSON.stringify(lab.T.runway)}`,
    metrics: {
      sinkMps: sink,
      acrossTdM: across,
      alongTdM: first?.along,
      touchdowns: td.length,
      stopAlong: lab.T.runway?.along,
      stopAcross: lab.T.runway?.across,
    },
  };
}

/** A full entry from a 400 km orbit to a stop. */
function entry(
  id: string,
  title: string,
  site: string,
  inc: number,
  wind: number,
  o: { live?: boolean | "all"; warp?: number; raan?: number; minutes?: number } = {},
): Scenario {
  return {
    id,
    title,
    tags: ["landing", "entry", "ranger", "plane", "runway", ...(o.live ? ["live"] : []), ...(wind ? ["wind"] : [])],
    minutes: o.minutes ?? (o.live === "all" ? 18 : o.live ? 14 : 10),
    async run(lab) {
      await fromOrbit(lab, site, inc, wind, o);
      const e = await fly(lab, { live: o.live, maxSim: 2 * 86400, maxWall: o.live === "all" ? 3600 : 1500 });
      return judge(lab, e, "entry", wind);
    },
  };
}

/** The glide alone, from glideTo's start to a stop. */
function glideScenario(
  id: string,
  title: string,
  site: string,
  start: [number, number, number],
  wind: number,
  o: { live?: boolean; acrossKm?: number; headingDeg?: number } = {},
): Scenario {
  return {
    id,
    title,
    tags: ["landing", "glide", "ranger", "plane", "runway", ...(o.live ? ["live"] : []), ...(wind ? ["wind"] : [])],
    minutes: o.live ? 8 : 5,
    async run(lab) {
      await glide(lab, site, ...start, wind, { acrossKm: o.acrossKm, headingDeg: o.headingDeg });
      const e = await fly(lab, { live: o.live, maxSim: 1200, maxWall: 600 });
      return judge(lab, e, "glide", wind);
    },
  };
}

export const LANDING: Scenario[] = [
  // ---- from orbit: the runways, the inclinations, the winds
  entry("entry-edwards-i40", "Ranger — from a 400 km orbit (40°) to Edwards, calm", "Edwards", 40, 0),
  entry("entry-kennedy-i51-live", "Ranger — from the station's orbit (51.6°) to Kennedy, light wind, the final live", "Kennedy", 51.6, 1, {
    live: true,
  }),
  entry("entry-kourou-i10", "Ranger — from a low-inclination orbit (10°) to Kourou, calm", "Kourou", 10, 0),
  entry("entry-baikonur-i51-wind2", "Ranger — from 51.6° to Baikonur, moderate wind", "Baikonur", 51.6, 2),
  entry("entry-bourget-i51", "Ranger — from 51.6° to Le Bourget, light wind", "Bourget", 51.6, 1),
  entry(
    "entry-bourget-i51-live-all",
    "Ranger — from 51.6° to Le Bourget, light wind, all of it live as a player flies it",
    "Bourget",
    51.6,
    1,
    {
      live: "all",
    },
  ),
  entry("entry-tanegashima-i35-live", "Ranger — from 35° to Tanegashima, calm, the final live", "Tanegashima", 35, 0, { live: true }),
  entry("entry-woomera-i40", "Ranger — from 40° to Woomera (south), light wind", "Woomera", 40, 1),
  entry(
    "entry-bourget-i45-crossrange",
    "Ranger — from 45° to Le Bourget (49°): the site 4° off the track's top, the cross-range's edge",
    "Bourget",
    45,
    0,
  ),
  entry("entry-edwards-warping", "Ranger — entry engaged at ×1000 (the deorbit planned in real time), to Edwards", "Edwards", 40, 0, {
    warp: 1000,
  }),
  // ---- the glide alone
  glideScenario(
    "glide-edwards-wind2",
    "Ranger — the nominal hand-over (80 km, 25 km, 750 m/s) to Edwards, moderate wind",
    "Edwards",
    [80, 25, 750],
    2,
  ),
  glideScenario("glide-kennedy-high", "Ranger — high energy: 60 km out, 28 km up, 850 m/s to Kennedy", "Kennedy", [60, 28, 850], 0),
  glideScenario("glide-kennedy-low", "Ranger — low energy: 45 km out, 7 km up, 230 m/s to Kennedy", "Kennedy", [45, 7, 230], 0),
  // (3.5 km up, not 2.5: from 2.5 km at 170 m/s the Ranger's best glide — 1 in 6, at 8° of incidence —
  // reaches the flare 350 m of energy short: no glider makes it, whatever its autopilot)
  glideScenario(
    "glide-bourget-short-live",
    "Ranger — a short final: 20 km out, 3.5 km up, 170 m/s to Le Bourget, light wind, live",
    "Bourget",
    [20, 3.5, 170],
    1,
    {
      live: true,
    },
  ),
  glideScenario(
    "glide-woomera-offset",
    "Ranger — 15 km off the line, heading 40° across it: 50 km out, 12 km up, 350 m/s to Woomera",
    "Woomera",
    [50, 12, 350],
    0,
    {
      acrossKm: 15,
      headingDeg: -40,
    },
  ),
  glideScenario(
    "glide-edwards-circuit",
    "Ranger — over the runway the wrong way round: from past its end, 6 km up, 250 m/s — the circuit",
    "Edwards",
    [-5, 6, 250],
    0,
    {
      headingDeg: 180,
    },
  ),
];
