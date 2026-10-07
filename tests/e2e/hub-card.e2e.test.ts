import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The hub's card (PLAN-HUB HB2): its rows alike for every autopilot — the value's trend beside it (▲ ▼),
// computed by the HUD for all —, and its height bounded: below 620 px the cockpit already shrinks (×0.72);
// on a window shorter still (a phone's on its side) the take-off's long card (eight rows) folds its small
// graph away rather than run under the mission's bar. In the HUD gallery's states.

const state = (name: string) => Bun.file(`${import.meta.dir}/../hud/states/${name}.json`).text();

interface Card {
  top: number;
  limit: number;
  tight: boolean;
  graph: boolean;
  arrows: string[];
}

describe.skipIf(!E2E)("the hub's card", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis" });
  });
  afterAll(() => {
    app?.close();
    stopServer();
  });
  const fly = async (name: string, s: number): Promise<Card> => {
    const json = await state(name);
    await app.js(`(__bh.freeze(false), __bh.game.importSave(${JSON.stringify(json)}, false), true)`);
    await Bun.sleep(s * 1000);
    return app.js<Card>(`(() => {
      const c = document.querySelector(".fl-hubcard"), m = document.querySelector(".fl-mission");
      const cv = c.querySelector("[data-testid=assist-graph-small]");
      return { top: c.getBoundingClientRect().top, limit: m && !m.hidden ? m.getBoundingClientRect().bottom : 0,
        tight: c.classList.contains("tight"), graph: !!cv && !cv.hidden && cv.getBoundingClientRect().height > 0,
        arrows: [...c.querySelectorAll(".fl-hub-rows .fl-tr")].map((i) => i.parentElement.previousElementSibling.textContent + i.textContent) };
    })()`);
  };

  test("the trends: the glide's height and range falling, ▼ beside them", async () => {
    const c = await fly("05-glide", 3);
    expect(c.arrows.some((a) => /▼$/.test(a))).toBe(true);
    expect(c.arrows.some((a) => /^height/i.test(a))).toBe(true);
  }, 60_000);

  test("its height bounded: the take-off's card under the mission's bar on a 320 px window, its graph folded away", async () => {
    const tall = await fly("01-ascent", 2.5);
    expect(tall.tight).toBe(false);
    expect(tall.graph).toBe(true);
    await app.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 320, deviceScaleFactor: 1, mobile: false });
    try {
      await Bun.sleep(1500);
      const short = await app.js<Card>(`(() => {
        const c = document.querySelector(".fl-hubcard"), m = document.querySelector(".fl-mission");
        const cv = c.querySelector("[data-testid=assist-graph-small]");
        return { top: c.getBoundingClientRect().top, limit: m && !m.hidden ? m.getBoundingClientRect().bottom : 0,
          tight: c.classList.contains("tight"), graph: !!cv && !cv.hidden && cv.getBoundingClientRect().height > 0, arrows: [] };
      })()`);
      expect(short.tight).toBe(true);
      expect(short.graph).toBe(false);
      expect(short.top).toBeGreaterThanOrEqual(short.limit);
    } finally {
      await app.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }
  }, 60_000);
});
