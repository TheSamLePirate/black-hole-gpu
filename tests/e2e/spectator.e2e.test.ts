import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The spectator (controller/spectator.ts) by real keys: F3 out and back; the camera moved about the
// ship, the ship on its orbit as it was; a ship landed on the Moon while the camera flies far away —
// its ground (the Moon's measured heights, streamed round the view) kept under it.

describe.skipIf(!E2E)("the spectator", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: the Blue Marble" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** a key held for ms (its physical code) */
  const hold = async (code: string, key: string, ms: number, shift = false) => {
    const ev = { code, key, windowsVirtualKeyCode: code.charCodeAt(3), modifiers: shift ? 8 : 0 };
    if (shift)
      await app.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", code: "ShiftLeft", key: "Shift", windowsVirtualKeyCode: 16 });
    await app.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...ev, text: key });
    await Bun.sleep(ms);
    await app.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...ev });
    if (shift) await app.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", code: "ShiftLeft", key: "Shift", windowsVirtualKeyCode: 16 });
  };
  const orbit = () =>
    app.js<{ pe: number; ap: number }>(`(() => { const o = __bh.game.status().orbit; return { pe: o.peKm, ap: o.apKm }; })()`);
  const away = () => app.js<number>("__bh.renderer.shipPlace ? __bh.renderer.shipPlace.dist : -1");

  test("F3: out, the banner; S backs away from the ship, which keeps its orbit; F3: back", async () => {
    const o0 = await orbit();
    await app.press("F3", "F3");
    await app.waitFor("__bh.camera.spectating");
    expect(await app.js<boolean>(`!document.querySelector(".fl-spect").hidden`)).toBe(true);
    const d0 = await away();
    await hold("KeyS", "s", 1500);
    await Bun.sleep(400);
    const d1 = await away();
    expect(d1).toBeGreaterThan(d0 + 30);
    const o1 = await orbit();
    expect(Math.abs(o1.pe - o0.pe)).toBeLessThan(1);
    expect(Math.abs(o1.ap - o0.ap)).toBeLessThan(1);
    await app.press("F3", "F3");
    await app.waitFor("!__bh.camera.spectating");
    expect(await app.js<boolean>(`document.querySelector(".fl-spect").hidden`)).toBe(true);
  });

  test("go to Mars: the view around it, the ship on its Earth orbit", async () => {
    const o0 = await orbit();
    await app.press("F3", "F3");
    await app.waitFor("__bh.camera.spectating");
    await app.js(
      `(() => { const g = document.querySelector("[data-testid=spect-goto]"); g.value = "mars"; g.dispatchEvent(new Event("change")); return 0 })()`,
    );
    await Bun.sleep(1000);
    expect(await app.js<string>("__bh.camera.viewSettings().target")).toBe("mars");
    expect(await app.js<boolean>("__bh.camera.spectatorFollow")).toBe(false);
    expect(await away()).toBeGreaterThan(1e11);
    const o1 = await orbit();
    expect(await app.js<string>("__bh.game.status().soi")).toBe("earth");
    expect(Math.abs(o1.pe - o0.pe)).toBeLessThan(1);
    await app.press("F3", "F3");
    await app.waitFor("!__bh.camera.spectating");
  });

  test("landed on the Moon: the camera far away, the ground under the gear the same", async () => {
    await app.js(`__bh.game.land("moon", 0.674, 23.473)`);
    await app.waitFor(`!!__bh.renderer.hdMap?.dem`, 60_000);
    await Bun.sleep(1500);
    const g0 = await app.js<number>(`__bh.game.status().altKm * 1000`);
    await app.press("F3", "F3");
    await app.waitFor("__bh.camera.spectating");
    await app.click("[data-testid=spect-follow]");
    await app.waitFor("!__bh.camera.spectatorFollow");
    // (up, fast: the speed grows with the height — thousands of km in seconds)
    await hold("KeyE", "e", 12000, true);
    await Bun.sleep(1500);
    expect(await away()).toBeGreaterThan(2e7);
    // (the Moon's finer maps kept for the ship: its gear on the same ground)
    expect(await app.js<boolean>(`!!__bh.renderer.hdMap?.dem`)).toBe(true);
    const g1 = await app.js<number>(`__bh.game.status().altKm * 1000`);
    expect(Math.abs(g1 - g0)).toBeLessThan(1);
    expect(await app.js<string>(`__bh.game.status().status`)).toBe("landed");
    await app.press("F3", "F3");
    await app.waitFor("!__bh.camera.spectating");
  });
});
