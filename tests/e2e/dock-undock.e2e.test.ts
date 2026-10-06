import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Docked to the ISS and let go at once: the craft leaves on the springs' 5 cm/s. The capture once left it
// with the closing speed it came in with until the next frame's hold — let go before that, it ran back
// into the port at 3.5 cm/s and bounced (flight lab dock-iss-undock-redock).

describe.skipIf(!E2E)("docking: let go at once, the craft leaves", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 60_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("captured at the port's velocity; undocked at once, it moves away and docks again", async () => {
    const r = await app.js<{ docked: boolean; closing: number[]; bounced: boolean; again: boolean }>(`(async () => {
      __bh.setDate(Date.UTC(2026, 9, 1, 12)); __bh.game.preset("Earth: docking to the ISS");
      await new Promise((ok) => setTimeout(ok, 1500));
      const c = __bh.camera; __bh.freeze(true);
      const said = []; const prev = c.onPilotMessage; c.onPilotMessage = (m) => { said.push(String(m)); prev?.(m); };
      c.pilot.auto = "none"; c.pilot.setAuto("dock");
      for (let i = 0; i < 30 * 600 && !c.docked; i++) __bh.step(1 / 30);
      const docked = !!c.docked;
      c.undock(); __bh.game.target("iss");
      const closing = [];
      for (let i = 0; i < 30 * 20; i++) { __bh.step(1 / 30); if (i % 60 === 0) closing.push(c.dockGeometry()?.closing ?? NaN); }
      // (and back: the docking autopilot from where it drifted)
      c.pilot.auto = "none"; c.pilot.setAuto("dock");
      for (let i = 0; i < 30 * 600 && !c.docked; i++) __bh.step(1 / 30);
      __bh.freeze(false);
      return { docked, closing, bounced: said.some((m) => m.startsWith("Bounced")), again: !!c.docked };
    })()`);
    expect(r.docked).toBe(true);
    // (moving away at the springs' 5 cm/s: closing < 0 throughout)
    for (const k of r.closing) expect(k).toBeLessThan(-0.03);
    expect(r.bounced).toBe(false);
    expect(r.again).toBe(true);
  }, 300_000);
});
