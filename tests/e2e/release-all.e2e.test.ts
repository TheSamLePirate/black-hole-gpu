import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// « Release the controls » (Backspace, the pause's, TARS's) on an aircraft (audit 2026-11-10, FX-06): the same promise on every
// craft — you have the controls. An F-35 flying over the Atlantic (tiles off), its autopilot holds, autothrottle and flight plan's
// NAV engaged, then the key — a real one. Before 13 Nov 2026 the key stopped the mission, the hold and the spacecraft's autopilot
// but on an aircraft its AP, A/THR and NAV flew on.
// Done when: after Backspace no hold, no autothrottle, no NAV, no approach, no formation left; said. Duration: ~40 s.

describe.skipIf(!E2E)("release the controls on an aircraft", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the F-35's AP, A/THR and NAV engaged: Backspace lets them all go", async () => {
    const before = await app.js<Record<string, unknown>>(`(() => {
      __bh.freeze(true); __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane";
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.game.flyAt(38.5, -14, 3000, 90, 200);
      for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      const c = __bh.camera;
      c.apSet({ alt: 3000, hdg: 90, spd: 200, ap: true, athr: true });
      c.rtbStart();
      __bh.freeze(false);
      const m = c.jetModes;
      return { alt: m.alt, hdg: m.hdg, spd: m.spd, nav: c.nav.on };
    })()`);
    await Bun.sleep(500);
    const log0 = await app.js<number>(`__bh.game.log.events.length`);
    await app.press("Backspace");
    await Bun.sleep(500);
    const after = await app.js<Record<string, unknown>>(`(() => { const c = __bh.camera, m = c.jetModes;
      return { alt: m.alt, hdg: m.hdg, spd: m.spd, nav: c.nav.on, ils: !!c.ilsRun, form: !!c.form, auto: c.pilot.auto, hold: c.pilot.hold }; })()`);
    const said = await app.js<string[]>(`__bh.game.log.events.slice(${log0}).map((e) => e.text)`);
    console.log(`  before: ${JSON.stringify(before)}\n  after Backspace: ${JSON.stringify(after)}; said ${JSON.stringify(said)}`);
    expect(before.alt).not.toBeNull();
    expect(after.alt).toBeNull();
    expect(after.hdg).toBeNull();
    expect(after.spd).toBeNull();
    expect(after.nav).toEqual({ l: false, v: false });
    expect(after.ils || after.form).toBe(false);
  }, 60_000);
});
