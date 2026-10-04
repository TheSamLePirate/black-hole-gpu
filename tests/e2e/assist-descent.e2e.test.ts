import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The vertical descent's assistant (C5) by real input, over the Moon: the hold (8) let go, the craft falls —
// the hub's card is the descent's (no autopilot), its graph the descent rate against the height with the
// landing autopilot's braking curve and its corridor; then the landing assisted (F4, G): the director's
// rate as flown and as asked.

describe.skipIf(!E2E)("the vertical descent assisted", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: the Blue Marble" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("over the Moon: the hand-flown descent's card and graph, then the landing assisted", async () => {
    await app.js(`__bh.game.near("moon", { altKm: 1.5 })`);
    await app.waitFor(`__bh.camera.pilot.auto === "hover"`, 10_000);
    await app.waitFor(`__bh.camera.hubInfo()?.graph?.kind === "descent"`, 10_000);
    // the hold let go: falling, the descent's own card
    await app.press("Digit8", "8");
    await app.waitFor(`__bh.camera.hubInfo()?.title === "DESCENT"`, 15_000);
    expect(await app.js<boolean>(`document.querySelector("[data-testid=hub-assist]").hidden`)).toBe(true);
    const G = await app.js<{ ideal: number; lo: number; state: string }>(
      `(() => { const g = __bh.camera.hubInfo().graph; return { ideal: g.ideal.length, lo: g.lo.length, state: g.state }; })()`,
    );
    expect(G.ideal).toBeGreaterThan(10);
    expect(G.lo).toBe(G.ideal);
    // (falling slowly yet: safe, below the curve — cyan, not amber)
    expect(G.state).toBe("wait");
    // the landing assisted: its rates said
    await app.press("F4", "F4");
    await app.press("KeyG", "g");
    await app.waitFor(`__bh.camera.pilot.auto === "land"`, 5_000);
    await app.waitFor(`(__bh.camera.hubInfo()?.say ?? []).some((l) => l.startsWith("DESCENT "))`, 10_000);
    expect(await app.js<number>("__bh.camera.pilot.throttle")).toBe(0);
    await app.press("KeyG", "g");
  }, 300_000);
});
