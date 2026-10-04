import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A burn flown by hand, assisted (C1), by real input: CIRC assisted plans its burn at the apoapsis, the
// time slows to real for its countdown; the pilot holds prograde (1) and lights it (Z), the Δv left follows the thrust given
// along the burn, the graph beside the hub shows it on its profile; at the cue the pilot cuts (X) — the
// orbit is the circle asked.

describe.skipIf(!E2E)("a burn flown by hand, assisted", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: the Blue Marble" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("CIRC assisted: counted down, lit by hand, its Δv followed, cut at the cue — circular", async () => {
    // (an orbit 300 × 420 km, the apoapsis a few minutes ahead)
    await app.js(`__bh.game.orbit("earth", { peKm: 300, apKm: 420, inc: 20, nu: 165 })`);
    await app.press("F4", "F4");
    expect(await app.js<boolean>("__bh.camera.pilot.assist")).toBe(true);
    await app.press("Digit9", "9");
    // its burn planned: the hub's card counts down to it, the graph beside it
    await app.waitFor(`!!__bh.camera.hubInfo()?.cue`, 30_000);
    expect(
      await app.js<boolean>(`!!document.querySelector("[data-testid=assist-graph]") && !document.querySelector(".fl-hub-graph").hidden`),
    ).toBe(true);
    // the pilot points the nose: CIRC's burn at the apoapsis is prograde (1: hold prograde)
    await app.press("Digit1", "1");
    // (the last seconds before the ignition: the time no faster than real — a countdown to follow)
    await app.waitFor(`(() => { const c = __bh.camera.hubInfo()?.cue; return c && c.tIgn < 8; })()`, 180_000);
    const dv = await app.js<number>("__bh.camera.hubInfo().cue.dv");
    expect(dv).toBeGreaterThan(5);
    await app.waitFor(`__bh.camera.hubInfo()?.cue?.burning`, 30_000);
    // nothing flown yet: the ship waits for its pilot
    expect(await app.js<number>("__bh.camera.pilot.throttle")).toBe(0);
    await app.press("KeyZ", "z");
    await app.waitFor(`__bh.camera.pilot.throttle > 0.99`);
    // the Δv left falls as the pilot burns; the cue says cut once it is delivered
    await app.waitFor(`__bh.camera.hubInfo()?.cue?.left < ${dv} * 0.8`, 60_000);
    expect(await app.js<string>(`document.querySelector(".fl-hub-graph").dataset.state`)).not.toBe("wait");
    await app.waitFor(`__bh.camera.hubInfo()?.cue?.cut`, 120_000);
    await app.press("KeyX", "x");
    // the burn done (the node gone): the orbit circular within a few km
    await app.waitFor(`!__bh.camera.plan.nodes.length`, 30_000);
    const o = await app.js<{ peKm: number; apKm: number }>("__bh.game.status().orbit");
    expect(o.apKm - o.peKm).toBeLessThan(12);
    expect(o.peKm).toBeGreaterThan(380);
    await app.press("Digit9", "9");
  }, 420_000);
});
