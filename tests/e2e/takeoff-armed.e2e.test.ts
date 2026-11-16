import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { expectFlightPhase } from "./lib/flight-state";
// PLAN-J6 J6-1 found the F-35, after its automatic take-off (U), holding ~100 m over the field at 210 m/s on the runway's heading, the
// autopilot set during its climb (apSet: 270°, 500 m, 150 m/s) ignored, until a hill: the holds, engaged during the run, took its stick
// for the pilot's hand (their control-wheel steering) and, let go at its end, held the height of the moment. Since (15 Nov 2026): the
// selections made during the run are armed and become its holds at its end. Here at Edwards (no tiles), the clock stepped: U, then
// either nothing or apSet at 16 s (2 500 m, 270°, 150 m/s); each second the height over the field, the climb, the pitch, the holds, the
// run's phase. Asserted: without, the run's holds (1 500 m over the field, the runway's heading, 210 m/s) and the climb; with, the armed
// ones held at its end, the jet climbing and turning to 270°.
// Duration: ~1 min on kerr-mini.
// Done when: both ways flown 70 s and judged.
afterAll(stopServer);
test.skipIf(!E2E)(
  "the automatic take-off: the run's holds at its end, or the selections armed during it",
  async () => {
    const app = await App.boot({ width: 1280, height: 720, hash: "scene=game:artemis" });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { vessel: "f35", damage: false, traffic: false }); return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      for (const way of ["none", "apSet16"]) {
        await app.js(`(() => { __bh.game.lineUp("Edwards"); for (let i = 0; i < 10; i++) __bh.step(1 / 30); return 1; })()`);
        await app.press("KeyU", "u");
        const r = await app.js<unknown[]>(`(() => {
          const c = __bh.camera, field = c.geoNow().alt, rows = [];
          for (let k = 0; k < 30 * 70; k++) {
            if (${way === "apSet16"} && k === 30 * 16) rows.push({ t: 16, said: c.apSet({ ap: true, athr: true, alt: 2500, hdg: 270 * Math.PI / 180, spd: 150 }) });
            __bh.step(1 / 30);
            if (k % 30 === 29) { const g = c.geoNow(), a = c.attitudeNow(), m = c.jetModes;
              rows.push([k / 30 + 1 | 0, Math.round(g.alt - field), +(g.vs ?? 0).toFixed(1), +((a.pitch ?? 0) * 57.3).toFixed(1),
                Math.round(((a.heading ?? 0) * 57.3 + 360) % 360), Math.round(g.gs ?? 0), m.alt && Math.round(m.alt), m.hdg && Math.round(m.hdg * 57.3), m.spd,
                c.pilot.auto, c.rwyRun?.phase ?? "-", c.gearDown]); }
          }
          return rows; })()`);
        // (rule 13 of E2E-VOLS: the take-off's end as a pilot leaves it — its holds, its thrust, its gear up)
        await expectFlightPhase(app, "cruise", {}, `take-off, ${way}`);
        console.log(`  way ${way} (t, h over field, vs, pitch, hdg, gs, hold alt, hold hdg, hold spd, auto, run, gear):`);
        for (const x of r) console.log(`    ${JSON.stringify(x)}`);
        // (the last second's row: [t, h, vs, pitch, hdg, gs, hold alt, hold hdg, hold spd, …]; the field ~700 m over the sea)
        const end = r[r.length - 1] as number[];
        const field = await app.js<number>(`Math.round(__bh.camera.geoNow().alt - ${end[1]})`);
        if (way === "none") {
          expect(Math.abs(end[6]! - (field + 1500))).toBeLessThan(15);
          expect(end[8]).toBe(210);
          expect(end[1]!).toBeGreaterThan(800);
        } else {
          expect(end[6]).toBe(2500);
          expect(end[7]).toBe(270);
          expect(end[8]).toBe(150);
          expect(end[1]!).toBeGreaterThan(800);
          expect(Math.abs(((end[4]! - 270 + 540) % 360) - 180)).toBeLessThan(10);
        }
      }
    } finally {
      app.close();
    }
  },
  300_000,
);
