import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { type CdpProfile, longRuns } from "./lib/cpu-profile";
import { expectFlight, flightState, placeJetFrozen } from "./lib/flight-state";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";
// PLAN-J7 J7-2 — the real weather's arrival, its GPU passes read: J7-0 saw an image of 333–401 ms when the METAR's rain and low ceiling come
// (fiche §4), not the compile of its kernel. The F-35 off Hyères on its holds (J0's start, placed frozen — rule 13), the weather fair; then
// the real weather chosen, its METAR served by the page (rain, a ceiling at 600 ft, 2 500 m — parcours-meteo's). At every finished image,
// 5 s before and 10 s after: the gap, the GPU time, its six costliest passes (renderer.prof, every image), the heap, the compiles. The
// images over 150 ms: which pass. Not a pass/fail on the times: j7-weather-arrival.json; the flight asserted (rule 13).
// WA_PROFILE=1: the page's CPU profile over the arrival (native work counted): its long runs (≥ WA_MIN ms, 80) and the functions in them.
// Duration: ~3 min on kerr-mini.
// Done when: the arrival recorded and j7-weather-arrival.json written.
afterAll(stopServer);
const OUT = process.env.WA_OUT ?? "remote-results/j7-weather-arrival";
const REPORT = "LFTH 151700Z 25018G28KT 2500 RA BKN006 OVC012 13/12 Q1004";
test.skipIf(!E2E)(
  "J7-2: the real weather's arrival — the GPU passes of its heavy images",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({
      width: 1920,
      height: 1080,
      hash: "scene=game:artemis",
      tiles: true,
      initScript: `(() => { const original = globalThis.fetch;
        globalThis.fetch = function (input, options) { const url = String(input);
          if (url.startsWith("https://metar.vatsim.net/")) return Promise.resolve(new Response(${JSON.stringify(`${REPORT}\n`)}, { status: 200 }));
          return original.call(this, input, options); }; })()`,
    });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString() };
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, damage: false });
        return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.scenario("beau temps, au large d'Hyères");
      const [lat, lon, agl, hdg, spd] = J0_SCENE.start;
      const place = `(() => { __bh.game.setDate(new Date().toISOString()); __bh.game.set("weather", "fair"); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${spd});
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`;
      const placed = await placeJetFrozen(app, place, { hdgDeg: hdg, spd }, async () => {
        await app.dataSettled("off Hyères", { maxMs: 90_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 160)})`));
        await app.settled(90_000);
      });
      expectFlight(placed, "placed", { ap: true, athr: true, speedMin: 90, pitchMax: 20, bankMax: 20 });
      const record = (ms: number, before: string) =>
        app.js<Record<string, unknown>[]>(`(async () => { const R = __bh.renderer; R.prof.enabled = true; R.prof.every = 1;
          ${before}
          const rows = []; let last = performance.now(), done = R.completedFrames; const t0 = performance.now();
          while (performance.now() - t0 < ${ms}) {
            const now = await new Promise((q) => requestAnimationFrame(q));
            const gap = now - last; last = now;
            if (R.completedFrames === done && gap < 150) continue;
            done = R.completedFrames;
            const passes = R.prof.table().map((p) => [p.label, +(p.last ?? 0).toFixed(1)]).sort((a, b) => b[1] - a[1]).slice(0, 6);
            rows.push({ t: +((now - t0) / 1000).toFixed(2), gap: +gap.toFixed(1), gpu: +(R.lastGpuMs ?? 0).toFixed(1), passes,
              heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), compiles: R.compileReport().count,
              ext: +((R.weatherBlock?.[1] ?? 0) * 1000).toFixed(3) });
          }
          return rows; })()`);
      const fair = await record(5000, "");
      await app.scenario("arrivée de la pluie (METAR réel)");
      const profiling = process.env.WA_PROFILE === "1";
      if (profiling) {
        await app.cdp.send("Profiler.enable");
        await app.cdp.send("Profiler.setSamplingInterval", { interval: 200 });
        await app.cdp.send("Profiler.start");
      }
      const arrival = await record(10_000, `__bh.game.set("weather", "real");`);
      if (profiling) {
        const { profile } = await app.cdp.send<{ profile: CdpProfile }>("Profiler.stop");
        // (« (program) » — the browser's native work on the page's thread: the pipelines' creation, the GC's — counted as script here)
        for (const n of profile.nodes) if (n.callFrame.functionName === "(program)") n.callFrame.functionName = "(native)";
        const lr = longRuns(profile, Number(process.env.WA_MIN ?? 80), 30);
        out.cpuLongRuns = lr;
        console.log(`  the arrival's CPU — runs ≥ ${process.env.WA_MIN ?? 80} ms: ${lr.runs}, longest ${lr.longest.join(" ")} ms`);
        for (const x of lr.fns) console.log(`    ${String(x.inclMs).padStart(7)} incl ${String(x.selfMs).padStart(6)} self  ${x.f}`);
      }
      const heavy = arrival.filter((r) => (r.gap as number) > 150);
      const p50 = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? null;
      Object.assign(out, {
        fairGpuP50: p50(fair.map((r) => r.gpu as number)),
        arrivalGpuP50: p50(arrival.map((r) => r.gpu as number)),
        heavy,
        fairTypical: fair.at(-1),
        arrival,
      });
      console.log(`  fair: GPU p50 ${out.fairGpuP50} ms, a typical image ${JSON.stringify(fair.at(-1))}`);
      console.log(`  the arrival: GPU p50 ${out.arrivalGpuP50} ms; images over 150 ms: ${JSON.stringify(heavy)}`);
      const gaps = arrival.map((r) => r.gap as number).sort((x, y) => y - x);
      out.arrivalGapMax = gaps[0] ?? 0;
      console.log(`  the arrival's largest gaps: ${gaps.slice(0, 5).join(", ")} ms`);
      await app.shot(`${OUT}/arrivee-de-la-pluie.png`);
      expectFlight(await flightState(app), "after the arrival", { ap: true, athr: true, speedMin: 90, pitchMax: 20, bankMax: 35 });
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/j7-weather-arrival.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  600_000,
);
