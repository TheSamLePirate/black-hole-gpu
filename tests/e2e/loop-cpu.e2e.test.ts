import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The frame loop's own time on the main thread, by section (audit 2026-11-10, AR-05: synchronous work in the frame — layout
// reads, allocations, the trajectory's prediction, the probes; method rule 1 of 13 Nov 2026: read a cost's ceiling before
// opening a lot on it): the CPU profiler's (src/perf.ts, `__bh.game.perf()`) loop distribution over ~10 s and its sections, in an
// orbit (Artemis) and in an F-35's low flight over the Atlantic (tiles and IGN blocked). The probe checked first (rule 3): a
// positive witness (3 ms added to every flight step — `sim.step` — read back in its section; the loop's whole median read only
// +1.9 ms for it — the wait for the GPU absorbs part —, so the sections, not the loop's total, are the measure) and an A/A (two
// windows of the same scene, medians within 0.5 ms). No assertion on the costs themselves: a measure.
// Done when: the witness read, the A/A null, the loop's p50/p95/p99 and the sections over 0.05 ms written. Duration: ~1.5 min.

const OUT = "remote-results/loop-cpu";

interface Window {
  loop: { n: number; p50: number; p95: number; p99: number; max: number };
  cpu: { section: string; ms: number; worst: number }[];
  loopFps: number;
}

describe.skipIf(!E2E)("the frame loop's CPU time, by section", () => {
  let app: App;
  const rows: Record<string, Window> = {};
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.cdp.send("Network.setBlockedURLs", {
      urls: ["*celestrak.org*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*", "*geopf.fr*", "*ign.fr*"],
    });
    await app.waitFor("__bh.camera.piloting && __bh.gpu.frames().completedFrames > 30", 90_000);
  }, 300_000);
  afterAll(async () => {
    await Bun.write(`${OUT}/windows.json`, JSON.stringify(rows, null, 2));
    app?.close();
    stopServer();
  });

  // (a window: 12 s for the profiler's ~600 loops to be this scene's alone)
  const window = async (name: string): Promise<Window> => {
    await Bun.sleep(12_000);
    const w = await app.js<Window>(
      `(() => { const p = __bh.game.perf({ gpu: false }); return { loop: p.loopCpu, cpu: p.cpu, loopFps: p.loopFps }; })()`,
    );
    rows[name] = w;
    const top = w.cpu
      .filter((c) => c.ms >= 0.05)
      .map((c) => `${c.section} ${c.ms.toFixed(2)} (worst ${c.worst.toFixed(1)})`)
      .join(" · ");
    console.log(
      `  ${name}: loop p50 ${w.loop.p50.toFixed(2)} · p95 ${w.loop.p95.toFixed(2)} · p99 ${w.loop.p99.toFixed(2)} · worst ${w.loop.max.toFixed(1)} ms over ${w.loop.n} loops (${w.loopFps.toFixed(0)}/s) — ${top}`,
    );
    return w;
  };
  const flight = (w: Window) => w.cpu.find((c) => c.section === "flight (camera.update)")?.ms ?? 0;

  test("the probe: A/A null; 3 ms added to the flight's step read back", async () => {
    const a = await window("orbit A");
    const b = await window("orbit B");
    await app.js(`(() => { const s = __bh.sim, f = s.step.bind(s); window.__stepOrig = s.step;
      s.step = (dt) => { const t = performance.now(); while (performance.now() - t < 3); return f(dt); }; return 1; })()`);
    const w = await window("orbit + 3 ms witness");
    await app.js(`(__bh.sim.step = window.__stepOrig, 1)`);
    const da = Math.abs(a.loop.p50 - b.loop.p50);
    const dw = w.loop.p50 - a.loop.p50;
    const ds = flight(w) - flight(a);
    console.log(`  A/A Δ p50 ${da.toFixed(2)} ms; witness: loop p50 +${dw.toFixed(2)} ms, its section +${ds.toFixed(2)} ms`);
    // (the sections are the measure: 3 ms read in theirs; the loop's whole time is not additive — 13 Nov 2026: +1.9 ms for 3 —,
    // part of what is added overlapping the wait for the GPU: given as context only, never as a section's cost)
    expect(da).toBeLessThan(0.5);
    expect(ds).toBeGreaterThan(2.5);
    expect(ds).toBeLessThan(3.5);
  }, 120_000);

  test("an F-35 at 3 000 m over the Atlantic: the loop and its sections", async () => {
    const placed = await app.js<string>(`(() => {
      __bh.freeze(true); __bh.settings.animate = true; __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane";
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      if (__bh.fleet.active !== "f35") return "not switched: " + __bh.fleet.active;
      __bh.game.flyAt(38.5, -14, 3000, 90, 160);
      for (let i = 0; i < 30; i++) __bh.step(1 / 30);
      __bh.freeze(false);
      return "ok"; })()`);
    expect(placed).toBe("ok");
    await window("F-35 low flight");
    await app.snap(`${OUT}/f35.png`);
  }, 90_000);
});
