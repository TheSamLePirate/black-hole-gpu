import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-VAISSEAUX X5, the spacecraft's wheel and pad in the real page with real input: Tab held near the ISS opens the
// Ranger's wheel (eleven sectors, no aircraft entry), Autopilots ▸ Station keeping clicked keeps station; the
// Endurance's Systems ▸ shows its ring; a pad of the page's own (navigator.getGamepads replaced): A the SAS, the
// D-pad ▲ prograde, L3 the RCS's translation mode, Y held the wheel aimed by the right stick (A opens Holds ▸, B back,
// Y let go closes it). ~2 min.

const FAKE_PAD = `(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
  window.__pad = { id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)", index: 0, mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  navigator.getGamepads = () => [window.__pad];
  return 1;
})()`;

describe.skipIf(!E2E)("the spacecraft's wheel and pad (X5)", () => {
  let app: App;
  const tab = { code: "Tab", key: "Tab", windowsVirtualKeyCode: 9 };
  const sectors = `document.querySelectorAll("[data-testid=wheel] .rw-sector").length`;
  const labels = `[...document.querySelectorAll("[data-testid=wheel] .rw-label b")].map((b) => b.textContent)`;
  let size: [number, number] = [0, 0];
  const at = (i: number, n: number) => {
    const a = (i / n) * 2 * Math.PI;
    return { x: size[0] / 2 + 150 * Math.sin(a), y: size[1] / 2 - 150 * Math.cos(a) };
  };
  const click = async (p: { x: number; y: number }) => {
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
  };
  const axes = (a: number[]) => app.js(`(window.__pad.axes = ${JSON.stringify(a)}, 1)`);
  const btn = (n: number, on: boolean) =>
    app.js(`(window.__pad.buttons[${n}].pressed = ${on}, window.__pad.buttons[${n}].value = ${on ? 1 : 0}, 1)`);
  const press = async (n: number, ms = 120) => {
    await btn(n, true);
    await Bun.sleep(ms);
    await btn(n, false);
    await Bun.sleep(200);
  };

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(async () => {
      __bh.setDate(Date.UTC(2026, 9, 1, 12)); __bh.game.preset("Earth: docking to the ISS");
      await new Promise((ok) => setTimeout(ok, 1500)); return true; })()`);
    size = await app.js<[number, number]>("[innerWidth, innerHeight]");
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("Tab held: the Ranger's wheel — eleven sectors, no aircraft entry; Autopilots ▸ Station keeping clicked keeps station", async () => {
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: size[0] / 2, y: size[1] / 2 });
    await app.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...tab });
    await app.waitFor(`${sectors} === 11`, 3000);
    const top = await app.js<string[]>(labels);
    expect(top).toContain("Systems ▸");
    expect(top).toContain("Docking ▸");
    expect(top).toContain("Fleet ▸");
    // (Autopilots ▸, the third: released over it, its wheel)
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at(2, 11) });
    await app.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...tab });
    await app.waitFor(`(${labels}).includes("Station keeping")`, 3000);
    const auto = await app.js<string[]>(labels);
    expect(auto).not.toContain("ILS approach");
    const i = auto.indexOf("Station keeping");
    await click(at(i, auto.length));
    await app.waitFor(`__bh.camera.pilot.auto === "keep"`, 5000);
    await app.press("Digit8", "*", { shift: true });
    await app.waitFor(`__bh.camera.pilot.auto === "none"`, 5000);
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);

  test("the Endurance's wheel: Systems ▸ has its ring", async () => {
    await app.js(`(__bh.settings.vessel = "endurance", 1)`);
    await app.waitFor(`__bh.fleet.active === "endurance"`, 10_000);
    await Bun.sleep(500);
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: size[0] / 2, y: size[1] / 2 });
    await app.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...tab });
    await app.waitFor(`${sectors} === 11`, 3000);
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at(4, 11) });
    await app.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...tab });
    await app.waitFor(`(${labels}).some((l) => l.startsWith("Ring +"))`, 3000);
    expect(await app.js<string[]>(labels)).not.toContain("Gear");
    await app.press("Escape");
    await app.waitFor(`!document.querySelector("[data-testid=wheel]")`, 3000);
    await app.js(`(__bh.settings.vessel = "ranger", 1)`);
    await app.waitFor(`__bh.fleet.active === "ranger"`, 10_000);
  }, 60_000);

  test("the pad: A the SAS, D-pad ▲ prograde, L3 the RCS's translation", async () => {
    await app.js(FAKE_PAD);
    await app.waitFor(`!!__bh.camera.spacePadOut`, 5000);
    const sas = await app.js<boolean>(`__bh.camera.pilot.sas`);
    await press(0);
    await app.waitFor(`__bh.camera.pilot.sas === ${!sas}`, 3000);
    await press(0);
    await press(12);
    await app.waitFor(`__bh.camera.pilot.hold === "prograde"`, 3000);
    await app.press("Backspace");
    await press(10);
    await app.waitFor(`__bh.camera.rcsMode === "translate"`, 3000);
    await press(10);
    await app.waitFor(`__bh.camera.rcsMode !== "translate"`, 3000);
  }, 60_000);

  test("Y held: the wheel by the pad — the right stick aims Holds ▸, A opens it, B back, Y let go closes it", async () => {
    await btn(3, true);
    await app.waitFor(`${sectors} === 11`, 3000);
    // (Holds, the second of eleven: up and a little right — the stick's up is its axis' minus)
    const a = (1 / 11) * 2 * Math.PI;
    await axes([0, 0, Math.sin(a), -Math.cos(a)]);
    await app.waitFor(
      `document.querySelector("[data-testid=wheel] .rw-sector.hot") === document.querySelectorAll("[data-testid=wheel] .rw-sector")[1]`,
      3000,
    );
    await axes([0, 0, 0, 0]);
    await press(0);
    await app.waitFor(`${sectors} === 10`, 3000);
    await press(1);
    await app.waitFor(`${sectors} === 11`, 3000);
    await btn(3, false);
    await app.waitFor(`!document.querySelector("[data-testid=wheel]")`, 3000);
    // (closed: the pad flies again)
    await app.waitFor(`__bh.camera.spacePad.wheel === false`, 3000);
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);
});
