import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-CIEL C7: the eclipse calculator, by real clicks — the HUD's Eclipses button, the timeline found by the
// worker, the total eclipse of 12 August 2026 seen from Paris (its sheet: saros, the map, the look from
// here), "Go and see" (the scene at its date, looking at the Sun); the moons' tab (Jupiter's phenomena).

describe.skipIf(!E2E)("the eclipse calculator", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis", width: 1440, height: 900, lang: "fr" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.js(`(__bh.game.land("earth", 48.86, 2.35), __bh.game.setDate("2026-01-01T12:00:00Z"), true)`);
    await Bun.sleep(1500);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the moons' tab: Jupiter's phenomena for a month, a sheet with the system as seen", async () => {
    await app.click("[data-testid=hud-eclipses]");
    await app.waitFor(`document.querySelectorAll("[data-testid=ec-row]").length > 0`, 60_000);
    await app.click("[data-testid=ec-tab-moons]");
    await app.waitFor(`document.querySelector(".ec-row")?.textContent.includes("Jupiter")`, 60_000);
    await app.waitFor(`!!document.querySelector(".ec-moons")`, 30_000);
    expect(await app.js<number>(`document.querySelectorAll("[data-testid=ec-row]").length`)).toBeGreaterThan(50);
    await app.press("Escape");
  }, 120_000);
  test("the timeline, the 2026 total eclipse's sheet from Paris, and going to see it", async () => {
    await app.click("[data-testid=hud-eclipses]");
    // (the page keeps its last tab: back to the Sun's and the Moon's)
    await app.click("[data-testid=ec-tab-earth]");
    await app.waitFor(
      `document.querySelectorAll("[data-testid=ec-row]").length >= 8 && !!document.querySelector('[data-testid=ec-row][data-id^="solar:"]')`,
      60_000,
    );
    const ids = await app.js<string[]>(`[...document.querySelectorAll("[data-testid=ec-row]")].map((r) => r.dataset.id)`);
    expect(ids.some((i) => i.startsWith("solar:2026-08-12"))).toBe(true);
    expect(ids.some((i) => i.startsWith("lunar:2026-03-03"))).toBe(true);
    await app.click(`[data-testid=ec-row][data-id^="solar:2026-08-12"]`);
    await app.waitFor(`!!document.querySelector("[data-testid=ec-map]") && !!document.querySelector(".ec-track")`, 60_000);
    const sheet = await app.js<string>(`document.querySelector("[data-testid=ec-sheet]").textContent`);
    expect(sheet).toContain("Éclipse totale de Soleil");
    expect(sheet).toContain("126");
    expect(sheet).toContain("partielle ici");
    // (go and see: the scene at its date, the view on the Sun from Paris — where it is seen, partial)
    await app.click("[data-testid=ec-go]");
    await app.waitFor(`!document.querySelector("[data-testid=eclipses]")`, 10_000);
    await Bun.sleep(1500);
    const st = await app.js<{ target: string; date: string; sun: number }>(
      `({ target: __bh.settings.target, date: __bh.game.date(), sun: __bh.camera.skyInfo?.()?.sun?.altDeg ?? -99 })`,
    );
    expect(st.target).toBe("sun");
    expect(st.date).toContain("2026-08-12");
    expect(st.sun).toBeGreaterThan(5);
  }, 180_000);
});
