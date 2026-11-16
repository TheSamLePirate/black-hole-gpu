import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
// The playable floor's proposal (Sam's decision, 15 Nov 2026 — the raster's fallback to the traced pipeline retired; under 15 images a
// second held 12 s, lighter settings PROPOSED, not imposed): the F-35 over the Rade d'Hyères in the raster (tiles off), the proposal
// shown as the governor shows it (__bh.offerLighter(10) — the watch itself is tests/low-rate-offer.test.ts's), in French. Asserted: TARS's
// proposal panel open with the three steps named as the settings name them and the rate; nothing changed before the answer; Accept by a
// real click — the three settings one step lighter, said by a toast; proposed again, Refuse by a real click — nothing changed, the refusal
// remembered on the device (never proposed again: offerLighter false). The e2e's own boot refuses it (no proposal over a measure).
// Duration: ~1 min on kerr-mini.
// Done when: the refusal remembered and nothing proposed after it.
afterAll(stopServer);
describe.skipIf(!E2E)("the playable floor: lighter settings proposed, applied only on a yes", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({
      width: 1280,
      height: 800,
      lang: "fr",
      hash: "scene=game:artemis",
      tiles: false,
      initScript: `try { localStorage.removeItem("kerr.lowrate-refused"); } catch {}`,
    });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(
      `(() => { __bh.settings.voice = false; __bh.game.flyAt(43.06, 6.31, 500, 270, 140); __bh.settings.shipMount = "cockpit"; return 1; })()`,
    );
    await app.settled(90_000);
  }, 240_000);
  afterAll(() => app?.close());

  const read = () =>
    app.js<{ scale: number; scenery: string; reach: string; pipe: string }>(
      `({ scale: __bh.settings.earthRasterScale, scenery: __bh.settings.earthScenery, reach: __bh.settings.detailReach, pipe: __bh.renderer.earthPipelineNow(__bh.settings) })`,
    );

  test("proposed with its three steps; Accept: one step lighter, said", async () => {
    await app.scenario("proposé, accepté");
    const before = await read();
    expect(before).toEqual({ scale: 0.75, scenery: "high", reach: "veryFar", pipe: "raster" });
    expect(await app.js<boolean>(`__bh.offerLighter(10)`)).toBe(true);
    await app.waitFor(`!!document.querySelector("[data-testid=tars-accept]")?.offsetParent`, 10_000);
    const shown = await app.js<{
      title: string;
      steps: string[];
      figs: string;
    }>(`(() => { const p = document.querySelector("[data-testid=tars-accept]").closest(".tp-choose").parentElement;
      return { title: p.querySelector("h3")?.textContent ?? "", steps: [...p.querySelectorAll(".tp-steps li")].map((l) => l.textContent), figs: p.querySelector(".tp-figs")?.textContent ?? "" }; })()`);
    console.log(`  proposed: ${JSON.stringify(shown)}`);
    await app.snap("remote-results/low-rate-offer-propose-accepte.png");
    // (nothing changed before the answer)
    expect(await read()).toEqual(before);
    expect(shown.title).toMatch(/plus légers/);
    expect(shown.steps.length).toBe(3);
    expect(shown.steps.join(" | ")).toMatch(/75 %.*67 %/);
    expect(shown.figs).toMatch(/10/);
    await app.click("[data-testid=tars-accept]");
    await app.waitFor(`__bh.settings.earthRasterScale < 0.7`, 5_000);
    const after = await read();
    console.log(`  accepted: ${JSON.stringify(after)}`);
    expect(after).toEqual({ scale: 0.667, scenery: "balanced", reach: "far", pipe: "raster" });
  }, 60_000);

  test("proposed again; Refuse: nothing changed, the refusal remembered, never proposed again", async () => {
    await app.scenario("proposé, refusé");
    const before = await read();
    expect(await app.js<boolean>(`__bh.offerLighter(9)`)).toBe(true);
    await app.waitFor(`!!document.querySelector("[data-testid=tars-refuse]")?.offsetParent`, 10_000);
    await app.click("[data-testid=tars-refuse]");
    await Bun.sleep(500);
    const r = await app.js<{ refused: string | null; again: boolean }>(
      `({ refused: localStorage.getItem("kerr.lowrate-refused"), again: __bh.offerLighter(8) })`,
    );
    console.log(`  refused: ${JSON.stringify({ ...r, settings: await read() })}`);
    await app.snap("remote-results/low-rate-offer-refused.png");
    expect(await read()).toEqual(before);
    expect(r.refused).toBe("1");
    expect(r.again).toBe(false);
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);
});
