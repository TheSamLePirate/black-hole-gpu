import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The hub's graph opened large (PLAN-HUB HB3): a real click on the small graph under the hub's card opens
// it over the view — its title, what it shows, its axes named, a legend, the reading under the pointer —;
// Escape closes it and leaves the autopilot flying (the Escape stack). In the final approach's state of the
// HUD gallery (tests/hud/states/06-final.json): the entry autopilot on the final, its graph the profile.

describe.skipIf(!E2E)("the hub's graph, large", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis" });
    const json = await Bun.file(`${import.meta.dir}/../hud/states/06-final.json`).text();
    await app.js(`(__bh.freeze(false), __bh.game.importSave(${JSON.stringify(json)}, false), true)`);
    await app.waitFor(
      `!!document.querySelector("[data-testid=assist-graph-small]") && document.querySelector("[data-testid=assist-graph-small]").getBoundingClientRect().height > 40`,
      15_000,
    );
  });
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("a click opens it over the view, the pointer reads it, Escape closes it — the autopilot still flying", async () => {
    await app.click("[data-testid=assist-graph-small]");
    await app.waitFor(
      `!document.querySelector("[data-testid=assist-graph-big]").hidden && document.querySelector("[data-testid=assist-graph-big] .fl-htext").textContent.length > 3`,
      3000,
    );
    const big = await app.js<{ title: string; w: number; h: number; drawn: boolean }>(`(() => {
      const b = document.querySelector("[data-testid=assist-graph-big]"), r = b.getBoundingClientRect();
      const cv = b.querySelector("canvas"), g = cv.getContext("2d"), d = g.getImageData(0, 0, cv.width, cv.height).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 64) if (d[i] > 0) lit++;
      return { title: b.querySelector(".fl-title").textContent, w: r.width, h: r.height, drawn: lit > 200 };
    })()`);
    expect(big.title.length).toBeGreaterThan(3);
    expect(big.w).toBeGreaterThan(400);
    expect(big.h).toBeGreaterThan(250);
    expect(big.drawn).toBe(true);
    // (the pointer over the plot: the reading drawn — more ink than without it)
    const ink = () =>
      app.js<number>(
        `(() => { const cv = document.querySelector("[data-testid=assist-graph-big] canvas"), d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; let s = 0; for (let i = 3; i < d.length; i += 16) s += d[i]; return s; })()`,
      );
    const before = await ink();
    const r = await app.hit("[data-testid=assist-graph-big] canvas");
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
    await Bun.sleep(300);
    expect(await ink()).toBeGreaterThan(before);
    await app.press("Escape");
    await app.waitFor(`document.querySelector("[data-testid=assist-graph-big]").hidden`, 3000);
    expect(await app.js<string>("__bh.camera.pilot.auto")).toBe("entry");
  }, 60_000);
});
