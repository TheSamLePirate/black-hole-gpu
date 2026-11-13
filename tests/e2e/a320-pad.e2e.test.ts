import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The A320 on an Xbox 360 pad (audit 2026-11-10, FX-07): before 13 Nov 2026 it had no layout of its own — the pad's
// general one, a spacecraft's: the left stick pitched and yawed (no roll), the bumpers rolled, X and Y engaged the
// prograde and retrograde holds the keys refuse an aircraft. A pad of the page's own (navigator.getGamepads replaced),
// the A320 flown over the sea off Toulon, 2 000 m up.
// Done when: the left stick banks the A320, RT moves its thrust levers, X and Y engage no orbital hold, the A320's
// autopilot comes on by Menu.
// Duration: ~1 min.

const FAKE_PAD = `(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
  window.__pad = { id: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)", index: 0, mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  navigator.getGamepads = () => [window.__pad];
  return 1;
})()`;

describe.skipIf(!E2E)("the A320 on an Xbox 360 pad", () => {
  let app: App;
  const axes = (a: number[]) => app.js(`(window.__pad.axes = ${JSON.stringify(a)}, 1)`);
  const hold = (n: number, on: boolean) =>
    app.js(`(window.__pad.buttons[${n}].pressed = ${on}, window.__pad.buttons[${n}].value = ${on ? 1 : 0}, 1)`);
  const press = async (n: number, ms = 120) => {
    await hold(n, true);
    await Bun.sleep(ms);
    await hold(n, false);
    await Bun.sleep(200);
  };
  const bank = () => app.js<number>(`((__bh.camera.attitudeNow().bank ?? 0) * 180) / Math.PI`);
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.js(`(() => { __bh.settings.vessel = "a320"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "a320"`, 30_000);
    // (over the sea: no relief to wait for)
    await app.js(
      `(() => { __bh.game.flyAt(42.9, 6.0, 2000, 90, 130); __bh.settings.shipMount = "chase"; __bh.camera.pilot.throttle = 0.6; return 1; })()`,
    );
    await app.js(FAKE_PAD);
    await Bun.sleep(1500);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the left stick banks the A320; X and Y engage no orbital hold; Menu its autopilot", async () => {
    const b0 = await bank();
    await axes([0.7, 0, 0, 0]);
    await Bun.sleep(2000);
    const b1 = await bank();
    await axes([0, 0, 0, 0]);
    console.log(`  the bank: ${b0.toFixed(0)}° → ${b1.toFixed(0)}° after 2 s of the stick right`);
    await app.snap("remote-results/a320-pad/banked.png");
    await Bun.sleep(1500);
    // X, Y: before, the prograde and retrograde holds
    await press(2);
    const afterX = await app.js<string | null>(`__bh.camera.pilot.hold ?? null`);
    await press(3);
    const afterY = await app.js<string | null>(`__bh.camera.pilot.hold ?? null`);
    console.log(`  after X: hold ${afterX}; after Y: hold ${afterY}`);
    // RT: the thrust levers up
    const t0 = await app.js<number>(`__bh.camera.pilot.throttle`);
    await hold(7, true);
    await Bun.sleep(800);
    await hold(7, false);
    const t1 = await app.js<number>(`__bh.camera.pilot.throttle`);
    console.log(`  the thrust levers: ${t0.toFixed(2)} → ${t1.toFixed(2)}`);
    // Menu tapped: the A320's autopilot
    await press(9);
    await Bun.sleep(300);
    const ap = await app.js<string>(`JSON.stringify(__bh.camera.a320Ap?.() ?? __bh.camera.a320?.ap ?? null)`);
    const said = await app.js<string[]>(`__bh.game.log.events.slice(-4).map((e) => e.text)`);
    console.log(`  Menu: ${ap} · ${said.join(" | ")}`);
    // (the A320's normal law: 15°/s at full stick, eased in — about 15° in 2 s at 0.7)
    expect(b1).toBeGreaterThan(b0 + 8);
    expect(afterX === "prograde" || afterX === "retrograde").toBe(false);
    expect(afterY === "prograde" || afterY === "retrograde").toBe(false);
    expect(t1).toBeGreaterThan(t0 + 0.1);
    expect(said.join(" ")).toMatch(/AP1|autopilot|Autopilot|AP /);
  }, 90_000);
});
