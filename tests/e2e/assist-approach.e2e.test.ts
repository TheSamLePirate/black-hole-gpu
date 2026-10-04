import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The approach's assistant (C6) by real input: 20 000 km from the Moon, the approach assisted (F4, 0) waits
// for its pilot — the closing rate against the distance to the stand-off, the autopilot's braking curve and
// its corridor; handed to the autopilot it closes on its curve; the ring's new ORBIT button flies the
// target's orbit (and ⇧0).

describe.skipIf(!E2E)("the approach assisted, the target's orbit", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: the Blue Marble" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the approach's graph and cues, the autopilot on its curve; the ORBIT button", async () => {
    await app.js(`__bh.game.near("moon", { altKm: 20000 })`);
    await Bun.sleep(1000);
    await app.press("F4", "F4");
    await app.press("Digit0", "0");
    await app.waitFor(`__bh.camera.hubInfo()?.graph?.kind === "approach"`, 10_000);
    // assisted: nothing flown, the closing slower than the curve (cyan), the rates said
    expect(await app.js<number>("__bh.camera.pilot.throttle")).toBe(0);
    expect(await app.js<string>("__bh.camera.hubInfo().graph.state")).toBe("wait");
    expect((await app.js<string[]>("__bh.camera.hubInfo().say")).some((l) => l.startsWith("CLOSING "))).toBe(true);
    // the autopilot: it closes, its trace on the graph, the braking said
    await app.click("[data-testid=hub-assist]");
    await app.waitFor(`__bh.camera.hubInfo()?.graph?.flown.length > 20`, 60_000);
    await app.waitFor(`(__bh.camera.hubInfo()?.say ?? []).some((l) => l.startsWith("BRAKE"))`, 60_000);
    // the ring's ORBIT: the target's orbit engaged
    await app.press("Digit0", "0");
    await app.click(`[data-testid=ring-orbit]`);
    expect(await app.js<string>("__bh.camera.pilot.auto")).toBe("orbit");
    await app.press("Digit0", "0", { shift: true });
    expect(await app.js<string>("__bh.camera.pilot.auto")).toBe("none");
  }, 300_000);
});
