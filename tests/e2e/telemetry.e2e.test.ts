import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The flight's telemetry (PLAN-HUB HB4): the recorder fills as the craft flies; the map's tablet shows it
// on its TELEMETRY page — the curves drawn, a curve chosen by a real click —; the record comes out as CSV.
// In the glide's state of the HUD gallery (tests/hud/states/05-glide.json): the entry autopilot gliding.

describe.skipIf(!E2E)("the flight's telemetry", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis" });
    const json = await Bun.file(`${import.meta.dir}/../hud/states/05-glide.json`).text();
    await app.js(`(__bh.freeze(false), __bh.game.importSave(${JSON.stringify(json)}, false), true)`);
  });
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("recorded while flying; drawn on the tablet's page; a curve chosen; the CSV", async () => {
    await app.waitFor("__bh.recorder.samples.length > 6", 20_000);
    await app.press("KeyM");
    await app.click("[data-testid=tablet-telemetry]");
    await app.waitFor(
      `!!document.querySelector("[data-testid=telemetry-page]") && document.querySelector("[data-testid=telemetry-page] canvas").getBoundingClientRect().height > 100`,
      5000,
    );
    const ink = () =>
      app.js<number>(
        `(() => { const cv = document.querySelector("[data-testid=telemetry-page] canvas"), d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; let s = 0; for (let i = 3; i < d.length; i += 16) s += d[i] > 0 ? 1 : 0; return s; })()`,
      );
    await Bun.sleep(400);
    expect(await ink()).toBeGreaterThan(500);
    // (a curve let go by a real click: the chip off, fewer bands drawn)
    const speedOn = () => app.js<boolean>(`document.querySelector("[data-testid=telemetry-speed]").classList.contains("on")`);
    const was = await speedOn();
    await app.click("[data-testid=telemetry-speed]");
    expect(await speedOn()).toBe(!was);
    const csv = await app.js<string>("__bh.recorder.csv()");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toStartWith("t_s,alt_m,speed_mps");
    expect(lines.length).toBeGreaterThan(6);
    // (gliding: the height falls over the record)
    const alt = lines.slice(1).map((l) => Number(l.split(",")[1]));
    expect(alt[alt.length - 1]!).toBeLessThan(alt[0]!);
    await app.press("KeyM");
  }, 60_000);
});
