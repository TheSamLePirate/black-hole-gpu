import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Placing the ship (ui/placepanel.ts) by real clicks: from the HUD's Place button during a mission —
// asked first, the mission ended —, beside a body at rest under the hover autopilot; before the far
// mouth of the wormhole with no mission left to end; Escape closes it.

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
