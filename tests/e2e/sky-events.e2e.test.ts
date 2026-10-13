import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The tripod and the sky's events from the view (PLAN-MODES-AAA M7 — ui/skyevents.ts, ui/livecapture.ts,
// photo/skyevents.ts): walking in Paris, the top bar offers the tripod and ⇧T sets it where one stands (the free
// camera on the ground); ⇧F8 opens the sky's events — the star trails at once, the eclipses from the worker after;
// "Go there" aims the tripod (the field set); TARS's sky_events lists them and lives the analemma — its exposures
// taken in the game, stopped after three, the stack offered as a PNG; no console error.

describe.skipIf(!E2E)("the tripod and the sky's events", () => {
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

  test("walking in Paris, ⇧T: the tripod where one stands", async () => {
    await app.js(
      `__bh.tars.tools().find((t) => t.name === "atlas").run({ action: "go", body: "earth", lat: 48.853, lon: 2.35, query: "Paris", to: "walk" }, new AbortController().signal)`,
    );
    await settle();
    await app.waitFor("__bh.camera.character.active", 30_000);
    // (the top bar offers the tripod on foot — a tablet has no ⇧T)
    expect(await app.js<boolean>(`!document.querySelector("[data-testid=topbar-tripod]").classList.contains("tb-off")`)).toBe(true);
    await app.press("KeyT", "T", { shift: true });
    await settle();
    expect(await app.js<boolean>("__bh.camera.character.active")).toBe(false);
    expect(await app.js<string>("__bh.mode.get()")).toBe("free");
    expect(await app.js<string | null>("__bh.mode.state().groundBelow")).toBe("earth");
  }, 60_000);

  test("⇧F8: the sky's events from here; Go there aims the tripod", async () => {
    await app.press("F8", "F8", { shift: true });
    await app.waitFor(`!!document.querySelector("[data-testid=sky-event-trails]")`, 10_000);
    // (the eclipses: from the worker, over thirty years)
    await app.waitFor(`!!document.querySelector("[data-testid=sky-event-solar], [data-testid=sky-event-lunar]")`, 60_000);
    await app.click("[data-testid=sky-go-trails]");
    await settle();
    expect(await app.js<boolean>(`!document.querySelector("[data-testid=sky-events]")`)).toBe(true);
    expect(await app.js<number>("__bh.settings.fov")).toBeCloseTo(60, 0);
    expect(await app.js<string | null>("__bh.mode.state().groundBelow")).toBe("earth");
  }, 90_000);

  test("TARS lists them and lives the analemma: three exposures, stopped, the stack offered", async () => {
    const r = await app.js<{ ok: boolean; events: { id: string; look: { fovDeg: number } }[] }>(
      `Promise.resolve(__bh.tars.tools().find((t) => t.name === "sky_events").run({ action: "list" }, new AbortController().signal)).then((r) => r.result ?? r)`,
    );
    expect(r.ok).toBe(true);
    const ids = r.events.map((e) => e.id);
    expect(ids).toContain("trails");
    expect(ids).toContain("analemma");
    const animate = await app.js<boolean>("__bh.settings.animate");
    await app.js(
      `__bh.tars.tools().find((t) => t.name === "sky_events").run({ action: "take", id: "analemma", way: "live" }, new AbortController().signal)`,
    );
    await app.waitFor(`!!document.querySelector("[data-testid=live-capture]")`, 10_000);
    await app.waitFor(`+((document.querySelector(".lc-line")?.textContent ?? "").match(/(\\d+) \\//)?.[1] ?? 0) >= 3`, 180_000);
    await app.click("[data-testid=live-stop]");
    await app.waitFor(`!!document.querySelector("[data-testid=live-save]")`, 60_000);
    // (the game's time given back as it was)
    expect(await app.js<boolean>("__bh.settings.animate")).toBe(animate);
    await app.click("[data-testid=live-close]");
    expect(await app.js<boolean>(`!document.querySelector("[data-testid=live-capture]")`)).toBe(true);
    expect(app.cdp.errors).toEqual([]);
  }, 300_000);
});
