import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A final flown by hand (C4) by real input: on Kennedy's axis, the glide autopilot let go (⇧G) — the
// runway's aids stay: the landing profile frozen where the hand-flown final began, the PAPI, the gates,
// the glide's error; the hub's card is the runway's (no autopilot to hand over to), its graph the final's
// height against the distance with the PAPI's corridor, the flare counted down.

describe.skipIf(!E2E)("a final flown by hand", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: the Blue Marble" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("Kennedy's final, the autopilot let go: the profile, the PAPI, the runway's card and graph", async () => {
    await app.js(`__bh.game.glideTo("Kennedy", 25, 2.5, 160)`);
    await app.waitFor(`__bh.camera.pilot.auto === "entry"`, 10_000);
    await app.press("KeyG", "G", { shift: true });
    expect(await app.js<string>("__bh.camera.pilot.auto")).toBe("none");
    await app.waitFor(`!!__bh.camera.runwayView()?.manual`, 10_000);
    await Bun.sleep(1500);
    const rw = await app.js<{ papi: number | null; gates: number; fix: boolean; flareIn: number | null }>(
      `(() => { const r = __bh.camera.runwayView(); return { papi: r.papi, gates: r.gates.length, fix: !!r.fix, flareIn: r.flareIn }; })()`,
    );
    expect(rw.fix).toBe(true);
    expect(rw.papi).not.toBeNull();
    expect(rw.gates).toBeGreaterThan(2);
    expect(rw.flareIn).toBeGreaterThan(30);
    // the runway's card: its graph, no mode to switch
    await app.waitFor(`__bh.camera.hubInfo()?.graph?.kind === "glide"`, 5_000);
    expect(await app.js<string>(`document.querySelector(".fl-hubcard .fl-title").textContent`)).toStartWith("RWY 15");
    expect(await app.js<boolean>(`document.querySelector("[data-testid=hub-assist]").hidden`)).toBe(true);
    // (the profile frozen: the glide's error grows as the craft floats above it, the PAPI whitens)
    await app.waitFor(`__bh.camera.runwayView().papi >= 3`, 30_000);
  }, 300_000);
});
