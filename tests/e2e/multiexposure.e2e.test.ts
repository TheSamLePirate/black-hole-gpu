import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-CIEL C8: the multiple exposure, by real clicks — the photo mode's "Multiple exposure…", the analemma
// from Paris every 10 days at noon UTC with its dates and positions written, the composite shown (its Suns'
// dots, the base's landscape under them), the game put back as it was.

describe.skipIf(!E2E)("the multiple exposure", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis", width: 1440, height: 900, lang: "fr", tiles: true });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.js(`(__bh.game.land("earth", 48.86, 2.35), __bh.game.setDate("2026-01-01T12:00:00Z"), true)`);
    await Bun.sleep(1500);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the analemma from the photo mode: a figure of Suns over the landscape, labelled, the game restored", async () => {
    await app.press("Escape");
    await app.click("[data-testid=pause-photo]");
    await app.waitFor(`!!document.querySelector("[data-testid=photo]")`, 3_000);
    // (the photo mode holds the time: the series must give it back)
    const before = await app.js<number>(`__bh.camera.nowTime()`);
    await app.click("[data-testid=photo-multi]");
    await app.waitFor(`!!document.querySelector("[data-testid=multi-exposure]")`, 3_000);
    expect(await app.js<boolean>(`document.querySelector("[data-testid=mx-analemma]").classList.contains("on")`)).toBe(true);
    await app.js(
      `(() => { const r = document.querySelector("[data-testid=mx-cadence]"); r.value = "10"; r.dispatchEvent(new Event("input")); return 1; })()`,
    );
    await app.click("[data-testid=mx-position]");
    await app.click("[data-testid=mx-start]");
    await app.waitFor(`!!document.querySelector("[data-testid=mx-image]")`, 240_000);
    const px = await app.js<{ w: number; dots: number; land: number }>(`(() => {
      const c = document.querySelector("[data-testid=mx-image]"), g = c.getContext("2d");
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let dots = 0, land = 0;
      for (let k = 0; k < d.length; k += 4) {
        if (d[k] > 245 && d[k + 1] > 245 && d[k + 2] > 230) dots++;
        else if (d[k] + d[k + 1] + d[k + 2] > 30) land++;
      }
      return { w: c.width, dots, land };
    })()`);
    expect(px.w).toBe(1200);
    // (37 Suns of a few dozen pixels each, the labels' bright letters, a lit landscape)
    expect(px.dots).toBeGreaterThan(37 * 20);
    expect(px.land).toBeGreaterThan(1200 * 1600 * 0.3);
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=mx-download]")`)).toBe(true);
    await app.press("Escape");
    expect(await app.js<number>(`__bh.camera.nowTime()`)).toBeCloseTo(before, 3);
  }, 300_000);
});
