import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Placing the ship (ui/placepanel.ts) by real clicks: from the HUD's Place button during a mission —
// asked first, the mission ended —, beside a body at rest under the hover autopilot; on foot — the
// ship landed and the astronaut out walking (the panel's On foot mode); before the far mouth of the
// wormhole with no mission left to end; Escape closes it.

describe.skipIf(!E2E)("placing the ship", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const open = `!!document.querySelector("[data-testid=place-panel]")`;
  const status = () =>
    app.js<{ side: string; soi: string; auto: string; target: string }>(
      `(() => { const g = __bh.game.status(); return { side: g.side, soi: g.soi, auto: __bh.camera.pilot.auto, target: String(__bh.settings.target) }; })()`,
    );

  test("during a mission: asked, then beside Mars at rest, Mars targeted, the hover autopilot on", async () => {
    await app.waitFor(`!!document.querySelector("[data-testid=hud-place]")`, 30_000);
    await app.click("[data-testid=hud-place]");
    await app.waitFor(open);
    await app.click("[data-testid=place-near]");
    await app.click("[data-testid=place-body-mars]");
    await app.click("[data-testid=place-go]");
    // (the mission named, nothing placed yet)
    await app.waitFor(`!!document.querySelector("[data-testid=place-confirm]")`);
    expect((await status()).soi).toBe("earth");
    await app.click("[data-testid=place-confirm]");
    await app.waitFor(`!${open}`);
    const s = await status();
    expect(s).toMatchObject({ side: "ours", soi: "mars", auto: "hover", target: "mars" });
  });

  test("on foot: land the ship and the astronaut steps out walking, anywhere on the body", async () => {
    await app.click("[data-testid=hud-place]");
    await app.waitFor(open);
    await app.click("[data-testid=place-walk]");
    await app.click("[data-testid=place-body-moon]");
    await app.click("[data-testid=place-go]");
    await app.waitFor(`!${open}`);
    const w = await app.js<{ active: boolean; body: string; ours: boolean; grounded: boolean }>(
      `(() => { const c = __bh.camera.character; return { active: c.active, body: c.body, ours: c.ours, grounded: c.grounded }; })()`,
    );
    expect(w).toMatchObject({ active: true, body: "moon", ours: true, grounded: true });
    // (back at the controls: the ship stands beside the astronaut — boarding at once)
    expect(await app.js<boolean>(`__bh.camera.piloting`)).toBe(true);
    expect(await app.js<number>(`__bh.camera.character.accessDistance()`)).toBeLessThan(3);
    // (boarded again: the flight HUD, and its Place button, back for the next placements)
    await app.click("[data-testid=character-board]");
    await app.waitFor(`!__bh.camera.character.active`);
    // (the top bar laid out for the ship again: the walker's buttons gone, the Place button back where it goes)
    await app.waitFor(`__bh.mode.get() === "ship"`);
    await Bun.sleep(800);
  });

  test("no mission left: before the far mouth at once; Escape closes the panel", async () => {
    await app.click("[data-testid=hud-place]");
    await app.waitFor(open);
    await app.click("[data-testid=place-wormhole]");
    await app.click("[data-testid=place-side-gargantua]");
    await app.click("[data-testid=place-go]");
    await app.waitFor(`!${open}`);
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=place-confirm]")`)).toBe(false);
    const s = await status();
    // (within the mouth's gluing sphere, on Gargantua's side of it: ℓ > 0 — the status says "the throat")
    expect(["gargantua", "throat"]).toContain(s.side);
    expect(await app.js<number>("__bh.settings.whL")).toBeGreaterThan(0);
    expect(s.target).toBe("wormhole");
    expect(s.auto).toBe("hover");
    await app.click("[data-testid=hud-place]");
    await app.waitFor(open);
    await app.press("Escape");
    await app.waitFor(`!${open}`);
  });
});
