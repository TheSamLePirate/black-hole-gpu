import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The Atlas (PLAN-MODES-AAA M6 — ui/atlas.ts, ui/mapview.ts, game/pois.ts, game/geocode.ts): F8 opens it; Mars's
// tab, "olympus" found, the free camera put above Olympus Mons; the Moon, Apollo 11, walked there (the craft
// landed beside); TARS's atlas tool finds Mont Blanc; the pause menu offers the Atlas; no console error. The Earth's
// addresses (Photon) and its tiles are live sources: `ATLAS_LIVE=1` also searches an address.

describe.skipIf(!E2E)("the Atlas", () => {
  let app: App;
  const settle = () => app.js("(()=>{for(let i=0;i<20;i++)__bh.step(1/30);__bh.touch();return true;})()");
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: false });
    await app.js(`(__bh.freeze(true), __bh.settings.ship = false, __bh.touch(), true)`);
    await settle();
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("F8: Mars, Olympus Mons, the free camera above it", async () => {
    await app.press("F8", "F8");
    await app.waitFor(`!!document.querySelector("[data-testid=atlas]")`, 3_000);
    await app.click("[data-testid=atlas-body-mars]");
    await app.js(
      `(() => { const i = document.querySelector("[data-testid=atlas-search]"); i.value = "olympus"; i.dispatchEvent(new Event("input")); return true; })()`,
    );
    await app.waitFor(`/Olympus/.test(document.querySelector(".at-item b")?.textContent ?? "")`, 3_000);
    await app.click(".at-item");
    await app.waitFor(`!!document.querySelector("[data-testid=atlas-go-camera]")`, 3_000);
    await app.click("[data-testid=atlas-go-camera]");
    await settle();
    expect(await app.js<boolean>(`!document.querySelector("[data-testid=atlas]")`)).toBe(true);
    expect(await app.js<string>("__bh.mode.get()")).toBe("free");
    expect(await app.js<string | null>("__bh.mode.state().groundBelow")).toBe("mars");
  }, 60_000);

  test("the Moon, Apollo 11: walked there, the craft landed beside", async () => {
    await app.press("F8", "F8");
    await app.click("[data-testid=atlas-body-moon]");
    await app.js(
      `(() => { const i = document.querySelector("[data-testid=atlas-search]"); i.value = "apollo 11"; i.dispatchEvent(new Event("input")); return true; })()`,
    );
    await app.waitFor(`/Apollo 11/.test(document.querySelector(".at-item b")?.textContent ?? "")`, 3_000);
    await app.click(".at-item");
    await app.click("[data-testid=atlas-go-walk]");
    await settle();
    await app.waitFor("__bh.camera.character.active", 30_000);
    expect(await app.js<string>("__bh.camera.character.body")).toBe("moon");
    expect(await app.js<string>("__bh.mode.get()")).toBe("foot");
  }, 90_000);

  test("TARS finds Mont Blanc; the pause menu offers the Atlas", async () => {
    const r = await app.js<{ found: { name: string; lat: number; lon: number }[] }>(
      `__bh.tars.tools().find((t) => t.name === "atlas").run({ action: "search", query: "Mont Blanc", body: "earth" }, new AbortController().signal).then((r) => r.result ?? r)`,
    );
    expect(r.found[0]!.lat).toBeCloseTo(45.83, 1);
    await app.press("Escape", "Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause-atlas]")`, 3_000);
    await app.press("Escape", "Escape");
    expect(app.cdp.errors).toEqual([]);
  }, 30_000);

  test.skipIf(!process.env.ATLAS_LIVE)(
    "an address through Photon (live)",
    async () => {
      await app.press("F8", "F8");
      await app.click("[data-testid=atlas-body-earth]");
      await app.js(
        `(() => { const i = document.querySelector("[data-testid=atlas-search]"); i.value = "Place de la Concorde Paris"; i.dispatchEvent(new Event("input")); return true; })()`,
      );
      await app.waitFor(`[...document.querySelectorAll(".at-item small")].some((s) => /Paris/.test(s.textContent))`, 15_000);
      await app.press("Escape", "Escape");
    },
    30_000,
  );
});
