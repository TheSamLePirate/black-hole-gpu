import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The F-35C on the Ford (docs/PLAN-AVIATION-AAA.md, M3): first the Alps as ever (the image sound); then the variant
// set to the C, off Toulon the Ford's bow catapult — run up, fired, off and climbing —; then on its final 2.5 km out,
// the autopilot down the glide path on the ball, the hook catching a wire, stopped; the LSO's grade.
// (E2E_SHOTS=<dir>: the views.)

const SEA = { lat: 42.75, lon: 6.1 };

describe.skipIf(!E2E)("the F-35C on the Ford", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const around = async (yaw: number, pitch: number, dist: number) => {
    await app.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(300);
    await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: ${yaw}, pitch: ${pitch}, dist: ${dist} }); return 1; })()`);
    await Bun.sleep(800);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T16:30:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("the C off the bow catapult: run up, fired, off at 72 m/s over the deck, climbing", async () => {
    await app.js(
      `(() => { Object.assign(__bh.settings, { wind: 2, f35Variant: "C" }); __bh.game.flyAt(${SEA.lat}, ${SEA.lon}, 300, 20, 140); return 1; })()`,
    );
    await Bun.sleep(1000);
    await app.js(`__bh.camera.carrierSpawn("ford")`);
    await app.waitFor(`!!__bh.camera.carrierNow().length`, 10_000);
    await app.waitFor(`!!__bh.camera.catLaunch(0)?.startsWith("Catapult")`, 30_000);
    await around(250, 8, 45);
    await Bun.sleep(1200);
    await shot("cat-tension");
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    await app.waitFor(`__bh.camera.catRun?.phase === "airborne"`, 20_000);
    await Bun.sleep(2500);
    await shot("cat-off");
    await app.waitFor(`!__bh.camera.catRun`, 30_000);
    const g = await app.js<{ alt: number; vs: number }>(`__bh.camera.geoNow()`);
    console.log(`  off the catapult, climbing at ${g.alt.toFixed(0)} m, ${g.vs.toFixed(1)} m/s up`);
    expect(g.alt).toBeGreaterThan(60);
  }, 120_000);

  test("on the final 2.5 km out: down the glide path on the ball, a wire caught, stopped, graded", async () => {
    await app.js(
      `(() => { __bh.settings.shipMount = "cockpit"; const r = __bh.camera.carrierFinal("ford", 2500, 75); __bh.fleet.fuel.f35 = 3000; return r; })()`,
    );
    await Bun.sleep(300);
    await app.js(
      `(() => { const c = __bh.camera, f = c.onRadio; window.__radio = []; c.onRadio = (s) => { window.__radio.push(s); f?.(s); }; return 1; })()`,
    );
    const said = await app.js<string>(`__bh.camera.trapLand("ford")`);
    console.log(`  ${said}`);
    expect(said).toContain("Carrier landing on");
    await app.waitFor(`__bh.camera.trapRun?.ball === true`, 60_000);
    await Bun.sleep(4000);
    await shot("trap-ball");
    await app.waitFor(`!!__bh.camera.trapWire || !__bh.camera.trapRun`, 60_000);
    await around(235, 10, 60);
    await Bun.sleep(600);
    await shot("trap-wire");
    await app.waitFor(`!!__bh.camera.trapLast`, 30_000);
    const last = await app.js<{ grade: string; wire: number }>(`__bh.camera.trapLast`);
    const radio = await app.js<string[]>(`window.__radio`);
    console.log(`  the ${last.wire}-wire — ${last.grade}\n    ${radio.join("\n    ")}`);
    expect(last.wire).toBeGreaterThan(0);
    expect(["_OK_", "OK", "Fair"]).toContain(last.grade);
    await Bun.sleep(3000);
    await app.js(`(__bh.freeze(true), 1)`);
    await Bun.sleep(600);
    await shot("trap-stopped");
    await app.js(`(() => { __bh.freeze(false); __bh.settings.f35Variant = "B"; return 1; })()`);
  }, 180_000);
});
