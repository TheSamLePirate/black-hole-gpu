import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-CIEL C8–C9: the multiple exposure, by real clicks — the photo mode's "Multiple exposure…", the analemma
// from Paris every 10 days at noon UTC with its dates and positions written, the composite shown (its Suns'
// dots, the base's landscape under them), the game put back as it was; the eclipse calculator's sheet of the
// 12 August 2026 eclipse → "Multiple exposure": the dialog filled for it (Paris: partial there), 3 phases
// before and after, the sky alone, the discs laid at their places, the caption.

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

  test("an eclipse's phases from the calculator's sheet: the dialog filled for it, its discs laid, its labels", async () => {
    // (out of the photo mode the first test left)
    if (await app.js<boolean>(`document.body.classList.contains("photo")`)) await app.click("[data-testid=photo-back]");
    await app.waitFor(`!document.body.classList.contains("photo")`, 3_000);
    await app.click("[data-testid=hud-eclipses]");
    await app.click("[data-testid=ec-tab-earth]");
    await app.waitFor(`!!document.querySelector('[data-testid=ec-row][data-id^="solar:2026-08-12"]')`, 60_000);
    await app.click('[data-testid=ec-row][data-id^="solar:2026-08-12"]');
    await app.click("[data-testid=ec-photo]");
    await app.waitFor(`!!document.querySelector("[data-testid=multi-exposure]")`, 3_000);
    expect(await app.js<boolean>(`document.querySelector("[data-testid=mx-eclipse]").classList.contains("on")`)).toBe(true);
    await app.waitFor(`document.querySelector("[data-testid=mx-ecl-list]")?.selectedOptions[0]?.textContent.includes("2026")`, 60_000);
    expect(await app.js<string>(`document.querySelector("[data-testid=mx-ecl-list]").selectedOptions[0].textContent`)).toContain(
      "12 août 2026",
    );
    await app.js(`(() => {
      const set = (id, v) => { const e = document.querySelector("[data-testid=" + id + "]"); e.value = v; e.dispatchEvent(new Event("change")); };
      set("mx-before", "3"); set("mx-after", "3"); set("mx-framing", "sky"); set("mx-ecl-base", "none");
      return 1;
    })()`);
    await app.click("[data-testid=mx-share]");
    await app.click("[data-testid=mx-start]");
    await app.waitFor(`!!document.querySelector("[data-testid=mx-image]")`, 300_000);
    const px = await app.js<{ bright: number; w: number }>(`(() => {
      const c = document.querySelector("[data-testid=mx-image]"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let bright = 0;
      for (let k = 0; k < d.length; k += 4) if (d[k] > 200 && d[k + 1] > 180) bright++;
      return { bright, w: c.width };
    })()`);
    expect(px.w).toBe(1920);
    // (seven discs of some 20 px across, their labels and the caption's letters)
    expect(px.bright).toBeGreaterThan(7 * 150);
    expect(await app.js<string>(`document.querySelector(".mx-status").textContent`)).toMatch(/poses fusionnées/);
    await app.press("Escape");
  }, 400_000);

  test("the night's series from the dialog: an ISS pass (its list, its trail) and the lunar analemma (its loop, its labels)", async () => {
    await app.js(
      `(__bh.game.setDate("2026-10-10T12:00:00Z"), void __bh.mx.dialog.open({ kind: "iss", fill: { lat: 48.86, lon: 2.35 } }), true)`,
    );
    await app.waitFor(`document.querySelector("[data-testid=mx-iss-list]")?.options.length > 1`, 60_000);
    // (the brightest offered first)
    expect(await app.js<string>(`document.querySelector("[data-testid=mx-iss-list]").selectedOptions[0].textContent`)).toMatch(
      /mag −?-?\d/,
    );
    await app.click("[data-testid=mx-start]");
    await app.waitFor(`!!document.querySelector("[data-testid=mx-image]")`, 120_000);
    const trail = await app.js<number>(`(() => {
      const c = document.querySelector("[data-testid=mx-image]"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let k = 0; k < d.length; k += 4) if (d[k] > 150 && d[k + 1] > 140 && d[k + 2] > 120) n++;
      return n;
    })()`);
    // (a line of light across the frame, its labels)
    expect(trail).toBeGreaterThan(1500);
    await app.press("Escape");
    await app.js(
      `(void __bh.mx.dialog.open({ kind: "moon", fill: { lat: 48.86, lon: 2.35, date: Date.UTC(2026, 9, 1), mode: "lunar", framing: "sky", days: 20 } }), true)`,
    );
    expect(await app.js<string>(`document.querySelector("[data-testid=mx-moon-base]").value`)).toBe("none");
    await app.click("[data-testid=mx-start]");
    await app.waitFor(`!!document.querySelector("[data-testid=mx-image]")`, 300_000);
    expect(await app.js<string>(`document.querySelector(".mx-status").textContent`)).toMatch(/poses fusionnées/);
    await app.press("Escape");
  }, 500_000);
});
