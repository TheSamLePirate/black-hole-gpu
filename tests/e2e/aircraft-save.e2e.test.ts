import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// An aircraft's state travels with a save (audit 2026-11-10, FX-09/AR-09; wave 3.3): an F-35 saved by F5 in flight —
// its fuel low, gear down, half flaps, the air brake out, the autopilot holding its altitude and speed — then flown
// elsewhere (a new placement: tanks full, gear up, holds off), then F9: before, the load gave back the place and the
// throttle only (tanks full, gear by the height, flaps up, holds off) — shown here by the same save without its block.
// Over the Atlantic, tiles and IGN blocked.
// Done when: after F9 the fuel, gear, flaps, air brake and holds are the saved ones. Duration: ~1 min.

const OUT = "remote-results/aircraft-save";

interface Craft {
  vessel: string;
  fuel: number;
  gear: boolean;
  flaps: number;
  airBrake: number;
  alt: number | null;
  spd: number | null;
  thr: number;
  h: number;
}
const READ = `(() => { const c = __bh.camera, j = c.jetModes;
  return { vessel: __bh.fleet.active, fuel: Math.round(__bh.fleet.fuel.f35 ?? -1), gear: c.gearDown, flaps: c.airFlight.cfg.flaps ?? 0,
    airBrake: c.airBrake, alt: j.alt, spd: j.spd, thr: Math.round(c.pilot.throttle * 100) / 100, h: Math.round(c.geoNow().alt) }; })()`;

describe.skipIf(!E2E)("an aircraft saved: its fuel, gear, flaps and holds come back", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.cdp.send("Network.setBlockedURLs", {
      urls: ["*celestrak.org*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*", "*geopf.fr*", "*ign.fr*"],
    });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("F5 in flight, flown elsewhere, F9: the F-35 as it was saved", async () => {
    const placed = await app.js<string>(`(() => {
      __bh.freeze(true); __bh.settings.animate = true; __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane";
      __bh.settings.wind = 0; __bh.settings.damage = false;
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      if (__bh.fleet.active !== "f35") return "not switched: " + __bh.fleet.active;
      __bh.game.flyAt(38.5, -14, 3000, 90, 160);
      for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      const c = __bh.camera;
      c.apSet({ ap: true, athr: true, alt: 3000, spd: 160 });
      // (the state to keep: fuel low, gear down, half flaps, the air brake out)
      __bh.fleet.fuel.f35 = 2500; c.gearDown = true; c.gearExt = 1; c.airFlight.cfg.flaps = 0.5; c.airBrake = 0.6;
      for (let i = 0; i < 60; i++) __bh.step(1 / 30);
      return __bh.fleet.active; })()`);
    expect(placed).toBe("f35");
    const saved = await app.js<Craft>(READ);
    console.log(`  saved:  ${JSON.stringify(saved)}`);
    await app.press("F5");
    await app.waitFor(`!!localStorage.getItem("kerr.save:Quick save")`, 5000);
    // (flown elsewhere: a new placement — tanks full, gear up, holds off)
    const elsewhere = await app.js<Craft>(`(() => {
      __bh.game.flyAt(38.0, -15, 5000, 270, 220);
      for (let i = 0; i < 30; i++) __bh.step(1 / 30);
      return ${READ}; })()`);
    console.log(`  elsewhere: ${JSON.stringify(elsewhere)}`);
    // (what a save gave back before 13 Nov 2026: the same quick save without its craft block — the old code wrote none)
    const old = await app.js<Craft>(`(() => {
      const g = JSON.parse(localStorage.getItem("kerr.save:Quick save")); delete g.craft;
      __bh.game.load(g, { quiet: true });
      for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      return ${READ}; })()`);
    console.log(`  the save without its block (as before): ${JSON.stringify(old)}`);
    expect(old.fuel === -1 || old.fuel > 6000).toBe(true);
    expect(old.flaps).toBe(0);
    expect(old.airBrake).toBe(0);
    await app.js(`(() => { __bh.game.flyAt(38.0, -15, 5000, 270, 220); for (let i = 0; i < 30; i++) __bh.step(1 / 30); return 1; })()`);
    await app.press("F9");
    const back = await app.js<Craft>(`(() => { for (let i = 0; i < 10; i++) __bh.step(1 / 30); return ${READ}; })()`);
    console.log(`  after F9: ${JSON.stringify(back)}`);
    await app.js(`(__bh.refresh(), __bh.camera.viewReset?.(), true)`);
    await Bun.sleep(400);
    await app.shot(`${OUT}/after-f9.png`);
    expect(back.vessel).toBe("f35");
    expect(Math.abs(back.h - saved.h)).toBeLessThan(50);
    expect(Math.abs(back.fuel - saved.fuel)).toBeLessThan(30);
    expect(back.gear).toBe(true);
    expect(back.flaps).toBe(0.5);
    expect(back.airBrake).toBeCloseTo(0.6, 2);
    expect(back.alt).toBe(3000);
    expect(back.spd).toBe(160);
    expect(app.cdp.errors).toEqual([]);
  });
});
