import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-A320 A13 (part B): the A320 lined up at Le Bourget seen from its own cameras — along the left wing, the passenger
// at his window, the main gear from under the belly, the fin's top —; its wings bent by their load (src/a320/flex.ts —
// the tip's rise forced: on the ground's droop, level flight's shape, a 2.5 g pull's), from the wing and from the nose.

const shots = process.env.E2E_SHOTS;
const shot = (app: App, name: string) => (shots ? app.shot(`${shots}/${name}.png`) : Promise.resolve());

describe.skipIf(!E2E)("the A320's cameras and its wings' flex", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(() => {
      __bh.settings.vessel = "a320";
      __bh.refresh();
      __bh.game.lineUp("Paris – Le Bourget");
      __bh.settings.shipMount = "wing";
      __bh.refresh();
      return true;
    })()`);
    await app.waitFor("!!__bh.camera.a320", 60_000);
    await app.waitFor(`!document.body.innerText.includes("Compiling the ray tracer")`, 240_000).catch(() => {});
    await Bun.sleep(4000);
  }, 400_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const view = async (mount: string, wait = 2500) => {
    await app.js(`(__bh.settings.shipMount = ${JSON.stringify(mount)}, __bh.refresh(), __bh.camera.setLook(0, 0), true)`);
    await Bun.sleep(wait);
  };

  test("its own views: the wing, the window, the gear, the fin", async () => {
    for (const m of ["wing", "passenger", "gear", "tail"]) {
      await view(m);
      expect(await app.js<string>(`__bh.settings.shipMount`)).toBe(m);
      await shot(app, `a320-cam-${m}`);
    }
    // (the window's frame shown at the window only)
    await view("passenger", 500);
    expect(await app.js<boolean>(`!document.querySelector("[data-testid=a320-window]").hidden`)).toBeTrue();
    await view("wing", 500);
    expect(await app.js<boolean>(`document.querySelector("[data-testid=a320-window]").hidden`)).toBeTrue();
  }, 120_000);

  test("the wings bent: on the ground, in level flight, at 2.5 g", async () => {
    // (at rest on the ground: its own droop, from the spring settled)
    const tip = await app.js<number>(`__bh.camera.a320WingTip`);
    console.log(`  on the ground: the tip ${tip.toFixed(3)} m`);
    expect(tip).toBeLessThan(-0.1);
    for (const [name, rise] of [
      ["ground", null],
      ["1g", 0],
      ["2g5", 0.9],
    ] as const) {
      await app.js(`(__bh.camera.a320WingTipForce = ${rise === null ? "null" : rise}, true)`);
      await view("rear", 2000);
      await shot(app, `a320-flex-${name}-front`);
      await view("wing", 2000);
      await shot(app, `a320-flex-${name}-wing`);
    }
    await app.js(`(__bh.camera.a320WingTipForce = null, true)`);
  }, 120_000);
});
