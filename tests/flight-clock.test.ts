import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

// The flight's logic on the flight's clock (audit 2026-11-10, AR-08; strategy §19.3; wave 4.2): in src/controller and
// src/game a decision that waits "20 s" or "3 s in the air" reads frameclock.ts's frameNow() — the wall's time while the
// game plays, the step's when it is stepped (__bh.step, the tests, a video) —, so a stepped flight decides as a live one.
// The wall's clock (performance.now()) stays only where it is the wall's business, each counted here with its reason: a
// new reading fails this test until it is the flight's clock or given a reason. On 13 Nov 2026 five decisions moved to the
// flight's clock (the landing's report, the GCAS's ground cache, the A320's ILS tuning, the replay's touchdowns, the
// docking's contact message).

const WALL: Record<string, { n: number; why: string }> = {
  "controller/character.ts": { n: 2, why: "cost measurement (the walker's ground, its time spent)" },
  "controller/walking-ground.ts": { n: 3, why: "cost measurement" },
  "controller/plan.ts": { n: 4, why: "cost measurement (the planner's search, its budget of wall time)" },
  "controller/radar.ts": { n: 3, why: "cost measurement (the picture's ms) and the Link 16's network stamps" },
  "game/audit.ts": { n: 5, why: "cost measurement (the audit's checks)" },
  "controller/lens.ts": { n: 5, why: "the interface (the lens's and the pad's gestures)" },
  "controller/rotation.ts": { n: 4, why: "the interface (the last activity, for the idle view)" },
  "controller/rig.ts": { n: 3, why: "the interface (the camera rig's activity)" },
  "controller/fleet.ts": { n: 1, why: "the interface (the last activity)" },
  "controller/piloting.ts": { n: 4, why: "the interface (the last activity) and the space picture's display" },
  "controller/computer.ts": { n: 1, why: "the display (the flames' last firing, pilot.ts fired.at)" },
  "controller/docking.ts": { n: 2, why: "the network (another's host craft carried on from its last sample)" },
  "controller/wingmen.ts": { n: 1, why: "the network (another's wingmen, their samples' age)" },
  "controller/formation.ts": { n: 1, why: "the network (a leader's samples and their grace)" },
  "controller/traffic.ts": { n: 2, why: "the network (the real traffic's reports, wall-dated)" },
  "game/tools.ts": { n: 2, why: "the world runways' cache (world/runways3d.ts, its own wall clock)" },
  "game/out-of-view.ts": { n: 1, why: "the interface (how long the page was out of view — no frame runs meanwhile)" },
  "game/frame.ts": { n: 1, why: "the interface (a failing stage tried again every 5 s of the wall's time)" },
};

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".ts") ? [`${dir}/${e.name}`] : [],
  );

test("the wall's clock in the flight's logic: only where it is the wall's business, each with its reason", () => {
  const root = `${import.meta.dir}/../src`;
  const found: Record<string, number> = {};
  for (const f of [...walk(`${root}/controller`), ...walk(`${root}/game`)]) {
    const n = (readFileSync(f, "utf8").match(/performance\.now\(\)/g) ?? []).length;
    if (n) found[f.slice(root.length + 1)] = n;
  }
  const over = Object.entries(found)
    .filter(([f, n]) => n > (WALL[f]?.n ?? 0))
    .map(([f, n]) => `${f}: ${n} (allowed ${WALL[f]?.n ?? 0})`);
  expect(over).toEqual([]);
});
