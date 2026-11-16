import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { expectFlight, flightState } from "./lib/flight-state";
import { J0_FIXED } from "./lib/j0-scene";
// PLAN-J7 J7-9 — the data's arrival after a placement, its GPU read: J7-0 saw images of 150–290 ms for seconds after the F-35 was put
// over the Maures (fiche §2 point 2). The F-35 placed there on its holds at once (rule 13: never a glide at idle) — first over the
// sea off Hyères, its data in, then moved 15 km to the hills (the placement measured) —; for 25 s, every finished image: the gap, the GPU
// time, the compute passes — on Apple only these are attributable by their timestamps (GRAPHICS-PIPELINE §8.3) — most expensive first,
// the render passes apart, the tiles pending. The images over 120 ms: which compute pass. Not a pass/fail on the times:
// j7-placement-arrival.json; the flight asserted (rule 13).
// PA_FIRST=1: the placement the first since the start (nothing of the place in).
// Duration: ~3 min on kerr-mini.
// Done when: the 25 s recorded and j7-placement-arrival.json written.
afterAll(stopServer);
const OUT = process.env.PA_OUT ?? "remote-results/j7-placement-arrival";
const FROM = [43.06, 6.32, 500, 90, 140] as const;
const TO = [43.22, 6.33, 300, 90, 140] as const;
const RENDER = /^(display|ship: |sea surface|scenery|trees' shadow|cockpit|post|hud|sky \(waiting\))/;
test.skipIf(!E2E)(
  "J7-9: the data's arrival after a placement — the compute passes of its heavy images",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString() };
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, damage: false });
        return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const place = (at: readonly number[]) =>
        `(() => { __bh.game.setDate("2026-07-10T13:30:00Z"); __bh.game.flyAt(${at.join(", ")}); __bh.settings.shipMount = "cockpit";
          __bh.refresh(); __bh.camera.viewReset(); for (let i = 0; i < 10; i++) __bh.step(1 / 30);
          const c = __bh.camera; c.apSet({ ap: true, athr: true, alt: Math.round(c.geoNow().alt), hdg: ${at[3]} * Math.PI / 180, spd: ${at[4]} });
          return 1; })()`;
      // (PA_FIRST=1: the first placement since the start — nothing of the place in, as the journeys' first; else from off Hyères, its data in)
      if (process.env.PA_FIRST !== "1") {
        await app.js(`(() => { __bh.freeze(true); return 1; })()`);
        await app.js(place(FROM));
        await app.dataSettled("off Hyères", { maxMs: 90_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 160)})`));
        await app.js(place(FROM));
        await app.settled(90_000);
        await app.js(`(() => { __bh.freeze(false); return 1; })()`);
        expectFlight(await flightState(app), "off Hyères", { ap: true, athr: true, speedMin: 90, pitchMax: 20, bankMax: 20 });
      }
      const rows = await app.js<Record<string, unknown>[]>(`(async () => { const R = __bh.renderer; R.prof.enabled = true; R.prof.every = 1;
        ${place(TO)};
        const rows = []; let last = performance.now(), done = R.completedFrames; const t0 = performance.now();
        while (performance.now() - t0 < 25000) {
          const now = await new Promise((q) => requestAnimationFrame(q));
          const gap = now - last; last = now;
          if (R.completedFrames === done && gap < 120) continue;
          done = R.completedFrames;
          const all = R.prof.table(2).map((p) => [p.label, +(p.last ?? 0).toFixed(2)]);
          const compute = all.filter((p) => !${RENDER}.test(p[0])).sort((a, b) => b[1] - a[1]).slice(0, 6);
          const render = all.filter((p) => ${RENDER}.test(p[0])).sort((a, b) => b[1] - a[1]).slice(0, 3);
          rows.push({ t: +((now - t0) / 1000).toFixed(2), gap: +gap.toFixed(1), gpu: +(R.lastGpuMs ?? 0).toFixed(1), compute, render,
            tiles: (R.earthTiles?.pending ?? 0) + (R.earthTiles?.orthoPending ?? 0), compiles: R.compileReport().count });
        }
        return rows; })()`);
      const heavy = rows.filter((r) => (r.gap as number) > 120);
      const p50 = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? null;
      const late = rows.filter((r) => (r.t as number) > 20);
      Object.assign(out, {
        heavy,
        gpuP50First5s: p50(rows.filter((r) => (r.t as number) < 5).map((r) => r.gpu as number)),
        gpuP50Last5s: p50(late.map((r) => r.gpu as number)),
        rows,
      });
      console.log(`  GPU p50: first 5 s ${out.gpuP50First5s} ms, last 5 s ${out.gpuP50Last5s} ms; images over 120 ms: ${heavy.length}`);
      for (const h of heavy.slice(0, 14)) console.log(`    ${JSON.stringify(h)}`);
      await app.shot(`${OUT}/maures.png`);
      expectFlight(await flightState(app), "over the Maures", { ap: true, athr: true, speedMin: 90, pitchMax: 20, bankMax: 35 });
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/j7-placement-arrival.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  600_000,
);
