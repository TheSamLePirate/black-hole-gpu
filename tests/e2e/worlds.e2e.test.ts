import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Gargantua's worlds' scenes, the Ranger flown: none breaks it at load. Their low views were orbits 2–3 km
// up — an orbit's kilometres a second inside the air: broken up at once under hundreds of g —, now level
// flight through the air; Miller's ground set the ship on the drawn waves, a metre over the sea it feels
// (a 5 m/s drop: a crash for a real gear). Each scene 5 s at fixed steps.

const SCENES = [
  "Miller: the shallow sea",
  "Mann: the glaciers",
  "Edmunds: the plains",
  "Miller: Gargantua over the sea",
  "Mann: Gargantua over the ice",
  "Edmunds: Gargantua at dusk",
];

describe.skipIf(!E2E)("Gargantua's worlds: their scenes flown, the Ranger whole", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 60_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  for (const name of SCENES)
    test(name, async () => {
      const r = await app.js<{ fail: string | null; gMax: number; label: string; log: string[] }>(`(() => {
        __bh.freeze(true); __bh.game.preset(${JSON.stringify(name)});
        const c = __bh.camera; let gMax = 0;
        for (let i = 0; i < 150; i++) { __bh.step(1 / 30); gMax = Math.max(gMax, c.airFlight.g || 0); if (c.airFlight.failure) break; }
        __bh.freeze(false);
        return { fail: c.airFlight.failure, gMax, label: __bh.game.status().label,
          log: __bh.game.log.events.filter((e) => e.kind === "pilot").slice(-3).map((e) => e.text) };
      })()`);
      expect(r.fail).toBeNull();
      expect(r.log.some((l) => /Crashed|crashed|broke up/.test(l))).toBe(false);
      expect(r.gMax).toBeLessThan(3);
      expect(["IN FLIGHT", "LANDED"]).toContain(r.label);
    }, 60_000);
});
