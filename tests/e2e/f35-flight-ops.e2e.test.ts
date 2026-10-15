import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The flight's manoeuvres in the game (docs/PLAN-AVIATION-AAA.md, F4): lined up at Edwards with three AI wingmen —
// on the runway beside and behind —; the formation take-off: rolled together, airborne, the diamond formed in the
// climb; the diamond pass for the spectators: tight, the fly-by camera. (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the flight's manoeuvres", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  /** the outside view, turned and backed off (after the view's own reset) */
  const around = async (yaw: number, pitch: number, dist: number) => {
    await app.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(800);
    await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: ${yaw}, pitch: ${pitch}, dist: ${dist} }); return 1; })()`);
    await Bun.sleep(1500);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; __bh.settings.wind = 0; __bh.settings.formShape = "diamond"; __bh.settings.formSpacing = "normal"; return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.setDate("2067-06-21T17:30"); __bh.game.lineUp("Edwards"); return 1; })()`);
    await app.waitFor(`!!__bh.camera.ourLanded`, 30_000);
    await Bun.sleep(2000);
  }, 200_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("lined up: three wingmen on the runway beside and behind", async () => {
    await app.js(`(() => { __bh.settings.wingmen = 3; return 1; })()`);
    await app.waitFor(`__bh.camera.wing?.list.length === 3`, 10_000);
    const modes = await app.js<string[]>(`__bh.camera.wing.list.map((w) => w.k + ":" + w.mode)`);
    console.log(`  ${modes.join(", ")}`);
    expect(modes).toEqual(["2:ground", "3:ground", "4:ground"]);
    await around(150, 15, 140);
    await Bun.sleep(3000);
    await shot("ops-lineup");
  }, 60_000);

  test("the formation take-off: rolled together, airborne, the diamond in the climb", async () => {
    await app.js(`(() => { __bh.settings.shipMount = "chase"; const c = __bh.camera; c.__input ??= c.pilotInput.bind(c);
      c.pilotInput = (pad) => ({ ...c.__input(pad), pitch: (c.airFlight.last?.speed ?? 0) > 67 && (c.rolling || c.ourLanded) ? 0.8 : 0 });
      c.pilot.throttle = 1; c.jetToggle("ab"); return 1; })()`);
    await app.waitFor(`!__bh.camera.rolling && !__bh.camera.ourLanded && (__bh.camera.airFlight.last?.speed ?? 0) > 50`, 60_000);
    await Bun.sleep(4000);
    await app.js(`(() => { const c = __bh.camera; c.pilotInput = c.__input; c.jetToggle("ab"); c.jetToggle("ap"); c.jetToggle("athr");
      c.jetModes.alt = 1500; c.jetModes.spd = 200; return 1; })()`);
    await app.waitFor(`__bh.camera.wing.list.every((w) => !w.jet.gnd)`, 60_000);
    const up = await app.js<string>(`__bh.game.log.events.filter((e) => e.kind === "pilot").slice(-4).map((e) => e.text).join(" · ")`);
    console.log(`  all three off the runway — ${up}`);
    await app.waitFor(`Math.max(...__bh.camera.wing.list.map((w) => w.dist)) < 10`, 180_000);
    const w = await app.js<number>(`Math.max(...__bh.camera.wing.list.map((w) => w.dist))`);
    console.log(`  the diamond: ${w.toFixed(1)} m`);
    expect(await app.js<boolean>(`__bh.camera.wing.list.every((w) => w.alive)`)).toBe(true);
    await around(20, 18, 130);
    await shot("ops-climb");
  }, 300_000);

  test("the diamond pass: tight, the fly-by camera", async () => {
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    console.log(`  ${await app.js<string>(`__bh.camera.flightOrder("show")`)}`);
    expect(await app.js<string>(`__bh.settings.formSpacing`)).toBe("tight");
    await app.waitFor(`Math.max(...__bh.camera.wing.list.map((w) => w.dist)) < 6`, 120_000);
    await app.js(`(() => { __bh.settings.shipMount = "flyby"; return 1; })()`);
    // (the camera stands ahead on the way, the flight coming at it: taken as it passes, within 160 m)
    await app.waitFor(`(() => { const e = __bh.camera.flyby.eye; return Math.hypot(...e) < 160 && e[2] > 0; })()`, 30_000);
    await shot("ops-pass");
  }, 180_000);
});
