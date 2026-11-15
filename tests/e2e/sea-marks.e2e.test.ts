import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";
// Probe — no assertion but no GPU error; not in `bun run e2e`: E2E_PROBE=1 — (PLAN-J5) how J0's sea is marked when the resolve reads it:
// renderer.traceColumn (the HORIZON-FLICKER diagnostic, copied right after the resolve) down a column from the horizon to the cockpit,
// J0's start in flight, the HUD off; per row the first pixel's moments.x — 4e30 the water finished as water (rasterMark), 1e30 as a
// ground, −1 the cockpit's mask (the probe's own control: those rows must read −1) — and its stamp against the frame's.
// Duration: ~3 min on kerr-mini.
// Done when: three frames traced.
afterAll(stopServer);
test.skipIf(!E2E || process.env.E2E_PROBE !== "1")(
  "J0's sea as the resolve reads it: its marks down a column",
  async () => {
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, dynamicResolution: false,
          hudJet: "off", hudHorizon: false, hudHeading: false, hudBank: false, hudMarkers: false });
        __bh.game.setDate("${J0_SCENE.date}"); __bh.game.flyAt(${J0_SCENE.start.join(", ")}); __bh.settings.shipMount = "cockpit";
        __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
      await app.dataSettled("sea marks", { maxMs: 90_000 }).catch((e) => console.log(`(not settled: ${String(e).slice(0, 160)})`));
      await app.settled();
      const r = await app.js<unknown>(`(async () => {
        const R = __bh.renderer; const t = R.live; const h = t ? t.height : 810;
        const fs = await R.traceColumn(0.36, 0, Math.min(h, 800), 3);
        if (!fs) return null;
        return fs.map((f) => ({ stamp: f.stamp, validFrom: f.validFrom,
          rows: f.m.map((v, y) => [y, v]).filter((_, y) => y % 40 === 0) }));
      })()`);
      console.log(JSON.stringify(r));
      await app.shot("remote-results/sea-marks/view.png");
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  600_000,
);
