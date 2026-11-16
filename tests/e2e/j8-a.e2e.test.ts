import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { J8A_TRACKS } from "../../src/system/j8a-tracks";
import { App, E2E, stopServer } from "./lib/app";
import { CRUISE, expectFlight, flightState } from "./lib/flight-state";
import { J0_FIXED } from "./lib/j0-scene";

// PLAN-J8 J8-A — the plan's demonstration (Sam, 16 Nov 2026: « un vol au-dessus de Paris et au-dessus de Toulon-Hyères avec un max
// de buildings, tous chargés avant le vol, en jour et nuit ») on the shared tracks (src/system/j8a-tracks.ts — the corridor's zone is
// built on them). Per track (J8A_TRACKS: their names) and per hour (day, night — J8A_HOURS): the F-35 put in the air over the track's
// first point, the world frozen, everything loaded (__bh.sys.flightReady — the tiles, the near scene whole, the building cells, the far
// layer's cells all resident; said every 10 s, 10 min at most); then flown along the track under the autopilot (its heading set every
// 5 s to the next point, the next once within 700 m; rule 13 after each leg: the holds, the engine, the airspeed, the attitude, gear up).
// All along: the page's gaps, the GPU time, the near scene's quick ones, the real network in flight (the e2e disk cache's misses; the page's requests apart),
// the buildings drawn (the near scene's, the far layer's boxes and quads); a cockpit shot at each point, a view from outside at the end.
// Not yet a pass/fail on « no request, no quick scene » (J8A_STRICT: asserted; J8A_TRACK_READY: flightReady over the whole track) — J8-5 and J8-8 still to finish; it fails on the
// flight itself (rule 13), a GPU error or the device lost. j8-a.json.
// J8A_NEAR [m, default 0]: the near scene / far layer junction (renderer.farNearOnlyM — J8-5, Sam's choice pending).
// J8A_BUDGET [MiB, default 72]: the far layer's pool (renderer.farBudgetMiB — all Paris resident; Sam's decision pending).
// Duration: ~16 min on kerr-mini (two tracks, day and night, ~3 min of flight each, the preload from the disk).
// Done when: every track flown by day and by night, j8-a.json written.
afterAll(stopServer);
const MACHINE = process.env.J8A_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const OUT = process.env.J8A_OUT ?? `remote-results/j8-a/${MACHINE}`;
const TRACKS = J8A_TRACKS.filter((t) => !process.env.J8A_TRACKS || process.env.J8A_TRACKS.split(",").includes(t.name));
/** J8A_TRACK_READY: flightReady over the whole track (its zone's corridor, its far and street cells — dd36cb80), not the start's view
 *  alone: a zone wanted first (the corridor's, j8-zone-paris) */
