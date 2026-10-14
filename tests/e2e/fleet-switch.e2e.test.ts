import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The craft chosen in turn — the F-35 on a runway, the Lander, the Ranger, the F-35 again, the Endurance —: each
// where it was left (the F-35 still on its runway, the others coasting), no NaN in the camera's state.

describe.skipIf(!E2E)("switching craft through the F-35", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1000, height: 700, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("F-35 → Lander → Ranger → F-35 → Endurance: each found, the F-35 landed where it was", async () => {
    const seen: string[] = [];
    for (const v of ["f35", "lander", "ranger", "f35", "endurance"]) {
      await app.js(`(() => { __bh.settings.vessel = ${JSON.stringify(v)}; return 1; })()`);
      await Bun.sleep(2500);
      const r = await app.js<{ a: string; ok: boolean; label: string; nan: boolean }>(`(() => {
        const F = __bh.fleet, p = F.pose(F.active, __bh.sim.time), s = __bh.settings;
        return { a: F.active, ok: !!p && p.X.every(Number.isFinite), label: __bh.game.status().label,
          nan: [s.inclination, s.azimuth, s.yaw, s.pitch].some((x) => !Number.isFinite(x)) };
      })()`);
      seen.push(`${r.a}:${r.label}`);
      expect(r.a).toBe(v);
      expect(r.ok).toBe(true);
      expect(r.nan).toBe(false);
      if (v === "f35") expect(r.label).toBe("LANDED");
    }
    console.log(`  ${seen.join(" → ")}`);
  }, 120_000);
});
