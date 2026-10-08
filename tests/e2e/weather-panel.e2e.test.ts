import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The weather's panel (PLAN-METEO W2): opened by the HUD's Weather button (a real click), a preset chosen
// (a real click) — the setting, what is in force at the place below (its flight category) and the
// vertical cut drawn follow; the choice saved with the flight; the pause menu opens it too.

describe.skipIf(!E2E)("the weather's panel", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis" });
  });
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const seen = () =>
    app.js<{ weather: string; category: string; ink: number }>(`(() => {
      const cv = document.querySelector("[data-testid=weather-cut]");
      const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      let ink = 0;
      for (let i = 3; i < d.length; i += 16) ink += d[i] > 0 ? 1 : 0;
      return { weather: __bh.settings.weather, category: document.querySelector(".wx-rows").dataset.category, ink };
    })()`);

  test("opened from the HUD; fair, then fog and storm chosen: the category, the cut, the save", async () => {
    await app.click("[data-testid=hud-weather]");
    await app.waitFor(`!!document.querySelector("[data-testid=weather-panel]")`, 5000);
    await Bun.sleep(600);
    const fair = await seen();
    expect(fair.weather).toBe("fair");
    expect(fair.category).toBe("VFR");
    expect(fair.ink).toBeGreaterThan(200);
    await app.click("[data-testid=weather-fog]");
    await Bun.sleep(700);
    const fog = await seen();
    expect(fog.weather).toBe("fog");
    expect(fog.category).toBe("LIFR");
    await app.click("[data-testid=weather-storm]");
    await Bun.sleep(700);
    const storm = await seen();
    expect(storm.category).toBe("IFR");
    // (more drawn: the decks, the rain)
    expect(storm.ink).toBeGreaterThan(fair.ink);
    // (the flight saved: its weather with it)
    expect(await app.js<string>(`__bh.game.snapshot("wx").settings.weather`)).toBe("storm");
    await app.press("Escape");
    await app.waitFor(`!document.querySelector("[data-testid=weather-panel]")`, 3000);
  }, 60_000);

  test("the pause menu opens it", async () => {
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause-weather]")`, 5000);
    await app.click("[data-testid=pause-weather]");
    await app.waitFor(`!!document.querySelector("[data-testid=weather-panel]")`, 5000);
    await app.press("Escape");
  }, 30_000);

  test("the planisphere's weather layer: toggled by a real click, kept, drawn over the map", async () => {
    const ink = () =>
      app.js<number>(`(() => {
        // (the planisphere's 2D layer: the HUD's ground track, its canvas laid over the GPU's)
        const cv = [...document.querySelectorAll(".fl-root .gt-stage canvas.gt-canvas")].find((c) => c.getBoundingClientRect().width > 200);
        const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 64) s += d[i] + d[i + 1] + d[i + 2];
        return s;
      })()`);
    await app.js(`(__bh.settings.weather = "random", true)`);
    await app.press("KeyM");
    await Bun.sleep(800);
    await app.click("[data-testid=map-weather]");
    await Bun.sleep(1500);
    expect(await app.js<boolean>(`document.querySelector("[data-testid=map-weather]").classList.contains("on")`)).toBe(true);
    expect(await app.js<string>(`localStorage.getItem("kerr.map-weather")`)).toBe("1");
    const on = await ink();
    await app.click("[data-testid=map-weather]");
    await Bun.sleep(1500);
    const off = await ink();
    // (the zones, the arrows, the symbols: more drawn on the 2D layer)
    expect(on).toBeGreaterThan(off * 1.05);
    await app.press("KeyM");
  }, 60_000);
});
