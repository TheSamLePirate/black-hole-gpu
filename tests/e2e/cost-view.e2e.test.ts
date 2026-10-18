import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The cost view (renderer.costView, trace.wgsl COST_VIEW): each ray's work as a heat map in place of the image. From
// the cockpit, held still (the same frame for each view): the Alps, then low over the hills of Tarifa looking along
// the strait — clouds, the sea, the scenery —; the image, then all the work, then each kind alone (2 the ground's
// march, 3 its heights read, 4 its shadows, 5 the clouds, 6 the air, 7 the sea, 8 the scenery, 9 the main loop).
// E2E_SHOTS=<dir>: the views.

const KINDS = [
  "image",
  "all",
  "ground-march",
  "heights",
  "ground-shadows",
  "clouds",
  "air",
  "water",
  "scenery",
  "integrator",
  "noise",
  "stars",
  "bodies",
  "main-loop",
];

describe.skipIf(!E2E)("the cost view: each ray's work as a heat map", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const views = async (key: string, only = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) => {
    for (const v of only) {
      await app.js(`(() => { __bh.renderer.costView = ${v}; return 1; })()`);
      await Bun.sleep(600);
      // (held still, the image refines with the kernel's quality variant: until it is compiled the general kernel —
      // no cost view — draws)
      await app.waitFor(`(() => { const v = __bh.renderer.variants.get(__bh.renderer.featureKey); return !!v?.rt && !!v?.q; })()`, 240_000);
      await app.js(`(() => { __bh.renderer.invalidate(); return 1; })()`);
      await Bun.sleep(3000);
      await shot(`${key}-${v}-${KINDS[v]}`);
    }
    await app.js(`(() => { __bh.renderer.costView = 0; return 1; })()`);
  };

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: true, f35AutoProtect: true, showFps: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the Alps: the image, all the work", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 2500, 110, 200); __bh.settings.shipMount = "cockpit"; __bh.game.quality("realtime"); __bh.game.set("realtimeSubsampling", 2); return 1; })()`);
    await Bun.sleep(1500);
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await Bun.sleep(2500);
    await app.js(`(() => { __bh.settings.animate = false; return 1; })()`);
    await views("alps", [0, 1]);
    await app.js(`(() => { __bh.settings.animate = true; return 1; })()`);
  }, 600_000);

  test("low over the hills of Tarifa: the image, all the work, each kind", async () => {
    await app.js(`(() => { __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 0.3); __bh.game.setDate("2026-07-10T10:00:00Z");
      __bh.game.flyAt(36.1, -5.55, 900, 200, 210); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await Bun.sleep(6000);
    await app.js(`(() => { __bh.settings.animate = false; return 1; })()`);
    await views("tarifa");
    expect(await app.js<number>(`__bh.renderer.costView`)).toBe(0);
    await app.js(`(() => { __bh.settings.animate = true; return 1; })()`);
  }, 900_000);
});
