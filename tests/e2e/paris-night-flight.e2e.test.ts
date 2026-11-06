import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// A night flight over Paris at 900 m (docs/PLAN-NUIT-URBAINE.md NU1–NU5; Sam, 6 Nov 2026: « lance le vol de nuit sur Paris
// 900 m […] virage et vues sur le côté »): the F-35 flown by its autopilot — heading, height and speed held —, 7 Nov 2026
// 19:30 UTC (20:30 in Paris), from the south-west towards the centre, then a turn of 120° to the left round it: shots from
// the cockpit ahead, to the inside of the turn (the head turned left and down), and from behind, at its start, in the turn
// and after it — the streets' lamps from afar (NU1), the windows (NU4), the eye adapted to the town (NU5).
// Output: remote-results/paris-night-flight/<step>.png (PNF_OUT), flight.json (each shot's place, height, bank, city light).
// Done when: every datum in before the flight (dataSettled), the flight held its ~935 m over the sea (900 over the ground, ±150 m) through the turn, every shot taken, no console error.
// Duration: ~4 min.
const OUT = process.env.PNF_OUT ?? "remote-results/paris-night-flight";
afterAll(stopServer);

test.skipIf(!E2E)(
  "a night flight over Paris at 900 m: ahead, to the side, in the turn",
  async () => {
    await Bun.$`mkdir -p ${OUT}`;
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    const log: Record<string, unknown>[] = [];
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, detailReach: "veryFar", earthScenery: "high", motionBlur: 0, dof: false }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
      await app.js(`(() => { __bh.game.setDate("2026-11-07T19:30:00Z"); return 1; })()`);
      // (south-west of the centre, heading for it at 140 m/s, 900 m over the ground; held still while the world comes in — a
      // first run flew on through a 60 s load at 8 frames a second and lost its height —, placed again, the autopilot on all three)
      // (the toggles first — each switches its mode: set before, the autopilot was switched off —, the modes' targets after)
      const start = `__bh.game.flyAt(48.815, 2.29, 900, 40, 140); const c = __bh.camera;
        if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        c.jetModes.alt = Math.round(c.geoNow().alt); c.jetModes.hdg = c.attitudeNow().heading; c.jetModes.spd = 140;
        c.jetModes.bankMax = 25 * Math.PI / 180; __bh.settings.shipMount = "cockpit";`;
      await app.js(`(() => { __bh.freeze(false); ${start} return 1; })()`);
      await Bun.sleep(1500);
      await app.js(`(__bh.freeze(true), 1)`);
      // (every datum in round the start before it flies — the relief, the photographs, the scenery, the kernels: Sam, 6 Nov 2026
      // « toutes les données doivent être chargées » —: waited while they keep coming, what stalls said — app.dataSettled)
      await app.dataSettled("Paris's data round the start");
      const world = "all in";
      await app.js(`(() => { ${start} __bh.freeze(false); return 1; })()`);
      await Bun.sleep(2000);
      console.log(`  world: ${world}`);
      const state = () =>
        app.js<Record<string, number>>(`(() => { const c = __bh.camera, g = c.geoNow(), a = c.attitudeNow();
          return { lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4), alt: Math.round(g.alt), hdg: Math.round(a.heading * 180 / Math.PI),
            bank: Math.round((a.bank ?? a.roll ?? 0) * 180 / Math.PI), city: +(__bh.renderer.cityLight * 1e5).toFixed(2), roads: __bh.renderer.earthTiles.roadsRefreshed }; })()`);
      const shoot = async (step: string) => {
        // (ahead from the cockpit, the inside of the turn — left and down —, from behind)
        for (const [name, set] of [
          ["ahead", `__bh.settings.shipMount = "cockpit"; __bh.camera.setLook(0, -8);`],
          ["side", `__bh.settings.shipMount = "cockpit"; __bh.camera.setLook(-75, -28);`],
          ["chase", `__bh.settings.shipMount = "chase";`],
        ] as const) {
          await app.js(`(() => { ${set} return 1; })()`);
          await app.js(`new Promise((q) => { let k = 0; const f = () => { if (++k < 45) requestAnimationFrame(f); else q(1); }; f(); })`);
          await app.shot(`${OUT}/${step}-${name}.png`);
        }
        await app.js(`(() => { __bh.settings.shipMount = "cockpit"; __bh.camera.setLook(0, 0); return 1; })()`);
        const s = await state();
        log.push({ step, ...s });
        console.log(`  ${step}: ${JSON.stringify(s)}`);
        return s;
      };
      const s0 = await shoot("1-approach");
      // (a turn of 120° to the left round the centre)
      await app.js(
        `(() => { const c = __bh.camera; c.jetModes.hdg = ((c.attitudeNow().heading * 180 / Math.PI - 120 + 360) % 360) * Math.PI / 180; return 1; })()`,
      );
      await Bun.sleep(9000);
      const s1 = await shoot("2-turn");
      await Bun.sleep(14000);
      const s2 = await shoot("3-after");
      await Bun.write(`${OUT}/flight.json`, JSON.stringify({ world, log }, null, 1));
      // (its height over the sea — Paris's ground ~35 m over it —: 900 m over the ground held through the turn)
      for (const s of [s0, s1, s2]) expect(Math.abs(s.alt! - 935)).toBeLessThan(150);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  6 * 60_000,
);
