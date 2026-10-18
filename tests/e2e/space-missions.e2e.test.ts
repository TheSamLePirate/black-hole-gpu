import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-VAISSEAUX X11: the spacecraft's missions in the real page, real clicks — the panel (the Interstellar campaign's
// seven chapters, only the first open; the library's five), the Moon landing flown from its card: the Lander set in a
// 50 km lunar orbit, its first objective said; a budget forced over → the mission's debrief card, failed. Then a
// mission made in the editor (its start the flight now, two objectives, a Δv budget), flown, its link copied and
// opened: the page reloaded flies it. (E2E_SHOTS=<dir>: the panel, the mission begun, the debrief, the editor.) ~1.5 min.

describe.skipIf(!E2E)("the spacecraft's missions (X11)", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 60_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the panel: the campaign's chapters locked after the first; the Moon landing flown from its card; its debrief", async () => {
    await app.js(`(localStorage.removeItem("kerr.space.campaign"), __bh.flight.spaceMissions.open(), 1)`);
    await app.waitFor(`document.querySelectorAll('[data-testid^="space-mission-"]').length === 12`, 5000);
    const locked = await app.js<string[]>(
      `[...document.querySelectorAll('[data-testid^="space-mission-"]')].filter((b) => b.disabled).map((b) => b.dataset.testid)`,
    );
    expect(locked).toEqual(
      ["c2-endurance", "c3-wormhole", "c4-miller", "c5-mann", "c6-slingshot", "c7-edmunds"].map((x) => `space-mission-${x}`),
    );
    if (shots) await app.shot(`${shots}/x11-missions-panel.png`);
    // (a locked chapter's button does nothing)
    await app.click('[data-testid="space-mission-c4-miller"]');
    expect(await app.js<boolean>(`!!document.querySelector('[data-testid="space-missions"]')`)).toBe(true);
    await app.click('[data-testid="space-mission-moon-landing"]');
    await app.waitFor(`__bh.camera.spaceMission?.M.id === "moon-landing"`, 30_000);
    expect(await app.js<string>(`__bh.settings.vessel`)).toBe("lander");
    const soi = await app.js<string>(`__bh.game.status()?.soi ?? ""`);
    expect(soi).toBe("moon");
    if (shots) {
      await new Promise((ok) => setTimeout(ok, 3000));
      await app.shot(`${shots}/x11-moon-landing.png`);
    }
    // (the budget forced over: failed at once, its debrief shown)
    await app.js(
      `(__bh.camera.spaceMission.M = { ...__bh.camera.spaceMission.M, budget: { dv: 1 } }, __bh.camera.spaceMission.spent0 = __bh.camera.spent - 1e-7, 1)`,
    );
    await app.waitFor(`__bh.camera.spaceMission === null`, 10_000);
    await app.waitFor(`!!document.querySelector('[data-testid="flight-report"]:not([hidden])')`, 5000);
    const card = await app.js<string>(`document.querySelector('[data-testid="flight-report"]').textContent`);
    expect(card).toMatch(/Mission · Landing on the Moon/);
    expect(card).toMatch(/Δv budget spent/);
    if (shots) await app.shot(`${shots}/x11-debrief.png`);
    expect(app.cdp.errors).toEqual([]);
  }, 180_000);

  test("the editor: a mission made from here, flown; its link copied and opened flies it again", async () => {
    await app.js(
      `(document.querySelector('[data-testid="flight-report"] .k-close, [data-testid="flight-report"] button')?.click(), __bh.flight.spaceMissions.open(), 1)`,
    );
    await app.waitFor(`!!document.querySelector('[data-testid="smed-open"]')`, 5000);
    await app.js(`(document.querySelector('[data-testid="smed-open"]').scrollIntoView({ block: "center" }), 1)`);
    await app.click('[data-testid="smed-open"]');
    await app.waitFor(`!!document.querySelector('[data-testid="smed-editor"]')`, 5000);
    await app.click('[data-testid="smed-title"]');
    await app.type("Down and safe");
    await app.click('[data-testid="smed-add"]');
    // (the second row's condition: landed — a select set as a person picks it)
    await app.js(
      `(() => { const s = document.querySelectorAll('[data-testid="smed-kind"]')[1]; s.value = "landed"; s.dispatchEvent(new Event("change")); return 1; })()`,
    );
    await app.click('[data-testid="smed-dv"]');
    await app.type("500");
    if (shots) await app.shot(`${shots}/x11-editor.png`);
    await app.js(`(navigator.clipboard.writeText = async (s) => { window.__copied = s; }, 1)`);
    await app.click('[data-testid="smed-share"]');
    await app.waitFor(`!!window.__copied`, 5000);
    const link = await app.js<string>(`window.__copied`);
    expect(link).toMatch(/#smission=[\w-]+$/);
    await app.click('[data-testid="smed-fly"]');
    await app.waitFor(`__bh.camera.spaceMission?.M.title === "Down and safe"`, 30_000);
    const M = await app.js<{ objectives: unknown[]; budget: unknown }>(`__bh.camera.spaceMission.M`);
    expect(M.objectives).toEqual([{ done: { altAbove: 100 } }, { done: { landed: true } }]);
    expect(M.budget).toEqual({ dv: 500 });
    // (the link opened: the page reloaded, the mission flown from its start)
    await app.load(link.slice(link.indexOf("#") + 1));
    await app.waitFor(`__bh.camera.spaceMission?.M.id.startsWith("link-")`, 60_000);
    expect(await app.js<string>(`__bh.camera.spaceMission.M.title`)).toBe("Down and safe");
    expect(app.cdp.errors).toEqual([]);
  }, 240_000);
});
