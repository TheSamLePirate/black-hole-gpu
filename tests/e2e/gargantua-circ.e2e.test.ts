import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Near Miller (game:interstellar, the Ranger): the holds and CIRC within a world of Gargantua's sphere. A 2 000 km circle, prograde
// held then 20 s of thrust: the apoapsis up, the periapsis kept (the prograde is Miller's, not the hole's); radial out: the apsides
// turned (the periapsis down, the apoapsis up as much). Then an orbit of 2 000 × 4 000 km and CIRC: before 11 Nov 2026 it flew
// the Kerr circle round the hole and braked without end (periapsis 7 600 km under the ground); now a circle about Miller,
// ended by itself.
// Duration: ~1 min. Done when: CIRC ended near Miller, its orbit's apsides within 2 % of each other.
const DIR = "remote-results/gargantua-circ";
mkdirSync(DIR, { recursive: true });
afterAll(stopServer);
test.skipIf(!E2E)(
  "the holds and CIRC near Miller",
  async () => {
    const app = await App.boot({ width: 1440, height: 900, hash: "scene=game:interstellar", tiles: false });
    try {
      await app.waitFor("__bh.camera.piloting", 90_000);
      const st = () =>
        app.js<{ soi: string; status: string; pe: number | null; ap: number | null; local: boolean; fail: string | null }>(`(() => {
        const s = __bh.game.status();
        return { soi: s.soi, status: s.status, pe: s.orbit && Math.round(s.orbit.peKm), ap: s.orbit && Math.round(s.orbit.apKm),
          local: !!__bh.camera.local, fail: __bh.camera.airFlight?.failure ?? null }; })()`);
      expect(
        await app.js<string>(
          `(() => { __bh.settings.vessel = "ranger"; for (let i = 0; i < 5; i++) __bh.step(1 / 30); return __bh.fleet.active; })()`,
        ),
      ).toBe("ranger");
      const burn = async (hold: string) => {
        await app.js(`(() => { __bh.game.orbit("miller", { altKm: 2000 }); for (let i = 0; i < 10; i++) __bh.step(1 / 30);
        const p = __bh.camera.pilot; p.auto = "none"; p.hold = "none"; p.setHold("${hold}");
        for (let i = 0; i < 30 * 40; i++) __bh.step(1 / 30);
        p.throttle = 1; for (let i = 0; i < 30 * 20; i++) __bh.step(1 / 30); p.throttle = 0;
        for (let i = 0; i < 30; i++) __bh.step(1 / 30); p.hold = "none"; return 1; })()`);
        return st();
      };
      const pro = await burn("prograde");
      console.log("  prograde, 20 s :", JSON.stringify(pro));
      expect(pro.soi).toBe("miller");
      expect(pro.fail).toBeNull();
      expect(pro.ap!).toBeGreaterThan(3000);
      expect(Math.abs(pro.pe! - 2000)).toBeLessThan(50);
      const rad = await burn("radialOut");
      console.log("  radial out, 20 s :", JSON.stringify(rad));
      expect(rad.fail).toBeNull();
      expect(rad.pe!).toBeLessThan(1900);
      expect(rad.ap!).toBeGreaterThan(2100);
      // (the apsides turned about the same: a radial push changes the energy little)
      expect(Math.abs(2000 - rad.pe! - (rad.ap! - 2000))).toBeLessThan(120);
      await app.js(`(() => { __bh.game.orbit("miller", { peKm: 2000, apKm: 4000, nu: 90 }); for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      const p = __bh.camera.pilot; p.hold = "none"; p.auto = "none"; p.setAuto("circularize"); return 1; })()`);
      const t0 = await st();
      let done = false;
      for (let k = 0; k < 6 && !done; k++)
        done = await app.js<boolean>(
          `(() => { const p = __bh.camera.pilot; for (let i = 0; i < 30 * 60; i++) { __bh.step(1 / 30); if (p.auto === "none") return true; } return false; })()`,
        );
      const c = await st();
      console.log("  CIRC :", JSON.stringify(t0), "→", JSON.stringify(c), done ? "ended" : "still on");
      await app.js(
        `(__bh.settings.shipMount = "chase", __bh.refresh(), __bh.camera.viewReset(), (() => { for (let i = 0; i < 3; i++) __bh.step(1 / 30); })(), true)`,
      );
      await Bun.sleep(1500);
      await app.shot(`${DIR}/circ-miller.png`);
      expect(done).toBe(true);
      expect(c.soi).toBe("miller");
      expect(c.fail).toBeNull();
      expect(c.pe!).toBeGreaterThan(2000);
      expect((c.ap! - c.pe!) / ((c.ap! + c.pe!) / 2)).toBeLessThan(0.02);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  300_000,
);
