import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The take-off's assistant (C2) by real input: from the Cape, the take-off assisted (F4, U) waits for its
// pilot — the director gives the path's angle and heading, the countdown to the gravity turn; the graph
// beside the hub is the ascent's. Handed to the autopilot (the card's button), it climbs on its optimum:
// the trace in the corridor, max-Q passed, the cutoff counted down; assisted again mid-climb, the throttle
// stays where it was.

describe.skipIf(!E2E)("the take-off assisted", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: the Blue Marble" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("from the Cape: the pilot awaited, the ascent's graph and countdowns; the autopilot on its optimum", async () => {
    await app.js(`__bh.game.land("earth", 28.573, -80.649)`);
    await Bun.sleep(2000);
    await app.press("F4", "F4");
    await app.press("KeyU", "u");
    await app.waitFor(`__bh.camera.hubInfo()?.graph?.kind === "climb"`, 10_000);
    await Bun.sleep(1500);
    // assisted: the ship on its pad, the director's figures
    expect(await app.js<number>("__bh.camera.pilot.throttle")).toBe(0);
    expect(await app.js<number>("__bh.game.status().altKm")).toBeLessThan(0.05);
    const say = await app.js<string[]>("__bh.camera.hubInfo().say");
    expect(say.some((l) => l.startsWith("PATH 90°"))).toBe(true);
    expect(say.some((l) => l.startsWith("GRAVITY TURN IN"))).toBe(true);
    // the autopilot flies: on its optimum, max-Q met, the cutoff counted down
    await app.click("[data-testid=hub-assist]");
    await app.waitFor(`__bh.game.status().altKm > 12`, 120_000);
    const H = await app.js<{ state: string; n: number; rows: string[] }>(
      `(() => { const h = __bh.camera.hubInfo(); return { state: h.graph.state, n: h.graph.flown.length, rows: h.rows.map((r) => r[0]) }; })()`,
    );
    expect(H.state).toBe("on");
    expect(H.n).toBeGreaterThan(10);
    expect(H.rows).toContain("q · max");
    expect(H.rows).toContain("MECO in");
    // assisted again, mid-climb: the throttle the pilot's from where the autopilot left it
    await app.press("F4", "F4");
    expect(await app.js<number>("__bh.camera.pilot.throttle")).toBeGreaterThan(0.3);
    expect(await app.js<boolean>(`document.querySelector(".fl-hub-graph").dataset.state !== undefined`)).toBe(true);
    await app.press("KeyX", "x");
    await app.press("KeyU", "u");
  }, 300_000);
});