const TRACK_READY = !!process.env.J8A_TRACK_READY;
const HOURS = (process.env.J8A_HOURS ?? "day,night").split(",") as ("day" | "night")[];
const D = Math.PI / 180;
/** the data's hosts — a request to one in flight: not all loaded before */
const HOSTS = "geopf|openfreemap|overturemaps|elevation-tiles|eox|earthdata|mapterhorn|terrascope";
type Leg = {
  name: string;
  frames: number;
  gapMax: number;
  gpu: number[];
  quick: number;
  requests: number;
  near: number;
  far: { boxes: number; quads: number } | null;
  at: unknown;
};
test.skipIf(!E2E)(
  "J8-A: Paris and Toulon-Hyères flown by day and by night, everything loaded before — no request, no quick scene, the buildings drawn",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString(), machine: MACHINE, flights: {} };
    try {
      // (the far layer's pool for the whole of Paris — 24 MiB holds a quarter of it, never « all loaded »: ~72 MiB proposed to Sam, his
      // decision pending; J8A_BUDGET [MiB])
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, damage: false });
        __bh.renderer.farBudgetMiB = ${Number(process.env.J8A_BUDGET ?? 72)};
        __bh.renderer.farNearOnlyM = ${Number(process.env.J8A_NEAR ?? 0)}; return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      for (const t of TRACKS) {
        for (const hour of HOURS) {
          const name = `${t.name}-${hour === "day" ? "jour" : "nuit"}`;
          const [p0, p1] = [t.points[0]!, t.points[1]!];
          const hdg0 = Math.atan2(Math.sin((p1[1] - p0[1]) * D) * Math.cos(p1[0] * D), (p1[0] - p0[0]) * D) / D;
          // (rule 13: frozen while the data load — the craft in the air over the first point, its heading to the second —, the date the
          // hour's; flyAt over the ground: the track's height over the sea less ~50 m of ground, the autopilot holds the sea's height)
          await app.scenario(`${t.label} — ${hour === "day" ? "de jour" : "de nuit"} : le chargement`);
          await app.js(`(() => { __bh.freeze(true); __bh.game.setDate("${hour === "day" ? t.dates.day : t.dates.night}");
            __bh.game.set("weather", "fair"); __bh.game.flyAt(${p0[0]}, ${p0[1]}, ${Math.max(p0[2] - 50, 150)}, ${hdg0.toFixed(1)}, ${t.speedMps});
            __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
          const t0 = Date.now();
          // (everything loaded: flightReady every 5 s, what is missing said every 10 s; 120 s without a change of « why » or 600 s: fails)
          let why = "",
            changed = Date.now();
          for (;;) {
            const r = await app.js<{ ready: boolean; why: string }>(
              `(async () => { __bh.touch(); const r = await __bh.sys.flightReady(${TRACK_READY ? `{ track: { points: ${JSON.stringify(t.points)} } }` : ""}); return { ready: r.ready, why: String(r.why) }; })()`,
            );
            if (r.ready) break;
            if (r.why !== why) {
              why = r.why;
              changed = Date.now();
            }
            if ((Date.now() - t0) % 10_000 < 5_000) console.log(`  … ${name}: not ready — ${r.why}`);
            if (Date.now() - changed > 120_000 || Date.now() - t0 > 600_000)
              throw new Error(`${name}: not loaded after ${Math.round((Date.now() - t0) / 1000)} s — ${r.why}`);
            await app.js(`new Promise((q) => setTimeout(q, 5000))`);
          }
          const preloadS = (Date.now() - t0) / 1000;
          // (the real network in flight: the e2e disk cache's misses — what it had not and fetched — before and after; the requests the
          // page made, served by the disk or the Service Worker too, apart)
          const missesBefore = app.earth?.counts.misses ?? 0;
          await app.settled(90_000);
          await app.js(`(() => { performance.clearResourceTimings(); performance.setResourceTimingBufferSize(100000);
            __bh.camera.apSet({ ap: true, athr: true, alt: ${p0[2]}, hdg: ${hdg0.toFixed(2)} * Math.PI / 180, spd: ${t.speedMps} });
            __bh.freeze(false); return 1; })()`);
          await app.scenario(`${t.label} — ${hour === "day" ? "de jour" : "de nuit"} : le vol`);
          // (a leg: to point i, its heading set every 5 s, done within 700 m; 120 s at most)
          const leg = (i: number) =>
            app.js<Leg>(`(async () => {
              const R = __bh.renderer, c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
              const P = ${JSON.stringify(t.points)}[${i}], D = Math.PI / 180;
              const gpu = []; let gapMax = 0, frames = 0, quick = 0, last = performance.now(), done = R.completedFrames, steerAt = 0;
              const t0 = performance.now();
              while (performance.now() - t0 < 120000) {
                const now = await f(); gapMax = Math.max(gapMax, now - last); last = now; frames++;
                if (R.completedFrames !== done) { done = R.completedFrames; gpu.push(+R.lastGpuMs.toFixed(2)); }
                if (R.earthScenery.stats().quick) quick++;
                const g = c.geoNow();
                const dn = (P[0] - g.lat) * 111320, de = (P[1] - g.lon) * 111320 * Math.cos(g.lat * D);
                if (Math.hypot(dn, de) < 700) break;
                if (now - steerAt > 5000) { steerAt = now; c.apSet({ ap: true, athr: true, alt: P[2], hdg: Math.atan2(de, dn), spd: ${t.speedMps} }); }
              }
              const req = performance.getEntriesByType("resource").filter((e) => /${HOSTS}/.test(e.name)).length;
              const sc = R.earthScenery.stats(), far = await R.farBuildings(), g = c.geoNow();
              return { name: "leg-" + ${i}, frames, gapMax: +gapMax.toFixed(1), gpu, quick, requests: req,
                near: sc.bdtopoBuildings + sc.overtureBuildings, far: far?.inView ?? null,
                at: g && { lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4), alt: Math.round(g.alt), gs: Math.round(g.gs ?? 0),
                  paused: document.body.classList.contains("paused"), ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null } }; })()`);
          const legs: Leg[] = [];
          for (let i = 1; i < t.points.length; i++) {
            const l = await leg(i);
            legs.push(l);
            const g = [...l.gpu].sort((a, b) => a - b);
            console.log(
              `  ${name} ${l.name}: ${l.frames} images, gap max ${l.gapMax} ms, GPU p50 ${g[g.length >> 1] ?? "-"} ms, quick ${l.quick}, requests ${l.requests}, near ${l.near}, far ${JSON.stringify(l.far)} — ${JSON.stringify(l.at)}`,
            );
            if ((l.at as { paused?: boolean } | null)?.paused) throw new Error(`${name}: paused in flight — ${JSON.stringify(l.at)}`);
            // (rule 13: the craft as flown after each leg)
            expectFlight(await flightState(app), `${name} ${l.name}`, { ...CRUISE, aglMin: 100, bankMax: 45 });
            await app.shot(`${OUT}/${name}-${i}.png`);
          }
          // (the view from outside at the end: 80 m behind, a little above — the city round the craft)
          await app.js(`(async () => { __bh.settings.shipMount = "around"; __bh.refresh(); __bh.camera.viewReset();
            Object.assign(__bh.camera.outside, { yaw: 160, pitch: 10, dist: 80 });
            for (let i = 0; i < 30; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
          await app.shot(`${OUT}/${name}-dehors.png`);
          await app.js(`(() => { __bh.settings.shipMount = "cockpit"; __bh.refresh(); return 1; })()`);
          const all = legs.flatMap((l) => l.gpu).sort((a, b) => a - b);
          const flight = {
            preloadS,
            legs,
            gpuP50: all[all.length >> 1] ?? null,
            gpuP95: all[Math.floor(all.length * 0.95)] ?? null,
            gapMax: Math.max(...legs.map((l) => l.gapMax)),
            quickImages: legs.reduce((s, l) => s + l.quick, 0),
            requests: legs[legs.length - 1]?.requests ?? 0,
            networkMisses: (app.earth?.counts.misses ?? 0) - missesBefore,
          };
          (out.flights as Record<string, unknown>)[name] = flight;
          console.log(`  ${name}: ${JSON.stringify({ ...flight, legs: undefined })}`);
          if (process.env.J8A_STRICT) {
            expect(flight.networkMisses).toBe(0);
            expect(flight.quickImages).toBe(0);
          }
          await app.js(`(() => { __bh.freeze(true); return 1; })()`);
        }
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      const lost = await app.js<unknown[]>(
        `(__bh.graphicsDiagnostic().events ?? []).filter((e) => String(e.kind).startsWith("device-lost"))`,
      );
      expect(lost).toEqual([]);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/j8-a.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  3_600_000,
);
