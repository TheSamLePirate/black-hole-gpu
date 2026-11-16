import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import type { CdpProfile } from "./lib/cpu-profile";
import { HITCH_PROBE } from "./lib/hitch-probe";
// PLAN-J7 J7-7, its first step — where the main thread's 433–784 ms at the game's start and the ~200 ms at a craft change go (the hitch
// fiche of J7-0). The page loaded again under Chrome's CPU profiler (sampling every 200 µs; E2E_NODE_ENV=development for the names) and the
// hitch probe, its timeline read (the splash gone, the first image, the hand-over, each compile's start): 12 s after the hand-over, then the
// craft changed (Ranger → F-35, as the journeys do) and 8 s more. Each run of script over 100 ms: when, against that timeline, and the
// functions it was spent in (self and inclusive). Not a pass/fail on the times: the run's map, written to j7-first-kernel.json.
// FK_PRE/FK_CHANGE/FK_CHANGED: another step measured (J7-8: the F-35's placement over Hyères — the flight's start).
// Duration: ~2 min on kerr-mini.
// Done when: the profile read and j7-first-kernel.json written.
afterAll(stopServer);
const OUT = process.env.FK_OUT ?? "remote-results/j7-first-kernel";
// (FK_CASE=flight-start — PLAN-J7 J7-8: the F-35 chosen first, then placed over Hyères — J0's start —, the flight's start measured)
if (process.env.FK_CASE === "flight-start") {
  process.env.FK_PRE ??= `Object.assign(__bh.settings, { vessel: "f35" })`;
  process.env.FK_PRE_DONE ??= `__bh.fleet.active === "f35"`;
  process.env.FK_CHANGE ??= `__bh.game.flyAt(43.06, 6.32, 500, 270, 140); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();
    const c = __bh.camera; for (let i = 0; i < 10; i++) __bh.step(1 / 30); c.apSet({ ap: true, athr: true, alt: 500, hdg: 270 * Math.PI / 180, spd: 140 })`;
  process.env.FK_CHANGED ??= "true";
}
// (FK_CASE=load — J7-9: the F-35 lined up at Edwards and saved, then placed in flight 30 km off on its holds; the save loaded back measured —
// parcours-reprise's 417 ms)
if (process.env.FK_CASE === "load") {
  process.env.FK_PRE ??= `Object.assign(__bh.settings, { vessel: "f35", wind: 0, damage: false }); setTimeout(() => { __bh.game.lineUp("Edwards");
    setTimeout(() => { window.__save = __bh.game.snapshot(); __bh.game.flyAt(35.2, -118.2, 3000, 90, 160); const c = __bh.camera;
      for (let i = 0; i < 10; i++) __bh.step(1 / 30); c.apSet({ ap: true, athr: true, alt: Math.round(c.geoNow().alt), hdg: Math.PI / 2, spd: 160 });
      window.__readyToLoad = true; }, 3000); }, 3000)`;
  process.env.FK_PRE_DONE ??= "!!window.__readyToLoad";
  process.env.FK_CHANGE ??= "__bh.game.load(window.__save)";
  process.env.FK_CHANGED ??= "!!__bh.camera.ourLanded || !!__bh.camera.rolling";
}
type Run = { atS: number; ms: number; self: { f: string; ms: number }[]; incl: { f: string; ms: number }[] };
function runsOver(pr: CdpProfile, minMs: number): Run[] {
  const name = new Map(
    pr.nodes.map((n) => [
      n.id,
      `${n.callFrame.functionName || "(anonymous)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`,
    ]),
  );
  const idle = new Set(
    pr.nodes
      .filter((n) => (process.env.FK_PROGRAM === "1" ? /^\(idle\)$/ : /^\((idle|program)\)$/).test(n.callFrame.functionName))
      .map((n) => n.id),
  );
  const parent = new Map<number, number>();
  for (const n of pr.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const dt = pr.samples.map((_, i) => (pr.timeDeltas[i + 1] ?? 0) / 1000);
  // (each sample's time since the profile's start [ms])
  const at: number[] = [];
  let t = 0;
  for (let i = 0; i < pr.samples.length; i++) {
    t += (pr.timeDeltas[i] ?? 0) / 1000;
    at.push(t);
  }
  const out: Run[] = [];
  let s = -1,
    acc = 0;
  for (let i = 0; i <= pr.samples.length; i++) {
    const busy = i < pr.samples.length && !idle.has(pr.samples[i]!);
    if (busy) {
      if (s < 0) (s = i), (acc = 0);
      acc += dt[i]!;
      continue;
    }
    if (s >= 0 && acc >= minMs) {
      const self = new Map<string, number>(),
        incl = new Map<string, number>();
      for (let k = s; k < i; k++) {
        self.set(name.get(pr.samples[k]!)!, (self.get(name.get(pr.samples[k]!)!) ?? 0) + dt[k]!);
        const seen = new Set<string>();
        for (let id: number | undefined = pr.samples[k]!; id !== undefined; id = parent.get(id)) {
          const g = name.get(id)!;
          if (seen.has(g)) continue;
          seen.add(g);
          incl.set(g, (incl.get(g) ?? 0) + dt[k]!);
        }
      }
      const top = (m: Map<string, number>) =>
        [...m]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([f, ms]) => ({ f, ms: +ms.toFixed(1) }));
      out.push({ atS: +((pr.startTime / 1000 + at[s]!) / 1000).toFixed(2), ms: +acc.toFixed(1), self: top(self), incl: top(incl) });
    }
    s = -1;
  }
  return out;
}
test.skipIf(!E2E)(
  "J7-7: the game's first kernel and a craft change — the main thread's long runs mapped",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    try {
      await app.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HITCH_PROBE });
      // (the page's timeline: the splash gone, the first image, the hand-over — performance.now() [ms] of each, polled every frame)
      await app.cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => { const T = (window.__fk = { navAt: performance.timeOrigin }); const f = () => { const b = window.__bh, L = document.getElementById("loading");
          if (T.splashGone === undefined && L && L.classList.contains("done")) T.splashGone = performance.now();
          if (T.firstImage === undefined && b && b.renderer && b.renderer.firstFrameDoneAt > 0) T.firstImage = b.renderer.firstFrameDoneAt;
          if (T.piloting === undefined && b && b.camera && b.camera.piloting) T.piloting = performance.now();
          requestAnimationFrame(f); }; requestAnimationFrame(f); })()`,
      });
      await app.cdp.send("Profiler.enable");
      await app.cdp.send("Profiler.setSamplingInterval", { interval: 200 });
      await app.cdp.send("Profiler.start");
      await app.load("scene=game:artemis");
      await app.waitFor("__bh.camera.piloting", 120_000);
      await app.js(`new Promise((q) => setTimeout(q, 12000))`);
      // (FK_PRE: a step before the measured one — e.g. the F-35 chosen, its placement waited for; FK_CHANGE: the measured step, by default the
      // craft change; FK_CHANGED: what it waits for — J7-8 measures a placement this way)
      if (process.env.FK_PRE) {
        await app.js(`(() => { ${process.env.FK_PRE}; return 1; })()`);
        await app.waitFor(process.env.FK_PRE_DONE ?? "true", 60_000);
        await app.js(`new Promise((q) => setTimeout(q, 8000))`);
      }
      const change = process.env.FK_CHANGE ?? `Object.assign(__bh.settings, { vessel: "f35" })`;
      const changeAt = await app.js<number>(`(() => { ${change}; return performance.now(); })()`);
      await app.waitFor(process.env.FK_CHANGED ?? `__bh.fleet.active === "f35"`, 60_000);
      await app.js(`new Promise((q) => setTimeout(q, 8000))`);
      const { profile } = await app.cdp.send<{ profile: CdpProfile }>("Profiler.stop");
      const page = await app.js<{
        timeOrigin: number;
        fk: Record<string, number>;
        gaps: { t: number; ms: number; causes: string[] }[];
        compiles: { pipeline: string; startedAt: number; seconds: number }[];
      }>(`({ timeOrigin: performance.timeOrigin, fk: window.__fk, gaps: window.__hitch.gaps.filter((g) => g.ms > 100),
        compiles: __bh.renderer.compileReport().compiles.map((c) => ({ pipeline: c.pipeline, startedAt: Math.round(c.startedAt), seconds: c.seconds })) })`);
      // (the profile's clock is monotonic µs; the page's performance.now from its timeOrigin: matched on the runs' times relative to the page)
      const runs = runsOver(profile, Number(process.env.FK_MIN ?? 100));
      const profStartS = profile.startTime / 1e6;
      // (the page's navigation in the profile's clock: its timeOrigin is wall time — the first sample's offset unknown; the runs are
      // placed against the page's timeline by their order and durations, and printed with both clocks)
      const out = { page: { ...page.fk, changeAt: Math.round(changeAt) }, gaps: page.gaps, compiles: page.compiles, runs, profStartS };
      await Bun.write(`${OUT}/j7-first-kernel.json`, JSON.stringify(out, null, 1));
      console.log(`  timeline [ms since navigation]: ${JSON.stringify(out.page)}`);
      console.log(`  gaps > 100 ms: ${JSON.stringify(page.gaps)}`);
      console.log(`  compiles: ${JSON.stringify(page.compiles.slice(0, 12))}`);
      for (const r of runs)
        console.log(
          `  run ${r.ms} ms at ${r.atS} s — self: ${r.self
            .slice(0, 6)
            .map((x) => `${x.f} ${x.ms}`)
            .join(" · ")} — incl: ${r.incl
            .slice(0, 10)
            .map((x) => `${x.f} ${x.ms}`)
            .join(" · ")}`,
        );
      expect(runs.length).toBeGreaterThan(0);
    } finally {
      app.close();
    }
  },
  600_000,
);
