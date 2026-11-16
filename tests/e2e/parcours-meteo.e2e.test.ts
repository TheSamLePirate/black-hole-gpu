import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { expectFlight, expectFlightPhase, flightState } from "./lib/flight-state";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";
// PLAN-J6 J6-2 — the journey « approach under degraded weather » (strategy §19.13), in the main profile (raster, the cockpit): the F-35
// over the sea off Hyères (J0's start), the game's date now, the weather fair; the ILS approach to Toulon-Hyères engaged (camera.ilsStart);
// mid-approach the real weather chosen — its source arriving in flight: the airfield's METAR, served by the page itself (rain, a ceiling
// at 600 ft, 2 500 m, wind 250° 18 kt gusting 28); then the stick taken a moment (the real key, held). At every image: the weather the
// image reads (renderer.weatherBlock: the haze's extinction [1/km], the lowest deck's cover and the rain — what the image shows; its first, the
// weight, a switch) and the one the flight reads (camera.windNow), the page's gaps, the GPU.
// Asserted: the METAR in force for the flight and the image — one state (camera.weatherReal === renderer.weatherReal), the flight's wind
// near the METAR's —, the stick acting during the approach, no GPU error, the page never frozen over 1 s. Asserted too: the source's
// arrival faded in (weather.ts weatherHere — before 15 Nov 2026 the image's weather changed in one image, the wind 0 → 20 m/s). Recorded: the
// largest one-image change of the image's weather and of the wind, the GPU under the
// weather, the approach's state.
// Rule 13 (E2E-VOLS): frozen while the data load; on every window never stalled nor slower than 60 m/s; after the stick the approach
// engaged again (ilsStart, as the wheel and TARS) and its state asserted 30 s on — autopilot, autothrottle, thrust, attitude.
// Duration: ~5 min on kerr-mini.
// Done when: the source arrived, the stick taken and given back, 30 s flown after, parcours-meteo.json written.
afterAll(stopServer);
const OUT = process.env.PM_OUT ?? "remote-results/parcours-meteo";
const REPORT = "LFTH 151700Z 25018G28KT 2500 RA BKN006 OVC012 13/12 Q1004";
type Row = { ext: number; wind: number; ils: boolean; pitch: number; spd: number; stall: boolean; eng: number };
test.skipIf(!E2E)(
  "J6-2: an ILS approach to Toulon-Hyères as the real weather's rain and low ceiling arrive — one weather, no frozen page, the stick first",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({
      width: 1920,
      height: 1080,
      hash: "scene=game:artemis",
      tiles: true,
      initScript: `(() => {
        const original = globalThis.fetch;
        globalThis.__metarAsked = [];
        globalThis.fetch = function (input, options) {
          const url = String(input);
          if (url.startsWith("https://metar.vatsim.net/")) {
            globalThis.__metarAsked.push(url);
            return Promise.resolve(new Response(${JSON.stringify(`${REPORT}\n`)}, { status: 200, headers: { "content-type": "text/plain" } }));
          }
          return original.call(this, input, options);
        };
      })()`,
    });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString(), report: REPORT };
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, damage: false });
        return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const place = `(() => { __bh.game.setDate(new Date().toISOString()); __bh.game.set("weather", "fair");
        __bh.game.flyAt(${J0_SCENE.start.join(", ")}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`;
      await app.scenario("beau temps, sur l'approche de LFTH");
      // (rule 13 of E2E-VOLS: frozen while the data load — no glide at idle —, placed again, the approach engaged, then let go)
      await app.js(`(() => { __bh.freeze(true); return 1; })()`);
      await app.js(place);
      await app.dataSettled("off Hyères", { maxMs: 90_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 160)})`));
      await app.js(place);
      await app.settled(90_000);
      // (the approach: the ILS to Toulon-Hyères — its end chosen by the wind, its join planned)
      const ils = await app.js<string>(`(() => { const r = __bh.camera.ilsStart("LFTH"); for (let i = 0; i < 30; i++) __bh.step(1 / 30);
        __bh.freeze(false); return String(r); })()`);
      console.log(`  ilsStart: ${ils}`);
      out.ilsStart = ils;
      await app.shot(`${OUT}/1-beau-temps.png`);
      // in the page: `ms` of images — the image's fog extinction, the flight's wind, the approach, the pitch —, the gaps, the GPU
      const run = (ms: number) =>
        app.js<{ rows: Row[]; gapMax: number; gpu: number[]; same: boolean; real: string | null; at: unknown }>(`(async () => {
          const R = __bh.renderer, c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
          const rows = [], gpu = []; let gapMax = 0, last = performance.now(), done = R.completedFrames; const t0 = performance.now();
          while (performance.now() - t0 < ${ms}) {
            const now = await f(); gapMax = Math.max(gapMax, now - last); last = now;
            if (R.completedFrames !== done) { done = R.completedFrames; gpu.push(+R.lastGpuMs.toFixed(2)); }
            rows.push({ ext: +((R.weatherBlock?.[1] ?? 0) * 1000 + (R.weatherBlock?.[6] ?? 0) + (R.weatherBlock?.[21] ?? 0)).toPrecision(4), wind: +(c.windNow?.speed ?? -1).toFixed(2), ils: !!c.ilsRun && !c.ilsRun.manual,
              pitch: +(((c.attitudeNow().pitch ?? 0) * 180) / Math.PI).toFixed(2), spd: +((c.airInfo?.().speed ?? 0)).toFixed(1),
              stall: !!c.airInfo?.().stalled, eng: +((c.pilot?.engineNow ?? 0)).toFixed(2) });
          }
          const g = c.geoNow();
          return { rows, gapMax: +gapMax.toFixed(1), gpu, same: c.weatherReal === R.weatherReal, real: c.weatherReal?.report ?? null,
            at: g && { lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4), alt: Math.round(g.alt), gs: Math.round(g.gs ?? 0), mount: __bh.settings.shipMount,
              paused: document.body.classList.contains("paused") } }; })()`);
      const p50 = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? null;
      const jump = (rows: Row[], k: "ext" | "wind") => {
        let m = 0;
        // (images where the value is known on both sides: the flight's wind is none — -1 — until a weather gives it one)
        for (let i = 1; i < rows.length; i++)
          if (rows[i]![k] >= 0 && rows[i - 1]![k] >= 0) m = Math.max(m, Math.abs(rows[i]![k] - rows[i - 1]![k]));
        return +m.toPrecision(3);
      };
      // (rule 13 over a window: never stalled, never slower than 60 m/s, the approach flown by its autopilot to its end)
      const flownWell = (rows: Row[], what: string) => {
        const slow = Math.min(...rows.map((x) => x.spd)),
          stalls = rows.filter((x) => x.stall).length;
        console.log(
          `  ${what}: airspeed ≥ ${slow} m/s, stalled ${stalls} images, engine ${Math.min(...rows.map((x) => x.eng))}–${Math.max(...rows.map((x) => x.eng))}`,
        );
        expect(stalls, `${what}: stalled`).toBe(0);
        expect(slow, `${what}: the airspeed`).toBeGreaterThan(60);
      };
      const before = await run(15_000);
      flownWell(before.rows, "fair, on the approach");
      // (asserted once its speed is the approach's: at the engagement its autothrottle at idle slows it from 139 m/s — a pilot's too)
      await expectFlightPhase(app, "approach", {}, "15 s on the approach");
      console.log(`  fair, on the approach: gap max ${before.gapMax} ms, GPU p50 ${p50(before.gpu)} ms — ${JSON.stringify(before.at)}`);
      // (the source arrives: the real weather chosen — the METAR fetched, decoded, in force)
      await app.scenario("arrivée de la pluie (METAR réel)");
      await app.js(`(() => { __bh.game.set("weather", "real"); return 1; })()`);
      const arrival = await run(15_000);
      flownWell(arrival.rows, "the rain arriving");
      await expectFlightPhase(app, "approach", {}, "the rain arrived");
      const ext0 = before.rows.at(-1)?.ext ?? -1;
      const ext1 = arrival.rows.at(-1)?.ext ?? -1;
      const wind0 = before.rows.at(-1)?.wind ?? -1;
      const wind1 = arrival.rows.at(-1)?.wind ?? -1;
      // (how the change came: its share in the largest single image — 1: all at once, a break)
      const extStep = jump(arrival.rows, "ext");
      const windStep = jump(arrival.rows, "wind");
      const asked = await app.js<string[]>(`globalThis.__metarAsked`);
      out.arrival = {
        asked: asked.slice(0, 2),
        report: arrival.real,
        same: arrival.same,
        ext: [ext0, ext1],
        extLargestImage: extStep,
        extShareInOneImage: ext1 !== ext0 ? +(extStep / Math.abs(ext1 - ext0)).toFixed(2) : null,
        wind: [wind0, wind1],
        windLargestImage: windStep,
        gapMax: arrival.gapMax,
        gpuP50: p50(arrival.gpu),
      };
      console.log(`  the source's arrival: ${JSON.stringify(out.arrival)}`);
      await app.shot(`${OUT}/2-arrivee-pluie.png`);
      // (the stick taken a moment during the approach — the real key, held 1.5 s —: the craft answers)
      const p0 = before.rows.length ? (arrival.rows.at(-1)?.pitch ?? 0) : 0;
      let during: { pitch: number; ils: boolean } | null = null;
      await app.scenario("manche tenu 1,5 s");
      await app.hold("KeyS", 1500, async () => {
        during = await app.js(
          `(() => { const c = __bh.camera; return { pitch: +(((c.attitudeNow().pitch ?? 0) * 180) / Math.PI).toFixed(2), ils: !!c.ilsRun && !c.ilsRun.manual }; })()`,
        );
      });
      // (rule 13: the stick given back — the approach engaged again as a pilot would, through the same call as the wheel's and TARS's)
      await app.scenario("approche reprise après le manche");
      out.ilsAgain = await app.js<string>(`String(__bh.camera.ilsStart("LFTH"))`);
      console.log(`  ilsStart again: ${out.ilsAgain}`);
      const after = await run(30_000);
      flownWell(after.rows, "after the stick, the approach engaged again");
      // (30 s on, the approach rejoined — its join planned anew: a climb, a turn, its autothrottle at idle while above its speed, as a
      // pilot's —: its autopilot and autothrottle flying it, the airspeed and the attitude; the thrust judged by the window above)
      const flownAfter = await flightState(app);
      out.flownAfter = flownAfter;
      console.log(`  30 s after the stick: ${JSON.stringify(flownAfter)}`);
      expectFlight(flownAfter, "30 s after the stick, the approach rejoined", {
        ap: true,
        athr: true,
        speedMin: 60,
        pitchMax: 25,
        bankMax: 35,
        aglMin: 150,
      });
      const stick = { pitch0: p0, during, apAfter: after.rows.at(-1)?.ils ?? null };
      out.stick = stick;
      console.log(
        `  the stick: ${JSON.stringify(stick)}; then 30 s: gap max ${after.gapMax} ms, GPU p50 ${p50(after.gpu)} ms — ${JSON.stringify(after.at)}`,
      );
      await app.shot(`${OUT}/3-approche-reprise.png`);
      out.gpu = { fair: p50(before.gpu), arrival: p50(arrival.gpu), rain: p50(after.gpu) };
      const gapMax = Math.max(before.gapMax, arrival.gapMax, after.gapMax);
      out.summary = { gapMax, same: arrival.same, report: arrival.real, wind1, extStep, windStep };
      expect(asked.some((u) => u.includes("LFTH"))).toBe(true);
      expect(arrival.real?.startsWith("LFTH")).toBe(true);
      expect(arrival.same).toBe(true);
      // (the METAR's 18 kt, 9.3 m/s, gusting 28 — the flight's wind near it)
      expect(wind1).toBeGreaterThan(3);
      expect(wind1).toBeLessThan(40);
      // (the source's arrival faded in — weather.ts weatherHere, WEATHER_FADE_S —: no image carries half the image's weather's change
      // — before the fade, all of it in one image)
      expect((out.arrival as { extShareInOneImage: number | null }).extShareInOneImage ?? 0).toBeLessThan(0.5);
      expect(Math.abs((during as { pitch: number } | null)?.pitch ?? p0) - Math.abs(p0)).not.toBe(0);
      expect(Math.abs(((during as { pitch: number } | null)?.pitch ?? p0) - p0)).toBeGreaterThan(1);
      // (the stick first: the approach's autopilot let go — its needles kept, camera.ilsRun.manual)
      expect((during as { ils: boolean } | null)?.ils).toBe(false);
      expect(gapMax).toBeLessThan(1000);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/parcours-meteo.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  900_000,
);
