import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { expectFlight, flightState, placeJetFrozen } from "./lib/flight-state";
import { J0_FIXED } from "./lib/j0-scene";
// PLAN-J7 J7-3 — the return by F1 after the free camera, mapped: cold (the mini's Metal cache emptied by the caller) it recompiled the
// main kernel (650 ms), warm an image of 250 ms (the J7-0 fiche §4). The F-35 over the Maures on its holds (placed frozen, rule 13), then
// F3 — the free camera 6 km north, 1 500 m up —, 15 s, then F1 — aboard again —, 10 s. At every image: the gap, the scene's kernel key
// (renderer.featureKey), the compiles started or ended (compileReport), the render's phase; at each step the bits of the key that changed.
// Not a pass/fail on the gaps: the map of what the return changes, written to j7-f1-return.json; asserted the flight as flown (rule 13).
// Duration: ~2 min on kerr-mini.
// Done when: the return mapped and j7-f1-return.json written.
afterAll(stopServer);
const OUT = process.env.F1_OUT ?? "remote-results/j7-f1-return";
const AT = [43.22, 6.33, 300, 90, 140] as const;
test.skipIf(!E2E)(
  "J7-3: the return by F1 — the kernel key, the compiles and the gaps across the free camera and back",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString() };
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, damage: false });
        return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.scenario("à bord, sur les Maures");
      const place = `(() => { __bh.game.setDate("2026-07-10T13:30:00Z"); __bh.game.flyAt(${AT.join(", ")}); __bh.settings.shipMount = "cockpit";
        __bh.refresh(); __bh.camera.viewReset(); return 1; })()`;
      const placed = await placeJetFrozen(app, place, { hdgDeg: AT[3], spd: AT[4] }, async () => {
        await app.dataSettled("the Maures", { maxMs: 90_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 160)})`));
        await app.settled(90_000);
      });
      expectFlight(placed, "placed", { ap: true, athr: true, speedMin: 90, pitchMax: 20, bankMax: 20 });
      // (the recorder: every image's gap, key, phase; the compiles' log length)
      await app.js(`(() => { const R = __bh.renderer; window.__f1 = []; let last = performance.now();
        const f = (now) => { window.__f1.push({ t: +(now / 1000).toFixed(3), gap: +(now - last).toFixed(1), key: R.featureKey,
          phase: R.lastPhase ?? null, compiles: R.compileReport().count, compiling: R.compilingNow.length, gpu: +(R.lastGpuMs ?? 0).toFixed(1),
          spectating: !!__bh.camera.spectating }); last = now; if (window.__f1On) requestAnimationFrame(f); };
        window.__f1On = true; requestAnimationFrame(f); return 1; })()`);
      const mark = (name: string) =>
        app.js(`(window.__f1.push({ mark: ${JSON.stringify(name)}, t: +(performance.now() / 1000).toFixed(3) }), 1)`);
      await app.js(`new Promise((q) => setTimeout(q, 5000))`);
      await app.scenario("F3 : la caméra libre");
      await mark("F3");
      await app.press("F3", "F3");
      await app.waitFor(`__bh.camera.spectating`, 10_000);
      const why = await app.js<string | null>(`(() => { const g = __bh.camera.geoNow();
        return __bh.viewAt(g.lat + 0.055, g.lon, { altM: 1500, heading: 180, pitch: -12, fov: 50 }) ?? null; })()`);
      if (why) throw new Error(`viewAt: ${why}`);
      await app.js(`new Promise((q) => setTimeout(q, 15000))`);
      await app.shot(`${OUT}/1-camera-libre.png`);
      await app.scenario("F1 : le retour à bord");
      await mark("F1");
      await app.press("F1", "F1");
      await app.waitFor(`!__bh.camera.spectating && __bh.mode.get() === "ship"`, 10_000);
      await app.js(`new Promise((q) => setTimeout(q, 10000))`);
      await app.shot(`${OUT}/2-retour-a-bord.png`);
      const rec = await app.js<Record<string, unknown>[]>(`(window.__f1On = false, window.__f1)`);
      const compiles = await app.js<unknown[]>(`__bh.renderer.compileReport().compiles.slice(-12)`);
      const flown = await flightState(app);
      // (the key's changes: when, its bits gained and lost)
      const changes: unknown[] = [];
      let prev: number | null = null;
      for (const r of rec) {
        if (r.mark) {
          changes.push(r);
          continue;
        }
        const k = r.key as number;
        if (prev !== null && k !== prev)
          changes.push({ t: r.t, from: prev, to: k, gained: (k & ~prev).toString(2), lost: (prev & ~k).toString(2) });
        prev = k;
      }
      const big = rec.filter((r) => !r.mark && (r.gap as number) > 100);
      Object.assign(out, { changes, big, compiles, flown });
      console.log(`  key changes: ${JSON.stringify(changes)}`);
      console.log(`  gaps > 100 ms: ${JSON.stringify(big)}`);
      console.log(`  last compiles: ${JSON.stringify(compiles)}`);
      expectFlight(flown, "back aboard", { ap: true, athr: true, speedMin: 90, pitchMax: 20, bankMax: 35 });
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/j7-f1-return.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  600_000,
);
