import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The docking assisted (C7) by real input, by the ISS: the ring's DOCK button, assisted — the card says what
// the docking autopilot would do and why, its graph the closing rate against the distance along the port's
// axis; handed to the autopilot (the card's button), it comes into the corridor on its profile, the contact
// counted down.

describe.skipIf(!E2E)("the docking assisted", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: docking to the ISS" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the ring's DOCK, assisted then flown: the phase explained, the corridor, the contact counted down", async () => {
    await Bun.sleep(1500);
    await app.press("F4", "F4");
    await app.click(`[data-testid=ring-dock]`);
    await app.waitFor(`__bh.camera.pilot.auto === "dock" && __bh.camera.hubInfo()?.graph?.kind === "dock"`, 10_000);
    expect(await app.js<number>("__bh.camera.pilot.throttle")).toBe(0);
    expect((await app.js<string>("__bh.camera.hubInfo().phase")).length).toBeGreaterThan(20);
    expect((await app.js<string[]>("__bh.camera.hubInfo().say")).some((l) => l.startsWith("CLOSE "))).toBe(true);
    await app.click("[data-testid=hub-assist]");
    await app.waitFor(`__bh.camera.hubInfo()?.graph?.state === "on"`, 120_000);
    await app.waitFor(`(__bh.camera.hubInfo()?.say ?? []).some((l) => l.startsWith("CONTACT IN"))`, 30_000);
    await app.press("KeyB", "b");
  }, 300_000);
});
