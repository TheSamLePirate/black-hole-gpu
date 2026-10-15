import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The F-35's radar in the game (docs/PLAN-AVIATION-AAA.md, C1): the drone hunt from its card — the drones swept at
// once, hostile; Tab the radar's lock, the fight's lock with it; the HUD's scope (its mode, its beam), the TSD's
// map from the cockpit; STT on the lock, the beam held on it. (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the F-35's radar", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const picture = () =>
    app.js<{
      mode: string;
      beam: number;
      tracks: { name: string; iff: string; locked: boolean }[];
      worldLock: number | null;
      lock: string | null;
    }>(
      `(() => { const P = __bh.camera.radarHud(); return { mode: P.mode, beam: P.beam, tracks: P.contacts.map((c) => ({ name: c.name, iff: c.iff, locked: c.locked })), worldLock: __bh.camera.combat?.world.lock ?? null, lock: __bh.camera.radar.lock }; })()`,
    );
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.wind = 0; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the drone hunt: the drones swept at once, hostile; Tab locks — the fight's lock the radar's", async () => {
    await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await app.click(`[data-testid="chp-fight-drones"]`);
    await app.waitFor(`__bh.camera.radar.tracks.size >= 3`, 10_000);
    await app.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); __bh.settings.shipMount = "chase"; return 1; })()`,
    );
    await app.press("Tab");
    await Bun.sleep(600);
    const P = await picture();
    console.log(`  ${P.mode}: ${P.tracks.map((x) => `${x.name} ${x.iff}${x.locked ? " [LOCK]" : ""}`).join(", ")}`);
    expect(P.tracks.filter((x) => x.iff === "hostile").length).toBeGreaterThanOrEqual(3);
    expect(P.lock).not.toBeNull();
    expect(P.worldLock).toBe(Number(P.lock!.slice(4)));
    await shot("radar-hud");
  }, 60_000);

  test("from the cockpit: the TSD's map with the tracks; STT on the lock, the beam on it", async () => {
    await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    await shot("radar-tsd");
    const mode = await app.js<string>(`(() => { const c = __bh.camera; c.radarMode(); return c.radar.mode; })()`);
    expect(mode).toBe("STT");
    await Bun.sleep(800);
    const P = await picture();
    console.log(`  ${P.mode}: beam ${((P.beam * 180) / Math.PI).toFixed(1)}°, lock ${P.lock}`);
    expect(P.lock).not.toBeNull();
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(800);
    await shot("radar-stt");
  }, 60_000);
});
