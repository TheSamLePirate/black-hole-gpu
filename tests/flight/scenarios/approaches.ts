// The ILS approaches of Toulon-Hyères (LFTH — 05/23, 2 120 m; 13/31, 1 902 m), each runway's end flown by the F-35 (its
// procedure: game/ils.ts — to the initial fix, the localizer, the glideslope, the flare, braked to a stop) and by the A320
// (its FMGC: controller/a320ap.ts a320Approach — vectored to a 30° intercept, APPR armed, LOC, G/S, LAND, FLARE, ROLL OUT,
// the configuration a step at a time) — Sam, 5 Nov 2026: « lance des e2e flight lab pour les différentes approches ».
// Each starts 28 km out, 50° off the final's axis, 1 800 m over the ground, by day in calm air; the runway asked by its
// number (camera.ilsStart("LFTH", { runway })), the same action as the wheel's and TARS's. A slope the relief pierces is
// refused by the action (game/ils.ts glideClearance): that end's verdict says so. Judged on the touchdown on the runway
// asked (its grade, the sink rate, the offset), and on the flight (the lab's q_ measures).
import { readFileSync } from "node:fs";
import { fromRunway } from "../../../src/game/ils";
import type { Lab } from "../lib/lab";
import type { Scenario, Verdict } from "./helpers";

/** LFTH's thresholds as OurAirports gives them (the world's runway tile: the game reads the same) — only to place the
 *  start; the approach flies the game's own. */
const LFTH = { lat: 43.0973, lon: 6.146, elev: 2 };
const ENDS: { id: string; hdg: number }[] = [
  { id: "05", hdg: 52 },
  { id: "23", hdg: 232 },
  { id: "13", hdg: 133 },
  { id: "31", hdg: 313 },
];

type Craft = "f35" | "a320";

async function setUp(lab: Lab, craft: Craft, end: { id: string; hdg: number }) {
  await lab.js(`(() => {
    __bh.settings.vessel = ${JSON.stringify(craft)};
    Object.assign(__bh.settings, { traffic: false, weather: "fair", wind: 0, earthClouds: 0, f35Invulnerable: false });
    __bh.game.setDate("2026-11-05T12:00:00Z");
    return true;
  })()`);
  await lab.app.waitProgress(`__bh.fleet.active === ${JSON.stringify(craft)}`, `the ${craft}`);
  // (the start: 28 km out on a line 50° off the final's — from the side of the airfield's centre —, heading for the field)
  const R = { name: "LFTH", lat: LFTH.lat, lon: LFTH.lon, hdg: end.hdg, elev: LFTH.elev, len: 2000 };
  const back = (end.hdg + 180 + 50) % 360;
  const p = fromRunway(R, 0, 0);
  const D = Math.PI / 180;
  const lat = p.lat + (28_000 * Math.cos(back * D)) / 111_320;
  const lon = p.lon + (28_000 * Math.sin(back * D)) / (111_320 * Math.cos(p.lat * D));
  const hdg = (back + 180) % 360;
  const speed = craft === "a320" ? 120 : 150;
  await lab.js(`(() => {
    __bh.game.flyAt(${lat}, ${lon}, 1800, ${hdg}, ${speed});
    const c = __bh.camera;
    c.gearDown = false;
    c.airFlight.cfg.flaps = 0;
    c.pilot.throttle = ${craft === "a320" ? 0.62 : 0.6};
    __bh.settings.shipMount = "cockpit";
    // (held where it was put while its place's data come: the image goes on, the flight waits — lab.live lets it go)
    __bh.freeze(true);
    return true;
  })()`);
  // (the airfield's runways — their tile in —, the place's data and the shaders: waited on their progress)
  await lab.app.waitProgress(`(__bh.camera.ilsRunways("LFTH")?.ends.length ?? 0) >= 4`, "LFTH's runways");
  await lab.ready("Toulon-Hyères' data");
}

