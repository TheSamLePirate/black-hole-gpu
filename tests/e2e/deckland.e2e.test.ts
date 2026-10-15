import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The F-35B's recovery on the Ford (docs/PLAN-AVIATION-AAA.md, M3): first the Alps as ever (the image sound); then
// off Toulon, 3.5 km astern of the Ford, light enough to hover, the autopilot (G, Land) up its port side, in a hover
// alongside, across over the spot — ringed on the deck —, down on it pitching in the sea; the LSO's calls; the
// touchdown graded; set down, carried along. (E2E_SHOTS=<dir>: the views.)

const SEA = { lat: 42.75, lon: 6.1 };

describe.skipIf(!E2E)("the F-35B's recovery on a carrier", () => {
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

  test("astern of the Ford, the autopilot up its port side, alongside, across, down on the spot: OK", async () => {
    await app.js(
      `(() => { Object.assign(__bh.settings, { wind: 2 }); __bh.game.flyAt(${SEA.lat}, ${SEA.lon}, 300, 20, 140); return 1; })()`,
    );
    await Bun.sleep(1000);
    await app.js(`__bh.camera.carrierSpawn("ford")`);
    await app.waitFor(`!!__bh.camera.carrierNow().length`, 10_000);
    await app.js(
      `(() => { __bh.settings.shipMount = "chase"; const r = __bh.camera.carrierFinal("ford", 3500, 90); __bh.fleet.fuel.f35 = 1800; return r; })()`,
    );
    await Bun.sleep(300);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    // (the radio heard)
    await app.js(
      `(() => { const c = __bh.camera, f = c.onRadio; window.__radio = []; c.onRadio = (s) => { window.__radio.push(s); f?.(s); }; return 1; })()`,
    );
    const said = await app.js<string>(`__bh.camera.deckLand("ford")`);
    console.log(`  ${said}`);
    expect(said).toContain("Deck landing on");
    await app.waitFor(`["alongside", "cross", "descend", "down"].includes(__bh.camera.deckRun?.phase) || !__bh.camera.deckRun`, 150_000);
    await app.waitFor(`__bh.camera.deckRun?.phase !== "alongside"`, 90_000);
    await around(250, 10, 70);
    await shot("deck-alongside");
    await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await app.waitFor(`__bh.camera.deckRun?.phase === "descend" || !__bh.camera.deckRun`, 60_000);
    await Bun.sleep(1000);
    await shot("deck-over-cockpit");
    await around(200, 12, 45);
    await app.waitFor(`!__bh.camera.deckRun`, 60_000);
    const last = await app.js<{ dx: number; dz: number; sink: number; grade: string }>(`__bh.camera.deckLast`);
    const radio = await app.js<string[]>(`window.__radio`);
    console.log(
      `  down ${Math.hypot(last.dx, last.dz).toFixed(2)} m off the spot at ${last.sink.toFixed(2)} m/s — ${last.grade}\n    ${radio.join("\n    ")}`,
    );
    expect(Math.hypot(last.dx, last.dz)).toBeLessThan(3);
    expect(last.grade).not.toBe("No grade");
    await Bun.sleep(4000);
    expect(await app.js<boolean>(`__bh.camera.landed`)).toBe(true);
    await app.js(`(__bh.freeze(true), 1)`);
    await Bun.sleep(600);
    await shot("deck-down");
    await app.js(`(__bh.freeze(false), 1)`);
  }, 360_000);

  test("a short take-off from the Ford's lane, full tanks: rolling, off before the bow, climbing; then a vertical one, light", async () => {
    await app.js(`(() => { const c = __bh.camera; c.carrierLand("ford", { x: 10, z: -60 }); __bh.fleet.fuel.f35 = 6125; return 1; })()`);
    await Bun.sleep(1500);
    const said = await app.js<string>(`__bh.camera.deckTakeoff()`);
    console.log(`  ${said}`);
    expect(said).toContain("Short take-off from");
    await around(250, 6, 60);
    await app.waitFor(`__bh.camera.stoRun?.phase === "roll"`, 30_000);
    await Bun.sleep(3500);
    await shot("sto-roll");
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    await app.waitFor(`__bh.camera.stoRun?.phase === "climb" || !__bh.camera.stoRun`, 30_000);
    await Bun.sleep(1200);
    await shot("sto-off-the-bow");
    await app.waitFor(`!__bh.camera.stoRun`, 60_000);
    const g = await app.js<{ alt: number }>(`__bh.camera.geoNow()`);
    console.log(`  climbing away at ${g.alt.toFixed(0)} m, STOVL ${(await app.js<boolean>("__bh.camera.stovl.on")) ? "on" : "off"}`);
    expect(g.alt).toBeGreaterThan(30);
    // (light: straight up off the deck)
    await app.js(`(() => { const c = __bh.camera; c.carrierLand("ford", { x: 10, z: -60 }); __bh.fleet.fuel.f35 = 1800; return 1; })()`);
    await Bun.sleep(1500);
    expect(await app.js<string>(`__bh.camera.deckTakeoff("vertical")`)).toContain("Vertical take-off");
    await around(240, 8, 70);
    await app.waitFor(`__bh.camera.stoRun?.phase === "accel" || !__bh.camera.stoRun`, 40_000);
    await shot("vto-up");
    await app.waitFor(`!__bh.camera.stoRun`, 90_000);
    expect(await app.js<number>(`__bh.camera.geoNow().alt`)).toBeGreaterThan(30);
  }, 300_000);
});
