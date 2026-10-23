import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-A320 A13: the A320's windshield from the captain's seat at Le Bourget, in the rain (src/a320/glass.ts,
// ship.wgsl a320Wet): the drops sitting and trickling down parked; at 140 kt the runners carried up and out; the
// wipers on (their knob LO — FlightGear's channel), the arms sweeping and the glass cleared behind them; the frost in
// icing, then the window heat clearing it (on the ground: aloft, the rain's clouds would hide it). Shots in E2E_SHOTS; the drops measured as the glass's cover (the deck's
// window pixels' spread) where they can be.

const shots = process.env.E2E_SHOTS;
const shot = (app: App, name: string) => (shots ? app.shot(`${shots}/${name}.png`) : Promise.resolve());

describe.skipIf(!E2E)("the A320's windshield in the rain", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(() => {
      // (by day: the scene's date at 11 h UTC — 13 h at Le Bourget)
      __bh.game.setDate(__bh.game.date().slice(0, 10) + "T11:00");
      __bh.settings.weather = "rain";
      __bh.settings.wind = 0;
      __bh.settings.vessel = "a320";
      __bh.settings.a320Start = "ready";
      __bh.refresh();
      __bh.game.lineUp("Paris – Le Bourget");
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      __bh.camera.a320Park = true;
      return true;
    })()`);
    await app.waitFor("!!__bh.renderer.ship.deckMats", 60_000);
    await app.waitFor(`!document.body.innerText.includes("Compiling the ray tracer")`, 240_000).catch(() => {});
    await app.waitFor("__bh.renderer.ship.a320Maps?.albedo?.depthOrArrayLayers === 7", 60_000);
    await app.waitFor("__bh.renderer.rain && __bh.renderer.rain.rain > 0", 60_000);
    await app.js(`(__bh.camera.setLook(0, 2), true)`);
    await Bun.sleep(4000);
  }, 400_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const glass = () =>
    app.js<{ rain: number; airspeed: number; frost: number; wipers: number[]; rates: number[] } | null>(`__bh.renderer.a320Glass`);

  test("parked in the rain: drops on the glass", async () => {
    const g = await glass();
    console.log(`  glass: ${JSON.stringify(g)}`);
    expect(g?.rain ?? 0).toBeGreaterThan(0);
    await shot(app, "a320-rain-parked");
  }, 60_000);

  test("the wipers on LO: the arms sweep, the glass cleared behind them; off: back to rest", async () => {
    await app.js(
      `(__bh.camera.a320Props["controls/switches/wiperLspd"] = 1, __bh.camera.a320Props["controls/switches/wiperRspd"] = 1, true)`,
    );
    await Bun.sleep(3000);
    const g = await glass();
    console.log(`  wipers: ${JSON.stringify(g?.wipers)} rates ${JSON.stringify(g?.rates)}`);
    expect(Math.abs(g!.rates[0]!)).toBeGreaterThan(1);
    // (the arms posed outside by them)
    // (the arms posed outside by them — read a frame apart)
    const arm = await app.js<number>(`__bh.renderer.a320Pose.props["fdm/jsbsim/fcs/left-wiper-pos-norm"]`);
    expect(arm).toBeGreaterThanOrEqual(0);
    expect(arm).toBeLessThanOrEqual(1);
    expect(Math.abs(arm - g!.wipers[0]!)).toBeLessThan(0.25);
    await shot(app, "a320-rain-wipers");
    // (a still image mid-sweep: the time held)
    await app.js(`(__bh.freeze(true), true)`);
    await Bun.sleep(800);
    await shot(app, "a320-rain-wipers-held");
    await app.js(`(__bh.freeze(false), true)`);
    await app.js(
      `(__bh.camera.a320Props["controls/switches/wiperLspd"] = 0, __bh.camera.a320Props["controls/switches/wiperRspd"] = 0, true)`,
    );
    await Bun.sleep(1500);
    const off = await glass();
    expect(off!.wipers[0]).toBe(0);
    expect(off!.rates[0]).toBeGreaterThan(100);
    await shot(app, "a320-rain-wiped-parked");
  }, 90_000);

  test("the frost, then the window heat clearing it", async () => {
    // (the frost laid — icing's, as a minute in a freezing cloud gives it —, the window heat off: no AC)
    await app.js(`(__bh.renderer.a320GlassSim.frost.ice = 1, true)`);
    await app.waitFor(`(__bh.renderer.a320Glass?.frost ?? 0) > 0.9`, 10_000);
    await Bun.sleep(1500);
    console.log(
      `  sim: ${await app.js<string>(`JSON.stringify({ ice: __bh.renderer.a320GlassSim?.frost?.ice, glass: __bh.renderer.a320Glass?.frost, deck: !!__bh.renderer.a320Deck })`)}`,
    );
    const before = await glass();
    console.log(`  frost: ${before?.frost?.toFixed(2)}`);
    await shot(app, "a320-frost");
    // (the heat on — AC: the window heat's AUTO, FlightGear's —: cleared in about a minute)
    // (half a minute: some 0.5 cleared — the frames' time, a loaded machine's slower than the wall's)
    const f0 = before!.frost;
    await Bun.sleep(15_000);
    const mid = (await glass())!.frost;
    console.log(`  15 s of heat: ${f0.toFixed(2)} → ${mid.toFixed(2)}`);
    expect(mid).toBeLessThan(f0 - 0.08);
    await shot(app, "a320-frost-clearing");
    await app.js(`(__bh.renderer.a320GlassSim.frost.ice = 0.08, true)`);
    await app.waitFor(`(__bh.renderer.a320Glass?.frost ?? 1) < 0.005`, 60_000);
    await Bun.sleep(1000);
    await shot(app, "a320-frost-cleared");
  }, 240_000);

  test("at 140 kt: the runners carried up and out", async () => {
    await app.js(`(() => {
      __bh.game.flyAt(48.95, 2.44, 400, 270, 72);
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      return true;
    })()`);
    await app.waitFor("!!__bh.renderer.ship.deckMats && !!__bh.renderer.a320Glass", 60_000);
    await app.js(`(__bh.camera.setLook(0, 2), true)`);
    await Bun.sleep(5000);
    const g = await glass();
    console.log(`  in flight: ${JSON.stringify(g)}`);
    expect(g!.airspeed).toBeGreaterThan(60);
    await shot(app, "a320-rain-140kt");
  }, 90_000);
});
