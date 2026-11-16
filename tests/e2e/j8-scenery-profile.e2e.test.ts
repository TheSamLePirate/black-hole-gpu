import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { attachWorkers, newestWorker, phasesBusy, profileStart, profileStop, type WorkerSession, witness } from "./lib/worker-profile";

// PLAN-J8 J8-0 (b) and (d): where the scenery worker's time goes, warm — at Toulon and at Paris, the F-35 placed (frozen) 500 m over
// the town at rest, its scene made once (the data in the caches), sent 33 km away, then placed back: the scene made again warm — a
// quick one (placed at 140 m/s: its box QUICK_SHARE of the reach's), then the full one (placed at rest) —, the worker's thread profiled through each
// (lib/worker-profile.ts: the DevTools Profiler on the worker's own session), its phases (the worker's `phases`) cut into time busy —
// script, garbage collection — against idle — the network's answers awaited, timers. (d) at Paris: which budget cuts the buildings,
// the scene's bytes (48 MiB) or the meshes' (16 MiB) — the scene's own figures (`earthScenery.stats()`). The witnesses of rule 3
// first: a 400 ms busy loop in the worker read ≈ 400 ms busy, a 400 ms wait ≈ 0. Writes docs/progress/j8/worker-profile.json.
// Done when: both places' warm quick and full scenes profiled (Toulon twice: its A/A), each phase's busy and idle said, the witnesses
// within 15 %, Paris's budgets read.
// Duration: ~6 min (two places, three scenes each, the first cold; Paris's IGN tiles — one heavy IGN load at a time).

const OUT = process.env.J8P_OUT ?? "docs/progress/j8/worker-profile.json";
// (Toulon twice: the second pass its A/A — rule 3: the same warm scene, the same split)
const PLACES = [
  { name: "Toulon", lat: 43.124, lon: 5.93 },
  { name: "Toulon A/A", lat: 43.124, lon: 5.93 },
  { name: "Paris", lat: 48.8566, lon: 2.3522 },
].filter((p) => !process.env.J8P_ONLY || p.name.startsWith(process.env.J8P_ONLY));

type Stats = {
  status: string;
  quick: boolean;
  lat: number | null;
  lon: number | null;
  workerMs: number;
  phases: Record<string, number> | null;
  buildings: number;
  cutBuildings: number;
  keptReachM: number;
  budgetLimited: boolean;
  bytes: Record<string, number> | null;
  meshBytes: number;
  meshedBuildings: number;
  tileNetworkBytes: number;
  zoneResponses: number;
  otherResponses: number;
  fetchCache: unknown;
};
const STATS = `(() => { const s = __bh.renderer.earthScenery?.stats?.(); if (!s) return null;
  const k = ["status","quick","lat","lon","workerMs","phases","buildings","cutBuildings","keptReachM","budgetLimited","bytes","meshBytes","meshedBuildings","tileNetworkBytes","zoneResponses","otherResponses","fetchCache"];
  return Object.fromEntries(k.map((x) => [x, s[x] ?? null])); })()`;

