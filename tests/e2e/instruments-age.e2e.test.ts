import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The craft's instruments and poses ready before the image is encoded (audit 2026-11-10, AR-04; strategy §19.5 — simulation, the
// flight's data frozen, critical instruments, final view, encoding; wave 4.8): the cockpit's dashboard, the screens, the gear, the
// F-35's and the A320's surfaces, the A320's displays and the cockpit's controls were computed after renderer.frame — each image
// drew the previous loop's. Measured: renderer.frame wrapped in the page, the age of the dashboard's stamp (renderer.cockpitDash.time,
// set with the others) at each encoding, in orbit (Artemis, the Ranger flown), 3 s.
// Done when: the median age at encoding under 2 ms (the same loop), where it was a loop's interval. Duration: ~40 s.

describe.skipIf(!E2E)("the instruments' age at the image's encoding", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting && __bh.gpu.frames().completedFrames > 30 && !!__bh.renderer.cockpitDash", 120_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the dashboard's stamp at each encoding: this loop's, not the last one's", async () => {
    const r = await app.js<{ n: number; med: number; p90: number; loop: number }>(`new Promise((done) => {
      const R = __bh.renderer, f = R.frame.bind(R), ages = [];
      R.frame = (...a) => { const d = R.cockpitDash; if (d) ages.push(performance.now() - d.time * 1000); return f(...a); };
      setTimeout(() => {
        R.frame = f;
        const s = ages.slice().sort((x, y) => x - y);
        done({ n: s.length, med: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], loop: R.refreshMs });
      }, 3000);
    })`);
    console.log(
      `  ${r.n} encodings: the dashboard's age median ${r.med.toFixed(2)} ms, 90th ${r.p90.toFixed(2)} ms (the display's interval ${r.loop.toFixed(1)} ms)`,
    );
    expect(r.n).toBeGreaterThan(30);
    expect(r.med).toBeLessThan(2);
  }, 60_000);
});
