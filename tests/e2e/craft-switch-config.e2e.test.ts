import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A craft's own configuration when the craft flown changes (audit 2026-11-10, FX-14): one set of gear, flaps, brakes, air brake
// and jet holds served every craft — before 13 Nov 2026 the F-35 left on its runway, its flaps out, then the Ranger in orbit had
// its gear down and its flaps out; its gear raised, back in the F-35 on the runway: the gear up, the jet on its belly. The game's
// own switch (settings.vessel), the sim stepped.
// Done when: the Ranger comes in orbit gear up and flaps in; back in the F-35 its gear down and its flaps as it left them.
// Duration: ~1 min.

describe.skipIf(!E2E)("each craft its own gear and flaps", () => {
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

  type Cfg = { active: string; gear: boolean; flaps: number; airBrake: number; alt: number | null; landed: boolean; belly: boolean };
  const cfg = () =>
    app.js<Cfg>(`(() => { const c = __bh.camera; return { active: __bh.fleet.active, gear: c.gearDown, flaps: c.airFlight.cfg.flaps ?? 0,
      airBrake: c.airBrake, alt: c.jetModes.alt, landed: !!(c.ourLanded || c.rolling), belly: !!c.onBelly }; })()`);
  const fly = (vessel: string) =>
    app.js(
      `(() => { __bh.freeze(true); __bh.settings.vessel = "${vessel}"; for (let i = 0; i < 30; i++) __bh.step(1 / 30); return 1; })()`,
    );

  test("the F-35 on its runway, the Ranger in orbit, the F-35 again", async () => {
    await fly("f35");
    await app.waitFor(`__bh.fleet.active === "f35"`, 20_000);
    await app.js(
      `(() => { const c = __bh.camera; c.airFlight.cfg.flaps = 1; c.airBrake = 1; for (let i = 0; i < 30; i++) __bh.step(1 / 30); return 1; })()`,
    );
    const f35 = await cfg();
    await fly("ranger");
    const ranger = await cfg();
    // (the Ranger's gear raised in orbit — as G does)
    await app.js(
      `(() => { const c = __bh.camera; c.gearDown = false; c.gearExt = 0; for (let i = 0; i < 30; i++) __bh.step(1 / 30); return 1; })()`,
    );
    await fly("f35");
    const back = await cfg();
    await app.js(`(__bh.freeze(false), 1)`);
    console.log(`  the F-35 left: ${JSON.stringify(f35)}`);
    console.log(`  the Ranger in orbit: ${JSON.stringify(ranger)}`);
    console.log(`  the F-35 again: ${JSON.stringify(back)}`);
    await app.snap("remote-results/craft-switch/f35-back.png");
    expect(f35).toMatchObject({ active: "f35", gear: true, landed: true });
    expect(ranger).toMatchObject({ active: "ranger", gear: false, flaps: 0, airBrake: 0 });
    expect(back).toMatchObject({ active: "f35", gear: true, flaps: 1, belly: false });
  }, 120_000);
});