describe.skipIf(!E2E)("PLAN-J8 J8-0 (b, d): the scenery worker's time, warm, at Toulon and Paris", () => {
  let app: App;
  let w: WorkerSession;
  const out: Record<string, unknown> = { at: new Date().toISOString() };
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0, earthClouds: 0 }); __bh.game.setDate("2026-07-10T11:00:00Z"); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** frozen, placed 500 m over (lat, lon) heading north at `speed` [m/s]: 140 — a fast flight, its scenes the quick ones (scenery.ts
   *  fastFlight: over 120 m/s) —, or 0 — at rest, the full scene (a first run asked for the full one at 140 m/s and never got it) */
  const place = (lat: number, lon: number, speed: number) =>
    app.js(
      `(() => { __bh.freeze(true); __bh.game.flyAt(${lat}, ${lon}, 500, 0, ${speed}); __bh.settings.shipMount = "cockpit"; return 1; })()`,
    );
  const stats = () => app.js<Stats | null>(STATS);
  const near = (s: Stats | null, lat: number, lon: number) =>
    // (a scene is centred ahead on the track — scenery.ts: where it will be when made —: 3.4 km north of the jet at Toulon, cold)
    !!s && s.lat !== null && Math.abs(s.lat - lat) < 0.07 && Math.abs((s.lon ?? 0) - lon) < 0.09;
  /** a scene's reply for (lat, lon), `quick` or full, newer than `after` (its workerMs and phases told) — polled every 100 ms */
  const reply = async (lat: number, lon: number, quick: boolean, label: string, maxS = 150) => {
    const t0 = Date.now();
    let last: Stats | null = null;
    while (Date.now() - t0 < maxS * 1000) {
      last = await stats();
      if (near(last, lat, lon) && last!.quick === quick && last!.status !== "loading") return { s: last!, at: Date.now() };
      await Bun.sleep(100);
    }
    throw new Error(
      `${label}: no ${quick ? "quick" : "full"} scene at ${lat}, ${lon} in ${maxS} s — last ${JSON.stringify(last)?.slice(0, 300)}`,
    );
  };

  test("the probe's witnesses (rule 3): a 400 ms loop read busy, a 400 ms wait read idle", async () => {
    await app.scenario("the worker attached · witnesses");
    // (each new scenery worker profiled from its first line — it is made again at a far placing)
    const ws = await attachWorkers(app, /scenery-worker/, /scenery-worker/);
    console.log(`  workers: ${ws.map((x) => x.url.split("/").pop()).join(", ")}`);
    expect(ws.length).toBeGreaterThan(0);
    w = ws[0]!;
    // (the worker at rest: a scene in the making — the boot's — is real work, read as busy rightly; the negative witness needs none)
    await app.waitFor(`(() => { const s = __bh.renderer.earthScenery?.stats?.(); return !!s && !s.pending; })()`, 180_000);
    await Bun.sleep(1500);
    const r = await witness(app, w, 400);
    console.log(
      `  witness: loop ${r.loopBusyMs} ms busy (400 asked); wait ${r.waitBusyMs} ms busy, ${r.waitIdleMs} ms idle — ${JSON.stringify(r.waitTop)}`,
    );
    out.witness = r;
    expect(Math.abs(r.loopBusyMs - 400)).toBeLessThan(60);
    expect(r.waitBusyMs).toBeLessThan(60);
  }, 60_000);

  for (const P of PLACES)
    test(`${P.name}: the scene made again warm — quick, then full — profiled`, async () => {
      // (cold: the data into the caches; then away 33 km; then back — warm)
      await app.scenario(`${P.name} · cold scene (the caches filled)`);
      await place(P.lat, P.lon, 0);
      const cold = await reply(P.lat, P.lon, false, `${P.name} cold`, 240);
      await app.scenario(`${P.name} · away 33 km`);
      await place(P.lat + 0.3, P.lon, 0);
      await reply(P.lat + 0.3, P.lon, false, `${P.name} away`, 240);
      const res: Record<string, unknown> = { cold: { workerMs: Math.round(cold.s.workerMs), phases: cold.s.phases } };
      for (const quick of [true, false]) {
        await app.scenario(`${P.name} · warm ${quick ? "quick" : "full"} scene profiled`);
        // (the worker now: profiled from here; one made again meanwhile was profiled from its start — the newest read at the end)
        w = newestWorker(app, /scenery-worker/) ?? w;
        await profileStart(app, w).catch(() => {});
        await place(P.lat, P.lon, quick ? 140 : 0);
        const r = await reply(P.lat, P.lon, quick, `${P.name} warm`, 180);
        const stopAt = Date.now();
        const pr = await profileStop(app, newestWorker(app, /scenery-worker/) ?? w);
        const lagMs = Date.now() - stopAt + 50;
        const cut = phasesBusy(pr, r.s.phases ?? {}, r.s.workerMs, lagMs);
        console.log(
          `  ${P.name} warm ${quick ? "quick" : "full"}: ${Math.round(r.s.workerMs)} ms — busy ${cut.busyMs}, idle ${cut.idleMs} (${Math.round((100 * cut.busyMs) / Math.max(cut.busyMs + cut.idleMs, 1))} % busy); network ${Math.round(r.s.tileNetworkBytes / 1024)} kB, zone ${r.s.zoneResponses}, other ${r.s.otherResponses}`,
        );
        for (const p of cut.phases)
          console.log(
            `    ${p.phase.padEnd(16)} ${String(p.wallMs).padStart(6)} ms: busy ${p.busyMs}, idle ${p.idleMs} — ${p.top
              .slice(0, 2)
              .map((f) => `${f.fn} ${f.ms}`)
              .join(" · ")}`,
          );
        res[quick ? "quick" : "full"] = {
          workerMs: Math.round(r.s.workerMs),
          ...cut,
          network: { bytes: r.s.tileNetworkBytes, zone: r.s.zoneResponses, other: r.s.otherResponses, fetchCache: r.s.fetchCache },
          buildings: r.s.buildings,
          cutBuildings: r.s.cutBuildings,
          keptReachM: r.s.keptReachM,
          budgetLimited: r.s.budgetLimited,
          bytes: r.s.bytes,
          meshBytes: r.s.meshBytes,
          meshedBuildings: r.s.meshedBuildings,
        };
        expect(cut.busyMs + cut.idleMs).toBeGreaterThan(0.5 * r.s.workerMs);
      }
      const F = res.full as {
        budgetLimited: boolean;
        bytes: Record<string, number> | null;
        meshBytes: number;
        cutBuildings: number;
        buildings: number;
        keptReachM: number;
      };
      console.log(
        `  ${P.name} (d): buildings ${F.buildings}, cut ${F.cutBuildings}, kept to ${Math.round(F.keptReachM)} m; budgetLimited ${F.budgetLimited}; bytes ${JSON.stringify(F.bytes)}; meshes ${(F.meshBytes / 2 ** 20).toFixed(1)} MiB`,
      );
      out[P.name] = res;
      mkdirSync("docs/progress/j8", { recursive: true });
      writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
    }, 900_000);
});
