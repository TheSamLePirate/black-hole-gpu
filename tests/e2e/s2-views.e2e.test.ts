import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The views of exception (docs/PLAN-AVIATION-AAA.md, S2): first the Alps as ever; the views' page; the auroras over
// the Lofoten (their kernel compiled in, their curtains in the night sky to the south); the eclipse of 12 August 2026
// chased at Mach 1.6 over Iceland — totality reached and its seconds counted —; the full Moon rising before the
// formation; the Grand Canyon in the evening light; the storm at sea and the Ford pitching. (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the views of exception", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  /** a view flown, its tracer's kernel compiled (the first image after its features changed), a few seconds settled */
  const fly = async (id: string, settle = 6000) => {
    console.log(`  ${await app.js<string>(`__bh.flight.views.fly(${JSON.stringify(id)})`)}`);
    await app.waitFor(`__bh.camera.mission?.run.spec.id === ${JSON.stringify(id)}`, 30_000);
    await Bun.sleep(1500);
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await Bun.sleep(settle);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, f35Invulnerable: true, subtitles: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("the views' page: its thirteen cards", async () => {
    await app.js(`(() => { __bh.flight.views.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector('[data-testid="views"]')`, 5000);
    await Bun.sleep(500);
    expect(await app.js<number>(`document.querySelectorAll(".vw-card").length`)).toBe(13);
    await shot("views");
    await app.press("Escape");
  }, 60_000);

  test("the auroras over the Lofoten: their kernel in, their curtains to the south", async () => {
    await fly("view-aurora", 8000);
    expect(await app.js<number>(`__bh.settings.aurora`)).toBe(4);
    expect(await app.js<number>(`__bh.renderer.featureKey & 16384`)).toBe(16384);
    await app.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 1300; c.jetModes.hdg = Math.PI; c.jetModes.spd = 170; return 1; })()`,
    );
    await Bun.sleep(9000);
    await shot("aurora");
    await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(2500);
    await shot("aurora-cockpit");
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
  }, 240_000);

  test("the eclipse of 12 August 2026 chased over Iceland: totality reached, its seconds counted", async () => {
    await fly("view-eclipse", 2000);
    expect(await app.js<string>(`__bh.game.date()`)).toContain("2026-08-12");
    await app.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 15000; c.jetModes.spd = 470; return 1; })()`,
    );
    await app.waitFor(`(__bh.camera.mission?.run.apart.totality ?? 0) > 15`, 240_000);
    await shot("totality");
    // (the Sun eclipsed: some 80° to the right and 24° up — the outside camera turned to it, below the jet)
    for (const [k, yaw] of [
      ["a", 78],
      ["b", -78],
    ] as const) {
      await app.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
      await Bun.sleep(800);
      await app.js(`(() => { __bh.camera.outside = { ...__bh.camera.outside, yaw: ${yaw}, pitch: -18, dist: 40 }; return 1; })()`);
      await Bun.sleep(1500);
      await shot(`corona-${k}`);
    }
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    console.log(`  in totality: ${(await app.js<number>(`__bh.camera.mission.run.apart.totality`)).toFixed(0)} s`);
  }, 360_000);

  test("the full Moon rising before the formation", async () => {
    await fly("view-moonrise", 8000);
    await app.waitFor(`(__bh.camera.wing?.list ?? []).filter((w) => w.alive && w.dist < 40).length === 2`, 60_000);
    await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(2500);
    await shot("moonrise");
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
  }, 180_000);

  test("the Grand Canyon; the storm at sea and the Ford", async () => {
    await fly("view-grand-canyon", 8000);
    await shot("grand-canyon");
    await fly("view-storm-carrier", 8000);
    await shot("storm");
    await app.js(`(() => { __bh.camera.missionAbort(); return 1; })()`);
  }, 240_000);
});