/** The approach asked, flown to a stop (the grade written: camera.ilsLast), then judged. */
async function approach(lab: Lab, craft: Craft, end: { id: string; hdg: number }): Promise<Verdict> {
  await setUp(lab, craft, end);
  // (the A320's autopilot engages 5 s after a lift-off: a few seconds flown first, live, as placed)
  const t0 = await lab.js<number>("window.__lab.sample().t");
  await lab.live({ until: `T.t > ${t0 + 6}`, maxWall: 60, everyMs: 500 });
  const ch = await lab.js<{ ends: { id: string; len: number; clearM: number; wind: boolean }[] }>(
    `(() => { const x = __bh.camera.ilsRunways("LFTH"); return { ends: x.ends.map((e) => ({ id: e.id, len: Math.round(e.len), clearM: e.clearM, wind: e.wind })) }; })()`,
  );
  const mine = ch.ends.find((e) => e.id === end.id);
  const said = await lab.js<string>(`__bh.camera.ilsStart("LFTH", { runway: ${JSON.stringify(end.id)} })`);
  lab.note("note", `ilsStart: ${said}`);
  const flown = await lab.js<boolean>("!!__bh.camera.ilsRun || !!__bh.camera.a320App");
  const metrics: Record<string, unknown> = { said, clearM: mine?.clearM ?? null, lenM: mine?.len ?? null };
  if (!flown) return { ok: false, why: `✗ the approach not flown: ${said}`, metrics };
  // (flown live, as a player sees it — the frame loop, the tiles streaming in as it goes: the fixed steps froze the page
  // and drew an image every 5 s of flight, Sam saw it jerk; 5 Nov 2026)
  const e = await lab.live({ until: "!!c.ilsLast", maxWall: 900, everyMs: 1000 });
  const L = await lab.js<{
    rwy: string;
    score: number;
    notes: string[];
    touch: { along: number; across: number; vs: number } | null;
  } | null>("__bh.camera.ilsLast");
  // (the approach's own record: the go-arounds — the F-35's missed approaches —, the modes the A320 went through)
  const S = readFileSync(`${lab.o.dir}/telemetry.jsonl`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { ils?: { phase?: string } | null; fmgc?: { lat: string; vert: string } | null });
  const phases: string[] = [];
  for (const s of S) {
    const ph = s.fmgc && craft === "a320" ? `${s.fmgc.lat}/${s.fmgc.vert}` : (s.ils?.phase ?? null);
    if (ph && phases.at(-1) !== ph) phases.push(ph);
  }
  Object.assign(metrics, { end: e.end, phases: phases.join(" → "), grade: L?.score ?? null, notes: L?.notes?.join(", ") ?? null });
  if (!L?.touch) return { ok: false, why: `✗ no touchdown graded (${e.end}: ${e.why}) — ${phases.slice(-4).join(" → ")}`, metrics };
  const T = L.touch;
  Object.assign(metrics, { alongTdM: Math.round(T.along), acrossTdM: +T.across.toFixed(1), sinkMps: +(-T.vs).toFixed(2) });
  const checks: [string, boolean][] = [
    [`on ${L.rwy} (asked LFTH ${end.id})`, L.rwy.endsWith(` ${end.id}`)],
    [`${L.score}/20 ≥ 14`, L.score >= 14],
    [`sink ${(-T.vs).toFixed(2)} m/s ≤ 3`, -T.vs <= 3],
    [`${T.across.toFixed(1)} m off the axis ≤ 10`, Math.abs(T.across) <= 10],
    [`${Math.round(T.along)} m past the threshold, 100–1 000`, T.along > 100 && T.along < 1000],
  ];
  const bad = checks.filter(([, ok]) => !ok).map(([s]) => s);
  return { ok: !bad.length, why: bad.length ? `✗ ${bad.join(" · ")}` : `✓ ${checks.map(([s]) => s).join(" · ")}`, metrics };
}

export const APPROACHES: Scenario[] = (["f35", "a320"] as const).flatMap((craft) =>
  ENDS.map(
    (end): Scenario => ({
      id: `approach-lfth-${end.id}-${craft}`,
      title: `${craft === "f35" ? "F-35" : "A320"} — Toulon-Hyères ILS ${end.id}: from 28 km out, 50° off the axis, to a stop`,
      tags: ["approach", "ils", "lfth", craft, "plane", "runway", "live"],
      minutes: craft === "a320" ? 10 : 7,
      // (the relief's and the photographs' tiles streamed as a player gets them — the lab blocks them by default)
      tiles: true,
      run: (lab) => approach(lab, craft, end),
    }),
  ),
);
