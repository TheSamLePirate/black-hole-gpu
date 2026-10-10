import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-PLUIE: the rain, at Le Bourget, landed in it. P1 — it keeps the game's time: paused, the drops stand
// still in the air and on the glass (the image the same a second later); the time running, they fall. P5 —
// heard: the canopy drummed from the seat, the hiss outside, nothing held with the time.

describe.skipIf(!E2E)("the rain", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis", width: 960, height: 600 });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.js(`(() => {
      __bh.freeze(true); __bh.settings.weather = "rain"; __bh.settings.wind = 0;
      __bh.game.setDate("2067-06-01T10:30:00"); __bh.game.glideTo("Bourget");
      // (landed by the autopilot, stopped on the runway: a still state, in the rain)
      const c = __bh.camera;
      for (let i = 0; i < 30 * 240; i++) { __bh.step(1 / 30); if (c.airFlight.failure || (c.ourLanded && c.airInfo?.()?.speed < 0.5)) break; }
      __bh.freeze(false); return true; })()`);
    await app.waitFor("__bh.renderer.rain && __bh.renderer.rain.rain > 0", 30_000);
    // (a key: the audio's user gesture — twice, the SAS back as it was)
    await app.press("KeyT");
    await app.press("KeyT");
    await app.waitFor(`__sound.ctx?.state === "running"`, 10_000);
  }, 240_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  // (the view alone: the interface and the flight's HUD hidden)
  const clip = async () => {
    const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      clip: { x: 160, y: 120, width: 640, height: 360, scale: 1 },
    });
    return r.data;
  };

  // P5: heard — the canopy drummed from the seat, the hiss outside; none held with the time
  test("the rain heard: drummed on the canopy in the cabin, hissing outside, silent paused", async () => {
    const at = (m: string) =>
      app.js<Record<string, number>>(`(async () => {
        __bh.settings.shipMount = ${JSON.stringify(m)}; __bh.refresh();
        await new Promise((ok) => setTimeout(ok, 2500));
        return __sound.spaceState().rain;
      })()`);
    await app.js("(__bh.game.pause(false), true)");
    const seat = await at("cockpit");
    expect(seat.drum! + seat.drumDense!).toBeGreaterThan(0.05);
    expect(seat.hissIn!).toBeGreaterThan(0.01);
    expect(seat.hissOut!).toBeLessThan(0.005);
    const chase = await at("chase");
    expect(chase.hissOut!).toBeGreaterThan(0.03);
    expect(chase.drum! + chase.drumDense!).toBeLessThan(0.005);
    await app.js("(__bh.game.pause(true), true)");
    const held = await at("chase");
    expect(Math.max(...Object.values(held))).toBeLessThan(0.005);
    await app.js("(__bh.game.pause(false), true)");
  }, 60_000);

  test("paused, the rain holds; running, it falls", async () => {
    await app.js(
      `(__bh.game.pause(true), document.body.classList.add("hide-ui"), document.querySelectorAll("canvas.fl-hud").forEach((c) => (c.style.visibility = "hidden")), true)`,
    );
    // (the image refining while the time holds: compared once it has)
    await app.waitFor(`__bh.renderer.lastPhase === "converged"`, 60_000);
    await Bun.sleep(500);
    const c0 = await app.js<number>("__bh.renderer.rainClock");
    const a = await clip();
    await Bun.sleep(1000);
    const b = await clip();
    expect(await app.js<number>("__bh.renderer.rainClock")).toBe(c0);
    expect(b === a).toBe(true);
    // (the time running: its clock goes on with the frames')
    await app.js("(__bh.game.pause(false), true)");
    await Bun.sleep(1000);
    expect(await app.js<number>("__bh.renderer.rainClock")).toBeGreaterThan(c0 + 0.5);
  }, 60_000);
});
